import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isUuid,
  normalizeOpportunityEmploymentType,
  normalizeOpportunityLocation,
  normalizeOpportunityQuery,
  normalizeOpportunityWorkMode,
  parseOpportunityCatalogRows,
  type OpportunityCatalogDTO,
} from "@/domain/opportunity-catalog";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";

import { decodeCatalogCursor, encodeCatalogCursor } from "./catalog-cursor";
import { attachCatalogFitAssessments } from "./catalog-fit";
import { parseCatalogRefreshStats } from "@/domain/opportunity-stream";

const CATALOG_PAGE_SIZE = 24;

export async function readCatalogRefreshStats(actor: AuthenticatedActor) {
  if (!actor.userId) throw new Error("AUTHENTICATION_REQUIRED");
  const client = await createSupabaseServerClient();
  const result = await asUntypedRpcClient(client).rpc("catalog_refresh_stats", {});
  if (result.error) throw new Error("CATALOG_STATS_UNAVAILABLE");
  return parseCatalogRefreshStats(result.data);
}

type RpcError = Readonly<{
  code?: string;
  message?: string;
}>;

type UntypedRpcClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{ data: unknown; error: RpcError | null }>>;
}>;

type UnknownRecord = Readonly<Record<string, unknown>>;

export type CatalogJobIdentity = Readonly<{
  commandId: string;
  jobId: string;
  jobVersionId: string;
}>;

export type SaveCatalogJobResult = Readonly<{
  replayed: boolean;
  saved: boolean;
}>;

export type QueueCatalogJobResult = Readonly<{
  replayed: boolean;
  applicationId: string;
}>;

function asUntypedRpcClient(supabase: SupabaseClient<Database>): UntypedRpcClient {
  return supabase as unknown as UntypedRpcClient;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRecord(value: unknown): UnknownRecord | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return isRecord(value[0]) ? value[0] : null;
}

function isUnavailable(error: RpcError): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

function validateIdentity(command: CatalogJobIdentity): void {
  if (!isUuid(command.commandId)) throw new Error("COMMAND_ID_INVALID");
  if (!isUuid(command.jobId) || !isUuid(command.jobVersionId)) {
    throw new Error("CATALOG_JOB_IDENTITY_INVALID");
  }
}

function readBoolean(row: UnknownRecord, key: string): boolean {
  if (typeof row[key] !== "boolean") throw new Error("OPPORTUNITY_COMMAND_RESULT_INVALID");
  return row[key];
}

export async function searchOpportunityCatalog(
  actor: AuthenticatedActor,
  input: Readonly<{
    query: string;
    location: string;
    workMode: string;
    employmentType: string;
    savedOnly: boolean;
    cursor: string;
  }>,
): Promise<OpportunityCatalogDTO> {
  // Authentication is also enforced inside the database function. Keeping the
  // actor parameter explicit prevents this server-only boundary from becoming
  // an anonymous catalog read by accident.
  if (!actor.userId) throw new Error("AUTHENTICATION_REQUIRED");

  const query = normalizeOpportunityQuery(input.query);
  const location = normalizeOpportunityLocation(input.location);
  const workMode = normalizeOpportunityWorkMode(input.workMode);
  const employmentType = normalizeOpportunityEmploymentType(input.employmentType);
  const cursor = decodeCatalogCursor(input.cursor);
  const supabase = await createSupabaseServerClient();
  const filters = {
    p_limit: CATALOG_PAGE_SIZE + 1,
    p_location: location || null,
    p_query: query,
    p_saved_only: input.savedOnly,
    p_work_mode: workMode || null,
    p_employment_type: employmentType || null,
  };
  // Ranked search puts title and employer matches first. A cursor from the
  // unranked list (no tier) restarts from the first ranked page.
  const rankedCursor = cursor?.tier !== undefined ? cursor : null;
  let ranked = true;
  let { data, error } = await asUntypedRpcClient(supabase).rpc("search_catalog_jobs_ranked", {
    ...filters,
    p_cursor_tier: rankedCursor?.tier ?? null,
    p_cursor_job_id: rankedCursor?.jobId ?? null,
    p_cursor_observed_at: rankedCursor?.observedAt ?? null,
  });
  if (error && isUnavailable(error)) {
    ranked = false;
    ({ data, error } = await asUntypedRpcClient(supabase).rpc("search_catalog_jobs", {
      ...filters,
      p_cursor_job_id: cursor?.jobId ?? null,
      p_cursor_observed_at: cursor?.observedAt ?? null,
    }));
  }

  if (error) {
    throw new Error(isUnavailable(error) ? "OPPORTUNITY_CATALOG_UNAVAILABLE" : "OPPORTUNITY_CATALOG_READ_FAILED");
  }

  const rows = parseOpportunityCatalogRows(data);
  const tiers = Array.isArray(data)
    ? data.map((row) => (isRecord(row) && typeof row.match_tier === "number" ? row.match_tier : 0))
    : [];
  const visibleItems = Object.freeze(rows.slice(0, CATALOG_PAGE_SIZE));
  let items = visibleItems;
  try {
    items = await attachCatalogFitAssessments(supabase, actor, visibleItems);
  } catch {
    // Fit is advisory. A missing preference, stale generated type, or temporary
    // read failure must not hide otherwise valid current job postings.
    items = visibleItems;
  }
  const lastVisibleItem = items.at(-1);
  const lastTier = tiers[Math.min(rows.length, CATALOG_PAGE_SIZE) - 1] ?? 0;
  const nextCursor = rows.length > CATALOG_PAGE_SIZE && lastVisibleItem
    ? encodeCatalogCursor({ jobId: lastVisibleItem.jobId, observedAt: lastVisibleItem.observedAt, ...(ranked ? { tier: lastTier } : {}) })
    : null;

  return Object.freeze({
    query,
    location,
    workMode,
    employmentType,
    savedOnly: input.savedOnly,
    cursor: input.cursor,
    nextCursor,
    items,
  });
}

export async function setCatalogJobSaved(
  actor: AuthenticatedActor,
  command: CatalogJobIdentity & Readonly<{ saved: boolean }>,
): Promise<SaveCatalogJobResult> {
  validateIdentity(command);
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actor.email?.split("@")[0] ?? "");

  const { data, error } = await asUntypedRpcClient(supabase).rpc("set_catalog_job_saved", {
    p_command_id: command.commandId,
    p_job_id: command.jobId,
    p_job_version_id: command.jobVersionId,
    p_saved: command.saved,
  });

  if (error) {
    throw new Error(isUnavailable(error) ? "OPPORTUNITY_COMMANDS_UNAVAILABLE" : "SAVE_CATALOG_JOB_FAILED");
  }

  const row = firstRecord(data);
  if (!row) throw new Error("OPPORTUNITY_COMMAND_RESULT_INVALID");
  return Object.freeze({
    replayed: readBoolean(row, "replayed"),
    saved: readBoolean(row, "saved"),
  });
}

export async function enqueueCatalogJobApplication(
  actor: AuthenticatedActor,
  command: CatalogJobIdentity,
): Promise<QueueCatalogJobResult> {
  validateIdentity(command);
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actor.email?.split("@")[0] ?? "");

  const { data, error } = await asUntypedRpcClient(supabase).rpc("enqueue_catalog_job_application", {
    p_command_id: command.commandId,
    p_job_id: command.jobId,
    p_job_version_id: command.jobVersionId,
  });

  if (error) {
    throw new Error(isUnavailable(error) ? "OPPORTUNITY_COMMANDS_UNAVAILABLE" : "CATALOG_APPLICATION_ENQUEUE_FAILED");
  }

  const row = firstRecord(data);
  const applicationId = row?.application_id;
  if (!row || typeof applicationId !== "string" || !isUuid(applicationId)) {
    throw new Error("OPPORTUNITY_COMMAND_RESULT_INVALID");
  }

  return Object.freeze({
    replayed: readBoolean(row, "replayed"),
    applicationId,
  });
}
