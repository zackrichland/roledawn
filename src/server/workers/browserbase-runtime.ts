import type {
  Browser,
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
  WebSocketRoute,
} from "playwright-core";

import type {
  ComputerRuntimeAdapter,
  ComputerRuntimeProvisionRequest,
  ComputerRuntimeUsage,
  ProvisionedComputerRuntime,
} from "./application-fill.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIVE_SESSION_STATUSES = new Set(["PENDING", "RUNNING"] as const);
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const INITIAL_STATIC_RESOURCE_TYPES = new Set(["stylesheet", "script", "image", "font"]);
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 30 * 60;
const DEFAULT_API_TIMEOUT_MS = 20_000;
// Netlify functions run in the US East; a browser in the same region saves a
// cross-country round trip on every CDP command (D-149). BROWSERBASE_REGION overrides.
const DEFAULT_REGION = "us-east-1" as const;
const DEFAULT_RELEASE_POLL_INTERVAL_MS = 250;
const DEFAULT_RELEASE_POLL_ATTEMPTS = 40;

export const BROWSERBASE_RUNTIME_ADAPTER_RELEASE = "browserbase-playwright-cdp/2";
export const BROWSERBASE_RUNTIME_METADATA_RELEASE = "browserbase-playwright-cdp-2";

export type BrowserbaseRegion =
  | "us-west-2"
  | "us-east-1"
  | "eu-central-1"
  | "ap-southeast-1";

export type BrowserbaseRuntimeEnvironment = Readonly<{
  enabled: true;
  apiKey: string;
  region: BrowserbaseRegion;
  apiTimeoutMs: number;
}>;

export type BrowserbaseSessionStatus =
  | "PENDING"
  | "RUNNING"
  | "ERROR"
  | "TIMED_OUT"
  | "COMPLETED";

export type BrowserbaseSessionRecord = Readonly<{
  id: string;
  projectId: string;
  status: BrowserbaseSessionStatus;
  createdAt: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  contextId: string | null;
  connectUrl: string | null;
  userMetadata: Readonly<Record<string, unknown>>;
}>;

export type BrowserbaseSessionCreateInput = Readonly<{
  region: BrowserbaseRegion;
  ttlSeconds: number;
  keepAlive: false;
  allowedDomains: readonly string[];
  solveCaptchas: false;
  recordSession: false;
  logSession: false;
  ignoreCertificateErrors: false;
  context: Readonly<{ id: string; persist: true }> | null;
  userMetadata: Readonly<{
    roledawn_computer_session_id: string;
    roledawn_authority: "fill-only-no-submit";
    roledawn_adapter_release: typeof BROWSERBASE_RUNTIME_METADATA_RELEASE;
  }>;
}>;

/** Provider calls are kept behind this narrow seam so unit tests never need credentials. */
export interface BrowserbaseSessionService {
  create(input: BrowserbaseSessionCreateInput): Promise<BrowserbaseSessionRecord>;
  listByComputerSessionId(computerSessionId: string): Promise<readonly BrowserbaseSessionRecord[]>;
  retrieve(sessionId: string): Promise<BrowserbaseSessionRecord>;
  release(sessionId: string): Promise<BrowserbaseSessionRecord>;
}

export interface BrowserbaseCdpConnector {
  connectOverCDP(connectUrl: string, timeoutMs: number): Promise<Browser>;
}

type RuntimeCounters = {
  blockedSubmissionAttemptCount: number;
  outboundSubmissionRequestCount: number;
  uploadedByteCount: number;
};

const BROWSERBASE_HANDLE = Symbol("roledawn.browserbase-runtime-handle");

type BrowserbaseRuntimeHandle = {
  readonly [BROWSERBASE_HANDLE]: true;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly providerSessionId: string;
  readonly providerContextId: string | null;
  readonly exactAllowedOrigin: string;
  readonly startedAtMs: number;
  readonly ttlSeconds: number;
  readonly counters: RuntimeCounters;
  destroyedUsage: ComputerRuntimeUsage | null;
};

export type BrowserbaseRuntimeAdapterDependencies = Readonly<{
  sessionService: BrowserbaseSessionService;
  cdpConnector: BrowserbaseCdpConnector;
  projectId: string;
  region: BrowserbaseRegion;
  connectTimeoutMs?: number;
  releasePollIntervalMs?: number;
  releasePollAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}>;

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = environment[key]?.trim();
  if (!value || value.length > 512 || /[\r\n]/u.test(value)) {
    throw new Error(`${key}_INVALID`);
  }
  return value;
}

/**
 * Parse credentials only in a server composition root. The additional enable
 * flag prevents an installed secret from silently turning on employer-facing
 * browser execution.
 */
export function parseBrowserbaseRuntimeEnvironment(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): BrowserbaseRuntimeEnvironment {
  if (environment.ROLEDAWN_BROWSERBASE_ENABLED !== "true") {
    throw new Error("BROWSERBASE_RUNTIME_DISABLED");
  }
  const apiKey = requiredEnvironmentValue(environment, "BROWSERBASE_API_KEY");
  const regionValue = environment.BROWSERBASE_REGION?.trim() || DEFAULT_REGION;
  if (
    regionValue !== "us-west-2" && regionValue !== "us-east-1" &&
    regionValue !== "eu-central-1" && regionValue !== "ap-southeast-1"
  ) throw new Error("BROWSERBASE_REGION_INVALID");
  const timeoutValue = environment.BROWSERBASE_API_TIMEOUT_MS?.trim();
  const apiTimeoutMs = timeoutValue === undefined || timeoutValue === ""
    ? DEFAULT_API_TIMEOUT_MS
    : Number(timeoutValue);
  if (!Number.isSafeInteger(apiTimeoutMs) || apiTimeoutMs < 1_000 || apiTimeoutMs > 60_000) {
    throw new Error("BROWSERBASE_API_TIMEOUT_INVALID");
  }
  return Object.freeze({
    enabled: true as const,
    apiKey,
    region: regionValue,
    apiTimeoutMs,
  });
}

export function resolveBrowserbaseProjectId(
  projects: readonly Readonly<{ id: string }>[],
  /** BROWSERBASE_PROJECT_ID: names the delivery project when the key can see several (D-149). */
  preferred?: string | null,
): string {
  const named = preferred?.trim();
  if (named) {
    assertProviderReference(named, "BROWSERBASE_PROJECT_SCOPE_INVALID");
    if (!projects.some((project) => project.id === named)) throw new Error("BROWSERBASE_PROJECT_SCOPE_INVALID");
    return named;
  }
  if (projects.length !== 1 || !projects[0]) {
    throw new Error("BROWSERBASE_PROJECT_SCOPE_INVALID");
  }
  assertProviderReference(projects[0].id, "BROWSERBASE_PROJECT_SCOPE_INVALID");
  return projects[0].id;
}

function assertProviderReference(value: string, label: string): void {
  if (value.trim().length === 0 || value.length > 512 || /[\r\n]/u.test(value)) {
    throw new Error(label);
  }
}

function parseIsoMs(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(label);
  return result;
}

function assertProvisionRequest(request: ComputerRuntimeProvisionRequest): Readonly<{
  exactOrigin: string;
  allowedDomain: string;
  contextId: string | null;
}> {
  if (
    !UUID_PATTERN.test(request.idempotencyKey) ||
    request.idempotencyKey !== request.binding.computerSessionId
  ) throw new Error("BROWSERBASE_IDEMPOTENCY_KEY_INVALID");
  if (
    request.submissionGuard.submitAuthorized !== false ||
    request.submissionGuard.outboundSubmissionRequests !== "BLOCK"
  ) throw new Error("BROWSERBASE_SUBMISSION_GUARD_INVALID");
  if (
    !Number.isSafeInteger(request.ttlSeconds) ||
    request.ttlSeconds < MIN_TTL_SECONDS ||
    request.ttlSeconds > MAX_TTL_SECONDS
  ) throw new Error("BROWSERBASE_TTL_INVALID");
  if (request.allowedOrigins.length !== 1) {
    throw new Error("BROWSERBASE_ALLOWED_ORIGIN_SET_INVALID");
  }

  let destination: URL;
  let allowed: URL;
  try {
    destination = new URL(request.startUrl);
    allowed = new URL(request.allowedOrigins[0] ?? "");
  } catch {
    throw new Error("BROWSERBASE_DESTINATION_INVALID");
  }
  if (
    destination.protocol !== "https:" || destination.username || destination.password ||
    allowed.protocol !== "https:" || allowed.username || allowed.password ||
    allowed.origin !== request.allowedOrigins[0] || destination.origin !== allowed.origin
  ) throw new Error("BROWSERBASE_DESTINATION_INVALID");

  const contextId: string | null = null;
  if (request.executionMode === "EPHEMERAL_CLEAN") {
    if (request.browserProfileRef !== null) throw new Error("BROWSERBASE_CONTEXT_MODE_INVALID");
  } else if (request.executionMode === "EPHEMERAL_WITH_PERSISTENT_CONTEXT") {
    // browserProfileRef is an internal database ID, not a Browserbase context
    // ID. Persistent sessions remain fail-closed until the profile record has
    // a separately provisioned, provider-owned context reference.
    throw new Error("BROWSERBASE_PERSISTENT_CONTEXT_UNMAPPED");
  } else {
    throw new Error("BROWSERBASE_EXECUTION_MODE_INVALID");
  }

  return Object.freeze({
    exactOrigin: allowed.origin,
    allowedDomain: allowed.hostname,
    contextId,
  });
}

function metadataComputerSessionId(record: BrowserbaseSessionRecord): string | null {
  const value = record.userMetadata.roledawn_computer_session_id;
  return typeof value === "string" ? value : null;
}

function assertSessionBinding(
  record: BrowserbaseSessionRecord,
  request: ComputerRuntimeProvisionRequest,
  projectId: string,
  expectedContextId: string | null,
): void {
  assertProviderReference(record.id, "BROWSERBASE_SESSION_REFERENCE_INVALID");
  if (
    record.projectId !== projectId ||
    metadataComputerSessionId(record) !== request.idempotencyKey ||
    record.userMetadata.roledawn_authority !== "fill-only-no-submit" ||
    record.userMetadata.roledawn_adapter_release !== BROWSERBASE_RUNTIME_METADATA_RELEASE ||
    record.contextId !== expectedContextId
  ) throw new Error("BROWSERBASE_SESSION_BINDING_MISMATCH");
  parseIsoMs(record.createdAt, "BROWSERBASE_SESSION_TIMESTAMP_INVALID");
  parseIsoMs(record.startedAt, "BROWSERBASE_SESSION_TIMESTAMP_INVALID");
  parseIsoMs(record.expiresAt, "BROWSERBASE_SESSION_TIMESTAMP_INVALID");
  if (record.endedAt !== null) parseIsoMs(record.endedAt, "BROWSERBASE_SESSION_TIMESTAMP_INVALID");
}

function isActiveSession(record: BrowserbaseSessionRecord): boolean {
  return ACTIVE_SESSION_STATUSES.has(record.status as "PENDING" | "RUNNING");
}

async function findSessionForKey(
  service: BrowserbaseSessionService,
  request: ComputerRuntimeProvisionRequest,
  projectId: string,
  expectedContextId: string | null,
): Promise<BrowserbaseSessionRecord | null> {
  const matches = await service.listByComputerSessionId(request.idempotencyKey);
  if (matches.length > 1) throw new Error("BROWSERBASE_IDEMPOTENCY_SESSION_DUPLICATED");
  const match = matches[0];
  if (!match) return null;
  assertSessionBinding(match, request, projectId, expectedContextId);
  if (!isActiveSession(match)) throw new Error("BROWSERBASE_IDEMPOTENCY_SESSION_TERMINAL");
  return match;
}

function requestWouldViolateGuard(
  request: PlaywrightRequest,
  exactAllowedOrigin: string,
  initialLoadComplete: boolean,
): Readonly<{ block: boolean; submissionAttempt: boolean }> {
  const method = request.method().toUpperCase();
  const unsafeMethod = !SAFE_HTTP_METHODS.has(method);
  let originMatches = false;
  try {
    const url = new URL(request.url());
    originMatches = (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === exactAllowedOrigin;
  } catch {
    originMatches = false;
  }
  const navigation = request.isNavigationRequest();
  const blockedNavigation = navigation && (initialLoadComplete || !originMatches);
  const initialCrossOriginStaticAsset = !initialLoadComplete && !navigation &&
    SAFE_HTTP_METHODS.has(method) && INITIAL_STATIC_RESOURCE_TYPES.has(request.resourceType());
  const blockedCrossOriginSubresource = !navigation && !originMatches &&
    !initialCrossOriginStaticAsset;
  // Candidate data may enter the DOM after the initial load. Freeze every
  // subsequent HTTP request so scripts cannot disclose it before the separate
  // Submit authority is granted.
  const postDisclosureNetworkRequest = initialLoadComplete;
  return Object.freeze({
    block: unsafeMethod || blockedNavigation || blockedCrossOriginSubresource ||
      postDisclosureNetworkRequest,
    submissionAttempt: unsafeMethod || blockedNavigation || postDisclosureNetworkRequest,
  });
}

async function blockWebSocket(
  route: WebSocketRoute,
  counters: RuntimeCounters,
): Promise<void> {
  counters.blockedSubmissionAttemptCount += 1;
  // A routed WebSocket does not reach the server unless connectToServer() is
  // called. Close the page-side mock as well so callers fail immediately.
  await route.close({ code: 1008, reason: "RoleDawn fill-only network freeze" });
}

async function installDomSubmissionInterlock(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const globalState = globalThis as typeof globalThis & {
      __roledawnBlockedSubmitAttempts?: number;
      __roledawnSubmissionInterlockInstalled?: boolean;
      __roledawnServiceWorkerInterlockInstalled?: boolean;
    };
    if (globalState.__roledawnSubmissionInterlockInstalled) return;
    globalState.__roledawnSubmissionInterlockInstalled = true;
    globalState.__roledawnBlockedSubmitAttempts = 0;
    globalState.__roledawnServiceWorkerInterlockInstalled =
      !("serviceWorker" in navigator);
    if ("serviceWorker" in navigator) {
      const blockedRegister: ServiceWorkerContainer["register"] = () => Promise.reject(
        new DOMException("RoleDawn fill-only network freeze", "NotAllowedError"),
      );
      try {
        Object.defineProperty(navigator.serviceWorker, "register", {
          configurable: false,
          writable: false,
          value: blockedRegister,
        });
        globalState.__roledawnServiceWorkerInterlockInstalled = true;
      } catch {
        globalState.__roledawnServiceWorkerInterlockInstalled = false;
      }
    }
    const block = (event?: Event) => {
      event?.preventDefault();
      event?.stopImmediatePropagation();
      globalState.__roledawnBlockedSubmitAttempts =
        (globalState.__roledawnBlockedSubmitAttempts ?? 0) + 1;
      return false;
    };
    globalThis.addEventListener("submit", block, true);
    const nativeSubmit = HTMLFormElement.prototype.submit;
    const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    Object.defineProperty(HTMLFormElement.prototype, "submit", {
      configurable: false,
      writable: false,
      value: function blockedSubmit(this: HTMLFormElement) {
        void nativeSubmit;
        return block();
      },
    });
    Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
      configurable: false,
      writable: false,
      value: function blockedRequestSubmit(this: HTMLFormElement) {
        void nativeRequestSubmit;
        return block();
      },
    });
    const disableSubmitControls = () => {
      for (const control of document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement
      >('button[type="submit"], input[type="submit"], input[type="image"]')) {
        control.disabled = true;
        control.setAttribute("aria-disabled", "true");
        control.setAttribute("data-roledawn-submit-blocked", "true");
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", disableSubmitControls, { once: true });
    } else {
      disableSubmitControls();
    }
    new MutationObserver(disableSubmitControls).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type"],
    });
  });
}

async function connectGuardedRuntime(
  dependencies: Required<Pick<BrowserbaseRuntimeAdapterDependencies, "projectId" | "region">> &
    BrowserbaseRuntimeAdapterDependencies,
  request: ComputerRuntimeProvisionRequest,
  sessionRecord: BrowserbaseSessionRecord,
  expectedContextId: string | null,
  exactAllowedOrigin: string,
  now: () => number,
): Promise<ProvisionedComputerRuntime> {
  const completeRecord = sessionRecord.connectUrl === null
    ? await dependencies.sessionService.retrieve(sessionRecord.id)
    : sessionRecord;
  assertSessionBinding(completeRecord, request, dependencies.projectId, expectedContextId);
  if (!isActiveSession(completeRecord) || !completeRecord.connectUrl) {
    throw new Error("BROWSERBASE_SESSION_NOT_CONNECTABLE");
  }
  let connection: URL;
  try {
    connection = new URL(completeRecord.connectUrl);
  } catch {
    throw new Error("BROWSERBASE_CONNECT_URL_INVALID");
  }
  if (connection.protocol !== "wss:" && connection.protocol !== "https:") {
    throw new Error("BROWSERBASE_CONNECT_URL_INVALID");
  }

  const browser = await dependencies.cdpConnector.connectOverCDP(
    completeRecord.connectUrl,
    dependencies.connectTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  );
  try {
    const contexts = browser.contexts();
    if (contexts.length !== 1 || !contexts[0]) {
      throw new Error("BROWSERBASE_DEFAULT_CONTEXT_MISSING");
    }
    const context = contexts[0];
    await installDomSubmissionInterlock(context);
    const counters: RuntimeCounters = {
      blockedSubmissionAttemptCount: 0,
      outboundSubmissionRequestCount: 0,
      uploadedByteCount: 0,
    };
    const guardAllowedRequests = new WeakSet<PlaywrightRequest>();
    const guardAbortedRequests = new WeakSet<PlaywrightRequest>();
    let initialLoadComplete = false;
    // During the initial, pre-disclosure page load only, permit safe static
    // assets from ATS CDNs. Fetch/XHR/websocket traffic, unsafe methods, and
    // cross-origin navigations remain blocked. Once the DOM is loaded, every
    // network request is blocked before candidate values are filled.
    await context.route("**/*", async (route) => {
      const decision = requestWouldViolateGuard(
        route.request(),
        exactAllowedOrigin,
        initialLoadComplete,
      );
      if (!decision.block) {
        guardAllowedRequests.add(route.request());
        await route.continue();
        return;
      }
      if (decision.submissionAttempt) counters.blockedSubmissionAttemptCount += 1;
      guardAbortedRequests.add(route.request());
      await route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", (route) => blockWebSocket(route, counters));
    context.on("requestfinished", (finishedRequest) => {
      if (guardAllowedRequests.has(finishedRequest)) return;
      const decision = requestWouldViolateGuard(
        finishedRequest,
        exactAllowedOrigin,
        initialLoadComplete,
      );
      if (decision.block) counters.outboundSubmissionRequestCount += 1;
    });
    context.on("requestfailed", (failedRequest) => {
      if (
        guardAllowedRequests.has(failedRequest) ||
        guardAbortedRequests.has(failedRequest)
      ) return;
      const decision = requestWouldViolateGuard(
        failedRequest,
        exactAllowedOrigin,
        initialLoadComplete,
      );
      if (decision.block) counters.outboundSubmissionRequestCount += 1;
    });
    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    await page.goto(request.startUrl, { waitUntil: "domcontentloaded" });
    let finalUrl: URL;
    try {
      finalUrl = new URL(page.url());
    } catch {
      throw new Error("BROWSERBASE_DESTINATION_NAVIGATION_INVALID");
    }
    if (finalUrl.origin !== exactAllowedOrigin) {
      throw new Error("BROWSERBASE_DESTINATION_NAVIGATION_INVALID");
    }
    const serviceWorkerInterlockInstalled = await page.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __roledawnServiceWorkerInterlockInstalled?: boolean;
      };
      return state.__roledawnServiceWorkerInterlockInstalled === true;
    });
    if (!serviceWorkerInterlockInstalled || context.serviceWorkers().length !== 0) {
      throw new Error("BROWSERBASE_SERVICE_WORKER_INTERLOCK_INVALID");
    }
    initialLoadComplete = true;
    const handle: BrowserbaseRuntimeHandle = {
      [BROWSERBASE_HANDLE]: true,
      browser,
      context,
      page,
      providerSessionId: completeRecord.id,
      providerContextId: completeRecord.contextId,
      exactAllowedOrigin,
      startedAtMs: now(),
      ttlSeconds: request.ttlSeconds,
      counters,
      destroyedUsage: null,
    };
    return Object.freeze({
      handle,
      providerAdapter: "browserbase",
      providerSessionRef: completeRecord.id,
      providerContextRef: completeRecord.contextId,
    });
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

function requireBrowserbaseRuntimeHandle(value: unknown): BrowserbaseRuntimeHandle {
  if (
    typeof value !== "object" || value === null ||
    (value as Partial<BrowserbaseRuntimeHandle>)[BROWSERBASE_HANDLE] !== true
  ) throw new Error("BROWSERBASE_RUNTIME_HANDLE_INVALID");
  return value as BrowserbaseRuntimeHandle;
}

export function browserbaseRuntimePage(value: unknown): Page {
  const handle = requireBrowserbaseRuntimeHandle(value);
  if (handle.destroyedUsage !== null) throw new Error("BROWSERBASE_RUNTIME_DESTROYED");
  return handle.page;
}

export function recordBrowserbaseRuntimeUpload(value: unknown, byteCount: number): void {
  const handle = requireBrowserbaseRuntimeHandle(value);
  if (handle.destroyedUsage !== null) throw new Error("BROWSERBASE_RUNTIME_DESTROYED");
  if (!Number.isSafeInteger(byteCount) || byteCount < 0) {
    throw new Error("BROWSERBASE_UPLOAD_BYTE_COUNT_INVALID");
  }
  handle.counters.uploadedByteCount += byteCount;
}

async function readDomBlockedSubmitCount(context: BrowserContext): Promise<number> {
  let total = 0;
  for (const page of context.pages()) {
    try {
      const count = await page.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __roledawnBlockedSubmitAttempts?: number;
        };
        return state.__roledawnBlockedSubmitAttempts ?? 0;
      });
      if (Number.isSafeInteger(count) && count >= 0) total += count;
    } catch {
      // A page may close itself. The independent network counter remains live.
    }
  }
  return total;
}

export function createBrowserbaseRuntimeAdapter(
  dependencies: BrowserbaseRuntimeAdapterDependencies,
): ComputerRuntimeAdapter {
  assertProviderReference(dependencies.projectId, "BROWSERBASE_PROJECT_ID_INVALID");
  const connectTimeoutMs = dependencies.connectTimeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  if (!Number.isSafeInteger(connectTimeoutMs) || connectTimeoutMs < 1_000 || connectTimeoutMs > 60_000) {
    throw new Error("BROWSERBASE_CONNECT_TIMEOUT_INVALID");
  }
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const releasePollIntervalMs = dependencies.releasePollIntervalMs ??
    DEFAULT_RELEASE_POLL_INTERVAL_MS;
  const releasePollAttempts = dependencies.releasePollAttempts ??
    DEFAULT_RELEASE_POLL_ATTEMPTS;
  if (
    !Number.isSafeInteger(releasePollIntervalMs) || releasePollIntervalMs < 25 ||
    releasePollIntervalMs > 5_000 || !Number.isSafeInteger(releasePollAttempts) ||
    releasePollAttempts < 1 || releasePollAttempts > 240
  ) throw new Error("BROWSERBASE_RELEASE_POLL_CONFIG_INVALID");

  async function releaseProviderSession(sessionId: string): Promise<BrowserbaseSessionRecord> {
    let record: BrowserbaseSessionRecord;
    try {
      record = await dependencies.sessionService.release(sessionId);
    } catch (releaseError) {
      // A timed-out release may still have completed at the provider. Reconcile
      // once before reporting teardown uncertainty; never replay the mutation.
      const reconciled = await dependencies.sessionService.retrieve(sessionId);
      if (isActiveSession(reconciled)) throw releaseError;
      record = reconciled;
    }
    for (let attempt = 0; isActiveSession(record); attempt += 1) {
      if (attempt >= releasePollAttempts) {
        throw new Error("BROWSERBASE_SESSION_RELEASE_TIMEOUT");
      }
      await sleep(releasePollIntervalMs);
      record = await dependencies.sessionService.retrieve(sessionId);
    }
    if (record.id !== sessionId || record.projectId !== dependencies.projectId) {
      throw new Error("BROWSERBASE_SESSION_RELEASE_BINDING_MISMATCH");
    }
    return record;
  }

  async function provisionInternal(
    request: ComputerRuntimeProvisionRequest,
    recoveryOnly: boolean,
  ): Promise<ProvisionedComputerRuntime> {
    const policy = assertProvisionRequest(request);
    const existing = await findSessionForKey(
      dependencies.sessionService,
      request,
      dependencies.projectId,
      policy.contextId,
    );
    if (recoveryOnly && !existing) throw new Error("BROWSERBASE_RECOVERY_SESSION_NOT_FOUND");
    let session = existing;
    if (!session) {
      session = await dependencies.sessionService.create(Object.freeze({
        region: dependencies.region,
        ttlSeconds: request.ttlSeconds,
        keepAlive: false as const,
        allowedDomains: Object.freeze([policy.allowedDomain]),
        solveCaptchas: false as const,
        recordSession: false as const,
        logSession: false as const,
        ignoreCertificateErrors: false as const,
        context: policy.contextId === null
          ? null
          : Object.freeze({ id: policy.contextId, persist: true as const }),
        userMetadata: Object.freeze({
          roledawn_computer_session_id: request.idempotencyKey,
          roledawn_authority: "fill-only-no-submit" as const,
          roledawn_adapter_release: BROWSERBASE_RUNTIME_METADATA_RELEASE,
        }),
      }));
    }
    assertSessionBinding(session, request, dependencies.projectId, policy.contextId);
    if (!isActiveSession(session)) throw new Error("BROWSERBASE_SESSION_NOT_CONNECTABLE");
    try {
      return await connectGuardedRuntime(
        { ...dependencies, connectTimeoutMs },
        request,
        session,
        policy.contextId,
        policy.exactOrigin,
        now,
      );
    } catch (provisionError) {
      try {
        await releaseProviderSession(session.id);
      } catch (releaseError) {
        throw new AggregateError(
          [provisionError, releaseError],
          "BROWSERBASE_PROVISION_CLEANUP_FAILED",
        );
      }
      throw provisionError;
    }
  }

  return Object.freeze({
    adapterRelease: BROWSERBASE_RUNTIME_ADAPTER_RELEASE,
    provision(request: ComputerRuntimeProvisionRequest) {
      return provisionInternal(request, false);
    },
    recoverProvisioning(request: ComputerRuntimeProvisionRequest) {
      return provisionInternal(request, true);
    },
    async destroy(runtime: ProvisionedComputerRuntime) {
      const handle = requireBrowserbaseRuntimeHandle(runtime.handle);
      if (
        runtime.providerAdapter !== "browserbase" ||
        runtime.providerSessionRef !== handle.providerSessionId ||
        runtime.providerContextRef !== handle.providerContextId
      ) throw new Error("BROWSERBASE_RUNTIME_BINDING_MISMATCH");
      if (handle.destroyedUsage) return handle.destroyedUsage;
      const domBlocked = await readDomBlockedSubmitCount(handle.context);
      let finalSession: BrowserbaseSessionRecord;
      try {
        finalSession = await releaseProviderSession(handle.providerSessionId);
      } finally {
        // Release is the provider cost boundary; closing CDP is the local
        // resource boundary. Always attempt both, even if provider state is
        // temporarily uncertain.
        await handle.browser.close().catch(() => undefined);
      }
      const wallClockMs = Math.max(0, Math.min(
        now() - handle.startedAtMs,
        handle.ttlSeconds * 1_000,
      ));
      assertProviderReference(finalSession.id, "BROWSERBASE_SESSION_REFERENCE_INVALID");
      const startedAtMs = parseIsoMs(finalSession.startedAt, "BROWSERBASE_SESSION_TIMESTAMP_INVALID");
      const endedAtMs = finalSession.endedAt === null
        ? now()
        : parseIsoMs(finalSession.endedAt, "BROWSERBASE_SESSION_TIMESTAMP_INVALID");
      const providerBilledMs = Math.max(0, Math.min(
        endedAtMs - startedAtMs,
        handle.ttlSeconds * 1_000,
      ));
      const usage = Object.freeze({
        wallClockMs,
        providerBilledMs,
        uploadedByteCount: handle.counters.uploadedByteCount,
        blockedSubmissionAttemptCount:
          handle.counters.blockedSubmissionAttemptCount + domBlocked,
        outboundSubmissionRequestCount: handle.counters.outboundSubmissionRequestCount,
      });
      handle.destroyedUsage = usage;
      return usage;
    },
  });
}
