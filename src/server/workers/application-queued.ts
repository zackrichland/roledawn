import type { SupabaseClient } from "@supabase/supabase-js";

import { createHash } from "node:crypto";

import { hashNormalizedJobVersion, hashSourceListingIdentity } from "../ingestion/canonical.ts";
import type { Database, Json } from "../../lib/supabase/database.types.ts";
import type { NormalizedSourceJob, ResolvedPublicJob } from "../ingestion/contracts.ts";
import { createNativeJobApiFetchPort } from "../ingestion/fetch-port.ts";
import { resolvePublicJobUrl } from "../ingestion/resolve-job.ts";

type IntakeRow = Database["public"]["Tables"]["job_intakes"]["Row"];

type ApplicationQueuedPayload = Readonly<{
  application_id: string;
  job_intake_id: string;
}>;

export type ApplicationQueuedHandlerDependencies = Readonly<{
  resolveJob?: typeof resolvePublicJobUrl;
  /**
   * The outbox's last attempt. A still-retryable fetch failure is then recorded
   * on the intake ("Couldn't read job", with Try again) instead of being
   * dead-lettered silently, which left Home on "Reading the job" (D-149).
   */
  finalAttempt?: boolean;
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
  // A reviewed catalog board may already own this provider/tenant. A pasted
  // link must reuse it, never rename its employer or rewrite its polling
  // configuration.
  const { data: existingSource, error: existingSourceError } = await supabase
    .from("job_sources")
    .select("id, employer_id")
    .eq("provider", reference.provider)
    .eq("tenant_key", reference.tenantKey)
    .maybeSingle();
  if (existingSourceError) throw new Error("JOB_SOURCE_READ_FAILED");
  let source: Readonly<{ id: string }>;
  let employer: Readonly<{ id: string }>;
  let employerName = employerNameFromJob(job);
  if (existingSource?.id && existingSource.employer_id) {
    source = { id: existingSource.id };
    employer = { id: existingSource.employer_id };
    const { data: employerRow } = await supabase
      .from("employers")
      .select("canonical_name")
      .eq("id", existingSource.employer_id)
      .maybeSingle();
    if (typeof employerRow?.canonical_name === "string" && employerRow.canonical_name.trim()) {
      employerName = employerRow.canonical_name.trim();
    }
  } else {
    const employerId = deterministicUuid("employer", `${reference.provider}:${reference.tenantKey}`);
    const { data: createdEmployer, error: employerError } = await supabase
      .from("employers")
      .upsert({ id: employerId, canonical_name: employerName }, { onConflict: "id" })
      .select("id")
      .single();
    if (employerError || !createdEmployer) throw new Error("EMPLOYER_WRITE_FAILED");
    employer = createdEmployer;
    const { data: createdSource, error: sourceError } = await supabase
      .from("job_sources")
      .upsert({
        employer_id: employer.id,
        provider: reference.provider,
        tenant_key: reference.tenantKey,
        list_url: null,
        application_domain: new URL(job.applyUrl).hostname,
        adapter_release: "direct-public-api/0.1",
        updated_at: observedAt,
      }, { onConflict: "provider,tenant_key" })
      .select("id")
      .single();
    if (sourceError || !createdSource) throw new Error("JOB_SOURCE_WRITE_FAILED");
    source = createdSource;
  }

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

  await persistResolvedApplicationSchema(
    supabase,
    catalogJob.id,
    jobVersionId,
    resolved,
    observedAt,
  );

  const { error: currentError } = await supabase
    .from("jobs")
    .update({
      current_version_id: jobVersionId,
      state: job.listed ? "OPEN" : "CLOSED",
      last_seen_at: observedAt,
      closed_at: job.listed ? null : observedAt,
      updated_at: observedAt,
    })
    .eq("id", catalogJob.id);
  if (currentError) throw new Error("JOB_CURRENT_VERSION_WRITE_FAILED");

  // The same job reached through another link (boards. vs job-boards., or a
  // Jobs match) already has this candidate's application: one per job,
  // archived included. Say so on this intake instead of retrying the
  // uniqueness conflict until it is dead-lettered on "Reading the job" (D-149).
  const { data: duplicates, error: duplicateError } = await supabase
    .from("applications")
    .select("id")
    .eq("candidate_id", intake.candidate_id)
    .eq("job_id", catalogJob.id)
    .neq("id", applicationId)
    .limit(1);
  if (duplicateError) throw new Error("JOB_DUPLICATE_CHECK_FAILED");
  if (Array.isArray(duplicates) && duplicates.length > 0) {
    const { error: duplicateFailure } = await supabase.rpc("fail_pasted_link_intake", {
      p_job_intake_id: intake.id,
      p_expected_application_id: applicationId,
      p_failure_code: "DUPLICATE_APPLICATION",
      p_expected_intake_updated_at: intake.updated_at,
    });
    if (duplicateFailure) throw new Error("JOB_INTAKE_FAILURE_COMMIT_FAILED");
    return;
  }

  const { error: resolveError } = await supabase.rpc("resolve_pasted_link_intake", {
    p_job_intake_id: intake.id,
    p_expected_application_id: applicationId,
    p_job_id: catalogJob.id,
    p_job_version_id: jobVersionId,
    p_expected_intake_updated_at: intake.updated_at,
  });
  if (resolveError) throw new Error("JOB_INTAKE_RESOLUTION_COMMIT_FAILED");
}

async function persistResolvedApplicationSchema(
  supabase: SupabaseClient<Database>,
  jobId: string,
  jobVersionId: string,
  resolved: ResolvedPublicJob,
  observedAt: string,
): Promise<void> {
  const schema = resolved.applicationSchema;
  if (!schema) return;

  const { data, error } = await supabase
    .from("job_application_schema_versions")
    .upsert({
      job_id: jobId,
      job_version_id: jobVersionId,
      provider: schema.provider,
      adapter_release: schema.adapterRelease,
      schema_hash: schema.schemaHash,
      normalized_schema: schema.normalizedSchema as unknown as Json,
      provider_binding: schema.providerBinding as unknown as Json,
      observed_at: observedAt,
    }, {
      onConflict: "job_version_id,schema_hash",
      ignoreDuplicates: true,
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error("JOB_APPLICATION_SCHEMA_WRITE_FAILED");
  void data;
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

  if (result.kind === "FAILED" && result.retryable && !dependencies.finalAttempt) {
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
