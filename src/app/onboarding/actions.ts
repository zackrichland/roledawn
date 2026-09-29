"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isCandidateEmploymentType,
  isCandidateWorkMode,
  parseCandidatePreferenceList,
  type CandidateSearchProfileActionState,
} from "@/domain/candidate-onboarding";
import { getOptionalActor } from "@/server/auth/session";
import {
  CandidateOnboardingError,
  completeCandidateOnboarding,
  saveCandidateSearchProfile,
} from "@/server/candidate/onboarding";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function parseVersion(value: FormDataEntryValue | null): number | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function stringValues(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((value): value is string => typeof value === "string");
}

export async function saveCandidateSearchProfileAction(
  _previousState: CandidateSearchProfileActionState,
  formData: FormData,
): Promise<CandidateSearchProfileActionState> {
  const actor = await getOptionalActor();
  if (!actor) return { outcome: "error", message: "Sign in again before saving your job preferences." };
  const commandId = String(formData.get("commandId") ?? "");
  const expectedAggregateVersion = parseVersion(formData.get("expectedAggregateVersion"));
  if (!UUID_PATTERN.test(commandId) || expectedAggregateVersion === undefined) {
    return { outcome: "error", message: "Reload before saving your job preferences." };
  }

  try {
    const targetRoles = parseCandidatePreferenceList(String(formData.get("targetRoles") ?? ""), { maxItems: 8 });
    const preferredLocations = parseCandidatePreferenceList(String(formData.get("preferredLocations") ?? ""), { maxItems: 12, splitCommas: false });
    const desiredCountryCodes = stringValues(formData, "desiredCountryCodes").filter(
      (value): value is "US" | "CA" => value === "US" || value === "CA",
    );
    const workModes = stringValues(formData, "workModes").filter(isCandidateWorkMode);
    const employmentTypes = stringValues(formData, "employmentTypes").filter(isCandidateEmploymentType);
    if (
      targetRoles.length === 0 ||
      desiredCountryCodes.length === 0 ||
      workModes.length === 0 ||
      employmentTypes.length === 0
    ) {
      return { outcome: "error", message: "Add a target role, country, work style, and job type." };
    }
    await saveCandidateSearchProfile(actor, {
      commandId,
      targetRoles,
      preferredLocations,
      desiredCountryCodes,
      workModes,
      employmentTypes,
      expectedAggregateVersion,
    });
    revalidatePath("/onboarding");
    revalidatePath("/search");
    revalidatePath("/saved");
    revalidatePath("/dashboard");
    return { outcome: "success", message: "Job preferences saved." };
  } catch (error) {
    if (error instanceof CandidateOnboardingError) {
      return { outcome: "error", message: error.message };
    }
    if (error instanceof Error && error.message === "CANDIDATE_SEARCH_PROFILE_TOO_MANY_ITEMS") {
      return { outcome: "error", message: "Keep this focused: up to 8 roles and 12 locations." };
    }
    if (error instanceof Error && error.message === "CANDIDATE_SEARCH_PROFILE_ITEM_TOO_LONG") {
      return { outcome: "error", message: "Shorten each role or location to 120 characters." };
    }
    return { outcome: "error", message: "Your job preferences could not be saved." };
  }
}

export async function completeCandidateOnboardingAction(formData: FormData): Promise<void> {
  const actor = await getOptionalActor();
  if (!actor) redirect("/login?next=/onboarding");
  const commandId = String(formData.get("commandId") ?? "");
  try {
    await completeCandidateOnboarding(actor, commandId);
  } catch (error) {
    const message = error instanceof CandidateOnboardingError
      ? error.message
      : "Setup is not complete yet.";
    redirect(`/onboarding?step=finish&error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
