import "server-only";

import { cache } from "react";

import type { AutoApplyState } from "@/domain/account-auto-apply";
import type { HomeNeed } from "@/domain/home-presentation";
import type { PersistentQueueApplication } from "@/domain/dashboard-queue";
import { applicationSendIntentState, type ApplicationSendIntentState } from "@/domain/application-send-intent";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { readAutoApplyState } from "@/server/auto-apply/state";
import { getQueueWorkspace } from "@/server/dashboard/queue";

export type { HomeNeed };
export type HomeApplication = PersistentQueueApplication & Readonly<{ sendIntent: ApplicationSendIntentState; need: HomeNeed | null }>;

export type HomeData = Readonly<{
  firstName: string | null;
  backendStatus: "available" | "unavailable";
  applications: readonly HomeApplication[];
  autoApply: AutoApplyState | null;
  /** When this snapshot was read, for the "Updated" stat. */
  fetchedAt: string;
}>;

async function currentFactText(key: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data: fact } = await supabase.from("candidate_facts").select("id, current_version_number, verification_status")
    .eq("fact_key", key).maybeSingle();
  if (!fact?.current_version_number) return null;
  const { data: version } = await supabase.from("candidate_fact_versions").select("normalized_text")
    .eq("fact_id", fact.id).eq("version_number", fact.current_version_number).maybeSingle();
  return version?.normalized_text ?? null;
}

async function sendIntentStates(applicationIds: readonly string[]): Promise<ReadonlyMap<string, ApplicationSendIntentState> | null> {
  const supabase = await createSupabaseServerClient();
  const states = new Map<string, ApplicationSendIntentState>();
  // Query only this feed's IDs. Historical closed intents must not consume the API row limit.
  for (let offset = 0; offset < applicationIds.length; offset += 100) {
    const { data, error } = await supabase.from("application_send_intents").select("application_id,closed_at,close_reason")
      .in("application_id", applicationIds.slice(offset, offset + 100));
    if (error) return null;
    for (const row of data ?? []) states.set(row.application_id, applicationSendIntentState(row));
  }
  return states;
}

/** Open code requests and question batches, keyed by application. */
async function openNeeds(): Promise<ReadonlyMap<string, HomeNeed>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("application_autopilots")
    .select("application_id,status,created_at,application_autopilot_questions(status),application_autopilot_verifications(status,recipient_hint,expires_at,requested_at)")
    .in("status", ["WAITING_ANSWERS", "SUBMITTING"]).order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) return new Map();
  const needs = new Map<string, HomeNeed>();
  const now = Date.now();
  for (const row of data as unknown as readonly Readonly<{ application_id: string; status: string;
    application_autopilot_questions: readonly Readonly<{ status: string }>[] | null;
    application_autopilot_verifications: readonly Readonly<{ status: string; recipient_hint: string; expires_at: string; requested_at: string }>[] | null }>[]) {
    if (needs.has(row.application_id)) continue;
    if (row.status === "SUBMITTING") {
      const open = (row.application_autopilot_verifications ?? []).filter((item) => item.status === "REQUESTED" && Date.parse(item.expires_at) > now)
        .sort((left, right) => right.requested_at.localeCompare(left.requested_at))[0];
      if (open) needs.set(row.application_id, Object.freeze({ kind: "CODE", recipient: open.recipient_hint, expiresAt: open.expires_at }));
    } else {
      const count = (row.application_autopilot_questions ?? []).filter((item) => item.status === "OPEN").length;
      if (count) needs.set(row.application_id, Object.freeze({ kind: "ANSWERS", count }));
    }
  }
  return needs;
}

export async function loadHomeData(actor: AuthenticatedActor): Promise<HomeData> {
  const queueRequest = getQueueWorkspace(actor).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const }));
  const [queue, autoApply, intents, needs, firstName] = await Promise.all([
    queueRequest,
    createSupabaseServerClient().then((client) => readAutoApplyState(client)).catch(() => null),
    queueRequest.then((queue) => queue.ok ? sendIntentStates(queue.value.applications.map((application) => application.applicationRouteKey)) : null).catch(() => null),
    openNeeds().catch(() => new Map<string, HomeNeed>()),
    currentFactText("identity.preferred_name").then((preferred) => preferred ?? currentFactText("identity.given_name")).catch(() => null),
  ]);
  return Object.freeze({
    firstName,
    backendStatus: queue.ok ? "available" : "unavailable",
    applications: Object.freeze(queue.ok
      ? queue.value.applications.map((application) => Object.freeze({ ...application, sendIntent: intents ? intents.get(application.applicationRouteKey) ?? "NONE" : "UNAVAILABLE",
        need: needs.get(application.applicationRouteKey) ?? null }))
      : []),
    autoApply: autoApply ?? null,
    fetchedAt: new Date().toISOString(),
  });
}

/** One read per request, shared by the page and its title. */
export const loadHomeDataForRequest = cache(loadHomeData);
