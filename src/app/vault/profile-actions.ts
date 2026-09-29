"use server";

import { revalidatePath } from "next/cache";

import {
  type CandidateFactKey,
  type CandidateProfileActionState,
  isCandidateFactKey,
} from "@/domain/candidate-profile";
import { getOptionalActor } from "@/server/auth/session";
import {
  CandidateProfileError,
  saveCandidateFact,
} from "@/server/vault/candidate-profile";

function parseVersion(value: FormDataEntryValue | null): number | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function fieldError(key: CandidateFactKey | null, message: string): Readonly<Record<string, string>> | undefined {
  return key ? { [key]: message } : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function saveCandidateFactAction(
  _previousState: CandidateProfileActionState,
  formData: FormData,
): Promise<CandidateProfileActionState> {
  const actor = await getOptionalActor();
  if (!actor) return { outcome: "error", message: "Sign in again before saving an answer." };

  const rawKey = String(formData.get("factKey") ?? "");
  if (!isCandidateFactKey(rawKey)) {
    return { outcome: "error", message: "This answer type is not supported." };
  }
  const expectedAggregateVersion = parseVersion(formData.get("expectedAggregateVersion"));
  if (expectedAggregateVersion === undefined) {
    return { outcome: "error", message: "Reload before saving this answer." };
  }
  const rawValue = String(formData.get("value") ?? "");
  const commandId = String(formData.get("commandId") ?? "");
  if (!UUID_PATTERN.test(commandId)) {
    return { outcome: "error", message: "Reload before saving this answer." };
  }

  try {
    await saveCandidateFact(actor, {
      commandId,
      key: rawKey,
      rawValue,
      expectedAggregateVersion,
    });
    revalidatePath("/vault/answers");
    revalidatePath("/vault/facts");
    revalidatePath("/dashboard");
    revalidatePath("/onboarding");
    return { outcome: "success", message: "Answer saved." };
  } catch (error) {
    if (error instanceof CandidateProfileError) {
      return {
        outcome: "error",
        message: error.message,
        fieldErrors: fieldError(error.field, error.message),
      };
    }
    return { outcome: "error", message: "This answer could not be saved." };
  }
}

export type SaveAnswersResult = Readonly<{
  saved: readonly CandidateFactKey[];
  errors: Readonly<Record<string, string>>;
  message: string | null;
}>;

/** Saves several answers from one section; each answer is still its own command. */
export async function saveCandidateAnswersAction(entries: readonly Readonly<{
  key: string;
  rawValue: string;
  commandId: string;
  expectedAggregateVersion: number | null;
}>[]): Promise<SaveAnswersResult> {
  const actor = await getOptionalActor();
  if (!actor) return { saved: [], errors: {}, message: "Sign in again before saving." };
  const saved: CandidateFactKey[] = [];
  const errors: Record<string, string> = {};
  for (const entry of entries.slice(0, 40)) {
    if (!isCandidateFactKey(entry.key) || !UUID_PATTERN.test(entry.commandId)) {
      errors[entry.key] = "Reload before saving this answer.";
      continue;
    }
    try {
      await saveCandidateFact(actor, {
        commandId: entry.commandId,
        key: entry.key,
        rawValue: entry.rawValue,
        expectedAggregateVersion: entry.expectedAggregateVersion,
      });
      saved.push(entry.key);
    } catch (error) {
      errors[entry.key] = error instanceof CandidateProfileError ? error.message : "This answer couldn't be saved.";
    }
  }
  revalidatePath("/vault/answers");
  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  return { saved, errors, message: Object.keys(errors).length ? "Some answers need a fix." : null };
}
