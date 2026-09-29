import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { createNativeJobApiFetchPort } from "../ingestion/fetch-port.ts";
import type { JobSourceClaim } from "../ingestion/source-snapshot.ts";
import {
  CATALOG_FETCH_TIMEOUT_MILLISECONDS,
  CATALOG_LEASE_SECONDS,
  JobSourceCommitRejectedError,
  runJobSourcePollOnce,
  type JobSourcePollDatabasePort,
  type JobSourcePollFailureInput,
  type JobSourcePollResult,
  type JobSourceSnapshotCommitInput,
} from "./job-source-poll.ts";

type RpcError = Readonly<{ code?: string; message?: string }>;

type RpcResult = Readonly<{
  data: unknown;
  error: RpcError | null;
  /** HTTP status from supabase-js; 0 when no response arrived. */
  status?: number;
}>;

type RpcClient = Readonly<{
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}>;

type CatalogRpcName = "claim_due_job_source" | "commit_job_source_snapshot" | "fail_job_source_poll";

/**
 * One sanitized line per failed catalog RPC. It carries the Postgres SQLSTATE
 * and a truncated message, never request payloads, row data or credentials.
 */
export type JobSourceRpcDiagnostic = Readonly<{
  event: "job_source_rpc_failed";
  rpc: CatalogRpcName;
  outcome: "REJECTED" | "UNCERTAIN";
  error_code: string;
  sqlstate: string | null;
  http_status: number | null;
  message: string | null;
  source_id: string | null;
  ingestion_run_id: string | null;
  snapshot_jobs: number | null;
  raw_bytes: number | null;
  duration_ms: number;
}>;

export type JobSourceRpcDiagnosticLog = (event: JobSourceRpcDiagnostic) => void;

function writeDiagnostic(event: JobSourceRpcDiagnostic): void {
  console.error(JSON.stringify(event));
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/** Collapse, truncate and redact anything credential-shaped before logging. */
export function sanitizeRpcErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*){0,2}/g, "[redacted]")
    .replace(/\bsb_[a-z]+_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 200) : null;
}

/**
 * A SQLSTATE on an HTTP error response means Postgres raised inside the
 * request transaction, which PostgREST rolled back. A 413 was refused before
 * the database saw it. Everything else (no response, gateway errors, bodies
 * without a SQLSTATE) is uncertain: the write may or may not have committed.
 */
function definiteSqlstate(error: RpcError, status: number | undefined): string | null {
  const code = typeof error.code === "string" ? error.code.trim() : "";
  if (!SQLSTATE_PATTERN.test(code)) return null;
  return typeof status === "number" && status >= 400 ? code : null;
}

type CommitErrorClassification =
  | Readonly<{ kind: "RECORDABLE"; code: string; retryable: boolean }>
  | Readonly<{ kind: "UNRECORDABLE"; code: string }>
  | Readonly<{ kind: "UNCERTAIN"; code: "JOB_SOURCE_SNAPSHOT_COMMIT_UNCERTAIN" }>;

export function classifyCommitRpcError(
  error: RpcError,
  status: number | undefined,
): CommitErrorClassification {
  if (status === 413) {
    return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_PAYLOAD_TOO_LARGE", retryable: false };
  }
  const sqlstate = definiteSqlstate(error, status);
  if (!sqlstate) return { kind: "UNCERTAIN", code: "JOB_SOURCE_SNAPSHOT_COMMIT_UNCERTAIN" };
  const message = typeof error.message === "string" ? error.message.trim() : "";
  // Another worker owns the run now, or the caller lacks the service role.
  // Recording a failure would be refused for the same reason.
  if (message === "SOURCE_POLL_LEASE_INVALID") {
    return { kind: "UNRECORDABLE", code: "JOB_SOURCE_SNAPSHOT_COMMIT_LEASE_LOST" };
  }
  if (sqlstate === "42501") return { kind: "UNRECORDABLE", code: "JOB_SOURCE_SNAPSHOT_COMMIT_FORBIDDEN" };
  // The commit function's own validation codes describe this board's data.
  if (/^SOURCE_[A-Z0-9_]{1,80}$/u.test(message)) {
    return { kind: "RECORDABLE", code: `JOB_SOURCE_COMMIT_${message}`, retryable: false };
  }
  if (sqlstate === "57014") {
    return {
      kind: "RECORDABLE",
      code: /statement timeout/iu.test(message) ? "JOB_SOURCE_COMMIT_STATEMENT_TIMEOUT" : "JOB_SOURCE_COMMIT_QUERY_CANCELED",
      retryable: true,
    };
  }
  if (sqlstate === "55P03") return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_LOCK_TIMEOUT", retryable: true };
  if (sqlstate === "40001") return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_SERIALIZATION_FAILURE", retryable: true };
  if (sqlstate === "40P01") return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_DEADLOCK", retryable: true };
  if (sqlstate === "23505") return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_UNIQUE_VIOLATION", retryable: false };
  switch (sqlstate.slice(0, 2)) {
    case "22": return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_DATA_EXCEPTION", retryable: false };
    case "23": return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_INTEGRITY_VIOLATION", retryable: false };
    case "53": return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_INSUFFICIENT_RESOURCES", retryable: true };
    case "54": return { kind: "RECORDABLE", code: "JOB_SOURCE_COMMIT_PROGRAM_LIMIT_EXCEEDED", retryable: false };
    default: return { kind: "RECORDABLE", code: `JOB_SOURCE_COMMIT_SQLSTATE_${sqlstate}`, retryable: true };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
}

function requiredUuid(value: unknown, code: string): string {
  const text = requiredText(value, code);
  if (!UUID_PATTERN.test(text)) throw new Error(code);
  return text;
}

function optionalText(value: unknown, code: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(code);
  return value.trim() || null;
}

function sourceOptions(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JOB_SOURCE_CLAIM_OPTIONS_INVALID");
  }
  return value as Readonly<Record<string, unknown>>;
}

function provider(value: unknown): JobSourceClaim["provider"] {
  if (value === "GREENHOUSE" || value === "LEVER" || value === "ASHBY") return value;
  throw new Error("JOB_SOURCE_CLAIM_PROVIDER_INVALID");
}

function claimRow(data: unknown): JobSourceClaim | null {
  const rows = Array.isArray(data) ? data : data === null ? [] : [data];
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("JOB_SOURCE_CLAIM_CARDINALITY_INVALID");
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("JOB_SOURCE_CLAIM_INVALID");
  }
  const value = row as Record<string, unknown>;
  return {
    sourceId: requiredUuid(value.source_id, "JOB_SOURCE_CLAIM_SOURCE_ID_INVALID"),
    ingestionRunId: requiredUuid(
      value.ingestion_run_id,
      "JOB_SOURCE_CLAIM_RUN_ID_INVALID",
    ),
    provider: provider(value.provider),
    tenantKey: requiredText(value.tenant_key, "JOB_SOURCE_CLAIM_TENANT_KEY_INVALID"),
    adapterRelease: requiredText(
      value.adapter_release,
      "JOB_SOURCE_CLAIM_ADAPTER_RELEASE_INVALID",
    ),
    etag: optionalText(value.etag, "JOB_SOURCE_CLAIM_ETAG_INVALID"),
    sourceOptions: sourceOptions(value.source_options),
  };
}

function firstBoolean(value: unknown): boolean {
  if (Array.isArray(value)) return value[0] === true;
  return value === true;
}

type RpcCallContext = Readonly<{
  sourceId?: string;
  ingestionRunId?: string;
  snapshotJobs?: number | null;
  rawBytes?: number | null;
}>;

export function createSupabaseJobSourcePollDatabasePort(
  supabase: RpcClient,
  options: Readonly<{
    log?: JobSourceRpcDiagnosticLog;
    now?: () => number;
  }> = {},
): JobSourcePollDatabasePort {
  const log = options.log ?? writeDiagnostic;
  const now = options.now ?? Date.now;

  // Returns the response, or null after logging a transport failure.
  async function call(
    rpc: CatalogRpcName,
    args: Readonly<Record<string, unknown>>,
    uncertainCode: string,
    context: RpcCallContext,
  ): Promise<Readonly<{ response: RpcResult | null; startedAt: number }>> {
    const startedAt = now();
    try {
      return { response: await supabase.rpc(rpc, args), startedAt };
    } catch (error) {
      report(rpc, "UNCERTAIN", uncertainCode, null, null,
        error instanceof Error ? `${error.name}: ${error.message}` : null, context, startedAt);
      return { response: null, startedAt };
    }
  }

  function report(
    rpc: CatalogRpcName,
    outcome: JobSourceRpcDiagnostic["outcome"],
    errorCode: string,
    error: RpcError | null,
    status: number | undefined | null,
    message: string | null,
    context: RpcCallContext,
    startedAt: number,
  ): void {
    const sqlstate = error ? definiteSqlstate(error, status ?? undefined) : null;
    try {
      log({
        event: "job_source_rpc_failed",
        rpc,
        outcome,
        error_code: errorCode,
        sqlstate,
        http_status: typeof status === "number" ? status : null,
        message: sanitizeRpcErrorMessage(message ?? error?.message),
        source_id: context.sourceId ?? null,
        ingestion_run_id: context.ingestionRunId ?? null,
        snapshot_jobs: context.snapshotJobs ?? null,
        raw_bytes: context.rawBytes ?? null,
        duration_ms: Math.max(0, now() - startedAt),
      });
    } catch {
      // Diagnostics must never change the outcome of the operation.
    }
  }

  function simpleOutcome(error: RpcError, status: number | undefined): JobSourceRpcDiagnostic["outcome"] {
    return definiteSqlstate(error, status) ? "REJECTED" : "UNCERTAIN";
  }

  return {
    async claimDueSource(input) {
      const { response, startedAt } = await call("claim_due_job_source", {
        p_worker_id: input.workerId, p_lease_seconds: input.leaseSeconds,
      }, "JOB_SOURCE_CLAIM_FAILED", {});
      if (!response) throw new Error("JOB_SOURCE_CLAIM_FAILED");
      const { data, error } = response;
      if (error) {
        report("claim_due_job_source", simpleOutcome(error, response.status), "JOB_SOURCE_CLAIM_FAILED",
          error, response.status, null, {}, startedAt);
        throw new Error("JOB_SOURCE_CLAIM_FAILED");
      }
      return claimRow(data);
    },

    async commitSnapshot(input: JobSourceSnapshotCommitInput) {
      const context: RpcCallContext = {
        sourceId: input.sourceId,
        ingestionRunId: input.ingestionRunId,
        snapshotJobs: input.snapshot?.jobs.length ?? null,
        rawBytes: input.rawBytes,
      };
      const { response, startedAt } = await call("commit_job_source_snapshot", {
        p_worker_id: input.workerId,
        p_source_id: input.sourceId,
        p_ingestion_run_id: input.ingestionRunId,
        p_snapshot: input.snapshot,
        p_endpoint: input.endpoint,
        p_etag: input.etag,
        p_raw_sha256: input.rawSha256,
        p_raw_bytes: input.rawBytes,
        p_response_status: input.responseStatus,
      }, "JOB_SOURCE_SNAPSHOT_COMMIT_UNCERTAIN", context);
      if (!response) throw new Error("JOB_SOURCE_SNAPSHOT_COMMIT_UNCERTAIN");
      const { data, error } = response;
      if (error) {
        const classification = classifyCommitRpcError(error, response.status);
        report("commit_job_source_snapshot", classification.kind === "UNCERTAIN" ? "UNCERTAIN" : "REJECTED",
          classification.code, error, response.status, null, context, startedAt);
        if (classification.kind === "RECORDABLE") {
          throw new JobSourceCommitRejectedError(classification.code, classification.retryable);
        }
        throw new Error(classification.code);
      }
      return firstBoolean(data);
    },

    async failPoll(input: JobSourcePollFailureInput) {
      const context: RpcCallContext = { sourceId: input.sourceId, ingestionRunId: input.ingestionRunId };
      const { response, startedAt } = await call("fail_job_source_poll", {
        p_worker_id: input.workerId,
        p_source_id: input.sourceId,
        p_ingestion_run_id: input.ingestionRunId,
        p_error_code: input.errorCode,
        p_retryable: input.retryable,
        p_response_status: input.responseStatus,
        p_endpoint: input.endpoint,
      }, "JOB_SOURCE_FAILURE_COMMIT_FAILED", context);
      if (!response) throw new Error("JOB_SOURCE_FAILURE_COMMIT_FAILED");
      const { data, error } = response;
      if (error) {
        report("fail_job_source_poll", simpleOutcome(error, response.status), "JOB_SOURCE_FAILURE_COMMIT_FAILED",
          error, response.status, null, context, startedAt);
        throw new Error("JOB_SOURCE_FAILURE_COMMIT_FAILED");
      }
      return firstBoolean(data);
    },
  };
}

export async function runJobSourceWorkerOnce(): Promise<JobSourcePollResult> {
  const supabase = createSupabaseAdminClient("job-source-poller/0.1");
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 120);
  return runJobSourcePollOnce(
    createSupabaseJobSourcePollDatabasePort(supabase as unknown as RpcClient),
    createNativeJobApiFetchPort({
      userAgent: "RoleDawn-JobCatalog/0.1",
      timeoutMilliseconds: CATALOG_FETCH_TIMEOUT_MILLISECONDS,
    }),
    { workerId, leaseSeconds: CATALOG_LEASE_SECONDS },
  );
}
