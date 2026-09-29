import assert from "node:assert/strict";
import test from "node:test";
import { createManagedApplicationFormHarness, parseApplicationFormDriverEnvironment } from "./application-form-driver.ts";
import type { ApplicationAgentStore } from "./application-agent-store.ts";
import type { OpenAIAgentsClient } from "./openai-agents-client.ts";

test("driver defaults remain deterministic; agents configuration requires a key and bounded budgets", () => {
  assert.deepEqual(parseApplicationFormDriverEnvironment({}), { driver: "deterministic" });
  assert.throws(() => parseApplicationFormDriverEnvironment({ ROLEDAWN_FORM_DRIVER: "agents" }), /KEY_REQUIRED/u);
  assert.throws(() => parseApplicationFormDriverEnvironment({ ROLEDAWN_FORM_DRIVER: "other" }), /DRIVER_INVALID/u);
  assert.throws(() => parseApplicationFormDriverEnvironment({ ROLEDAWN_FORM_DRIVER: " agents " }), /DRIVER_INVALID/u);
  assert.throws(() => parseApplicationFormDriverEnvironment({ ROLEDAWN_FORM_DRIVER: "agents", OPENAI_API_KEY: "synthetic", ROLEDAWN_APPLICATION_AGENT_TIMEOUT_MS: "300000" }), /TIMEOUT_INVALID/u);
  for (const timeout of ["-1", "Infinity", "600001", "50ms"]) assert.throws(() => parseApplicationFormDriverEnvironment({ ROLEDAWN_FORM_DRIVER: "agents", OPENAI_API_KEY: "synthetic", ROLEDAWN_APPLICATION_AGENT_TIMEOUT_MS: timeout }), /TIMEOUT_INVALID/u);
  const value = parseApplicationFormDriverEnvironment({ ROLEDAWN_FORM_DRIVER: "agents", OPENAI_API_KEY: "synthetic", ROLEDAWN_APPLICATION_AGENT_MODEL: "test-model" });
  assert.equal(value.driver, "agents");
  if (value.driver === "agents") assert.equal(value.model, "test-model");
});

test("managed harness persists before execution, cleans private session, and retains completion when cleanup fails", async () => {
  for (const deleteFails of [false, true]) {
    const events: string[] = [];
    let sentResult = false;
    let sentMessage = false;
    const store: ApplicationAgentStore = {
      async expireRuns() { return 0; },
      async startRun() { events.push("start"); return "internal-run"; },
      async bindSession() { events.push("bind"); },
      ledger() { return { async begin() { events.push("begin"); return { status: "new" }; }, async complete() { events.push("save"); } }; },
      async finishRun(id, status, code, deleted) { events.push("finish"); assert.equal(id, "internal-run"); assert.equal(status, "COMPLETED"); assert.equal(code, null); assert.equal(deleted, !deleteFails); },
    };
    const client: OpenAIAgentsClient = {
      async createSession(request) { events.push("create"); assert.match(request.input ?? "", /initialization handshake/u); assert.deepEqual(request.metadata, { roledawn_run_id: "internal-run", driver_release: "agents-adaptive-fill/1" }); return { id: "session_1", status: "idle", required_actions: [] }; },
      async retrieveSession() { return sentResult ? { id: "session_1", status: "idle", required_actions: [] } : { id: "session_1", status: "requires_action", required_actions: [{ type: "function_call", turn_id: "turn_1", call_id: "call_1", name: "inspect_form", arguments: {} }] }; },
      async retrieveTurn() { return { id: "turn_1", session_id: "session_1", status: "completed" }; },
      async retrieveLatestTurn() { return { id: sentMessage ? "turn_1" : "turn_initialization", session_id: "session_1", status: "completed" }; },
      async sendToolResults() { events.push("send"); sentResult = true; },
      async sendMessage(id, input) { events.push("message"); sentMessage = true; assert.equal(id, "session_1"); assert.deepEqual(JSON.parse(input), { synthetic: true }); }, async cancelTurn() {},
      async deleteSession() { events.push("delete"); if (deleteFails) throw new Error("unavailable"); },
    };
    await createManagedApplicationFormHarness({ driver: "agents", apiKey: "synthetic", model: "test-model", timeoutMs: 5000, maxActions: 5 }, client, store).run({
      binding: { workspaceId: "w", candidateId: "c", applicationId: "a", revisionId: "r", fillAttemptId: "f", computerSessionId: "s" },
      instructions: "Synthetic only.", toolDefinitions: [{ type: "function", name: "inspect_form", description: "Inspect.", parameters: { type: "object", properties: {} } }],
      input: { synthetic: true }, maxActions: 5,
      async executeTool(name, args, signal) { events.push("execute"); assert.equal(name, "inspect_form"); assert.deepEqual(args, {}); assert.equal(signal?.aborted, false); return {}; },
    });
    assert.deepEqual(events, ["start", "create", "bind", "message", "begin", "execute", "save", "send", "delete", "finish"]);
  }
});
