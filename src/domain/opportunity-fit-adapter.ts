import { createHash } from "node:crypto";

import type { CandidateProfileFactView } from "./candidate-profile.ts";
import {
  JOB_FIT_POLICY_VERSION,
  assessJobFit,
  type CandidateLocationPreference,
  type CandidateSearchProfile,
  type FitEntityVersionRef,
  type FitFieldSource,
  type JobClearanceRequirement,
  type JobEmploymentType,
  type JobWorkMode,
  type NormalizedJobForFit,
  type NormalizedJobLocation,
} from "./job-fit.ts";
import {
  parseOpportunityCatalogFitSummary,
  type OpportunityCatalogFitSummary,
  type OpportunityCatalogItem,
} from "./opportunity-catalog.ts";

export const CATALOG_FIT_NORMALIZER_VERSION = "roledawn-catalog-fit-normalizer/1" as const;

export type CatalogFitSearchProfileRow = Readonly<{
  candidateId: string;
  aggregateVersion: number;
  targetRoles: readonly string[];
  preferredLocations: readonly string[];
  desiredCountryCodes: readonly string[];
  workModes: readonly string[];
  employmentTypes: readonly string[];
  updatedAt: string;
}>;

export type CatalogFitCandidateInput = Readonly<{
  candidateId: string;
  candidateCreatedAt: string;
  searchProfile: CatalogFitSearchProfileRow | null;
  facts: readonly CandidateProfileFactView[];
}>;

export type CatalogFitJobVersionRow = Readonly<{
  id: string;
  jobId: string;
  versionNumber: number;
  title: string;
  descriptionText: string;
  locationText: string | null;
  workMode: string | null;
  employmentType: string | null;
  observedAt: string;
}>;

const US_REGION_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
]);
const CA_REGION_CODES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const US_REGION_NAMES = new Map([
  ["california", "CA"], ["colorado", "CO"], ["connecticut", "CT"], ["district of columbia", "DC"],
  ["florida", "FL"], ["georgia", "GA"], ["illinois", "IL"], ["maryland", "MD"], ["massachusetts", "MA"],
  ["michigan", "MI"], ["new jersey", "NJ"], ["new york", "NY"], ["north carolina", "NC"], ["ohio", "OH"],
  ["oregon", "OR"], ["pennsylvania", "PA"], ["texas", "TX"], ["utah", "UT"], ["virginia", "VA"],
  ["washington", "WA"],
]);
const CA_REGION_NAMES = new Map([
  ["alberta", "AB"], ["british columbia", "BC"], ["manitoba", "MB"], ["new brunswick", "NB"],
  ["newfoundland and labrador", "NL"], ["nova scotia", "NS"], ["ontario", "ON"],
  ["prince edward island", "PE"], ["quebec", "QC"], ["saskatchewan", "SK"],
]);

const ROLE_FAMILY_RULES: readonly Readonly<{ family: string; patterns: readonly RegExp[] }>[] = Object.freeze([
  { family: "forward deployed engineering", patterns: [/\bforward deployed (?:engineer|engineering)\b/iu, /\bfde\b/u] },
  { family: "solutions engineering", patterns: [/\bsolutions? (?:engineer|engineering|architect)\b/iu, /\bsales engineer\b/iu] },
  { family: "machine learning engineering", patterns: [/\bmachine learning (?:engineer|engineering)\b/iu, /\b(?:ai|artificial intelligence) engineer\b/iu] },
  { family: "data engineering", patterns: [/\bdata (?:engineer|engineering|platform engineer)\b/iu] },
  { family: "data science", patterns: [/\bdata scientist\b/iu, /\bdata science\b/iu] },
  { family: "software engineering", patterns: [/\bsoftware (?:engineer|engineering|developer)\b/iu, /\b(?:front[ -]?end|back[ -]?end|full[ -]?stack|mobile|web) (?:engineer|developer)\b/iu, /\bengineering manager\b/iu] },
  { family: "product management", patterns: [/\bproduct manager\b/iu, /\bproduct management\b/iu, /\bproduct owner\b/iu] },
  { family: "program management", patterns: [/\bprogram manager\b/iu, /\btechnical program manager\b/iu] },
  { family: "project management", patterns: [/\bproject manager\b/iu, /\bproject management\b/iu] },
  { family: "customer success", patterns: [/\bcustomer success\b/iu, /\bclient success\b/iu] },
  { family: "sales", patterns: [/\baccount executive\b/iu, /\bsales (?:manager|director|representative)\b/iu, /\bbusiness development\b/iu] },
  { family: "marketing", patterns: [/\bmarketing\b/iu, /\bgrowth manager\b/iu] },
  { family: "operations", patterns: [/\boperations? (?:manager|lead|director|associate|specialist)\b/iu, /\bchief of staff\b/iu] },
  { family: "design", patterns: [/\b(?:product|ux|ui|visual) designer\b/iu, /\bdesign (?:lead|manager|director)\b/iu] },
  { family: "security engineering", patterns: [/\b(?:security|cybersecurity) (?:engineer|engineering|analyst)\b/iu] },
  { family: "research", patterns: [/\bresearch (?:scientist|engineer|associate|lead)\b/iu] },
  { family: "recruiting", patterns: [/\b(?:recruiter|recruiting|talent acquisition)\b/iu] },
  { family: "finance", patterns: [/\b(?:finance|financial) (?:analyst|manager|director)\b/iu, /\bcontroller\b/iu] },
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function projectionHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/[–—]/gu, "-").replace(/\s+/gu, " ");
}

export function roleFamiliesForTitle(value: string): readonly string[] {
  const normalized = normalizedText(value);
  return Object.freeze(ROLE_FAMILY_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(normalized)))
    .map((rule) => rule.family));
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function countryFromText(value: string): "US" | "CA" | null {
  if (/\b(?:united states(?: of america)?|u\.s\.?a?\.?|usa)\b/iu.test(value)) return "US";
  if (/\bcanada\b/iu.test(value)) return "CA";
  return null;
}

function normalizedRegion(value: string): Readonly<{ countryCode: "US" | "CA"; regionCode: string }> | null {
  const upper = value.trim().toUpperCase().replace(/[^A-Z]/gu, "");
  if (US_REGION_CODES.has(upper)) return { countryCode: "US", regionCode: upper };
  if (CA_REGION_CODES.has(upper)) return { countryCode: "CA", regionCode: upper };
  const lower = normalizedText(value).replace(/[^a-z ]/gu, "").trim();
  const usCode = US_REGION_NAMES.get(lower);
  if (usCode) return { countryCode: "US", regionCode: usCode };
  const caCode = CA_REGION_NAMES.get(lower);
  return caCode ? { countryCode: "CA", regionCode: caCode } : null;
}

function parseLocationSegment(
  rawValue: string,
  fallbackCountryCodes: readonly string[],
): NormalizedJobLocation | null {
  const value = rawValue.trim().replace(/^location\s*:\s*/iu, "");
  if (!value) return null;
  const explicitCountry = countryFromText(value);
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const region = [...parts].reverse().map(normalizedRegion).find(Boolean) ?? null;
  const fallback = fallbackCountryCodes.length === 1 && (fallbackCountryCodes[0] === "US" || fallbackCountryCodes[0] === "CA")
    ? fallbackCountryCodes[0] as "US" | "CA"
    : null;
  const countryCode = explicitCountry ?? region?.countryCode ?? fallback;
  if (!countryCode) return null;

  const remoteOnly = /\b(?:remote|anywhere|multiple locations?)\b/iu.test(value);
  const first = parts[0]?.replace(/\([^)]*\)/gu, "").trim() ?? "";
  const firstIsCountry = countryFromText(first) !== null;
  const firstIsRegion = parts.length === 1 && normalizedRegion(first) !== null;
  const city = !remoteOnly && first && !firstIsCountry && !firstIsRegion ? first : null;
  return Object.freeze({ countryCode, regionCode: region?.regionCode ?? null, city });
}

export function parseFitLocations(
  value: string | null,
  fallbackCountryCodes: readonly string[] = [],
): readonly NormalizedJobLocation[] {
  if (!value?.trim()) return Object.freeze([]);
  const parsed = value.split(/\s*[|;\n]\s*|\s+\/\s+/gu)
    .map((segment) => parseLocationSegment(segment, fallbackCountryCodes))
    .filter((location): location is NormalizedJobLocation => location !== null);
  const seen = new Set<string>();
  return Object.freeze(parsed.filter((location) => {
    const key = `${location.countryCode}:${location.regionCode ?? ""}:${normalizedText(location.city ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function sponsorshipAvailability(description: string): NormalizedJobForFit["sponsorshipAvailability"] {
  const normalized = normalizedText(description);
  const unavailable = [
    /\b(?:unable|not able|cannot|can't|do not|does not|won't|will not)\s+(?:provide|offer|support)?\s*(?:visa\s+)?sponsorship\b/u,
    /\bno\s+(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|provided|offered)\b/u,
    /\bwithout\s+(?:current\s+or\s+future\s+)?(?:visa\s+)?sponsorship\b/u,
  ].some((pattern) => pattern.test(normalized));
  const available = [
    /\b(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:available|provided|offered)\b/u,
    /\bwe\s+(?:can|will|do)\s+(?:provide|offer)\s+(?:visa\s+)?sponsorship\b/u,
  ].some((pattern) => [...normalized.matchAll(new RegExp(pattern.source, "gu"))].some((match) =>
    !/(?:\bno|\bnot)\s+(?:visa\s+)?$/u.test(normalized.slice(Math.max(0, match.index - 20), match.index))));
  if (unavailable === available) return "UNKNOWN";
  return unavailable ? "NOT_AVAILABLE" : "AVAILABLE";
}

function clearanceRequirement(title: string, description: string): JobClearanceRequirement | null {
  const normalized = normalizedText(`${title}\n${description}`);
  const mentionsClearance = /\b(?:security clearance|public trust|ts\/sci|top secret|secret clearance)\b/u.test(normalized);
  if (!mentionsClearance) return null;
  if (/\b(?:no|not)\s+(?:active\s+|security\s+)?clearance\s+(?:is\s+)?required\b/u.test(normalized)) {
    return Object.freeze({ status: "NOT_REQUIRED", acceptedLevels: Object.freeze([]), activeRequired: false });
  }
  const explicitlyRequired = [
    /\b(?:clearance|public trust)\s+(?:is\s+)?required\b/u,
    /\brequires?\s+(?:an?\s+)?(?:active\s+|current\s+)?(?:security\s+)?clearance\b/u,
    /\bmust\s+(?:hold|have|possess|maintain|obtain)\b.{0,60}\b(?:clearance|public trust)\b/u,
    /\bability\s+to\s+obtain\b.{0,60}\b(?:clearance|public trust)\b/u,
  ].some((pattern) => pattern.test(normalized));
  if (!explicitlyRequired) {
    return Object.freeze({ status: "UNKNOWN", acceptedLevels: null, activeRequired: "UNKNOWN" });
  }
  const levels: string[] = [];
  if (/\b(?:ts\/sci|top secret\/sci)\b/u.test(normalized)) levels.push("TS/SCI");
  else if (/\btop secret\b/u.test(normalized)) levels.push("TOP SECRET");
  else if (/\bsecret(?: clearance)?\b/u.test(normalized)) levels.push("SECRET");
  else if (/\bpublic trust\b/u.test(normalized)) levels.push("PUBLIC TRUST");
  const activeRequired = /\b(?:active|current)\b.{0,30}\b(?:clearance|public trust|ts\/sci|top secret|secret)\b/u.test(normalized);
  return Object.freeze({ status: "REQUIRED", acceptedLevels: levels.length > 0 ? Object.freeze(levels) : null, activeRequired });
}

function fitVersion(ref: FitEntityVersionRef): FitEntityVersionRef {
  return Object.freeze({ ...ref });
}

function profileSource(row: CatalogFitSearchProfileRow, fieldPath: string): FitFieldSource {
  return Object.freeze({
    fieldPath,
    sourceKind: "CANDIDATE_PREFERENCE",
    sourceId: row.candidateId,
    sourceVersionId: `${row.candidateId}:${row.aggregateVersion}`,
    recordedAt: row.updatedAt,
  });
}

function factSource(fact: CandidateProfileFactView): FitFieldSource {
  return Object.freeze({
    fieldPath: "candidate.workAuthorizations",
    sourceKind: "CANDIDATE_ATTESTATION",
    sourceId: fact.factId,
    sourceVersionId: fact.factVersionId,
    recordedAt: fact.reviewedAt,
  });
}

function knownBoolean(fact: CandidateProfileFactView | undefined): boolean | "UNKNOWN" {
  return fact?.resolved && typeof fact.value === "boolean" ? fact.value : "UNKNOWN";
}

export function candidateFitProfile(input: CatalogFitCandidateInput): CandidateSearchProfile {
  const row = input.searchProfile;
  if (!row) {
    return Object.freeze({
      version: fitVersion({
        entityId: input.candidateId,
        versionId: "candidate-search-profile:not-configured",
        versionNumber: 1,
        contentHash: projectionHash({ candidateId: input.candidateId, state: "NOT_CONFIGURED" }),
        capturedAt: input.candidateCreatedAt,
      }),
      targetRoleFamilies: Object.freeze([]),
      preferredLocations: Object.freeze([]),
      acceptableWorkModes: Object.freeze([]),
      acceptableEmploymentTypes: Object.freeze([]),
      workAuthorizations: Object.freeze([]),
      clearance: null,
      fieldSources: Object.freeze([]),
    });
  }

  const workModes = row.workModes.filter((value): value is JobWorkMode => value === "REMOTE" || value === "HYBRID" || value === "ONSITE");
  const employmentTypes = row.employmentTypes.filter((value): value is JobEmploymentType =>
    value === "FULL_TIME" || value === "PART_TIME" || value === "CONTRACT" || value === "INTERN" || value === "TEMPORARY");
  const desiredCountries = row.desiredCountryCodes.filter((value) => value === "US" || value === "CA");
  const locations = row.preferredLocations.flatMap((location) => parseFitLocations(location, desiredCountries));
  const remoteCountryFallbacks: readonly CandidateLocationPreference[] = locations.length === 0 && workModes.includes("REMOTE")
    ? desiredCountries.map((countryCode) => Object.freeze({ countryCode, regionCode: null, city: null }))
    : Object.freeze([]);
  const facts = new Map(input.facts.map((fact) => [fact.key, fact] as const));
  const workAuthorizations = desiredCountries.map((countryCode) => {
    const countryKey = countryCode.toLocaleLowerCase("en-US");
    return Object.freeze({
      countryCode,
      authorized: knownBoolean(facts.get(`work_authorization.${countryKey}.authorized` as "work_authorization.us.authorized" | "work_authorization.ca.authorized")),
      sponsorshipRequired: knownBoolean(facts.get(`work_authorization.${countryKey}.sponsorship_required` as "work_authorization.us.sponsorship_required" | "work_authorization.ca.sponsorship_required")),
    });
  });
  const profileFields = [
    "candidate.targetRoleFamilies",
    "candidate.preferredLocations",
    "candidate.acceptableWorkModes",
    "candidate.acceptableEmploymentTypes",
  ].map((fieldPath) => profileSource(row, fieldPath));
  const workFactSources = input.facts.filter((fact) => fact.key.startsWith("work_authorization.") && fact.resolved).map(factSource);
  const targetRoleFamilies = unique(row.targetRoles.flatMap(roleFamiliesForTitle));
  const preferredLocations = unique([...locations, ...remoteCountryFallbacks].map((location) => JSON.stringify(location)))
    .map((location) => Object.freeze(JSON.parse(location) as CandidateLocationPreference));
  const versionProjection = {
    targetRoleFamilies,
    preferredLocations,
    acceptableWorkModes: workModes,
    acceptableEmploymentTypes: employmentTypes,
    workAuthorizations,
  };

  return Object.freeze({
    version: fitVersion({
      entityId: row.candidateId,
      versionId: `${row.candidateId}:${row.aggregateVersion}`,
      versionNumber: row.aggregateVersion,
      contentHash: projectionHash(versionProjection),
      capturedAt: row.updatedAt,
    }),
    targetRoleFamilies,
    preferredLocations: Object.freeze(preferredLocations),
    acceptableWorkModes: Object.freeze(workModes),
    acceptableEmploymentTypes: Object.freeze(employmentTypes),
    workAuthorizations: Object.freeze(workAuthorizations),
    clearance: null,
    fieldSources: Object.freeze([...profileFields, ...workFactSources]),
  });
}

function officialSource(row: CatalogFitJobVersionRow, fieldPath: string): FitFieldSource {
  return Object.freeze({
    fieldPath,
    sourceKind: "OFFICIAL_JOB_POSTING",
    sourceId: row.jobId,
    sourceVersionId: row.id,
    recordedAt: row.observedAt,
  });
}

function normalizationSource(row: CatalogFitJobVersionRow, fieldPath: string): FitFieldSource {
  return Object.freeze({
    fieldPath,
    sourceKind: "NORMALIZATION_POLICY",
    sourceId: CATALOG_FIT_NORMALIZER_VERSION,
    sourceVersionId: row.id,
    recordedAt: row.observedAt,
  });
}

export function normalizedCatalogJob(row: CatalogFitJobVersionRow): NormalizedJobForFit {
  const roleFamilies = roleFamiliesForTitle(row.title);
  const locations = parseFitLocations(row.locationText);
  const workMode = row.workMode === "REMOTE" || row.workMode === "HYBRID" || row.workMode === "ONSITE" ? row.workMode : null;
  const employmentType = row.employmentType === "FULL_TIME" || row.employmentType === "PART_TIME" || row.employmentType === "CONTRACT" || row.employmentType === "INTERN" || row.employmentType === "TEMPORARY"
    ? row.employmentType
    : null;
  const sponsorship = sponsorshipAvailability(row.descriptionText);
  const clearance = clearanceRequirement(row.title, row.descriptionText);
  const versionProjection = {
    id: row.id,
    jobId: row.jobId,
    versionNumber: row.versionNumber,
    title: row.title,
    descriptionText: row.descriptionText,
    locationText: row.locationText,
    workMode: row.workMode,
    employmentType: row.employmentType,
    observedAt: row.observedAt,
  };
  const fields = ["job.roleFamilies", "job.locations", "job.workMode", "job.employmentType", "job.workCountryCodes", "job.sponsorshipAvailability", "job.clearance"];

  return Object.freeze({
    version: fitVersion({
      entityId: row.jobId,
      versionId: row.id,
      versionNumber: row.versionNumber,
      contentHash: projectionHash(versionProjection),
      capturedAt: row.observedAt,
    }),
    title: row.title,
    roleFamilies: roleFamilies.length > 0 ? roleFamilies : null,
    locations: locations.length > 0 ? locations : null,
    workMode,
    employmentType,
    workCountryCodes: locations.length > 0 ? unique(locations.map((location) => location.countryCode)) : null,
    sponsorshipAvailability: sponsorship,
    clearance,
    fieldSources: Object.freeze(fields.flatMap((fieldPath) => [officialSource(row, fieldPath), normalizationSource(row, fieldPath)])),
  });
}

function summaryReasons(assessment: ReturnType<typeof assessJobFit>): readonly string[] {
  if (assessment.decision === "ADMIT") {
    return Object.freeze(assessment.componentScores
      .filter((component) => component.verdict === "MATCH")
      .slice(0, 2)
      .map((component) => component.displayReason));
  }
  return Object.freeze([...assessment.blockers, ...assessment.reviewFlags]
    .slice(0, 2)
    .map((issue) => issue.displayReason));
}

export function assessCatalogItemFit(
  candidate: CandidateSearchProfile,
  job: NormalizedJobForFit,
  evaluatedAt: string,
): OpportunityCatalogFitSummary {
  const assessmentId = `catalog-read:${projectionHash({
    policyVersion: JOB_FIT_POLICY_VERSION,
    candidateVersion: candidate.version,
    jobVersion: job.version,
  }).slice("sha256:".length)}`;
  const assessment = assessJobFit(candidate, job, { assessmentId, evaluatedAt });
  return parseOpportunityCatalogFitSummary({
    assessmentId,
    evaluatedAt,
    policyVersion: assessment.policyVersion,
    decision: assessment.decision,
    matchedComponents: assessment.scoreSummary.matchedComponents,
    reasons: summaryReasons(assessment),
    candidateProfileVersion: assessment.candidateProfileVersion,
    jobVersion: assessment.jobVersion,
  });
}

export function attachCatalogItemFit(
  item: OpportunityCatalogItem,
  candidate: CandidateSearchProfile,
  row: CatalogFitJobVersionRow,
  evaluatedAt: string,
): OpportunityCatalogItem {
  if (item.jobId !== row.jobId || item.jobVersionId !== row.id) {
    throw new Error("CATALOG_FIT_JOB_VERSION_MISMATCH");
  }
  return Object.freeze({ ...item, fit: assessCatalogItemFit(candidate, normalizedCatalogJob(row), evaluatedAt) });
}
