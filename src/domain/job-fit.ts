export const JOB_FIT_POLICY_VERSION = "roledawn-job-fit/1" as const;

export const JOB_FIT_COMPONENTS = [
  "ROLE",
  "LOCATION",
  "WORK_MODE",
  "EMPLOYMENT_TYPE",
  "WORK_AUTHORIZATION",
  "CLEARANCE",
] as const;

export type JobFitComponent = (typeof JOB_FIT_COMPONENTS)[number];
export type JobFitDecision = "ADMIT" | "REVIEW" | "BLOCK";
export type JobFitComponentVerdict = "MATCH" | "MISMATCH" | "UNKNOWN" | "NOT_APPLICABLE";
export type KnownBoolean = boolean | "UNKNOWN";
export type JobWorkMode = "REMOTE" | "HYBRID" | "ONSITE";
export type JobEmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN" | "TEMPORARY";

export type FitEntityVersionRef = Readonly<{
  entityId: string;
  versionId: string;
  versionNumber: number;
  contentHash: string;
  capturedAt: string;
}>;

export type FitFieldSourceKind =
  | "CANDIDATE_ATTESTATION"
  | "CANDIDATE_PREFERENCE"
  | "OFFICIAL_JOB_POSTING"
  | "NORMALIZATION_POLICY";

export type FitFieldSource = Readonly<{
  fieldPath: string;
  sourceKind: FitFieldSourceKind;
  sourceId: string;
  sourceVersionId: string;
  recordedAt: string;
}>;

export type CandidateLocationPreference = Readonly<{
  countryCode: string;
  regionCode: string | null;
  city: string | null;
}>;

export type CandidateWorkAuthorization = Readonly<{
  countryCode: string;
  authorized: KnownBoolean;
  sponsorshipRequired: KnownBoolean;
}>;

export type CandidateClearance = Readonly<{
  status: "ACTIVE" | "INACTIVE" | "NONE" | "UNKNOWN";
  levels: readonly string[];
}>;

export type CandidateSearchProfile = Readonly<{
  version: FitEntityVersionRef;
  targetRoleFamilies: readonly string[];
  preferredLocations: readonly CandidateLocationPreference[];
  acceptableWorkModes: readonly JobWorkMode[];
  acceptableEmploymentTypes: readonly JobEmploymentType[];
  workAuthorizations: readonly CandidateWorkAuthorization[];
  clearance: CandidateClearance | null;
  fieldSources: readonly FitFieldSource[];
}>;

export type NormalizedJobLocation = Readonly<{
  countryCode: string;
  regionCode: string | null;
  city: string | null;
}>;

export type JobClearanceRequirement = Readonly<{
  status: "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN";
  acceptedLevels: readonly string[] | null;
  activeRequired: KnownBoolean;
}>;

export type NormalizedJobForFit = Readonly<{
  version: FitEntityVersionRef;
  title: string | null;
  roleFamilies: readonly string[] | null;
  locations: readonly NormalizedJobLocation[] | null;
  workMode: JobWorkMode | null;
  employmentType: JobEmploymentType | null;
  workCountryCodes: readonly string[] | null;
  sponsorshipAvailability: "AVAILABLE" | "NOT_AVAILABLE" | "UNKNOWN";
  clearance: JobClearanceRequirement | null;
  fieldSources: readonly FitFieldSource[];
}>;

export const JOB_FIT_ISSUE_CODES = [
  "TARGET_ROLES_MISSING",
  "JOB_ROLE_CLASSIFICATION_MISSING",
  "TARGET_ROLE_MISMATCH",
  "CANDIDATE_LOCATIONS_MISSING",
  "JOB_LOCATION_MISSING",
  "JOB_LOCATION_DETAIL_MISSING",
  "LOCATION_PREFERENCE_MISMATCH",
  "CANDIDATE_WORK_MODES_MISSING",
  "JOB_WORK_MODE_MISSING",
  "WORK_MODE_PREFERENCE_MISMATCH",
  "CANDIDATE_EMPLOYMENT_TYPES_MISSING",
  "JOB_EMPLOYMENT_TYPE_MISSING",
  "EMPLOYMENT_TYPE_PREFERENCE_MISMATCH",
  "JOB_WORK_COUNTRY_MISSING",
  "WORK_AUTHORIZATION_MISSING",
  "WORK_AUTHORIZATION_UNRESOLVED",
  "WORK_AUTHORIZATION_NOT_MET",
  "SPONSORSHIP_AVAILABILITY_UNKNOWN",
  "SPONSORSHIP_UNAVAILABLE",
  "JOB_CLEARANCE_REQUIREMENT_UNKNOWN",
  "CANDIDATE_CLEARANCE_MISSING",
  "CANDIDATE_CLEARANCE_UNRESOLVED",
  "CLEARANCE_ACTIVE_STATUS_UNRESOLVED",
  "CLEARANCE_LEVEL_UNRESOLVED",
  "CLEARANCE_NOT_MET",
] as const;

export type JobFitIssueCode = (typeof JOB_FIT_ISSUE_CODES)[number];

export type JobFitIssue = Readonly<{
  code: JobFitIssueCode;
  decision: "REVIEW" | "BLOCK";
  component: JobFitComponent;
  displayReason: string;
  evidence: readonly FitFieldSource[];
}>;

export type JobFitComponentScore = Readonly<{
  component: JobFitComponent;
  verdict: JobFitComponentVerdict;
  /** One deterministic component point, or null when the component is unknown/not applicable. */
  earned: 0 | 1 | null;
  available: 1;
  reasonCode: string;
  displayReason: string;
  evidence: readonly FitFieldSource[];
}>;

export type JobFitScoreSummary = Readonly<{
  matchedComponents: number;
  mismatchedComponents: number;
  unknownComponents: number;
  notApplicableComponents: number;
  assessedComponents: number;
}>;

export type JobFitAssessmentContext = Readonly<{
  assessmentId: string;
  evaluatedAt: string;
}>;

export type JobFitAssessment = Readonly<{
  assessmentId: string;
  evaluatedAt: string;
  policyVersion: typeof JOB_FIT_POLICY_VERSION;
  candidateProfileVersion: FitEntityVersionRef;
  jobVersion: FitEntityVersionRef;
  decision: JobFitDecision;
  componentScores: readonly JobFitComponentScore[];
  scoreSummary: JobFitScoreSummary;
  blockers: readonly JobFitIssue[];
  reviewFlags: readonly JobFitIssue[];
}>;

type MutableEvaluation = {
  scores: JobFitComponentScore[];
  issues: JobFitIssue[];
};

function normalizedToken(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function normalizedCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(normalized)) throw new Error("JOB_FIT_COUNTRY_CODE_INVALID");
  return normalized;
}

function normalizedOptionalLocationPart(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normalizedToken(value);
  return normalized || null;
}

function validateVersionRef(ref: FitEntityVersionRef): void {
  if (
    !ref.entityId.trim() ||
    !ref.versionId.trim() ||
    !Number.isInteger(ref.versionNumber) ||
    ref.versionNumber < 1 ||
    !ref.contentHash.trim() ||
    Number.isNaN(Date.parse(ref.capturedAt))
  ) {
    throw new Error("JOB_FIT_VERSION_REF_INVALID");
  }
}

function validateContext(context: JobFitAssessmentContext): void {
  if (!context.assessmentId.trim() || Number.isNaN(Date.parse(context.evaluatedAt))) {
    throw new Error("JOB_FIT_ASSESSMENT_CONTEXT_INVALID");
  }
}

function evidenceFor(
  candidate: CandidateSearchProfile,
  job: NormalizedJobForFit,
  fieldPaths: readonly string[],
): readonly FitFieldSource[] {
  const wanted = new Set(fieldPaths);
  const seen = new Set<string>();
  return Object.freeze([...candidate.fieldSources, ...job.fieldSources].filter((source) => {
    if (!wanted.has(source.fieldPath)) return false;
    const key = `${source.fieldPath}\u0000${source.sourceKind}\u0000${source.sourceId}\u0000${source.sourceVersionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function addResult(
  state: MutableEvaluation,
  score: JobFitComponentScore,
  issue?: Omit<JobFitIssue, "evidence">,
): void {
  const frozenScore = Object.freeze({ ...score, evidence: Object.freeze([...score.evidence]) });
  state.scores.push(frozenScore);
  if (issue) {
    state.issues.push(Object.freeze({ ...issue, evidence: frozenScore.evidence }));
  }
}

function componentScore(
  component: JobFitComponent,
  verdict: JobFitComponentVerdict,
  reasonCode: string,
  displayReason: string,
  evidence: readonly FitFieldSource[],
): JobFitComponentScore {
  return {
    component,
    verdict,
    earned: verdict === "MATCH" ? 1 : verdict === "MISMATCH" ? 0 : null,
    available: 1,
    reasonCode,
    displayReason,
    evidence,
  };
}

function evaluateRole(
  candidate: CandidateSearchProfile,
  job: NormalizedJobForFit,
  state: MutableEvaluation,
): void {
  const evidence = evidenceFor(candidate, job, ["candidate.targetRoleFamilies", "job.roleFamilies"]);
  const candidateRoles = candidate.targetRoleFamilies.map(normalizedToken).filter(Boolean);
  if (candidateRoles.length === 0) {
    const displayReason = "Add at least one target role before this job can be recommended.";
    addResult(state, componentScore("ROLE", "UNKNOWN", "TARGET_ROLES_MISSING", displayReason, evidence), {
      code: "TARGET_ROLES_MISSING", decision: "REVIEW", component: "ROLE", displayReason,
    });
    return;
  }

  const jobRoles = job.roleFamilies?.map(normalizedToken).filter(Boolean) ?? [];
  if (jobRoles.length === 0) {
    const displayReason = "Role fit needs review because this job has not been classified yet.";
    addResult(state, componentScore("ROLE", "UNKNOWN", "JOB_ROLE_CLASSIFICATION_MISSING", displayReason, evidence), {
      code: "JOB_ROLE_CLASSIFICATION_MISSING", decision: "REVIEW", component: "ROLE", displayReason,
    });
    return;
  }

  const matches = jobRoles.some((jobRole) => candidateRoles.includes(jobRole));
  const displayReason = matches
    ? "The job's normalized role family matches one of your saved targets."
    : "This job is outside your saved target roles.";
  addResult(state, componentScore("ROLE", matches ? "MATCH" : "MISMATCH", matches ? "TARGET_ROLE_MATCH" : "TARGET_ROLE_MISMATCH", displayReason, evidence), matches ? undefined : {
    code: "TARGET_ROLE_MISMATCH", decision: "REVIEW", component: "ROLE", displayReason,
  });
}

type LocationComparison = "MATCH" | "MISMATCH" | "UNKNOWN";

function compareLocation(
  preference: CandidateLocationPreference,
  location: NormalizedJobLocation,
): LocationComparison {
  if (normalizedCountryCode(preference.countryCode) !== normalizedCountryCode(location.countryCode)) {
    return "MISMATCH";
  }

  const preferredRegion = normalizedOptionalLocationPart(preference.regionCode);
  const jobRegion = normalizedOptionalLocationPart(location.regionCode);
  if (preferredRegion !== null && jobRegion === null) return "UNKNOWN";
  if (preferredRegion !== null && preferredRegion !== jobRegion) return "MISMATCH";

  const preferredCity = normalizedOptionalLocationPart(preference.city);
  const jobCity = normalizedOptionalLocationPart(location.city);
  if (preferredCity !== null && jobCity === null) return "UNKNOWN";
  if (preferredCity !== null && preferredCity !== jobCity) return "MISMATCH";
  return "MATCH";
}

function evaluateLocation(candidate: CandidateSearchProfile, job: NormalizedJobForFit, state: MutableEvaluation): void {
  const evidence = evidenceFor(candidate, job, ["candidate.preferredLocations", "job.locations"]);
  if (candidate.preferredLocations.length === 0) {
    const displayReason = "Add a preferred location before this job can be recommended.";
    addResult(state, componentScore("LOCATION", "UNKNOWN", "CANDIDATE_LOCATIONS_MISSING", displayReason, evidence), {
      code: "CANDIDATE_LOCATIONS_MISSING", decision: "REVIEW", component: "LOCATION", displayReason,
    });
    return;
  }
  if (!job.locations || job.locations.length === 0) {
    const displayReason = "Location fit needs review because this job has no normalized location.";
    addResult(state, componentScore("LOCATION", "UNKNOWN", "JOB_LOCATION_MISSING", displayReason, evidence), {
      code: "JOB_LOCATION_MISSING", decision: "REVIEW", component: "LOCATION", displayReason,
    });
    return;
  }

  const comparisons = candidate.preferredLocations.flatMap((preference) =>
    job.locations!.map((location) => compareLocation(preference, location))
  );
  if (comparisons.includes("MATCH")) {
    addResult(state, componentScore("LOCATION", "MATCH", "LOCATION_PREFERENCE_MATCH", "The job matches a saved location preference.", evidence));
    return;
  }
  if (comparisons.includes("UNKNOWN")) {
    const displayReason = "Location fit needs review because the posting omits part of the location.";
    addResult(state, componentScore("LOCATION", "UNKNOWN", "JOB_LOCATION_DETAIL_MISSING", displayReason, evidence), {
      code: "JOB_LOCATION_DETAIL_MISSING", decision: "REVIEW", component: "LOCATION", displayReason,
    });
    return;
  }
  const displayReason = "This job is outside your saved location preferences.";
  addResult(state, componentScore("LOCATION", "MISMATCH", "LOCATION_PREFERENCE_MISMATCH", displayReason, evidence), {
    code: "LOCATION_PREFERENCE_MISMATCH", decision: "REVIEW", component: "LOCATION", displayReason,
  });
}

function evaluateEnumPreference<T extends string>(args: Readonly<{
  component: "WORK_MODE" | "EMPLOYMENT_TYPE";
  candidateValues: readonly T[];
  jobValue: T | null;
  candidateMissingCode: Extract<JobFitIssueCode, "CANDIDATE_WORK_MODES_MISSING" | "CANDIDATE_EMPLOYMENT_TYPES_MISSING">;
  jobMissingCode: Extract<JobFitIssueCode, "JOB_WORK_MODE_MISSING" | "JOB_EMPLOYMENT_TYPE_MISSING">;
  mismatchCode: Extract<JobFitIssueCode, "WORK_MODE_PREFERENCE_MISMATCH" | "EMPLOYMENT_TYPE_PREFERENCE_MISMATCH">;
  matchCode: string;
  candidateMissingReason: string;
  jobMissingReason: string;
  mismatchReason: string;
  matchReason: string;
  evidence: readonly FitFieldSource[];
  state: MutableEvaluation;
}>): void {
  if (args.candidateValues.length === 0) {
    addResult(args.state, componentScore(args.component, "UNKNOWN", args.candidateMissingCode, args.candidateMissingReason, args.evidence), {
      code: args.candidateMissingCode, decision: "REVIEW", component: args.component, displayReason: args.candidateMissingReason,
    });
    return;
  }
  if (args.jobValue === null) {
    addResult(args.state, componentScore(args.component, "UNKNOWN", args.jobMissingCode, args.jobMissingReason, args.evidence), {
      code: args.jobMissingCode, decision: "REVIEW", component: args.component, displayReason: args.jobMissingReason,
    });
    return;
  }
  const matches = args.candidateValues.includes(args.jobValue);
  addResult(args.state, componentScore(args.component, matches ? "MATCH" : "MISMATCH", matches ? args.matchCode : args.mismatchCode, matches ? args.matchReason : args.mismatchReason, args.evidence), matches ? undefined : {
    code: args.mismatchCode, decision: "REVIEW", component: args.component, displayReason: args.mismatchReason,
  });
}

type CountryEligibility = Readonly<{ outcome: "MATCH" | "UNKNOWN" | "BLOCK"; code: JobFitIssueCode }>;

function eligibilityForCountry(
  authorization: CandidateWorkAuthorization | undefined,
  sponsorshipAvailability: NormalizedJobForFit["sponsorshipAvailability"],
): CountryEligibility {
  if (!authorization) return { outcome: "UNKNOWN", code: "WORK_AUTHORIZATION_MISSING" };
  if (authorization.authorized === "UNKNOWN") return { outcome: "UNKNOWN", code: "WORK_AUTHORIZATION_UNRESOLVED" };
  if (authorization.sponsorshipRequired === "UNKNOWN") return { outcome: "UNKNOWN", code: "WORK_AUTHORIZATION_UNRESOLVED" };

  if (authorization.authorized && !authorization.sponsorshipRequired) {
    return { outcome: "MATCH", code: "WORK_AUTHORIZATION_UNRESOLVED" };
  }

  if (!authorization.authorized && !authorization.sponsorshipRequired) {
    return { outcome: "UNKNOWN", code: "WORK_AUTHORIZATION_UNRESOLVED" };
  }

  if (sponsorshipAvailability === "AVAILABLE") return { outcome: "MATCH", code: "SPONSORSHIP_AVAILABILITY_UNKNOWN" };
  if (sponsorshipAvailability === "UNKNOWN") return { outcome: "UNKNOWN", code: "SPONSORSHIP_AVAILABILITY_UNKNOWN" };
  return { outcome: "BLOCK", code: "SPONSORSHIP_UNAVAILABLE" };
}

function evaluateWorkAuthorization(candidate: CandidateSearchProfile, job: NormalizedJobForFit, state: MutableEvaluation): void {
  const evidence = evidenceFor(candidate, job, ["candidate.workAuthorizations", "job.workCountryCodes", "job.sponsorshipAvailability"]);
  const countries = job.workCountryCodes?.map(normalizedCountryCode) ?? [];
  if (countries.length === 0) {
    const displayReason = "Eligibility needs review because the job's work country is missing.";
    addResult(state, componentScore("WORK_AUTHORIZATION", "UNKNOWN", "JOB_WORK_COUNTRY_MISSING", displayReason, evidence), {
      code: "JOB_WORK_COUNTRY_MISSING", decision: "REVIEW", component: "WORK_AUTHORIZATION", displayReason,
    });
    return;
  }

  const authorizations = new Map(candidate.workAuthorizations.map((authorization) => [
    normalizedCountryCode(authorization.countryCode), authorization,
  ]));
  const results = countries.map((country) => eligibilityForCountry(authorizations.get(country), job.sponsorshipAvailability));
  if (results.some((result) => result.outcome === "MATCH")) {
    addResult(state, componentScore("WORK_AUTHORIZATION", "MATCH", "WORK_AUTHORIZATION_MATCH", "Your saved eligibility answers meet at least one stated work-country path for this job.", evidence));
    return;
  }

  const unknown = results.find((result) => result.outcome === "UNKNOWN");
  if (unknown) {
    const displayReason = unknown.code === "SPONSORSHIP_AVAILABILITY_UNKNOWN"
      ? "Eligibility needs review because the employer's sponsorship policy is not known."
      : "Eligibility needs review because a required work-authorization answer is missing or unresolved.";
    addResult(state, componentScore("WORK_AUTHORIZATION", "UNKNOWN", unknown.code, displayReason, evidence), {
      code: unknown.code, decision: "REVIEW", component: "WORK_AUTHORIZATION", displayReason,
    });
    return;
  }

  const sponsorshipBlocked = results.every((result) => result.code === "SPONSORSHIP_UNAVAILABLE");
  const code: JobFitIssueCode = sponsorshipBlocked ? "SPONSORSHIP_UNAVAILABLE" : "WORK_AUTHORIZATION_NOT_MET";
  const displayReason = sponsorshipBlocked
    ? "The employer states that sponsorship is unavailable, but your saved eligibility answers indicate it would be required."
    : "Your saved work-authorization answers do not meet this job's stated requirement.";
  addResult(state, componentScore("WORK_AUTHORIZATION", "MISMATCH", code, displayReason, evidence), {
    code, decision: "BLOCK", component: "WORK_AUTHORIZATION", displayReason,
  });
}

function evaluateClearance(candidate: CandidateSearchProfile, job: NormalizedJobForFit, state: MutableEvaluation): void {
  const evidence = evidenceFor(candidate, job, ["candidate.clearance", "job.clearance"]);
  if (!job.clearance || job.clearance.status === "UNKNOWN") {
    const displayReason = "Clearance eligibility needs review because the posting has not been classified.";
    addResult(state, componentScore("CLEARANCE", "UNKNOWN", "JOB_CLEARANCE_REQUIREMENT_UNKNOWN", displayReason, evidence), {
      code: "JOB_CLEARANCE_REQUIREMENT_UNKNOWN", decision: "REVIEW", component: "CLEARANCE", displayReason,
    });
    return;
  }
  if (job.clearance.status === "NOT_REQUIRED") {
    addResult(state, componentScore("CLEARANCE", "NOT_APPLICABLE", "CLEARANCE_NOT_REQUIRED", "This job does not state a clearance requirement.", evidence));
    return;
  }
  if (!candidate.clearance) {
    const displayReason = "Add your clearance status before this requirement can be evaluated.";
    addResult(state, componentScore("CLEARANCE", "UNKNOWN", "CANDIDATE_CLEARANCE_MISSING", displayReason, evidence), {
      code: "CANDIDATE_CLEARANCE_MISSING", decision: "REVIEW", component: "CLEARANCE", displayReason,
    });
    return;
  }
  if (candidate.clearance.status === "UNKNOWN") {
    const displayReason = "Review your saved clearance status before applying to this job.";
    addResult(state, componentScore("CLEARANCE", "UNKNOWN", "CANDIDATE_CLEARANCE_UNRESOLVED", displayReason, evidence), {
      code: "CANDIDATE_CLEARANCE_UNRESOLVED", decision: "REVIEW", component: "CLEARANCE", displayReason,
    });
    return;
  }
  if (candidate.clearance.status === "NONE") {
    const displayReason = "The job states a clearance requirement that your saved profile does not currently meet.";
    addResult(state, componentScore("CLEARANCE", "MISMATCH", "CLEARANCE_NOT_MET", displayReason, evidence), {
      code: "CLEARANCE_NOT_MET", decision: "BLOCK", component: "CLEARANCE", displayReason,
    });
    return;
  }
  if (candidate.clearance.status === "INACTIVE") {
    if (job.clearance.activeRequired === true) {
      const displayReason = "The job requires an active clearance, which your saved profile does not currently show.";
      addResult(state, componentScore("CLEARANCE", "MISMATCH", "CLEARANCE_NOT_MET", displayReason, evidence), {
        code: "CLEARANCE_NOT_MET", decision: "BLOCK", component: "CLEARANCE", displayReason,
      });
      return;
    }
    if (job.clearance.activeRequired === "UNKNOWN") {
      const displayReason = "Clearance eligibility needs review because the posting does not say whether it must be active.";
      addResult(state, componentScore("CLEARANCE", "UNKNOWN", "CLEARANCE_ACTIVE_STATUS_UNRESOLVED", displayReason, evidence), {
        code: "CLEARANCE_ACTIVE_STATUS_UNRESOLVED", decision: "REVIEW", component: "CLEARANCE", displayReason,
      });
      return;
    }
  }

  if (job.clearance.acceptedLevels === null) {
    const displayReason = "Clearance eligibility needs review because the required level is not stated.";
    addResult(state, componentScore("CLEARANCE", "UNKNOWN", "CLEARANCE_LEVEL_UNRESOLVED", displayReason, evidence), {
      code: "CLEARANCE_LEVEL_UNRESOLVED", decision: "REVIEW", component: "CLEARANCE", displayReason,
    });
    return;
  }

  const acceptedLevels = job.clearance.acceptedLevels.map(normalizedToken).filter(Boolean);
  if (acceptedLevels.length > 0) {
    const candidateLevels = candidate.clearance.levels.map(normalizedToken).filter(Boolean);
    if (candidateLevels.length === 0) {
      const displayReason = "Add your clearance level before this requirement can be evaluated.";
      addResult(state, componentScore("CLEARANCE", "UNKNOWN", "CLEARANCE_LEVEL_UNRESOLVED", displayReason, evidence), {
        code: "CLEARANCE_LEVEL_UNRESOLVED", decision: "REVIEW", component: "CLEARANCE", displayReason,
      });
      return;
    }
    if (!candidateLevels.some((level) => acceptedLevels.includes(level))) {
      const displayReason = "The job's stated clearance level does not match your saved profile.";
      addResult(state, componentScore("CLEARANCE", "MISMATCH", "CLEARANCE_NOT_MET", displayReason, evidence), {
        code: "CLEARANCE_NOT_MET", decision: "BLOCK", component: "CLEARANCE", displayReason,
      });
      return;
    }
  }

  addResult(state, componentScore("CLEARANCE", "MATCH", "CLEARANCE_MATCH", "Your saved clearance status meets the job's stated requirement.", evidence));
}

function scoreSummary(scores: readonly JobFitComponentScore[]): JobFitScoreSummary {
  return Object.freeze({
    matchedComponents: scores.filter((score) => score.verdict === "MATCH").length,
    mismatchedComponents: scores.filter((score) => score.verdict === "MISMATCH").length,
    unknownComponents: scores.filter((score) => score.verdict === "UNKNOWN").length,
    notApplicableComponents: scores.filter((score) => score.verdict === "NOT_APPLICABLE").length,
    assessedComponents: scores.filter((score) => score.verdict === "MATCH" || score.verdict === "MISMATCH").length,
  });
}

export function assessJobFit(
  candidate: CandidateSearchProfile,
  job: NormalizedJobForFit,
  context: JobFitAssessmentContext,
): JobFitAssessment {
  validateVersionRef(candidate.version);
  validateVersionRef(job.version);
  validateContext(context);

  const state: MutableEvaluation = { scores: [], issues: [] };
  evaluateRole(candidate, job, state);
  evaluateLocation(candidate, job, state);
  evaluateEnumPreference({
    component: "WORK_MODE",
    candidateValues: candidate.acceptableWorkModes,
    jobValue: job.workMode,
    candidateMissingCode: "CANDIDATE_WORK_MODES_MISSING",
    jobMissingCode: "JOB_WORK_MODE_MISSING",
    mismatchCode: "WORK_MODE_PREFERENCE_MISMATCH",
    matchCode: "WORK_MODE_PREFERENCE_MATCH",
    candidateMissingReason: "Add an acceptable work mode before this job can be recommended.",
    jobMissingReason: "Work-mode fit needs review because the posting does not state one.",
    mismatchReason: "This job's work mode is outside your saved preferences.",
    matchReason: "The job's work mode matches your saved preferences.",
    evidence: evidenceFor(candidate, job, ["candidate.acceptableWorkModes", "job.workMode"]),
    state,
  });
  evaluateEnumPreference({
    component: "EMPLOYMENT_TYPE",
    candidateValues: candidate.acceptableEmploymentTypes,
    jobValue: job.employmentType,
    candidateMissingCode: "CANDIDATE_EMPLOYMENT_TYPES_MISSING",
    jobMissingCode: "JOB_EMPLOYMENT_TYPE_MISSING",
    mismatchCode: "EMPLOYMENT_TYPE_PREFERENCE_MISMATCH",
    matchCode: "EMPLOYMENT_TYPE_PREFERENCE_MATCH",
    candidateMissingReason: "Add an acceptable employment type before this job can be recommended.",
    jobMissingReason: "Employment-type fit needs review because the posting does not state one.",
    mismatchReason: "This job's employment type is outside your saved preferences.",
    matchReason: "The job's employment type matches your saved preferences.",
    evidence: evidenceFor(candidate, job, ["candidate.acceptableEmploymentTypes", "job.employmentType"]),
    state,
  });
  evaluateWorkAuthorization(candidate, job, state);
  evaluateClearance(candidate, job, state);

  const blockers = Object.freeze(state.issues.filter((issue) => issue.decision === "BLOCK"));
  const reviewFlags = Object.freeze(state.issues.filter((issue) => issue.decision === "REVIEW"));
  const decision: JobFitDecision = blockers.length > 0 ? "BLOCK" : reviewFlags.length > 0 ? "REVIEW" : "ADMIT";
  const componentScores = Object.freeze([...state.scores]);

  return Object.freeze({
    assessmentId: context.assessmentId,
    evaluatedAt: context.evaluatedAt,
    policyVersion: JOB_FIT_POLICY_VERSION,
    candidateProfileVersion: Object.freeze({ ...candidate.version }),
    jobVersion: Object.freeze({ ...job.version }),
    decision,
    componentScores,
    scoreSummary: scoreSummary(componentScores),
    blockers,
    reviewFlags,
  });
}
