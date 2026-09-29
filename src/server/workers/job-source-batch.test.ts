import assert from "node:assert/strict";
import test from "node:test";
import { runJobSourceBatch } from "./job-source-batch.ts";
import type { JobSourcePollDatabasePort } from "./job-source-poll.ts";
import type { JobSourceClaim } from "../ingestion/source-snapshot.ts";

function fixture(count: number, uncertain = false) {
  const claims = Array.from({ length: count }, (_, index) => ({ sourceId: `source${index}`, ingestionRunId: `run${index}`, provider: "GREENHOUSE", tenantKey: `board${index}`, adapterRelease: "greenhouse/0.1", etag: null, sourceOptions: {} }) as JobSourceClaim);
  const committed: string[] = []; const failed: string[] = [];
  const database: JobSourcePollDatabasePort = {
    async claimDueSource() { return claims.shift() ?? null; },
    async commitSnapshot(input) { if (uncertain && input.sourceId === "source0") throw new Error("secret response"); committed.push(input.sourceId); return true; },
    async failPoll(input) { failed.push(input.sourceId); return true; },
  };
  return { database, committed, failed, claims };
}
const fetchPort = { async fetch(request: { sourceId: string }) { return { status: request.sourceId === "source1" ? 503 : 200, body: '{"jobs":[]}', headers: {}, observedAt: new Date().toISOString() }; } };
test("batch drains all due boards across per-source failures without a view-sized cap", async () => {
  const f = fixture(30); const result = await runJobSourceBatch(f.database, fetchPort, { workerId: "daily", concurrency: 3 });
  assert.equal(result.attempted, 30); assert.equal(result.completed, 29); assert.equal(result.failed, 1); assert.equal(result.stopReason, "IDLE");
  assert.equal(f.claims.length, 0);
});
test("uncertain commits are isolated and never converted into source failure or retried in the batch", async () => {
  const f = fixture(3, true); const result = await runJobSourceBatch(f.database, fetchPort, { workerId: "daily" });
  assert.equal(result.uncertain, 1); assert.deepEqual(result.errors, ["JOB_SOURCE_BATCH_OPERATION_UNCERTAIN"]);
  assert.deepEqual(f.failed, ["source1"]); assert.deepEqual(f.committed, ["source2"]);
});
test("source and time budgets stop new claims while preserving queued work", async () => {
  const f = fixture(10); const result = await runJobSourceBatch(f.database, fetchPort, { workerId: "daily", maxSources: 3 });
  assert.equal(result.attempted, 3); assert.equal(result.stopReason, "SOURCE_BUDGET"); assert.equal(f.claims.length, 7);
  let time = 0; const timed = await runJobSourceBatch(f.database, fetchPort, { workerId: "daily", maxMilliseconds: 1000 }, () => time += 2000);
  assert.equal(timed.attempted, 0); assert.equal(timed.stopReason, "TIME_BUDGET");
});
test("batch validates resource bounds before touching persistent work", async () => {
  const f = fixture(1);
  await assert.rejects(runJobSourceBatch(f.database, fetchPort, { workerId: "daily", concurrency: 100 }), /OPTIONS_INVALID/u);
  assert.equal(f.claims.length, 1);
});
test("a database outage stops new claims instead of hammering the entire source budget", async () => {
  const f = fixture(10); let calls = 0;
  f.database.claimDueSource = async () => { calls++; throw new Error("JOB_SOURCE_CLAIM_FAILED"); };
  const result = await runJobSourceBatch(f.database, fetchPort, { workerId: "daily", concurrency: 2 });
  assert.equal(result.stopReason, "DATABASE_UNAVAILABLE"); assert.equal(calls, 2);
});
