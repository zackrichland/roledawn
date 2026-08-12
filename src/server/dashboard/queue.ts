import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isApplicationStatus,
  isJobIntakeStatus,
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
}>;

export type ApplicationRunDTO = Readonly<{
  kind: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}>;

export type ApplicationRevisionDTO = Readonly<{
  version: number;
  validationStatus: string;
  createdAt: string;
}>;

export type ApplicationEventDTO = Readonly<{
  type: string;
  actorKind: string;
  occurredAt: string;
}>;

export type ApplicationArtifactDTO = Readonly<{
  kind: string;
  qaStatus: string;
  createdAt: string;
}>;

export type ApplicationReceiptDTO = Readonly<{
  confirmationKind: string;
  confirmedAt: string;
}>;

export type ApplicationWorkspaceDTO = Readonly<{
  applicationRouteKey: string;
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
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
): Promise<void> {
  const { data, error } = await supabase.rpc("bootstrap_personal_workspace", {
    p_display_name: boundedDisplayName(actor, proposedDisplayName),
  });

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error("WORKSPACE_BOOTSTRAP_UNAVAILABLE");
    }

    throw new Error("WORKSPACE_BOOTSTRAP_FAILED");
  }

  if (!firstRow(data)) {
    throw new Error("WORKSPACE_BOOTSTRAP_FAILED");
  }
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

  return Object.freeze({ replayed: row.replayed });
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
  const [intakeResult, versionResult, receiptResult] = await Promise.all([
    intakeIds.length > 0
      ? supabase
          .from("job_intakes")
          .select("id, canonical_url, status, failure_code")
          .in("id", intakeIds)
      : Promise.resolve({ data: [], error: null }),
    versionIds.length > 0
      ? supabase
          .from("job_versions")
          .select("id, employer_name, title, location_text")
          .in("id", versionIds)
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length > 0
      ? supabase
          .from("receipts")
          .select("application_id")
          .in("application_id", applicationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (intakeResult.error || versionResult.error || receiptResult.error) {
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
      sourceUrl: intake?.canonical_url ?? null,
      company: version?.employer_name ?? null,
      role: version?.title ?? null,
      location: version?.location_text ?? null,
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
    .select("id")
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
      "id, status, queued_at, updated_at, job_intake_id, job_version_id, current_revision_id",
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
          .select("version_number, validation_status, created_at")
          .eq("application_id", application.id)
          .eq("id", application.current_revision_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    application.current_revision_id
      ? supabase
          .from("artifact_versions")
          .select("kind, qa_status, created_at")
          .eq("application_revision_id", application.current_revision_id)
          .order("kind", { ascending: true })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("application_runs")
      .select("run_kind, status, error_code, created_at, started_at, finished_at")
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
  ]);

  if (
    intakeResult.error ||
    versionResult.error ||
    revisionResult.error ||
    artifactsResult.error ||
    runsResult.error ||
    eventsResult.error ||
    receiptResult.error
  ) {
    throw new Error("APPLICATION_WORKSPACE_READ_FAILED");
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
  const receipt = receiptResult.data;
  if (application.job_version_id && !version) {
    throw new Error("APPLICATION_WORKSPACE_JOB_VERSION_MISSING");
  }
  if (application.current_revision_id && !revision) {
    throw new Error("APPLICATION_WORKSPACE_REVISION_MISSING");
  }

  return Object.freeze({
    applicationRouteKey: application.id,
    status: application.status,
    intakeStatus,
    failureCode: intake?.failure_code ?? null,
    queuedAt: application.queued_at,
    updatedAt: application.updated_at,
    sourceUrl: intake?.canonical_url ?? null,
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
          version: revision.version_number,
          validationStatus: revision.validation_status,
          createdAt: revision.created_at,
        })
      : null,
    artifacts: Object.freeze(artifactsResult.data.map((artifact) => Object.freeze({
      kind: artifact.kind,
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
  });
}
