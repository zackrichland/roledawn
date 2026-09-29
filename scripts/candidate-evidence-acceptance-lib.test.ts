import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_EVIDENCE_ACCEPTANCE_ACKNOWLEDGEMENT,
  CANDIDATE_EVIDENCE_CLEANUP_ACKNOWLEDGEMENT,
  CANDIDATE_EVIDENCE_CLEANUP_SCHEMA_VERSION,
  CANDIDATE_EVIDENCE_PROJECT_REF,
  type CandidateEvidenceCleanupIdentity,
  assertCandidateEvidenceAcceptanceEmail,
  buildEvidenceProposalPassage,
  candidateEvidenceAcceptanceEmail,
  candidateEvidenceWorkspaceName,
  createCandidateEvidenceCleanupRecord,
  requireCandidateEvidenceAcceptanceConfig,
  requireCandidateEvidenceCleanupConfig,
  validateCandidateEvidenceCleanupRecord,
} from "./candidate-evidence-acceptance-lib.ts";
import { AcceptanceFailure } from "./milestone-zero-acceptance-lib.ts";

const runId = "evidence-20260816";
const alphaUserId = "00000000-0000-4000-8000-000000000001";
const alphaWorkspaceId = "10000000-0000-4000-8000-000000000001";
const alphaCandidateId = "20000000-0000-4000-8000-000000000001";
const documentId = "30000000-0000-4000-8000-000000000001";
const documentVersionId = "40000000-0000-4000-8000-000000000001";
const reviewId = "50000000-0000-4000-8000-000000000001";

const validEnvironment = {
  RUN_HOSTED_CANDIDATE_EVIDENCE_ACCEPTANCE:
    CANDIDATE_EVIDENCE_ACCEPTANCE_ACKNOWLEDGEMENT,
  NEXT_PUBLIC_SUPABASE_URL: `https://${CANDIDATE_EVIDENCE_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  SUPABASE_SECRET_KEY: "server-secret",
  ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF:
    CANDIDATE_EVIDENCE_PROJECT_REF,
  ACCEPTANCE_RUN_ID: runId,
} as unknown as NodeJS.ProcessEnv;

test("candidate-evidence acceptance stays inert without exact acknowledgement", () => {
  assert.throws(
    () =>
      requireCandidateEvidenceAcceptanceConfig({
        ...validEnvironment,
        RUN_HOSTED_CANDIDATE_EVIDENCE_ACCEPTANCE: undefined,
      }),
    /REFUSING_TO_RUN/,
  );
});

test("candidate-evidence cleanup has its own exact acknowledgement", () => {
  const cleanupEnvironment = {
    ...validEnvironment,
    RUN_HOSTED_CANDIDATE_EVIDENCE_ACCEPTANCE: undefined,
    RUN_HOSTED_CANDIDATE_EVIDENCE_CLEANUP:
      CANDIDATE_EVIDENCE_CLEANUP_ACKNOWLEDGEMENT,
  };
  assert.equal(
    requireCandidateEvidenceCleanupConfig(cleanupEnvironment).expectedProjectRef,
    CANDIDATE_EVIDENCE_PROJECT_REF,
  );
  assert.throws(
    () => requireCandidateEvidenceCleanupConfig({
      ...cleanupEnvironment,
      RUN_HOSTED_CANDIDATE_EVIDENCE_CLEANUP: undefined,
    }),
    /REFUSING_TO_CLEAN/,
  );
});

test("candidate-evidence acceptance is pinned to hosted HireWire", () => {
  const config = requireCandidateEvidenceAcceptanceConfig(validEnvironment);
  assert.equal(config.expectedProjectRef, CANDIDATE_EVIDENCE_PROJECT_REF);
  assert.equal(config.runId, runId);

  assert.throws(
    () =>
      requireCandidateEvidenceAcceptanceConfig({
        ...validEnvironment,
        NEXT_PUBLIC_SUPABASE_URL:
          "https://wrongprojectref00000.supabase.co",
      }),
    /SUPABASE_PROJECT_MISMATCH/,
  );
  assert.throws(
    () =>
      requireCandidateEvidenceAcceptanceConfig({
        ...validEnvironment,
        SUPABASE_SECRET_KEY: "your-server-only-supabase-secret-key",
      }),
    /SUPABASE_SECRET_KEY_IS_PLACEHOLDER/,
  );
});

test("acceptance identities are conspicuous and cleanup-safe", () => {
  const email = candidateEvidenceAcceptanceEmail(runId, "alpha");
  assert.equal(
    email,
    "roledawn-evidence-acceptance-evidence-20260816-alpha@acceptance.invalid",
  );
  assert.doesNotThrow(() => assertCandidateEvidenceAcceptanceEmail(email));
  assert.throws(
    () => assertCandidateEvidenceAcceptanceEmail("candidate@example.com"),
    AcceptanceFailure,
  );
});

test("passage fixtures use Unicode code-point offsets and stable hashes", () => {
  const reviewedText =
    "Profile ✨\nBuilt deterministic intake systems.\nReduced review time.";
  const first = buildEvidenceProposalPassage({
    textReviewId: reviewId,
    ordinal: 0,
    category: "EXPERIENCE",
    reviewedText,
    excerpt: "Built deterministic intake systems.",
  });
  const replay = buildEvidenceProposalPassage({
    textReviewId: reviewId,
    ordinal: 0,
    category: "EXPERIENCE",
    reviewedText,
    excerpt: "Built deterministic intake systems.",
  });

  assert.equal(first.start_offset, 10);
  assert.equal(first.end_offset, 45);
  assert.deepEqual(first, replay);
  assert.match(first.stable_key, /^[0-9a-f]{64}$/);
  assert.match(first.excerpt_sha256, /^[0-9a-f]{64}$/);
  assert.throws(
    () =>
      buildEvidenceProposalPassage({
        textReviewId: reviewId,
        ordinal: 1,
        category: "ACHIEVEMENT",
        reviewedText,
        excerpt: "Not in the reviewed source",
      }),
    /EVIDENCE_FIXTURE_EXCERPT_NOT_FOUND/,
  );
});

test("cleanup records accept only exact generated identities and storage paths", () => {
  const record = {
    schemaVersion: CANDIDATE_EVIDENCE_CLEANUP_SCHEMA_VERSION,
    runId,
    projectRef: CANDIDATE_EVIDENCE_PROJECT_REF,
    createdAt: "2026-08-16T00:00:00.000Z",
    identities: [
      {
        label: "alpha",
        userId: alphaUserId,
        email: candidateEvidenceAcceptanceEmail(runId, "alpha"),
        workspaceId: alphaWorkspaceId,
        candidateId: alphaCandidateId,
        workspaceName: candidateEvidenceWorkspaceName(runId, "alpha"),
      },
    ],
    storageObjectPaths: [
      `${alphaWorkspaceId}/${alphaCandidateId}/resumes/${documentId}/${documentVersionId}.pdf`,
    ],
  };

  assert.deepEqual(validateCandidateEvidenceCleanupRecord(record), record);
  assert.throws(
    () =>
      validateCandidateEvidenceCleanupRecord({
        ...record,
        identities: [
          {
            ...record.identities[0],
            email: "candidate@example.com",
          },
        ],
      }),
    /CLEANUP_RECORD_IDENTITY_INVALID/,
  );
  assert.throws(
    () =>
      validateCandidateEvidenceCleanupRecord({
        ...record,
        storageObjectPaths: ["../../unsafe.pdf"],
      }),
    /CLEANUP_RECORD_STORAGE_PATH_INVALID/,
  );

  const circularClient: Record<string, unknown> = {};
  circularClient.client = circularClient;
  const identityWithRuntimeClient = {
    ...record.identities[0],
    client: circularClient,
  } as unknown as CandidateEvidenceCleanupIdentity;
  const serialized = createCandidateEvidenceCleanupRecord(
    requireCandidateEvidenceAcceptanceConfig(validEnvironment),
    [identityWithRuntimeClient],
    record.storageObjectPaths,
  );
  assert.doesNotThrow(() => JSON.stringify(serialized));
  assert.deepEqual(
    Object.keys(serialized.identities[0]!).sort(),
    ["candidateId", "email", "label", "userId", "workspaceId", "workspaceName"],
  );
});
