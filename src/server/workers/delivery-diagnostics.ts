/**
 * Stop diagnostics for one send (D-149). When a send stops, the worker records
 * where it stopped and what the browser saw, so the cause can be read in one
 * command (`npm run ops:why`) instead of guessed.
 *
 * Only shapes are kept: scheme/origin and a bounded path, never a query
 * string, fragment, form value, answer, document or response body. Counts are
 * capped. Nothing here changes what the guard admits or what the send does.
 */
import type { Page } from "playwright-core";

const PATH_LIMIT = 60;
const KEY_LIMIT = 16;

/** Origin and the start of the path; other schemes keep only the scheme. */
export function describeUrl(value: string): string {
  if (!value) return "(empty)";
  let url: URL;
  try { url = new URL(value); } catch { return "(malformed)"; }
  if (url.protocol === "http:" || url.protocol === "https:") return `${url.origin}${url.pathname.slice(0, PATH_LIMIT)}`;
  // chrome-error://chromewebdata/ is Chrome's own error page; about:blank / about:srcdoc are local documents.
  if (url.protocol === "chrome-error:" || url.protocol === "about:") return value.slice(0, 40);
  return url.protocol;
}

function bump(map: Map<string, number>, key: string) {
  if (map.size < KEY_LIMIT || map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
  else map.set("(other)", (map.get("(other)") ?? 0) + 1);
}

/** What the request guard refused, grouped by why, method, type and destination. */
export function createBlockedRequestLedger() {
  const blocked = new Map<string, number>();
  let total = 0;
  return Object.freeze({
    record(request: Readonly<{ method(): string; resourceType(): string; url(): string }>, reason: string) {
      total += 1;
      let key = reason;
      try { key = `${reason} ${request.method()} ${request.resourceType()} ${describeUrl(request.url())}`; } catch { /* keep the reason */ }
      bump(blocked, key.slice(0, 160));
    },
    summary: () => ({ blockedTotal: total, blocked: Object.fromEntries(blocked) }),
  });
}

/** Browserbase's solver writes these exact console messages into the page it works on. */
export const SOLVER_CONSOLE_EVENTS = Object.freeze({ started: "browserbase-solving-started", finished: "browserbase-solving-finished" });

/** Counts only Browserbase's two fixed solver messages; other console text is never read or kept. */
export function watchCaptchaSolver(page: Pick<Page, "on" | "off">) {
  const counts = { started: 0, finished: 0 };
  const listener = (message: { text(): string }) => {
    let text = "";
    try { text = message.text(); } catch { return; }
    if (text === SOLVER_CONSOLE_EVENTS.started) counts.started += 1;
    else if (text === SOLVER_CONSOLE_EVENTS.finished) counts.finished += 1;
  };
  page.on("console", listener);
  return Object.freeze({
    counts: () => ({ ...counts }),
    stop: () => { page.off("console", listener); },
  });
}

/** Every frame on the page, described by origin and path only. */
export function describeFrames(page: Pick<Page, "frames" | "url">): Readonly<Record<string, number>> {
  const frames = new Map<string, number>();
  try { for (const frame of page.frames()) bump(frames, describeUrl(frame.url())); } catch { /* a closed page has no frames to describe */ }
  return Object.fromEntries(frames);
}

/**
 * Fits a diagnostic object within the worker-event byte budget by shrinking
 * the largest nested records first; plain values are always kept.
 */
export function boundDiagnostics(detail: Readonly<Record<string, unknown>>, maxBytes = 3_400): Record<string, unknown> {
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  const result: Record<string, unknown> = { ...detail };
  for (let guard = 0; size(result) > maxBytes && guard < 40; guard += 1) {
    const largest = Object.entries(result)
      .filter(([, value]) => value !== null && typeof value === "object" && Object.keys(value as object).length > 0)
      .sort(([, left], [, right]) => size(right) - size(left))[0];
    if (!largest) break;
    const [key, value] = largest;
    const entries = Object.entries(value as Record<string, unknown>);
    result[key] = Object.fromEntries(entries.slice(0, Math.max(0, Math.floor(entries.length / 2))));
    result.truncated = true;
  }
  if (size(result) > maxBytes) {
    const plain = Object.entries(result).filter(([, value]) => value === null || typeof value !== "object").slice(0, 24)
      .map(([key, value]) => [key.slice(0, 60), typeof value === "string" ? value.slice(0, 120) : value]);
    return { ...Object.fromEntries(plain), truncated: true };
  }
  return result;
}
