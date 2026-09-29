import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateProfileFactView } from "./candidate-profile.ts";
import {
  assessCatalogItemFit,
  candidateFitProfile,
  normalizedCatalogJob,
  parseFitLocations,
  roleFamiliesForTitle,
  type CatalogFitCandidateInput,
  type CatalogFitJobVersionRow,
} from "./opportunity-fit-adapter.ts";

const CANDIDATE_ID = "681215c7-0d80-4420-ba13-c4af20296c0d";
const JOB_ID = "af0ac728-761f-43ac-9afc-dd82f8f26144";
const JOB_VERSION_ID = "b5e96cbb-47fd-4b65-8444-312c28a8c941";

function workFact(
  key: "work_authorization.us.authorized" | "work_authorization.us.sponsorship_required",
  value: boolean,
): CandidateProfileFactView {
  return Object.freeze({
    factId: key.endsWith("authorized") ? "fact-authorized" : "fact-sponsorship",
    factVersionId: key.endsWith("authorized") ? "fact-authorized-v2" : "fact-sponsorship-v3",
    key,
    label: key,
    value,
    displayValue: value ? "Yes" : "No",
    sensitivity: "SENSITIVE",
    usagePolicy: "EXACT_FIELDS",
    aggregateVersion: 2,
    factVersionNumber: 2,
    reviewedAt: "2026-08-18T19:00:00Z",
    sourceKind: "CANDIDATE_ENTRY",
    resolved: true,
  });
}

function candidate(args: Readonly<{ authorized?: boolean; sponsorshipRequired?: boolean }> = {}): CatalogFitCandidateInput {
  return Object.freeze({
    candidateId: CANDIDATE_ID,
    candidateCreatedAt: "2026-08-18T18:00:00Z",
    searchProfile: Object.freeze({
      candidateId: CANDIDATE_ID,
      aggregateVersion: 4,
      targetRoles: Object.freeze(["Senior Software Engineer"]),
      preferredLocations: Object.freeze(["Remote, United States"]),
      desiredCountryCodes: Object.freeze(["US"]),
      workModes: Object.freeze(["REMOTE"]),
      employmentTypes: Object.freeze(["FULL_TIME"]),
      updatedAt: "2026-08-18T20:00:00Z",
    }),
    facts: Object.freeze([
      workFact("work_authorization.us.authorized", args.authorized ?? true),
      workFact("work_authorization.us.sponsorship_required", args.sponsorshipRequired ?? false),
    ]),
  });
}

function job(descriptionText: string): CatalogFitJobVersionRow {
  return Object.freeze({
    id: JOB_VERSION_ID,
    jobId: JOB_ID,
    versionNumber: 7,
    title: "Senior Backend Software Engineer",
    descriptionText,
    locationText: "Remote, United States",
    workMode: "REMOTE",
    employmentType: "FULL_TIME",
    observedAt: "2026-08-18T20:30:00Z",
  });
}

test("normalizes only recognized role and location families", () => {
  assert.deepEqual(roleFamiliesForTitle("Senior Backend Software Engineer"), ["software engineering"]);
  assert.deepEqual(roleFamiliesForTitle("Member of Technical Staff"), []);
  assert.deepEqual(parseFitLocations("Washington, DC | Toronto, ON"), [
    { countryCode: "US", regionCode: "DC", city: "Washington" },
    { countryCode: "CA", regionCode: "ON", city: "Toronto" },
  ]);
  assert.deepEqual(parseFitLocations("Everywhere"), []);
});

test("keeps an otherwise strong fit in review when clearance is not stated", () => {
  const profile = candidateFitProfile(candidate());
  const normalizedJob = normalizedCatalogJob(job("Build secure developer tools. Visa policy is not stated."));
  const summary = assessCatalogItemFit(profile, normalizedJob, "2026-08-18T21:00:00Z");

  assert.equal(summary.decision, "REVIEW");
  assert.equal(summary.matchedComponents, 5);
  assert.deepEqual(summary.reasons, ["Clearance eligibility needs review because the posting has not been classified."]);
  assert.equal(summary.candidateProfileVersion.versionNumber, 4);
  assert.equal(summary.jobVersion.versionId, JOB_VERSION_ID);
  assert.match(summary.jobVersion.contentHash, /^sha256:[0-9a-f]{64}$/u);
});

test("admits only when every relevant component is explicit", () => {
  const summary = assessCatalogItemFit(
    candidateFitProfile(candidate()),
    normalizedCatalogJob(job("No security clearance is required for this role.")),
    "2026-08-18T21:00:00Z",
  );

  assert.equal(summary.decision, "ADMIT");
  assert.equal(summary.matchedComponents, 5);
  assert.equal(summary.reasons.length, 2);
});

test("blocks only an explicit sponsorship mismatch and still leaves the job actionable", () => {
  const summary = assessCatalogItemFit(
    candidateFitProfile(candidate({ authorized: false, sponsorshipRequired: true })),
    normalizedCatalogJob(job("Applicants must be authorized to work without current or future visa sponsorship. No security clearance is required.")),
    "2026-08-18T21:00:00Z",
  );

  assert.equal(summary.decision, "BLOCK");
  assert.equal(summary.matchedComponents, 4);
  assert.equal(summary.reasons[0], "The employer states that sponsorship is unavailable, but your saved eligibility answers indicate it would be required.");
});

test("missing work authorization stays a job-specific review flag", () => {
  const input = Object.freeze({
    ...candidate(),
    facts: Object.freeze([]),
  });
  const summary = assessCatalogItemFit(
    candidateFitProfile(input),
    normalizedCatalogJob(job("Applicants must be authorized to work without current or future visa sponsorship. No security clearance is required.")),
    "2026-08-18T21:00:00Z",
  );

  assert.equal(summary.decision, "REVIEW");
  assert.equal(summary.matchedComponents, 4);
  assert.equal(summary.reasons[0], "Eligibility needs review because a required work-authorization answer is missing or unresolved.");
});

test("a missing search profile produces review evidence instead of a fabricated score", () => {
  const input: CatalogFitCandidateInput = Object.freeze({
    candidateId: CANDIDATE_ID,
    candidateCreatedAt: "2026-08-18T18:00:00Z",
    searchProfile: null,
    facts: Object.freeze([]),
  });
  const summary = assessCatalogItemFit(
    candidateFitProfile(input),
    normalizedCatalogJob(job("No security clearance is required.")),
    "2026-08-18T21:00:00Z",
  );

  assert.equal(summary.decision, "REVIEW");
  assert.equal(summary.matchedComponents, 0);
  assert.equal(summary.reasons[0], "Add at least one target role before this job can be recommended.");
});
