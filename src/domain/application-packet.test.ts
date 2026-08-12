import assert from "node:assert/strict";
import test from "node:test";

import {
  assessApplicationPacketEvidence,
  createApplicationPacketInputSnapshot,
  prepareApplicationPacket,
  validateApplicationPacketProposal,
} from "./application-packet.ts";
import type {
  ApplicationPacketInputSnapshot,
  ApplicationPacketProposal,
  ApplicationPacketSnapshotInput,
  PacketResult,
} from "./application-packet.ts";

function expectOk<T>(result: PacketResult<T>): T {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected a successful packet result.");
  return result.value;
}

function snapshotInput(): ApplicationPacketSnapshotInput {
  return {
    applicationId: "application-1",
    candidateId: "candidate-1",
    capturedAt: "2026-08-12T15:00:00.000Z",
    job: {
      jobId: "job-1",
      jobVersionId: "job-version-3",
      sourceUrl: " https://Jobs.Example.com/solutions-engineer#apply ",
      company: "Example Systems",
      title: "Solutions Engineer",
      location: "Washington, DC",
      description: "Build reliable customer workflows with product and engineering teams.",
      requirements: [
        { requirementId: "requirement-2", text: "Explain technical systems clearly to customers." },
        { requirementId: "requirement-1", text: "Ship production software across product boundaries." },
      ],
    },
    candidate: {
      sourceResume: {
        artifactReference: "artifact:candidate-1/resume",
        artifactVersionId: "resume-version-7",
        contentHash: `sha256:${"a".repeat(64)}`,
        filename: "candidate-resume.pdf",
        sections: [
          {
            sectionId: "experience",
            heading: "Experience",
            items: [
              {
                itemId: "human-touch-platform",
                text: "Built a regulated healthcare platform across a Swift iOS app, JavaScript dashboard, and PostgreSQL-backed services.",
              },
              {
                itemId: "human-touch-workflows",
                text: "Shipped bounded AI workflows with deterministic eligibility checks and revalidation.",
              },
            ],
          },
          {
            sectionId: "skills",
            heading: "Skills",
            items: [
              { itemId: "technical-stack", text: "Swift, JavaScript, PostgreSQL, product discovery" },
            ],
          },
        ],
      },
      reviewedFacts: [
        {
          factId: "fact-platform",
          factVersionId: "fact-platform-v2",
          label: "Healthcare platform scope",
          value: "Built a regulated healthcare platform spanning a Swift iOS app, JavaScript dashboard, and PostgreSQL services.",
          sensitivity: "STANDARD",
          allowedUses: ["RESUME", "COVER_LETTER"],
          review: {
            status: "REVIEWED",
            reviewedAt: "2026-08-12T14:00:00.000Z",
            reviewedBy: "CANDIDATE",
          },
          provenance: {
            documentId: "resume-document",
            documentVersionId: "resume-version-7",
            passageId: "experience-1",
          },
        },
        {
          factId: "fact-workflows",
          factVersionId: "fact-workflows-v1",
          label: "Bounded AI workflows",
          value: "Shipped bounded AI workflows with deterministic eligibility checks and revalidation.",
          sensitivity: "STANDARD",
          allowedUses: ["COVER_LETTER"],
          review: {
            status: "REVIEWED",
            reviewedAt: "2026-08-12T14:02:00.000Z",
            reviewedBy: "CANDIDATE",
          },
          provenance: {
            documentId: "resume-document",
            documentVersionId: "resume-version-7",
            passageId: "experience-2",
          },
        },
      ],
    },
    writingPolicy: {
      policyVersionId: "no-slop-policy-v1",
      prohibitedPhrases: ["game-changing", "delve", "passionate about leveraging"],
      maxCoverLetterWords: 180,
      maxResumeItemWords: 35,
    },
  };
}

function snapshot(): ApplicationPacketInputSnapshot {
  return expectOk(createApplicationPacketInputSnapshot(snapshotInput()));
}

function validProposal(inputSnapshot: ApplicationPacketInputSnapshot): ApplicationPacketProposal {
  return {
    proposalId: "proposal-1",
    createdAt: "2026-08-12T15:05:00.000Z",
    snapshotHash: inputSnapshot.snapshotHash,
    claims: [
      {
        claimId: "claim-role",
        claimType: "JOB_CONTEXT",
        statement: "Example Systems is hiring a Solutions Engineer.",
        citations: [
          { sourceType: "JOB_FIELD", field: "COMPANY" },
          { sourceType: "JOB_FIELD", field: "TITLE" },
        ],
      },
      {
        claimId: "claim-platform",
        claimType: "CANDIDATE_EVIDENCE",
        statement: "The candidate built a regulated healthcare platform across mobile, web, and PostgreSQL services.",
        citations: [{ sourceType: "CANDIDATE_FACT", factVersionId: "fact-platform-v2" }],
      },
      {
        claimId: "claim-fit",
        claimType: "JOB_CONTEXT",
        statement: "The role needs production software work across product boundaries.",
        citations: [{ sourceType: "JOB_REQUIREMENT", requirementId: "requirement-1" }],
      },
    ],
    resume: {
      mode: "REORDER_AND_TIGHTEN",
      sourceArtifactVersionId: inputSnapshot.candidate.sourceResume.artifactVersionId,
      sections: [
        {
          sectionId: "experience",
          heading: "Experience",
          items: [
            {
              itemId: "human-touch-platform",
              text: "Built a regulated healthcare platform across Swift, JavaScript, and PostgreSQL.",
              claimIds: ["claim-platform"],
            },
          ],
        },
        {
          sectionId: "skills",
          heading: "Skills",
          items: [
            {
              itemId: "technical-stack",
              text: "Swift, JavaScript, PostgreSQL, product discovery",
              claimIds: [],
            },
          ],
        },
      ],
    },
    coverLetter: {
      title: "Application for Solutions Engineer",
      paragraphs: [
        {
          paragraphId: "salutation",
          kind: "SALUTATION",
          text: "Hello Example Systems team,",
          claimIds: [],
        },
        {
          paragraphId: "motivation",
          kind: "ROLE_MOTIVATION",
          text: "I am applying for the Solutions Engineer role because it joins customer context with hands-on product work.",
          claimIds: ["claim-role", "claim-fit"],
        },
        {
          paragraphId: "evidence",
          kind: "EVIDENCE",
          text: "At Human Touch, I built a regulated healthcare platform across a Swift app, JavaScript dashboard, and PostgreSQL-backed services.",
          claimIds: ["claim-platform"],
        },
        {
          paragraphId: "closing",
          kind: "CLOSING",
          text: "Thank you for considering my application.",
          claimIds: [],
        },
      ],
    },
  };
}

test("captures normalized, immutable, hash-bound job and reviewed-fact inputs", () => {
  const input = snapshotInput();
  const captured = expectOk(createApplicationPacketInputSnapshot(input));

  assert.equal(captured.job.sourceUrl, "https://jobs.example.com/solutions-engineer");
  assert.deepEqual(captured.job.requirements.map((item) => item.requirementId), ["requirement-1", "requirement-2"]);
  assert.match(captured.snapshotHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(captured.candidate.reviewedFacts), true);

  (input as unknown as { job: { company: string } }).job.company = "Tampered company";
  assert.equal(captured.job.company, "Example Systems");
});

test("rejects unreviewed, duplicate, unsafe, or unhashed snapshot inputs", () => {
  const input = snapshotInput();
  const invalid = {
    ...input,
    job: {
      ...input.job,
      sourceUrl: "http://localhost/private",
      requirements: [input.job.requirements[0], input.job.requirements[0]],
    },
    candidate: {
      ...input.candidate,
      sourceResume: { ...input.candidate.sourceResume, contentHash: "sha256:short" as `sha256:${string}` },
      reviewedFacts: [
        {
          ...input.candidate.reviewedFacts[0],
          review: { ...input.candidate.reviewedFacts[0].review, reviewedAt: "not-a-date" },
        },
      ],
    },
  };
  const result = createApplicationPacketInputSnapshot(invalid);

  assert.equal(result.ok, false);
  if (result.ok) return;
  const codes = new Set(result.error.issues.map((entry) => entry.code));
  assert.equal(codes.has("INPUT_INVALID"), true);
  assert.equal(codes.has("DUPLICATE_ID"), true);
  assert.equal(codes.has("HASH_INVALID"), true);
  assert.equal(codes.has("UNREVIEWED_FACT"), true);
});

test("builds one immutable manifest with deterministic proposal, artifact, diff, and packet hashes", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const first = expectOk(prepareApplicationPacket(inputSnapshot, proposal, "packet-1"));
  const replay = expectOk(prepareApplicationPacket(inputSnapshot, proposal, "packet-1"));

  assert.equal(first.immutable, true);
  assert.deepEqual(first, replay);
  assert.equal(Object.isFrozen(first.manifest), true);
  assert.match(first.manifest.proposalHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.manifest.materialDiffHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.manifest.packetHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.manifest.snapshotHash, inputSnapshot.snapshotHash);
  assert.equal(first.manifest.sourceResumeArtifactVersionId, "resume-version-7");
  assert.deepEqual(
    first.manifest.claimCitations.find((entry) => entry.claimId === "claim-platform")?.citations,
    [{ sourceType: "CANDIDATE_FACT", factVersionId: "fact-platform-v2" }],
  );
  assert.deepEqual(
    first.materialDiff.resume.changes.map((change) => `${change.kind}:${change.itemId}`),
    [
      "REWRITTEN:human-touch-platform",
      "REMOVED:human-touch-workflows",
    ],
  );
  assert.equal(first.materialDiff.resume.changes[0].claimIds[0], "claim-platform");
  assert.equal(first.materialDiff.coverLetter.paragraphCount, 4);
});

test("fails closed when proposal snapshot, claim, or source résumé references do not match", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const invalid: ApplicationPacketProposal = {
    ...proposal,
    snapshotHash: `sha256:${"b".repeat(64)}`,
    resume: { ...proposal.resume, sourceArtifactVersionId: "resume-version-other" },
    coverLetter: {
      ...proposal.coverLetter,
      paragraphs: proposal.coverLetter.paragraphs.map((paragraph) =>
        paragraph.kind === "EVIDENCE"
          ? { ...paragraph, claimIds: ["claim-does-not-exist"] }
          : paragraph,
      ),
    },
  };
  const report = validateApplicationPacketProposal(inputSnapshot, invalid);

  assert.equal(report.valid, false);
  const codes = new Set(report.issues.map((entry) => entry.code));
  assert.equal(codes.has("SNAPSHOT_MISMATCH"), true);
  assert.equal(codes.has("SOURCE_RESUME_MISMATCH"), true);
  assert.equal(codes.has("UNKNOWN_CLAIM"), true);
});

test("requires citations for added or rewritten résumé content and material cover-letter paragraphs", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const invalid: ApplicationPacketProposal = {
    ...proposal,
    resume: {
      ...proposal.resume,
      sections: proposal.resume.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, claimIds: [] })),
      })),
    },
    coverLetter: {
      ...proposal.coverLetter,
      paragraphs: proposal.coverLetter.paragraphs.map((paragraph) => ({ ...paragraph, claimIds: [] })),
    },
  };
  const report = validateApplicationPacketProposal(inputSnapshot, invalid);

  assert.equal(report.valid, false);
  assert.equal(report.issues.filter((entry) => entry.code === "CITATION_REQUIRED").length >= 3, true);
  assert.equal(report.issues.some((entry) => entry.code === "UNUSED_CLAIM"), true);
});

test("enforces candidate-approved fact uses independently for résumé and cover letter", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const workflowClaim = {
    claimId: "claim-workflows",
    claimType: "CANDIDATE_EVIDENCE" as const,
    statement: "The candidate shipped bounded AI workflows with deterministic eligibility checks.",
    citations: [{ sourceType: "CANDIDATE_FACT" as const, factVersionId: "fact-workflows-v1" }],
  };
  const invalid: ApplicationPacketProposal = {
    ...proposal,
    claims: [...proposal.claims, workflowClaim],
    resume: {
      ...proposal.resume,
      sections: proposal.resume.sections.map((section) =>
        section.sectionId === "experience"
          ? {
              ...section,
              items: [
                ...section.items,
                {
                  itemId: "human-touch-workflows",
                  text: "Shipped bounded AI workflows with deterministic eligibility checks.",
                  claimIds: ["claim-workflows"],
                },
              ],
            }
          : section,
      ),
    },
  };
  const report = validateApplicationPacketProposal(inputSnapshot, invalid);

  assert.equal(report.valid, false);
  assert.equal(report.issues.some((entry) => entry.code === "FACT_USE_NOT_ALLOWED"), true);
});

test("never accepts job text as evidence of candidate experience", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const invalid: ApplicationPacketProposal = {
    ...proposal,
    resume: {
      ...proposal.resume,
      sections: proposal.resume.sections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.itemId === "human-touch-platform"
            ? { ...item, claimIds: ["claim-fit"] }
            : item,
        ),
      })),
    },
  };
  const report = validateApplicationPacketProposal(inputSnapshot, invalid);

  assert.equal(report.valid, false);
  assert.equal(report.issues.some((entry) =>
    entry.code === "CITATION_INVALID" && entry.message.includes("never job text")
  ), true);
});

test("records section renames and moves in the material approval diff", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const changed: ApplicationPacketProposal = {
    ...proposal,
    resume: {
      ...proposal.resume,
      mode: "REWRITE_FROM_VERIFIED_FACTS",
      sections: [
        { ...proposal.resume.sections[1], heading: "Selected skills" },
        proposal.resume.sections[0],
      ],
    },
  };
  const packet = expectOk(prepareApplicationPacket(inputSnapshot, changed, "packet-sections"));

  assert.deepEqual(
    packet.materialDiff.resume.sectionChanges.map((change) => `${change.kind}:${change.sectionId}`),
    ["MOVED:experience", "RENAMED:skills", "MOVED:skills"],
  );
});

test("enforces each résumé tailoring mode without weakening the evidence gate", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const asUploaded: ApplicationPacketProposal = {
    ...proposal,
    resume: {
      mode: "AS_UPLOADED",
      sourceArtifactVersionId: inputSnapshot.candidate.sourceResume.artifactVersionId,
      sections: inputSnapshot.candidate.sourceResume.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, claimIds: [] })),
      })),
    },
  };
  assert.equal(validateApplicationPacketProposal(inputSnapshot, asUploaded).valid, true);

  const reorderedWithNewItem: ApplicationPacketProposal = {
    ...proposal,
    resume: {
      ...proposal.resume,
      sections: proposal.resume.sections.map((section) =>
        section.sectionId === "experience"
          ? {
              ...section,
              items: [
                ...section.items,
                { itemId: "invented-item", text: "Built an unsupported system.", claimIds: ["claim-platform"] },
              ],
            }
          : section,
      ),
    },
  };
  const report = validateApplicationPacketProposal(inputSnapshot, reorderedWithNewItem);
  assert.equal(report.valid, false);
  assert.equal(report.issues.some((entry) => entry.code === "RESUME_MODE_VIOLATION"), true);
});

test("applies promoted no-slop phrase and word-limit checks deterministically", () => {
  const inputSnapshot = snapshot();
  const proposal = validProposal(inputSnapshot);
  const invalid: ApplicationPacketProposal = {
    ...proposal,
    coverLetter: {
      ...proposal.coverLetter,
      paragraphs: proposal.coverLetter.paragraphs.map((paragraph) =>
        paragraph.kind === "ROLE_MOTIVATION"
          ? { ...paragraph, text: "I am passionate about leveraging this game-changing opportunity." }
          : paragraph,
      ),
    },
    resume: {
      ...proposal.resume,
      sections: proposal.resume.sections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.itemId === "human-touch-platform"
            ? { ...item, text: `${item.text} ${"word ".repeat(40)}` }
            : item,
        ),
      })),
    },
  };
  const report = validateApplicationPacketProposal(inputSnapshot, invalid);

  assert.equal(report.valid, false);
  assert.equal(report.issues.filter((entry) => entry.code === "WRITING_POLICY_VIOLATION").length >= 3, true);
});

test("detects a modified snapshot even when its original hash is retained", () => {
  const inputSnapshot = snapshot();
  const tampered = {
    ...inputSnapshot,
    job: { ...inputSnapshot.job, title: "Different role" },
  };
  const report = validateApplicationPacketProposal(tampered, validProposal(inputSnapshot));

  assert.equal(report.valid, false);
  assert.equal(report.issues.some((entry) => entry.code === "SNAPSHOT_MISMATCH"), true);
});

test("turns missing ordinary facts into explicit non-model review blockers", () => {
  const readiness = assessApplicationPacketEvidence(snapshot(), [
    {
      requirementId: "need-certification",
      prompt: "Confirm whether you hold the certification requested by the employer.",
      documentUse: "RESUME",
      sensitivity: "STANDARD",
      factVersionId: null,
    },
  ]);

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.resolvedFactVersionIds, []);
  assert.deepEqual(readiness.blockers, [{
    requirementId: "need-certification",
    code: "MISSING_REVIEWED_FACT",
    prompt: "Confirm whether you hold the certification requested by the employer.",
    resolution: "CANDIDATE_REVIEW_REQUIRED",
    mayModelResolve: false,
  }]);
});

test("never infers a sensitive answer and accepts it only after candidate review", () => {
  const inputSnapshot = snapshot();
  const missing = assessApplicationPacketEvidence(inputSnapshot, [
    {
      requirementId: "need-work-authorization",
      prompt: "Confirm your work authorization for this application.",
      documentUse: "COVER_LETTER",
      sensitivity: "SENSITIVE",
      factVersionId: null,
    },
  ]);
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.blockers[0], {
    requirementId: "need-work-authorization",
    code: "SENSITIVE_CANDIDATE_INPUT_REQUIRED",
    prompt: "Confirm your work authorization for this application.",
    resolution: "CANDIDATE_INPUT_REQUIRED",
    mayModelResolve: false,
  });

  const baseOperatorInput = snapshotInput();
  const sensitiveOperatorFact = {
      factId: "fact-work-authorization",
      factVersionId: "fact-work-authorization-v1",
      label: "Work authorization",
      value: "Candidate-supplied answer fixture",
      sensitivity: "SENSITIVE" as const,
      allowedUses: ["COVER_LETTER" as const],
      review: {
        status: "REVIEWED" as const,
        reviewedAt: "2026-08-12T14:03:00.000Z",
        reviewedBy: "AUTHORIZED_OPERATOR" as const,
      },
      provenance: {
        documentId: "candidate-answer",
        documentVersionId: "candidate-answer-v1",
        passageId: "work-authorization",
      },
  };
  const operatorReviewedInput: ApplicationPacketSnapshotInput = {
    ...baseOperatorInput,
    candidate: {
      ...baseOperatorInput.candidate,
      reviewedFacts: [...baseOperatorInput.candidate.reviewedFacts, sensitiveOperatorFact],
    },
  };
  const operatorReviewedSnapshot = expectOk(createApplicationPacketInputSnapshot(operatorReviewedInput));
  const stillBlocked = assessApplicationPacketEvidence(operatorReviewedSnapshot, [
    {
      requirementId: "need-work-authorization",
      prompt: "Confirm your work authorization for this application.",
      documentUse: "COVER_LETTER",
      sensitivity: "SENSITIVE",
      factVersionId: "fact-work-authorization-v1",
    },
  ]);
  assert.equal(stillBlocked.ready, false);
  assert.equal(stillBlocked.blockers[0].code, "SENSITIVE_CANDIDATE_INPUT_REQUIRED");

  const baseCandidateInput = snapshotInput();
  const candidateReviewedInput: ApplicationPacketSnapshotInput = {
    ...baseCandidateInput,
    candidate: {
      ...baseCandidateInput.candidate,
      reviewedFacts: [...baseCandidateInput.candidate.reviewedFacts, {
      ...sensitiveOperatorFact,
      review: {
        status: "REVIEWED",
        reviewedAt: "2026-08-12T14:04:00.000Z",
        reviewedBy: "CANDIDATE",
      },
    }],
    },
  };
  const candidateReviewedSnapshot = expectOk(createApplicationPacketInputSnapshot(candidateReviewedInput));
  const ready = assessApplicationPacketEvidence(candidateReviewedSnapshot, [
    {
      requirementId: "need-work-authorization",
      prompt: "Confirm your work authorization for this application.",
      documentUse: "COVER_LETTER",
      sensitivity: "SENSITIVE",
      factVersionId: "fact-work-authorization-v1",
    },
  ]);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.resolvedFactVersionIds, ["fact-work-authorization-v1"]);
  assert.deepEqual(ready.blockers, []);
});
