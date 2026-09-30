"use server";

import { revalidatePath } from "next/cache";

import {
  type CandidateFactKey,
  isCandidateFactKey,
} from "@/domain/candidate-profile";
import { getOptionalActor } from "@/server/auth/session";
import {
  CandidateProfileError,
  saveCandidateFact,
} from "@/server/vault/candidate-profile";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
