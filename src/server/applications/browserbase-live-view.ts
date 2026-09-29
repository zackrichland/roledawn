import type { CandidateLiveViewProvider } from "./live-view.ts";
import { isBrowserbaseLiveViewUrl } from "./live-view.ts";

type BrowserbaseLiveViewSession = Readonly<{
  id: string;
  status: "PENDING" | "RUNNING" | "ERROR" | "TIMED_OUT" | "COMPLETED";
  expiresAt: string;
}>;

export interface BrowserbaseLiveViewClient {
  retrieveSession(providerSessionRef: string): Promise<BrowserbaseLiveViewSession>;
  debugSession(providerSessionRef: string): Promise<Readonly<{
    debuggerFullscreenUrl: string;
  }>>;
}

function validProviderReference(value: string): boolean {
  return value.trim().length > 0 && value.length <= 512 && !/[\r\n]/u.test(value);
}

export function createBrowserbaseLiveViewProvider(
  client: BrowserbaseLiveViewClient,
  now: () => number = Date.now,
): CandidateLiveViewProvider {
  return Object.freeze({
    async issueLiveView(providerSessionRef: string) {
      if (!validProviderReference(providerSessionRef)) {
        throw new Error("BROWSERBASE_LIVE_VIEW_SESSION_REFERENCE_INVALID");
      }
      const session = await client.retrieveSession(providerSessionRef);
      if (
        session.id !== providerSessionRef ||
        (session.status !== "PENDING" && session.status !== "RUNNING") ||
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= now()
      ) {
        throw new Error("BROWSERBASE_LIVE_VIEW_SESSION_NOT_ACTIVE");
      }
      const debug = await client.debugSession(providerSessionRef);
      if (!isBrowserbaseLiveViewUrl(debug.debuggerFullscreenUrl)) {
        throw new Error("BROWSERBASE_LIVE_VIEW_URL_INVALID");
      }
      return Object.freeze({
        url: debug.debuggerFullscreenUrl,
        providerExpiresAt: session.expiresAt,
      });
    },
  });
}
