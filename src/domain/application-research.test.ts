import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplicationResearchBundle,
  isApplicationResearchClaimUsable,
  parseApplicationResearchProposal,
  validateApplicationResearchBundle,
  type ApplicationResearchBinding,
} from "./application-research.ts";

const BINDING: ApplicationResearchBinding = {
  inputSnapshotId: "snapshot-1",
  inputSnapshotHash: "a".repeat(64),
  applicationId: "application-1",
  jobVersionId: "job-version-1",
  jobContentSha256: "b".repeat(64),
};

const POLICY = {
  policyRelease: "research-freshness/1",
  maxAgeMs: 24 * 60 * 60 * 1_000,
  maxFutureSkewMs: 60_000,
} as const;

function proposal() {
  return {
    schemaVersion: 1,
    researcherRelease: "deterministic-research-fixture/1",
    sources: [{
      sourceId: "source-job",
      sourceType: "JOB_POSTING",
      url: "https://jobs.example.com/platform#requirements",
      title: "Platform Engineer",
      retrievedAt: "2026-08-16T10:00:00-04:00",
    }, {
      sourceId: "source-company",
      sourceType: "EMPLOYER_WEBSITE",
      url: "https://example.com/about",
      title: "About Northstar",
      retrievedAt: "2026-08-16T14:05:00.000Z",
    }],
    claims: [{
      claimId: "claim-role",
      claimType: "ROLE_REQUIREMENT",
      text: "The role owns platform reliability.",
      conflictStatus: "NO_CONFLICT",
      conflictNote: null,
      citations: [{
        sourceId: "source-job",
        locator: "Responsibilities, paragraph 2",
        excerpt: "Own platform reliability",
      }],
    }, {
      claimId: "claim-company",
      claimType: "COMPANY_CONTEXT",
      text: "Northstar builds operational software.",
      conflictStatus: "NO_CONFLICT",
      conflictNote: null,
      citations: [{
        sourceId: "source-company",
        locator: "About",
        excerpt: null,
      }],
    }],
  };
}

function expectBuilt(value: ReturnType<typeof buildApplicationResearchBundle>) {
  assert.equal(
    value.ok,
    true,
    value.ok ? "Expected research bundle to build." : JSON.stringify(value.error.issues),
  );
  if (!value.ok) throw new Error("Expected research bundle to build.");
  return value.value;
}

test("strictly parses source-backed company and role research from unknown", () => {
  const parsed = parseApplicationResearchProposal(proposal());

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.sources[0]?.url, "https://jobs.example.com/platform");
  assert.equal(parsed.value.sources[0]?.retrievedAt, "2026-08-16T14:00:00.000Z");
  assert.equal(parsed.value.claims[0]?.citations[0]?.sourceId, "source-job");
  assert.equal(Object.isFrozen(parsed.value), true);
  assert.equal(Object.isFrozen(parsed.value.claims[0]?.citations), true);
});

test("fails closed on unknown candidate fields and malformed public-source fields", () => {
  const invalid = proposal() as ReturnType<typeof proposal> & {
    candidateId?: string;
    candidateEvidence?: unknown[];
  };
  invalid.candidateId = "candidate-secret";
  invalid.candidateEvidence = [];
  invalid.sources[0] = {
    ...invalid.sources[0],
    url: "http://user:password@example.com/job",
    retrievedAt: "2026-08-16",
  };

  const parsed = parseApplicationResearchProposal(invalid);

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(parsed.error.issues.some((entry) => entry.path === "output.candidateId"));
  assert.ok(parsed.error.issues.some((entry) => entry.path === "output.candidateEvidence"));
  assert.ok(parsed.error.issues.some((entry) => entry.path === "sources[0].url"));
  assert.ok(parsed.error.issues.some((entry) => entry.path === "sources[0].retrievedAt"));
});

test("canonicalizes unordered sources, claims, and citations into one deterministic hash", () => {
  const firstProposal = proposal();
  const secondProposal = {
    ...firstProposal,
    sources: [...firstProposal.sources].reverse(),
    claims: [...firstProposal.claims].reverse(),
  };
  const first = expectBuilt(buildApplicationResearchBundle({
    binding: BINDING,
    freshnessPolicy: POLICY,
    completedAt: "2026-08-16T14:10:00.000Z",
    proposal: firstProposal,
  }));
  const second = expectBuilt(buildApplicationResearchBundle({
    binding: BINDING,
    freshnessPolicy: POLICY,
    completedAt: "2026-08-16T14:20:00.000Z",
    proposal: secondProposal,
  }));

  assert.equal(first.bundleHash, second.bundleHash);
  assert.match(first.bundleHash, /^[0-9a-f]{64}$/u);
  assert.deepEqual(first.manifest.research.sources.map((source) => source.source_id), [
    "source-company",
    "source-job",
  ]);
  assert.deepEqual(first.manifest.research.claims.map((claim) => claim.claim_id), [
    "claim-company",
    "claim-role",
  ]);
  assert.equal(first.freshnessExpiresAt, "2026-08-17T14:00:00.000Z");
  assert.equal(Object.isFrozen(first.manifest.research.claims[0]?.citations), true);
});

test("binds the manifest to exactly one snapshot, application, and job version", () => {
  const bundle = expectBuilt(buildApplicationResearchBundle({
    binding: BINDING,
    freshnessPolicy: POLICY,
    completedAt: "2026-08-16T14:10:00.000Z",
    proposal: proposal(),
  }));
  const valid = validateApplicationResearchBundle(
    bundle,
    BINDING,
    POLICY.policyRelease,
    "2026-08-16T15:00:00.000Z",
  );
  const wrongBinding = validateApplicationResearchBundle(
    bundle,
    { ...BINDING, applicationId: "application-2", jobVersionId: "job-version-2" },
    POLICY.policyRelease,
    "2026-08-16T15:00:00.000Z",
  );

  assert.equal(valid.valid, true);
  assert.equal(valid.fresh, true);
  assert.equal(wrongBinding.valid, false);
  assert.ok(wrongBinding.issues.filter((entry) => entry.code === "BINDING_MISMATCH").length === 2);
});

test("uses the oldest cited source for expiry and rejects stale research", () => {
  const stale = buildApplicationResearchBundle({
    binding: BINDING,
    freshnessPolicy: POLICY,
    completedAt: "2026-08-17T14:00:00.000Z",
    proposal: proposal(),
  });

  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.ok(stale.error.issues.some((entry) => entry.code === "FRESHNESS_INVALID"));
});

test("reports a persisted bundle expired at the exact boundary", () => {
  const bundle = expectBuilt(buildApplicationResearchBundle({
    binding: BINDING,
    freshnessPolicy: POLICY,
    completedAt: "2026-08-16T14:10:00.000Z",
    proposal: proposal(),
  }));
  const report = validateApplicationResearchBundle(
    bundle,
    BINDING,
    POLICY.policyRelease,
    bundle.freshnessExpiresAt,
  );

  assert.equal(report.fresh, false);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((entry) => entry.code === "FRESHNESS_INVALID"));
});

test("requires explicit multi-source conflict provenance and keeps unresolved claims unusable", () => {
  const base = proposal();
  const conflicted = {
    ...base,
    claims: base.claims.map((claim, index) => index === 0 ? {
      ...claim,
      conflictStatus: "UNRESOLVED",
      conflictNote: "The employer pages describe different scopes.",
    } : claim),
  };
  const invalid = parseApplicationResearchProposal(conflicted);

  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.error.issues.some((entry) => entry.code === "CONFLICT_INVALID"));
  }
  assert.equal(isApplicationResearchClaimUsable({ conflictStatus: "UNRESOLVED" }), false);
  assert.equal(isApplicationResearchClaimUsable({ conflictStatus: "RESOLVED" }), true);
});

test("rejects unused source padding so the oldest source is always claim-relevant", () => {
  const base = proposal();
  const invalid = parseApplicationResearchProposal({
    ...base,
    sources: [...base.sources, {
      sourceId: "source-unused",
      sourceType: "PRIMARY_PUBLICATION",
      url: "https://news.example.com/unused",
      title: "Unused source",
      retrievedAt: "2026-08-16T14:06:00.000Z",
    }],
  });

  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.error.issues.some((entry) =>
      entry.code === "CITATION_INVALID" && entry.path === "sources[2]"));
  }
});

test("the durable manifest exposes no candidate-evidence or candidate-PII fields", () => {
  const bundle = expectBuilt(buildApplicationResearchBundle({
    binding: BINDING,
    freshnessPolicy: POLICY,
    completedAt: "2026-08-16T14:10:00.000Z",
    proposal: proposal(),
  }));
  const serialized = JSON.stringify(bundle.manifest);

  assert.equal(serialized.includes("candidate_id"), false);
  assert.equal(serialized.includes("candidateEvidence"), false);
  assert.equal(serialized.includes("evidenceVersionId"), false);
  assert.equal(serialized.includes("email"), false);
  assert.equal(serialized.includes("phone"), false);
});
