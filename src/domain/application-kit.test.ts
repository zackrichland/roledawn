import assert from "node:assert/strict";
import test from "node:test";

import type { ApplicationSemanticValidationReport } from "./application-entailment.ts";
import type {
  ApplicationDraftingContext,
  ApplicationDraftingProposal,
  ApplicationDraftingValidationReport,
} from "./application-drafting.ts";
import type { ApplicationQualityReport } from "./application-quality.ts";
import {
  APPLICATION_KIT_MANIFEST_RELEASE,
  buildApplicationKitManifest,
  hashApplicationKitValue,
  type ApplicationArtifactVariant,
} from "./application-kit.ts";
import { buildOfficialJobPostingResearch } from "../server/applications/job-posting-research.ts";

function context(): ApplicationDraftingContext {
  return {
    schemaVersion: 1,
    source: {
      inputSnapshotId: "snapshot-1",
      snapshotHash: "a".repeat(64),
      capturedAt: "2026-08-16T10:00:00.000Z",
    },
    application: {
      workspaceId: "workspace-1",
      applicationId: "application-1",
      candidateId: "candidate-1",
    },
    policy: {
      tailoringMode: "REORDER_AND_TIGHTEN",
      writingPolicyRelease: "writing/1",
      assemblerRelease: "snapshot/1",
      exactFactsAllowedInNarrativeContext: false,
    },
    job: {
      jobId: "job-1",
      jobVersionId: "job-version-1",
      contentSha256: "b".repeat(64),
      employerName: "Northstar",
      title: "Platform Engineer",
      description: "Improve reliable systems.",
      location: "Remote",
      employmentType: "Full-time",
      workMode: "REMOTE",
      applyUrl: "https://jobs.example.com/platform-engineer",
    },
    sourceResume: {
      documentId: "document-1",
      documentVersionId: "document-version-1",
      textReviewId: "review-1",
      sourceSha256: "c".repeat(64),
      reviewedTextSha256: "d".repeat(64),
      reviewedText: "Built reliable systems for Acme.",
    },
    approvedNarrativeEvidence: [{
      evidenceVersionId: "evidence-1",
      documentId: "document-1",
      claimSha256: "e".repeat(64),
      claimText: "Built reliable systems for Acme.",
      usagePolicy: "RESUME_AND_COVER_LETTER",
    }],
    excludedExactFactCount: 1,
  };
}

function proposal(): ApplicationDraftingProposal {
  return {
    schemaVersion: 1,
    inputSnapshotId: "snapshot-1",
    snapshotHash: "a".repeat(64),
    target: { employerName: "Northstar", title: "Platform Engineer" },
    claims: [{
      claimId: "candidate-claim",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "RESUME",
      statement: "Built reliable systems for Acme.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-1" }],
    }, {
      claimId: "role-claim",
      claimType: "JOB_CONTEXT",
      surface: "COVER_LETTER",
      statement: "Northstar is hiring a Platform Engineer.",
      citations: [{ sourceType: "JOB_FIELD", field: "TITLE" }],
    }],
    resume: {
      handling: "TAILOR_FROM_APPROVED_EVIDENCE",
      mode: "REORDER_AND_TIGHTEN",
      text: "Built reliable systems for Acme.",
      claimIds: ["candidate-claim"],
    },
    coverLetter: {
      title: "Application for Platform Engineer",
      paragraphs: [{
        paragraphId: "paragraph-1",
        text: "I am interested in Northstar's Platform Engineer role.",
        claimIds: ["role-claim"],
      }],
    },
  };
}

const DETERMINISTIC_PASSED: ApplicationDraftingValidationReport = {
  deterministicChecksPassed: true,
  validationScope: "STRUCTURAL_CITATION_AND_POLICY_ONLY",
  semanticEntailmentStatus: "REQUIRED_NOT_RUN",
  mayPersistAsPassed: false,
  issues: [],
};

const SEMANTIC_PASSED: ApplicationSemanticValidationReport = {
  semanticChecksPassed: true,
  status: "PASSED",
  decisions: [{ claimId: "candidate-claim", verdict: "ENTAILED", reason: "Supported." }, {
    claimId: "role-claim", verdict: "ENTAILED", reason: "Supported.",
  }],
  issues: [],
};

const QUALITY_PASSED: ApplicationQualityReport = {
  evaluatorRelease: "roledawn-application-quality-evaluator/1",
  policyRelease: "writing/1",
  status: "PASSED_WITH_WARNINGS",
  readyForCandidateReview: true,
  researchCoverage: "OFFICIAL_POSTING_ONLY",
  measurements: {
    coverLetterWords: 140,
    coverLetterParagraphs: 3,
    coverLetterCandidateEvidenceClaims: 1,
    coverLetterRoleContextClaims: 1,
    tailoredResumeCandidateEvidenceClaims: 1,
    resumeRecognizedSections: 3,
    researchSources: 1,
  },
  issues: [{
    code: "RESEARCH_DEPTH_LIMITED",
    severity: "WARNING",
    surface: "RESEARCH",
    message: "Research is limited to the official posting.",
  }],
};

function artifacts(order: readonly ApplicationArtifactVariant[] = [
  "APPLICATION_PDF",
  "RESUME_PDF",
  "RESUME_DOCX",
  "COVER_LETTER_PDF",
  "COVER_LETTER_DOCX",
]) {
  const canonicalVariants: readonly ApplicationArtifactVariant[] = [
    "APPLICATION_PDF",
    "COVER_LETTER_DOCX",
    "COVER_LETTER_PDF",
    "RESUME_DOCX",
    "RESUME_PDF",
  ];
  return order.map((variant) => {
    const metadataIndex = canonicalVariants.indexOf(variant);
    return ({
    kind: variant === "APPLICATION_PDF" ? "OTHER" as const : variant.startsWith("RESUME") ? "RESUME" as const : "COVER_LETTER" as const,
    variant,
    displayName: `${variant.toLocaleLowerCase("en-US")}.${variant.endsWith("PDF") ? "pdf" : "docx"}`,
    mimeType: variant.endsWith("PDF")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byteSize: 1_000 + metadataIndex,
    sha256: String(metadataIndex + 1).repeat(64),
    rendererRelease: "renderer/1",
    qaStatus: "PASSED" as const,
    });
  });
}

function build(overrides: Partial<Parameters<typeof buildApplicationKitManifest>[0]> = {}) {
  const draftContext = context();
  return buildApplicationKitManifest({
    context: draftContext,
    research: buildOfficialJobPostingResearch(draftContext, "2026-08-16T10:05:00.000Z"),
    proposal: proposal(),
    draftingExecution: {
      adapterRelease: "drafting/1",
      modelRelease: "model/1",
      requestId: "draft-request-1",
      writingPolicy: { release: "owned-writing/1", sha256: "f".repeat(64), documents: ["evidence.md", "resume.md", "cover-letter.md", "voice.md", "quality.md"].map(name => ({ name, sha256: "a".repeat(64) })) },
    },
    deterministicValidation: DETERMINISTIC_PASSED,
    semanticValidation: SEMANTIC_PASSED,
    qualityValidation: QUALITY_PASSED,
    entailmentExecution: {
      adapterRelease: "entailment/1",
      modelRelease: "model/1",
      requestId: "entailment-request-1",
    },
    exactFactVersionIds: ["fact-2", "fact-1"],
    artifacts: artifacts(),
    ...overrides,
  });
}

test("builds an immutable, no-submit review manifest with exactly five QA-passed artifacts", () => {
  const kit = build();

  assert.equal(kit.manifest.release, APPLICATION_KIT_MANIFEST_RELEASE);
  assert.deepEqual(kit.manifest.authority, {
    state: "CANDIDATE_REVIEW_REQUIRED",
    application_submitted: false,
  });
  assert.deepEqual(kit.manifest.exact_fact_version_ids, ["fact-1", "fact-2"]);
  assert.deepEqual(kit.manifest.artifacts.map((artifact) => artifact.variant), [
    "APPLICATION_PDF",
    "COVER_LETTER_DOCX",
    "COVER_LETTER_PDF",
    "RESUME_DOCX",
    "RESUME_PDF",
  ]);
  assert.ok(kit.manifest.artifacts.every((artifact) => artifact.qa_status === "PASSED"));
  assert.match(kit.packetHash, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(kit.manifest), true);
  assert.equal(Object.isFrozen(kit.manifest.artifacts), true);
  assert.equal(JSON.stringify(kit.manifest).includes("application_submitted\":true"), false);
  assert.equal(kit.manifest.validation.quality.readyForCandidateReview, true);
});

test("canonicalizes input order so equivalent kits produce the same packet hash", () => {
  const first = build();
  const second = build({
    exactFactVersionIds: ["fact-1", "fact-2"],
    artifacts: artifacts([
      "APPLICATION_PDF",
      "COVER_LETTER_DOCX",
      "COVER_LETTER_PDF",
      "RESUME_DOCX",
      "RESUME_PDF",
    ]),
  });

  assert.equal(first.packetHash, second.packetHash);
  assert.deepEqual(first.manifest, second.manifest);
});

test("fails closed unless both deterministic and semantic validation passed", () => {
  assert.throws(
    () => build({
      deterministicValidation: { ...DETERMINISTIC_PASSED, deterministicChecksPassed: false },
    }),
    /APPLICATION_KIT_DETERMINISTIC_VALIDATION_FAILED/u,
  );
  assert.throws(
    () => build({
      semanticValidation: { ...SEMANTIC_PASSED, semanticChecksPassed: false, status: "BLOCKED" },
    }),
    /APPLICATION_KIT_SEMANTIC_VALIDATION_FAILED/u,
  );
  assert.throws(
    () => build({
      qualityValidation: { ...QUALITY_PASSED, readyForCandidateReview: false, status: "BLOCKED" },
    }),
    /APPLICATION_KIT_QUALITY_VALIDATION_FAILED/u,
  );
});

test("rejects missing, extra, or duplicate artifact variants", () => {
  assert.throws(
    () => build({ artifacts: artifacts().slice(0, 3) }),
    /APPLICATION_KIT_ARTIFACT_SET_INVALID/u,
  );
  assert.throws(
    () => build({ artifacts: [...artifacts(), artifacts()[0]!] }),
    /APPLICATION_KIT_ARTIFACT_SET_INVALID/u,
  );
  assert.throws(
    () => build({
      artifacts: artifacts([
        "RESUME_PDF",
        "RESUME_DOCX",
        "COVER_LETTER_PDF",
        "RESUME_PDF",
      ]),
    }),
    /APPLICATION_KIT_ARTIFACT_SET_INVALID/u,
  );
});

test("hashes equivalent object key order identically and rejects non-finite numbers", () => {
  assert.equal(
    hashApplicationKitValue({ beta: 2, alpha: 1 }),
    hashApplicationKitValue({ alpha: 1, beta: 2 }),
  );
  assert.throws(
    () => hashApplicationKitValue({ invalid: Number.NaN }),
    /numbers must be finite/u,
  );
});

test("new kits require the exact writing-policy content provenance", () => {
  assert.throws(() => build({ draftingExecution: { adapterRelease: "draft/1", modelRelease: "model/1", requestId: null } }), /WRITING_POLICY_PROVENANCE_REQUIRED/u);
  const first = build();
  const changed = build({ draftingExecution: { adapterRelease: "drafting/1", modelRelease: "model/1", requestId: "draft-request-1", writingPolicy: { ...first.manifest.drafting.writing_policy, sha256: "e".repeat(64) } } });
  assert.notEqual(first.packetHash, changed.packetHash);
});
