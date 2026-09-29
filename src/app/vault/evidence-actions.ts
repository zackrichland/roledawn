"use server";

import { revalidatePath } from "next/cache";

import {
  type CandidateEvidenceReviewActionState,
  type CandidateEvidenceUsagePolicy,
  isCandidateEvidenceUsagePolicy,
} from "@/domain/candidate-evidence";
import { getOptionalActor } from "@/server/auth/session";
import {
  CandidateEvidenceError,
  reviewCandidateEvidence,
} from "@/server/vault/candidate-evidence";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function reviewCandidateEvidenceAction(
  _previousState: CandidateEvidenceReviewActionState,
  formData: FormData,
): Promise<CandidateEvidenceReviewActionState> {
  const actor = await getOptionalActor();
  if (!actor) return { outcome: "error", message: "Sign in again before reviewing evidence." };

  const commandId = String(formData.get("commandId") ?? "");
  const evidenceItemId = String(formData.get("evidenceItemId") ?? "");
  const expectedAggregateVersion = positiveInteger(formData.get("expectedAggregateVersion"));
  const claimText = String(formData.get("claimText") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const submittedUsagePolicy = String(formData.get("usagePolicy") ?? "");
  if (!UUID_PATTERN.test(commandId) || !UUID_PATTERN.test(evidenceItemId) || !expectedAggregateVersion) {
    return { outcome: "error", message: "Reload before saving this evidence." };
  }

  const disposition = intent === "reject" ? "REJECTED" : intent === "save" ? "APPROVED" : null;
  const usagePolicy: CandidateEvidenceUsagePolicy | null = disposition === "REJECTED"
    ? "DO_NOT_USE"
    : isCandidateEvidenceUsagePolicy(submittedUsagePolicy) ? submittedUsagePolicy : null;
  if (!disposition || !usagePolicy) {
    return { outcome: "error", message: "Choose how RoleDawn may use this evidence." };
  }

  try {
    await reviewCandidateEvidence(actor, {
      commandId,
      evidenceItemId,
      expectedAggregateVersion,
      disposition,
      claimText,
      usagePolicy,
      candidateAttested: formData.get("candidateAttested") === "yes",
    });
    revalidatePath("/vault/facts");
    revalidatePath("/dashboard");
    return {
      outcome: "success",
      message: disposition === "REJECTED" ? "Evidence rejected." : "Evidence saved.",
    };
  } catch (error) {
    return {
      outcome: "error",
      message: error instanceof CandidateEvidenceError
        ? error.message
        : "This evidence could not be saved.",
    };
  }
}
