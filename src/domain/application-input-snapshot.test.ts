import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplicationInputSnapshot,
  parseApplicationInputBlockers,
} from "./application-input-snapshot.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function baseInput() {
  return {
    applicationId: "application-1",
    candidateId: "candidate-1",
    candidateInputVersion: 4,
    jobId: "job-1",
    jobVersionId: "job-version-1",
    jobContentSha256: HASH_A,
    tailoringMode: "REORDER_AND_TIGHTEN" as const,
    submissionMode: "PER_APPLICATION_APPROVAL" as const,
    resumeState: "READY" as const,
    resume: {
      documentId: "document-1",
      documentVersionId: "document-version-1",
      textReviewId: "text-review-1",
      sourceSha256: HASH_B,
      reviewedTextSha256: HASH_C,
    },
    narrativeEvidence: [{
      evidenceVersionId: "evidence-version-1",
      documentId: "document-1",
      claimSha256: HASH_A,
      usagePolicy: "RESUME_AND_COVER_LETTER" as const,
    }],
    exactFacts: [{
      factVersionId: "fact-version-1",
    }],
  };
}

test("builds a deterministic ready snapshot without raw candidate values", () => {
  const input = baseInput();
  const first = buildApplicationInputSnapshot(input);
  const second = buildApplicationInputSnapshot({
    ...input,
    narrativeEvidence: [...input.narrativeEvidence].reverse(),
    exactFacts: [...input.exactFacts].reverse(),
  });

  assert.equal(first.readiness, "READY_FOR_DRAFTING");
  assert.deepEqual(first.blockers, []);
  assert.equal(first.snapshotHash, second.snapshotHash);
  const serialized = JSON.stringify(first.manifest);
  assert.equal(serialized.includes("country"), false);
  assert.equal(serialized.includes("US"), false);
  assert.deepEqual(first.manifest.candidate.exact_facts, [{ fact_version_id: "fact-version-1" }]);
  assert.equal(first.manifest.candidate.application_input_version, 4);
  assert.equal(first.manifest.policy.exact_facts_allowed_in_narrative_context, false);
});

test("blocks preparation when the candidate has no reviewed resume", () => {
  const built = buildApplicationInputSnapshot({
    ...baseInput(),
    resumeState: "MISSING",
    resume: null,
    narrativeEvidence: [],
  });

  assert.equal(built.readiness, "BLOCKED");
  assert.deepEqual(built.blockers.map((blocker) => blocker.code), ["RESUME_REQUIRED"]);
  assert.equal(built.manifest.candidate.source_resume, null);
});

test("asks for evidence only after the resume itself is ready", () => {
  const built = buildApplicationInputSnapshot({
    ...baseInput(),
    narrativeEvidence: [],
  });

  assert.equal(built.readiness, "BLOCKED");
  assert.deepEqual(built.blockers.map((blocker) => blocker.code), ["EVIDENCE_REVIEW_REQUIRED"]);
});

test("binds readiness and blockers into the snapshot hash", () => {
  const missing = buildApplicationInputSnapshot({
    ...baseInput(),
    resumeState: "MISSING",
    resume: null,
    narrativeEvidence: [],
  });
  const needsReview = buildApplicationInputSnapshot({
    ...baseInput(),
    resumeState: "NEEDS_REVIEW",
    resume: null,
    narrativeEvidence: [],
  });

  assert.notEqual(missing.snapshotHash, needsReview.snapshotHash);
});

test("binds the candidate input version into the snapshot hash", () => {
  const first = buildApplicationInputSnapshot(baseInput());
  const next = buildApplicationInputSnapshot({
    ...baseInput(),
    candidateInputVersion: 5,
  });

  assert.notEqual(first.snapshotHash, next.snapshotHash);
});

test("rejects duplicate evidence references before persistence", () => {
  const input = baseInput();
  assert.throws(
    () => buildApplicationInputSnapshot({
      ...input,
      narrativeEvidence: [input.narrativeEvidence[0], input.narrativeEvidence[0]],
    }),
    /unique stable IDs/,
  );
});

test("parses only known blockers with safe in-product actions", () => {
  const blockers = parseApplicationInputBlockers([
    {
      code: "RESUME_REQUIRED",
      title: "Add your résumé",
      detail: "A résumé is required.",
      actionLabel: "Open résumé",
      actionHref: "/vault",
    },
    {
      code: "RESUME_REQUIRED",
      title: "Unsafe",
      detail: "Unsafe action",
      actionLabel: "Leave",
      actionHref: "https://example.com",
    },
  ]);

  assert.equal(blockers.length, 1);
  assert.equal(blockers[0]?.actionHref, "/vault");
});
