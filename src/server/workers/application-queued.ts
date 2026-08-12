import type { SupabaseClient } from "@supabase/supabase-js";

import { createHash } from "node:crypto";

import { hashNormalizedJobVersion, hashSourceListingIdentity } from "../ingestion/canonical.ts";
import type { Database, Json } from "../../lib/supabase/database.types.ts";
import type { NormalizedSourceJob } from "../ingestion/contracts.ts";
import { createNativeJobApiFetchPort } from "../ingestion/fetch-port.ts";
import { resolvePublicJobUrl } from "../ingestion/resolve-job.ts";

type IntakeRow = Database["public"]["Tables"]["job_intakes"]["Row"];

type ApplicationQueuedPayload = Readonly<{
  application_id: string;
  job_intake_id: string;
}>;

export type ApplicationQueuedHandlerDependencies = Readonly<{
  resolveJob?: typeof resolvePublicJobUrl;
}>;

function queuedPayload(value: Json): ApplicationQueuedPayload | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const applicationId = value.application_id;
  const intakeId = value.job_intake_id;
  if (typeof applicationId !== "string" || typeof intakeId !== "string") return null;
  return { application_id: applicationId, job_intake_id: intakeId };
}

function employerNameFromJob(job: Readonly<{ canonicalJobUrl: string; tenantKey: string }>): string {
  const tenant = job.tenantKey.replace(/[-_.]+/g, " ").trim();
  return tenant.replace(/\b\w/g, (letter) => letter.toUpperCase()) || new URL(job.canonicalJobUrl).hostname;
}

function deterministicUuid(namespace: string, value: string): string {
  const hex = createHash("sha256").update(`${namespace}\n${value}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function locationText(labels: readonly Readonly<{ label: string }>[]): string | null {
  return labels.map((entry) => entry.label).join(" · ") || null;
}

function persistedWorkMode(
  value: NormalizedSourceJob["workplaceType"],
): "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN" {
  if (value === "ON_SITE") return "ONSITE";
  if (value === "UNSPECIFIED") return "UNKNOWN";
  return value;
}

async function markIntakeResolving(
  supabase: SupabaseClient<Database>,
  applicationId: string,
  jobIntakeId: string,
): Promise<IntakeRow> {
  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("job_intake_id", jobIntakeId)
    .single();
  if (applicationError || !application) throw new Error("OUTBOX_APPLICATION_INTAKE_MISMATCH");

  const { data: existing, error: existingError } = await supabase
    .from("job_intakes")
    .select("*")
    .eq("id", jobIntakeId)
    .single();
  if (existingError || !existing) throw new Error("JOB_INTAKE_READ_FAILED");
  if (existing.status === "RESOLVED" || existing.status === "FAILED") {
    const { data: terminal, error: terminalError } = await supabase.rpc(
      "ack_terminal_pasted_link_intake",
      { p_job_intake_id: jobIntakeId, p_expected_application_id: applicationId },
    );
    if (terminalError || terminal !== true) throw new Error("JOB_INTAKE_TERMINAL_STATE_INVALID");
    return existing;
  }

  const { data, error } = await supabase
    .from("job_intakes")
    .update({ status: "RESOLVING", updated_at: new Date().toISOString() })
    .eq("id", jobIntakeId)
    .in("status", ["PENDING", "RESOLVING"])
    .select("*")
    .single();
  if (error || !data) throw new Error("JOB_INTAKE_CLAIM_FAILED");
  return data;
}

async function persistResolvedJob(
  supabase: SupabaseClient<Database>,
  applicationId: string,
  intake: IntakeRow,
  resolved: Extract<Awaited<ReturnType<typeof resolvePublicJobUrl>>, { kind: "RESOLVED" }>["value"],
): Promise<void> {
  const { job, reference } = resolved;
  const observedAt = job.observedAt;
  const employerName = employerNameFromJob(job);
  const employerId = deterministicUuid("employer", `${reference.provider}:${reference.tenantKey}`);
  const { data: employer, error: employerError } = await supabase
    .from("employers")
    .upsert({ id: employerId, canonical_name: employerName }, { onConflict: "id" })
    .select("id")
    .single();
  if (employerError || !employer) throw new Error("EMPLOYER_WRITE_FAILED");

  const { data: source, error: sourceError } = await supabase
    .from("job_sources")
    .upsert({
      employer_id: employer.id,
      provider: reference.provider,
      tenant_key: reference.tenantKey,
      list_url: null,
      application_domain: new URL(job.applyUrl).hostname,
      policy_status: "REVIEW",
      polling_enabled: false,
      adapter_release: "direct-public-api/0.1",
      updated_at: observedAt,
    }, { onConflict: "provider,tenant_key" })
    .select("id")
    .single();
  if (sourceError || !source) throw new Error("JOB_SOURCE_WRITE_FAILED");

  const { data: listing, error: listingError } = await supabase
    .from("source_job_listings")
    .upsert({
      source_id: source.id,
      external_job_id: job.externalJobId,
      source_url: job.canonicalJobUrl,
      apply_url: job.applyUrl,
      state: job.listed ? "OPEN" : "CLOSED",
      first_seen_at: observedAt,
      last_seen_at: observedAt,
      updated_at: observedAt,
    }, { onConflict: "source_id,external_job_id" })
    .select("id")
    .single();
  if (listingError || !listing) throw new Error("JOB_LISTING_WRITE_FAILED");

  const { data: catalogJob, error: jobError } = await supabase
    .from("jobs")
    .insert({
      employer_id: employer.id,
      source_listing_id: listing.id,
      canonical_url: job.canonicalJobUrl,
      state: job.listed ? "OPEN" : "CLOSED",
      first_seen_at: observedAt,
      last_seen_at: observedAt,
      created_at: observedAt,
      updated_at: observedAt,
    })
    .select("id, current_version_id")
    .maybeSingle();
  if (jobError?.code === "23505") {
    const { data: existingJob, error: existingJobError } = await supabase
      .from("jobs")
      .select("id, current_version_id, source_listing_id")
      .eq("canonical_url", job.canonicalJobUrl)
      .single();
    if (
      existingJobError ||
      !existingJob ||
      existingJob.source_listing_id !== listing.id
    ) {
      throw new Error("JOB_IDENTITY_CONFLICT");
    }
    return persistResolvedJobVersion(
      supabase,
      applicationId,
      intake,
      resolved,
      existingJob,
      observedAt,
      employerName,
    );
  }
  if (jobError || !catalogJob) throw new Error("JOB_WRITE_FAILED");

  return persistResolvedJobVersion(
    supabase,
    applicationId,
    intake,
    resolved,
    catalogJob,
    observedAt,
    employerName,
  );
}

async function persistResolvedJobVersion(
  supabase: SupabaseClient<Database>,
  applicationId: string,
  intake: IntakeRow,
  resolved: Extract<Awaited<ReturnType<typeof resolvePublicJobUrl>>, { kind: "RESOLVED" }>["value"],
  catalogJob: Readonly<{ id: string; current_version_id: string | null }>,
  observedAt: string,
  employerName: string,
): Promise<void> {
  const { job } = resolved;

  const contentHash = hashNormalizedJobVersion(job);
  const { data: currentVersion, error: existingVersionError } = await supabase
    .from("job_versions")
    .select("id, version_number")
    .eq("job_id", catalogJob.id)
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (existingVersionError) throw new Error("JOB_VERSION_READ_FAILED");

  let jobVersionId = currentVersion?.id ?? null;
  if (!jobVersionId) {
    const { data: latestVersion, error: latestError } = await supabase
      .from("job_versions")
      .select("version_number")
      .eq("job_id", catalogJob.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new Error("JOB_VERSION_READ_FAILED");
    const { data: insertedVersion, error: versionError } = await supabase
      .from("job_versions")
      .insert({
        job_id: catalogJob.id,
        version_number: (latestVersion?.version_number ?? 0) + 1,
        content_hash: contentHash,
        title: job.title,
        employer_name: employerName,
        description_text: job.descriptionText ?? "Description unavailable from the official feed.",
        location_text: locationText(job.locations),
        work_mode: persistedWorkMode(job.workplaceType),
        employment_type: job.employmentType,
        apply_url: job.applyUrl,
        published_at: job.sourcePostedAt,
        observed_at: observedAt,
        normalized_data: {
          schema_version: 1,
          provider: job.provider,
          tenant_key: job.tenantKey,
          external_job_id: job.externalJobId,
          source_hash: resolved.rawSha256,
          listing_identity_hash: hashSourceListingIdentity(job),
          job,
        } as unknown as Json,
      })
      .select("id")
      .single();
    if (versionError || !insertedVersion) throw new Error("JOB_VERSION_WRITE_FAILED");
    jobVersionId = insertedVersion.id;
  }

  const { error: currentError } = await supabase
    .from("jobs")
    .update({ current_version_id: jobVersionId, updated_at: observedAt })
    .eq("id", catalogJob.id);
  if (currentError) throw new Error("JOB_CURRENT_VERSION_WRITE_FAILED");

  const { error: resolveError } = await supabase.rpc("resolve_pasted_link_intake", {
    p_job_intake_id: intake.id,
    p_expected_application_id: applicationId,
    p_job_id: catalogJob.id,
    p_job_version_id: jobVersionId,
    p_expected_intake_updated_at: intake.updated_at,
  });
  if (resolveError) throw new Error("JOB_INTAKE_RESOLUTION_COMMIT_FAILED");
}

export async function handleApplicationQueued(
  supabase: SupabaseClient<Database>,
  rawPayload: Json,
  dependencies: ApplicationQueuedHandlerDependencies = {},
): Promise<void> {
  const payload = queuedPayload(rawPayload);
  if (!payload) throw new Error("OUTBOX_PAYLOAD_INVALID");
  const intake = await markIntakeResolving(supabase, payload.application_id, payload.job_intake_id);
  if (intake.status === "RESOLVED" || intake.status === "FAILED") return;
  const result = await (dependencies.resolveJob ?? resolvePublicJobUrl)(
    intake.canonical_url,
    createNativeJobApiFetchPort(),
  );

  if (result.kind === "FAILED" && result.retryable) {
    throw new Error(`JOB_RESOLUTION_RETRYABLE_${result.code}`);
  }

  if (result.kind !== "RESOLVED") {
    const { error } = await supabase.rpc("fail_pasted_link_intake", {
      p_job_intake_id: intake.id,
      p_expected_application_id: payload.application_id,
      p_failure_code: result.code,
      p_expected_intake_updated_at: intake.updated_at,
    });
    if (error) throw new Error("JOB_INTAKE_FAILURE_COMMIT_FAILED");
    return;
  }

  await persistResolvedJob(supabase, payload.application_id, intake, result.value);
}
