import assert from "node:assert/strict";
import test from "node:test";
import type { Browser, Page } from "playwright-core";
import { createApplicationDeliveryRuntimeAdapter, deliveryProviderError, type DeliverySessionProvider } from "./application-delivery-runtime.ts";

const provisionKey = "90000000-0000-4000-8000-000000000009";
const record = { id: "session-one", projectId: "project-one", status: "RUNNING", expiresAt: "2099-01-01T00:00:00Z", connectUrl: "wss://connect.example/session", userMetadata: { roledawn_delivery_provision_key: provisionKey, roledawn_adapter_release: "application-delivery-browser-1" } };
function fixture(overrides: Partial<DeliverySessionProvider> = {}) {
  const calls: string[] = [];
  const provider: DeliverySessionProvider = {
    async list() { calls.push("list"); return []; },
    async create() { calls.push("create"); return record; },
    async retrieve() { calls.push("retrieve"); return record; },
    async release() { calls.push("release"); }, ...overrides,
  };
  const page = {} as Page;
  const isolated = { pages: () => [page], serviceWorkers: () => [] };
  const browser = { contexts: () => [{ pages: () => [{ providerDefault: true }], serviceWorkers: () => [{ url: () => "chrome-extension://provider/worker.js" }] }],
    async newContext(options: unknown) { assert.deepEqual(options, { serviceWorkers: "block" }); calls.push("isolated-context"); return isolated; }, async close() { calls.push("disconnect"); } } as unknown as Browser;
  const adapter = createApplicationDeliveryRuntimeAdapter({ provider, projectId: "project-one", async connect() { calls.push("connect"); return browser; } });
  const request = { provisionKey, runtimeReference: null, allowCreate: true, async onBound() { calls.push("bound"); } };
  return { adapter, request, calls, page };
}

test("delivery runtime persists provider binding before connecting and releases before disconnect", async () => {
  const { adapter, request, calls, page } = fixture();
  const runtime = await adapter.open(request);
  assert.equal(runtime.page, page);
  assert.deepEqual(calls, ["list", "create", "bound", "connect", "isolated-context"]);
  await runtime.release(); await runtime.release();
  assert.deepEqual(calls.slice(-2), ["release", "disconnect"]);
});

test("uncertain browser provisioning is discovered without a second create", async () => {
  const { adapter, request, calls } = fixture({ async list() { return [record]; } });
  await adapter.open({ ...request, allowCreate: false });
  assert.equal(calls.includes("create"), false);
  assert.equal(calls.includes("connect"), true);
});

test("an unknown provisioning outcome never blindly repeats create", async () => {
  const { adapter, request, calls } = fixture();
  await assert.rejects(adapter.open({ ...request, allowCreate: false }), /CREATE_UNCERTAIN/u);
  assert.deepEqual(calls, ["list"]);
});

test("provider cross-job binding and expired sessions cannot open", async () => {
  for (const changed of [{ projectId: "another-project" }, { userMetadata: {} }, { expiresAt: "2000-01-01T00:00:00Z" }, { status: "COMPLETED" }]) {
    const { adapter, request, calls } = fixture({ async retrieve() { return { ...record, ...changed }; } });
    await assert.rejects(adapter.open({ ...request, runtimeReference: record.id }), /BINDING_MISMATCH|EXPIRED/u);
    assert.equal(calls.includes("connect"), false);
  }
});

test("missing durable binding prevents browser access and releases the known provider session", async () => {
  const { adapter, request, calls } = fixture();
  await assert.rejects(adapter.open({ ...request, async onBound() { throw new Error("store-down"); } }), /store-down/u);
  assert.equal(calls.includes("connect"), false);
  assert.equal(calls.filter((call) => call === "release").length, 1);
});

test("bound recovery reuses the unique isolated context and rejects ambiguous contexts or workers", async () => {
  for (const scenario of ["recovery", "ambiguous", "worker"] as const) {
    const page = {} as Page; let creates = 0; let releases = 0;
    const isolated = { pages: () => [page], serviceWorkers: () => scenario === "worker" ? [{ url: () => "https://ats.invalid/worker.js" }] : [] };
    const browser = { contexts: () => [{}, isolated, ...(scenario === "ambiguous" ? [isolated] : [])], async newContext() { creates += 1; throw new Error("UNEXPECTED_CONTEXT"); }, async close() {} } as unknown as Browser;
    const adapter = createApplicationDeliveryRuntimeAdapter({ projectId: record.projectId, async connect() { return browser; }, provider: {
      async list() { return [record]; }, async create() { throw new Error("UNEXPECTED_CREATE"); }, async retrieve() { return record; }, async release() { releases += 1; },
    } });
    const request = { provisionKey, runtimeReference: record.id, allowCreate: false, async onBound() {} };
    if (scenario === "recovery") { const runtime = await adapter.open(request); assert.equal(runtime.page, page); await runtime.release(); }
    else await assert.rejects(adapter.open(request), scenario === "ambiguous" ? /CONTEXT_AMBIGUOUS/u : /SERVICE_WORKER_UNSUPPORTED/u);
    assert.equal(creates, 0); assert.equal(releases, 1);
  }
});


test("invalid provider connection data releases the bound session before any browser access", async () => {
  const { adapter, request, calls } = fixture({ async retrieve() { return { ...record, connectUrl: "file:///not-a-provider" }; } });
  await assert.rejects(adapter.open({ ...request, runtimeReference: record.id }), /CONNECTION_INVALID/u);
  assert.equal(calls.includes("connect"), false); assert.equal(calls.filter((call) => call === "release").length, 1);
});

test("provider plan limits fail with a plain reason instead of a generic error", () => {
  const status = (code: number, message: string) => Object.assign(new Error(message), { status: code });
  assert.equal(deliveryProviderError(status(402, "Free plan browser minutes limit reached.")).message, "DELIVERY_BROWSER_QUOTA_EXHAUSTED");
  assert.equal(deliveryProviderError(status(429, "Too Many Requests")).message, "DELIVERY_BROWSER_CONCURRENCY_LIMIT");
  const other = status(500, "socket hang up");
  assert.equal(deliveryProviderError(other), other);
  assert.equal(deliveryProviderError("offline").message, "DELIVERY_RUNTIME_PROVIDER_FAILED");
});

test("default-context experiment uses only a fresh dedicated page and releases its session", async () => {
  const calls: string[] = [];
  const page = { url: () => "about:blank" } as Page;
  const context = { pages: () => [page], serviceWorkers: () => [{ url: () => `chrome-extension://${"a".repeat(32)}/background.js` }] };
  const browser = { contexts: () => [context], async newContext() { throw new Error("UNEXPECTED_NEW_CONTEXT"); }, async close() { calls.push("disconnect"); } } as unknown as Browser;
  const defaultRecord = { ...record, userMetadata: { ...record.userMetadata, roledawn_adapter_release: "application-delivery-browser-default-context-1" } };
  const adapter = createApplicationDeliveryRuntimeAdapter({ contextMode: "BROWSERBASE_DEFAULT", projectId: record.projectId,
    async connect() { calls.push("connect"); return browser; }, provider: {
      async list() { return []; }, async create() { calls.push("create"); return defaultRecord; },
      async retrieve() { return defaultRecord; }, async release() { calls.push("release"); },
    } });
  const runtime = await adapter.open({ provisionKey, runtimeReference: null, allowCreate: true, async onBound() { calls.push("bound"); } });
  assert.equal(runtime.page, page);
  assert.equal(runtime.contextMode, "BROWSERBASE_DEFAULT");
  await runtime.release();
  assert.deepEqual(calls, ["create", "bound", "connect", "release", "disconnect"]);
});

test("default-context experiment rejects preloaded pages, extra contexts and page-origin workers", async () => {
  const defaultRecord = { ...record, userMetadata: { ...record.userMetadata, roledawn_adapter_release: "application-delivery-browser-default-context-1" } };
  const scenarios = [
    { contexts: [{ pages: () => [{ url: () => "https://other.example" }], serviceWorkers: () => [] }], error: /DEFAULT_PAGE_NOT_FRESH/u },
    { contexts: [{ pages: () => [{ url: () => "about:blank" }], serviceWorkers: () => [] }, {}], error: /CONTEXT_AMBIGUOUS/u },
    { contexts: [{ pages: () => [{ url: () => "about:blank" }], serviceWorkers: () => [{ url: () => "https://other.example/sw.js" }] }], error: /SERVICE_WORKER_UNSUPPORTED/u },
  ];
  for (const scenario of scenarios) {
    let releases = 0;
    const browser = { contexts: () => scenario.contexts, async close() {} } as unknown as Browser;
    const adapter = createApplicationDeliveryRuntimeAdapter({ contextMode: "BROWSERBASE_DEFAULT", projectId: record.projectId,
      async connect() { return browser; }, provider: {
        async list() { return []; }, async create() { return defaultRecord; }, async retrieve() { return defaultRecord; },
        async release() { releases += 1; },
      } });
    await assert.rejects(adapter.open({ provisionKey, runtimeReference: null, allowCreate: true, async onBound() {} }), scenario.error);
    assert.equal(releases, 1);
  }
});

test("default-context experiment cannot recover an isolated-mode session", async () => {
  let connected = false;
  const adapter = createApplicationDeliveryRuntimeAdapter({ contextMode: "BROWSERBASE_DEFAULT", projectId: record.projectId,
    async connect() { connected = true; throw new Error("UNEXPECTED_CONNECT"); }, provider: {
      async list() { return [record]; }, async create() { throw new Error("UNEXPECTED_CREATE"); },
      async retrieve() { return record; }, async release() {},
    } });
  await assert.rejects(adapter.open({ provisionKey, runtimeReference: record.id, allowCreate: false, async onBound() {} }), /BINDING_MISMATCH/u);
  assert.equal(connected, false);
});
