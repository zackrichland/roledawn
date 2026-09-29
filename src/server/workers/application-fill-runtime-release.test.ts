import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../lib/supabase/database.types.ts";
import { createSupabaseApplicationFillRuntimeReleaseDatabase } from "./application-fill.ts";

const IDS = Object.freeze({
  application: "10000000-0000-4000-8000-000000000001",
  fillAttempt: "50000000-0000-4000-8000-000000000005",
  computerSession: "80000000-0000-4000-8000-000000000008",
});

type RpcCall = Readonly<{ name: string; args: Record<string, unknown> }>;

function fakeClient(
  handler: (call: RpcCall) => Promise<Readonly<{
    data: unknown;
    error: { message?: string } | null;
  }>>,
): SupabaseClient<Database> {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      return handler({ name, args });
    },
  } as unknown as SupabaseClient<Database>;
}

test("reconciles measured zero-submit release telemetry and preserves review", async () => {
  const calls: RpcCall[] = [];
  const database = createSupabaseApplicationFillRuntimeReleaseDatabase(
    fakeClient(async (call) => {
      calls.push(call);
      return {
        data: [{
          application_id: IDS.application,
          application_status: "PRE_SUBMIT_REVIEW",
          computer_session_state: "DESTROYED",
          replayed: false,
        }],
        error: null,
      };
    }),
  );

  const result = await database.reconcileRuntimeRelease({
    computerSessionId: IDS.computerSession,
    fillAttemptId: IDS.fillAttempt,
    reason: "TTL_EXPIRED",
    outcome: "RELEASED",
    usage: {
      wallClockMs: 9_000,
      providerBilledMs: 10_000,
      uploadedByteCount: 512,
      blockedSubmissionAttemptCount: 1,
      outboundSubmissionRequestCount: 0,
    },
    errorCode: null,
    supervisorRelease: "application-fill-runtime-supervisor/1",
  });

  assert.deepEqual(result, {
    applicationId: IDS.application,
    applicationStatus: "PRE_SUBMIT_REVIEW",
    computerSessionState: "DESTROYED",
    replayed: false,
  });
  assert.equal(calls[0]?.name, "reconcile_application_fill_runtime_release");
  assert.deepEqual(calls[0]?.args.p_usage_summary, {
    schema_release: "computer-runtime-release-usage/1",
    runtime_destroyed: true,
    telemetry_available: true,
    wall_clock_ms: 9_000,
    provider_billed_ms: 10_000,
    uploaded_byte_count: 512,
    blocked_submission_attempt_count: 1,
    submission_request_count: 0,
    application_submitted: false,
  });
  assert.equal(JSON.stringify(calls).includes("provider-session"), false);
});

test("records uncertain teardown without manufacturing zero-submit telemetry", async () => {
  const calls: RpcCall[] = [];
  const database = createSupabaseApplicationFillRuntimeReleaseDatabase(
    fakeClient(async (call) => {
      calls.push(call);
      return {
        data: [{
          application_id: IDS.application,
          application_status: "TAKEOVER",
          computer_session_state: "FAILED_SAFE",
          replayed: true,
        }],
        error: null,
      };
    }),
  );

  const result = await database.reconcileRuntimeRelease({
    computerSessionId: IDS.computerSession,
    fillAttemptId: IDS.fillAttempt,
    reason: "WORKER_STOPPED",
    outcome: "RELEASE_UNCERTAIN",
    usage: null,
    errorCode: "APPLICATION_FILL_RUNTIME_RELEASE_FAILED",
    supervisorRelease: "application-fill-runtime-supervisor/1",
  });

  assert.equal(result.applicationStatus, "TAKEOVER");
  assert.equal(result.computerSessionState, "FAILED_SAFE");
  assert.deepEqual(calls[0]?.args.p_usage_summary, {});
  assert.equal(
    JSON.stringify(calls[0]?.args).includes('"application_submitted":false'),
    false,
  );
});

test("refuses non-zero outbound submission telemetry before the RPC", async () => {
  let called = false;
  const database = createSupabaseApplicationFillRuntimeReleaseDatabase(
    fakeClient(async () => {
      called = true;
      return { data: [], error: null };
    }),
  );

  await assert.rejects(
    database.reconcileRuntimeRelease({
      computerSessionId: IDS.computerSession,
      fillAttemptId: IDS.fillAttempt,
      reason: "TTL_EXPIRED",
      outcome: "RELEASED",
      usage: {
        wallClockMs: 1,
        providerBilledMs: 1,
        uploadedByteCount: 1,
        blockedSubmissionAttemptCount: 0,
        outboundSubmissionRequestCount: 1,
      },
      errorCode: null,
      supervisorRelease: "application-fill-runtime-supervisor/1",
    }),
    /APPLICATION_FILL_SUBMISSION_STATE_UNCERTAIN/u,
  );
  assert.equal(called, false);
});

test("refuses an unpromoted supervisor release before the RPC", async () => {
  let called = false;
  const database = createSupabaseApplicationFillRuntimeReleaseDatabase(
    fakeClient(async () => {
      called = true;
      return { data: [], error: null };
    }),
  );

  await assert.rejects(
    database.reconcileRuntimeRelease({
      computerSessionId: IDS.computerSession,
      fillAttemptId: IDS.fillAttempt,
      reason: "TTL_EXPIRED",
      outcome: "RELEASE_UNCERTAIN",
      usage: null,
      errorCode: "APPLICATION_FILL_RUNTIME_RELEASE_FAILED",
      supervisorRelease: "application-fill-runtime-supervisor/next",
    }),
    /APPLICATION_FILL_RUNTIME_SUPERVISOR_RELEASE_INVALID/u,
  );
  assert.equal(called, false);
});
