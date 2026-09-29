import {
  JOB_FIT_POLICY_VERSION,
  type FitEntityVersionRef,
  type JobFitDecision,
} from "./job-fit.ts";

export type OpportunityCatalogFitSummary = Readonly<{
  assessmentId: string;
  evaluatedAt: string;
  policyVersion: typeof JOB_FIT_POLICY_VERSION;
  decision: JobFitDecision;
  matchedComponents: number;
  reasons: readonly string[];
  candidateProfileVersion: FitEntityVersionRef;
  jobVersion: FitEntityVersionRef;
}>;

export type OpportunityCatalogItem = Readonly<{
  jobId: string;
  jobVersionId: string;
  canonicalUrl: string;
  employerName: string;
  title: string;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  description: string;
  applyUrl: string;
  publishedAt: string | null;
  observedAt: string;
  sourceProvider: string;
  saved: boolean;
  queuedApplicationId: string | null;
  fit: OpportunityCatalogFitSummary | null;
}>;

export type OpportunityCatalogDTO = Readonly<{
  query: string;
  location: string;
  workMode: OpportunityWorkModeFilter;
  employmentType: OpportunityEmploymentTypeFilter;
  savedOnly: boolean;
  cursor: string;
  nextCursor: string | null;
  items: readonly OpportunityCatalogItem[];
}>;

export const OPPORTUNITY_WORK_MODES = ["REMOTE", "HYBRID", "ONSITE"] as const;
export type OpportunityWorkModeFilter = "" | (typeof OPPORTUNITY_WORK_MODES)[number];

export const OPPORTUNITY_EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERN",
  "TEMPORARY",
] as const;
export type OpportunityEmploymentTypeFilter = "" | (typeof OPPORTUNITY_EMPLOYMENT_TYPES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PUBLIC_HTTPS_URL_PATTERN = /^https:\/\/[^\s]+$/iu;

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(row: UnknownRecord, key: string, maximum: number): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return normalized;
}

function optionalString(row: UnknownRecord, key: string, maximum: number): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return normalized;
}

function requiredUuid(row: UnknownRecord, key: string): string {
  const value = requiredString(row, key, 36);
  if (!UUID_PATTERN.test(value)) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return value;
}

function optionalUuid(row: UnknownRecord, key: string): string | null {
  const value = optionalString(row, key, 36);
  if (value !== null && !UUID_PATTERN.test(value)) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return value;
}

function requiredUrl(row: UnknownRecord, key: string): string {
  const value = requiredString(row, key, 2_048);
  if (!PUBLIC_HTTPS_URL_PATTERN.test(value)) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return value;
}

function requiredDate(row: UnknownRecord, key: string): string {
  const value = requiredString(row, key, 80);
  if (Number.isNaN(Date.parse(value))) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return value;
}

function optionalDate(row: UnknownRecord, key: string): string | null {
  const value = optionalString(row, key, 80);
  if (value !== null && Number.isNaN(Date.parse(value))) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return value;
}

function readBoolean(row: UnknownRecord, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");
  return value;
}

function readInteger(row: UnknownRecord, key: string, minimum: number, maximum: number): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error("OPPORTUNITY_CATALOG_FIT_INVALID");
  }
  return value as number;
}

function parseFitVersionRef(value: unknown): FitEntityVersionRef {
  if (!isRecord(value)) throw new Error("OPPORTUNITY_CATALOG_FIT_INVALID");
  return Object.freeze({
    entityId: requiredString(value, "entityId", 200),
    versionId: requiredString(value, "versionId", 200),
    versionNumber: readInteger(value, "versionNumber", 1, Number.MAX_SAFE_INTEGER),
    contentHash: requiredString(value, "contentHash", 200),
    capturedAt: requiredDate(value, "capturedAt"),
  });
}

export function parseOpportunityCatalogFitSummary(value: unknown): OpportunityCatalogFitSummary {
  if (!isRecord(value) || "percentage" in value || "scorePercentage" in value) {
    throw new Error("OPPORTUNITY_CATALOG_FIT_INVALID");
  }
  const decision = value.decision;
  if (decision !== "ADMIT" && decision !== "REVIEW" && decision !== "BLOCK") {
    throw new Error("OPPORTUNITY_CATALOG_FIT_INVALID");
  }
  if (value.policyVersion !== JOB_FIT_POLICY_VERSION || !Array.isArray(value.reasons) || value.reasons.length > 2) {
    throw new Error("OPPORTUNITY_CATALOG_FIT_INVALID");
  }
  const reasons = value.reasons.map((reason) => {
    if (typeof reason !== "string") throw new Error("OPPORTUNITY_CATALOG_FIT_INVALID");
    const normalized = reason.trim().replace(/\s+/gu, " ");
    if (!normalized || normalized.length > 240) throw new Error("OPPORTUNITY_CATALOG_FIT_INVALID");
    return normalized;
  });

  return Object.freeze({
    assessmentId: requiredString(value, "assessmentId", 200),
    evaluatedAt: requiredDate(value, "evaluatedAt"),
    policyVersion: JOB_FIT_POLICY_VERSION,
    decision,
    matchedComponents: readInteger(value, "matchedComponents", 0, 6),
    reasons: Object.freeze(reasons),
    candidateProfileVersion: parseFitVersionRef(value.candidateProfileVersion),
    jobVersion: parseFitVersionRef(value.jobVersion),
  });
}

export function normalizeOpportunityQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 120);
}

export function normalizeOpportunityLocation(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 120);
}

export function normalizeOpportunityWorkMode(value: string): OpportunityWorkModeFilter {
  return OPPORTUNITY_WORK_MODES.includes(value as (typeof OPPORTUNITY_WORK_MODES)[number])
    ? value as OpportunityWorkModeFilter
    : "";
}

export function normalizeOpportunityEmploymentType(value: string): OpportunityEmploymentTypeFilter {
  return OPPORTUNITY_EMPLOYMENT_TYPES.includes(value as (typeof OPPORTUNITY_EMPLOYMENT_TYPES)[number])
    ? value as OpportunityEmploymentTypeFilter
    : "";
}

export function parseOpportunityCatalogRows(value: unknown): readonly OpportunityCatalogItem[] {
  if (!Array.isArray(value)) throw new Error("OPPORTUNITY_CATALOG_RESULT_INVALID");

  return Object.freeze(value.map((rawRow) => {
    if (!isRecord(rawRow)) throw new Error("OPPORTUNITY_CATALOG_ROW_INVALID");

    return Object.freeze({
      jobId: requiredUuid(rawRow, "job_id"),
      jobVersionId: requiredUuid(rawRow, "job_version_id"),
      canonicalUrl: requiredUrl(rawRow, "canonical_url"),
      employerName: requiredString(rawRow, "employer_name", 240),
      title: requiredString(rawRow, "title", 400),
      location: optionalString(rawRow, "location_text", 2_000),
      workMode: optionalString(rawRow, "work_mode", 40),
      employmentType: optionalString(rawRow, "employment_type", 120),
      description: requiredString(rawRow, "description_text", 200_000),
      applyUrl: requiredUrl(rawRow, "apply_url"),
      publishedAt: optionalDate(rawRow, "published_at"),
      observedAt: requiredDate(rawRow, "observed_at"),
      sourceProvider: requiredString(rawRow, "source_provider", 40),
      saved: readBoolean(rawRow, "saved"),
      queuedApplicationId: optionalUuid(rawRow, "queued_application_id"),
      fit: null,
    });
  }));
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
