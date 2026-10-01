import type { Frame, Page } from "playwright-core";

/**
 * CAPTCHA handling (founder decision D-146, 2026-10-01). Delivery sessions run
 * with Browserbase's CAPTCHA solver on. When a challenge shows, RoleDawn ticks
 * the provider's own "I'm not a robot" checkbox and waits for the solver; the
 * application is handed over only if the challenge is still unsolved when the
 * wait ends. A solved challenge is never a receipt: only the employer's own
 * response is. Form checkboxes (consent, privacy, attestation) are never
 * ticked here; they stay with the candidate.
 */
export const APPLICATION_FILL_CAPTCHA_TAKEOVER = "APPLICATION_FILL_CAPTCHA_TAKEOVER";

/** How long to wait for the solver before handing over. Browserbase documents solves taking up to about 30 s. */
export const CAPTCHA_SOLVE_TIMEOUT_MS = 120_000;

/** Requests that belong to a CAPTCHA provider itself. They carry the challenge, never candidate data. */
export function isCaptchaProviderRequestUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (["www.google.com", "www.recaptcha.net", "recaptcha.net", "www.gstatic.com"].includes(url.hostname)) return url.pathname.startsWith("/recaptcha/");
  if (url.hostname === "hcaptcha.com" || url.hostname.endsWith(".hcaptcha.com")) return true;
  return url.hostname === "challenges.cloudflare.com";
}

/** A CAPTCHA provider's own document (checkbox, challenge or widget frame). */
export function isCaptchaFrameUrl(value: string): boolean {
  return isCaptchaProviderRequestUrl(value) || isHcaptchaFrameUrl(value);
}

/**
 * Ticks the provider's own checkbox ("I'm not a robot") when it is shown and
 * not yet checked. Only elements inside a CAPTCHA provider's frame are
 * touched, so no form field, consent or attestation box can be clicked here.
 */
export async function tickCaptchaCheckbox(page: Page): Promise<boolean> {
  let ticked = false;
  for (const frame of page.frames()) {
    const url = frame.url();
    if (!isCaptchaFrameUrl(url)) continue;
    const selector = /recaptcha/u.test(url) ? "#recaptcha-anchor[aria-checked='false']"
      : /hcaptcha/u.test(url) ? "#checkbox[aria-checked='false']"
        : "input[type='checkbox']:not(:checked)";
    const box = frame.locator(selector).first();
    if (!await box.isVisible().catch(() => false)) continue;
    await box.click({ timeout: 5_000 }).then(() => { ticked = true; }).catch(() => undefined);
  }
  return ticked;
}

/** Every response-token field on the page is filled: the provider accepted the solve. */
async function captchaTokensFilled(page: Page): Promise<boolean> {
  let seen = 0;
  for (const frame of page.frames()) {
    const result = await frame.evaluate(() => {
      const fields = [...document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
        "textarea[name^='g-recaptcha-response'], textarea[name='h-captcha-response'], input[name='cf-turnstile-response']")];
      return { count: fields.length, filled: fields.filter((field) => field.value.trim().length > 0).length };
    }).catch(() => ({ count: 0, filled: 0 }));
    if (result.filled < result.count) return false;
    seen += result.count;
  }
  return seen > 0;
}

/** A challenge still asks for a person: one is shown and the provider has not issued its token. */
export async function captchaPending(page: Page, permittedPassiveFrameUrls: readonly string[] = []): Promise<boolean> {
  if (!await pageShowsCaptchaChallenge(page, permittedPassiveFrameUrls)) return false;
  return !await captchaTokensFilled(page);
}

/**
 * Waits for a shown challenge to be solved, ticking the provider's checkbox
 * along the way. True when nothing is pending; false when the wait ran out.
 */
export async function waitForCaptchaSolved(page: Page, options: Readonly<{
  timeoutMs?: number; signal?: AbortSignal; permittedPassiveFrameUrls?: () => readonly string[];
}> = {}): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? CAPTCHA_SOLVE_TIMEOUT_MS);
  let lastTick = 0;
  while (true) {
    if (options.signal?.aborted) throw new Error("AGENTS_FILL_CANCELLED");
    if (!await captchaPending(page, options.permittedPassiveFrameUrls?.() ?? [])) return true;
    if (Date.now() >= deadline) return false;
    if (Date.now() - lastTick >= 5_000) { lastTick = Date.now(); await tickCaptchaCheckbox(page); }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** hCaptcha's own widget/challenge document. Visibility of its iframe decides whether it presents a challenge. */
export function isHcaptchaFrameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://newassets.hcaptcha.com" && /^\/captcha\/v1\/[A-Za-z0-9._-]{1,80}\/static\/hcaptcha(?:-enclave)?\.html$/u.test(url.pathname);
  } catch { return false; }
}

/**
 * True when this same-origin frame shows a CAPTCHA that needs a person: a
 * visible challenge frame or widget of non-trivial size, or visible text that
 * prompts for verification. Hidden, zero-size or off-page elements (the
 * invisible widget and its idle challenge frame) are passive.
 */
export async function frameShowsCaptchaChallenge(frame: Frame, permittedPassiveFrameUrls: readonly string[] = []): Promise<boolean> {
  return frame.evaluate((permittedPassiveFrameUrls) => {
    const presenting = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) < 0.1) return false;
      }
      const box = element.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) return false;
      const width = Math.max(document.documentElement.scrollWidth, innerWidth);
      const height = Math.max(document.documentElement.scrollHeight, innerHeight);
      return box.right + scrollX > 0 && box.bottom + scrollY > 0 && box.left + scrollX < width && box.top + scrollY < height;
    };
    const captchaFrames = [...document.querySelectorAll("iframe")].filter((element) => /captcha|turnstile|challenges\.cloudflare/iu.test(element.src));
    if (captchaFrames.filter((element) => !permittedPassiveFrameUrls.includes(element.src)).some(presenting)) return true;
    // A widget container (any provider) that renders a visible checkbox or challenge.
    if ([...document.querySelectorAll("[data-sitekey]")].some(presenting)) return true;
    const prompt = /\b(?:(?:please )?complete (?:the )?h?captcha|h?captcha (?:is required|required|failed|expired|error)|invalid h?captcha|verify (?:that )?you(?:'re| are) (?:a )?human|prove (?:that )?you(?:'re| are) (?:a )?human|i am human|i'?m not a robot|select all (?:the )?(?:images|squares))\b/iu;
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(parent.tagName) || !prompt.test(node.textContent ?? "")) continue;
      let visible = true;
      for (let element: Element | null = parent; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.1) { visible = false; break; }
      }
      const box = parent.getBoundingClientRect();
      if (visible && box.width > 0 && box.height > 0) return true;
    }
    return false;
  }, permittedPassiveFrameUrls);
}

/** Any same-origin frame of the page shows a challenge. Cross-origin frames are checked through their iframe element. */
export async function pageShowsCaptchaChallenge(page: Page, permittedPassiveFrameUrls: readonly string[] = []): Promise<boolean> {
  const origin = new URL(page.url()).origin;
  for (const frame of page.frames()) {
    const frameUrl = frame.url();
    if (!frameUrl) continue;
    let frameOrigin: string;
    try { frameOrigin = new URL(frameUrl).origin; } catch { continue; }
    if (frameUrl !== "about:blank" && frameOrigin !== origin) continue;
    if (await frameShowsCaptchaChallenge(frame, permittedPassiveFrameUrls).catch(() => false)) return true;
  }
  return false;
}
