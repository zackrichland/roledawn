"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOptionalActor } from "@/server/auth/session";
import {
  ApplicationFilesRefreshError,
  ApplicationPreparationRetryError,
  refreshApplicationFiles,
  retryApplicationPreparation,
} from "@/server/applications/preparation";
import {
  ApplicationFillAuthorizationError,
  authorizeApplicationFillOnce,
} from "@/server/applications/fill-authorization";
import {
  ApplicationFillResumeError,
  requestApplicationFillResume,
} from "@/server/applications/fill-resume";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type AuthorizeApplicationFillActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

export async function authorizeApplicationFillAction(input: Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
  expectedRevisionId: string;
  expectedPacketHash: string;
}>): Promise<AuthorizeApplicationFillActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Sign in again before filling this application." };
  if (
    !UUID_PATTERN.test(input.commandId) ||
    !UUID_PATTERN.test(input.applicationId) ||
    !UUID_PATTERN.test(input.expectedRevisionId) ||
    !Number.isSafeInteger(input.expectedAggregateVersion) ||
    input.expectedAggregateVersion < 1 ||
    !SHA256_PATTERN.test(input.expectedPacketHash)
  ) {
    return {
      ok: false,
      message: "Reload and review the current application before filling the form.",
    };
  }

  try {
    await authorizeApplicationFillOnce({
      commandId: input.commandId,
      applicationId: input.applicationId,
      expectedAggregateVersion: input.expectedAggregateVersion,
      expectedRevisionId: input.expectedRevisionId,
      expectedPacketHash: input.expectedPacketHash,
    });
    revalidatePath("/dashboard");
    revalidatePath(`/applications/${input.applicationId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApplicationFillAuthorizationError
        ? error.message
        : "RoleDawn could not queue this form fill. Nothing was submitted.",
    };
  }
}

export type ResumeApplicationFillActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

export async function resumeApplicationFillAction(input: Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
  fillAttemptId: string;
  computerSessionId: string;
  candidateCompletedRequiredFields: boolean;
}>): Promise<ResumeApplicationFillActionResult> {
  const actor = await getOptionalActor();
  if (!actor) {
    return { ok: false, message: "Sign in again before continuing this application." };
  }
  if (
    !UUID_PATTERN.test(input.commandId) ||
    !UUID_PATTERN.test(input.applicationId) ||
    !UUID_PATTERN.test(input.fillAttemptId) ||
    !UUID_PATTERN.test(input.computerSessionId) ||
    !Number.isSafeInteger(input.expectedAggregateVersion) ||
    input.expectedAggregateVersion < 1 ||
    input.candidateCompletedRequiredFields !== true
  ) {
    return {
      ok: false,
      message: "Confirm that you completed the required questions, then try again.",
    };
  }

  try {
    await requestApplicationFillResume({
      ...input,
      candidateCompletedRequiredFields: true,
    });
    revalidatePath("/dashboard");
    revalidatePath(`/applications/${input.applicationId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApplicationFillResumeError
        ? error.message
        : "RoleDawn could not continue the secure browser. Nothing was submitted.",
    };
  }
}

export type RetryPreparationActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

export async function retryPreparationAction(input: Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
}>): Promise<RetryPreparationActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Sign in again before checking this application." };
  if (
    !UUID_PATTERN.test(input.commandId) ||
    !UUID_PATTERN.test(input.applicationId) ||
    !Number.isSafeInteger(input.expectedAggregateVersion) ||
    input.expectedAggregateVersion < 1
  ) {
    return { ok: false, message: "Reload before checking this application again." };
  }

  try {
    await retryApplicationPreparation(input);
    revalidatePath("/dashboard");
    revalidatePath(`/applications/${input.applicationId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApplicationPreparationRetryError
        ? error.message
        : "RoleDawn could not check this application again.",
    };
  }
}

export type RefreshApplicationFilesActionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

export async function refreshApplicationFilesAction(input: Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
}>): Promise<RefreshApplicationFilesActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Sign in again before refreshing these files." };
  if (
    !UUID_PATTERN.test(input.commandId) ||
    !UUID_PATTERN.test(input.applicationId) ||
    !Number.isSafeInteger(input.expectedAggregateVersion) ||
    input.expectedAggregateVersion < 1
  ) {
    return { ok: false, message: "Reload before refreshing these files." };
  }

  try {
    await refreshApplicationFiles(input);
    revalidatePath("/dashboard");
    revalidatePath(`/applications/${input.applicationId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApplicationFilesRefreshError
        ? error.message
        : "RoleDawn could not refresh these files. The current files were kept.",
    };
  }
}

/** Retry importing a pasted job link whose first import failed. */
export async function retryImportAction(input: Readonly<{ commandId: string; applicationId: string }>): Promise<Readonly<{ ok: boolean; message?: string }>> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Your session ended. Reload the page." };
  if (!UUID_PATTERN.test(input.commandId) || !UUID_PATTERN.test(input.applicationId)) {
    return { ok: false, message: "Reload the page and try again." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("retry_pasted_link_intake", {
    p_command_id: input.commandId,
    p_application_id: input.applicationId,
  });
  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath("/dashboard");
  if (!error) return { ok: true };
  if (error.code === "PGRST202" || error.code === "42883") return { ok: false, message: "Retrying isn't available yet. Paste the link again later." };
  return { ok: false, message: /INTAKE_NOT_RETRYABLE/u.test(error.message) ? "This one can't be retried. Refresh the page." : "The retry didn't start. Try again in a moment." };
}
