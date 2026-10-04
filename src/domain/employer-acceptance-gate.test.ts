import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEmployerAcceptance, type AcceptanceManifest, type AcceptanceRecords } from "./employer-acceptance-gate.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const candidateId = uuid(999);
const manifest: AcceptanceManifest = { candidateId, cases: Array.from({ length: 9 }, (_, index) => ({
  applicationId: uuid(index + 1), board: (["GREENHOUSE", "LEVER", "ASHBY"] as const)[Math.floor(index / 3)], role: `Job ${index + 1}`,
})) };
function records(): AcceptanceRecords {
  return {
    applications: manifest.cases.map(item => ({ id: item.applicationId, candidate_id: candidateId, status: "CONFIRMED" })),
    attempts: manifest.cases.map((item, index) => ({ id: uuid(index + 101), application_id: item.applicationId, status: "CONFIRMED" })),
    receipts: manifest.cases.map((item, index) => ({ id: uuid(index + 201), application_id: item.applicationId, attempt_id: uuid(index + 101),
      confirmation_reference: `https://employer.example/receipt/${index}`, receipt_hash: "a".repeat(64), confirmed_at: "2026-10-01T18:00:00Z",
      evidence_manifest: { attemptId: uuid(index + 101) } })),
  };
}

test("the nine-job gate requires a distinct receipt bound to every exact confirmed attempt", () => {
  const complete = evaluateEmployerAcceptance(manifest, records());
  assert.equal(complete.passed, true);
  assert.equal(complete.confirmed, 9);
  assert.deepEqual(complete.counts, { GREENHOUSE: 3, LEVER: 3, ASHBY: 3 });

  const missing = records();
  const noLeverReceipt = evaluateEmployerAcceptance(manifest, { ...missing, receipts: missing.receipts.filter(row => row.application_id !== uuid(4)) });
  assert.equal(noLeverReceipt.passed, false);
  assert.equal(noLeverReceipt.counts.LEVER, 2);
  assert.deepEqual(noLeverReceipt.cases[3].reasons, ["EMPLOYER_RECEIPT_COUNT_INVALID"]);

  const mismatched = records();
  const wrongAttempt = evaluateEmployerAcceptance(manifest, { ...mismatched,
    receipts: mismatched.receipts.map((row, index) => index === 6 ? { ...row, attempt_id: uuid(101) } : row) });
  assert.equal(wrongAttempt.cases[6].passed, false);
  assert.ok(wrongAttempt.cases[6].reasons.includes("RECEIPT_EVIDENCE_UNVERIFIED"));
});

test("an uncertain send, a different candidate, or a duplicate cohort entry keeps the gate red", () => {
  const base = records();
  const uncertain = evaluateEmployerAcceptance(manifest, { ...base,
    attempts: [...base.attempts, { id: uuid(500), application_id: uuid(7), status: "UNCERTAIN" }] });
  assert.equal(uncertain.cases[6].passed, false);
  assert.ok(uncertain.cases[6].reasons.includes("ATTEMPT_OUTCOME_UNCERTAIN"));

  const wrongOwner = evaluateEmployerAcceptance(manifest, { ...base,
    applications: base.applications.map((row, index) => index === 0 ? { ...row, candidate_id: uuid(998) } : row) });
  assert.equal(wrongOwner.cases[0].passed, false);
  assert.ok(wrongOwner.cases[0].reasons.includes("APPLICATION_IDENTITY_UNVERIFIED"));

  assert.throws(() => evaluateEmployerAcceptance({ ...manifest,
    cases: [...manifest.cases.slice(0, 8), manifest.cases[0]] }, base), /EMPLOYER_ACCEPTANCE_MANIFEST_INVALID/u);
});
