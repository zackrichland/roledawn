import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../../lib/supabase/database.types.ts";
import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import {
  createSupabaseApplicationFillExecutionMaterializer,
  eraseApplicationFillExecutionPackage,
  type ApplicationFillExecutionMaterializer,
} from "./application-fill-materializer.ts";
import {
  createSupabaseApplicationFillDatabase,
  type ApplicationFillAuthorizationContext,
  type ApplicationFillOutboxMessage,
  type ApplicationFillRuntimeSupervisor,
  type NoSubmitFormDriver,
  type NoSubmitFormOutcome,
} from "./application-fill.ts";
import { decideOutboxFailureDisposition } from "./outbox-retry-policy.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,119}$/u;
const ERROR_CODE_EXTRACT_PATTERN = /[A-Z][A-Z0-9_]{2,119}/u;

export const APPLICATION_FILL_RESUME_TOPIC =
  "application.browser_fill_resume_requested";
export const APPLICATION_FILL_RESUME_RESULT_RELEASE =
  "application-fill-resume-result/1";

export type ApplicationFillResumeRequestedPayload = Readonly<{
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  computerSessionId: string;
  resumeAttemptId: string;
  authorityHash: string;
  disclosureManifestHash: string;
}>;

export type ApplicationFillResumeAttemptStatus =
  | "QUEUED"
  | "FILLED_TO_REVIEW"
  | "TAKEOVER"
  | "FAILED_SAFE";

export type ApplicationFillResumeContext = Readonly<{
  resumeAttemptId: string;
  resumeStatus: ApplicationFillResumeAttemptStatus;
  computerSessionId: string;
  authorization: ApplicationFillAuthorizationContext;
}>;

export type ApplicationFillResumeCompletion = Readonly<{
  resumeAttemptId: string;
  terminalStatus: Exclude<ApplicationFillResumeAttemptStatus, "QUEUED">;
  checkpointHash: string;
  redactedSummary: Json;
}>;

export interface ApplicationFillResumeDatabase {
  claim(workerId: string): Promise<readonly ApplicationFillOutboxMessage[]>;
  loadContext(resumeAttemptId: string): Promise<ApplicationFillResumeContext>;
  complete(
    input: ApplicationFillResumeCompletion,
    outboxId: string,
    workerId: string,
  ): Promise<void>;
  releaseFailure(input: Readonly<{
    workerId: string;
    outboxId: string;
    attemptCount: number;
    errorCode: string;
  }>): Promise<boolean>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  return asRecord(value[0]);
}

function firstBoolean(value: unknown): boolean {
  if (Array.isArray(value)) return value[0] === true;
  return value === true;
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function safeErrorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return ERROR_CODE_PATTERN.test(message) ? message : fallback;
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new Error(`${label}_INVALID`);
  }
}

function normalizeOutcome(outcome: NoSubmitFormOutcome): NoSubmitFormOutcome {
  if (outcome.kind !== "FILLED_TO_REVIEW" && !ERROR_CODE_PATTERN.test(outcome.reasonCode)) {
    throw new Error("APPLICATION_FILL_RESUME_OUTCOME_CODE_INVALID");
  }
  assertCount(outcome.filledFieldCount, "APPLICATION_FILL_RESUME_FIELD_COUNT");
  assertCount(outcome.uploadedArtifactCount, "APPLICATION_FILL_RESUME_ARTIFACT_COUNT");
  assertCount(outcome.blockedFieldCount, "APPLICATION_FILL_RESUME_BLOCKED_COUNT");
  if (
    (outcome.kind === "FILLED_TO_REVIEW" && !SHA256_PATTERN.test(outcome.readbackHash)) ||
    (outcome.kind !== "FILLED_TO_REVIEW" && outcome.readbackHash !== null &&
      !SHA256_PATTERN.test(outcome.readbackHash))
  ) throw new Error("APPLICATION_FILL_RESUME_READBACK_HASH_INVALID");
  return outcome;
}

function failedSafeOutcome(error: unknown): NoSubmitFormOutcome {
  return Object.freeze({
    kind: "FAILED_SAFE" as const,
    reasonCode: safeErrorCode(error, "APPLICATION_FILL_RESUME_RUNTIME_FAILED"),
    readbackHash: null,
    filledFieldCount: 0,
    uploadedArtifactCount: 0,
    blockedFieldCount: 0,
  });
}

function buildCompletion(
  resumeAttemptId: string,
  outcome: NoSubmitFormOutcome,
  driverRelease: string,
): ApplicationFillResumeCompletion {
  const normalized = normalizeOutcome(outcome);
  const terminalStatus = normalized.kind;
  const redactedSummary = Object.freeze({
    schema_release: APPLICATION_FILL_RESUME_RESULT_RELEASE,
    resume_attempt_id: resumeAttemptId,
    terminal_status: terminalStatus,
    reason_code: terminalStatus === "FILLED_TO_REVIEW" ? null : normalized.reasonCode,
    readback_hash: normalized.readbackHash,
    filled_field_count: normalized.filledFieldCount,
    uploaded_artifact_count: normalized.uploadedArtifactCount,
    blocked_field_count: normalized.blockedFieldCount,
    authority_scope: "FILL_ONLY_NO_SUBMIT",
    submission_request_count: 0,
    application_submitted: false,
    driver_release: driverRelease,
  }) satisfies Json;
  return Object.freeze({
    resumeAttemptId,
    terminalStatus,
    checkpointHash: createHash("sha256")
      .update(JSON.stringify(redactedSummary), "utf8")
      .digest("hex"),
    redactedSummary,
  });
}

export function parseApplicationFillResumeRequestedPayload(
  value: Json,
): ApplicationFillResumeRequestedPayload | null {
  if (!isJsonObject(value) || value.authority_scope !== "FILL_ONLY_NO_SUBMIT") {
    return null;
  }
  const applicationId = value.application_id;
  const revisionId = value.revision_id;
  const fillAttemptId = value.fill_attempt_id;
  const computerSessionId = value.computer_session_id;
  const resumeAttemptId = value.resume_attempt_id;
  const authorityHash = value.authority_hash;
  const disclosureManifestHash = value.disclosure_manifest_hash;
  if (
    typeof applicationId !== "string" || !UUID_PATTERN.test(applicationId) ||
    typeof revisionId !== "string" || !UUID_PATTERN.test(revisionId) ||
    typeof fillAttemptId !== "string" || !UUID_PATTERN.test(fillAttemptId) ||
    typeof computerSessionId !== "string" || !UUID_PATTERN.test(computerSessionId) ||
    typeof resumeAttemptId !== "string" || !UUID_PATTERN.test(resumeAttemptId) ||
    typeof authorityHash !== "string" || !SHA256_PATTERN.test(authorityHash) ||
    typeof disclosureManifestHash !== "string" || !SHA256_PATTERN.test(disclosureManifestHash)
  ) return null;
  return Object.freeze({
    applicationId,
    revisionId,
    fillAttemptId,
    computerSessionId,
    resumeAttemptId,
    authorityHash,
    disclosureManifestHash,
  });
}

function assertContext(
  context: ApplicationFillResumeContext,
  payload: ApplicationFillResumeRequestedPayload,
): void {
  const authorization = context.authorization;
  if (
    context.resumeAttemptId !== payload.resumeAttemptId ||
    context.resumeStatus !== "QUEUED" ||
    context.computerSessionId !== payload.computerSessionId ||
    authorization.status !== "TAKEOVER" ||
    authorization.applicationId !== payload.applicationId ||
    authorization.revisionId !== payload.revisionId ||
    authorization.fillAttemptId !== payload.fillAttemptId ||
    authorization.authorityHash !== payload.authorityHash ||
    authorization.disclosureManifestHash !== payload.disclosureManifestHash
  ) throw new Error("APPLICATION_FILL_RESUME_BINDING_MISMATCH");
}

export async function coordinateApplicationFillResume(
  database: ApplicationFillResumeDatabase,
  supervisor: ApplicationFillRuntimeSupervisor,
  formDriver: NoSubmitFormDriver,
  materializer: ApplicationFillExecutionMaterializer,
  message: ApplicationFillOutboxMessage,
  workerId: string,
): Promise<Readonly<{
  resumeAttemptId: string;
  terminalStatus: Exclude<ApplicationFillResumeAttemptStatus, "QUEUED">;
}>> {
  if (message.topic !== APPLICATION_FILL_RESUME_TOPIC) {
    throw new Error("APPLICATION_FILL_RESUME_TOPIC_UNSUPPORTED");
  }
  const payload = parseApplicationFillResumeRequestedPayload(message.payload);
  if (!payload) throw new Error("APPLICATION_FILL_RESUME_OUTBOX_PAYLOAD_INVALID");
  const context = await database.loadContext(payload.resumeAttemptId);
  assertContext(context, payload);

  const authorization = context.authorization;
  const binding = Object.freeze({
    workspaceId: authorization.workspaceId,
    candidateId: authorization.candidateId,
    applicationId: authorization.applicationId,
    revisionId: authorization.revisionId,
    fillAttemptId: authorization.fillAttemptId,
    computerSessionId: context.computerSessionId,
  });
  let executionPackage: Awaited<ReturnType<ApplicationFillExecutionMaterializer["materialize"]>> | null = null;
  let outcome: NoSubmitFormOutcome;
  try {
    try {
      executionPackage = await materializer.materialize({
        context: authorization,
        binding,
      });
      outcome = await supervisor.resume({
        computerSessionId: context.computerSessionId,
        fillAttemptId: authorization.fillAttemptId,
        run: (runtime) => formDriver.fillToPreSubmitReview({
          runtimeHandle: runtime.handle,
          binding,
          startUrl: authorization.destinationUrl,
          executionPackage: executionPackage!,
          submitAuthorized: false,
        }),
      });
      outcome = normalizeOutcome(outcome);
    } catch (error) {
      outcome = failedSafeOutcome(error);
    }
    const completion = buildCompletion(
      context.resumeAttemptId,
      outcome,
      formDriver.driverRelease,
    );
    await database.complete(completion, message.outboxId, workerId);
    return Object.freeze({
      resumeAttemptId: completion.resumeAttemptId,
      terminalStatus: completion.terminalStatus,
    });
  } finally {
    if (executionPackage) eraseApplicationFillExecutionPackage(executionPackage);
  }
}

type RpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}>;

function asRpcClient(client: unknown): RpcClient {
  return client as RpcClient;
}

export function createSupabaseApplicationFillResumeDatabase(
  supabase: SupabaseClient<Database>,
): ApplicationFillResumeDatabase {
  const fillDatabase = createSupabaseApplicationFillDatabase(supabase);
  const database: ApplicationFillResumeDatabase = {
    async claim(workerId: string) {
      const response = await supabase.rpc("claim_outbox_batch", {
        p_worker_id: workerId,
        p_limit: 1,
        p_lease_seconds: 300,
        p_topics: [APPLICATION_FILL_RESUME_TOPIC],
      });
      if (response.error) throw new Error("APPLICATION_FILL_RESUME_CLAIM_FAILED");
      return (response.data ?? []).map((message) => Object.freeze({
        outboxId: message.outbox_id,
        topic: message.topic,
        payload: message.payload,
        attemptCount: message.attempt_count,
      }));
    },
    async loadContext(resumeAttemptId: string) {
      const response = await supabase
        .from("application_fill_resume_attempts")
        .select("id, status, fill_attempt_id, computer_session_id")
        .eq("id", resumeAttemptId)
        .maybeSingle();
      if (response.error || !response.data) {
        throw new Error("APPLICATION_FILL_RESUME_CONTEXT_LOAD_FAILED");
      }
      const row = response.data;
      if (
        !UUID_PATTERN.test(row.id) ||
        !UUID_PATTERN.test(row.fill_attempt_id) ||
        !UUID_PATTERN.test(row.computer_session_id) ||
        !["QUEUED", "FILLED_TO_REVIEW", "TAKEOVER", "FAILED_SAFE"].includes(row.status)
      ) throw new Error("APPLICATION_FILL_RESUME_CONTEXT_PROTOCOL_INVALID");
      const authorization = await fillDatabase.loadAuthorizationContext(
        row.fill_attempt_id,
      );
      return Object.freeze({
        resumeAttemptId: row.id,
        resumeStatus: row.status as ApplicationFillResumeAttemptStatus,
        computerSessionId: row.computer_session_id,
        authorization,
      });
    },
    async complete(
      input: ApplicationFillResumeCompletion,
      outboxId: string,
      workerId: string,
    ) {
      const response = await asRpcClient(supabase).rpc(
        "complete_application_fill_resume",
        {
          p_outbox_id: outboxId,
          p_worker_id: workerId,
          p_resume_attempt_id: input.resumeAttemptId,
          p_terminal_status: input.terminalStatus,
          p_checkpoint_hash: input.checkpointHash,
          p_redacted_summary: input.redactedSummary,
        },
      );
      if (response.error || !firstRow(response.data)) {
        throw new Error(
          response.error?.message?.match(ERROR_CODE_EXTRACT_PATTERN)?.[0] ??
          "APPLICATION_FILL_RESUME_COMPLETION_FAILED",
        );
      }
    },
    async releaseFailure(input: Readonly<{
      workerId: string;
      outboxId: string;
      attemptCount: number;
      errorCode: string;
    }>) {
      const disposition = decideOutboxFailureDisposition(
        input.attemptCount,
        input.errorCode,
      );
      const response = disposition.action === "DEAD_LETTER"
        ? await supabase.rpc("dead_letter_outbox_message", {
            p_worker_id: input.workerId,
            p_outbox_id: input.outboxId,
            p_error_code: disposition.errorCode,
          })
        : await supabase.rpc("fail_outbox_message", {
            p_worker_id: input.workerId,
            p_outbox_id: input.outboxId,
            p_error_code: disposition.errorCode,
            p_retry_after_seconds: disposition.retryAfterSeconds,
          });
      if (response.error) throw new Error("APPLICATION_FILL_RESUME_FAILURE_RELEASE_FAILED");
      return firstBoolean(response.data);
    },
  };
  return Object.freeze(database);
}

export async function runApplicationFillResumeWorkerOnce(input: Readonly<{
  formDriver: NoSubmitFormDriver;
  runtimeSupervisor: ApplicationFillRuntimeSupervisor;
  database?: ApplicationFillResumeDatabase;
  materializer?: ApplicationFillExecutionMaterializer;
}>): Promise<Readonly<{ claimed: number; completed: number; failed: number }>> {
  let database = input.database;
  let materializer = input.materializer;
  if (!database || !materializer) {
    const supabase = createSupabaseAdminClient("application-fill-resume-worker/0.1");
    database ??= createSupabaseApplicationFillResumeDatabase(supabase);
    materializer ??= createSupabaseApplicationFillExecutionMaterializer(supabase);
  }
  const workerId = `${hostname()}:${process.pid}:fill-resume:${randomUUID()}`.slice(0, 120);
  const messages = await database.claim(workerId);
  let completed = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      await coordinateApplicationFillResume(
        database,
        input.runtimeSupervisor,
        input.formDriver,
        materializer,
        message,
        workerId,
      );
      completed += 1;
    } catch (error) {
      const released = await database.releaseFailure({
        workerId,
        outboxId: message.outboxId,
        attemptCount: message.attemptCount,
        errorCode: safeErrorCode(error, "APPLICATION_FILL_RESUME_WORKER_FAILED"),
      });
      if (!released) throw new Error("APPLICATION_FILL_RESUME_RECOVERY_REQUIRED", { cause: error });
      failed += 1;
    }
  }
  return Object.freeze({ claimed: messages.length, completed, failed });
}
