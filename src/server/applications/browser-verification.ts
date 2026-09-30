import { isBrowserbaseLiveViewUrl } from "./live-view.ts";

export type BrowserCheck = Readonly<{ autopilotId: string; applicationId: string; expiresAt: string }>;
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

/** This RPC returns owned, non-secret metadata only. No provider reference. */
export async function readApplicationBrowserChecks(client: unknown, applicationId?: string): Promise<readonly BrowserCheck[]> {
  const result = await Promise.resolve().then(() => (client as RpcClient).rpc("read_application_browser_checks", applicationId ? { p_application_id: applicationId } : {})).catch(() => ({ data: null, error: true }));
  const { data, error } = result;
  if (error || !Array.isArray(data)) return [];
  return data.filter((row) => row && typeof row.autopilot_id === "string" && typeof row.application_id === "string" &&
    typeof row.expires_at === "string" && Date.parse(row.expires_at) > Date.now())
    .map((row) => ({ autopilotId: row.autopilot_id, applicationId: row.application_id, expiresAt: row.expires_at }));
}

/** Choose the exact candidate tab, never the provider's default blank page. */
export function applicationBrowserCheckUrl(pages: readonly Readonly<{ url: string; debuggerFullscreenUrl: string }>[], destinationUrl: string): string {
  const canonical = (value: string) => { const url = new URL(value); url.hash = ""; return url.href; };
  const expected = canonical(destinationUrl);
  const matches = pages.filter((page) => { try { return canonical(page.url) === expected; } catch { return false; } });
  if (matches.length !== 1 || !isBrowserbaseLiveViewUrl(matches[0].debuggerFullscreenUrl)) throw new Error("BROWSER_CHECK_TAB_UNAVAILABLE");
  const url = new URL(matches[0].debuggerFullscreenUrl); url.searchParams.set("navbar", "false");
  return url.href;
}

export function browserCheckHtml(url: string): string {
  if (!isBrowserbaseLiveViewUrl(url)) throw new Error("BROWSER_CHECK_URL_INVALID");
  const escaped = url.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application verification</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}</style><iframe title="Employer verification" src="${escaped}" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe></html>`;
}
