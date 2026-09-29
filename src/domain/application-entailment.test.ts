import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApplicationDraftingContext,
  ApplicationDraftingProposal,
  ApplicationDraftingResearchClaim,
} from "./application-drafting.ts";
import {
  APPLICATION_ENTAILMENT_SCHEMA_RELEASE,
  buildApplicationEntailmentRequest,
  validateApplicationEntailment,
  type ApplicationEntailmentAdapterResult,
} from "./application-entailment.ts";

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
    excludedExactFactCount: 2,
  };
}

const RESEARCH_CLAIMS: readonly ApplicationDraftingResearchClaim[] = [{
  researchClaimId: "research-role",
  text: "Northstar is hiring for the Platform Engineer role.",
}];

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
      claimId: "job-claim",
      claimType: "JOB_CONTEXT",
      surface: "COVER_LETTER",
      statement: "The role is remote and focuses on reliable systems.",
      citations: [
        { sourceType: "JOB_FIELD", field: "LOCATION" },
        { sourceType: "JOB_FIELD", field: "DESCRIPTION" },
      ],
    }, {
      claimId: "research-claim",
      claimType: "RESEARCH_CONTEXT",
      surface: "COVER_LETTER",
      statement: "Northstar is hiring for the Platform Engineer role.",
      citations: [{ sourceType: "RESEARCH_CLAIM", researchClaimId: "research-role" }],
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
        text: "The remote role focuses on reliable systems.",
        claimIds: ["job-claim"],
      }, {
        paragraphId: "paragraph-2",
        text: "Northstar is hiring for the Platform Engineer role.",
        claimIds: ["research-claim"],
      }],
    },
  };
}

test("builds frozen claims and actual document segments from only their attached cited source text", () => {
  const request = buildApplicationEntailmentRequest(context(), proposal(), RESEARCH_CLAIMS);

  assert.equal(request.schemaRelease, APPLICATION_ENTAILMENT_SCHEMA_RELEASE);
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.claims), true);
  assert.equal(Object.isFrozen(request.claims[0]?.sources), true);
  assert.deepEqual(request.claims.slice(0, 3), [{
    claimId: "candidate-claim",
    statement: "Built reliable systems for Acme.",
    sources: [{
      sourceKey: "candidate-evidence:evidence-1",
      text: "Built reliable systems for Acme.",
    }],
  }, {
    claimId: "job-claim",
    statement: "The role is remote and focuses on reliable systems.",
    sources: [
      { sourceKey: "job-field:EMPLOYER_NAME", text: "Northstar" },
      { sourceKey: "job-field:TITLE", text: "Platform Engineer" },
      { sourceKey: "job-field:DESCRIPTION", text: "Northstar needs a Platform Engineer to improve reliable systems." },
      { sourceKey: "job-field:LOCATION", text: "Remote" },
      { sourceKey: "job-field:APPLY_URL", text: "https://jobs.example.com/platform-engineer" },
    ],
  }, {
    claimId: "research-claim",
    statement: "Northstar is hiring for the Platform Engineer role.",
    sources: [{
      sourceKey: "research-claim:research-role",
      text: "Northstar is hiring for the Platform Engineer role.",
    }],
  }]);
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes("candidate-1"), false);
  assert.equal(serialized.includes("document-1"), false);
});

test("passes only when every frozen claim has exactly one entailed decision", () => {
  const request = buildApplicationEntailmentRequest(context(), proposal(), RESEARCH_CLAIMS);
  const result: ApplicationEntailmentAdapterResult = {
    schemaVersion: 1,
    decisions: request.claims.map((claim) => ({
      claimId: claim.claimId,
      verdict: "ENTAILED",
      reason: "The cited source directly supports the statement.",
    })),
  };

  const report = validateApplicationEntailment(request, result);

  assert.equal(report.semanticChecksPassed, true);
  assert.equal(report.status, "PASSED");
  assert.deepEqual(report.issues, []);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.decisions), true);
});

test("fails closed on missing, duplicate, unknown, uncertain, and non-entailed decisions", () => {
  const request = buildApplicationEntailmentRequest(context(), proposal(), RESEARCH_CLAIMS);
  const report = validateApplicationEntailment(request, {
    schemaVersion: 1,
    decisions: [{
      claimId: "candidate-claim",
      verdict: "ENTAILED",
      reason: "Supported.",
    }, {
      claimId: "candidate-claim",
      verdict: "ENTAILED",
      reason: "Duplicate.",
    }, {
      claimId: "job-claim",
      verdict: "UNCERTAIN",
      reason: "The wording is broader than the source.",
    }, {
      claimId: "unknown-claim",
      verdict: "NOT_ENTAILED",
      reason: "Not in the frozen proposal.",
    }],
  });

  assert.equal(report.semanticChecksPassed, false);
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.issues.some((issue) => issue.code === "DUPLICATE_DECISION"));
  assert.ok(report.issues.some((issue) => issue.code === "CLAIM_NOT_ENTAILED"));
  assert.ok(report.issues.some((issue) => issue.code === "UNKNOWN_DECISION"));
  assert.ok(report.issues.some((issue) =>
    issue.code === "MISSING_DECISION" && issue.claimId === "research-claim"));
});

test("fails closed when the adapter returns an unsupported schema version", () => {
  const request = buildApplicationEntailmentRequest(context(), proposal(), RESEARCH_CLAIMS);
  const result = {
    schemaVersion: 2,
    decisions: request.claims.map((claim) => ({
      claimId: claim.claimId,
      verdict: "ENTAILED" as const,
      reason: "Supported.",
    })),
  } as unknown as ApplicationEntailmentAdapterResult;

  const report = validateApplicationEntailment(request, result);

  assert.equal(report.semanticChecksPassed, false);
  assert.equal(report.status, "BLOCKED");
});


test("an undeclared assertion in actual prose is checked with only that paragraph's attached evidence", () => {
  const draft = proposal();
  const text = "Northstar is hiring for the Platform Engineer role. I hold an active professional engineering license.";
  const changed = { ...draft, coverLetter: { ...draft.coverLetter, paragraphs: draft.coverLetter.paragraphs.map((p, i) => i === 1 ? { ...p, text } : p) } };
  const request = buildApplicationEntailmentRequest(context(), changed, RESEARCH_CLAIMS);
  const segment = request.claims.find(claim => claim.kind === "DOCUMENT_SEGMENT" && claim.statement === text)!;
  assert.ok(segment);
  assert.deepEqual(segment.sources.map(source => source.sourceKey), ["research-claim:research-role"]);
  const report = validateApplicationEntailment(request, { schemaVersion: 1, decisions: request.claims.map(claim => ({
    claimId: claim.claimId, verdict: claim.claimId === segment.claimId ? "NOT_ENTAILED" : "ENTAILED", reason: "The license assertion has no candidate evidence.",
  })) });
  assert.equal(report.semanticChecksPassed, false);
  assert.deepEqual(report.issues.map(issue => issue.claimId), [segment.claimId]);
});

test("a document segment with no attached source fails even if the provider incorrectly accepts it", () => {
  const draft = proposal();
  const changed = { ...draft, coverLetter: { ...draft.coverLetter, paragraphs: draft.coverLetter.paragraphs.map((p, i) => i === 0 ? { ...p, claimIds: [] } : p) } };
  const request = buildApplicationEntailmentRequest(context(), changed, RESEARCH_CLAIMS);
  const segment = request.claims.find(claim => claim.claimId === "document:cover-letter:0")!;
  assert.deepEqual(segment.sources, []);
  const report = validateApplicationEntailment(request, { schemaVersion: 1, decisions: request.claims.map(claim => ({
    claimId: claim.claimId, verdict: "ENTAILED", reason: "Incorrect synthetic acceptance.",
  })) });
  assert.equal(report.semanticChecksPassed, false);
  assert.ok(report.issues.some(issue => issue.claimId === segment.claimId));
});

test("segment IDs cannot collide with model-declared claim IDs and preserved resume text is not generated", () => {
  const draft = proposal();
  const changed = { ...draft, claims: draft.claims.map((claim, i) => i === 1 ? { ...claim, claimId: "document:cover-letter:0" } : claim),
    resume: { handling: "PRESERVE_SERVER_SIDE" as const, mode: "AS_UPLOADED" as const, text: null, claimIds: [] as const },
    coverLetter: { ...draft.coverLetter, paragraphs: draft.coverLetter.paragraphs.map((p, i) => i === 0 ? { ...p, claimIds: ["document:cover-letter:0"] } : p) } };
  const request = buildApplicationEntailmentRequest(context(), changed, RESEARCH_CLAIMS);
  assert.equal(new Set(request.claims.map(claim => claim.claimId)).size, request.claims.length);
  assert.ok(request.claims.some(claim => claim.claimId === "document:cover-letter:0:1"));
  assert.equal(request.claims.some(claim => claim.claimId === "document:resume"), false);
});


test("a job citation resolves frozen job context but never supports a candidate claim", () => {
  const draft = proposal();
  const request = buildApplicationEntailmentRequest(context(), { ...draft, claims: draft.claims.map((claim, index) => index === 0 ? {
    ...claim, statement: "I have experience with reliable systems.", citations: [{ sourceType: "JOB_FIELD" as const, field: "DESCRIPTION" as const }],
  } : index === 1 ? { ...claim, citations: [{ sourceType: "JOB_FIELD" as const, field: "TITLE" as const }] } : claim) }, RESEARCH_CLAIMS);
  const job = request.claims.find(claim => claim.claimId === "job-claim")!;
  assert.ok(job.sources.some(source => source.sourceKey === "job-field:DESCRIPTION"));
  assert.equal(job.sources.some(source => source.sourceKey.startsWith("candidate-evidence:")), false);
  const candidate = request.claims.find(claim => claim.claimId === "candidate-claim")!;
  assert.deepEqual(candidate.sources, []);
  const report = validateApplicationEntailment(request, { schemaVersion: 1, decisions: request.claims.map(claim => ({
    claimId: claim.claimId, verdict: "ENTAILED", reason: "Incorrect synthetic acceptance.",
  })) });
  assert.equal(report.semanticChecksPassed, false);
  assert.ok(report.issues.some(issue => issue.claimId === "candidate-claim"));
});
