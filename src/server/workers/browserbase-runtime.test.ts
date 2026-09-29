import assert from "node:assert/strict";
import test from "node:test";

import type {
  Browser,
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
  Route,
  WebSocketRoute,
} from "playwright-core";

import type { ComputerRuntimeProvisionRequest } from "./application-fill.ts";
import {
  BROWSERBASE_RUNTIME_ADAPTER_RELEASE,
  BROWSERBASE_RUNTIME_METADATA_RELEASE,
  createBrowserbaseRuntimeAdapter,
  parseBrowserbaseRuntimeEnvironment,
  recordBrowserbaseRuntimeUpload,
  resolveBrowserbaseProjectId,
  type BrowserbaseSessionCreateInput,
  type BrowserbaseSessionRecord,
  type BrowserbaseSessionService,
} from "./browserbase-runtime.ts";

const IDS = Object.freeze({
  workspace: "10000000-0000-4000-8000-000000000001",
  candidate: "20000000-0000-4000-8000-000000000002",
  application: "30000000-0000-4000-8000-000000000003",
  revision: "40000000-0000-4000-8000-000000000004",
  fill: "50000000-0000-4000-8000-000000000005",
  session: "60000000-0000-4000-8000-000000000006",
  context: "70000000-0000-4000-8000-000000000007",
});

function request(
  executionMode: ComputerRuntimeProvisionRequest["executionMode"] = "EPHEMERAL_CLEAN",
): ComputerRuntimeProvisionRequest {
  return Object.freeze({
    idempotencyKey: IDS.session,
    binding: Object.freeze({
      workspaceId: IDS.workspace,
      candidateId: IDS.candidate,
      applicationId: IDS.application,
      revisionId: IDS.revision,
      fillAttemptId: IDS.fill,
      computerSessionId: IDS.session,
    }),
    startUrl: "https://boards.example.test/jobs/123",
    allowedOrigins: Object.freeze(["https://boards.example.test"]),
    ttlSeconds: 900,
    executionMode,
    browserProfileRef: executionMode === "EPHEMERAL_CLEAN" ? null : IDS.context,
    artifactManifest: [],
    artifactPayloads: [],
    submissionGuard: Object.freeze({
      submitAuthorized: false as const,
      outboundSubmissionRequests: "BLOCK" as const,
    }),
  });
}

function session(
  status: BrowserbaseSessionRecord["status"] = "RUNNING",
  contextId: string | null = null,
): BrowserbaseSessionRecord {
  return Object.freeze({
    id: "provider-session-1",
    projectId: "project-123",
    status,
    createdAt: "2026-08-17T00:00:00.000Z",
    startedAt: "2026-08-17T00:00:00.000Z",
    expiresAt: "2026-08-17T00:15:00.000Z",
    endedAt: null,
    contextId,
    connectUrl: "wss://connect.example.test/session",
    userMetadata: Object.freeze({
      roledawn_computer_session_id: IDS.session,
      roledawn_authority: "fill-only-no-submit",
      roledawn_adapter_release: BROWSERBASE_RUNTIME_METADATA_RELEASE,
    }),
  });
}

class FakeSessionService implements BrowserbaseSessionService {
  readonly creates: BrowserbaseSessionCreateInput[] = [];
  readonly listed: string[] = [];
  readonly retrieved: string[] = [];
  readonly released: string[] = [];
  matches: BrowserbaseSessionRecord[] = [];

  async create(input: BrowserbaseSessionCreateInput): Promise<BrowserbaseSessionRecord> {
    this.creates.push(input);
    return session("RUNNING", input.context?.id ?? null);
  }

  async listByComputerSessionId(id: string): Promise<readonly BrowserbaseSessionRecord[]> {
    this.listed.push(id);
    return this.matches;
  }

  async retrieve(id: string): Promise<BrowserbaseSessionRecord> {
    this.retrieved.push(id);
    return this.matches[0] ?? session();
  }

  async release(id: string): Promise<BrowserbaseSessionRecord> {
    this.released.push(id);
    return Object.freeze({
      ...session("COMPLETED"),
      endedAt: "2026-08-17T00:00:05.000Z",
    });
  }
}

type FakeRouteHandler = (route: Route) => Promise<void>;
type FakeRequestLifecycleHandler = (request: PlaywrightRequest) => void;

class FakePage {
  currentUrl = "about:blank";
  gotoCalls: string[] = [];
  beforeGoto: (() => Promise<void>) | null = null;

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<null> {
    this.gotoCalls.push(url);
    await this.beforeGoto?.();
    this.currentUrl = url;
    return null;
  }

  async evaluate<Result>(pageFunction: () => Result): Promise<Result> {
    const source = pageFunction.toString();
    if (source.includes("__roledawnServiceWorkerInterlockInstalled")) {
      return true as Result;
    }
    return 0 as Result;
  }
}

class FakeContext {
  readonly page = new FakePage();
  routeHandler: FakeRouteHandler | null = null;
  requestFinishedHandler: FakeRequestLifecycleHandler | null = null;
  requestFailedHandler: FakeRequestLifecycleHandler | null = null;
  webSocketHandler: ((route: WebSocketRoute) => Promise<void> | void) | null = null;
  initScriptCount = 0;

  async addInitScript(): Promise<void> {
    this.initScriptCount += 1;
  }

  async route(_pattern: string, handler: FakeRouteHandler): Promise<void> {
    this.routeHandler = handler;
  }

  async routeWebSocket(
    _pattern: string,
    handler: (route: WebSocketRoute) => Promise<void> | void,
  ): Promise<void> {
    this.webSocketHandler = handler;
  }

  on(event: string, handler: FakeRequestLifecycleHandler): void {
    if (event === "requestfinished") this.requestFinishedHandler = handler;
    if (event === "requestfailed") this.requestFailedHandler = handler;
  }

  serviceWorkers(): never[] {
    return [];
  }

  pages(): Page[] {
    return [this.page as unknown as Page];
  }

  async newPage(): Promise<Page> {
    return this.page as unknown as Page;
  }
}

class FakeBrowser {
  readonly context = new FakeContext();
  closed = false;

  contexts(): BrowserContext[] {
    return [this.context as unknown as BrowserContext];
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeRequest(
  url: string,
  method: string,
  navigation = false,
  resourceType = navigation ? "document" : "fetch",
): PlaywrightRequest {
  return {
    url: () => url,
    method: () => method,
    isNavigationRequest: () => navigation,
    resourceType: () => resourceType,
  } as unknown as PlaywrightRequest;
}

function fakeRoute(value: PlaywrightRequest): Readonly<{
  route: Route;
  continued: () => number;
  aborted: () => number;
}> {
  let continueCount = 0;
  let abortCount = 0;
  return Object.freeze({
    route: {
      request: () => value,
      continue: async () => {
        continueCount += 1;
      },
      abort: async () => {
        abortCount += 1;
      },
    } as unknown as Route,
    continued: () => continueCount,
    aborted: () => abortCount,
  });
}

function setup(service = new FakeSessionService(), now = () => Date.parse("2026-08-17T00:00:05.000Z")) {
  const browser = new FakeBrowser();
  const adapter = createBrowserbaseRuntimeAdapter({
    sessionService: service,
    cdpConnector: Object.freeze({
      async connectOverCDP() {
        return browser as unknown as Browser;
      },
    }),
    projectId: "project-123",
    region: "us-west-2",
    connectTimeoutMs: 5_000,
    releasePollIntervalMs: 25,
    releasePollAttempts: 2,
    sleep: async () => undefined,
    now,
  });
  return { adapter, browser, service };
}

test("Browserbase environment requires an explicit enable flag and API key only", () => {
  assert.throws(
    () => parseBrowserbaseRuntimeEnvironment({}),
    /BROWSERBASE_RUNTIME_DISABLED/u,
  );
  assert.throws(
    () => parseBrowserbaseRuntimeEnvironment({ ROLEDAWN_BROWSERBASE_ENABLED: "true" }),
    /BROWSERBASE_API_KEY_INVALID/u,
  );
  const parsed = parseBrowserbaseRuntimeEnvironment({
    ROLEDAWN_BROWSERBASE_ENABLED: "true",
    BROWSERBASE_API_KEY: "bb-secret",
    BROWSERBASE_REGION: "us-east-1",
    BROWSERBASE_API_TIMEOUT_MS: "12000",
  });
  assert.deepEqual(parsed, {
    enabled: true,
    apiKey: "bb-secret",
    region: "us-east-1",
    apiTimeoutMs: 12_000,
  });
});

test("Browserbase resolves exactly one API-key-scoped project", () => {
  assert.equal(resolveBrowserbaseProjectId([{ id: "project-123" }]), "project-123");
  assert.throws(
    () => resolveBrowserbaseProjectId([]),
    /BROWSERBASE_PROJECT_SCOPE_INVALID/u,
  );
  assert.throws(
    () => resolveBrowserbaseProjectId([{ id: "project-1" }, { id: "project-2" }]),
    /BROWSERBASE_PROJECT_SCOPE_INVALID/u,
  );
  assert.throws(
    () => resolveBrowserbaseProjectId([{ id: "" }]),
    /BROWSERBASE_PROJECT_SCOPE_INVALID/u,
  );
});

test("provision creates one short-lived, unrecorded, no-CAPTCHA exact-domain session", async () => {
  const { adapter, browser, service } = setup();
  const initialCdnScript = fakeRoute(fakeRequest(
    "https://job-boards.cdn.greenhouse.io/runtime.js",
    "GET",
    false,
    "script",
  ));
  const initialCrossOriginFetch = fakeRoute(fakeRequest(
    "https://analytics.example.test/collect",
    "GET",
    false,
    "fetch",
  ));
  browser.context.page.beforeGoto = async () => {
    await browser.context.routeHandler?.(initialCdnScript.route);
    await browser.context.routeHandler?.(initialCrossOriginFetch.route);
  };
  const runtime = await adapter.provision(request());

  assert.equal(runtime.providerAdapter, "browserbase");
  assert.equal(runtime.providerSessionRef, "provider-session-1");
  assert.equal(runtime.providerContextRef, null);
  assert.equal(service.creates.length, 1);
  assert.deepEqual(service.creates[0], {
    region: "us-west-2",
    ttlSeconds: 900,
    keepAlive: false,
    allowedDomains: ["boards.example.test"],
    solveCaptchas: false,
    recordSession: false,
    logSession: false,
    ignoreCertificateErrors: false,
    context: null,
    userMetadata: {
      roledawn_computer_session_id: IDS.session,
      roledawn_authority: "fill-only-no-submit",
      roledawn_adapter_release: BROWSERBASE_RUNTIME_METADATA_RELEASE,
    },
  });
  assert.equal(browser.context.initScriptCount, 1);
  assert.deepEqual(browser.context.page.gotoCalls, ["https://boards.example.test/jobs/123"]);
  assert.equal(initialCdnScript.continued(), 1);
  assert.equal(initialCrossOriginFetch.aborted(), 1);

  const postRequest = fakeRequest("https://boards.example.test/apply", "POST");
  const post = fakeRoute(postRequest);
  await browser.context.routeHandler?.(post.route);
  assert.equal(post.aborted(), 1);
  assert.equal(post.continued(), 0);
  browser.context.requestFailedHandler?.(postRequest);

  const outside = fakeRoute(fakeRequest("https://tracker.example.test/pixel", "GET"));
  await browser.context.routeHandler?.(outside.route);
  assert.equal(outside.aborted(), 1);

  const lateCdnScript = fakeRoute(fakeRequest(
    "https://job-boards.cdn.greenhouse.io/runtime.js",
    "GET",
    false,
    "script",
  ));
  await browser.context.routeHandler?.(lateCdnScript.route);
  assert.equal(lateCdnScript.aborted(), 1);

  const asset = fakeRoute(fakeRequest("https://boards.example.test/app.js", "GET"));
  await browser.context.routeHandler?.(asset.route);
  assert.equal(asset.aborted(), 1);

  const postLoadGet = fakeRoute(fakeRequest(
    "https://boards.example.test/validate?value=private",
    "GET",
  ));
  await browser.context.routeHandler?.(postLoadGet.route);
  assert.equal(postLoadGet.aborted(), 1);

  let webSocketCloseCount = 0;
  await browser.context.webSocketHandler?.({
    close: async () => {
      webSocketCloseCount += 1;
    },
  } as unknown as WebSocketRoute);
  assert.equal(webSocketCloseCount, 1);

  recordBrowserbaseRuntimeUpload(runtime.handle, 123);
  const usage = await adapter.destroy(runtime);
  assert.equal(browser.closed, true);
  assert.deepEqual(service.released, ["provider-session-1"]);
  assert.equal(usage.uploadedByteCount, 123);
  assert.equal(usage.blockedSubmissionAttemptCount, 6);
  assert.equal(usage.outboundSubmissionRequestCount, 0);
});

test("an untracked policy-violating failed request is recorded as uncertain egress", async () => {
  const { adapter, browser } = setup();
  const runtime = await adapter.provision(request());
  browser.context.requestFailedHandler?.(fakeRequest(
    "https://boards.example.test/untracked?value=private",
    "GET",
  ));
  const usage = await adapter.destroy(runtime);
  assert.equal(usage.outboundSubmissionRequestCount, 1);
});

test("provider metadata uses a Browserbase-safe release value", () => {
  assert.equal(BROWSERBASE_RUNTIME_ADAPTER_RELEASE, "browserbase-playwright-cdp/2");
  assert.equal(BROWSERBASE_RUNTIME_METADATA_RELEASE, "browserbase-playwright-cdp-2");
  assert.doesNotMatch(BROWSERBASE_RUNTIME_METADATA_RELEASE, /\//u);
});

test("destroy explicitly releases and polls an active provider session", async () => {
  const service = new FakeSessionService();
  let retrievalCount = 0;
  service.release = async (id: string) => {
    service.released.push(id);
    return session("RUNNING");
  };
  service.retrieve = async (id: string) => {
    service.retrieved.push(id);
    retrievalCount += 1;
    return retrievalCount === 1
      ? session("RUNNING")
      : Object.freeze({
          ...session("COMPLETED"),
          endedAt: "2026-08-17T00:00:05.000Z",
        });
  };
  const { adapter } = setup(service);
  const runtime = await adapter.provision(request());
  await adapter.destroy(runtime);
  assert.deepEqual(service.released, ["provider-session-1"]);
  assert.deepEqual(service.retrieved, ["provider-session-1", "provider-session-1"]);
});

test("destroy fails loudly when provider release never reaches a terminal state", async () => {
  const service = new FakeSessionService();
  service.release = async (id: string) => {
    service.released.push(id);
    return session("RUNNING");
  };
  service.retrieve = async (id: string) => {
    service.retrieved.push(id);
    return session("RUNNING");
  };
  const { adapter } = setup(service);
  const runtime = await adapter.provision(request());
  await assert.rejects(
    adapter.destroy(runtime),
    /BROWSERBASE_SESSION_RELEASE_TIMEOUT/u,
  );
});

test("a CDP connection failure explicitly releases the created provider session", async () => {
  const service = new FakeSessionService();
  const adapter = createBrowserbaseRuntimeAdapter({
    sessionService: service,
    cdpConnector: Object.freeze({
      async connectOverCDP() {
        throw new Error("synthetic-cdp-failure");
      },
    }),
    projectId: "project-123",
    region: "us-west-2",
    releasePollIntervalMs: 25,
    releasePollAttempts: 2,
    sleep: async () => undefined,
  });
  await assert.rejects(adapter.provision(request()), /synthetic-cdp-failure/u);
  assert.deepEqual(service.released, ["provider-session-1"]);
});

test("persistent mode fails closed until an internal profile is mapped to a provider context", async () => {
  const { adapter, service } = setup();
  await assert.rejects(
    adapter.provision(request("EPHEMERAL_WITH_PERSISTENT_CONTEXT")),
    /BROWSERBASE_PERSISTENT_CONTEXT_UNMAPPED/u,
  );
  assert.equal(service.creates.length, 0);
});

test("recovery reuses exactly one active metadata-bound session and never creates a replacement", async () => {
  const service = new FakeSessionService();
  service.matches = [session()];
  const { adapter } = setup(service);
  const runtime = await adapter.recoverProvisioning(request());
  assert.equal(service.creates.length, 0);
  assert.deepEqual(service.listed, [IDS.session]);
  assert.equal(runtime.providerSessionRef, "provider-session-1");
  await adapter.destroy(runtime);
});

test("recovery fails safe when the original provider session is missing or duplicated", async () => {
  const missing = new FakeSessionService();
  const missingSetup = setup(missing);
  await assert.rejects(
    missingSetup.adapter.recoverProvisioning(request()),
    /BROWSERBASE_RECOVERY_SESSION_NOT_FOUND/u,
  );
  assert.equal(missing.creates.length, 0);

  const duplicated = new FakeSessionService();
  duplicated.matches = [session(), { ...session(), id: "provider-session-2" }];
  const duplicateSetup = setup(duplicated);
  await assert.rejects(
    duplicateSetup.adapter.recoverProvisioning(request()),
    /BROWSERBASE_IDEMPOTENCY_SESSION_DUPLICATED/u,
  );
  assert.equal(duplicated.creates.length, 0);
});

test("a terminal idempotency match is never replaced with a fresh computer", async () => {
  const service = new FakeSessionService();
  service.matches = [session("COMPLETED")];
  const { adapter } = setup(service);
  await assert.rejects(
    adapter.provision(request()),
    /BROWSERBASE_IDEMPOTENCY_SESSION_TERMINAL/u,
  );
  assert.equal(service.creates.length, 0);
});
