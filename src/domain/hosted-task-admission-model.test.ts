import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_TASK_MODEL_MODE, reserveHostedTaskModel, beginHostedTaskAdmissionModel,
  checkHostedAdmissionReplayModel, acknowledgeHostedAdmissionModel, interruptHostedTaskModel,
  reconcileHostedTaskModel } from "./hosted-task-admission-model.ts";

const input = { applicationId: "10000000-0000-4000-8000-000000000001", sessionId: "sess_fixture",
  destinationUrl: "https://jobs.lever.co/fixture/10000000-0000-4000-8000-000000000002/apply",
  packetSha256: "a".repeat(64), admissionKey: "admit_fixture", message: "Exact synthetic task message" };
const reserved = () => reserveHostedTaskModel(input);
const evidence = { source: "VERIFIED_EMPLOYER_EVIDENCE" as const, applicationId: input.applicationId,
  destinationUrl: input.destinationUrl, packetSha256: input.packetSha256,
  outcome: "CONFIRMED" as const, evidenceSha256: "b".repeat(64) };

test("offline reservation binds exact input without storing candidate message or granting submission", () => {
  const state = reserved();
  assert.equal(HOSTED_TASK_MODEL_MODE, "OFFLINE_ONLY");
  assert.equal(state.phase, "RESERVED"); assert.equal(state.possibleEgress, false);
  assert.equal(state.automaticRetryAllowed, false);
  assert.equal(JSON.stringify(state).includes(input.message), false);
  assert.throws(() => { (state.binding as { packetSha256: string }).packetSha256 = "c".repeat(64); }, TypeError);
  assert.throws(() => reserveHostedTaskModel({ ...input, destinationUrl: "https://boards.greenhouse.io/fixture/jobs/123" }), /REFUSED/);
});

test("possible egress precedes dispatch and duplicate task starts are refused even without an application attempt", () => {
  const state = beginHostedTaskAdmissionModel(reserved());
  assert.equal(state.possibleEgress, true); assert.equal(state.phase, "ADMISSION_PENDING");
  assert.equal("applicationAttemptId" in state, false);
  assert.throws(() => beginHostedTaskAdmissionModel(state), /REFUSED/);
  const lost = interruptHostedTaskModel(state);
  assert.equal(lost.phase, "UNCERTAIN"); assert.equal(lost.automaticRetryAllowed, false);
  assert.throws(() => beginHostedTaskAdmissionModel(lost), /REFUSED/);
});

test("transport retry preserves session, admission key and exact message, and cannot clear uncertainty", () => {
  const lost = interruptHostedTaskModel(beginHostedTaskAdmissionModel(reserved()));
  assert.equal(checkHostedAdmissionReplayModel(lost, input), lost);
  for (const change of [{ sessionId: "sess_other" }, { admissionKey: "admit_new" }, { message: input.message + " " }]) {
    assert.throws(() => checkHostedAdmissionReplayModel(lost, { ...input, ...change }), /REFUSED/);
  }
  assert.equal(acknowledgeHostedAdmissionModel(lost), lost);
});

test("stream loss, lease expiry or terminal provider output cannot become FAILED_SAFE or trigger resend", () => {
  const active = acknowledgeHostedAdmissionModel(beginHostedTaskAdmissionModel(reserved()));
  const lost = interruptHostedTaskModel(active);
  assert.equal(lost.phase, "UNCERTAIN"); assert.equal(lost.evidenceSha256, null);
  assert.equal(lost.binding.admissionKey, input.admissionKey);
  assert.equal(interruptHostedTaskModel(lost).automaticRetryAllowed, false);
  assert.equal(interruptHostedTaskModel(reserved()).phase, "STOPPED");
});

test("only correctly bound external employer evidence reconciles; replayed receipt is idempotent", () => {
  const lost = interruptHostedTaskModel(beginHostedTaskAdmissionModel(reserved()));
  for (const change of [{ source: "MODEL_TEXT" }, { applicationId: "other" }, { destinationUrl: input.destinationUrl + "?other=1" }, { packetSha256: "c".repeat(64) }]) {
    assert.throws(() => reconcileHostedTaskModel(lost, { ...evidence, ...change } as typeof evidence), /REFUSED/);
  }
  const confirmed = reconcileHostedTaskModel(lost, evidence);
  assert.equal(confirmed.phase, "CONFIRMED"); assert.equal(confirmed.automaticRetryAllowed, false);
  assert.equal(reconcileHostedTaskModel(confirmed, evidence), confirmed);
  assert.throws(() => reconcileHostedTaskModel(confirmed, { ...evidence, evidenceSha256: "c".repeat(64) }), /REFUSED/);
  assert.throws(() => checkHostedAdmissionReplayModel(confirmed, input), /REFUSED/);
});

test("authoritative rejection closes this experimental task without altering production retry policy", () => {
  const state = beginHostedTaskAdmissionModel(reserved());
  const rejected = reconcileHostedTaskModel(state, { ...evidence, outcome: "NOT_ACCEPTED" });
  assert.equal(rejected.phase, "NOT_ACCEPTED"); assert.equal(rejected.automaticRetryAllowed, false);
  assert.throws(() => beginHostedTaskAdmissionModel(rejected), /REFUSED/);
  assert.throws(() => checkHostedAdmissionReplayModel(rejected, input), /REFUSED/);
});
