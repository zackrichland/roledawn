import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import type { AgentQuestionDescriptor } from "../../domain/application-agent-questions.ts";
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
    async requestQuestions(_lease, questions) { assert.ok(questions.length <= 1); events.push(questions.length ? "questions-saved" : "obsolete-questions-superseded"); },
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
  assert.ok(f.events.indexOf("obsolete-questions-superseded") < f.events.indexOf("sealed"));
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
  assert.equal(f.events.includes("obsolete-questions-superseded"), false);
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

test("remembered answers for askable fields are fetched once per field and filled in the same pass", async () => {
  const f = fixture();
  const asked: string[][] = [];
  const remembered = { answerId: ID, fieldId: "field_1", fingerprint: HASH, value: "No" };
  const repository = { ...f.repository, async prefillAnswers(_lease: unknown, questions: readonly { fingerprint: string }[]) {
    asked.push(questions.map((question) => question.fingerprint));
    return questions.some((question) => question.fingerprint === HASH) ? [remembered] : [];
  } };
  const descriptor = { fieldId: "field_1", fingerprint: HASH, label: "Will you require sponsorship?", kind: "SINGLE_SELECT" as const, required: true,
    options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }], reasonCode: "MISSING_EXACT_ANSWER" as const };
  const loaded: unknown[] = [];
  await coordinateApplicationAutopilot({ ...f, repository, claim, async drive(task) {
    loaded.push(await task.questions.loadAnswers({ binding: task.executionPackage.binding, questions: [descriptor] }));
    loaded.push(await task.questions.loadAnswers({ binding: task.executionPackage.binding, questions: [descriptor] }));
    return { kind: "FAILED_SAFE", reasonCode: "TEST_STOP" };
  } });
  assert.deepEqual(asked, [[HASH]], "each field is looked up once per run");
  assert.deepEqual(loaded, [[remembered], [remembered]]);
});

test("standing answers are recorded and returned once; a failed lookup asks the candidate instead of failing the send", async () => {
  const f = fixture();
  const descriptor: AgentQuestionDescriptor = { fieldId: "field_2", fingerprint: HASH, label: "What was your GPA?", kind: "TEXT", required: true,
    options: [], reasonCode: "MISSING_EXACT_ANSWER" };
  const recorded = { answerId: ID, fieldId: "field_2", fingerprint: HASH, value: "3.5" };
  const events: { stage: string; outcome: string }[] = [];
  let reads = 0; let fail = false;
  const repository = { ...f.repository,
    async readStandingAnswers() { reads += 1; return { answers: [{ id: ID, topic: "GPA", answer: "3.5" }], job: null }; },
    async recordStandingAnswers(_lease: unknown, proposals: readonly { value: unknown; basis: readonly string[] }[]) {
      assert.deepEqual(proposals.map((item) => [item.value, item.basis]), [["3.5", [ID]]]);
      return [recorded];
    },
    async recordEvent(_claim: unknown, event: { stage: string; outcome: string }) { events.push(event); },
  };
  const standingAnswers = { async resolve({ questions }: { questions: readonly AgentQuestionDescriptor[] }) {
    if (fail) throw new Error("STANDING_ANSWERS_RESPONSE_INCOMPLETE");
    return questions.map((question) => ({ descriptor: question, value: "3.5", basis: [ID] }));
  } };
  const results: unknown[] = [];
  await coordinateApplicationAutopilot({ ...f, repository, claim, standingAnswers, async drive(task) {
    const binding = task.executionPackage.binding;
    results.push(await task.questions.resolveSavedAnswers!({ binding, questions: [descriptor] }));
    // Already answered: no second lookup.
    results.push(await task.questions.resolveSavedAnswers!({ binding, questions: [descriptor] }));
    results.push(await task.questions.loadAnswers({ binding, questions: [descriptor] }));
    fail = true;
    results.push(await task.questions.resolveSavedAnswers!({ binding, questions: [{ ...descriptor, fieldId: "field_3", fingerprint: "b".repeat(64) }] }));
    return { kind: "FAILED_SAFE", reasonCode: "TEST_STOP" };
  } });
  assert.deepEqual(results, [[recorded], [], [recorded], []]);
  assert.equal(reads, 1, "standing answers are read once per run");
  assert.deepEqual(events.filter((event) => event.stage === "standing_answers").map((event) => event.outcome), ["OK", "FAILED"]);
});

test("a refused standing answer never costs the others: the batch falls back to one answer at a time", async () => {
  const f = fixture();
  const good: AgentQuestionDescriptor = { fieldId: "field_4", fingerprint: "c".repeat(64), label: "Previously employed here?", kind: "SINGLE_SELECT", required: true,
    options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }], reasonCode: "MISSING_EXACT_ANSWER" };
  const bad: AgentQuestionDescriptor = { ...good, fieldId: "field_5", fingerprint: "d".repeat(64), label: "Will you require sponsorship?", reasonCode: "SENSITIVE_REQUIRES_CANDIDATE" };
  const events: { stage: string; outcome: string; code?: string | null }[] = [];
  const refusal = Object.assign(new Error("This application could not be updated. Reload to check its status."), { code: "APPLICATION_AUTOPILOT_STANDING_ANSWERS_INVALID" });
  const repository = { ...f.repository,
    async readStandingAnswers() { return { answers: [{ id: ID, topic: "Previously employed", answer: "No" }], job: null }; },
    async recordStandingAnswers(_lease: unknown, proposals: readonly { descriptor: AgentQuestionDescriptor }[]) {
      if (proposals.some((item) => item.descriptor.fieldId === "field_5")) throw refusal;
      return proposals.map((item) => ({ answerId: ID, fieldId: item.descriptor.fieldId, fingerprint: item.descriptor.fingerprint, value: "no" }));
    },
    async recordEvent(_claim: unknown, event: { stage: string; outcome: string; code?: string | null }) { events.push(event); },
  };
  const standingAnswers = { async resolve({ questions }: { questions: readonly AgentQuestionDescriptor[] }) {
    return questions.map((question) => ({ descriptor: question, value: "no", basis: [ID] }));
  } };
  let resolved: unknown;
  await coordinateApplicationAutopilot({ ...f, repository, claim, standingAnswers, async drive(task) {
    resolved = await task.questions.resolveSavedAnswers!({ binding: task.executionPackage.binding, questions: [good, bad] });
    return { kind: "FAILED_SAFE", reasonCode: "TEST_STOP" };
  } });
  assert.deepEqual(resolved, [{ answerId: ID, fieldId: "field_4", fingerprint: "c".repeat(64), value: "no" }]);
  assert.deepEqual(events.filter((event) => event.stage === "standing_answers").map((event) => [event.outcome, event.code]), [["OK", "APPLICATION_AUTOPILOT_STANDING_ANSWERS_INVALID"]]);
});
