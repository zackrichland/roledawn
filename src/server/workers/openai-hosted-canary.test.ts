import assert from "node:assert/strict";
import test from "node:test";
import { prepareHostedCanaryPlan, runHostedCanary, type CanaryPlan, type CanaryRun, type CanaryEvidence, type HostedCanaryStore } from "./openai-hosted-canary.ts";
import type { HostedCanaryTransport } from "./openai-hosted-canary-transport.ts";

const plan = (origins: Record<string, "approve" | "deny"> = {}, deadlineMs = Date.now() + 60_000) => prepareHostedCanaryPlan({
  candidateId: "11111111-1111-4111-8111-111111111111", applicationId: "22222222-2222-4222-8222-222222222222",
  destinationUrl: "https://jobs.lever.co/example/33333333-3333-4333-8333-333333333333/apply",
  admissionKey: "persisted-key", allowedDomains: ["jobs.lever.co"], originDecisions: origins,
  deadlineMs, priorSpendUpperBoundCents: 100, reservedRunCents: 100,
  packet: { facts: { name: "Synthetic Fixture", email: "fixture@example.test" }, resumeBase64: Buffer.from("%PDF-synthetic-fixture").toString("base64") },
});
const terminal = { type: "agent.session.turn.completed", turn: { id: "turn_1", session_id: "session_1", subagent_id: null } };
const action = { type: "computer_use_approval_request", request_id: "approval_1", request: { type: "browser_origin_access", origin: "https://jobs.lever.co" } };

// Deliberately test-only. Production requires an independently reviewed durable store.
function harness(p: CanaryPlan = plan()) {
  let row: CanaryRun = { runId: "run_1", controllerToken: "owner", version: 0, intentSha256: p.intentSha256,
    phase: "RESERVED", sessionId: null, possibleEgress: false, cancelRequested: false, cleanupPending: false, evidence: null };
  let locked = false;
  const calls: { name: string; body?: unknown; key?: string | null }[] = [];
  const control = { events: [terminal] as unknown[], actions: [] as unknown[], budget: true, failAdmission: 0, failReady: false, failDelete: false,
    evidence: null as CanaryEvidence | null, abortAfterAdmission: undefined as AbortController | undefined };
  const store: HostedCanaryStore = {
    async claim(incoming) { if (locked || incoming.intentSha256 !== row.intentSha256) throw Error("refused"); locked = true; return structuredClone(row); },
    async commit(prior, patch) {
      assert.equal(prior.version, row.version);
      if (patch.phase === "READY" && control.failReady) throw Error("durable write unavailable");
      assert.ok(!row.possibleEgress || patch.possibleEgress !== false);
      row = { ...row, ...patch, version: row.version + 1 }; return structuredClone(row);
    },
    async budgetAvailable() { return control.budget; },
    async releaseController() { locked = false; },
  };
  const transport: HostedCanaryTransport = {
    async create(body) { calls.push({ name: "create", body }); assert.equal(row.phase, "CREATING"); assert.equal(row.possibleEgress, true);
      return { id: "session_1", environment: { type: "openai_hosted" } }; },
    async turns() { calls.push({ name: "turns" }); return { data: [{ ...terminal.turn, status: "completed" }], has_more: false }; },
    async retrieve() { calls.push({ name: "retrieve" }); return { id: "session_1", environment: { type: "openai_hosted" }, required_actions: control.actions }; },
    async post(_id, body, key) { calls.push({ name: "post", body, key });
      if (key) { assert.equal(row.phase, "ADMISSION_PENDING"); control.abortAfterAdmission?.abort(); if (control.failAdmission-- > 0) throw Error("lost ack"); } },
    async stream() { calls.push({ name: "stream" }); return { events: (async function* () { yield* control.events; })(), async close() { calls.push({ name: "close" }); } }; },
    async remove() { calls.push({ name: "remove" }); if (control.failDelete) throw Error("unavailable"); },
  };
  const run = (signal?: AbortSignal) => runHostedCanary({ enabled: true, reducedGuaranteeApproved: true, plan: p, store, transport,
    signal, verifyEmployerEvidence: async () => control.evidence });
  return { p, store, transport, control, calls, run, seed: (patch: Partial<CanaryRun>) => { row = { ...row, ...patch }; }, row: () => row };
}

test("disabled by default; mutated approval intent cannot start", async () => {
  const h = harness();
  await assert.rejects(runHostedCanary({ plan: h.p, store: h.store, transport: h.transport, verifyEmployerEvidence: async () => null }), /DISABLED/);
  await assert.rejects(runHostedCanary({ enabled: true, reducedGuaranteeApproved: true, plan: { ...h.p, admissionKey: "changed" }, store: h.store, transport: h.transport, verifyEmployerEvidence: async () => null }), /INTENT_CHANGED/);
  assert.equal(h.calls.length, 0);
});
test("idle create, stream before task, completion is uncertain and cleans up", async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.phase, "UNCERTAIN"); assert.equal(result.automaticRetryAllowed, false);
  assert.deepEqual(h.calls.slice(0, 4).map(c => c.name), ["create", "stream", "post", "retrieve"]);
  assert.equal("input" in (h.calls[0].body as object), false);
  assert.ok(h.calls.some(c => c.name === "remove"));
});
test("lost admission acknowledgement replays the identical key and body only", async () => {
  const h = harness(); h.control.failAdmission = 1; await h.run();
  const posts = h.calls.filter(c => c.key); assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], posts[1]); assert.equal(h.calls.filter(c => c.name === "create").length, 1);
});
test("origin pending and denial cancel without granting access", async () => {
  for (const decision of [undefined, "deny"] as const) {
    const h = harness(plan(decision ? { "https://jobs.lever.co": decision } : {})); h.control.actions = [action];
    const result = await h.run(); assert.match(result.reason, decision ? /ORIGIN_DENIED/ : /ORIGIN_PENDING/);
    assert.equal(result.phase, "UNCERTAIN"); assert.equal(h.row().cancelRequested, true);
    assert.ok(!JSON.stringify(h.calls).includes('"decision":"approve"'));
  }
});
test("exact recorded origin approval is emitted using the documented result event", async () => {
  const h = harness(plan({ "https://jobs.lever.co": "approve" })); h.control.actions = [action]; await h.run();
  assert.ok(h.calls.some(c => JSON.stringify(c.body ?? null).includes('"decision":"approve"')));
});
test("malformed and lost streams retain uncertainty across controller restart", async () => {
  for (const events of [[], [{}], [{ ...terminal, turn: { ...terminal.turn, session_id: "wrong" } }]]) {
    const h = harness(); h.control.events = events; assert.equal((await h.run()).phase, "UNCERTAIN");
    const n = h.calls.filter(c => c.key).length; assert.equal((await h.run()).reason, "RECOVERY_ONLY");
    assert.equal(h.calls.filter(c => c.key).length, n); assert.equal(h.calls.filter(c => c.name === "create").length, 1);
  }
});
test("budget exhaustion before egress stops; cancellation after admission stays uncertain", async () => {
  const h = harness(); h.control.budget = false; assert.equal((await h.run()).phase, "STOPPED"); assert.equal(h.calls.length, 0);
  const after = harness(), abort = new AbortController(); after.control.abortAfterAdmission = abort;
  assert.equal((await after.run(abort.signal)).phase, "UNCERTAIN"); assert.equal(after.row().cancelRequested, true);
});
test("competing controller cannot admit a second task", async () => {
  const h = harness(); const results = await Promise.allSettled([h.run(), h.run()]);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(h.calls.filter(c => c.key).length, 1);
});
test("known session is cancelled even when saving its identity fails", async () => {
  const h = harness(); h.control.failReady = true; assert.equal((await h.run()).phase, "UNCERTAIN");
  assert.ok(h.calls.some(c => c.name === "remove")); assert.equal(h.calls.filter(c => c.key).length, 0);
  await h.run(); assert.equal(h.calls.filter(c => c.name === "create").length, 1);
});
test("only independently verified exactly bound employer evidence can confirm", async () => {
  for (const mismatch of [false, true]) {
    const h = harness(); h.control.evidence = { source: "VERIFIED_EMPLOYER_EVIDENCE", applicationId: h.p.applicationId,
      destinationUrl: h.p.destinationUrl, packetSha256: mismatch ? "0".repeat(64) : h.p.packetSha256,
      evidenceSha256: "a".repeat(64), outcome: "CONFIRMED" };
    const result = await h.run(); assert.equal(result.phase, mismatch ? "UNCERTAIN" : "CONFIRMED");
    if (mismatch) assert.match(result.reason, /RECEIPT_MISMATCH/);
  }
});

 test("expired immutable deadlines permit cancellation and evidence reconciliation only", async () => {
  for (const confirmed of [false, true]) {
    const h = harness(plan({}, Date.now() - 1000));
    h.seed({ phase: "ACTIVE", sessionId: "session_1", possibleEgress: true, cleanupPending: true });
    if (confirmed) h.control.evidence = { source: "VERIFIED_EMPLOYER_EVIDENCE", applicationId: h.p.applicationId, destinationUrl: h.p.destinationUrl,
      packetSha256: h.p.packetSha256, evidenceSha256: "a".repeat(64), outcome: "CONFIRMED" };
    assert.equal((await h.run()).phase, confirmed ? "CONFIRMED" : "UNCERTAIN");
    assert.equal(h.calls.filter(c => c.key || c.name === "create").length, 0);
    assert.equal(h.row().cancelRequested, true);
  }
  const fresh = harness(plan({}, Date.now() - 1000));
  assert.equal((await fresh.run()).phase, "STOPPED"); assert.equal(fresh.calls.length, 0);
});

test("terminal cleanup failure persists and restarts without task admission", async () => {
  const h = harness(); h.control.failDelete = true;
  h.control.evidence = { source: "VERIFIED_EMPLOYER_EVIDENCE", applicationId: h.p.applicationId, destinationUrl: h.p.destinationUrl,
    packetSha256: h.p.packetSha256, evidenceSha256: "a".repeat(64), outcome: "CONFIRMED" };
  assert.equal((await h.run()).reason, "CLEANUP_PENDING"); assert.equal(h.row().cleanupPending, true);
  assert.deepEqual(h.row().evidence, h.control.evidence); h.control.failDelete = false;
  assert.equal((await h.run()).reason, "ALREADY_TERMINAL"); assert.equal(h.row().cleanupPending, false);
  assert.equal(h.calls.filter(c => c.key).length, 1);
});
test("ACTIVE restart reads retained history before cancellation and does not wait for live-only events", async () => {
  const h = harness(); h.seed({ phase: "ACTIVE", sessionId: "session_1", possibleEgress: true, cleanupPending: true });
  assert.equal((await h.run()).reason, "HISTORY_RECOVERY_ONLY");
  assert.equal(h.calls[0].name, "turns"); assert.equal(h.calls.some(c => c.name === "stream" || c.key), false);
});
