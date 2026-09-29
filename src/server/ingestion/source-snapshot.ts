import { canonicalizeJson, hashNormalizedJobVersion } from "./canonical.ts";
import type {
  LoadedSourceSnapshot,
  NormalizedCompensation,
  NormalizedSourceJob,
  NormalizedSourceSnapshot,
} from "./contracts.ts";

export const JOB_SOURCE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type JobSourceClaim = Readonly<{
  sourceId: string;
  ingestionRunId: string;
  provider: "GREENHOUSE" | "LEVER" | "ASHBY";
  tenantKey: string;
  adapterRelease: string;
  etag: string | null;
  sourceOptions: Readonly<Record<string, unknown>>;
}>;

type SerializedLocation = Readonly<{
  label: string;
  country_code: string | null;
}>;

type SerializedCompensation = Readonly<{
  kind: string | null;
  currency_code: string | null;
  interval: string | null;
  minimum: number | null;
  maximum: number | null;
  summary: string | null;
}>;

// Provider HTML is deliberately absent. Nothing reads it from the catalog, it
// roughly doubled the RPC body for full-content boards, and it was the bulk of
// stored normalized_data. content_hash still covers it (hashNormalizedJobVersion),
// so a formatting-only provider change still produces a new version.
type SerializedNormalizedJob = Readonly<{
  schema_version: 1;
  provider: NormalizedSourceJob["provider"];
  tenant_key: string;
  external_job_id: string;
  external_job_id_basis: NormalizedSourceJob["externalJobIdBasis"];
  department: string | null;
  team: string | null;
  requisition_id: string | null;
  language: string | null;
  posted_at_confidence: NormalizedSourceJob["postedAtConfidence"];
  source_updated_at: string | null;
  workplace_type: NormalizedSourceJob["workplaceType"];
  compensation: readonly SerializedCompensation[];
}>;

export type SerializedSourceJob = Readonly<{
  external_job_id: string;
  title: string;
  canonical_job_url: string;
  apply_url: string;
  description_text: string | null;
  locations: readonly SerializedLocation[];
  work_mode: "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";
  employment_type: NormalizedSourceJob["employmentType"];
  published_at: string | null;
  observed_at: string;
  listed: boolean;
  content_hash: string;
  normalized_data: SerializedNormalizedJob;
}>;

export type SerializedSourceSnapshot = Readonly<{
  schema_version: typeof JOB_SOURCE_SNAPSHOT_SCHEMA_VERSION;
  complete: true;
  observed_at: string;
  jobs: readonly SerializedSourceJob[];
  issues: readonly [];
}>;

function normalizedWorkMode(
  value: NormalizedSourceJob["workplaceType"],
): SerializedSourceJob["work_mode"] {
  if (value === "ON_SITE") return "ONSITE";
  if (value === "UNSPECIFIED") return "UNKNOWN";
  return value;
}

function serializeCompensation(
  value: NormalizedCompensation,
): SerializedCompensation {
  return {
    kind: value.kind,
    currency_code: value.currencyCode,
    interval: value.interval,
    minimum: value.minimum,
    maximum: value.maximum,
    summary: value.summary,
  };
}

function stableJobOrder(left: NormalizedSourceJob, right: NormalizedSourceJob): number {
  return left.externalJobId.localeCompare(right.externalJobId)
    || left.canonicalJobUrl.localeCompare(right.canonicalJobUrl);
}

function stableLocationOrder(left: SerializedLocation, right: SerializedLocation): number {
  return left.label.localeCompare(right.label)
    || (left.country_code ?? "").localeCompare(right.country_code ?? "");
}

function stableCompensationOrder(
  left: SerializedCompensation,
  right: SerializedCompensation,
): number {
  return canonicalizeJson(left).localeCompare(canonicalizeJson(right));
}

function assertHttps(value: string, code: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(code);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(code);
  }
}

function assertSourceIdentity(
  claim: JobSourceClaim,
  snapshot: NormalizedSourceSnapshot,
): void {
  if (
    snapshot.sourceId !== claim.sourceId
    || snapshot.provider !== claim.provider
    || snapshot.tenantKey !== claim.tenantKey
  ) {
    throw new Error("JOB_SOURCE_SNAPSHOT_IDENTITY_MISMATCH");
  }
}

function serializeJob(claim: JobSourceClaim, job: NormalizedSourceJob): SerializedSourceJob {
  if (
    job.sourceId !== claim.sourceId
    || job.provider !== claim.provider
    || job.tenantKey !== claim.tenantKey
  ) {
    throw new Error("JOB_SOURCE_JOB_IDENTITY_MISMATCH");
  }
  assertHttps(job.canonicalJobUrl, "JOB_SOURCE_CANONICAL_URL_INVALID");
  assertHttps(job.applyUrl, "JOB_SOURCE_APPLY_URL_INVALID");

  const locations = job.locations
    .map((location) => ({
      label: location.label,
      country_code: location.countryCode,
    }))
    .sort(stableLocationOrder);
  const compensation = job.compensation
    .map(serializeCompensation)
    .sort(stableCompensationOrder);

  return {
    external_job_id: job.externalJobId,
    title: job.title,
    canonical_job_url: job.canonicalJobUrl,
    apply_url: job.applyUrl,
    description_text: job.descriptionText,
    locations,
    work_mode: normalizedWorkMode(job.workplaceType),
    employment_type: job.employmentType,
    published_at: job.sourcePostedAt,
    observed_at: job.observedAt,
    listed: job.listed,
    content_hash: hashNormalizedJobVersion(job),
    normalized_data: {
      schema_version: 1,
      provider: job.provider,
      tenant_key: job.tenantKey,
      external_job_id: job.externalJobId,
      external_job_id_basis: job.externalJobIdBasis,
      department: job.department,
      team: job.team,
      requisition_id: job.requisitionId,
      language: job.language,
      posted_at_confidence: job.postedAtConfidence,
      source_updated_at: job.sourceUpdatedAt,
      workplace_type: job.workplaceType,
      compensation,
    },
  };
}

/**
 * Converts an accepted complete adapter snapshot into the compact JSON contract
 * consumed by the transactional catalog RPC: only the fields the catalog
 * stores, with plain-text descriptions and no provider HTML. Incomplete
 * snapshots never reach this boundary, so they cannot contribute absence
 * evidence or close listings.
 */
export function serializeSourceSnapshot(
  claim: JobSourceClaim,
  loaded: LoadedSourceSnapshot,
): SerializedSourceSnapshot {
  assertSourceIdentity(claim, loaded.snapshot);
  assertHttps(loaded.endpoint, "JOB_SOURCE_ENDPOINT_INVALID");
  if (!loaded.snapshot.complete || loaded.snapshot.issues.length > 0) {
    throw new Error("JOB_SOURCE_SNAPSHOT_INCOMPLETE");
  }
  if (loaded.responseStatus < 200 || loaded.responseStatus >= 300) {
    throw new Error("JOB_SOURCE_RESPONSE_STATUS_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(loaded.rawSha256) || loaded.rawBytes < 0) {
    throw new Error("JOB_SOURCE_RAW_METADATA_INVALID");
  }

  const orderedJobs = [...loaded.snapshot.jobs].sort(stableJobOrder);
  const externalIds = new Set<string>();
  const jobs = orderedJobs.map((job) => {
    if (job.observedAt !== loaded.observedAt) {
      throw new Error("JOB_SOURCE_OBSERVED_AT_MISMATCH");
    }
    if (externalIds.has(job.externalJobId)) {
      throw new Error("JOB_SOURCE_DUPLICATE_EXTERNAL_JOB_ID");
    }
    externalIds.add(job.externalJobId);
    return serializeJob(claim, job);
  });

  return {
    schema_version: JOB_SOURCE_SNAPSHOT_SCHEMA_VERSION,
    complete: true,
    observed_at: loaded.observedAt,
    jobs,
    issues: [],
  };
}

/** Stable bytes make replay and contract fixtures independent of object order. */
export function canonicalizeSourceSnapshot(snapshot: SerializedSourceSnapshot): string {
  return canonicalizeJson(snapshot);
}
