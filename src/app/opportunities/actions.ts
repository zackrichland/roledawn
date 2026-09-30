"use server";

import { revalidatePath } from "next/cache";

import { isUuid } from "@/domain/opportunity-catalog";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import {
  setCatalogJobSaved,
} from "@/server/opportunities/catalog";

type OpportunityActionError = Readonly<{
  code: string;
  message: string;
}>;

export type SaveCatalogJobActionResult =
  | Readonly<{ ok: true; value: Readonly<{ replayed: boolean; saved: boolean }> }>
  | Readonly<{ ok: false; error: OpportunityActionError }>;

type CatalogJobActionInput = Readonly<{
  commandId: string;
  jobId: string;
  jobVersionId: string;
}>;

function validateInput(input: CatalogJobActionInput): OpportunityActionError | null {
  if (!isUuid(input.commandId)) {
    return { code: "COMMAND_ID_INVALID", message: "Refresh the page and try again." };
  }
  if (!isUuid(input.jobId) || !isUuid(input.jobVersionId)) {
    return { code: "CATALOG_JOB_IDENTITY_INVALID", message: "That job could not be identified." };
  }
  return null;
}

async function requireOpportunityActor(): Promise<
  | Readonly<{ ok: true; actor: NonNullable<Awaited<ReturnType<typeof getOptionalActor>>> }>
  | Readonly<{ ok: false; error: OpportunityActionError }>
> {
  if (!readSupabasePublicConfig()) {
    return {
      ok: false,
      error: { code: "BACKEND_CONFIGURATION_REQUIRED", message: "The database connection is not configured." },
    };
  }
  const actor = await getOptionalActor();
  if (!actor) {
    return {
      ok: false,
      error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in before changing a job." },
    };
  }
  return { ok: true, actor };
}

function actionError(error: unknown, fallbackCode: string, fallbackMessage: string): OpportunityActionError {
  const code = error instanceof Error ? error.message : fallbackCode;
  if (code === "OPPORTUNITY_COMMANDS_UNAVAILABLE" || code === "WORKSPACE_BOOTSTRAP_UNAVAILABLE") {
    return { code, message: "Job actions are still being installed. Try again shortly." };
  }
  return { code, message: fallbackMessage };
}

export async function saveCatalogJobAction(
  input: CatalogJobActionInput & Readonly<{ saved: boolean }>,
): Promise<SaveCatalogJobActionResult> {
  const validationError = validateInput(input);
  if (validationError) return { ok: false, error: validationError };

  const actorResult = await requireOpportunityActor();
  if (!actorResult.ok) return actorResult;

  try {
    const result = await setCatalogJobSaved(actorResult.actor, input);
    revalidatePath("/search");
    revalidatePath("/saved");
    return { ok: true, value: result };
  } catch (error) {
    return {
      ok: false,
      error: actionError(error, "SAVE_CATALOG_JOB_FAILED", "That job could not be updated. Try again."),
    };
  }
}
