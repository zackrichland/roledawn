export const BROWSER_LIVE_VIEW_RELEASE = "candidate-browser-live-view/1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const ACTIVE_SESSION_STATES = new Set(["ACTIVE", "PAUSED_FOR_REVIEW"] as const);

export type CandidateLiveViewSession = Readonly<{
  computerSessionId: string;
  state: "ACTIVE" | "PAUSED_FOR_REVIEW";
  expiresAt: string;
}>;

export type ComputerSessionProviderBinding = Readonly<{
  providerAdapter: string;
  providerSessionRef: string;
}>;

export type CandidateLiveView = Readonly<{
  url: string;
  expiresAt: string;
}>;

export interface CandidateLiveViewSessionReader {
  findOwnedLiveSession(input: Readonly<{
    authUserId: string;
    applicationId: string;
    nowIso: string;
  }>): Promise<CandidateLiveViewSession | null>;
}

export interface ComputerSessionProviderBindingReader {
  findActiveBinding(computerSessionId: string): Promise<ComputerSessionProviderBinding | null>;
}

export interface CandidateLiveViewProvider {
  issueLiveView(providerSessionRef: string): Promise<Readonly<{
    url: string;
    providerExpiresAt: string;
  }>>;
}

export type CandidateLiveViewDependencies = Readonly<{
  sessions: CandidateLiveViewSessionReader;
  providerBindings: ComputerSessionProviderBindingReader;
  providers: Readonly<Record<string, CandidateLiveViewProvider | undefined>>;
  now?: () => number;
}>;

export type CandidateLiveViewErrorCode =
  | "LIVE_VIEW_REQUEST_INVALID"
  | "LIVE_VIEW_NOT_AVAILABLE"
  | "LIVE_VIEW_PROVIDER_UNSUPPORTED"
  | "LIVE_VIEW_PROVIDER_FAILED";

export class CandidateLiveViewError extends Error {
  readonly code: CandidateLiveViewErrorCode;

  constructor(code: CandidateLiveViewErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CandidateLiveViewError";
  }
}

function parseFutureTimestamp(value: string, nowMs: number): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > nowMs ? parsed : null;
}

export function isBrowserbaseLiveViewUrl(value: string): boolean {
  if (!value || value.length > 8_192 || /[\r\n]/u.test(value)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/u, "");
    return url.protocol === "https:" && !url.username && !url.password &&
      (hostname === "browserbase.com" || hostname.endsWith(".browserbase.com"));
  } catch {
    return false;
  }
}

/**
 * Resolves one candidate-owned live-view capability without exposing a provider
 * session ID. Ownership is established by the candidate-scoped reader before
 * the service-only provider binding is accessed.
 */
export async function issueCandidateApplicationLiveView(
  input: Readonly<{ authUserId: string; applicationId: string }>,
  dependencies: CandidateLiveViewDependencies,
): Promise<CandidateLiveView> {
  if (!UUID_PATTERN.test(input.authUserId) || !UUID_PATTERN.test(input.applicationId)) {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_REQUEST_INVALID",
      "The live browser request is invalid.",
    );
  }

  const nowMs = dependencies.now?.() ?? Date.now();
  const session = await dependencies.sessions.findOwnedLiveSession({
    authUserId: input.authUserId,
    applicationId: input.applicationId,
    nowIso: new Date(nowMs).toISOString(),
  });
  if (!session || !ACTIVE_SESSION_STATES.has(session.state)) {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_NOT_AVAILABLE",
      "The secure browser is no longer available.",
    );
  }
  const sessionExpiresAtMs = parseFutureTimestamp(session.expiresAt, nowMs);
  if (!sessionExpiresAtMs || !UUID_PATTERN.test(session.computerSessionId)) {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_NOT_AVAILABLE",
      "The secure browser is no longer available.",
    );
  }

  const binding = await dependencies.providerBindings.findActiveBinding(
    session.computerSessionId,
  );
  if (!binding) {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_NOT_AVAILABLE",
      "The secure browser is no longer available.",
    );
  }
  const provider = dependencies.providers[binding.providerAdapter];
  if (!provider) {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_PROVIDER_UNSUPPORTED",
      "This secure browser cannot be opened here yet.",
    );
  }

  let issued: Awaited<ReturnType<CandidateLiveViewProvider["issueLiveView"]>>;
  try {
    issued = await provider.issueLiveView(binding.providerSessionRef);
  } catch {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_PROVIDER_FAILED",
      "The secure browser could not be opened. Try again while the session is active.",
    );
  }
  const providerExpiresAtMs = parseFutureTimestamp(issued.providerExpiresAt, nowMs);
  if (!isBrowserbaseLiveViewUrl(issued.url) || !providerExpiresAtMs) {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_PROVIDER_FAILED",
      "The secure browser could not be opened. Try again while the session is active.",
    );
  }

  return Object.freeze({
    url: issued.url,
    expiresAt: new Date(Math.min(sessionExpiresAtMs, providerExpiresAtMs)).toISOString(),
  });
}
