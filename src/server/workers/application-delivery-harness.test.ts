import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationDeliveryHarness, type ApplicationDeliveryAgentStore } from "./application-delivery-harness.ts";
import type { OpenAIAgentsClient } from "./openai-agents-client.ts";

test("delivery harness checks revoked authority at tool time and deletes the model session", async () => {
  const events: string[] = [];
  let sentMessage = false;
  let revoked = false;
  const client: OpenAIAgentsClient = {
    async createSession(request) { assert.match(request.input ?? "", /initialization handshake/u); events.push("create"); return { id: "session_1", status: "idle", required_actions: [] }; },
    async retrieveSession() { revoked = true; return { id: "session_1", status: "requires_action", required_actions: [{ type: "function_call", turn_id: "turn_1", call_id: "call_1", name: "fill_fact", arguments: {} }] }; },
    async retrieveTurn() { return { id: "turn_1", session_id: "session_1", status: "completed" }; },
    async retrieveLatestTurn() { return { id: sentMessage ? "turn_1" : "turn_init", session_id: "session_1", status: "completed" }; },
    async sendToolResults() { throw new Error("unexpected"); },
    async sendMessage() { events.push("private-input"); sentMessage = true; },
    async cancelTurn() { events.push("cancel"); },
    async deleteSession() { events.push("delete"); },
  };
  const store: ApplicationDeliveryAgentStore = {
    async assertLease() { events.push("authority"); if (revoked) throw new Error("PAUSED"); },
    async setAgentSession(_lease, value) { events.push(value ? "bind" : "deleted"); },
    ledger() { return { async begin() { return { status: "new" }; }, async complete() {} }; },
  };
  let executed = false;
  await assert.rejects(createApplicationDeliveryHarness({
    configuration: { driver: "agents", apiKey: "synthetic", model: "test-model", timeoutMs: 5000, maxActions: 5 },
    client, store, lease: { id: "autopilot", leaseToken: "lease" },
  }).run({
    binding: { workspaceId: "w", candidateId: "c", applicationId: "a", revisionId: "r", fillAttemptId: "f", computerSessionId: "s" },
    instructions: "Synthetic.", toolDefinitions: [{ type: "function", name: "fill_fact", description: "Fill.", parameters: { type: "object" } }],
    input: { private: "synthetic" }, maxActions: 5,
    async executeTool() { executed = true; return {}; },
  }));
  assert.equal(executed, false);
  assert.ok(events.indexOf("bind") < events.indexOf("private-input"));
  assert.ok(events.includes("delete"));
  assert.ok(events.includes("deleted"));
});

test("a failed provider turn resumes once with the shared action budget; cancellation and quota never resume", async () => {
  for (const status of ["failed", "cancelled", "quota", "uncertain"] as const) {
    let sessions = 0; let privateSent = false; let toolExecuted = false; let writes = 0;
    const events: unknown[] = [];
    const client: OpenAIAgentsClient = {
      async createSession() { sessions += 1; privateSent = false; toolExecuted = false; return { id: `s${sessions}`, status: "idle", required_actions: [] }; },
      async retrieveSession() { return { id: `s${sessions}`, status: "idle", required_actions: [] }; },
      async retrieveTurn() { return { id: `t${sessions}`, session_id: `s${sessions}`, status: sessions === 2 ? "completed" : "failed", failure: "PROVIDER_ERROR" }; },
      async retrieveLatestTurn() {
        if (!privateSent) return { id: `init${sessions}`, session_id: `s${sessions}`, status: "completed" };
        return { id: `t${sessions}`, session_id: `s${sessions}`, status: sessions === 2 ? "completed" : status === "cancelled" ? "cancelled" : "failed",
          failure: status === "quota" ? "CREDITS_EXHAUSTED" : "PROVIDER_ERROR" };
      },
      async sendMessage() { privateSent = true; }, async sendToolResults() {}, async cancelTurn() {}, async deleteSession() {},
    };
    if (status === "uncertain") client.retrieveSession = async () => {
      if (!privateSent) return { id: `s${sessions}`, status: "idle", required_actions: [] };
      return { id: `s${sessions}`, status: "requires_action", required_actions: [{ type: "function_call", turn_id: "t1", call_id: "c1", name: "fill_fact", arguments: {} }] };
    };
    // One acknowledged tool is consumed before the first provider failure.
    if (status === "failed") client.retrieveSession = async () => {
      if (privateSent && !toolExecuted && sessions === 1) {
        toolExecuted = true;
        return { id: "s1", status: "requires_action", required_actions: [{ type: "function_call", turn_id: "t1", call_id: "c1", name: "fill_fact", arguments: {} }] };
      }
      return { id: `s${sessions}`, status: "idle", required_actions: [] };
    };
    const harness = createApplicationDeliveryHarness({ configuration: { driver: "agents", apiKey: "synthetic", model: "synthetic", timeoutMs: 5000, maxActions: 2 }, client,
      store: { async assertLease() {}, async setAgentSession() {}, ledger() { return { async begin() { return { status: "new" }; }, async complete() {} }; } },
      lease: { id: "autopilot", leaseToken: "lease" }, async report(detail) { events.push(detail); },
    });
    const run = harness.run({ binding: { workspaceId: "w", candidateId: "c", applicationId: "a", revisionId: "r", fillAttemptId: "f", computerSessionId: "s" },
      instructions: "Synthetic", toolDefinitions: [{ type: "function", name: "fill_fact", description: "Fill", parameters: {} }], input: {}, maxActions: 2,
      async executeTool() { writes += 1; if (status === "uncertain") throw new Error("UNACKNOWLEDGED_WRITE"); return {}; },
    });
    if (status === "failed") { await run; assert.equal(sessions, 2); assert.equal(writes, 1); }
    else { await assert.rejects(run); assert.equal(sessions, 1); }
    assert.ok(events.length >= 1);
  }
});
