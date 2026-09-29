import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildApplicationInputSnapshot } from "../../domain/application-input-snapshot.ts";
import {
  ApplicationDraftingContextError,
  loadApplicationDraftingContext,
  type ApplicationDraftingContextReader,
  type ApplicationDraftingEvidenceVersionRow,
  type ApplicationDraftingJobVersionRow,
  type ApplicationDraftingResumeReviewRow,
  type ApplicationDraftingSnapshotRow,
} from "./drafting-context.ts";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const REVIEWED_RESUME = "Built 3 reliable systems for Acme.";
const EVIDENCE_ONE = "Built 3 reliable systems for Acme.";
const EVIDENCE_TWO = "Enjoys carefully improving operational systems.";

type Fixture = Readonly<{
  reader: ApplicationDraftingContextReader;
  snapshot: ApplicationDraftingSnapshotRow;
  job: ApplicationDraftingJobVersionRow;
  resume: ApplicationDraftingResumeReviewRow;
  evidence: readonly ApplicationDraftingEvidenceVersionRow[];
  calls: {
    snapshot: unknown[];
    job: unknown[];
    resume: unknown[];
    evidence: unknown[];
  };
}>;

function fixture(overrides: Readonly<{
  snapshot?: Partial<ApplicationDraftingSnapshotRow>;
  job?: Partial<ApplicationDraftingJobVersionRow>;
  resume?: Partial<ApplicationDraftingResumeReviewRow>;
  evidence?: readonly ApplicationDraftingEvidenceVersionRow[];
}> = {}): Fixture {
  const jobContentSha256 = "c".repeat(64);
  const sourceSha256 = "d".repeat(64);
  const evidence = overrides.evidence ?? [{
    workspaceId: "workspace-1",
    candidateId: "candidate-1",
    documentId: "document-1",
    textReviewId: "review-1",
    evidenceVersionId: "evidence-1",
    claimSha256: sha256(EVIDENCE_ONE),
    claimText: EVIDENCE_ONE,
    usagePolicy: "RESUME_AND_COVER_LETTER",
    candidateDisposition: "APPROVED",
    reviewStatus: "VERIFIED",
    reviewedAt: "2026-08-16T10:00:00.000Z",
  }, {
    workspaceId: "workspace-1",
    candidateId: "candidate-1",
    documentId: "document-1",
    textReviewId: "review-1",
    evidenceVersionId: "evidence-2",
    claimSha256: sha256(EVIDENCE_TWO),
    claimText: EVIDENCE_TWO,
    usagePolicy: "COVER_LETTER_ONLY",
    candidateDisposition: "APPROVED",
    reviewStatus: "VERIFIED",
    reviewedAt: "2026-08-16T10:00:00.000Z",
  }];
  const built = buildApplicationInputSnapshot({
    applicationId: "application-1",
    candidateId: "candidate-1",
    candidateInputVersion: 3,
    jobId: "job-1",
    jobVersionId: "job-version-1",
    jobContentSha256,
    tailoringMode: "REORDER_AND_TIGHTEN",
    submissionMode: "PER_APPLICATION_APPROVAL",
    resumeState: "READY",
    resume: {
      documentId: "document-1",
      documentVersionId: "document-version-1",
      textReviewId: "review-1",
      sourceSha256,
      reviewedTextSha256: sha256(REVIEWED_RESUME),
    },
    narrativeEvidence: evidence.map((entry) => ({
      evidenceVersionId: entry.evidenceVersionId,
      documentId: entry.documentId,
      claimSha256: entry.claimSha256,
      usagePolicy: entry.usagePolicy as "RESUME_AND_COVER_LETTER" | "COVER_LETTER_ONLY",
    })),
    exactFacts: [{ factVersionId: "exact-fact-version-never-loaded" }],
  });

  const snapshot: ApplicationDraftingSnapshotRow = {
    id: "snapshot-1",
    workspaceId: "workspace-1",
    applicationId: "application-1",
    preparationRunId: "preparation-run-1",
    candidateId: "candidate-1",
    jobId: "job-1",
    jobVersionId: "job-version-1",
    sourceDocumentId: "document-1",
    sourceDocumentVersionId: "document-version-1",
    sourceTextReviewId: "review-1",
    readiness: built.readiness,
    blockers: built.blockers,
    tailoringMode: "REORDER_AND_TIGHTEN",
    submissionMode: "PER_APPLICATION_APPROVAL",
    assemblerRelease: built.manifest.policy.assembler_release,
    policyRelease: built.manifest.policy.writing_policy_release,
    snapshotManifest: built.manifest,
    snapshotHash: built.snapshotHash,
    createdAt: "2026-08-16T10:00:00.000Z",
    ...overrides.snapshot,
  };
  const job: ApplicationDraftingJobVersionRow = {
    jobId: "job-1",
    jobVersionId: "job-version-1",
    contentSha256: jobContentSha256,
    employerName: "Northstar",
    title: "Platform Engineer",
    description: "Northstar needs a Platform Engineer to improve reliable systems.",
    location: "Remote",
    employmentType: "Full-time",
    workMode: "REMOTE",
    applyUrl: "https://jobs.example.com/platform-engineer",
    ...overrides.job,
  };
  const resume: ApplicationDraftingResumeReviewRow = {
    workspaceId: "workspace-1",
    candidateId: "candidate-1",
    documentId: "document-1",
    documentVersionId: "document-version-1",
    textReviewId: "review-1",
    sourceSha256,
    reviewedTextSha256: sha256(REVIEWED_RESUME),
    reviewedText: REVIEWED_RESUME,
    ...overrides.resume,
  };
  const calls = { snapshot: [], job: [], resume: [], evidence: [] } as Fixture["calls"];
  const reader: ApplicationDraftingContextReader = {
    async readInputSnapshot(input) {
      calls.snapshot.push(input);
      return snapshot;
    },
    async readJobVersion(input) {
      calls.job.push(input);
      return job;
    },
    async readResumeReview(input) {
      calls.resume.push(input);
      return resume;
    },
    async readEvidenceVersions(input) {
      calls.evidence.push(input);
      return evidence;
    },
  };
  return { reader, snapshot, job, resume, evidence, calls };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    assert.ok(error instanceof ApplicationDraftingContextError);
    return error.code;
  }
}

test("loads only exact immutable snapshot references and excludes exact facts", async () => {
  const value = fixture();
  const result = await loadApplicationDraftingContext(value.reader, {
    inputSnapshotId: "snapshot-1",
    applicationId: "application-1",
    preparationRunId: "preparation-run-1",
  });

  assert.deepEqual(value.calls.snapshot, [{
    inputSnapshotId: "snapshot-1",
    applicationId: "application-1",
    preparationRunId: "preparation-run-1",
  }]);
  assert.deepEqual(value.calls.job, [{ jobId: "job-1", jobVersionId: "job-version-1" }]);
  assert.deepEqual(value.calls.resume, [{
    workspaceId: "workspace-1",
    candidateId: "candidate-1",
    documentId: "document-1",
    documentVersionId: "document-version-1",
    textReviewId: "review-1",
  }]);
  assert.deepEqual(value.calls.evidence, [{
    workspaceId: "workspace-1",
    candidateId: "candidate-1",
    evidenceVersionIds: ["evidence-1", "evidence-2"],
  }]);
  assert.deepEqual(result.approvedNarrativeEvidence.map((entry) => entry.evidenceVersionId), [
    "evidence-1",
    "evidence-2",
  ]);
  assert.equal(result.excludedExactFactCount, 1);
  assert.equal(JSON.stringify(result).includes("exact-fact-version-never-loaded"), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.approvedNarrativeEvidence), true);
});

test("fails the snapshot integrity check before loading any downstream content", async () => {
  const value = fixture({ snapshot: { snapshotHash: "0".repeat(64) } });
  const code = await errorCode(loadApplicationDraftingContext(value.reader, {
    inputSnapshotId: "snapshot-1",
    applicationId: "application-1",
    preparationRunId: "preparation-run-1",
  }));

  assert.equal(code, "DRAFTING_SNAPSHOT_HASH_MISMATCH");
  assert.equal(value.calls.job.length, 0);
  assert.equal(value.calls.resume.length, 0);
  assert.equal(value.calls.evidence.length, 0);
});

test("never loads content from a preparation snapshot that is not ready", async () => {
  const value = fixture({ snapshot: { readiness: "BLOCKED", blockers: [] } });
  const code = await errorCode(loadApplicationDraftingContext(value.reader, {
    inputSnapshotId: "snapshot-1",
    applicationId: "application-1",
    preparationRunId: "preparation-run-1",
  }));

  assert.equal(code, "DRAFTING_SNAPSHOT_NOT_READY");
  assert.equal(value.calls.job.length, 0);
});

test("rejects reviewed résumé bytes that do not match the frozen hash", async () => {
  const value = fixture({ resume: { reviewedText: "Changed after the snapshot." } });
  const code = await errorCode(loadApplicationDraftingContext(value.reader, {
    inputSnapshotId: "snapshot-1",
    applicationId: "application-1",
    preparationRunId: "preparation-run-1",
  }));

  assert.equal(code, "DRAFTING_RESUME_REVIEW_MISMATCH");
  assert.equal(value.calls.evidence.length, 0);
});

test("rejects evidence content or policy drift from the immutable snapshot", async () => {
  const value = fixture();
  const originalReadEvidence = value.reader.readEvidenceVersions.bind(value.reader);
  const changedReader: ApplicationDraftingContextReader = {
    ...value.reader,
    async readEvidenceVersions(input) {
      const rows = await originalReadEvidence(input);
      return rows.map((entry) => entry.evidenceVersionId === "evidence-1"
        ? { ...entry, usagePolicy: "COVER_LETTER_ONLY" }
        : entry);
    },
  };
  const code = await errorCode(loadApplicationDraftingContext(changedReader, {
    inputSnapshotId: "snapshot-1",
    applicationId: "application-1",
    preparationRunId: "preparation-run-1",
  }));

  assert.equal(code, "DRAFTING_EVIDENCE_MISMATCH");
});
