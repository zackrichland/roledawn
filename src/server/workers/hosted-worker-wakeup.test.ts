import test from "node:test";
import assert from "node:assert/strict";
import { APPLICATION_PIPELINE_LANES, dispatchDueHostedWorkers, requestHostedWorkerWakeup } from "./hosted-worker-wakeup.ts";

const environment = { NODE_ENV: "production", URL: "https://app.example.com", ROLEDAWN_WORKER_DISPATCH_SECRET: "a".repeat(64) } as const;

test("a completed stage wakes only due successors, never inventing an application or submit request", async () => {
  const sent: { url: string; body: unknown; redirect: unknown }[] = [];
  const accepted = await dispatchDueHostedWorkers(environment, {
    lanes: APPLICATION_PIPELINE_LANES,
    database: { async rpc(name, args) {
      assert.equal(name, "hosted_worker_due_lanes"); assert.deepEqual(args, {});
      return { data: ["catalog", "preparation", "kit", "kit", "autopilot", "cleanup"], error: null };
    } },
    fetch: async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)), redirect: init?.redirect });
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(accepted, 3);
  assert.deepEqual(sent.map(request => request.body), [{ lane: "preparation" }, { lane: "kit" }, { lane: "autopilot" }]);
  assert.ok(sent.every(request => request.url === "https://app.example.com/.netlify/functions/worker-background" && request.redirect === "error"));
});

test("no due work makes no request and an invalid database lane fails before any dispatch", async () => {
  let calls = 0;
  const fetchPort: typeof fetch = async () => { calls++; return new Response(null, { status: 202 }); };
  assert.equal(await dispatchDueHostedWorkers(environment, { database: { async rpc() { return { data: [], error: null }; } }, fetch: fetchPort }), 0);
  await assert.rejects(dispatchDueHostedWorkers(environment, { database: { async rpc() { return { data: ["kit", "https://example.com"], error: null }; } }, fetch: fetchPort }), /LANE_INVALID/u);
  assert.equal(calls, 0);
});

test("dispatch rejects bad secrets, destinations, database errors and non-acceptance", async () => {
  const database = { async rpc() { return { data: ["preparation"], error: null }; } };
  await assert.rejects(dispatchDueHostedWorkers({ ...environment, ROLEDAWN_WORKER_DISPATCH_SECRET: "" }, { database }), /SECRET_REQUIRED/u);
  await assert.rejects(dispatchDueHostedWorkers({ ...environment, URL: "http://localhost:3001" }, { database }), /URL_INVALID/u);
  await assert.rejects(dispatchDueHostedWorkers(environment, { database: { async rpc() { return { data: null, error: {} }; } } }), /DUE_QUERY_FAILED/u);
  await assert.rejects(dispatchDueHostedWorkers(environment, { database, fetch: async () => new Response(null, { status: 401 }) }), /DISPATCH_FAILED/u);
});

test("a newly committed send can wake its sweep before the maintenance interval", async () => {
  const sent: unknown[] = [];
  assert.equal(await dispatchDueHostedWorkers(environment, {
    lanes: ["cleanup"], includeSendIntentSweep: true,
    database: { async rpc() { return { data: [], error: null }; } },
    fetch: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response(null, { status: 202 }); },
  }), 1);
  assert.deepEqual(sent, [{ lane: "cleanup" }]);
});

test("web wakeups require the current published production deploy, independent of build CONTEXT", async () => {
  let calls = 0;
  const enabled = { ...environment, ROLEDAWN_HOSTED_WORKERS_ENABLED: "true" };
  const dispatch: typeof dispatchDueHostedWorkers = async (env, options) => {
    assert.equal(env, enabled);
    assert.deepEqual(options, { lanes: ["preparation", "cleanup"], includeSendIntentSweep: true });
    calls++;
    return 2;
  };
  for (const deploy of [
    { context: "deploy-preview", published: true },
    { context: "branch-deploy", published: true },
    { context: "dev", published: true },
    { context: "production", published: false },
  ]) await requestHostedWorkerWakeup(["preparation", "cleanup"], enabled, { getDeploy: () => deploy, dispatch });
  assert.equal(calls, 0);
  await requestHostedWorkerWakeup(["preparation", "cleanup"], enabled, {
    getDeploy: () => ({ context: "production", published: true }), dispatch,
  });
  assert.equal(calls, 1, "production does not need the build-only CONTEXT environment variable");
});

test("local, disabled and absent request contexts never dispatch even with production credentials", async () => {
  let calls = 0;
  const dispatch: typeof dispatchDueHostedWorkers = async () => { calls++; return 0; };
  for (const env of [
    { NODE_ENV: "development" },
    { NETLIFY_DEV: "true" },
    { NETLIFY_LOCAL: "true" },
    { ROLEDAWN_HOSTED_WORKERS_ENABLED: "false" },
  ] as const) {
    await requestHostedWorkerWakeup(["preparation"], { ...environment, ROLEDAWN_HOSTED_WORKERS_ENABLED: "true", CONTEXT: "production", ...env }, {
      getDeploy: () => ({ context: "production", published: true }), dispatch,
    });
  }
  // Use the actual SDK outside a Netlify request, as a local next start would.
  await requestHostedWorkerWakeup(["preparation"], { ...environment, ROLEDAWN_HOSTED_WORKERS_ENABLED: "true", CONTEXT: "production" }, { dispatch });
  assert.equal(calls, 0);
});

test("an unavailable wakeup remains best effort and logs no dispatch credentials", async t => {
  const warn = t.mock.method(console, "warn", () => {});
  await requestHostedWorkerWakeup(["preparation"], { ...environment, ROLEDAWN_HOSTED_WORKERS_ENABLED: "true" }, {
    getDeploy: () => ({ context: "production", published: true }),
    dispatch: async () => { throw new Error(environment.ROLEDAWN_WORKER_DISPATCH_SECRET); },
  });
  assert.deepEqual(warn.mock.calls.map(call => call.arguments), [[JSON.stringify({ event: "hosted_worker_wakeup_deferred" })]]);
});
