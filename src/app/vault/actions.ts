"use server";

import { revalidatePath } from "next/cache";

import type { VaultActionState } from "@/domain/career-vault";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import {
  CareerVaultError,
  deleteResume,
  reviewResumeText,
  reserveDirectResumeUpload,
  finishDirectResumeUpload,
} from "@/server/vault/career-vault";
import { ResumeDirectUploadError, type DirectResumeUploadRequest, type DirectResumeUploadActionResult } from "@/domain/resume-direct-upload";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actionError(error: unknown, fallback: string): VaultActionState {
  return {
    outcome: "error",
    message: error instanceof CareerVaultError ? error.message : fallback,
  };
}

function requiredActorMessage(): VaultActionState {
  return { outcome: "error", message: "Sign in again before changing your profile." };
}

function parsePositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function reserveDirectResumeUploadAction(command: DirectResumeUploadRequest): Promise<DirectResumeUploadActionResult> {
  if (!readSupabasePublicConfig()) return { ok: false, message: "The profile database is not configured." };
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Sign in again before uploading." };
  try { return { ok: true, target: await reserveDirectResumeUpload(actor, command) }; }
  catch (error) { return { ok: false, message: error instanceof CareerVaultError || error instanceof ResumeDirectUploadError ? error.message : "The upload could not be started. Try again." }; }
}

export async function finishDirectResumeUploadAction(documentVersionId: string): Promise<Readonly<{ ok: boolean; message: string }>> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: "Sign in again before finishing your upload." };
  if (!UUID_PATTERN.test(documentVersionId)) return { ok: false, message: "Reload before finishing your upload." };
  try {
    await finishDirectResumeUpload(actor, documentVersionId);
    revalidatePath("/vault"); revalidatePath("/onboarding"); revalidatePath("/vault/facts");
    return { ok: true, message: "Résumé uploaded. Review the extracted text below." };
  } catch (error) {
    revalidatePath("/vault"); revalidatePath("/onboarding");
    return { ok: false, message: error instanceof CareerVaultError || error instanceof ResumeDirectUploadError ? error.message : "The upload could not be confirmed. Retry to check the same file." };
  }
}

export async function saveResumeReviewAction(
  _previousState: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const actor = await getOptionalActor();
  if (!actor) return requiredActorMessage();
  const documentId = String(formData.get("documentId") ?? "");
  const extractionId = String(formData.get("extractionId") ?? "");
  const expectedAggregateVersion = parsePositiveInteger(formData.get("expectedAggregateVersion"));
  const reviewedText = String(formData.get("extractedText") ?? "");
  if (!UUID_PATTERN.test(documentId) || !UUID_PATTERN.test(extractionId) || !expectedAggregateVersion) {
    return { outcome: "error", message: "Reload before saving this résumé." };
  }
  if (!reviewedText.trim()) {
    return {
      outcome: "error",
      message: "The reviewed résumé text cannot be empty.",
      fieldErrors: { extractedText: "Add the résumé text you want to save." },
    };
  }

  try {
    await reviewResumeText(actor, {
      documentId,
      extractionId,
      expectedAggregateVersion,
      reviewedText,
    });
    revalidatePath("/vault");
    revalidatePath("/onboarding");
    return { outcome: "success", message: "Reviewed résumé text saved." };
  } catch (error) {
    return actionError(error, "The reviewed résumé text could not be saved.");
  }
}

export async function deleteResumeAction(
  _previousState: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const actor = await getOptionalActor();
  if (!actor) return requiredActorMessage();
  if (formData.get("confirmDelete") !== "yes") {
    return { outcome: "error", message: "Confirm permanent deletion before continuing." };
  }
  const documentId = String(formData.get("documentId") ?? "");
  const expectedAggregateVersion = parsePositiveInteger(formData.get("expectedAggregateVersion"));
  if (!UUID_PATTERN.test(documentId) || !expectedAggregateVersion) {
    return { outcome: "error", message: "Reload before removing this résumé." };
  }

  try {
    await deleteResume(actor, { documentId, expectedAggregateVersion });
    revalidatePath("/vault");
    revalidatePath("/onboarding");
    return { outcome: "success", message: "The résumé and saved text were permanently removed." };
  } catch (error) {
    return actionError(error, "The résumé could not be removed.");
  }
}
