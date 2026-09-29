import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { applicationInputsChanged } from "@/domain/application-input-freshness";
import {
  isApplicationPreparationReadiness,
  isApplicationPreparationStage,
  parseApplicationInputBlockers,
  type ApplicationInputBlocker,
  type ApplicationPreparationReadiness,
  type ApplicationPreparationStage,
} from "@/domain/application-input-snapshot";
import {
  isApplicationStatus,
  isJobIntakeStatus,
  latestPreparationSnapshotId,
  type ApplicationStatus,
  type JobIntakeStatus,
  type PersistentQueueApplication,
} from "@/domain/dashboard-queue";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { htmlToPlainText } from "@/server/ingestion/normalize";

export type QueueWorkspaceDTO = Readonly<{
  actorLabel: string;
  applications: readonly PersistentQueueApplication[];
}>;

export type EnqueuePastedLinkCommand = Readonly<{
  commandId: string;
  canonicalUrl: string;
}>;

export type EnqueuePastedLinkResult = Readonly<{
  replayed: boolean;
  applicationId: string | null;
}>;

export type PersonalWorkspaceScope = Readonly<{
  workspaceId: string;
  candidateId: string;
  replayed: boolean;
}>;

export type ApplicationRunDTO = Readonly<{
  kind: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  preparationStage: ApplicationPreparationStage | null;
}>;

export type ApplicationInputSnapshotDTO = Readonly<{
  readiness: ApplicationPreparationReadiness;
  blockers: readonly ApplicationInputBlocker[];
  createdAt: string;
}>;

export type ApplicationRevisionDTO = Readonly<{
  id: string;
  version: number;
  validationStatus: string;
  packetHash: string;
  materialDiff: Readonly<{
    resumeMode: "AS_UPLOADED" | "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS" | null;
    resumeChanged: boolean | null;
    coverLetterCreated: boolean;
    coverLetterParagraphCount: number | null;
  }>;
  createdAt: string;
}>;

export type ApplicationFillAttemptDTO = Readonly<{
  id: string;
  status: "QUEUED" | "STARTED" | "FILLED_TO_REVIEW" | "TAKEOVER" | "FAILED_SAFE" | "CANCELED";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}>;

export type ComputerSessionDTO = Readonly<{
  id: string;
  executionMode: "EPHEMERAL_CLEAN" | "EPHEMERAL_WITH_PERSISTENT_CONTEXT";
  state: "PROVISIONING" | "ACTIVE" | "PAUSED_FOR_REVIEW" | "CLOSED" | "DESTROYED" | "FAILED_SAFE";
  expiresAt: string;
}>;

export type ApplicationFillResumeAttemptDTO = Readonly<{
  status: "QUEUED" | "FILLED_TO_REVIEW" | "TAKEOVER" | "FAILED_SAFE";
  createdAt: string;
  completedAt: string | null;
}>;

export type ApplicationEventDTO = Readonly<{
  type: string;
  actorKind: string;
  occurredAt: string;
}>;

export type ApplicationArtifactDTO = Readonly<{
  id: string;
  kind: string;
  variant: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  qaStatus: string;
  createdAt: string;
}>;

export type ApplicationReceiptDTO = Readonly<{
  confirmationKind: string;
  confirmedAt: string;
}>;

export type ApplicationWorkspaceDTO = Readonly<{
  applicationRouteKey: string;
  aggregateVersion: number;
  profileChanged: boolean;
  status: ApplicationStatus;
  intakeStatus: JobIntakeStatus | null;
  failureCode: string | null;
  queuedAt: string;
  updatedAt: string;
  sourceUrl: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  description: string | null;
  applyUrl: string | null;
  publishedAt: string | null;
  currentRevision: ApplicationRevisionDTO | null;
  artifacts: readonly ApplicationArtifactDTO[];
  runs: readonly ApplicationRunDTO[];
  events: readonly ApplicationEventDTO[];
  receipt: ApplicationReceiptDTO | null;
  inputSnapshot: ApplicationInputSnapshotDTO | null;
  fillAttempt: ApplicationFillAttemptDTO | null;
  computerSession: ComputerSessionDTO | null;
  fillResumeAttempt: ApplicationFillResumeAttemptDTO | null;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESUME_MODES = new Set([
  "AS_UPLOADED",
  "REORDER_AND_TIGHTEN",
  "REWRITE_FROM_VERIFIED_FACTS",
] as const);
const FILL_ATTEMPT_STATUSES = new Set([
  "QUEUED",
  "STARTED",
  "FILLED_TO_REVIEW",
  "TAKEOVER",
  "FAILED_SAFE",
  "CANCELED",
] as const);
const COMPUTER_SESSION_MODES = new Set([
  "EPHEMERAL_CLEAN",
  "EPHEMERAL_WITH_PERSISTENT_CONTEXT",
] as const);
const COMPUTER_SESSION_STATES = new Set([
  "PROVISIONING",
  "ACTIVE",
  "PAUSED_FOR_REVIEW",
  "CLOSED",
  "DESTROYED",
  "FAILED_SAFE",
] as const);
const FILL_RESUME_ATTEMPT_STATUSES = new Set([
  "QUEUED",
  "FILLED_TO_REVIEW",
  "TAKEOVER",
  "FAILED_SAFE",
] as const);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMaterialDiff(value: unknown): ApplicationRevisionDTO["materialDiff"] {
  const root = asRecord(value);
  const resume = asRecord(root?.resume);
  const coverLetter = asRecord(root?.cover_letter);
  const proposedMode = resume?.mode;
  const resumeMode = typeof proposedMode === "string" && RESUME_MODES.has(
    proposedMode as "AS_UPLOADED" | "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS",
  )
    ? proposedMode as "AS_UPLOADED" | "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS"
    : null;
  const sourceHash = resume?.source_reviewed_text_sha256;
  const generatedHash = resume?.generated_text_sha256;
  const paragraphCount = coverLetter?.paragraph_count;

  return Object.freeze({
    resumeMode,
    resumeChanged: typeof sourceHash === "string" && typeof generatedHash === "string"
      ? sourceHash !== generatedHash
      : null,
    coverLetterCreated: coverLetter?.kind === "CREATED",
    coverLetterParagraphCount: typeof paragraphCount === "number" &&
        Number.isSafeInteger(paragraphCount) && paragraphCount >= 0
      ? paragraphCount
      : null,
  });
}

function parseFillAttempt(value: unknown): Readonly<{
  id: string;
  dto: ApplicationFillAttemptDTO;
}> | null {
  const row = asRecord(value);
  if (!row) return null;
  if (
    typeof row.id !== "string" ||
    !UUID_PATTERN.test(row.id) ||
    typeof row.status !== "string" ||
    !FILL_ATTEMPT_STATUSES.has(row.status as ApplicationFillAttemptDTO["status"]) ||
    typeof row.created_at !== "string" ||
    (row.started_at !== null && typeof row.started_at !== "string") ||
    (row.completed_at !== null && typeof row.completed_at !== "string")
  ) {
    throw new Error("APPLICATION_WORKSPACE_FILL_ATTEMPT_INVALID");
  }

  return Object.freeze({
    id: row.id,
    dto: Object.freeze({
      id: row.id,
      status: row.status as ApplicationFillAttemptDTO["status"],
      createdAt: row.created_at,
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null,
    }),
  });
}

function parseComputerSession(value: unknown): ComputerSessionDTO | null {
  const row = asRecord(value);
  if (!row) return null;
  if (
    typeof row.id !== "string" ||
    !UUID_PATTERN.test(row.id) ||
    typeof row.execution_mode !== "string" ||
    !COMPUTER_SESSION_MODES.has(row.execution_mode as ComputerSessionDTO["executionMode"]) ||
    typeof row.state !== "string" ||
    !COMPUTER_SESSION_STATES.has(row.state as ComputerSessionDTO["state"]) ||
    typeof row.expires_at !== "string"
  ) {
    throw new Error("APPLICATION_WORKSPACE_COMPUTER_SESSION_INVALID");
  }

  return Object.freeze({
    id: row.id,
    executionMode: row.execution_mode as ComputerSessionDTO["executionMode"],
    state: row.state as ComputerSessionDTO["state"],
    expiresAt: row.expires_at,
  });
}

function parseFillResumeAttempt(value: unknown): ApplicationFillResumeAttemptDTO | null {
  const row = asRecord(value);
  if (!row) return null;
  if (
    typeof row.status !== "string" ||
    !FILL_RESUME_ATTEMPT_STATUSES.has(
      row.status as ApplicationFillResumeAttemptDTO["status"],
    ) ||
    typeof row.created_at !== "string" ||
    (row.completed_at !== null && typeof row.completed_at !== "string")
  ) throw new Error("APPLICATION_WORKSPACE_FILL_RESUME_ATTEMPT_INVALID");
  return Object.freeze({
    status: row.status as ApplicationFillResumeAttemptDTO["status"],
    createdAt: row.created_at,
    completedAt: row.completed_at as string | null,
  });
}

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function boundedDisplayName(actor: AuthenticatedActor, proposed: string): string {
  const normalized = proposed.trim().replace(/\s+/g, " ").slice(0, 80);
  if (normalized) {
    return normalized;
  }

  const emailPrefix = actor.email?.split("@")[0]?.trim().slice(0, 80);
  return emailPrefix || "RoleDawn candidate";
}

export async function bootstrapPersonalWorkspace(
  supabase: SupabaseClient<Database>,
  actor: AuthenticatedActor,
  proposedDisplayName: string,
): Promise<PersonalWorkspaceScope> {
  const { data, error } = await supabase.rpc("bootstrap_personal_workspace", {
    p_display_name: boundedDisplayName(actor, proposedDisplayName),
  });

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error("WORKSPACE_BOOTSTRAP_UNAVAILABLE");
    }

    throw new Error("WORKSPACE_BOOTSTRAP_FAILED");
  }

  const row = firstRow(data);
  if (
    !row ||
    !UUID_PATTERN.test(row.workspace_id) ||
    !UUID_PATTERN.test(row.candidate_id)
  ) {
    throw new Error("WORKSPACE_BOOTSTRAP_FAILED");
  }

  return Object.freeze({
    workspaceId: row.workspace_id,
    candidateId: row.candidate_id,
    replayed: row.replayed,
  });
}

export async function enqueuePastedLinkApplication(
  actor: AuthenticatedActor,
  command: EnqueuePastedLinkCommand,
): Promise<EnqueuePastedLinkResult> {
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(
    supabase,
    actor,
    actor.email?.split("@")[0] ?? "",
  );

  const { data, error } = await supabase.rpc(
    "enqueue_pasted_link_application",
    {
      p_command_id: command.commandId,
      p_canonical_url: command.canonicalUrl,
    },
  );

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error("APPLICATION_ENQUEUE_UNAVAILABLE");
    }

    throw new Error("APPLICATION_ENQUEUE_FAILED");
  }

  const row = firstRow(data);
  if (!row) {
    throw new Error("APPLICATION_ENQUEUE_FAILED");
  }

  const applicationId = typeof (row as { application_id?: unknown }).application_id === "string"
    ? (row as { application_id: string }).application_id : null;
  return Object.freeze({ replayed: row.replayed, applicationId });
}

export async function getQueueWorkspace(
  actor: AuthenticatedActor,
): Promise<QueueWorkspaceDTO> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, status, queued_at, updated_at, job_intake_id, job_version_id",
    )
    .is("archived_at", null)
    .order("queued_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error("QUEUE_READ_FAILED");
  }

  const intakeIds = Array.from(
    new Set(data.map((row) => row.job_intake_id).filter(Boolean)),
  ) as string[];
  const versionIds = Array.from(
    new Set(data.map((row) => row.job_version_id).filter(Boolean)),
  ) as string[];
  const applicationIds = data.map((row) => row.id);
  const [intakeResult, versionResult, receiptResult, preparationRunResult, autoApplyResult] = await Promise.all([
    intakeIds.length > 0
      ? supabase
          .from("job_intakes")
          .select("id, canonical_url, status, failure_code")
          .in("id", intakeIds)
      : Promise.resolve({ data: [], error: null }),
    versionIds.length > 0
      ? supabase
          .from("job_versions")
          .select("id, employer_name, title, location_text, apply_url")
          .in("id", versionIds)
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length > 0
      ? supabase
          .from("receipts")
          .select("application_id")
          .in("application_id", applicationIds)
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length > 0
      ? supabase
          .from("application_runs")
          .select("application_id, preparation_stage, created_at, id")
          .eq("run_kind", "PREPARATION")
          .in("application_id", applicationIds)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length > 0
      ? supabase.from("auto_apply_enrollments").select("application_id").in("application_id", applicationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    intakeResult.error || versionResult.error || receiptResult.error ||
    preparationRunResult.error || autoApplyResult.error
  ) {
    throw new Error("QUEUE_READ_FAILED");
  }

  const intakesById = new Map(
    intakeResult.data.map((row) => [row.id, row] as const),
  );
  const versionsById = new Map(
    versionResult.data.map((row) => [row.id, row] as const),
  );
  const applicationIdsWithReceipts = new Set(
    receiptResult.data.map((row) => row.application_id),
  );
  const automaticallySelected = new Set(autoApplyResult.data.map(row => row.application_id));
  const preparationStagesByApplication = new Map<string, ApplicationPreparationStage | null>();
  for (const run of preparationRunResult.data) {
    if (preparationStagesByApplication.has(run.application_id)) continue;
    if (run.preparation_stage !== null && !isApplicationPreparationStage(run.preparation_stage)) {
      throw new Error("QUEUE_PREPARATION_STAGE_INVALID");
    }
    preparationStagesByApplication.set(run.application_id, run.preparation_stage);
  }
  const applications = data.map((row) => {
    if (!isApplicationStatus(row.status)) {
      throw new Error("QUEUE_STATUS_INVALID");
    }

    const intake = row.job_intake_id
      ? intakesById.get(row.job_intake_id)
      : null;
    const version = row.job_version_id
      ? versionsById.get(row.job_version_id)
      : null;

    if (row.job_intake_id && !intake) {
      throw new Error("QUEUE_INTAKE_MISSING");
    }
    if (row.job_version_id && !version) {
      throw new Error("QUEUE_JOB_VERSION_MISSING");
    }
    const intakeStatus: JobIntakeStatus | null = intake
      ? isJobIntakeStatus(intake.status)
        ? intake.status
        : null
      : null;
    if (intake && !intakeStatus) {
      throw new Error("QUEUE_INTAKE_STATUS_INVALID");
    }

    return Object.freeze({
      applicationRouteKey: row.id,
      status: row.status,
      hasReceipt: applicationIdsWithReceipts.has(row.id),
      intakeStatus,
      failureCode: intake?.failure_code ?? null,
      queuedAt: row.queued_at,
      updatedAt: row.updated_at,
      sourceUrl: intake?.canonical_url ?? version?.apply_url ?? null,
      company: version?.employer_name ?? null,
      role: version?.title ?? null,
      location: version?.location_text ?? null,
      preparationStage: preparationStagesByApplication.get(row.id) ?? null,
      autoApplySelected: automaticallySelected.has(row.id),
    });
  });

  return Object.freeze({
    actorLabel: boundedDisplayName(actor, ""),
    applications: Object.freeze(applications),
  });
}

export async function getApplicationWorkspace(
  actor: AuthenticatedActor,
  applicationRouteKey: string,
): Promise<ApplicationWorkspaceDTO | null> {
  if (!UUID_PATTERN.test(applicationRouteKey)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data: candidates, error: candidatesError } = await supabase
    .from("candidates")
    .select("id, application_input_version")
    .eq("auth_user_id", actor.userId)
    .in("status", ["ONBOARDING", "ACTIVE", "PAUSED"]);

  if (candidatesError) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
  }
  const candidateIds = candidates.map((candidate) => candidate.id);
  if (candidateIds.length === 0) {
    return null;
  }

  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select(
      "id, candidate_id, status, aggregate_version, queued_at, updated_at, job_intake_id, job_version_id, current_revision_id",
    )
    .eq("id", applicationRouteKey)
    .in("candidate_id", candidateIds)
    .maybeSingle();

  if (applicationError) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
  }
  if (!application) {
    return null;
  }
  if (!isApplicationStatus(application.status)) {
    throw new Error("APPLICATION_WORKSPACE_STATUS_INVALID");
  }

  const [
    intakeResult,
    versionResult,
    revisionResult,
    artifactsResult,
    runsResult,
    eventsResult,
    receiptResult,
    fillAttemptResult,
  ] = await Promise.all([
    application.job_intake_id
      ? supabase
          .from("job_intakes")
          .select("canonical_url, status, failure_code")
          .eq("id", application.job_intake_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    application.job_version_id
      ? supabase
          .from("job_versions")
          .select(
            "employer_name, title, description_text, location_text, work_mode, employment_type, apply_url, published_at",
          )
          .eq("id", application.job_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    application.current_revision_id
      ? supabase
          .from("application_revisions")
          .select("id, input_snapshot_id, version_number, validation_status, packet_hash, material_diff, created_at")
          .eq("application_id", application.id)
          .eq("id", application.current_revision_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    application.current_revision_id
      ? supabase
          .from("artifact_versions")
          .select("id, kind, variant, display_name, mime_type, byte_size, sha256, qa_status, created_at")
          .eq("application_revision_id", application.current_revision_id)
          .order("variant", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("application_runs")
      .select("run_kind, status, error_code, preparation_stage, input_snapshot_id, created_at, started_at, finished_at")
      .eq("application_id", application.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(25),
    supabase
      .from("domain_events")
      .select("event_type, actor_kind, occurred_at")
      .eq("aggregate_type", "APPLICATION")
      .eq("aggregate_id", application.id)
      .order("aggregate_version", { ascending: false })
      .limit(50),
    supabase
      .from("receipts")
      .select("confirmation_kind, confirmed_at")
      .eq("application_id", application.id)
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("application_fill_attempts")
      .select("id, status, created_at, started_at, completed_at")
      .eq("application_id", application.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (
    intakeResult.error ||
    versionResult.error ||
    revisionResult.error ||
    artifactsResult.error ||
    runsResult.error ||
    eventsResult.error ||
    receiptResult.error ||
    fillAttemptResult.error
  ) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
  }

  const boundInputSnapshotId = latestPreparationSnapshotId(
    runsResult.data.map((run) => ({
      runKind: run.run_kind,
      inputSnapshotId: run.input_snapshot_id,
    })),
  );
  const inputSnapshotResult = boundInputSnapshotId
    ? await supabase
        .from("application_input_snapshots")
        .select("readiness, blockers, candidate_input_version, created_at")
        .eq("id", boundInputSnapshotId)
        .eq("application_id", application.id)
        .maybeSingle()
    : { data: null, error: null };

  if (inputSnapshotResult.error) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
  }
  if (boundInputSnapshotId && !inputSnapshotResult.data) {
    throw new Error("APPLICATION_WORKSPACE_SNAPSHOT_MISSING");
  }

  const freshnessInputSnapshotId = application.status === "NEEDS_USER"
    ? boundInputSnapshotId
    : revisionResult.data?.input_snapshot_id ?? boundInputSnapshotId;
  const freshnessInputSnapshotResult = freshnessInputSnapshotId &&
      freshnessInputSnapshotId !== boundInputSnapshotId
    ? await supabase
        .from("application_input_snapshots")
        .select("candidate_input_version")
        .eq("id", freshnessInputSnapshotId)
        .eq("application_id", application.id)
        .maybeSingle()
    : { data: inputSnapshotResult.data, error: null };

  if (freshnessInputSnapshotResult.error) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
  }
  if (freshnessInputSnapshotId && !freshnessInputSnapshotResult.data) {
    throw new Error("APPLICATION_WORKSPACE_REVISION_SNAPSHOT_MISSING");
  }

  const intake = intakeResult.data;
  if (application.job_intake_id && !intake) {
    throw new Error("APPLICATION_WORKSPACE_INTAKE_MISSING");
  }
  const intakeStatus: JobIntakeStatus | null = intake
    ? isJobIntakeStatus(intake.status)
      ? intake.status
      : null
    : null;
  if (intake && !intakeStatus) {
    throw new Error("APPLICATION_WORKSPACE_INTAKE_STATUS_INVALID");
  }
  const version = versionResult.data;
  const revision = revisionResult.data;
  const candidate = candidates.find((row) => row.id === application.candidate_id);
  const receipt = receiptResult.data;
  const fillAttemptBinding = parseFillAttempt(fillAttemptResult.data);
  const computerSessionResult = fillAttemptBinding
    ? await supabase
        .from("computer_sessions")
        .select("id, execution_mode, state, expires_at")
        .eq("fill_attempt_id", fillAttemptBinding.id)
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (computerSessionResult.error) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
  }
  const fillResumeAttemptResult = fillAttemptBinding
    ? await supabase
        .from("application_fill_resume_attempts")
        .select("status, created_at, completed_at")
        .eq("fill_attempt_id", fillAttemptBinding.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  if (fillResumeAttemptResult.error) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
  }
  const fillAttempt = fillAttemptBinding?.dto ?? null;
  const computerSession = parseComputerSession(computerSessionResult.data);
  const fillResumeAttempt = parseFillResumeAttempt(fillResumeAttemptResult.data);
  const inputSnapshot = inputSnapshotResult.data;
  const inputSnapshotReadiness = inputSnapshot && isApplicationPreparationReadiness(inputSnapshot.readiness)
    ? inputSnapshot.readiness
    : null;
  if (application.job_version_id && !version) {
    throw new Error("APPLICATION_WORKSPACE_JOB_VERSION_MISSING");
  }
  if (application.current_revision_id && !revision) {
    throw new Error("APPLICATION_WORKSPACE_REVISION_MISSING");
  }
  if (!candidate) {
    throw new Error("APPLICATION_WORKSPACE_CANDIDATE_MISSING");
  }
  if (inputSnapshot && !inputSnapshotReadiness) {
    throw new Error("APPLICATION_WORKSPACE_SNAPSHOT_INVALID");
  }

  return Object.freeze({
    applicationRouteKey: application.id,
    aggregateVersion: application.aggregate_version,
    profileChanged: freshnessInputSnapshotResult.data
      ? applicationInputsChanged(
          candidate.application_input_version,
          freshnessInputSnapshotResult.data.candidate_input_version,
        )
      : false,
    status: application.status,
    intakeStatus,
    failureCode: intake?.failure_code ?? null,
    queuedAt: application.queued_at,
    updatedAt: application.updated_at,
    sourceUrl: intake?.canonical_url ?? version?.apply_url ?? null,
    company: version?.employer_name ?? null,
    role: version?.title ?? null,
    location: version?.location_text ?? null,
    workMode: version?.work_mode ?? null,
    employmentType: version?.employment_type ?? null,
    // Older immutable job versions may contain provider-encoded markup in the
    // legacy plain-text column. Normalize again at the display boundary rather
    // than mutating historical source evidence.
    description: htmlToPlainText(version?.description_text ?? null),
    applyUrl: version?.apply_url ?? null,
    publishedAt: version?.published_at ?? null,
    currentRevision: revision
      ? Object.freeze({
          id: revision.id,
          version: revision.version_number,
          validationStatus: revision.validation_status,
          packetHash: revision.packet_hash,
          materialDiff: parseMaterialDiff(revision.material_diff),
          createdAt: revision.created_at,
        })
      : null,
    artifacts: Object.freeze(artifactsResult.data.map((artifact) => Object.freeze({
      id: artifact.id,
      kind: artifact.kind,
      variant: artifact.variant,
      displayName: artifact.display_name,
      mimeType: artifact.mime_type,
      byteSize: artifact.byte_size,
      sha256: artifact.sha256,
      qaStatus: artifact.qa_status,
      createdAt: artifact.created_at,
    }))),
    runs: Object.freeze(runsResult.data.map((run) => Object.freeze({
      kind: run.run_kind,
      status: run.status,
      errorCode: run.error_code,
      createdAt: run.created_at,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      preparationStage: run.preparation_stage === null
        ? null
        : isApplicationPreparationStage(run.preparation_stage)
          ? run.preparation_stage
          : (() => { throw new Error("APPLICATION_WORKSPACE_PREPARATION_STAGE_INVALID"); })(),
    }))),
    events: Object.freeze(eventsResult.data.map((event) => Object.freeze({
      type: event.event_type,
      actorKind: event.actor_kind,
      occurredAt: event.occurred_at,
    }))),
    receipt: receipt
      ? Object.freeze({
          confirmationKind: receipt.confirmation_kind,
          confirmedAt: receipt.confirmed_at,
        })
      : null,
    inputSnapshot: inputSnapshot
      ? Object.freeze({
          readiness: inputSnapshotReadiness!,
          blockers: parseApplicationInputBlockers(inputSnapshot.blockers),
          createdAt: inputSnapshot.created_at,
        })
      : null,
    fillAttempt,
    computerSession,
    fillResumeAttempt,
  });
}
