"use server";

import { revalidatePath } from "next/cache";

import type { VaultActionState } from "@/domain/career-vault";
import { readSupabasePublicConfig } from "@/lib/supabase/config";
import { getOptionalActor } from "@/server/auth/session";
import {
  CareerVaultError,
  deleteResume,
  reviewResumeText,
  uploadResume,
} from "@/server/vault/career-vault";
import {
  DOCX_MEDIA_TYPE,
  MAX_RESUME_FILE_BYTES,
  PDF_MEDIA_TYPE,
  type SupportedResumeMediaType,
} from "@/server/resume/extract-resume";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actionError(error: unknown, fallback: string): VaultActionState {
  return {
    outcome: "error",
    message: error instanceof CareerVaultError ? error.message : fallback,
  };
}

function requiredActorMessage(): VaultActionState {
  return { outcome: "error", message: "Sign in again before changing your Career Vault." };
}

function parsePositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function browserMediaType(file: File): SupportedResumeMediaType | null {
  const declared = file.type.trim().toLowerCase();
  if (declared === PDF_MEDIA_TYPE || declared === DOCX_MEDIA_TYPE) return declared;
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!declared && extension === ".pdf") return PDF_MEDIA_TYPE;
  if (!declared && extension === ".docx") return DOCX_MEDIA_TYPE;
  return null;
}

export async function uploadResumeAction(
  _previousState: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  if (!readSupabasePublicConfig()) {
    return { outcome: "error", message: "The Career Vault database is not configured." };
  }
  const actor = await getOptionalActor();
  if (!actor) return requiredActorMessage();

  const file = formData.get("resume");
  if (!(file instanceof File) || file.size === 0) {
    return {
      outcome: "error",
      message: "Choose a PDF or DOCX résumé.",
      fieldErrors: { resume: "Choose a file before uploading." },
    };
  }
  if (file.size > MAX_RESUME_FILE_BYTES) {
    return {
      outcome: "error",
      message: "Choose a résumé smaller than 10 MB.",
      fieldErrors: { resume: "The file exceeds the 10 MB limit." },
    };
  }
  const mediaType = browserMediaType(file);
  if (!mediaType) {
    return {
      outcome: "error",
      message: "Choose a valid PDF or DOCX résumé.",
      fieldErrors: { resume: "Only PDF and DOCX files are accepted." },
    };
  }

  try {
    await uploadResume(actor, {
      filename: file.name,
      mediaType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath("/vault");
    return { outcome: "success", message: "Résumé uploaded. Review the extracted text below." };
  } catch (error) {
    revalidatePath("/vault");
    return actionError(error, "The résumé could not be uploaded. Try again.");
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
    return { outcome: "success", message: "The résumé and saved text were permanently removed." };
  } catch (error) {
    return actionError(error, "The résumé could not be removed.");
  }
}
