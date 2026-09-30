import type { Frame, Page } from "playwright-core";

/**
 * Passive CAPTCHA handling. RoleDawn never solves, clicks, or otherwise
 * interacts with a CAPTCHA. For a site whose invisible hCaptcha only scores the
 * browser on submit (Lever), work may continue while nothing asks the person
 * to do anything; any visible challenge, checkbox widget or prompt hands the
 * application to the candidate.
 */
export const APPLICATION_FILL_CAPTCHA_TAKEOVER = "APPLICATION_FILL_CAPTCHA_TAKEOVER";

/** hCaptcha's own widget/challenge document. Visibility of its iframe decides whether it presents a challenge. */
export function isHcaptchaFrameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://newassets.hcaptcha.com" && /^\/captcha\/v1\/[A-Za-z0-9._-]{1,80}\/static\/hcaptcha\.html$/u.test(url.pathname);
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
    if (frame.url() !== "about:blank" && new URL(frame.url()).origin !== origin) continue;
    if (await frameShowsCaptchaChallenge(frame, permittedPassiveFrameUrls).catch(() => false)) return true;
  }
  return false;
}
