import assert from "node:assert/strict";
import test from "node:test";

import type { ApplicationSemanticValidationReport } from "./application-entailment.ts";
import type {
  ApplicationDraftingContext,
  ApplicationDraftingProposal,
  ApplicationDraftingValidationReport,
} from "./application-drafting.ts";
import {
  APPLICATION_QUALITY_EVALUATOR_RELEASE,
  evaluateApplicationQuality,
} from "./application-quality.ts";
import { ROLEDAWN_APPLICATION_WRITING_POLICY } from "./application-writing-policy.ts";
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
      writingPolicyRelease: ROLEDAWN_APPLICATION_WRITING_POLICY.policyRelease,
      assemblerRelease: "snapshot/1",
      exactFactsAllowedInNarrativeContext: false,
    },
    job: {
      jobId: "job-1",
      jobVersionId: "job-version-1",
      contentSha256: "b".repeat(64),
      employerName: "Northstar Systems",
      title: "Platform Engineer",
      description: "Build reliable software for operations teams.",
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
      reviewedText: "Built and shipped reliable operational systems.",
    },
    approvedNarrativeEvidence: [{
      evidenceVersionId: "evidence-1",
      documentId: "document-1",
      claimSha256: "e".repeat(64),
      claimText: "Built and shipped reliable operational systems.",
      usagePolicy: "RESUME_AND_COVER_LETTER",
    }],
    excludedExactFactCount: 2,
  };
}

const DETERMINISTIC_PASSED: ApplicationDraftingValidationReport = {
  deterministicChecksPassed: true,
  validationScope: "STRUCTURAL_CITATION_AND_POLICY_ONLY",
  semanticEntailmentStatus: "REQUIRED_NOT_RUN",
  mayPersistAsPassed: false,
  issues: [],
};

function proposal(): ApplicationDraftingProposal {
  const paragraphs = [
    "Northstar Systems needs a Platform Engineer who can turn operational requirements into software that teams will use. I have done that work by sitting with operators, mapping the decisions they make each day, and shipping a system that reflects those decisions instead of forcing a generic process on them.",
    "In one program, I built and shipped reliable operational systems after tracing the handoffs that caused work to stall. I translated those findings into a focused release, tested it with the people doing the work, and used their feedback to tighten the workflow. The result was a system the operating team could trust in daily use.",
    "That experience fits the Platform Engineer role because the work calls for both implementation and careful judgment about the surrounding process. I would bring Northstar Systems a practical way to learn the workflow, choose the smallest useful intervention, ship it, and keep improving it from real operating evidence.",
  ];
  return {
    schemaVersion: 1,
    inputSnapshotId: "snapshot-1",
    snapshotHash: "a".repeat(64),
    target: { employerName: "Northstar Systems", title: "Platform Engineer" },
    claims: [{
      claimId: "resume-proof",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "RESUME",
      statement: "Built and shipped reliable operational systems.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-1" }],
    }, {
      claimId: "letter-proof",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "COVER_LETTER",
      statement: "Built and shipped reliable operational systems.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-1" }],
    }, {
      claimId: "role-context",
      claimType: "JOB_CONTEXT",
      surface: "COVER_LETTER",
      statement: "Northstar Systems is hiring a Platform Engineer.",
      citations: [{ sourceType: "JOB_FIELD", field: "TITLE" }],
    }],
    resume: {
      handling: "TAILOR_FROM_APPROVED_EVIDENCE",
      mode: "REORDER_AND_TIGHTEN",
      text: [
        "PROFILE",
        "Platform engineer focused on reliable operational software.",
        "EXPERIENCE",
        "Built and shipped reliable operational systems.",
        "SKILLS",
        "Workflow mapping, implementation, testing",
      ].join("\n"),
      claimIds: ["resume-proof"],
    },
    coverLetter: {
      title: "Application for Platform Engineer",
      paragraphs: paragraphs.map((text, index) => ({
        paragraphId: `paragraph-${index + 1}`,
        text,
        claimIds: index === 1 ? ["letter-proof"] : ["role-context"],
      })),
    },
  };
}

function semanticPassed(value: ApplicationDraftingProposal): ApplicationSemanticValidationReport {
  return {
    semanticChecksPassed: true,
    status: "PASSED",
    decisions: value.claims.map((claim) => ({
      claimId: claim.claimId,
      verdict: "ENTAILED" as const,
      reason: "Supported by the frozen source.",
    })),
    issues: [],
  };
}

function evaluate(value: ApplicationDraftingProposal = proposal()) {
  const draftContext = context();
  return evaluateApplicationQuality({
    context: draftContext,
    research: buildOfficialJobPostingResearch(draftContext, "2026-08-16T10:05:00.000Z"),
    proposal: value,
    writingPolicy: ROLEDAWN_APPLICATION_WRITING_POLICY,
    deterministicValidation: DETERMINISTIC_PASSED,
    semanticValidation: semanticPassed(value),
  });
}

test("passes a source-bound, role-specific packet for candidate review while naming limited research", () => {
  const report = evaluate();

  assert.equal(report.evaluatorRelease, APPLICATION_QUALITY_EVALUATOR_RELEASE);
  assert.equal(report.readyForCandidateReview, true);
  assert.equal(report.status, "PASSED_WITH_WARNINGS");
  assert.equal(report.researchCoverage, "OFFICIAL_POSTING_ONLY");
  assert.equal(report.measurements.coverLetterParagraphs, 3);
  assert.equal(report.measurements.coverLetterCandidateEvidenceClaims, 1);
  assert.equal(report.measurements.coverLetterRoleContextClaims, 1);
  assert.equal(report.measurements.tailoredResumeCandidateEvidenceClaims, 1);
  assert.equal(report.measurements.resumeRecognizedSections, 3);
  assert.deepEqual(report.issues.map((entry) => entry.code), ["RESEARCH_DEPTH_LIMITED"]);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.issues), true);
});

test("blocks generic thin copy without candidate proof or the exact role target", () => {
  const base = proposal();
  const thin: ApplicationDraftingProposal = {
    ...base,
    coverLetter: {
      ...base.coverLetter,
      paragraphs: [{
        paragraphId: "paragraph-1",
        text: "I am writing to apply because this opportunity sounds interesting.",
        claimIds: ["role-context"],
      }],
    },
  };
  const report = evaluate(thin);

  assert.equal(report.status, "BLOCKED");
  assert.equal(report.readyForCandidateReview, false);
  assert.ok(report.issues.some((entry) => entry.code === "COVER_LETTER_LENGTH_OUT_OF_RANGE"));
  assert.ok(report.issues.some((entry) => entry.code === "COVER_LETTER_PARAGRAPH_COUNT_OUT_OF_RANGE"));
  assert.ok(report.issues.some((entry) => entry.code === "COVER_LETTER_CANDIDATE_PROOF_MISSING"));
  assert.ok(report.issues.some((entry) => entry.code === "COVER_LETTER_TARGET_MISSING"));
  assert.ok(report.issues.some((entry) => entry.code === "CEREMONIAL_OPENING"));
});

test("blocks unresolved placeholders and internal workflow metadata from candidate documents", () => {
  const base = proposal();
  assert.equal(base.resume.handling, "TAILOR_FROM_APPROVED_EVIDENCE");
  if (base.resume.handling !== "TAILOR_FROM_APPROVED_EVIDENCE") {
    assert.fail("Fixture must use a tailored résumé.");
  }
  const unsafe: ApplicationDraftingProposal = {
    ...base,
    resume: {
      ...base.resume,
      text: `${base.resume.text}\n{{insert metric}}`,
    },
    coverLetter: {
      ...base.coverLetter,
      paragraphs: base.coverLetter.paragraphs.map((paragraph, index) => index === 0
        ? { ...paragraph, text: `${paragraph.text} evidenceVersionId should never appear here.` }
        : paragraph),
    },
  };
  const report = evaluate(unsafe);

  assert.equal(report.readyForCandidateReview, false);
  assert.ok(report.issues.some((entry) => entry.code === "CANDIDATE_FACING_PLACEHOLDER"));
  assert.ok(report.issues.some((entry) => entry.code === "INTERNAL_METADATA_EXPOSED"));
});

test("fails closed when source validation or the frozen policy binding is missing", () => {
  const draftContext = context();
  const value = proposal();
  const report = evaluateApplicationQuality({
    context: draftContext,
    research: buildOfficialJobPostingResearch(draftContext, "2026-08-16T10:05:00.000Z"),
    proposal: value,
    writingPolicy: { ...ROLEDAWN_APPLICATION_WRITING_POLICY, policyRelease: "other-policy/1" },
    deterministicValidation: { ...DETERMINISTIC_PASSED, deterministicChecksPassed: false },
    semanticValidation: { ...semanticPassed(value), semanticChecksPassed: false, status: "BLOCKED" },
  });

  assert.equal(report.status, "BLOCKED");
  assert.ok(report.issues.some((entry) => entry.code === "SOURCE_VALIDATION_INCOMPLETE"));
  assert.ok(report.issues.some((entry) => entry.code === "POLICY_BINDING_MISMATCH"));
});
