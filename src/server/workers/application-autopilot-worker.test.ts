import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { ApplicationAutopilotClaim, ApplicationAutopilotCompletion, ApplicationAutopilotRepository } from "../../domain/application-autopilot.ts";
import { coordinateApplicationAutopilot, type DeliveryWorkerOutcome } from "./application-autopilot-worker.ts";
import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";

const ID = "90000000-0000-4000-8000-000000000009";
const HASH = "a".repeat(64);
const claim: ApplicationAutopilotClaim = { id: ID, leaseToken: ID, workspaceId: ID, candidateId: ID, applicationId: ID, revisionId: ID, packetHash: HASH, destinationUrl: "https://jobs.example.com/role", artifactManifest: [], disclosureManifest: {}, status: "RUNNING", mode: "FILL", checkpoint: {}, runtimeReference: null, leaseExpiresAt: "2099-01-01T00:00:00Z", attemptId: null, sealedDiffHash: null };
const receipt = { url: "https://jobs.example.com/thanks", observedAt: "2026-09-16T00:00:00Z", bodyHash: HASH, requestFingerprint: HASH, attemptId: ID };

function fixture() {
  const events: string[] = [];
  const completions: ApplicationAutopilotCompletion[] = [];
  const bytes = new Uint8Array([1, 2, 3]);
  const execution: ApplicationFillExecutionPackage = { schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", submitAuthorized: false, binding: { workspaceId: ID, candidateId: ID, applicationId: ID, revisionId: ID, fillAttemptId: ID, computerSessionId: ID }, destinationUrl: claim.destinationUrl, facts: [], artifacts: [{ artifactVersionId: ID, variant: "RESUME_PDF", filename: "resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, sha256: HASH, bytes }] };
  const repository: ApplicationAutopilotRepository = {
    async claim() { return claim; }, async assertLease() { events.push("authority"); },
    async checkpoint(_lease, value) { events.push(value.stage); },
    async bindRuntime(_lease, value) { events.push(value ? "runtime-bound" : "runtime-deleted"); },
    async setAgentSession() {},
    async readAllAnswers() { return []; },
    async requestQuestions(_lease, questions) { assert.equal(questions.length, 1); events.push("questions-saved"); },
    async seal(_lease, value) { assert.equal(value.requestFingerprint, HASH); events.push("sealed"); return HASH; },
    async beginSubmit() { events.push("attempt-created"); return { attemptId: ID, idempotencyKey: ID, sealHash: HASH, requestFingerprint: HASH }; },
    async finish(_lease, completion) { completions.push(completion); events.push(completion.outcome); },
  };
  const materializer = { async materialize() { events.push("materialized"); return execution; } };
  const runtimeAdapter = { async open(input: { onBound(id: string, expires: string): Promise<void> }) { events.push("browser-open"); await input.onBound("provider-session", "2099-01-01T00:00:00Z"); return { page: {} as Page, sessionId: "provider-session", expiresAt: "2099-01-01T00:00:00Z", async release() { events.push("browser-release"); } }; } };
  return { events, completions, bytes, repository, materializer, runtimeAdapter };
}

test("autopilot stores exact final attempt before dispatch and receipt before terminal status", async () => {
  const f = fixture();
  const result = await coordinateApplicationAutopilot({ ...f, claim, async drive(task) {
    await task.begin({ reviewHash: HASH, requestFingerprint: HASH, review: { fields: [] } });
    f.events.push("employer-dispatch");
    return { kind: "CONFIRMED", receipt };
  } });
  assert.equal(result.kind, "CONFIRMED");
  assert.ok(f.events.indexOf("attempt-created") < f.events.indexOf("employer-dispatch"));
  assert.ok(f.events.indexOf("RECEIPT_OBSERVED") < f.events.indexOf("CONFIRMED"));
  assert.deepEqual(f.events.slice(-2), ["browser-release", "runtime-deleted"]);
  assert.deepEqual([...f.bytes], [0, 0, 0]);
  assert.equal(f.completions[0]?.receipt?.evidenceManifest.packetHash, HASH);
});

test("interruption after dispatch records uncertainty without another submission", async () => {
  const f = fixture();
  let dispatches = 0;
  const result = await coordinateApplicationAutopilot({ ...f, claim, async drive(task) {
    await task.begin({ reviewHash: HASH, requestFingerprint: HASH, review: {} });
    dispatches += 1;
    throw new Error("NETWORK_TIMEOUT");
  } });
  assert.equal(result.kind, "UNCERTAIN");
  assert.equal(dispatches, 1);
  assert.equal(f.completions[0]?.outcome, "UNCERTAIN");
});

test("candidate questions are persisted and browser is released without a short answer deadline", async () => {
  const f = fixture();
  await coordinateApplicationAutopilot({ ...f, claim, async drive(task) {
    await task.questions.requestQuestions({ binding: task.executionPackage.binding, questions: [{ fieldId: "field_1", fingerprint: HASH, label: "Available start date", kind: "TEXT", required: true, options: [], reasonCode: "MISSING_EXACT_ANSWER" }] });
    return { kind: "QUESTIONS_REQUIRED" };
  } });
  assert.ok(f.events.includes("questions-saved"));
  assert.ok(f.events.includes("runtime-deleted"));
  assert.equal(f.events.includes("attempt-created"), false);
  assert.equal(f.completions.length, 0);
});

test("reconciliation uses persisted receipt and does not open browser or materialize private files", async () => {
  const f = fixture();
  await coordinateApplicationAutopilot({ ...f, claim: { ...claim, mode: "RECONCILE", status: "RECONCILING", attemptId: ID, checkpoint: { observedReceipt: receipt } }, async drive() { throw new Error("must not run"); } });
  assert.equal(f.events.includes("browser-open"), false);
  assert.equal(f.events.includes("materialized"), false);
  assert.equal(f.completions[0]?.outcome, "CONFIRMED");
});

test("lost receipt with no existing browser cannot open a new form to retry", async () => {
  const f = fixture();
  await coordinateApplicationAutopilot({ ...f, claim: { ...claim, mode: "RECONCILE", status: "RECONCILING", attemptId: ID }, async drive() { throw new Error("must not run"); } });
  assert.equal(f.events.includes("browser-open"), false);
  assert.equal(f.completions[0]?.outcome, "UNCERTAIN");
});

test("a confirmed expired pre-submit browser rebuilds using persisted inputs", async () => {
  const f = fixture();
  let opens = 0;
  const baseOpen = f.runtimeAdapter.open;
  const driver = async (): Promise<DeliveryWorkerOutcome> => ({ kind: "FAILED_SAFE", reasonCode: "SYNTHETIC_STOP" });
  await coordinateApplicationAutopilot({ ...f, claim: { ...claim, runtimeReference: "expired", checkpoint: { runtimeProvisionKey: ID, runtimeState: "BOUND" } }, runtimeAdapter: { async open(input) { opens += 1; if (opens === 1) throw new Error("DELIVERY_RUNTIME_EXPIRED"); assert.equal(input.runtimeReference, null); assert.equal(input.allowCreate, true); return baseOpen(input); } }, drive: driver });
  assert.equal(opens, 2);
  assert.ok(f.events.includes("PROVISIONING"));
});

test("an employer's unmet code challenge after dispatch is recorded as not accepted, so the send can run again", async () => {
  const f = fixture();
  const result = await coordinateApplicationAutopilot({ ...f, claim, async drive(task) {
    await task.begin({ reviewHash: HASH, requestFingerprint: HASH, review: {} });
    return { kind: "NOT_ACCEPTED", reasonCode: "DELIVERY_EMAIL_VERIFICATION_TIMEOUT" };
  } });
  assert.equal(result.kind, "NOT_ACCEPTED");
  assert.deepEqual(f.completions, [{ outcome: "NOT_ACCEPTED", failureCode: "DELIVERY_EMAIL_VERIFICATION_TIMEOUT" }]);
  assert.ok(f.events.includes("runtime-deleted"));
});

test("a refusal claimed before any submission permission stays a safe stop", async () => {
  const f = fixture();
  await coordinateApplicationAutopilot({ ...f, claim, async drive() { return { kind: "NOT_ACCEPTED", reasonCode: "DELIVERY_EMAIL_VERIFICATION_TIMEOUT" }; } });
  assert.equal(f.completions[0]?.outcome, "FAILED_SAFE");
});
