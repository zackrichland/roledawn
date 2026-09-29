import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { authorizedWorkerRequest, coordinateHostedWorker, parseHostedWorkerLane, runIndependentMaintenance, type HostedWorkerSummary } from "./hosted-worker-control.ts";
import { hostedWorkersEnabled, hostedScheduleEnabled, hostedWorkerUrl, readHostedWorkerEnvironment } from "./hosted-worker-environment.ts";

test("hosted requests fail closed without a valid secret and fixed lane", () => {
  const secret = "a".repeat(64);
  assert.equal(authorizedWorkerRequest(`Bearer ${secret}`, secret), true);
  for (const value of [null, "", secret, `Bearer ${"b".repeat(64)}`]) assert.equal(authorizedWorkerRequest(value, secret), false);
  assert.equal(authorizedWorkerRequest("Bearer ", ""), false);
  assert.throws(() => parseHostedWorkerLane("https://employer.invalid/submit"));
  assert.throws(() => parseHostedWorkerLane({ lane: "autopilot" }));
  const enabledEnv = { NODE_ENV: "production", ROLEDAWN_HOSTED_WORKERS_ENABLED: "true" } as const;
  assert.equal(hostedWorkersEnabled(enabledEnv, { context: "deploy-preview", published: true }), false);
  assert.equal(hostedWorkersEnabled(enabledEnv, { context: "production", published: false }), false);
  assert.equal(hostedWorkersEnabled(enabledEnv, { context: "production", published: true }), true);
  assert.equal(hostedWorkersEnabled(enabledEnv, {}), false);
  assert.equal(hostedScheduleEnabled(enabledEnv, { context: "production" }), true);
  assert.equal(hostedScheduleEnabled(enabledEnv, { context: "deploy-preview" }), false);
  assert.equal(hostedScheduleEnabled({ NODE_ENV: "production" }, { context: "production" }), false);
  assert.throws(() => hostedWorkerUrl({ NODE_ENV: "production", URL: "https://user:pass@example.com" }));
  assert.throws(() => hostedWorkerUrl({ NODE_ENV: "production", URL: "http://example.com" }));
  const env = readHostedWorkerEnvironment(key => key === "OPENAI_API_KEY" ? "fixture" : undefined);
  assert.equal(env.OPENAI_API_KEY, "fixture");
  assert.equal(Object.hasOwn(env, "HOME"), false);
});

test("an occupied lane never performs work", async () => {
  let calls = 0;
  const result = await coordinateHostedWorker({ lane: "autopilot", database: { async rpc() { return { data: null, error: null }; } }, async execute() { calls++; return {}; } });
  assert.equal(calls, 0); assert.deepEqual(result, { claimed: false });
});

test("execution failures record a redacted durable outcome under the same lease", async () => {
  const token = randomUUID(); const requests: { name: string; args: Record<string, unknown> }[] = [];
  const result = await coordinateHostedWorker({ lane: "kit", database: { async rpc(name, args) { requests.push({ name, args }); return { data: requests.length === 1 ? token : true, error: null }; } },
    async execute() { throw new Error("provider error with private candidate text and credentials"); } });
  assert.equal(result.success, false);
  assert.equal(requests[1]!.args.p_lease_token, token);
  assert.equal(requests[1]!.args.p_error_code, "HOSTED_WORKER_EXECUTION_FAILED");
  assert.equal(JSON.stringify(requests).includes("candidate text"), false);
});

test("a lost completion acknowledgement is not reported as success", async () => {
  let calls = 0;
  await assert.rejects(coordinateHostedWorker({ lane: "catalog", database: { async rpc() { return { data: calls++ === 0 ? randomUUID() : false, error: null }; } }, async execute() { return { completed: 1, failed: 0 }; } }), /RESULT_NOT_RECORDED/u);
});

test("uncertain work and invalid counters cannot report healthy completion", async () => {
  const cases: [HostedWorkerSummary, string][] = [[{ uncertain: 1 }, "HOSTED_WORKER_ITEMS_UNCERTAIN"], [{ completed: NaN }, "HOSTED_WORKER_SUMMARY_INVALID"]];
  for (const [summary, expected] of cases) {
    let calls = 0;
    const result = await coordinateHostedWorker({ lane: "catalog", database: { async rpc() { return { data: calls++ === 0 ? randomUUID() : true, error: null }; } }, async execute() { return summary; } });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, expected);
  }
});

test("provider initialization failure cannot starve independent private-file cleanup", async () => {
  let removed = false;
  const result = await runIndependentMaintenance([
    () => { throw new Error("PROVIDER_UNAVAILABLE"); },
    async () => ({ claimed: 1, completed: 0, failed: 1 }),
    async () => { removed = true; return { claimed: 2, completed: 2, failed: 0 }; },
  ]);
  assert.equal(removed, true);
  assert.deepEqual(result, { claimed: 3, completed: 2, failed: 2 });
});
