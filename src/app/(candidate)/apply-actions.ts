"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { mayRequestInitialSend, parseSendIntentResult } from "@/domain/application-send-intent";
import { normalizePublicJobUrl } from "@/domain/job-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOptionalActor } from "@/server/auth/session";
import { enqueuePastedLinkApplication } from "@/server/dashboard/queue";
import { parseSupportedJobReference } from "@/server/ingestion/job-reference";
import { enqueueCatalogJobApplication } from "@/server/opportunities/catalog";
import { requestHostedWorkerWakeup } from "@/server/workers/hosted-worker-wakeup";

export type ApplyActionResult =
  | Readonly<{ ok: true; applicationId: string }>
  | Readonly<{ ok: false; message: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Applications are unique per job, so a pasted link to a job the candidate
 * already has open goes straight to that application instead of a second one.
 */
async function existingApplicationForUrl(url: string): Promise<Readonly<{ id: string; status: string }> | null> {
  const supabase = await createSupabaseServerClient();
  const [byJob, byVersion] = await Promise.all([
    supabase.from("jobs").select("id").eq("canonical_url", url).limit(5),
    supabase.from("job_versions").select("job_id").eq("apply_url", url).limit(5),
  ]);
  const jobIds = [...new Set([...(byJob.data ?? []).map((row) => row.id), ...(byVersion.data ?? []).map((row) => row.job_id)])];
  if (jobIds.length === 0) return null;
  const { data } = await supabase.from("applications").select("id,status").in("job_id", jobIds).limit(1);
  return data?.[0] ?? null;
}

async function requestSend(commandId: string, applicationId: string): Promise<Readonly<{ open: boolean; changed: boolean }>> {
  const supabase = await createSupabaseServerClient();
  const prior = await supabase.from("application_send_intents").select("closed_at").eq("application_id", applicationId).maybeSingle();
  const { data, error } = await supabase.rpc("request_application_send", { p_command_id: commandId, p_application_id: applicationId });
  const result = error ? null : parseSendIntentResult(data, applicationId);
  return { open: result?.open ?? false, changed: Boolean(result?.open && !result.replayed && !prior.error && prior.data?.closed_at !== null) };
}

function wakeApplicationPipeline(): void {
  after(() => requestHostedWorkerWakeup(["preparation", "kit", "cleanup"]));
}

const SEND_NOT_CONFIRMED = "The job is saved, but RoleDawn couldn't confirm that sending was enabled. Open the application from Home to check its status.";

/**
 * Paste a link, press Apply: the job is imported, the files are written, and
 * the application is sent once its files pass every check. The candidate can
 * cancel sending from the application page until it starts.
 */
export async function applyToJobLinkAction(input: Readonly<{
  commandId: string;
  sendCommandId: string;
  jobUrl: string;
  sendWhenReady: boolean;
}>): Promise<ApplyActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Your session ended. Reload the page and try again." };
  if (!UUID.test(input.commandId) || !UUID.test(input.sendCommandId)) return { ok: false, message: "Reload the page and try again." };
  const normalized = normalizePublicJobUrl(input.jobUrl);
  if (!normalized.ok) return { ok: false, message: "That doesn't look like a public job link. Copy the full address of the job posting." };
  const reference = parseSupportedJobReference(normalized.value);
  if (!reference.ok) {
    return { ok: false, message: "RoleDawn can apply to jobs posted on Greenhouse, Lever, and Ashby. Paste the job's own posting link (for example boards.greenhouse.io/… or jobs.lever.co/…)." };
  }
  try {
    const existing = await existingApplicationForUrl(reference.value.canonicalInputUrl).catch(() => null);
    if (existing) {
      if (input.sendWhenReady && mayRequestInitialSend(existing.status)) {
        const send = await requestSend(input.sendCommandId, existing.id).catch(() => ({ open: false, changed: false }));
        if (!send.open) return { ok: false, message: SEND_NOT_CONFIRMED };
        if (send.changed) {
          wakeApplicationPipeline();
          revalidatePath(`/applications/${existing.id}`);
          revalidatePath("/dashboard");
        }
      }
      return { ok: true, applicationId: existing.id };
    }
    const result = await enqueuePastedLinkApplication(actor, { commandId: input.commandId, canonicalUrl: reference.value.canonicalInputUrl });
    if (!result.applicationId) return { ok: false, message: "The job was added, but RoleDawn couldn't open it. Check Home in a moment." };
    const send = input.sendWhenReady
      ? await requestSend(input.sendCommandId, result.applicationId).catch(() => ({ open: false, changed: false }))
      : null;
    if (!result.replayed || send?.changed) wakeApplicationPipeline();
    revalidatePath("/dashboard");
    if (send && !send.open) return { ok: false, message: SEND_NOT_CONFIRMED };
    return { ok: true, applicationId: result.applicationId };
  } catch {
    return { ok: false, message: "RoleDawn couldn't add that job. Try again in a moment." };
  }
}

export async function applyToCatalogJobAction(input: Readonly<{
  commandId: string;
  sendCommandId: string;
  jobId: string;
  jobVersionId: string;
  sendWhenReady: boolean;
}>): Promise<ApplyActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Your session ended. Reload the page and try again." };
  if (![input.commandId, input.sendCommandId, input.jobId, input.jobVersionId].every((value) => UUID.test(value))) {
    return { ok: false, message: "Reload the page and try again." };
  }
  try {
    const result = await enqueueCatalogJobApplication(actor, { commandId: input.commandId, jobId: input.jobId, jobVersionId: input.jobVersionId });
    const send = input.sendWhenReady
      ? await requestSend(input.sendCommandId, result.applicationId).catch(() => ({ open: false, changed: false }))
      : null;
    if (!result.replayed || send?.changed) wakeApplicationPipeline();
    revalidatePath("/dashboard");
    revalidatePath("/search");
    if (send && !send.open) return { ok: false, message: SEND_NOT_CONFIRMED };
    return { ok: true, applicationId: result.applicationId };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return { ok: false, message: code === "OPPORTUNITY_COMMANDS_UNAVAILABLE" ? "Job actions are updating. Try again shortly." : "RoleDawn couldn't start that application. It may have closed; refresh and try another." };
  }
}

export async function setSendWhenReadyAction(input: Readonly<{ commandId: string; applicationId: string; send: boolean }>): Promise<Readonly<{ ok: boolean; message?: string }>> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Your session ended. Reload the page." };
  if (!UUID.test(input.applicationId) || !UUID.test(input.commandId)) return { ok: false, message: "Reload the page and try again." };
  let saved = false;
  try {
    if (input.send) {
      const result = await requestSend(input.commandId, input.applicationId);
      saved = result.open;
      if (result.changed) wakeApplicationPipeline();
    } else {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc("cancel_application_send", { p_application_id: input.applicationId });
      // The sweep may have already consumed the intent. A successful RPC with
      // false is not confirmation that sending was canceled.
      saved = !error && data === true;
    }
  } catch { /* A failed readback cannot confirm the requested setting. */ }
  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath("/dashboard");
  return saved ? { ok: true } : { ok: false, message: "RoleDawn couldn't confirm that change. Refresh to check the current setting." };
}
