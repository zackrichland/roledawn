import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";
import {
  AcceptanceFailure,
  assertRemoteOk,
  firstRpcRow,
} from "./milestone-zero-acceptance-lib.ts";
import {
  assertOpportunityCatalogAcceptanceEmail,
  cleanupOpportunityCatalogAcceptance,
  createOpportunityCatalogAcceptancePassword,
  createOpportunityCatalogCleanupRecord,
  createOpportunityCatalogClient,
  opportunityCatalogAcceptanceEmail,
  opportunityCatalogWorkspaceName,
  requireOpportunityCatalogAcceptanceConfig,
  safeOpportunityCatalogErrorCode,
  type OpportunityCatalogAcceptanceConfig,
  type OpportunityCatalogCleanupIdentity,
  type OpportunityCatalogCleanupRecord,
  type OpportunityCatalogLabel,
} from "./opportunity-catalog-acceptance-lib.ts";

type SearchRow =
  Database["public"]["Functions"]["search_catalog_jobs"]["Returns"][number];
type SaveRow =
  Database["public"]["Functions"]["set_catalog_job_saved"]["Returns"][number];
type QueueRow =
  Database["public"]["Functions"]["enqueue_catalog_job_application"]["Returns"][number];

type OpportunityCandidate = OpportunityCatalogCleanupIdentity &
  Readonly<{ client: SupabaseClient<Database> }>;

type CatalogTarget = Readonly<{
  jobId: string;
  jobVersionId: string;
  sourceListingId: string;
  canonicalUrl: string;
  employerName: string;
  title: string;
  locationText: string;
  workMode: string;
  employmentType: string;
}>;

type CatalogFixture = Readonly<{
  sourceId: string;
  provider: string;
  tenantKey: string;
  primary: CatalogTarget;
  secondary: CatalogTarget;
  beforeSnapshot: Readonly<{
    source: unknown;
    listings: unknown;
    jobs: unknown;
    versions: unknown;
  }>;
}>;

type AcceptanceCheck = Readonly<{
  name: string;
  status: "PASS";
  detail: string;
}>;

const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");
const STAGE_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 90_000;
const SAFE_SEARCH_FIELDS = Object.freeze([
  "apply_url",
  "canonical_url",
  "description_text",
  "employer_name",
  "employment_type",
  "job_id",
  "job_version_id",
  "location_text",
  "observed_at",
  "published_at",
  "queued_application_id",
  "saved",
  "source_provider",
  "title",
  "work_mode",
] as const);
const REQUIRED_CHECKPOINTS = Object.freeze([
  "anonymous-denial",
  "allowlisted-catalog-fixture",
  "two-real-candidates",
  "safe-search-contract",
  "filter-behavior",
  "save-replay-remove",
  "stale-version-denial",
  "queue-replay",
  "no-submission-authority",
  "auth-isolation",
  "direct-table-denial",
  "catalog-unchanged",
] as const);

function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  failureCode: string,
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new AcceptanceFailure(failureCode));
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

async function runStage<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  process.stdout.write(`START ${name}\n`);
  return withDeadline(operation(), STAGE_TIMEOUT_MS, `STAGE_TIMEOUT:${name}`);
}

function report(
  checks: AcceptanceCheck[],
  name: (typeof REQUIRED_CHECKPOINTS)[number],
  detail: string,
): void {
  if (checks.some((check) => check.name === name)) {
    throw new AcceptanceFailure(`DUPLICATE_CHECKPOINT:${name}`);
  }
  checks.push({ name, status: "PASS", detail });
  process.stdout.write(`PASS ${name} — ${detail}\n`);
}

function remoteErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { message?: unknown; details?: unknown };
  return [candidate.message, candidate.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function assertExpectedError(
  error: unknown,
  expectedCode: string,
  expectedMessage: string | null,
  failureCode: string,
): void {
  if (!error) {
    throw new AcceptanceFailure(`${failureCode}:MUTATION_UNEXPECTEDLY_SUCCEEDED`);
  }
  if (safeOpportunityCatalogErrorCode(error) !== expectedCode) {
    throw new AcceptanceFailure(
      `${failureCode}:UNEXPECTED_CODE_${safeOpportunityCatalogErrorCode(error)}`,
    );
  }
  if (expectedMessage && !remoteErrorText(error).includes(expectedMessage)) {
    throw new AcceptanceFailure(`${failureCode}:DOMAIN_ERROR_MISSING`);
  }
}

async function preserveCleanupRecord(
  record: OpportunityCatalogCleanupRecord,
): Promise<string> {
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
  const target = resolve(
    ARTIFACT_DIRECTORY,
    `opportunity-${record.runId}-cleanup.json`,
  );
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return target;
}

async function createCandidate(
  config: OpportunityCatalogAcceptanceConfig,
  label: OpportunityCatalogLabel,
): Promise<OpportunityCandidate> {
  const admin = createOpportunityCatalogClient(config, config.secretKey);
  const email = opportunityCatalogAcceptanceEmail(config.runId, label);
  const password = createOpportunityCatalogAcceptancePassword();
  const displayName = opportunityCatalogWorkspaceName(config.runId, label);
  const workspaceName = `${displayName} workspace`;
  assertOpportunityCatalogAcceptanceEmail(email);
  let userId: string | null = null;
  let workspaceId: string | null = null;

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        acceptance_run_id: config.runId,
      },
      app_metadata: {
        roledawn_acceptance_run_id: config.runId,
        roledawn_acceptance_kind: "opportunity-catalog",
      },
    });
    if (created.error || !created.data.user) {
      throw new AcceptanceFailure(
        `AUTH_USER_CREATE_FAILED_${label}:${safeOpportunityCatalogErrorCode(created.error)}`,
      );
    }
    userId = created.data.user.id;

    const client = createOpportunityCatalogClient(config, config.publishableKey);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (
      signedIn.error ||
      !signedIn.data.user ||
      !signedIn.data.session ||
      signedIn.data.user.id !== userId
    ) {
      throw new AcceptanceFailure(
        `AUTH_PASSWORD_SESSION_FAILED_${label}:${safeOpportunityCatalogErrorCode(signedIn.error)}`,
      );
    }

    const bootstrapped = await client.rpc("bootstrap_personal_workspace", {
      p_display_name: displayName,
    });
    assertRemoteOk(bootstrapped.error, `BOOTSTRAP_FAILED_${label}`);
    const bootstrap = firstRpcRow(bootstrapped.data);
    if (!bootstrap || bootstrap.replayed) {
      throw new AcceptanceFailure(`BOOTSTRAP_FIRST_CALL_INVALID_${label}`);
    }
    workspaceId = bootstrap.workspace_id;

    const [workspace, candidate] = await Promise.all([
      client
        .from("workspaces")
        .select("id, name, kind, personal_owner_auth_user_id")
        .eq("id", bootstrap.workspace_id)
        .single(),
      client
        .from("candidates")
        .select(
          "id, workspace_id, auth_user_id, status, submission_mode",
        )
        .eq("id", bootstrap.candidate_id)
        .single(),
    ]);
    assertRemoteOk(workspace.error, `WORKSPACE_SELF_READ_FAILED_${label}`);
    assertRemoteOk(candidate.error, `CANDIDATE_SELF_READ_FAILED_${label}`);
    if (
      workspace.data.name !== workspaceName ||
      workspace.data.kind !== "PERSONAL" ||
      workspace.data.personal_owner_auth_user_id !== userId ||
      candidate.data.workspace_id !== bootstrap.workspace_id ||
      candidate.data.auth_user_id !== userId ||
      candidate.data.submission_mode !== "PER_APPLICATION_APPROVAL"
    ) {
      throw new AcceptanceFailure(`BOOTSTRAP_TENANCY_INVALID_${label}`);
    }

    return Object.freeze({
      label,
      userId,
      email,
      workspaceId: bootstrap.workspace_id,
      candidateId: bootstrap.candidate_id,
      workspaceName,
      client,
    });
  } catch (error) {
    if (userId) {
      if (workspaceId) {
        await admin
          .from("workspaces")
          .delete()
          .eq("id", workspaceId)
          .eq("personal_owner_auth_user_id", userId)
          .eq("name", workspaceName);
      }
      await admin.auth.admin.deleteUser(userId, false);
    }
    throw error;
  }
}

async function loadCatalogFixture(
  config: OpportunityCatalogAcceptanceConfig,
): Promise<CatalogFixture> {
  const admin = createOpportunityCatalogClient(config, config.secretKey);
  const sourceResult = await admin
    .from("job_sources")
    .select(
      "id, provider, tenant_key, policy_status, polling_enabled, updated_at",
    )
    .eq("provider", "GREENHOUSE")
    .eq("tenant_key", config.sourceTenant)
    .eq("policy_status", "ALLOWLISTED")
    .maybeSingle();
  assertRemoteOk(sourceResult.error, "ALLOWLISTED_SOURCE_LOOKUP_FAILED");
  const source = sourceResult.data;
  if (!source) {
    throw new AcceptanceFailure("ALLOWLISTED_SOURCE_NOT_FOUND");
  }

  const listingsResult = await admin
    .from("source_job_listings")
    .select(
      "id, source_id, external_job_id, source_url, apply_url, state, first_seen_at, last_seen_at, closed_at, updated_at",
    )
    .eq("source_id", source.id)
    .eq("state", "OPEN")
    .order("last_seen_at", { ascending: false })
    .limit(200);
  assertRemoteOk(listingsResult.error, "OPEN_LISTINGS_LOOKUP_FAILED");
  if ((listingsResult.data ?? []).length < 2) {
    throw new AcceptanceFailure("TWO_OPEN_ALLOWLISTED_JOBS_REQUIRED");
  }
  const listings = listingsResult.data ?? [];

  const jobsResult = await admin
    .from("jobs")
    .select(
      "id, employer_id, source_listing_id, canonical_url, state, current_version_id, first_seen_at, last_seen_at, closed_at, updated_at",
    )
    .in(
      "source_listing_id",
      listings.map((listing) => listing.id),
    )
    .eq("state", "OPEN")
    .not("current_version_id", "is", null)
    .order("last_seen_at", { ascending: false });
  assertRemoteOk(jobsResult.error, "OPEN_JOBS_LOOKUP_FAILED");
  const jobs = (jobsResult.data ?? []).filter(
    (job): job is typeof job & { current_version_id: string; source_listing_id: string } =>
      Boolean(job.current_version_id && job.source_listing_id),
  );
  if (jobs.length < 2) {
    throw new AcceptanceFailure("TWO_VERSIONED_ALLOWLISTED_JOBS_REQUIRED");
  }

  const versionsResult = await admin
    .from("job_versions")
    .select(
      "id, job_id, version_number, content_hash, title, employer_name, description_text, location_text, work_mode, employment_type, apply_url, published_at, observed_at, normalized_data, created_at",
    )
    .in(
      "id",
      jobs.map((job) => job.current_version_id),
    );
  assertRemoteOk(versionsResult.error, "CURRENT_VERSIONS_LOOKUP_FAILED");
  const versionById = new Map(
    (versionsResult.data ?? []).map((version) => [version.id, version]),
  );
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const candidates = jobs.flatMap((job): CatalogTarget[] => {
    const version = versionById.get(job.current_version_id);
    const listing = listingById.get(job.source_listing_id);
    if (!version || !listing) return [];
    return [
      Object.freeze({
        jobId: job.id,
        jobVersionId: version.id,
        sourceListingId: listing.id,
        canonicalUrl: job.canonical_url,
        employerName: version.employer_name,
        title: version.title,
        locationText: version.location_text?.trim() || "",
        workMode: version.work_mode?.trim().toUpperCase() || "UNKNOWN",
        employmentType:
          version.employment_type?.trim().toUpperCase() || "UNSPECIFIED",
      }),
    ];
  });
  const primary =
    candidates.find(
      (candidate) =>
        candidate.locationText &&
        candidate.workMode &&
        candidate.employmentType,
    ) ?? candidates[0];
  const secondary = candidates.find(
    (candidate) => candidate.jobId !== primary?.jobId,
  );
  if (!primary || !secondary) {
    throw new AcceptanceFailure("TWO_DISTINCT_CATALOG_TARGETS_REQUIRED");
  }

  const selectedListingIds = [primary.sourceListingId, secondary.sourceListingId];
  const selectedJobIds = [primary.jobId, secondary.jobId];
  const selectedVersionIds = [primary.jobVersionId, secondary.jobVersionId];
  return Object.freeze({
    sourceId: source.id,
    provider: source.provider,
    tenantKey: source.tenant_key,
    primary,
    secondary,
    beforeSnapshot: Object.freeze({
      source,
      listings: listings
        .filter((listing) => selectedListingIds.includes(listing.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
      jobs: jobsResult.data
        .filter((job) => selectedJobIds.includes(job.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
      versions: (versionsResult.data ?? [])
        .filter((version) => selectedVersionIds.includes(version.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }),
  });
}

function createSearchQuery(title: string): string {
  const words = title.match(/[\p{L}\p{N}]+/gu) ?? [];
  let query = "";
  for (const word of words) {
    const next = query ? `${query} ${word}` : word;
    if (next.length > 108) break;
    query = next;
  }
  if (!query) throw new AcceptanceFailure("CATALOG_TITLE_NOT_SEARCHABLE");
  return `"${query}"`;
}

function locationNeedle(location: string): string {
  const first = location.split(" · ")[0]?.trim() ?? "";
  return first.slice(0, 120).trim();
}

async function searchCatalog(
  candidate: OpportunityCandidate,
  args: Database["public"]["Functions"]["search_catalog_jobs"]["Args"],
  failureCode: string,
): Promise<SearchRow[]> {
  const searched = await candidate.client.rpc("search_catalog_jobs", args);
  assertRemoteOk(searched.error, failureCode);
  return searched.data ?? [];
}

function assertSafeSearchContract(rows: readonly SearchRow[]): void {
  if (rows.length === 0) {
    throw new AcceptanceFailure("SAFE_SEARCH_RETURNED_NO_ROWS");
  }
  const expected = [...SAFE_SEARCH_FIELDS].sort();
  for (const row of rows) {
    const actual = Object.keys(row).sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new AcceptanceFailure("CATALOG_SEARCH_FIELD_CONTRACT_DRIFTED");
    }
    if (
      !row.job_id ||
      !row.job_version_id ||
      !row.title?.trim() ||
      !row.employer_name?.trim() ||
      !row.canonical_url?.startsWith("https://") ||
      !row.apply_url?.startsWith("https://") ||
      !row.source_provider?.trim()
    ) {
      throw new AcceptanceFailure("CATALOG_SEARCH_ROW_INVALID");
    }
  }
}

async function saveCatalogJob(
  candidate: OpportunityCandidate,
  args: Database["public"]["Functions"]["set_catalog_job_saved"]["Args"],
  failureCode: string,
): Promise<SaveRow> {
  const result = await candidate.client.rpc("set_catalog_job_saved", args);
  assertRemoteOk(result.error, failureCode);
  const row = firstRpcRow(result.data);
  if (!row) throw new AcceptanceFailure(`${failureCode}:ROW_MISSING`);
  return row;
}

async function queueCatalogJob(
  candidate: OpportunityCandidate,
  args: Database["public"]["Functions"]["enqueue_catalog_job_application"]["Args"],
  failureCode: string,
): Promise<QueueRow> {
  const result = await candidate.client.rpc(
    "enqueue_catalog_job_application",
    args,
  );
  assertRemoteOk(result.error, failureCode);
  const row = firstRpcRow(result.data);
  if (!row) throw new AcceptanceFailure(`${failureCode}:ROW_MISSING`);
  return row;
}

async function verifyAnonymousDenied(
  config: OpportunityCatalogAcceptanceConfig,
  fixture: CatalogFixture,
): Promise<void> {
  const anonymous = createOpportunityCatalogClient(config, config.publishableKey);
  const search = await anonymous.rpc("search_catalog_jobs", { p_limit: 1 });
  if (!search.error) {
    throw new AcceptanceFailure("ANONYMOUS_CATALOG_SEARCH_NOT_DENIED");
  }
  const save = await anonymous.rpc("set_catalog_job_saved", {
    p_command_id: randomUUID(),
    p_job_id: fixture.primary.jobId,
    p_job_version_id: fixture.primary.jobVersionId,
    p_saved: true,
  });
  if (!save.error) {
    throw new AcceptanceFailure("ANONYMOUS_CATALOG_SAVE_NOT_DENIED");
  }
}

async function verifyDirectWritesDenied(
  alpha: OpportunityCandidate,
  fixture: CatalogFixture,
  applicationId: string,
): Promise<void> {
  const insertedDecision = await alpha.client
    .from("candidate_job_decisions")
    .insert({
      workspace_id: alpha.workspaceId,
      candidate_id: alpha.candidateId,
      job_id: fixture.secondary.jobId,
      job_version_id: fixture.secondary.jobVersionId,
      decision: "SAVED",
      command_id: randomUUID(),
    });
  assertExpectedError(
    insertedDecision.error,
    "42501",
    null,
    "AUTH_DIRECT_DECISION_INSERT_NOT_DENIED",
  );

  const insertedApplication = await alpha.client.from("applications").insert({
    workspace_id: alpha.workspaceId,
    candidate_id: alpha.candidateId,
    job_id: fixture.secondary.jobId,
    job_version_id: fixture.secondary.jobVersionId,
    status: "AUTHORIZED",
  });
  assertExpectedError(
    insertedApplication.error,
    "42501",
    null,
    "AUTH_DIRECT_APPLICATION_INSERT_NOT_DENIED",
  );

  const updatedApplication = await alpha.client
    .from("applications")
    .update({ status: "AUTHORIZED" })
    .eq("id", applicationId);
  assertExpectedError(
    updatedApplication.error,
    "42501",
    null,
    "AUTH_DIRECT_APPLICATION_UPDATE_NOT_DENIED",
  );

  const deletedApplication = await alpha.client
    .from("applications")
    .delete()
    .eq("id", applicationId);
  assertExpectedError(
    deletedApplication.error,
    "42501",
    null,
    "AUTH_DIRECT_APPLICATION_DELETE_NOT_DENIED",
  );

  const unsafeVersionRead = await alpha.client
    .from("job_versions")
    .select("id, normalized_data, content_hash")
    .eq("id", fixture.primary.jobVersionId);
  assertExpectedError(
    unsafeVersionRead.error,
    "42501",
    null,
    "AUTH_RAW_VERSION_COLUMNS_NOT_DENIED",
  );
}

async function verifyCatalogUnchanged(
  config: OpportunityCatalogAcceptanceConfig,
  fixture: CatalogFixture,
): Promise<void> {
  const admin = createOpportunityCatalogClient(config, config.secretKey);
  const selectedListingIds = [
    fixture.primary.sourceListingId,
    fixture.secondary.sourceListingId,
  ];
  const selectedJobIds = [fixture.primary.jobId, fixture.secondary.jobId];
  const selectedVersionIds = [
    fixture.primary.jobVersionId,
    fixture.secondary.jobVersionId,
  ];
  const [source, listings, jobs, versions] = await Promise.all([
    admin
      .from("job_sources")
      .select(
        "id, provider, tenant_key, policy_status, polling_enabled, updated_at",
      )
      .eq("id", fixture.sourceId)
      .single(),
    admin
      .from("source_job_listings")
      .select(
        "id, source_id, external_job_id, source_url, apply_url, state, first_seen_at, last_seen_at, closed_at, updated_at",
      )
      .in("id", selectedListingIds)
      .order("id", { ascending: true }),
    admin
      .from("jobs")
      .select(
        "id, employer_id, source_listing_id, canonical_url, state, current_version_id, first_seen_at, last_seen_at, closed_at, updated_at",
      )
      .in("id", selectedJobIds)
      .order("id", { ascending: true }),
    admin
      .from("job_versions")
      .select(
        "id, job_id, version_number, content_hash, title, employer_name, description_text, location_text, work_mode, employment_type, apply_url, published_at, observed_at, normalized_data, created_at",
      )
      .in("id", selectedVersionIds)
      .order("id", { ascending: true }),
  ]);
  for (const result of [source, listings, jobs, versions]) {
    assertRemoteOk(result.error, "CATALOG_UNCHANGED_READ_FAILED");
  }
  const afterSnapshot = {
    source: source.data,
    listings: listings.data,
    jobs: jobs.data,
    versions: versions.data,
  };
  if (
    JSON.stringify(afterSnapshot) !== JSON.stringify(fixture.beforeSnapshot)
  ) {
    throw new AcceptanceFailure("SHARED_CATALOG_MUTATED");
  }
}

async function main(): Promise<void> {
  const config = requireOpportunityCatalogAcceptanceConfig();
  const checks: AcceptanceCheck[] = [];
  const candidates: OpportunityCandidate[] = [];
  let record: OpportunityCatalogCleanupRecord | null = null;
  let cleanupArtifact: string | null = null;
  let runFailure: string | null = null;
  let cleanupStatus: "NOT_NEEDED" | "PASS" | "FAIL" | "KEPT" =
    "NOT_NEEDED";

  const persistRecoveryRecord = async (): Promise<void> => {
    if (candidates.length === 0) return;
    record = createOpportunityCatalogCleanupRecord(config, candidates);
    cleanupArtifact = await preserveCleanupRecord(record);
  };

  process.stdout.write(
    `RoleDawn opportunity-catalog hosted acceptance\nproject=${config.expectedProjectRef}\nsource=${config.sourceTenant}\nrun=${config.runId}\n`,
  );

  try {
    const fixture = await runStage("allowlisted-catalog-fixture", () =>
      loadCatalogFixture(config),
    );
    report(
      checks,
      "allowlisted-catalog-fixture",
      `two open ${fixture.provider} jobs loaded from the allowlisted ${fixture.tenantKey} source`,
    );

    await runStage("anonymous-denial", () =>
      verifyAnonymousDenied(config, fixture),
    );
    report(
      checks,
      "anonymous-denial",
      "anonymous catalog search and commands are rejected",
    );

    const { alpha, beta } = await runStage("two-real-candidates", async () => {
      const alpha = await createCandidate(config, "alpha");
      candidates.push(alpha);
      await persistRecoveryRecord();
      const beta = await createCandidate(config, "beta");
      candidates.push(beta);
      await persistRecoveryRecord();
      return { alpha, beta };
    });
    report(
      checks,
      "two-real-candidates",
      "two ordinary sessions have separate personal workspaces",
    );

    const query = createSearchQuery(fixture.primary.title);
    const safeRows = await runStage("safe-search-contract", async () => {
      const rows = await searchCatalog(
        alpha,
        { p_query: query, p_limit: 100 },
        "CATALOG_SEARCH_FAILED",
      );
      assertSafeSearchContract(rows);
      const target = rows.find((row) => row.job_id === fixture.primary.jobId);
      if (
        !target ||
        target.job_version_id !== fixture.primary.jobVersionId ||
        target.source_provider !== fixture.provider ||
        target.saved ||
        target.queued_application_id
      ) {
        throw new AcceptanceFailure("CATALOG_TARGET_NOT_SAFE_OR_CURRENT");
      }
      return rows;
    });
    report(
      checks,
      "safe-search-contract",
      `${safeRows.length} result(s) expose only the 15 candidate-facing fields`,
    );

    await runStage("filter-behavior", async () => {
      const location = locationNeedle(fixture.primary.locationText);
      const filtered = await searchCatalog(
        alpha,
        {
          p_query: query,
          p_limit: 100,
          p_location: location || undefined,
          p_work_mode: fixture.primary.workMode,
          p_employment_type: fixture.primary.employmentType,
        },
        "FILTERED_CATALOG_SEARCH_FAILED",
      );
      if (!filtered.some((row) => row.job_id === fixture.primary.jobId)) {
        throw new AcceptanceFailure("FILTERS_EXCLUDED_EXPECTED_TARGET");
      }
      if (
        filtered.some(
          (row) =>
            row.work_mode?.toUpperCase() !== fixture.primary.workMode ||
            row.employment_type?.toUpperCase() !==
              fixture.primary.employmentType ||
            (location &&
              !row.location_text?.toLowerCase().includes(location.toLowerCase())),
        )
      ) {
        throw new AcceptanceFailure("FILTER_RESULT_VIOLATED_PREDICATE");
      }

      const invalid = await alpha.client.rpc("search_catalog_jobs", {
        p_work_mode: "MARS",
      });
      assertExpectedError(
        invalid.error,
        "22023",
        "CATALOG_SEARCH_INPUT_INVALID",
        "INVALID_FILTER_NOT_DENIED",
      );
    });
    report(
      checks,
      "filter-behavior",
      "query, location, work mode, employment type, and invalid-input filters behave as declared",
    );

    await runStage("save-replay-remove", async () => {
      const saveCommandId = randomUUID();
      const saveArgs = {
        p_command_id: saveCommandId,
        p_job_id: fixture.primary.jobId,
        p_job_version_id: fixture.primary.jobVersionId,
        p_saved: true,
      };
      const saved = await saveCatalogJob(alpha, saveArgs, "CATALOG_SAVE_FAILED");
      if (saved.replayed || !saved.saved) {
        throw new AcceptanceFailure("CATALOG_SAVE_RESULT_INVALID");
      }
      const replay = await saveCatalogJob(
        alpha,
        saveArgs,
        "CATALOG_SAVE_REPLAY_FAILED",
      );
      if (!replay.replayed || !replay.saved) {
        throw new AcceptanceFailure("CATALOG_SAVE_REPLAY_INVALID");
      }

      const mismatch = await alpha.client.rpc("set_catalog_job_saved", {
        ...saveArgs,
        p_saved: false,
      });
      assertExpectedError(
        mismatch.error,
        "23505",
        "COMMAND_ID_PAYLOAD_MISMATCH",
        "SAVE_COMMAND_PAYLOAD_MISMATCH_NOT_DENIED",
      );

      const savedOnly = await searchCatalog(
        alpha,
        { p_query: query, p_limit: 100, p_saved_only: true },
        "SAVED_ONLY_SEARCH_FAILED",
      );
      if (
        !savedOnly.some(
          (row) => row.job_id === fixture.primary.jobId && row.saved,
        )
      ) {
        throw new AcceptanceFailure("SAVED_JOB_NOT_IN_SAVED_ONLY_SEARCH");
      }

      const removeArgs = {
        ...saveArgs,
        p_command_id: randomUUID(),
        p_saved: false,
      };
      const removed = await saveCatalogJob(
        alpha,
        removeArgs,
        "CATALOG_REMOVE_FAILED",
      );
      if (removed.replayed || removed.saved) {
        throw new AcceptanceFailure("CATALOG_REMOVE_RESULT_INVALID");
      }
      const removeReplay = await saveCatalogJob(
        alpha,
        removeArgs,
        "CATALOG_REMOVE_REPLAY_FAILED",
      );
      if (!removeReplay.replayed || removeReplay.saved) {
        throw new AcceptanceFailure("CATALOG_REMOVE_REPLAY_INVALID");
      }
      const afterRemove = await searchCatalog(
        alpha,
        { p_query: query, p_limit: 100, p_saved_only: true },
        "SAVED_ONLY_POST_REMOVE_SEARCH_FAILED",
      );
      if (afterRemove.some((row) => row.job_id === fixture.primary.jobId)) {
        throw new AcceptanceFailure("REMOVED_JOB_STILL_SAVED");
      }
    });
    report(
      checks,
      "save-replay-remove",
      "save and remove commands are replay-safe and saved-only search follows active state",
    );

    await runStage("stale-version-denial", async () => {
      const staleSave = await alpha.client.rpc("set_catalog_job_saved", {
        p_command_id: randomUUID(),
        p_job_id: fixture.primary.jobId,
        p_job_version_id: fixture.secondary.jobVersionId,
        p_saved: true,
      });
      assertExpectedError(
        staleSave.error,
        "55000",
        "CATALOG_JOB_NOT_AVAILABLE",
        "STALE_SAVE_VERSION_NOT_DENIED",
      );
      const staleQueue = await alpha.client.rpc(
        "enqueue_catalog_job_application",
        {
          p_command_id: randomUUID(),
          p_job_id: fixture.primary.jobId,
          p_job_version_id: fixture.secondary.jobVersionId,
        },
      );
      assertExpectedError(
        staleQueue.error,
        "55000",
        "CATALOG_JOB_NOT_AVAILABLE",
        "STALE_QUEUE_VERSION_NOT_DENIED",
      );
      const existing = await alpha.client
        .from("applications")
        .select("id")
        .eq("job_id", fixture.primary.jobId);
      assertRemoteOk(existing.error, "STALE_QUEUE_POSTCHECK_FAILED");
      if ((existing.data ?? []).length !== 0) {
        throw new AcceptanceFailure("STALE_QUEUE_CREATED_APPLICATION");
      }
    });
    report(
      checks,
      "stale-version-denial",
      "a job paired with another catalog entry's version is rejected without side effects",
    );

    const queued = await runStage("queue-replay", async () => {
      const queueArgs = {
        p_command_id: randomUUID(),
        p_job_id: fixture.primary.jobId,
        p_job_version_id: fixture.primary.jobVersionId,
      };
      const created = await queueCatalogJob(
        alpha,
        queueArgs,
        "CATALOG_QUEUE_FAILED",
      );
      if (created.replayed || created.aggregate_version !== 1) {
        throw new AcceptanceFailure("CATALOG_QUEUE_RESULT_INVALID");
      }
      const replay = await queueCatalogJob(
        alpha,
        queueArgs,
        "CATALOG_QUEUE_REPLAY_FAILED",
      );
      if (
        !replay.replayed ||
        replay.application_id !== created.application_id ||
        replay.aggregate_version !== created.aggregate_version
      ) {
        throw new AcceptanceFailure("CATALOG_QUEUE_REPLAY_INVALID");
      }
      const existingReplay = await queueCatalogJob(
        alpha,
        { ...queueArgs, p_command_id: randomUUID() },
        "CATALOG_QUEUE_EXISTING_REPLAY_FAILED",
      );
      if (
        !existingReplay.replayed ||
        existingReplay.application_id !== created.application_id ||
        existingReplay.aggregate_version !== created.aggregate_version
      ) {
        throw new AcceptanceFailure("CATALOG_QUEUE_EXISTING_REPLAY_INVALID");
      }
      return created;
    });
    report(
      checks,
      "queue-replay",
      "one catalog job creates one application and both command and aggregate retries return it",
    );

    await runStage("no-submission-authority", async () => {
      const admin = createOpportunityCatalogClient(config, config.secretKey);
      const [application, runs, decisions, events, outbox, candidate] =
        await Promise.all([
          alpha.client
            .from("applications")
            .select(
              "id, workspace_id, candidate_id, job_id, job_version_id, status, aggregate_version, operations_review_status",
            )
            .eq("id", queued.application_id)
            .single(),
          alpha.client
            .from("application_runs")
            .select("id, application_id, run_kind, status")
            .eq("application_id", queued.application_id),
          alpha.client
            .from("candidate_job_decisions")
            .select("id, decision, undone_at, job_id, job_version_id")
            .eq("job_id", fixture.primary.jobId)
            .is("undone_at", null),
          alpha.client
            .from("domain_events")
            .select("id, event_type, aggregate_type, aggregate_id, actor_kind")
            .eq("aggregate_type", "APPLICATION")
            .eq("aggregate_id", queued.application_id),
          admin
            .from("outbox")
            .select("id, event_id, topic, payload, published_at")
            .eq("workspace_id", alpha.workspaceId),
          alpha.client
            .from("candidates")
            .select("submission_mode")
            .eq("id", alpha.candidateId)
            .single(),
        ]);
      for (const result of [
        application,
        runs,
        decisions,
        events,
        outbox,
        candidate,
      ]) {
        assertRemoteOk(result.error, "QUEUE_ACCOUNTING_READ_FAILED");
      }
      const applicationRow = application.data;
      const runRows = runs.data ?? [];
      const decisionRows = decisions.data ?? [];
      const eventRows = events.data ?? [];
      const outboxRows = outbox.data ?? [];
      const candidateRow = candidate.data;
      if (
        !applicationRow ||
        !candidateRow ||
        applicationRow.status !== "DRAFTING" ||
        applicationRow.aggregate_version !== 1 ||
        applicationRow.operations_review_status !== "NOT_REQUIRED" ||
        applicationRow.job_id !== fixture.primary.jobId ||
        applicationRow.job_version_id !== fixture.primary.jobVersionId ||
        runRows.length !== 1 ||
        runRows[0]?.run_kind !== "PREPARATION" ||
        runRows[0]?.status !== "QUEUED" ||
        decisionRows.length !== 1 ||
        decisionRows[0]?.decision !== "QUEUED" ||
        eventRows.length !== 1 ||
        eventRows[0]?.event_type !== "application.preparation_queued" ||
        eventRows[0]?.actor_kind !== "CANDIDATE" ||
        outboxRows.length !== 1 ||
        outboxRows[0]?.topic !== "application.preparation_requested" ||
        candidateRow.submission_mode !== "PER_APPLICATION_APPROVAL"
      ) {
        throw new AcceptanceFailure("PREPARATION_ONLY_BOUNDARY_FAILED");
      }
      if (
        [applicationRow.status, ...runRows.map((run) => run.run_kind), ...outboxRows.map((entry) => entry.topic)]
          .join(" ")
          .match(/AUTHORIZED|EXECUTING|BROWSER_FILL|submit/i)
      ) {
        throw new AcceptanceFailure("SUBMISSION_AUTHORITY_LEAKED");
      }
    });
    report(
      checks,
      "no-submission-authority",
      "queue creates only a preparation run and preparation outbox message under per-application approval",
    );

    await runStage("auth-isolation", async () => {
      const [betaSearch, betaDecisions, betaApplications, betaEvents] =
        await Promise.all([
          searchCatalog(
            beta,
            { p_query: query, p_limit: 100 },
            "BETA_CATALOG_SEARCH_FAILED",
          ),
          beta.client
            .from("candidate_job_decisions")
            .select("id")
            .eq("workspace_id", alpha.workspaceId),
          beta.client
            .from("applications")
            .select("id")
            .eq("workspace_id", alpha.workspaceId),
          beta.client
            .from("domain_events")
            .select("id")
            .eq("workspace_id", alpha.workspaceId),
        ]);
      for (const result of [betaDecisions, betaApplications, betaEvents]) {
        assertRemoteOk(result.error, "CROSS_TENANT_READ_FAILED");
        if ((result.data ?? []).length !== 0) {
          throw new AcceptanceFailure("CROSS_TENANT_ROW_VISIBLE");
        }
      }
      const target = betaSearch.find(
        (row) => row.job_id === fixture.primary.jobId,
      );
      if (!target || target.saved || target.queued_application_id) {
        throw new AcceptanceFailure("CANDIDATE_SEARCH_STATE_LEAKED");
      }
      const alphaSearch = await searchCatalog(
        alpha,
        { p_query: query, p_limit: 100 },
        "ALPHA_POST_QUEUE_SEARCH_FAILED",
      );
      const alphaTarget = alphaSearch.find(
        (row) => row.job_id === fixture.primary.jobId,
      );
      if (
        !alphaTarget ||
        alphaTarget.saved ||
        alphaTarget.queued_application_id !== queued.application_id
      ) {
        throw new AcceptanceFailure("CANDIDATE_OWN_QUEUE_STATE_MISSING");
      }
    });
    report(
      checks,
      "auth-isolation",
      "catalog rows are shared while saved, queued, application, and event state remains candidate-scoped",
    );

    await runStage("direct-table-denial", () =>
      verifyDirectWritesDenied(alpha, fixture, queued.application_id),
    );
    report(
      checks,
      "direct-table-denial",
      "ordinary sessions cannot write decisions or applications directly or read raw job payload columns",
    );

    await runStage("catalog-unchanged", () =>
      verifyCatalogUnchanged(config, fixture),
    );
    report(
      checks,
      "catalog-unchanged",
      "the shared source, listings, jobs, and versions are byte-for-byte unchanged",
    );

    const actual = new Set(checks.map((check) => check.name));
    const missing = REQUIRED_CHECKPOINTS.filter((name) => !actual.has(name));
    const unexpected = [...actual].filter(
      (name) =>
        !REQUIRED_CHECKPOINTS.includes(
          name as (typeof REQUIRED_CHECKPOINTS)[number],
        ),
    );
    if (
      missing.length > 0 ||
      unexpected.length > 0 ||
      checks.length !== REQUIRED_CHECKPOINTS.length
    ) {
      throw new AcceptanceFailure(
        `INCOMPLETE_CHECKPOINTS:${missing.join(",") || unexpected.join(",")}`,
      );
    }
  } catch (error) {
    runFailure =
      error instanceof AcceptanceFailure
        ? error.message
        : "UNEXPECTED_OPPORTUNITY_CATALOG_ACCEPTANCE_FAILURE";
    process.stderr.write(`FAIL ${runFailure}\n`);
  } finally {
    if (record && !config.keepArtifacts) {
      try {
        process.stdout.write("START cleanup\n");
        const cleanupErrors = await withDeadline(
          cleanupOpportunityCatalogAcceptance(config, record),
          CLEANUP_TIMEOUT_MS,
          "CLEANUP_TIMEOUT",
        );
        if (cleanupErrors.length === 0) {
          cleanupStatus = "PASS";
          process.stdout.write(
            "PASS cleanup — synthetic auth, tenant, decisions, applications, runs, events, commands, and outbox rows removed\n",
          );
        } else {
          cleanupStatus = "FAIL";
          process.stderr.write(
            `FAIL cleanup incomplete; use ${cleanupArtifact}\n${cleanupErrors.join("\n")}\n`,
          );
        }
      } catch (error) {
        cleanupStatus = "FAIL";
        const message =
          error instanceof AcceptanceFailure
            ? error.message
            : "UNKNOWN_CLEANUP_FAILURE";
        process.stderr.write(
          `FAIL cleanup:${message}; use ${cleanupArtifact ?? "local cleanup record"}\n`,
        );
      }
    } else if (record) {
      cleanupStatus = "KEPT";
      process.stdout.write(
        `KEEP acceptance artifacts; cleanup record: ${cleanupArtifact}\n`,
      );
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        runId: config.runId,
        projectRef: config.expectedProjectRef,
        sourceTenant: config.sourceTenant,
        status: !runFailure && cleanupStatus !== "FAIL" ? "PASS" : "FAIL",
        cleanup: cleanupStatus,
        checks,
      },
      null,
      2,
    )}\n`,
  );
  if (runFailure || cleanupStatus === "FAIL") {
    throw new AcceptanceFailure(
      runFailure ?? "OPPORTUNITY_CATALOG_ACCEPTANCE_CLEANUP_FAILED",
    );
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `FAIL ${
      error instanceof AcceptanceFailure
        ? error.message
        : "UNEXPECTED_OPPORTUNITY_CATALOG_ACCEPTANCE_FAILURE"
    }\n`,
  );
  process.exitCode = 1;
}
