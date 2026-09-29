import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationAgentCleanupRepository, runApplicationAgentCleanup } from "./application-agent-cleanup.ts";

test("cleanup deletes only terminal provider sessions and leaves failed deletion pending", async () => {
  const events: string[] = [];
  const result = await runApplicationAgentCleanup({
    async expireInactiveRuns() { events.push("expire"); },
    async pending() { events.push("query"); return [
      { id: "one", providerSessionId: "session_one", status: "COMPLETED", failureCode: null },
      { id: "two", providerSessionId: "session_two", status: "FAILED", failureCode: "TEST_FAILURE" },
    ]; },
  }, {
    async deleteSession(id) { events.push(`delete:${id}`); if (id === "session_two") throw new Error("provider detail"); },
  }, { async finishRun(id, status, failureCode, deleted) {
    events.push(`finish:${id}`); assert.equal(status, "COMPLETED"); assert.equal(failureCode, null); assert.equal(deleted, true);
  } });
  assert.deepEqual(result, { kind: "AGENT_SESSION_CLEANUP", completed: 1, failed: 1 });
  assert.deepEqual(events, ["expire", "query", "delete:session_one", "finish:one", "delete:session_two"]);
});

test("cleanup database uncertainty prevents provider work", async () => {
  await assert.rejects(runApplicationAgentCleanup({
    async expireInactiveRuns() { throw new Error("database unavailable"); },
    async pending() { assert.fail("must not query"); },
  }, { async deleteSession() { assert.fail("must not delete"); } }, { async finishRun() { assert.fail("must not finish"); } }), /APPLICATION_AGENT_CLEANUP_QUERY_FAILED/u);
});

test("cleanup repository atomically claims a bounded batch before provider work", async () => {
  const calls: unknown[] = [];
  const repository = createApplicationAgentCleanupRepository({ async rpc(name: string, args: unknown) {
    calls.push({ name, args });
    return { data: [{ id: "00000001-1111-4111-8111-111111111111", provider_session_id: "session_1", status: "FAILED", failure_code: "SYNTHETIC_STOP" }], error: null };
  } } as never);
  assert.deepEqual(await repository.pending(), [{ id: "00000001-1111-4111-8111-111111111111", providerSessionId: "session_1", status: "FAILED", failureCode: "SYNTHETIC_STOP" }]);
  assert.deepEqual(calls, [{ name: "claim_application_agent_cleanup", args: { p_limit: 20 } }]);
});

test("cleanup rejects malformed claims and redacts returned and thrown database errors", async () => {
  const valid = { id: "00000001-1111-4111-8111-111111111111", provider_session_id: "session_1", status: "FAILED", failure_code: null };
  for (const data of [[{ ...valid, status: "RUNNING" }], [{ ...valid, provider_session_id: "../other" }], Array(21).fill(valid), null]) {
    const repository = createApplicationAgentCleanupRepository({ async rpc() { return { data, error: null }; } } as never);
    await assert.rejects(repository.pending(), { message: "APPLICATION_AGENT_CLEANUP_QUERY_FAILED" });
  }
  for (const rpc of [async () => { throw new Error("private database payload"); }, async () => ({ data: null, error: { message: "private database payload" } })]) {
    const repository = createApplicationAgentCleanupRepository({ rpc } as never);
    await assert.rejects(repository.pending(), { message: "APPLICATION_AGENT_CLEANUP_QUERY_FAILED" });
    await assert.rejects(repository.expireInactiveRuns(), { message: "APPLICATION_AGENT_CLEANUP_QUERY_FAILED" });
  }
});
