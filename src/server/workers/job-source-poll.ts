import type {
  RegisteredJobSource,
  SourceFetchPort,
  SourceLoadResult,
} from "../ingestion/contracts.ts";
import { loadRegisteredJobSource } from "../ingestion/load-source.ts";
import {
  serializeSourceSnapshot,
  type JobSourceClaim,
  type SerializedSourceSnapshot,
} from "../ingestion/source-snapshot.ts";

/**
 * Scheduled polling reads complete full-content boards, so it gets larger
 * budgets than pasted-link resolution (12 s, 20 MiB). Measured 2026-09-28: the
 * largest reviewed board (carvana, 1,813 jobs) returned 19.4 MB, 93% of the
 * old cap, and a cold Greenhouse `content=true` board took 11.6 s to first byte.
 * The commit RPC's database bound (64 MiB) stays above this cap.
 */
export const CATALOG_MAX_SOURCE_RESPONSE_BYTES = 40 * 1024 * 1024;
export const CATALOG_FETCH_TIMEOUT_MILLISECONDS = 45_000;
/**
 * Covers the fetch deadline, parsing, the snapshot upload and the commit's
 * 60 s database budget. A claim that finds an expired lease backs it off.
 */
export const CATALOG_LEASE_SECONDS = 300;

/**
 * The database definitely refused the commit and rolled it back (PostgREST
 * returned a SQLSTATE), so this worker still owns the run and must finish it
 * as a failure. Any other error after the request was sent stays uncertain.
 */
export class JobSourceCommitRejectedError extends Error {
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "JobSourceCommitRejectedError";
    this.retryable = retryable;
  }
}

export type JobSourceSnapshotCommitInput = Readonly<{
  workerId: string;
  sourceId: string;
  ingestionRunId: string;
  snapshot: SerializedSourceSnapshot | null;
  endpoint: string;
  responseStatus: number;
  observedAt: string;
  etag: string | null;
  rawSha256: string | null;
  rawBytes: number;
}>;

export type JobSourcePollFailureInput = Readonly<{
  workerId: string;
  sourceId: string;
  ingestionRunId: string;
  errorCode: string;
  retryable: boolean;
  responseStatus: number | null;
  endpoint: string | null;
}>;

export interface JobSourcePollDatabasePort {
  claimDueSource(input: Readonly<{
    workerId: string;
    leaseSeconds: number;
  }>): Promise<JobSourceClaim | null>;
  commitSnapshot(input: JobSourceSnapshotCommitInput): Promise<boolean>;
  failPoll(input: JobSourcePollFailureInput): Promise<boolean>;
}

export type JobSourcePollResult =
  | Readonly<{
      kind: "IDLE";
      claimed: 0;
      completed: 0;
      failed: 0;
    }>
  | Readonly<{
      kind: "COMPLETED";
      claimed: 1;
      completed: 1;
      failed: 0;
      sourceId: string;
      ingestionRunId: string;
      outcome: "LOADED" | "NOT_MODIFIED";
      observedCount: number;
    }>
  | Readonly<{
      kind: "FAILED";
      claimed: 1;
      completed: 0;
      failed: 1;
      sourceId: string;
      ingestionRunId: string;
      errorCode: string;
      retryable: boolean;
    }>;

function optionalBoolean(
  options: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = options[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("JOB_SOURCE_CONFIGURATION_INVALID");
  return value;
}

function registeredSourceFromClaim(claim: JobSourceClaim): RegisteredJobSource {
  switch (claim.provider) {
    case "GREENHOUSE":
      return {
        sourceId: claim.sourceId,
        provider: claim.provider,
        tenantKey: claim.tenantKey,
        includeContent: optionalBoolean(claim.sourceOptions, "include_content", true),
      };
    case "LEVER": {
      const region = claim.sourceOptions.region;
      if (region !== undefined && region !== "GLOBAL" && region !== "EU") {
        throw new Error("JOB_SOURCE_CONFIGURATION_INVALID");
      }
      return {
        sourceId: claim.sourceId,
        provider: claim.provider,
        tenantKey: claim.tenantKey,
        ...(region ? { region } : {}),
      };
    }
    case "ASHBY":
      return {
        sourceId: claim.sourceId,
        provider: claim.provider,
        tenantKey: claim.tenantKey,
        includeCompensation: optionalBoolean(
          claim.sourceOptions,
          "include_compensation",
          true,
        ),
      };
  }
}

function failureFromLoadResult(
  result: Extract<SourceLoadResult, { kind: "FAILED" }>,
): Omit<JobSourcePollFailureInput, "workerId" | "sourceId" | "ingestionRunId"> {
  return {
    errorCode: `JOB_SOURCE_${result.code}`,
    retryable: result.retryable,
    responseStatus: result.status,
    endpoint: result.endpoint,
  };
}

async function recordFailure(
  database: JobSourcePollDatabasePort,
  claim: JobSourceClaim,
  workerId: string,
  failure: Omit<JobSourcePollFailureInput, "workerId" | "sourceId" | "ingestionRunId">,
): Promise<JobSourcePollResult> {
  const accepted = await database.failPoll({
    workerId,
    sourceId: claim.sourceId,
    ingestionRunId: claim.ingestionRunId,
    ...failure,
  });
  if (!accepted) throw new Error("JOB_SOURCE_FAILURE_COMMIT_REJECTED");
  return {
    kind: "FAILED",
    claimed: 1,
    completed: 0,
    failed: 1,
    sourceId: claim.sourceId,
    ingestionRunId: claim.ingestionRunId,
    errorCode: failure.errorCode,
    retryable: failure.retryable,
  };
}

export async function runJobSourcePollOnce(
  database: JobSourcePollDatabasePort,
  fetchPort: SourceFetchPort,
  options: Readonly<{
    workerId: string;
    leaseSeconds?: number;
    maxResponseBytes?: number;
    maxRecords?: number;
  }>,
): Promise<JobSourcePollResult> {
  const leaseSeconds = options.leaseSeconds ?? CATALOG_LEASE_SECONDS;
  if (!options.workerId.trim() || options.workerId.length > 120) {
    throw new Error("JOB_SOURCE_WORKER_ID_INVALID");
  }
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    throw new Error("JOB_SOURCE_LEASE_SECONDS_INVALID");
  }

  const claim = await database.claimDueSource({
    workerId: options.workerId,
    leaseSeconds,
  });
  if (!claim) return { kind: "IDLE", claimed: 0, completed: 0, failed: 0 };

  let source: RegisteredJobSource;
  try {
    source = registeredSourceFromClaim(claim);
  } catch {
    return recordFailure(database, claim, options.workerId, {
      errorCode: "JOB_SOURCE_CONFIGURATION_INVALID",
      retryable: false,
      responseStatus: null,
      endpoint: null,
    });
  }

  let loaded: SourceLoadResult;
  try {
    loaded = await loadRegisteredJobSource(source, fetchPort, {
      ...(claim.etag ? { ifNoneMatch: claim.etag } : {}),
      maxResponseBytes: options.maxResponseBytes ?? CATALOG_MAX_SOURCE_RESPONSE_BYTES,
      ...(options.maxRecords === undefined ? {} : { maxRecords: options.maxRecords }),
    });
  } catch {
    return recordFailure(database, claim, options.workerId, {
      errorCode: "JOB_SOURCE_LOAD_UNEXPECTED",
      retryable: true,
      responseStatus: null,
      endpoint: null,
    });
  }

  if (loaded.kind === "FAILED") {
    return recordFailure(
      database,
      claim,
      options.workerId,
      failureFromLoadResult(loaded),
    );
  }

  if (loaded.kind === "LOADED" && loaded.responseStatus !== 200) {
    return recordFailure(database, claim, options.workerId, {
      errorCode: "JOB_SOURCE_RESPONSE_NOT_AUTHORITATIVE",
      retryable: true,
      responseStatus: loaded.responseStatus,
      endpoint: loaded.endpoint,
    });
  }

  if (loaded.kind === "LOADED" && (!loaded.snapshot.complete || loaded.snapshot.issues.length > 0)) {
    return recordFailure(database, claim, options.workerId, {
      errorCode: "JOB_SOURCE_SNAPSHOT_INCOMPLETE",
      retryable: false,
      responseStatus: loaded.responseStatus,
      endpoint: loaded.endpoint,
    });
  }

  let snapshot: SerializedSourceSnapshot | null = null;
  if (loaded.kind === "LOADED") {
    try {
      snapshot = serializeSourceSnapshot(claim, loaded);
    } catch {
      return recordFailure(database, claim, options.workerId, {
        errorCode: "JOB_SOURCE_SNAPSHOT_INVALID",
        retryable: false,
        responseStatus: loaded.responseStatus,
        endpoint: loaded.endpoint,
      });
    }
  }

  const commit: JobSourceSnapshotCommitInput = loaded.kind === "LOADED"
    ? {
        workerId: options.workerId,
        sourceId: claim.sourceId,
        ingestionRunId: claim.ingestionRunId,
        snapshot,
        endpoint: loaded.endpoint,
        responseStatus: loaded.responseStatus,
        observedAt: loaded.observedAt,
        etag: loaded.etag,
        rawSha256: loaded.rawSha256,
        rawBytes: loaded.rawBytes,
      }
    : {
        workerId: options.workerId,
        sourceId: claim.sourceId,
        ingestionRunId: claim.ingestionRunId,
        snapshot: null,
        endpoint: loaded.endpoint,
        responseStatus: loaded.responseStatus,
        observedAt: loaded.observedAt,
        etag: loaded.etag,
        rawSha256: null,
        rawBytes: 0,
      };

  // A transport error after this call is an uncertain commit, not a failed
  // source poll. The lease/run must be reconciled rather than overwritten.
  // Only a definite database rejection (rolled back, lease still held) is
  // recorded here, so the source backs off instead of being retried hot.
  let accepted: boolean;
  try {
    accepted = await database.commitSnapshot(commit);
  } catch (error) {
    if (!(error instanceof JobSourceCommitRejectedError)) throw error;
    return recordFailure(database, claim, options.workerId, {
      errorCode: error.message,
      retryable: error.retryable,
      responseStatus: commit.responseStatus,
      endpoint: commit.endpoint,
    });
  }
  if (!accepted) throw new Error("JOB_SOURCE_SNAPSHOT_COMMIT_REJECTED");

  return {
    kind: "COMPLETED",
    claimed: 1,
    completed: 1,
    failed: 0,
    sourceId: claim.sourceId,
    ingestionRunId: claim.ingestionRunId,
    outcome: loaded.kind,
    observedCount: snapshot?.jobs.length ?? 0,
  };
}
