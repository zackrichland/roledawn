import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationAgentStore, type ApplicationAgentBinding } from "./application-agent-store.ts";
import type { OpenAIAgentCallKey, OpenAIAgentToolResult } from "./openai-agents-client.ts";

const RUN_ID = "80000000-0000-4000-8000-000000000008";
const BINDING: ApplicationAgentBinding = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  candidateId: "20000000-0000-4000-8000-000000000002",
  applicationId: "30000000-0000-4000-8000-000000000003",
  revisionId: "40000000-0000-4000-8000-000000000004",
  fillAttemptId: "50000000-0000-4000-8000-000000000005",
  computerSessionId: "60000000-0000-4000-8000-000000000006",
};
const KEY: OpenAIAgentCallKey = { sessionId: "session_1", turnId: "turn_1", callId: "call_1", name: "inspect_form", argumentsHash: "a".repeat(64) };
const RESULT: OpenAIAgentToolResult = { type: "agent.session.input.tool_result", turn_id: "turn_1", call_id: "call_1", success: true, output: '{"fields":[]}' };

test("store sends exact immutable binding and hashes to service RPCs", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const store = createApplicationAgentStore({ async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    return { data: name === "start_application_agent_run" ? RUN_ID : name === "begin_application_agent_tool_call" ? { status: "new" } : null, error: null };
  } });
  assert.equal(await store.startRun(BINDING, "test-model", "test-driver/1"), RUN_ID);
  await store.bindSession(RUN_ID, "session_1");
  assert.deepEqual(await store.ledger(RUN_ID).begin(KEY), { status: "new" });
  await store.ledger(RUN_ID).complete(KEY, RESULT);
  await store.finishRun(RUN_ID, "COMPLETED", null, true);
  assert.deepEqual(calls[0], { name: "start_application_agent_run", args: {
    p_workspace_id: BINDING.workspaceId, p_candidate_id: BINDING.candidateId, p_application_id: BINDING.applicationId,
    p_revision_id: BINDING.revisionId, p_fill_attempt_id: BINDING.fillAttemptId,
    p_computer_session_id: BINDING.computerSessionId, p_model: "test-model", p_driver_release: "test-driver/1",
  } });
  assert.deepEqual(calls[2], { name: "begin_application_agent_tool_call", args: {
    p_run_id: RUN_ID, p_session_id: "session_1", p_turn_id: "turn_1", p_call_id: "call_1", p_tool_name: "inspect_form", p_arguments_hash: "a".repeat(64),
  } });
  assert.deepEqual(calls[3].args.p_result, RESULT);
  assert.equal(calls[4].args.p_provider_deleted, true);
});

test("store redacts returned and thrown database errors including network rejections", async () => {
  for (const rpc of [
    async () => ({ data: null, error: { message: "candidate resume secret", code: "23505" } }),
    async () => { throw new Error("candidate resume secret"); },
  ]) {
    const store = createApplicationAgentStore({ rpc });
    await assert.rejects(store.bindSession(RUN_ID, "session_1"), { message: "APPLICATION_AGENT_STORE_OPERATION_FAILED" });
  }
});

test("store validates complete binding and configuration before any RPC", async () => {
  let calls = 0;
  const store = createApplicationAgentStore({ async rpc() { calls += 1; return { data: RUN_ID, error: null }; } });
  await assert.rejects(store.startRun({ ...BINDING, candidateId: undefined } as never, "test", "driver"), /BINDING_INVALID/u);
  await assert.rejects(store.startRun(BINDING, " ", "driver"), /CONFIGURATION_INVALID/u);
  await assert.rejects(store.bindSession(RUN_ID, ""), /SESSION_ID_INVALID/u);
  await assert.rejects(store.bindSession("wrong-run", "session_1"), /RUN_ID_INVALID/u);
  assert.throws(() => store.ledger("wrong-run"), /RUN_ID_INVALID/u);
  await assert.rejects(store.ledger(RUN_ID).begin({ ...KEY, argumentsHash: "not-a-hash" }), /CALL_KEY_INVALID/u);
  await assert.rejects(store.finishRun(RUN_ID, "COMPLETED", "FAILED_CODE", true), /COMPLETION_INVALID/u);
  assert.equal(calls, 0);
});

test("ledger recognizes durable completed and uncertain records without treating them as new", async () => {
  for (const data of [{ status: "completed", result: RESULT }, { status: "uncertain" }] as const) {
    const store = createApplicationAgentStore({ async rpc() { return { data, error: null }; } });
    assert.deepEqual(await store.ledger(RUN_ID).begin(KEY), data);
  }
});

test("ledger rejects malformed replay results and cross-call results", async () => {
  for (const result of [
    { ...RESULT, call_id: "call_other" },
    { ...RESULT, type: "arbitrary" },
    { ...RESULT, success: "true" },
    { ...RESULT, output: { fields: [] } },
    { ...RESULT, output: "" },
    { ...RESULT, error: "unexpected" },
    { ...RESULT, secret: "unexpected" },
    [],
    null,
  ]) {
    const store = createApplicationAgentStore({ async rpc() { return { data: { status: "completed", result }, error: null }; } });
    await assert.rejects(store.ledger(RUN_ID).begin(KEY), /LEDGER_RESULT_INVALID/u);
  }
});

test("ledger refuses oversized or mismatched completion before persistence", async () => {
  let writes = 0;
  const store = createApplicationAgentStore({ async rpc() { writes += 1; return { data: null, error: null }; } });
  await assert.rejects(store.ledger(RUN_ID).complete(KEY, { ...RESULT, turn_id: "turn_other" }), /LEDGER_RESULT_INVALID/u);
  await assert.rejects(store.ledger(RUN_ID).complete(KEY, { ...RESULT, output: "x".repeat(262_144) }), /LEDGER_RESULT_INVALID/u);
  assert.equal(writes, 0);
});

test("expiry uses the bounded service RPC and validates its result", async () => {
  let args: unknown;
  const store = createApplicationAgentStore({ async rpc(name: string, input: unknown) {
    assert.equal(name, "expire_application_agent_runs"); args = input; return { data: 2, error: null };
  } });
  assert.equal(await store.expireRuns(), 2);
  assert.deepEqual(args, { p_limit: 20 });
  await assert.rejects(store.expireRuns(0), /CLEANUP_LIMIT_INVALID/u);
  await assert.rejects(store.expireRuns(101), /CLEANUP_LIMIT_INVALID/u);
  const invalid = createApplicationAgentStore({ async rpc() { return { data: 21, error: null }; } });
  await assert.rejects(invalid.expireRuns(), /CLEANUP_RESULT_INVALID/u);
});
