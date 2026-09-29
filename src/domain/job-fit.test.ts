import assert from "node:assert/strict";
import test from "node:test";

import {
  JOB_FIT_POLICY_VERSION,
  assessJobFit,
  type CandidateSearchProfile,
  type FitEntityVersionRef,
  type FitFieldSource,
  type NormalizedJobForFit,
} from "./job-fit.ts";

const CANDIDATE_VERSION: FitEntityVersionRef = Object.freeze({
  entityId: "candidate-search-profile-1",
  versionId: "candidate-search-profile-version-3",
  versionNumber: 3,
  contentHash: "sha256:candidate-v3",
  capturedAt: "2026-08-18T12:00:00Z",
});

const JOB_VERSION: FitEntityVersionRef = Object.freeze({
  entityId: "job-1",
  versionId: "job-version-7",
  versionNumber: 7,
  contentHash: "sha256:job-v7",
  capturedAt: "2026-08-18T12:05:00Z",
});

const FIELD_SOURCES: readonly FitFieldSource[] = Object.freeze([
  {
    fieldPath: "candidate.targetRoleFamilies",
    sourceKind: "CANDIDATE_PREFERENCE",
    sourceId: "candidate-search-profile-1",
    sourceVersionId: "candidate-search-profile-version-3",
    recordedAt: "2026-08-18T12:00:00Z",
  },
  {
    fieldPath: "candidate.workAuthorizations",
    sourceKind: "CANDIDATE_ATTESTATION",
    sourceId: "candidate-fact-1",
    sourceVersionId: "candidate-fact-version-2",
    recordedAt: "2026-08-18T11:50:00Z",
  },
  {
    fieldPath: "job.roleFamilies",
    sourceKind: "NORMALIZATION_POLICY",
    sourceId: "job-1",
    sourceVersionId: "job-version-7",
    recordedAt: "2026-08-18T12:05:00Z",
  },
  {
    fieldPath: "job.workCountryCodes",
    sourceKind: "OFFICIAL_JOB_POSTING",
    sourceId: "job-1",
    sourceVersionId: "job-version-7",
    recordedAt: "2026-08-18T12:05:00Z",
  },
]);

const CANDIDATE: CandidateSearchProfile = Object.freeze({
  version: CANDIDATE_VERSION,
  targetRoleFamilies: Object.freeze(["solutions engineering"]),
  preferredLocations: Object.freeze([{ countryCode: "US", regionCode: "DC", city: null }]),
  acceptableWorkModes: Object.freeze(["REMOTE", "HYBRID"] as const),
  acceptableEmploymentTypes: Object.freeze(["FULL_TIME"] as const),
  workAuthorizations: Object.freeze([{ countryCode: "US", authorized: true, sponsorshipRequired: false }]),
  clearance: Object.freeze({ status: "NONE", levels: Object.freeze([]) }),
  fieldSources: FIELD_SOURCES,
});

const JOB: NormalizedJobForFit = Object.freeze({
  version: JOB_VERSION,
  title: "Solutions Engineer",
  roleFamilies: Object.freeze(["solutions engineering"]),
  locations: Object.freeze([{ countryCode: "US", regionCode: "DC", city: "Washington" }]),
  workMode: "HYBRID",
  employmentType: "FULL_TIME",
  workCountryCodes: Object.freeze(["US"]),
  sponsorshipAvailability: "UNKNOWN",
  clearance: Object.freeze({ status: "NOT_REQUIRED", acceptedLevels: Object.freeze([]), activeRequired: false }),
  fieldSources: FIELD_SOURCES,
});

const CONTEXT = Object.freeze({ assessmentId: "fit-assessment-1", evaluatedAt: "2026-08-18T12:10:00Z" });

test("admits only when every relevant component is known and acceptable", () => {
  const result = assessJobFit(CANDIDATE, JOB, CONTEXT);

  assert.equal(result.decision, "ADMIT");
  assert.equal(result.policyVersion, JOB_FIT_POLICY_VERSION);
  assert.deepEqual(result.scoreSummary, {
    matchedComponents: 5,
    mismatchedComponents: 0,
    unknownComponents: 0,
    notApplicableComponents: 1,
    assessedComponents: 5,
  });
  assert.deepEqual(result.componentScores.map(({ component, verdict, earned, available }) => ({ component, verdict, earned, available })), [
    { component: "ROLE", verdict: "MATCH", earned: 1, available: 1 },
    { component: "LOCATION", verdict: "MATCH", earned: 1, available: 1 },
    { component: "WORK_MODE", verdict: "MATCH", earned: 1, available: 1 },
    { component: "EMPLOYMENT_TYPE", verdict: "MATCH", earned: 1, available: 1 },
    { component: "WORK_AUTHORIZATION", verdict: "MATCH", earned: 1, available: 1 },
    { component: "CLEARANCE", verdict: "NOT_APPLICABLE", earned: null, available: 1 },
  ]);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.reviewFlags.length, 0);
});

test("returns review instead of inventing an answer when job facts are missing", () => {
  const result = assessJobFit(CANDIDATE, {
    ...JOB,
    roleFamilies: null,
    locations: null,
    workMode: null,
    employmentType: null,
    workCountryCodes: null,
    clearance: null,
  }, CONTEXT);

  assert.equal(result.decision, "REVIEW");
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.reviewFlags.map((issue) => issue.code), [
    "JOB_ROLE_CLASSIFICATION_MISSING",
    "JOB_LOCATION_MISSING",
    "JOB_WORK_MODE_MISSING",
    "JOB_EMPLOYMENT_TYPE_MISSING",
    "JOB_WORK_COUNTRY_MISSING",
    "JOB_CLEARANCE_REQUIREMENT_UNKNOWN",
  ]);
  assert.equal(result.scoreSummary.unknownComponents, 6);
});

test("returns review for missing candidate preferences and unresolved sensitive facts", () => {
  const result = assessJobFit({
    ...CANDIDATE,
    targetRoleFamilies: [],
    preferredLocations: [],
    acceptableWorkModes: [],
    acceptableEmploymentTypes: [],
    workAuthorizations: [{ countryCode: "US", authorized: "UNKNOWN", sponsorshipRequired: "UNKNOWN" }],
    clearance: null,
  }, {
    ...JOB,
    clearance: { status: "REQUIRED", acceptedLevels: ["public trust"], activeRequired: true },
  }, CONTEXT);

  assert.equal(result.decision, "REVIEW");
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.reviewFlags.map((issue) => issue.code), [
    "TARGET_ROLES_MISSING",
    "CANDIDATE_LOCATIONS_MISSING",
    "CANDIDATE_WORK_MODES_MISSING",
    "CANDIDATE_EMPLOYMENT_TYPES_MISSING",
    "WORK_AUTHORIZATION_UNRESOLVED",
    "CANDIDATE_CLEARANCE_MISSING",
  ]);
});

test("blocks only an explicit hard eligibility mismatch", () => {
  const result = assessJobFit({
    ...CANDIDATE,
    workAuthorizations: [{ countryCode: "US", authorized: false, sponsorshipRequired: true }],
  }, {
    ...JOB,
    sponsorshipAvailability: "NOT_AVAILABLE",
  }, CONTEXT);

  assert.equal(result.decision, "BLOCK");
  assert.deepEqual(result.blockers.map((issue) => issue.code), ["SPONSORSHIP_UNAVAILABLE"]);
  assert.match(result.blockers[0]!.displayReason, /employer states that sponsorship is unavailable/u);
});

test("admits when one of several stated work-country paths is explicitly eligible", () => {
  const result = assessJobFit({
    ...CANDIDATE,
    workAuthorizations: [
      { countryCode: "CA", authorized: "UNKNOWN", sponsorshipRequired: "UNKNOWN" },
      { countryCode: "US", authorized: true, sponsorshipRequired: false },
    ],
  }, {
    ...JOB,
    workCountryCodes: ["CA", "US"],
  }, CONTEXT);

  assert.equal(result.decision, "ADMIT");
  assert.equal(result.componentScores.find((score) => score.component === "WORK_AUTHORIZATION")?.verdict, "MATCH");
});

test("blocks an explicit clearance mismatch but reviews an unstated level", () => {
  const blocked = assessJobFit(CANDIDATE, {
    ...JOB,
    clearance: { status: "REQUIRED", acceptedLevels: ["secret"], activeRequired: true },
  }, CONTEXT);
  assert.equal(blocked.decision, "BLOCK");
  assert.deepEqual(blocked.blockers.map((issue) => issue.code), ["CLEARANCE_NOT_MET"]);

  const review = assessJobFit({
    ...CANDIDATE,
    clearance: { status: "ACTIVE", levels: ["secret"] },
  }, {
    ...JOB,
    clearance: { status: "REQUIRED", acceptedLevels: null, activeRequired: true },
  }, CONTEXT);
  assert.equal(review.decision, "REVIEW");
  assert.deepEqual(review.reviewFlags.map((issue) => issue.code), ["CLEARANCE_LEVEL_UNRESOLVED"]);
});

test("keeps soft preference mismatches out of the hard-block list", () => {
  const result = assessJobFit(CANDIDATE, {
    ...JOB,
    roleFamilies: ["accounting"],
    locations: [{ countryCode: "US", regionCode: "CA", city: "San Francisco" }],
    workMode: "ONSITE",
    employmentType: "CONTRACT",
  }, CONTEXT);

  assert.equal(result.decision, "REVIEW");
  assert.equal(result.blockers.length, 0);
  assert.deepEqual(result.reviewFlags.map((issue) => issue.code), [
    "TARGET_ROLE_MISMATCH",
    "LOCATION_PREFERENCE_MISMATCH",
    "WORK_MODE_PREFERENCE_MISMATCH",
    "EMPLOYMENT_TYPE_PREFERENCE_MISMATCH",
  ]);
});

test("retains immutable version and field provenance without creating a match percentage", () => {
  const result = assessJobFit(CANDIDATE, JOB, CONTEXT);
  const role = result.componentScores.find((score) => score.component === "ROLE");

  assert.deepEqual(result.candidateProfileVersion, CANDIDATE_VERSION);
  assert.deepEqual(result.jobVersion, JOB_VERSION);
  assert.deepEqual(role?.evidence.map((source) => source.fieldPath), [
    "candidate.targetRoleFamilies",
    "job.roleFamilies",
  ]);
  assert.equal("matchPercentage" in result, false);
  assert.equal("percentage" in result.scoreSummary, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.componentScores), true);
});

test("rejects malformed persistence references instead of evaluating ambiguous inputs", () => {
  assert.throws(() => assessJobFit({
    ...CANDIDATE,
    version: { ...CANDIDATE_VERSION, contentHash: "" },
  }, JOB, CONTEXT), /JOB_FIT_VERSION_REF_INVALID/u);

  assert.throws(() => assessJobFit(CANDIDATE, {
    ...JOB,
    workCountryCodes: ["United States"],
  }, CONTEXT), /JOB_FIT_COUNTRY_CODE_INVALID/u);
});
