import assert from "node:assert/strict";
import test from "node:test";

import type { ApplicationDraftingContext } from "../../domain/application-drafting.ts";
import {
  APPLICATION_RESEARCH_FRESHNESS_POLICY_RELEASE,
  buildOfficialJobPostingResearch,
  draftingClaimsFromResearchBundle,
  JOB_POSTING_RESEARCHER_RELEASE,
} from "./job-posting-research.ts";

function context(location: string | null = "Remote"): ApplicationDraftingContext {
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
      candidateId: "candidate-secret",
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
      location,
      employmentType: "Full-time",
      workMode: location ? "REMOTE" : null,
      applyUrl: "https://jobs.example.com/platform-engineer",
    },
    sourceResume: {
      documentId: "document-secret",
      documentVersionId: "document-version-secret",
      textReviewId: "review-secret",
      sourceSha256: "c".repeat(64),
      reviewedTextSha256: "d".repeat(64),
      reviewedText: "Private reviewed resume text.",
    },
    approvedNarrativeEvidence: [],
    excludedExactFactCount: 3,
  };
}

test("builds a snapshot-bound, cited bundle from the frozen official posting", () => {
  const bundle = buildOfficialJobPostingResearch(
    context(),
    "2026-08-16T10:05:00.000Z",
  );

  assert.equal(bundle.researcherRelease, JOB_POSTING_RESEARCHER_RELEASE);
  assert.equal(bundle.freshnessPolicyRelease, APPLICATION_RESEARCH_FRESHNESS_POLICY_RELEASE);
  assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(bundle.manifest.binding, {
    input_snapshot_id: "snapshot-1",
    input_snapshot_hash: "a".repeat(64),
    application_id: "application-1",
    job_version_id: "job-version-1",
    job_content_sha256: "b".repeat(64),
  });
  assert.deepEqual(bundle.manifest.research.sources, [{
    source_id: "job-version:job-version-1",
    source_type: "JOB_POSTING",
    url: "https://jobs.example.com/platform-engineer",
    title: "Northstar — Platform Engineer",
    retrieved_at: "2026-08-16T10:00:00.000Z",
  }]);
  assert.deepEqual(
    bundle.manifest.research.claims.map((claim) => claim.claim_id),
    ["official-role-location", "official-role-target"],
  );
  assert.ok(bundle.manifest.research.claims.every((claim) =>
    claim.citations.every((citation) => citation.source_id === "job-version:job-version-1")));
  const serialized = JSON.stringify(bundle.manifest);
  assert.equal(serialized.includes("candidate-secret"), false);
  assert.equal(serialized.includes("Private reviewed resume text"), false);
});

test("omits a location claim when the frozen posting has no location", () => {
  const bundle = buildOfficialJobPostingResearch(
    context(null),
    "2026-08-16T10:05:00.000Z",
  );

  assert.deepEqual(
    bundle.manifest.research.claims.map((claim) => claim.claim_id),
    ["official-role-target"],
  );
  assert.deepEqual(draftingClaimsFromResearchBundle(bundle), [{
    researchClaimId: "official-role-target",
    text: "Northstar is hiring for the Platform Engineer role.",
  }]);
});

test("fails closed when the official posting snapshot is stale or completed before retrieval", () => {
  assert.throws(
    () => buildOfficialJobPostingResearch(context(), "2026-08-24T10:00:00.000Z"),
    /FRESHNESS_INVALID/u,
  );
  assert.throws(
    () => buildOfficialJobPostingResearch(context(), "2026-08-16T09:50:00.000Z"),
    /FRESHNESS_INVALID/u,
  );
});

test("produces deterministic drafting claims without citation metadata or source URLs", () => {
  const bundle = buildOfficialJobPostingResearch(
    context(),
    "2026-08-16T10:05:00.000Z",
  );
  const claims = draftingClaimsFromResearchBundle(bundle);

  assert.deepEqual(claims, [{
    researchClaimId: "official-role-location",
    text: "The official posting lists the role location as Remote.",
  }, {
    researchClaimId: "official-role-target",
    text: "Northstar is hiring for the Platform Engineer role.",
  }]);
  assert.equal(Object.isFrozen(claims[0]), true);
  assert.equal(JSON.stringify(claims).includes("jobs.example.com"), false);
});
