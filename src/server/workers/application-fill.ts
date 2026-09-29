import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ComputerSessionBinding } from "../../domain/computer-session-broker.ts";
import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import type { Database, Json } from "../../lib/supabase/database.types.ts";
import {
  createSupabaseApplicationFillExecutionMaterializer,
  eraseApplicationFillExecutionPackage,
  type ApplicationFillExecutionMaterializer,
  type ApplicationFillExecutionPackage,
  type MaterializedApplicationArtifact,
} from "./application-fill-materializer.ts";
import { decideOutboxFailureDisposition } from "./outbox-retry-policy.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,119}$/u;

export const APPLICATION_FILL_TOPIC = "application.browser_fill_requested";
export const APPLICATION_FILL_BROKER_RELEASE = "application-fill-coordinator/0.1";

export type ApplicationFillRequestedPayload = Readonly<{
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  browserRunId: string;
  authorityHash: string;
  disclosureManifestHash: string;
}>;

export type ApplicationFillOutboxMessage = Readonly<{
  outboxId: string;
  topic: string;
  payload: Json;
  attemptCount: number;
}>;

export type ApplicationFillAttemptStatus =
  | "QUEUED"
  | "STARTED"
  | "FILLED_TO_REVIEW"
  | "TAKEOVER"
  | "FAILED_SAFE"
  | "CANCELED";

export type ApplicationFillAuthorizationContext = Readonly<{
  workspaceId: string;
  candidateId: string;
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  browserRunId: string;
  status: ApplicationFillAttemptStatus;
  destinationUrl: string;
  authorityHash: string;
  disclosureManifestHash: string;
  artifactManifest: Json;
  disclosureManifest: Json;
}>;

export type FillExecutionPlan = Readonly<{
  executionMode: "EPHEMERAL_CLEAN" | "EPHEMERAL_WITH_PERSISTENT_CONTEXT";
  browserProfileRef: string | null;
  ttlSeconds: number;
}>;

export interface ApplicationFillExecutionPolicy {
  plan(context: ApplicationFillAuthorizationContext): FillExecutionPlan;
}

export const ephemeralCleanFillExecutionPolicy: ApplicationFillExecutionPolicy = Object.freeze({
  plan: () => Object.freeze({
    executionMode: "EPHEMERAL_CLEAN" as const,
    browserProfileRef: null,
    ttlSeconds: 15 * 60,
  }),
});

export type ReservedComputerSession = Readonly<{
  computerSessionId: string;
  applicationId: string;
  revisionId: string;
  replayed: boolean;
  executionPlan: FillExecutionPlan;
}>;

export type FillTerminalStatus = "FILLED_TO_REVIEW" | "TAKEOVER" | "FAILED_SAFE";

export type FillCompletionInput = Readonly<{
  fillAttemptId: string;
  terminalStatus: FillTerminalStatus;
  checkpointHash: string;
  redactedSummary: Json;
  runtimeDestroyed: boolean;
  usageSummary: Json;
}>;

export interface ApplicationFillDatabase {
  loadAuthorizationContext(fillAttemptId: string): Promise<ApplicationFillAuthorizationContext>;
  startAttempt(input: Readonly<{
    outboxId: string;
    workerId: string;
    fillAttemptId: string;
    executionPlan: FillExecutionPlan;
    allowedDomainPolicy: Json;
  }>): Promise<ReservedComputerSession>;
  activateSession(input: Readonly<{
    workerId: string;
    computerSessionId: string;
    providerAdapter: string;
    providerSessionRef: string;
    providerContextRef: string | null;
    adapterRelease: string;
  }>): Promise<void>;
  completeAttempt(input: FillCompletionInput, workerId: string): Promise<void>;
  claim(workerId: string): Promise<readonly ApplicationFillOutboxMessage[]>;
  releaseFailure(input: Readonly<{
    workerId: string;
    outboxId: string;
    attemptCount: number;
    errorCode: string;
  }>): Promise<boolean>;
}

export type ApplicationFillRecoveryMode =
  | "RESUME_IDEMPOTENT_PROVISION"
  | "FAIL_SAFE_SESSION_EXPIRED"
  | "FAIL_SAFE_DISCLOSURE_POSSIBLE"
  | "FAIL_SAFE_RECOVERY_BINDING_MISSING";

export type ApplicationFillRecoveryClaim = Readonly<{
  fillAttemptId: string;
  computerSessionId: string;
  recoveryMode: ApplicationFillRecoveryMode;
  message: ApplicationFillOutboxMessage | null;
}>;

export interface ApplicationFillRecoveryDatabase extends ApplicationFillDatabase {
  claimStale(workerId: string): Promise<readonly ApplicationFillRecoveryClaim[]>;
}

/**
 * Opaque provider state. The coordinator must never inspect, persist, or log it.
 * A concrete driver and runtime adapter may agree on its private shape.
 */
export type ComputerRuntimeHandle = unknown;

export type ComputerRuntimeProvisionRequest = Readonly<{
  /**
   * Immutable database session ID. Provision must be idempotent for this key:
   * a retry may recover the same runtime but must never create a second one.
   */
  idempotencyKey: string;
  binding: Readonly<ComputerSessionBinding & { computerSessionId: string }>;
  startUrl: string;
  allowedOrigins: readonly string[];
  ttlSeconds: number;
  executionMode: FillExecutionPlan["executionMode"];
  browserProfileRef: string | null;
  artifactManifest: Json;
  /** Verified service-worker bytes only. Never persist or log this field. */
  artifactPayloads: readonly MaterializedApplicationArtifact[];
  submissionGuard: Readonly<{
    submitAuthorized: false;
    outboundSubmissionRequests: "BLOCK";
  }>;
}>;

export type ProvisionedComputerRuntime = Readonly<{
  handle: ComputerRuntimeHandle;
  providerAdapter: string;
  providerSessionRef: string;
  providerContextRef: string | null;
}>;

export type ComputerRuntimeUsage = Readonly<{
  wallClockMs: number;
  providerBilledMs: number;
  uploadedByteCount: number;
  blockedSubmissionAttemptCount: number;
  /** Must be measured at the network boundary and must remain zero. */
  outboundSubmissionRequestCount: number;
}>;

export interface ComputerRuntimeAdapter {
  readonly adapterRelease: string;
  provision(request: ComputerRuntimeProvisionRequest): Promise<ProvisionedComputerRuntime>;
  /**
   * Recover a still-PROVISIONING session by the original database session ID.
   * Implementations MUST return the runtime created for `idempotencyKey`, or
   * fail. They must never create an unrelated second runtime as a fallback.
   */
  recoverProvisioning(
    request: ComputerRuntimeProvisionRequest,
  ): Promise<ProvisionedComputerRuntime>;
  destroy(runtime: ProvisionedComputerRuntime): Promise<ComputerRuntimeUsage>;
}

export type RetainedApplicationFillRuntime = Readonly<{
  computerSessionId: string;
  fillAttemptId: string;
  expiresAtMs: number;
  runtimeAdapter: ComputerRuntimeAdapter;
  runtime: ProvisionedComputerRuntime;
}>;

export type ResumeRetainedApplicationFillRuntime<T> = Readonly<{
  computerSessionId: string;
  fillAttemptId: string;
  run(runtime: ProvisionedComputerRuntime): Promise<T>;
}>;

export interface ApplicationFillRuntimeSupervisor {
  /**
   * Takes ownership of a guarded runtime until its database TTL. The caller
   * must not destroy the runtime after this promise resolves.
   */
  retain(input: RetainedApplicationFillRuntime): Promise<void>;
  /**
   * Runs one bounded continuation against the exact retained runtime. The
   * supervisor serializes this callback with TTL/shutdown teardown and never
   * exposes provider identifiers to callers.
   */
  resume<T>(input: ResumeRetainedApplicationFillRuntime<T>): Promise<T>;
}

export type ApplicationFillRuntimeReleaseReconciliationInput = Readonly<{
  computerSessionId: string;
  fillAttemptId: string;
  reason: "TTL_EXPIRED" | "WORKER_STOPPED";
  outcome: "RELEASED" | "RELEASE_UNCERTAIN";
  usage: ComputerRuntimeUsage | null;
  errorCode: string | null;
  supervisorRelease: string;
}>;

export type ApplicationFillRuntimeReleaseReconciliationResult = Readonly<{
  applicationId: string;
  applicationStatus: "PRE_SUBMIT_REVIEW" | "TAKEOVER";
  computerSessionState: "DESTROYED" | "FAILED_SAFE";
  replayed: boolean;
}>;

export interface ApplicationFillRuntimeReleaseDatabase {
  reconcileRuntimeRelease(
    input: ApplicationFillRuntimeReleaseReconciliationInput,
  ): Promise<ApplicationFillRuntimeReleaseReconciliationResult>;
}

export type NoSubmitFormOutcome =
  | Readonly<{
      kind: "FILLED_TO_REVIEW";
      readbackHash: string;
      filledFieldCount: number;
      uploadedArtifactCount: number;
      blockedFieldCount: number;
    }>
  | Readonly<{
      kind: "TAKEOVER";
      reasonCode: string;
      readbackHash: string | null;
      filledFieldCount: number;
      uploadedArtifactCount: number;
      blockedFieldCount: number;
    }>
  | Readonly<{
      kind: "FAILED_SAFE";
      reasonCode: string;
      readbackHash: string | null;
      filledFieldCount: number;
      uploadedArtifactCount: number;
      blockedFieldCount: number;
    }>;

/**
 * Intentionally has no submit method or submission authority. The runtime's
 * network guard is the independent enforcement layer beneath this interface.
 */
export interface NoSubmitFormDriver {
  readonly driverRelease: string;
  fillToPreSubmitReview(input: Readonly<{
    /** Opaque handle only; provider references stay behind the runtime adapter. */
    runtimeHandle: ComputerRuntimeHandle;
    binding: ComputerRuntimeProvisionRequest["binding"];
    startUrl: string;
    executionPackage: ApplicationFillExecutionPackage;
    submitAuthorized: false;
  }>): Promise<NoSubmitFormOutcome>;
}

export type ApplicationFillCoordinatorResult = Readonly<{
  fillAttemptId: string;
  terminalStatus: FillTerminalStatus;
  replayed: boolean;
}>;

type RpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}>;

function asRpcClient(client: unknown): RpcClient {
  return client as RpcClient;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return null;
  return value[0] as Record<string, unknown>;
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

function assertRelease(value: string, label: string): void {
  if (!RELEASE_PATTERN.test(value)) throw new Error(`${label}_INVALID`);
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new Error(`${label}_INVALID`);
  }
}

function validateExecutionPlan(plan: FillExecutionPlan): void {
  if (!Number.isSafeInteger(plan.ttlSeconds) || plan.ttlSeconds < 60 || plan.ttlSeconds > 1_800) {
    throw new Error("APPLICATION_FILL_TTL_INVALID");
  }
  if (plan.executionMode === "EPHEMERAL_CLEAN" && plan.browserProfileRef !== null) {
    throw new Error("APPLICATION_FILL_PROFILE_MODE_INVALID");
  }
  if (
    plan.executionMode === "EPHEMERAL_WITH_PERSISTENT_CONTEXT" &&
    (plan.browserProfileRef === null || !UUID_PATTERN.test(plan.browserProfileRef))
  ) {
    throw new Error("APPLICATION_FILL_PROFILE_MODE_INVALID");
  }
}

export function parseApplicationFillRequestedPayload(value: Json): ApplicationFillRequestedPayload | null {
  if (!isJsonObject(value)) return null;
  const applicationId = value.application_id;
  const revisionId = value.revision_id;
  const fillAttemptId = value.fill_attempt_id;
  const browserRunId = value.browser_run_id;
  const authorityHash = value.authority_hash;
  const disclosureManifestHash = value.disclosure_manifest_hash;
  if (
    typeof applicationId !== "string" || !UUID_PATTERN.test(applicationId) ||
    typeof revisionId !== "string" || !UUID_PATTERN.test(revisionId) ||
    typeof fillAttemptId !== "string" || !UUID_PATTERN.test(fillAttemptId) ||
    typeof browserRunId !== "string" || !UUID_PATTERN.test(browserRunId) ||
    typeof authorityHash !== "string" || !SHA256_PATTERN.test(authorityHash) ||
    typeof disclosureManifestHash !== "string" || !SHA256_PATTERN.test(disclosureManifestHash) ||
    value.authority_scope !== "FILL_ONLY_NO_SUBMIT"
  ) return null;
  return Object.freeze({
    applicationId,
    revisionId,
    fillAttemptId,
    browserRunId,
    authorityHash,
    disclosureManifestHash,
  });
}

export function buildExactOriginPolicy(destinationUrl: string): Readonly<{
  origin: string;
  policy: Json;
}> {
  let parsed: URL;
  try {
    parsed = new URL(destinationUrl);
  } catch {
    throw new Error("APPLICATION_FILL_DESTINATION_INVALID");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("APPLICATION_FILL_DESTINATION_INVALID");
  }
  const origin = parsed.origin;
  return Object.freeze({
    origin,
    policy: Object.freeze({
      policy_release: "ats-destination-policy/1",
      navigation_scope: "EXACT_ORIGIN",
      allowed_origins: [origin],
      submit_authorized: false,
    }),
  });
}

function assertAuthorizationContext(
  context: ApplicationFillAuthorizationContext,
  payload: ApplicationFillRequestedPayload,
): void {
  if (
    context.fillAttemptId !== payload.fillAttemptId ||
    context.applicationId !== payload.applicationId ||
    context.revisionId !== payload.revisionId ||
    context.browserRunId !== payload.browserRunId ||
    context.authorityHash !== payload.authorityHash ||
    context.disclosureManifestHash !== payload.disclosureManifestHash
  ) throw new Error("APPLICATION_FILL_BINDING_MISMATCH");
  if (!Array.isArray(context.artifactManifest) || !isJsonObject(context.disclosureManifest)) {
    throw new Error("APPLICATION_FILL_MANIFEST_INVALID");
  }
  const policy = context.disclosureManifest.policy;
  if (policy === undefined || !isJsonObject(policy) || policy.submit_authorized !== false) {
    throw new Error("APPLICATION_FILL_SUBMISSION_AUTHORITY_INVALID");
  }
}

function normalizeOutcome(outcome: NoSubmitFormOutcome): NoSubmitFormOutcome {
  if (outcome.kind !== "FILLED_TO_REVIEW" && !ERROR_CODE_PATTERN.test(outcome.reasonCode)) {
    throw new Error("APPLICATION_FILL_OUTCOME_CODE_INVALID");
  }
  assertCount(outcome.filledFieldCount, "APPLICATION_FILL_FIELD_COUNT");
  assertCount(outcome.uploadedArtifactCount, "APPLICATION_FILL_ARTIFACT_COUNT");
  assertCount(outcome.blockedFieldCount, "APPLICATION_FILL_BLOCKED_COUNT");
  if (
    (outcome.kind === "FILLED_TO_REVIEW" && !SHA256_PATTERN.test(outcome.readbackHash)) ||
    (outcome.kind !== "FILLED_TO_REVIEW" &&
      outcome.readbackHash !== null && !SHA256_PATTERN.test(outcome.readbackHash))
  ) throw new Error("APPLICATION_FILL_READBACK_HASH_INVALID");
  return outcome;
}

function emptyUsage(): ComputerRuntimeUsage {
  return Object.freeze({
    wallClockMs: 0,
    providerBilledMs: 0,
    uploadedByteCount: 0,
    blockedSubmissionAttemptCount: 0,
    outboundSubmissionRequestCount: 0,
  });
}

function validateUsage(usage: ComputerRuntimeUsage): void {
  assertCount(usage.wallClockMs, "APPLICATION_FILL_WALL_CLOCK");
  assertCount(usage.providerBilledMs, "APPLICATION_FILL_PROVIDER_BILLED");
  assertCount(usage.uploadedByteCount, "APPLICATION_FILL_UPLOAD_BYTES");
  assertCount(usage.blockedSubmissionAttemptCount, "APPLICATION_FILL_BLOCKED_SUBMIT_COUNT");
  assertCount(usage.outboundSubmissionRequestCount, "APPLICATION_FILL_SUBMISSION_REQUEST_COUNT");
  if (usage.outboundSubmissionRequestCount !== 0) {
    // Do not write a false `application_submitted: false` claim when the
    // network boundary reports a possible side effect. An operator must
    // reconcile the employer destination first.
    throw new Error("APPLICATION_FILL_SUBMISSION_STATE_UNCERTAIN");
  }
}

function buildCompletion(
  context: ApplicationFillAuthorizationContext,
  outcome: NoSubmitFormOutcome,
  usage: ComputerRuntimeUsage,
  runtimeDestroyed: boolean,
  driverRelease: string,
  runtimeRelease: string,
): FillCompletionInput {
  const normalized = normalizeOutcome(outcome);
  validateUsage(usage);
  const terminalStatus = normalized.kind;
  const summary = Object.freeze({
    schema_release: "application-fill-result/1",
    terminal_status: terminalStatus,
    reason_code: terminalStatus === "FILLED_TO_REVIEW" ? null : normalized.reasonCode,
    readback_hash: normalized.readbackHash,
    filled_field_count: normalized.filledFieldCount,
    uploaded_artifact_count: normalized.uploadedArtifactCount,
    blocked_field_count: normalized.blockedFieldCount,
    blocked_submission_attempt_count: usage.blockedSubmissionAttemptCount,
    submission_request_count: 0,
    application_submitted: false,
    driver_release: driverRelease,
    runtime_release: runtimeRelease,
  }) satisfies Json;
  const checkpointHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  const usageSummary = Object.freeze({
    schema_release: "computer-runtime-usage/1",
    runtime_destroyed: runtimeDestroyed,
    wall_clock_ms: usage.wallClockMs,
    provider_billed_ms: usage.providerBilledMs,
    uploaded_byte_count: usage.uploadedByteCount,
    blocked_submission_attempt_count: usage.blockedSubmissionAttemptCount,
    submission_request_count: 0,
    application_submitted: false,
  }) satisfies Json;
  return Object.freeze({
    fillAttemptId: context.fillAttemptId,
    terminalStatus,
    checkpointHash,
    redactedSummary: summary,
    runtimeDestroyed,
    usageSummary,
  });
}

function failedSafeOutcome(error: unknown): NoSubmitFormOutcome {
  return Object.freeze({
    kind: "FAILED_SAFE" as const,
    reasonCode: safeErrorCode(error, "APPLICATION_FILL_RUNTIME_FAILED"),
    readbackHash: null,
    filledFieldCount: 0,
    uploadedArtifactCount: 0,
    blockedFieldCount: 0,
  });
}

function buildRecoveryFailureCompletion(
  claim: ApplicationFillRecoveryClaim,
): FillCompletionInput {
  const reasonCode = claim.recoveryMode === "FAIL_SAFE_SESSION_EXPIRED"
    ? "APPLICATION_FILL_SESSION_EXPIRED"
    : claim.recoveryMode === "FAIL_SAFE_DISCLOSURE_POSSIBLE"
      ? "APPLICATION_FILL_DISCLOSURE_MAY_HAVE_OCCURRED"
      : "APPLICATION_FILL_RECOVERY_BINDING_MISSING";
  const redactedSummary = Object.freeze({
    schema_release: "application-fill-recovery-result/1",
    terminal_status: "FAILED_SAFE",
    reason_code: reasonCode,
    recovery_mode: claim.recoveryMode,
    computer_session_id: claim.computerSessionId,
    telemetry_available: false,
    submission_request_count: 0,
    application_submitted: false,
  }) satisfies Json;
  const checkpointHash = createHash("sha256")
    .update(JSON.stringify(redactedSummary))
    .digest("hex");
  return Object.freeze({
    fillAttemptId: claim.fillAttemptId,
    terminalStatus: "FAILED_SAFE" as const,
    checkpointHash,
    redactedSummary,
    runtimeDestroyed: false,
    usageSummary: Object.freeze({
      schema_release: "computer-runtime-usage/1",
      runtime_destroyed: false,
      telemetry_available: false,
      submission_request_count: 0,
      application_submitted: false,
    }),
  });
}

const TERMINAL_ATTEMPT_STATUSES = new Set<ApplicationFillAttemptStatus>([
  "FILLED_TO_REVIEW",
  "TAKEOVER",
  "FAILED_SAFE",
  "CANCELED",
]);

const APPLICATION_FILL_RECOVERY_MODES = new Set<ApplicationFillRecoveryMode>([
  "RESUME_IDEMPOTENT_PROVISION",
  "FAIL_SAFE_SESSION_EXPIRED",
  "FAIL_SAFE_DISCLOSURE_POSSIBLE",
  "FAIL_SAFE_RECOVERY_BINDING_MISSING",
]);

export async function coordinateApplicationFill(
  database: ApplicationFillDatabase,
  runtimeAdapter: ComputerRuntimeAdapter,
  formDriver: NoSubmitFormDriver,
  materializer: ApplicationFillExecutionMaterializer,
  message: ApplicationFillOutboxMessage,
  workerId: string,
  executionPolicy: ApplicationFillExecutionPolicy = ephemeralCleanFillExecutionPolicy,
  expectedRecoverySessionId: string | null = null,
  runtimeSupervisor: ApplicationFillRuntimeSupervisor | null = null,
): Promise<ApplicationFillCoordinatorResult> {
  if (message.topic !== APPLICATION_FILL_TOPIC) throw new Error("APPLICATION_FILL_TOPIC_UNSUPPORTED");
  const payload = parseApplicationFillRequestedPayload(message.payload);
  if (!payload) throw new Error("APPLICATION_FILL_OUTBOX_PAYLOAD_INVALID");
  assertRelease(runtimeAdapter.adapterRelease, "APPLICATION_FILL_RUNTIME_RELEASE");
  assertRelease(formDriver.driverRelease, "APPLICATION_FILL_DRIVER_RELEASE");

  const context = await database.loadAuthorizationContext(payload.fillAttemptId);
  assertAuthorizationContext(context, payload);
  if (TERMINAL_ATTEMPT_STATUSES.has(context.status)) {
    const terminalStatus: FillTerminalStatus = context.status === "FILLED_TO_REVIEW"
      ? "FILLED_TO_REVIEW"
      : context.status === "TAKEOVER"
        ? "TAKEOVER"
        : "FAILED_SAFE";
    return Object.freeze({
      fillAttemptId: context.fillAttemptId,
      terminalStatus,
      replayed: true,
    });
  }

  const requestedExecutionPlan = executionPolicy.plan(context);
  validateExecutionPlan(requestedExecutionPlan);
  const destination = buildExactOriginPolicy(context.destinationUrl);
  const reserved = await database.startAttempt({
    outboxId: message.outboxId,
    workerId,
    fillAttemptId: context.fillAttemptId,
    executionPlan: requestedExecutionPlan,
    allowedDomainPolicy: destination.policy,
  });
  validateExecutionPlan(reserved.executionPlan);
  if (
    reserved.applicationId !== context.applicationId ||
    reserved.revisionId !== context.revisionId ||
    !UUID_PATTERN.test(reserved.computerSessionId)
  ) throw new Error("APPLICATION_FILL_START_PROTOCOL_INVALID");
  if (expectedRecoverySessionId !== null && (
    !UUID_PATTERN.test(expectedRecoverySessionId) ||
    !reserved.replayed ||
    reserved.computerSessionId !== expectedRecoverySessionId
  )) throw new Error("APPLICATION_FILL_RECOVERY_SESSION_MISMATCH");
  if (!reserved.replayed && (
    reserved.executionPlan.executionMode !== requestedExecutionPlan.executionMode ||
    reserved.executionPlan.browserProfileRef !== requestedExecutionPlan.browserProfileRef ||
    reserved.executionPlan.ttlSeconds !== requestedExecutionPlan.ttlSeconds
  )) throw new Error("APPLICATION_FILL_START_PLAN_MISMATCH");

  const binding = Object.freeze({
    workspaceId: context.workspaceId,
    candidateId: context.candidateId,
    applicationId: context.applicationId,
    revisionId: context.revisionId,
    fillAttemptId: context.fillAttemptId,
    computerSessionId: reserved.computerSessionId,
  });
  let runtime: ProvisionedComputerRuntime | null = null;
  let executionPackage: ApplicationFillExecutionPackage | null = null;
  let outcome: NoSubmitFormOutcome;
  let usage = emptyUsage();
  let runtimeDestroyed = true;
  try {
    try {
      executionPackage = await materializer.materialize({ context, binding });
      const provisionRequest: ComputerRuntimeProvisionRequest = Object.freeze({
        idempotencyKey: reserved.computerSessionId,
        binding,
        startUrl: context.destinationUrl,
        allowedOrigins: Object.freeze([destination.origin]),
        ttlSeconds: reserved.executionPlan.ttlSeconds,
        executionMode: reserved.executionPlan.executionMode,
        browserProfileRef: reserved.executionPlan.browserProfileRef,
        artifactManifest: context.artifactManifest,
        artifactPayloads: executionPackage.artifacts,
        submissionGuard: Object.freeze({
          submitAuthorized: false as const,
          outboundSubmissionRequests: "BLOCK" as const,
        }),
      });
      runtime = reserved.replayed
        ? await runtimeAdapter.recoverProvisioning(provisionRequest)
        : await runtimeAdapter.provision(provisionRequest);
      if (
        runtime.handle === null || runtime.handle === undefined ||
        !RELEASE_PATTERN.test(runtime.providerAdapter) ||
        runtime.providerSessionRef.trim().length === 0 || runtime.providerSessionRef.length > 512 ||
        (runtime.providerContextRef !== null &&
          (runtime.providerContextRef.trim().length === 0 || runtime.providerContextRef.length > 512)) ||
        (reserved.executionPlan.executionMode === "EPHEMERAL_WITH_PERSISTENT_CONTEXT" &&
          runtime.providerContextRef === null)
      ) throw new Error("APPLICATION_FILL_RUNTIME_PROTOCOL_INVALID");
      await database.activateSession({
        workerId,
        computerSessionId: reserved.computerSessionId,
        providerAdapter: runtime.providerAdapter,
        providerSessionRef: runtime.providerSessionRef,
        providerContextRef: runtime.providerContextRef,
        adapterRelease: runtimeAdapter.adapterRelease,
      });
      outcome = normalizeOutcome(await formDriver.fillToPreSubmitReview({
        runtimeHandle: runtime.handle,
        binding,
        startUrl: context.destinationUrl,
        executionPackage,
        submitAuthorized: false,
      }));
    } catch (error) {
      outcome = failedSafeOutcome(error);
    }

    let runtimeRetained = false;
    if (
      runtime && runtimeSupervisor &&
      (outcome.kind === "FILLED_TO_REVIEW" || outcome.kind === "TAKEOVER")
    ) {
      try {
        await runtimeSupervisor.retain({
          computerSessionId: reserved.computerSessionId,
          fillAttemptId: context.fillAttemptId,
          expiresAtMs: Date.now() + reserved.executionPlan.ttlSeconds * 1_000,
          runtimeAdapter,
          runtime,
        });
        runtimeRetained = true;
        runtimeDestroyed = false;
      } catch {
        outcome = failedSafeOutcome(
          new Error("APPLICATION_FILL_RUNTIME_RETENTION_FAILED"),
        );
      }
    }

    if (runtime && !runtimeRetained) {
      runtimeDestroyed = false;
      try {
        usage = await runtimeAdapter.destroy(runtime);
        runtimeDestroyed = true;
      } catch {
        outcome = failedSafeOutcome(new Error("APPLICATION_FILL_RUNTIME_TEARDOWN_FAILED"));
      }
      // Invalid or non-zero outbound-request telemetry is not a routine runtime
      // failure. It is an uncertain external side effect and must be reconciled,
      // never rewritten into a false no-submit completion.
      if (runtimeDestroyed) validateUsage(usage);
    }

    const completion = buildCompletion(
      context,
      outcome,
      usage,
      runtimeDestroyed,
      formDriver.driverRelease,
      runtimeAdapter.adapterRelease,
    );
    await database.completeAttempt(completion, workerId);
    return Object.freeze({
      fillAttemptId: context.fillAttemptId,
      terminalStatus: completion.terminalStatus,
      replayed: reserved.replayed,
    });
  } finally {
    if (executionPackage) eraseApplicationFillExecutionPackage(executionPackage);
  }
}

function parseContextRow(row: Database["public"]["Tables"]["application_fill_attempts"]["Row"]): ApplicationFillAuthorizationContext {
  const status = row.status as ApplicationFillAttemptStatus;
  if (
    !UUID_PATTERN.test(row.workspace_id) || !UUID_PATTERN.test(row.candidate_id) ||
    !UUID_PATTERN.test(row.application_id) || !UUID_PATTERN.test(row.revision_id) ||
    !UUID_PATTERN.test(row.id) || !UUID_PATTERN.test(row.browser_run_id) ||
    !SHA256_PATTERN.test(row.authority_hash) || !SHA256_PATTERN.test(row.disclosure_manifest_hash) ||
    !TERMINAL_ATTEMPT_STATUSES.has(status) && status !== "QUEUED" && status !== "STARTED"
  ) throw new Error("APPLICATION_FILL_CONTEXT_PROTOCOL_INVALID");
  return Object.freeze({
    workspaceId: row.workspace_id,
    candidateId: row.candidate_id,
    applicationId: row.application_id,
    revisionId: row.revision_id,
    fillAttemptId: row.id,
    browserRunId: row.browser_run_id,
    status,
    destinationUrl: row.destination_url,
    authorityHash: row.authority_hash,
    disclosureManifestHash: row.disclosure_manifest_hash,
    artifactManifest: row.artifact_manifest,
    disclosureManifest: row.disclosure_manifest,
  });
}

export function createSupabaseApplicationFillDatabase(
  supabase: SupabaseClient<Database>,
): ApplicationFillRecoveryDatabase {
  const database: ApplicationFillRecoveryDatabase = {
    async loadAuthorizationContext(fillAttemptId) {
      const result = await supabase
        .from("application_fill_attempts")
        .select("*")
        .eq("id", fillAttemptId)
        .maybeSingle();
      if (result.error || !result.data) throw new Error("APPLICATION_FILL_CONTEXT_LOAD_FAILED");
      return parseContextRow(result.data);
    },

    async startAttempt(input) {
      const response = await asRpcClient(supabase).rpc("start_application_fill_attempt", {
        p_outbox_id: input.outboxId,
        p_worker_id: input.workerId,
        p_fill_attempt_id: input.fillAttemptId,
        p_execution_mode: input.executionPlan.executionMode,
        p_broker_release: APPLICATION_FILL_BROKER_RELEASE,
        p_allowed_domain_policy: input.allowedDomainPolicy,
        p_browser_profile_ref: input.executionPlan.browserProfileRef,
        p_ttl_seconds: input.executionPlan.ttlSeconds,
      });
      if (response.error) {
        throw new Error(
          response.error.message?.match(/[A-Z][A-Z0-9_]{2,119}/u)?.[0] ??
          "APPLICATION_FILL_START_FAILED",
        );
      }
      const row = firstRow(response.data);
      if (
        !row || typeof row.computer_session_id !== "string" ||
        typeof row.application_id !== "string" || typeof row.revision_id !== "string" ||
        typeof row.replayed !== "boolean" ||
        (row.execution_mode !== "EPHEMERAL_CLEAN" &&
          row.execution_mode !== "EPHEMERAL_WITH_PERSISTENT_CONTEXT") ||
        (row.browser_profile_ref !== null && typeof row.browser_profile_ref !== "string") ||
        typeof row.session_ttl_seconds !== "number"
      ) throw new Error("APPLICATION_FILL_START_PROTOCOL_INVALID");
      const executionPlan = Object.freeze({
        executionMode: row.execution_mode,
        browserProfileRef: row.browser_profile_ref,
        ttlSeconds: row.session_ttl_seconds,
      });
      validateExecutionPlan(executionPlan);
      return Object.freeze({
        computerSessionId: row.computer_session_id,
        applicationId: row.application_id,
        revisionId: row.revision_id,
        replayed: row.replayed,
        executionPlan,
      });
    },

    async activateSession(input) {
      const response = await asRpcClient(supabase).rpc("activate_leased_computer_session", {
        p_worker_id: input.workerId,
        p_computer_session_id: input.computerSessionId,
        p_provider_adapter: input.providerAdapter,
        p_provider_session_ref: input.providerSessionRef,
        p_provider_context_ref: input.providerContextRef,
        p_adapter_release: input.adapterRelease,
      });
      if (response.error || !firstRow(response.data)) {
        throw new Error(
          response.error?.message?.match(/[A-Z][A-Z0-9_]{2,119}/u)?.[0] ??
          "APPLICATION_FILL_ACTIVATION_FAILED",
        );
      }
    },

    async completeAttempt(input, workerId) {
      const response = await asRpcClient(supabase).rpc("complete_leased_application_fill_attempt", {
        p_worker_id: workerId,
        p_fill_attempt_id: input.fillAttemptId,
        p_terminal_status: input.terminalStatus,
        p_checkpoint_hash: input.checkpointHash,
        p_redacted_summary: input.redactedSummary,
        p_runtime_destroyed: input.runtimeDestroyed,
        p_usage_summary: input.usageSummary,
      });
      if (response.error || !firstRow(response.data)) {
        throw new Error(
          response.error?.message?.match(/[A-Z][A-Z0-9_]{2,119}/u)?.[0] ??
          "APPLICATION_FILL_COMPLETION_FAILED",
        );
      }
    },

    async claimStale(workerId) {
      const response = await asRpcClient(supabase).rpc(
        "claim_stale_application_fill_attempt",
        { p_worker_id: workerId, p_lease_seconds: 120 },
      );
      if (response.error) throw new Error("APPLICATION_FILL_RECOVERY_CLAIM_FAILED");
      if (!Array.isArray(response.data)) {
        throw new Error("APPLICATION_FILL_RECOVERY_CLAIM_PROTOCOL_INVALID");
      }
      return response.data.map((value) => {
        if (!value || typeof value !== "object") {
          throw new Error("APPLICATION_FILL_RECOVERY_CLAIM_PROTOCOL_INVALID");
        }
        const row = value as Record<string, unknown>;
        const recoveryMode = row.recovery_mode;
        if (
          typeof row.fill_attempt_id !== "string" || !UUID_PATTERN.test(row.fill_attempt_id) ||
          typeof row.computer_session_id !== "string" || !UUID_PATTERN.test(row.computer_session_id) ||
          typeof recoveryMode !== "string" ||
          !APPLICATION_FILL_RECOVERY_MODES.has(recoveryMode as ApplicationFillRecoveryMode)
        ) throw new Error("APPLICATION_FILL_RECOVERY_CLAIM_PROTOCOL_INVALID");

        let claimedMessage: ApplicationFillOutboxMessage | null = null;
        if (row.outbox_id !== null && row.outbox_id !== undefined) {
          if (
            typeof row.outbox_id !== "string" || !UUID_PATTERN.test(row.outbox_id) ||
            typeof row.outbox_topic !== "string" ||
            typeof row.outbox_attempt_count !== "number" ||
            !Number.isSafeInteger(row.outbox_attempt_count) || row.outbox_attempt_count < 0 ||
            row.outbox_payload === undefined
          ) throw new Error("APPLICATION_FILL_RECOVERY_CLAIM_PROTOCOL_INVALID");
          claimedMessage = Object.freeze({
            outboxId: row.outbox_id,
            topic: row.outbox_topic,
            payload: row.outbox_payload as Json,
            attemptCount: row.outbox_attempt_count,
          });
        }
        if (recoveryMode === "RESUME_IDEMPOTENT_PROVISION" && claimedMessage === null) {
          throw new Error("APPLICATION_FILL_RECOVERY_BINDING_MISSING");
        }
        return Object.freeze({
          fillAttemptId: row.fill_attempt_id,
          computerSessionId: row.computer_session_id,
          recoveryMode: recoveryMode as ApplicationFillRecoveryMode,
          message: claimedMessage,
        });
      });
    },

    async claim(workerId) {
      const response = await supabase.rpc("claim_outbox_batch", {
        p_worker_id: workerId,
        p_limit: 1,
        p_lease_seconds: 900,
        p_topics: [APPLICATION_FILL_TOPIC],
      });
      if (response.error) throw new Error("OUTBOX_CLAIM_FAILED");
      return (response.data ?? []).map((message) => Object.freeze({
        outboxId: message.outbox_id,
        topic: message.topic,
        payload: message.payload,
        attemptCount: message.attempt_count,
      }));
    },

    async releaseFailure(input) {
      const disposition = decideOutboxFailureDisposition(input.attemptCount, input.errorCode);
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
      if (response.error) throw new Error("OUTBOX_FAILURE_RELEASE_FAILED");
      return firstBoolean(response.data);
    },
  };
  return Object.freeze(database);
}

/**
 * Service-only database seam used after a retained review/takeover browser has
 * been released. It records only measured zero-submit telemetry. When release
 * telemetry is uncertain, it persists an explicit unknown state instead of a
 * false no-submit claim.
 */
export function createSupabaseApplicationFillRuntimeReleaseDatabase(
  supabase: SupabaseClient<Database>,
): ApplicationFillRuntimeReleaseDatabase {
  return Object.freeze({
    async reconcileRuntimeRelease(
      input: ApplicationFillRuntimeReleaseReconciliationInput,
    ) {
      if (
        !UUID_PATTERN.test(input.computerSessionId) ||
        !UUID_PATTERN.test(input.fillAttemptId)
      ) throw new Error("APPLICATION_FILL_RUNTIME_RELEASE_BINDING_INVALID");
      if (
        input.supervisorRelease !== "application-fill-runtime-supervisor/1"
      ) throw new Error("APPLICATION_FILL_RUNTIME_SUPERVISOR_RELEASE_INVALID");
      if (
        input.reason !== "TTL_EXPIRED" &&
        input.reason !== "WORKER_STOPPED"
      ) throw new Error("APPLICATION_FILL_RUNTIME_RELEASE_REASON_INVALID");

      let usageSummary: Json = Object.freeze({});
      if (input.outcome === "RELEASED") {
        if (input.usage === null || input.errorCode !== null) {
          throw new Error("APPLICATION_FILL_RUNTIME_RELEASE_TELEMETRY_INVALID");
        }
        validateUsage(input.usage);
        usageSummary = Object.freeze({
          schema_release: "computer-runtime-release-usage/1",
          runtime_destroyed: true,
          telemetry_available: true,
          wall_clock_ms: input.usage.wallClockMs,
          provider_billed_ms: input.usage.providerBilledMs,
          uploaded_byte_count: input.usage.uploadedByteCount,
          blocked_submission_attempt_count:
            input.usage.blockedSubmissionAttemptCount,
          submission_request_count: 0,
          application_submitted: false,
        });
      } else if (input.outcome === "RELEASE_UNCERTAIN") {
        if (
          input.usage !== null ||
          input.errorCode === null ||
          !ERROR_CODE_PATTERN.test(input.errorCode)
        ) throw new Error("APPLICATION_FILL_RUNTIME_RELEASE_TELEMETRY_INVALID");
      } else {
        throw new Error("APPLICATION_FILL_RUNTIME_RELEASE_OUTCOME_INVALID");
      }

      const response = await asRpcClient(supabase).rpc(
        "reconcile_application_fill_runtime_release",
        {
          p_fill_attempt_id: input.fillAttemptId,
          p_computer_session_id: input.computerSessionId,
          p_release_reason: input.reason,
          p_release_outcome: input.outcome,
          p_usage_summary: usageSummary,
          p_supervisor_release: input.supervisorRelease,
          p_error_code: input.errorCode,
        },
      );
      if (response.error) {
        throw new Error(
          response.error.message?.match(/[A-Z][A-Z0-9_]{2,119}/u)?.[0] ??
          "APPLICATION_FILL_RUNTIME_RELEASE_RECONCILIATION_FAILED",
        );
      }
      const row = firstRow(response.data);
      if (
        !row ||
        typeof row.application_id !== "string" ||
        !UUID_PATTERN.test(row.application_id) ||
        (row.application_status !== "PRE_SUBMIT_REVIEW" &&
          row.application_status !== "TAKEOVER") ||
        (row.computer_session_state !== "DESTROYED" &&
          row.computer_session_state !== "FAILED_SAFE") ||
        typeof row.replayed !== "boolean"
      ) throw new Error("APPLICATION_FILL_RUNTIME_RELEASE_PROTOCOL_INVALID");

      return Object.freeze({
        applicationId: row.application_id,
        applicationStatus: row.application_status,
        computerSessionState: row.computer_session_state,
        replayed: row.replayed,
      });
    },
  });
}

export async function runApplicationFillWorkerOnce(input: Readonly<{
  runtimeAdapter: ComputerRuntimeAdapter;
  formDriver: NoSubmitFormDriver;
  database?: ApplicationFillDatabase;
  materializer?: ApplicationFillExecutionMaterializer;
  executionPolicy?: ApplicationFillExecutionPolicy;
  runtimeSupervisor?: ApplicationFillRuntimeSupervisor;
}>): Promise<Readonly<{ claimed: number; completed: number; failed: number }>> {
  // There is intentionally no default runtime or driver. Calling this worker
  // requires an explicitly configured provider adapter and no-submit driver.
  assertRelease(input.runtimeAdapter.adapterRelease, "APPLICATION_FILL_RUNTIME_RELEASE");
  assertRelease(input.formDriver.driverRelease, "APPLICATION_FILL_DRIVER_RELEASE");
  let database = input.database;
  let materializer = input.materializer;
  if (!database || !materializer) {
    const supabase = createSupabaseAdminClient("application-fill-worker/0.1");
    database ??= createSupabaseApplicationFillDatabase(supabase);
    materializer ??= createSupabaseApplicationFillExecutionMaterializer(supabase);
  }
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 120);
  const messages = await database.claim(workerId);
  let completed = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      await coordinateApplicationFill(
        database,
        input.runtimeAdapter,
        input.formDriver,
        materializer,
        message,
        workerId,
        input.executionPolicy,
        null,
        input.runtimeSupervisor ?? null,
      );
      // start_application_fill_attempt publishes the outbox row atomically
      // with reserving the durable session; a second ack would weaken it.
      completed += 1;
    } catch (error) {
      const errorCode = safeErrorCode(error, "APPLICATION_FILL_WORKER_FAILED");
      const released = await database.releaseFailure({
        workerId,
        outboxId: message.outboxId,
        attemptCount: message.attemptCount,
        errorCode,
      });
      if (!released) {
        // The start RPC may already have published the row. Do not pretend a
        // retry was scheduled; this requires durable reconciliation.
        throw new Error("APPLICATION_FILL_RECOVERY_REQUIRED", { cause: error });
      }
      failed += 1;
    }
  }
  return Object.freeze({ claimed: messages.length, completed, failed });
}

export async function runApplicationFillRecoveryOnce(input: Readonly<{
  runtimeAdapter: ComputerRuntimeAdapter;
  formDriver: NoSubmitFormDriver;
  database?: ApplicationFillRecoveryDatabase;
  materializer?: ApplicationFillExecutionMaterializer;
  runtimeSupervisor?: ApplicationFillRuntimeSupervisor;
}>): Promise<Readonly<{ claimed: number; recovered: number; failedSafe: number }>> {
  assertRelease(input.runtimeAdapter.adapterRelease, "APPLICATION_FILL_RUNTIME_RELEASE");
  assertRelease(input.formDriver.driverRelease, "APPLICATION_FILL_DRIVER_RELEASE");
  let database = input.database;
  let materializer = input.materializer;
  if (!database || !materializer) {
    const supabase = createSupabaseAdminClient("application-fill-recovery/0.1");
    database ??= createSupabaseApplicationFillDatabase(supabase);
    materializer ??= createSupabaseApplicationFillExecutionMaterializer(supabase);
  }

  const workerId = `${hostname()}:${process.pid}:fill-recovery:${randomUUID()}`.slice(0, 120);
  const claims = await database.claimStale(workerId);
  let recovered = 0;
  let failedSafe = 0;
  for (const claim of claims) {
    if (claim.recoveryMode === "RESUME_IDEMPOTENT_PROVISION") {
      if (!claim.message) throw new Error("APPLICATION_FILL_RECOVERY_BINDING_MISSING");
      const payload = parseApplicationFillRequestedPayload(claim.message.payload);
      if (!payload || payload.fillAttemptId !== claim.fillAttemptId) {
        throw new Error("APPLICATION_FILL_RECOVERY_BINDING_MISMATCH");
      }
      const result = await coordinateApplicationFill(
        database,
        input.runtimeAdapter,
        input.formDriver,
        materializer,
        claim.message,
        workerId,
        ephemeralCleanFillExecutionPolicy,
        claim.computerSessionId,
        input.runtimeSupervisor ?? null,
      );
      if (result.terminalStatus === "FAILED_SAFE") failedSafe += 1;
      else recovered += 1;
      continue;
    }

    // ACTIVE or expired work is not opened in another runtime. The service
    // worker records a bounded failure and leaves runtime teardown for provider
    // reconciliation instead of claiming a side effect did not occur.
    await database.completeAttempt(buildRecoveryFailureCompletion(claim), workerId);
    failedSafe += 1;
  }
  return Object.freeze({ claimed: claims.length, recovered, failedSafe });
}
