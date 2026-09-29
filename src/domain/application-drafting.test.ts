import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplicationDraftingRequest,
  parseApplicationDraftingAdapterOutput,
  validateApplicationDraftingProposal,
  type ApplicationDraftingAdapter,
  type ApplicationDraftingContext,
  type ApplicationDraftingProposal,
  type ApplicationDraftingWritingPolicy,
} from "./application-drafting.ts";

const SNAPSHOT_HASH = "a".repeat(64);
const RESUME_HASH = "b".repeat(64);

function context(
  overrides: Partial<ApplicationDraftingContext> = {},
): ApplicationDraftingContext {
  return {
    schemaVersion: 1,
    source: {
      inputSnapshotId: "snapshot-1",
      snapshotHash: SNAPSHOT_HASH,
      capturedAt: "2026-08-16T10:00:00.000Z",
    },
    application: {
      workspaceId: "workspace-1",
      applicationId: "application-1",
      candidateId: "candidate-secret-id",
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
      contentSha256: "c".repeat(64),
      employerName: "Northstar",
      title: "Platform Engineer",
      description: "Northstar needs a Platform Engineer to improve reliable systems.",
      location: "Remote",
      employmentType: "Full-time",
      workMode: "REMOTE",
      applyUrl: "https://jobs.example.com/platform-engineer",
    },
    sourceResume: {
      documentId: "document-1",
      documentVersionId: "document-version-1",
      textReviewId: "review-1",
      sourceSha256: "d".repeat(64),
      reviewedTextSha256: RESUME_HASH,
      reviewedText: "Built 3 reliable systems for Acme.",
    },
    approvedNarrativeEvidence: [{
      evidenceVersionId: "evidence-resume",
      documentId: "document-1",
      claimSha256: "e".repeat(64),
      claimText: "Built 3 reliable systems for Acme.",
      usagePolicy: "RESUME_AND_COVER_LETTER",
    }, {
      evidenceVersionId: "evidence-letter",
      documentId: "document-1",
      claimSha256: "f".repeat(64),
      claimText: "Enjoys carefully improving operational systems.",
      usagePolicy: "COVER_LETTER_ONLY",
    }],
    excludedExactFactCount: 4,
    ...overrides,
  };
}

const WRITING_POLICY: ApplicationDraftingWritingPolicy = {
  policyRelease: "writing/1",
  prohibitedPhrases: ["delve", "game changer"],
  maxResumeWords: 100,
  minCoverLetterWords: 10,
  maxCoverLetterWords: 100,
  minCoverLetterParagraphs: 1,
  maxCoverLetterParagraphs: 6,
  minCandidateEvidenceClaimsInCoverLetter: 1,
  minRoleContextClaimsInCoverLetter: 1,
  minCandidateEvidenceClaimsInTailoredResume: 1,
};

function validProposal(): ApplicationDraftingProposal {
  return {
    schemaVersion: 1,
    inputSnapshotId: "snapshot-1",
    snapshotHash: SNAPSHOT_HASH,
    target: {
      employerName: "Northstar",
      title: "Platform Engineer",
    },
    claims: [{
      claimId: "resume-evidence",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "RESUME",
      statement: "Built 3 reliable systems for Acme.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-resume" }],
    }, {
      claimId: "letter-evidence",
      claimType: "CANDIDATE_EVIDENCE",
      surface: "COVER_LETTER",
      statement: "Enjoys carefully improving operational systems.",
      citations: [{ sourceType: "CANDIDATE_EVIDENCE", evidenceVersionId: "evidence-letter" }],
    }, {
      claimId: "role-context",
      claimType: "JOB_CONTEXT",
      surface: "COVER_LETTER",
      statement: "Northstar is hiring a Platform Engineer.",
      citations: [
        { sourceType: "JOB_FIELD", field: "EMPLOYER_NAME" },
        { sourceType: "JOB_FIELD", field: "TITLE" },
      ],
    }],
    resume: {
      handling: "TAILOR_FROM_APPROVED_EVIDENCE",
      mode: "REORDER_AND_TIGHTEN",
      text: "Built 3 reliable systems for Acme.",
      claimIds: ["resume-evidence"],
    },
    coverLetter: {
      title: "Application for Platform Engineer",
      paragraphs: [{
        paragraphId: "paragraph-1",
        text: "I enjoy carefully improving operational systems and am interested in Northstar's Platform Engineer role.",
        claimIds: ["letter-evidence", "role-context"],
      }],
    },
  };
}

test("builds the only provider-safe request without candidate identity or exact facts", async () => {
  const request = buildApplicationDraftingRequest(context(), WRITING_POLICY);
  const serialized = JSON.stringify(request);

  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.approvedNarrativeEvidence), true);
  assert.equal(serialized.includes("candidate-secret-id"), false);
  assert.equal(serialized.includes("excludedExactFactCount"), false);
  assert.equal(serialized.includes("exactFacts"), false);
  assert.equal(request.resume.handling, "TAILOR_FROM_APPROVED_EVIDENCE");
  assert.deepEqual(Object.keys(request.resume), ["handling", "tailoringMode", "reviewedTextSha256"]);
  assert.deepEqual(Object.keys(request.approvedNarrativeEvidence[0] ?? {}), [
    "evidenceVersionId",
    "claimText",
    "usagePolicy",
  ]);

  let received = "";
  const fakeAdapter: ApplicationDraftingAdapter = {
    adapterRelease: "fake/1",
    async draft(input) {
      received = JSON.stringify(input);
      return {
        status: "COMPLETED",
        proposal: validProposal(),
        execution: {
          adapterRelease: "fake/1",
          modelRelease: "deterministic-fixture/1",
          requestId: null,
        },
      };
    },
  };

  const result = await fakeAdapter.draft(request);
  assert.equal(result.status, "COMPLETED");
  assert.equal(received.includes("candidate-secret-id"), false);
  assert.equal(received.includes("exact"), false);
});

test("refuses to build a provider request under a different writing-policy release", () => {
  assert.throws(
    () => buildApplicationDraftingRequest(context(), { ...WRITING_POLICY, policyRelease: "writing/2" }),
    /does not match the frozen input snapshot/u,
  );
});

test("accepts a snapshot-bound proposal whose claims use only allowed citations", () => {
  const report = validateApplicationDraftingProposal(context(), WRITING_POLICY, validProposal());

  assert.equal(report.deterministicChecksPassed, true);
  assert.equal(report.semanticEntailmentStatus, "REQUIRED_NOT_RUN");
  assert.equal(report.mayPersistAsPassed, false);
  assert.equal(report.validationScope, "STRUCTURAL_CITATION_AND_POLICY_ONLY");
  assert.deepEqual(report.issues, []);
});

test("blocks cover-letter-only evidence from supporting résumé copy", () => {
  const proposal = validProposal();
  const report = validateApplicationDraftingProposal(context(), WRITING_POLICY, {
    ...proposal,
    claims: proposal.claims.map((claim) => claim.claimId === "resume-evidence" ? {
      ...claim,
      citations: [{ sourceType: "CANDIDATE_EVIDENCE" as const, evidenceVersionId: "evidence-letter" }],
    } : claim),
  });

  assert.equal(report.deterministicChecksPassed, false);
  assert.ok(report.issues.some((entry) => entry.code === "EVIDENCE_USE_NOT_ALLOWED"));
});

test("blocks target drift, unsupported numbers, and prohibited filler", () => {
  const proposal = validProposal();
  const report = validateApplicationDraftingProposal(context(), WRITING_POLICY, {
    ...proposal,
    target: { employerName: "Other Company", title: proposal.target.title },
    coverLetter: {
      ...proposal.coverLetter,
      paragraphs: [{
        ...proposal.coverLetter.paragraphs[0]!,
        text: "I would delve into this game changer after building 99 systems.",
      }],
    },
  });

  assert.equal(report.deterministicChecksPassed, false);
  assert.ok(report.issues.some((entry) => entry.code === "TARGET_MISMATCH"));
  assert.ok(report.issues.some((entry) => entry.code === "UNSUPPORTED_NUMBER"));
  assert.ok(report.issues.filter((entry) => entry.code === "WRITING_POLICY_VIOLATION").length >= 2);
});

test("generated modes cannot borrow facts from unapproved raw résumé text", () => {
  const rawOnlyContext = context({
    sourceResume: {
      ...context().sourceResume,
      reviewedText: "Privately claimed 77 launches in the uploaded résumé.",
    },
  });
  const proposal = validProposal();
  const report = validateApplicationDraftingProposal(rawOnlyContext, WRITING_POLICY, {
    ...proposal,
    coverLetter: {
      ...proposal.coverLetter,
      paragraphs: [{
        ...proposal.coverLetter.paragraphs[0]!,
        text: "I led 77 launches and am interested in the role.",
      }],
    },
  });

  assert.equal(report.deterministicChecksPassed, false);
  assert.ok(report.issues.some((entry) => entry.code === "UNSUPPORTED_NUMBER"));
});

test("does not treat sentence punctuation after a supported year as part of the number", () => {
  const punctuatedContext = context({
    approvedNarrativeEvidence: [{
      evidenceVersionId: "evidence-resume",
      documentId: "document-1",
      claimSha256: "e".repeat(64),
      claimText: "Worked in regulated operations through 2020.",
      usagePolicy: "RESUME_AND_COVER_LETTER",
    }, context().approvedNarrativeEvidence[1]!],
  });
  const proposal = validProposal();
  assert.equal(proposal.resume.handling, "TAILOR_FROM_APPROVED_EVIDENCE");
  if (proposal.resume.handling !== "TAILOR_FROM_APPROVED_EVIDENCE") {
    assert.fail("fixture must use a generated résumé mode");
  }
  const report = validateApplicationDraftingProposal(
    punctuatedContext,
    WRITING_POLICY,
    {
      ...proposal,
      claims: proposal.claims.map((claim) => claim.claimId === "resume-evidence"
        ? { ...claim, statement: "Worked in regulated operations through 2020." }
        : claim),
      resume: {
        ...proposal.resume,
        text: "Worked in regulated operations through 2020.",
      },
    },
  );

  assert.equal(report.issues.some((entry) => entry.code === "UNSUPPORTED_NUMBER"), false);
});

test("AS_UPLOADED is byte-for-text exact and cannot attach generated résumé claims", () => {
  const exactContext = context({
    policy: {
      tailoringMode: "AS_UPLOADED",
      writingPolicyRelease: "writing/1",
      assemblerRelease: "snapshot/1",
      exactFactsAllowedInNarrativeContext: false,
    },
  });
  const request = buildApplicationDraftingRequest(exactContext, WRITING_POLICY);
  assert.deepEqual(request.resume, {
    handling: "PRESERVE_SERVER_SIDE",
    tailoringMode: "AS_UPLOADED",
    reviewedTextSha256: RESUME_HASH,
  });
  assert.equal(Object.hasOwn(request.resume, "reviewedText"), false);

  const proposal = validProposal();
  const report = validateApplicationDraftingProposal(exactContext, WRITING_POLICY, {
    ...proposal,
    resume: {
      handling: "PRESERVE_SERVER_SIDE",
      mode: "AS_UPLOADED",
      text: `${exactContext.sourceResume.reviewedText} `,
      claimIds: ["resume-evidence"],
    },
  } as unknown as ApplicationDraftingProposal);

  assert.equal(report.deterministicChecksPassed, false);
  assert.ok(report.issues.some((entry) => entry.code === "SOURCE_RESUME_CHANGED"));
});

function completedOutput(proposal: ApplicationDraftingProposal = validProposal()): unknown {
  return {
    status: "COMPLETED",
    proposal,
    execution: {
      adapterRelease: "fake/1",
      modelRelease: "fixture/1",
      requestId: null,
    },
  };
}

test("strictly parses a bounded completed adapter result before validation", () => {
  const parsed = parseApplicationDraftingAdapterOutput(completedOutput());

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.status, "COMPLETED");
  assert.equal(Object.isFrozen(parsed.value), true);
  if (parsed.value.status === "COMPLETED") {
    assert.equal(parsed.value.proposal.resume.handling, "TAILOR_FROM_APPROVED_EVIDENCE");
  }
});

test("preserves owned writing provenance and rejects incomplete or substituted policy records", () => {
  const writingPolicy = { release: "owned-writing/1", sha256: "a".repeat(64),
    documents: ["evidence.md", "resume.md", "cover-letter.md", "voice.md", "quality.md"]
      .map(name => ({ name, sha256: "b".repeat(64) })) };
  const output = { status: "COMPLETED", proposal: validProposal(), execution: {
    adapterRelease: "fake/1", modelRelease: "fixture/1", requestId: null, writingPolicy } };
  const parsed = parseApplicationDraftingAdapterOutput(output);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.execution.writingPolicy, writingPolicy);
  for (const invalid of [
    { ...writingPolicy, release: "invalid release" },
    { ...writingPolicy, sha256: "bad" },
    { ...writingPolicy, documents: writingPolicy.documents.slice(1) },
    { ...writingPolicy, documents: writingPolicy.documents.map(() => writingPolicy.documents[0]) },
    { ...writingPolicy, extraInstruction: "untrusted" },
  ]) {
    assert.equal(parseApplicationDraftingAdapterOutput({ ...output, execution: { ...output.execution, writingPolicy: invalid } }).ok, false);
  }
});

test("fails closed for unknown fields, invalid enums, oversized arrays, and preserve-mode text", () => {
  const proposal = validProposal();
  const malformed = {
    status: "COMPLETED",
    unexpectedRoot: true,
    execution: {
      adapterRelease: "fake/1",
      modelRelease: "fixture/1",
      requestId: null,
    },
    proposal: {
      ...proposal,
      claims: Array.from({ length: 65 }, () => proposal.claims[0]),
      resume: {
        handling: "PRESERVE_SERVER_SIDE",
        mode: "AS_UPLOADED",
        text: "Provider must not reconstruct this résumé.",
        claimIds: [],
      },
      coverLetter: {
        ...proposal.coverLetter,
        paragraphs: [{
          paragraphId: "paragraph-1",
          text: "x".repeat(4_001),
          claimIds: [],
        }],
      },
    },
  };

  const parsed = parseApplicationDraftingAdapterOutput(malformed);
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.error.code, "ADAPTER_OUTPUT_INVALID");
  assert.ok(parsed.error.issues.some((entry) => entry.path === "output.unexpectedRoot"));
  assert.ok(parsed.error.issues.some((entry) => entry.path === "proposal.claims"));
  assert.ok(parsed.error.issues.some((entry) => entry.path === "proposal.resume.text"));
  assert.ok(parsed.error.issues.some((entry) => entry.path.endsWith(".text") && entry.message.includes("4000")));
});

test("malformed or hostile unknown output returns issues instead of throwing", () => {
  assert.doesNotThrow(() => parseApplicationDraftingAdapterOutput(null));
  const nullResult = parseApplicationDraftingAdapterOutput(null);
  assert.equal(nullResult.ok, false);

  const hostile = Object.defineProperty({}, "status", {
    enumerable: true,
    get() {
      throw new Error("hostile getter");
    },
  });
  assert.doesNotThrow(() => parseApplicationDraftingAdapterOutput(hostile));
  const hostileResult = parseApplicationDraftingAdapterOutput(hostile);
  assert.equal(hostileResult.ok, false);
});
