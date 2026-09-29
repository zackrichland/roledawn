import assert from "node:assert/strict";
import test from "node:test";

import { JobSourceCommitRejectedError, type JobSourceSnapshotCommitInput } from "./job-source-poll.ts";
import {
  createSupabaseJobSourcePollDatabasePort,
  sanitizeRpcErrorMessage,
  type JobSourceRpcDiagnostic,
} from "./job-source-worker.ts";

test("Supabase source-poll port matches the service-only RPC contracts", async () => {
  const calls: Array<Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>> = [];
  const client = {
    async rpc(name: string, args: Readonly<Record<string, unknown>>) {
      calls.push({ name, args });
      if (name === "claim_due_job_source") {
        return {
          data: [{
            source_id: "10000000-0000-4000-a000-000000000001",
            ingestion_run_id: "20000000-0000-4000-a000-000000000002",
            provider: "GREENHOUSE",
            tenant_key: "example",
            adapter_release: "greenhouse/0.1",
            etag: 'W/"prior"',
            source_options: { include_content: true },
          }],
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  const port = createSupabaseJobSourcePollDatabasePort(client);

  const claim = await port.claimDueSource({ workerId: "worker-1", leaseSeconds: 120 });
  assert.ok(claim);
  assert.equal(claim.provider, "GREENHOUSE");
  assert.deepEqual(calls[0], {
    name: "claim_due_job_source",
    args: { p_worker_id: "worker-1", p_lease_seconds: 120 },
  });

  const snapshot = {
    schema_version: 1 as const,
    complete: true as const,
    observed_at: "2026-08-16T20:00:00.000Z",
    jobs: [],
    issues: [] as const,
  };
  assert.equal(await port.commitSnapshot({
    workerId: "worker-1",
    sourceId: claim.sourceId,
    ingestionRunId: claim.ingestionRunId,
    snapshot,
    endpoint: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
    responseStatus: 200,
    observedAt: snapshot.observed_at,
    etag: 'W/"current"',
    rawSha256: "a".repeat(64),
    rawBytes: 100,
  }), true);
  assert.deepEqual(calls[1], {
    name: "commit_job_source_snapshot",
    args: {
      p_worker_id: "worker-1",
      p_source_id: claim.sourceId,
      p_ingestion_run_id: claim.ingestionRunId,
      p_snapshot: snapshot,
      p_endpoint: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
      p_etag: 'W/"current"',
      p_raw_sha256: "a".repeat(64),
      p_raw_bytes: 100,
      p_response_status: 200,
    },
  });

  assert.equal(await port.failPoll({
    workerId: "worker-1",
    sourceId: claim.sourceId,
    ingestionRunId: claim.ingestionRunId,
    errorCode: "JOB_SOURCE_HTTP_ERROR",
    retryable: true,
    responseStatus: 503,
    endpoint: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
  }), true);
  assert.deepEqual(calls[2], {
    name: "fail_job_source_poll",
    args: {
      p_worker_id: "worker-1",
      p_source_id: claim.sourceId,
      p_ingestion_run_id: claim.ingestionRunId,
      p_error_code: "JOB_SOURCE_HTTP_ERROR",
      p_retryable: true,
      p_response_status: 503,
      p_endpoint: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
    },
  });
});

test("Supabase source-poll port rejects malformed claim rows before network use", async () => {
  const port = createSupabaseJobSourcePollDatabasePort({
    async rpc() {
      return {
        data: [{
          source_id: "not-a-uuid",
          ingestion_run_id: "20000000-0000-4000-a000-000000000002",
          provider: "GREENHOUSE",
          tenant_key: "example",
          adapter_release: "greenhouse/0.1",
          etag: null,
          source_options: {},
        }],
        error: null,
      };
    },
  });
  await assert.rejects(
    port.claimDueSource({ workerId: "worker-1", leaseSeconds: 120 }),
    /JOB_SOURCE_CLAIM_SOURCE_ID_INVALID/,
  );
});

const commitInput: JobSourceSnapshotCommitInput = {
  workerId: "worker-1",
  sourceId: "10000000-0000-4000-a000-000000000001",
  ingestionRunId: "20000000-0000-4000-a000-000000000002",
  snapshot: {
    schema_version: 1,
    complete: true,
    observed_at: "2026-09-28T19:00:00.000Z",
    jobs: [],
    issues: [],
  },
  endpoint: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
  responseStatus: 200,
  observedAt: "2026-09-28T19:00:00.000Z",
  etag: null,
  rawSha256: "a".repeat(64),
  rawBytes: 19_438_348,
};

function commitPort(response: unknown) {
  const diagnostics: JobSourceRpcDiagnostic[] = [];
  const port = createSupabaseJobSourcePollDatabasePort({
    async rpc() {
      if (response instanceof Error) throw response;
      return response as never;
    },
  }, { log: (event) => diagnostics.push(event), now: () => 1_000 });
  return { port, diagnostics };
}

async function commitError(response: unknown): Promise<Readonly<{ error: Error; diagnostics: JobSourceRpcDiagnostic[] }>> {
  const { port, diagnostics } = commitPort(response);
  try {
    await port.commitSnapshot(commitInput);
  } catch (error) {
    assert.ok(error instanceof Error);
    return { error, diagnostics };
  }
  throw new Error("expected commit to fail");
}

test("a statement timeout is a definite, recordable, retryable rejection with a logged cause", async () => {
  const { error, diagnostics } = await commitError({
    data: null,
    status: 500,
    error: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  assert.ok(error instanceof JobSourceCommitRejectedError);
  assert.equal(error.message, "JOB_SOURCE_COMMIT_STATEMENT_TIMEOUT");
  assert.equal(error.retryable, true);
  assert.deepEqual(diagnostics, [{
    event: "job_source_rpc_failed",
    rpc: "commit_job_source_snapshot",
    outcome: "REJECTED",
    error_code: "JOB_SOURCE_COMMIT_STATEMENT_TIMEOUT",
    sqlstate: "57014",
    http_status: 500,
    message: "canceling statement due to statement timeout",
    source_id: commitInput.sourceId,
    ingestion_run_id: commitInput.ingestionRunId,
    snapshot_jobs: 0,
    raw_bytes: 19_438_348,
    duration_ms: 0,
  }]);
});

test("commit validation codes become non-retryable source failures", async () => {
  const { error } = await commitError({ data: null, status: 400, error: { code: "22023", message: "SOURCE_JOB_INVALID" } });
  assert.ok(error instanceof JobSourceCommitRejectedError);
  assert.equal(error.message, "JOB_SOURCE_COMMIT_SOURCE_JOB_INVALID");
  assert.equal(error.retryable, false);

  const unique = await commitError({ data: null, status: 409, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
  assert.equal(unique.error.message, "JOB_SOURCE_COMMIT_UNIQUE_VIOLATION");

  const tooLarge = await commitError({ data: null, status: 413, error: { message: "Payload Too Large" } });
  assert.ok(tooLarge.error instanceof JobSourceCommitRejectedError);
  assert.equal(tooLarge.error.message, "JOB_SOURCE_COMMIT_PAYLOAD_TOO_LARGE");
});

test("a lost lease or missing role is definite but never recorded as this worker's failure", async () => {
  const lease = await commitError({ data: null, status: 500, error: { code: "55000", message: "SOURCE_POLL_LEASE_INVALID" } });
  assert.equal(lease.error instanceof JobSourceCommitRejectedError, false);
  assert.equal(lease.error.message, "JOB_SOURCE_SNAPSHOT_COMMIT_LEASE_LOST");
  assert.equal(lease.diagnostics[0].outcome, "REJECTED");

  const role = await commitError({ data: null, status: 403, error: { code: "42501", message: "SERVICE_ROLE_REQUIRED" } });
  assert.equal(role.error instanceof JobSourceCommitRejectedError, false);
  assert.equal(role.error.message, "JOB_SOURCE_SNAPSHOT_COMMIT_FORBIDDEN");
});

test("transport and gateway failures stay uncertain even with SQLSTATE-shaped codes", async () => {
  for (const response of [
    { data: null, status: 0, error: { code: "", message: "TypeError: fetch failed" } },
    { data: null, status: 0, error: { code: "EPIPE", message: "write EPIPE" } },
    { data: null, status: 502, error: { message: "<html>502 Bad Gateway</html>" } },
    new TypeError("fetch failed"),
  ]) {
    const { error, diagnostics } = await commitError(response);
    assert.equal(error instanceof JobSourceCommitRejectedError, false);
    assert.equal(error.message, "JOB_SOURCE_SNAPSHOT_COMMIT_UNCERTAIN");
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].outcome, "UNCERTAIN");
    assert.equal(diagnostics[0].sqlstate, null);
  }
});

test("diagnostics are single-line, bounded, redacted and cannot change the outcome", async () => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(40)}.${"b".repeat(40)}`;
  const message = sanitizeRpcErrorMessage(`bad\nline\t${jwt} sb_secret_${"c".repeat(30)} ${"x".repeat(400)}`);
  assert.ok(message);
  assert.equal(/[\r\n\t]/.test(message), false);
  assert.equal(message.includes("eyJ"), false);
  assert.equal(message.includes("sb_secret_"), false);
  assert.equal(message.length <= 200, true);
  assert.equal(sanitizeRpcErrorMessage(undefined), null);

  const port = createSupabaseJobSourcePollDatabasePort({
    async rpc() {
      return { data: null, status: 500, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    },
  }, { log: () => { throw new Error("log sink down"); } });
  await assert.rejects(port.commitSnapshot(commitInput), /JOB_SOURCE_COMMIT_STATEMENT_TIMEOUT/);
});

test("claim failures keep their stable code and log the database cause", async () => {
  const diagnostics: JobSourceRpcDiagnostic[] = [];
  const port = createSupabaseJobSourcePollDatabasePort({
    async rpc() {
      return { data: null, status: 503, error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool." } };
    },
  }, { log: (event) => diagnostics.push(event) });
  await assert.rejects(port.claimDueSource({ workerId: "worker-1", leaseSeconds: 300 }), /^Error: JOB_SOURCE_CLAIM_FAILED$/);
  assert.equal(diagnostics[0].rpc, "claim_due_job_source");
  assert.equal(diagnostics[0].outcome, "UNCERTAIN");
  assert.equal(diagnostics[0].message, "Timed out acquiring connection from connection pool.");
});
