import "server-only";

import {
  isCandidateEmploymentType,
  isCandidateWorkMode,
  isOnboardingMissingItemCode,
  isOnboardingReadinessResponseCode,
  type CandidateAccountStatus,
  type CandidateOnboardingReadiness,
  type CandidateSearchProfileViewModel,
  type CandidateEmploymentType,
  type CandidateWorkMode,
} from "@/domain/candidate-onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANDIDATE_STATUS_SET = new Set<string>(["ONBOARDING", "ACTIVE", "PAUSED"]);

export class CandidateOnboardingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CandidateOnboardingError";
  }
}

export type SaveCandidateSearchProfileCommand = Readonly<{
  commandId: string;
  targetRoles: readonly string[];
  preferredLocations: readonly string[];
  desiredCountryCodes: readonly ("US" | "CA")[];
  workModes: readonly CandidateWorkMode[];
  employmentTypes: readonly CandidateEmploymentType[];
  expectedAggregateVersion: number | null;
}>;

function actorLabel(actor: AuthenticatedActor): string {
  return actor.email?.split("@")[0]?.trim().slice(0, 80) || "Signed-in candidate";
}

function firstRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isCandidateAccountStatus(value: unknown): value is CandidateAccountStatus {
  return typeof value === "string" && CANDIDATE_STATUS_SET.has(value);
}

function parseCountryCode(value: unknown): "US" | "CA" | null {
  return value === "US" || value === "CA" ? value : null;
}

function profileReadError(): never {
  throw new CandidateOnboardingError(
    "CANDIDATE_ONBOARDING_READ_FAILED",
    "Your setup progress could not be loaded. Try again shortly.",
  );
}

export async function getCandidateOnboarding(
  actor: AuthenticatedActor,
): Promise<Readonly<{
  readiness: CandidateOnboardingReadiness;
  searchProfile: CandidateSearchProfileViewModel;
}>> {
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));
  const [readinessResult, profileResult] = await Promise.all([
    supabase.rpc("get_candidate_onboarding_readiness"),
    supabase
      .from("candidate_search_profiles")
      .select("target_roles, preferred_locations, desired_country_codes, work_modes, employment_types, aggregate_version")
      .limit(1)
      .maybeSingle(),
  ]);
  if (readinessResult.error || profileResult.error) profileReadError();
  const readinessRow = firstRow(readinessResult.data);
  if (!readinessRow || !isCandidateAccountStatus(readinessRow.candidate_status)) profileReadError();
  if (!Array.isArray(readinessRow.missing_items)) profileReadError();
  const responseCodes = readinessRow.missing_items.filter(isOnboardingReadinessResponseCode);
  if (responseCodes.length !== readinessRow.missing_items.length) profileReadError();
  // Older database revisions returned eligibility gaps as global onboarding
  // blockers. Keep accepting those wire values during a code-first rollout,
  // but surface only the ordinary profile fields that activate the account.
  // Eligibility remains an application-specific UNKNOWN / NEEDS_USER gate.
  const missingItems = responseCodes.filter(isOnboardingMissingItemCode);

  const profile = profileResult.data;
  if (!profile) {
    return Object.freeze({
      readiness: Object.freeze({
        candidateStatus: readinessRow.candidate_status,
        missingItems: Object.freeze(missingItems),
      }),
      searchProfile: Object.freeze({
        targetRoles: Object.freeze([]),
        preferredLocations: Object.freeze([]),
        desiredCountryCodes: Object.freeze([]),
        workModes: Object.freeze([]),
        employmentTypes: Object.freeze([]),
        aggregateVersion: null,
      }),
    });
  }

  const countryCodes = profile.desired_country_codes.map(parseCountryCode);
  const workModes = profile.work_modes.filter(isCandidateWorkMode);
  const employmentTypes = profile.employment_types.filter(isCandidateEmploymentType);
  if (
    countryCodes.some((value) => value === null) ||
    workModes.length !== profile.work_modes.length ||
    employmentTypes.length !== profile.employment_types.length ||
    !Number.isSafeInteger(profile.aggregate_version) ||
    profile.aggregate_version < 1
  ) profileReadError();

  return Object.freeze({
    readiness: Object.freeze({
      candidateStatus: readinessRow.candidate_status,
      missingItems: Object.freeze(missingItems),
    }),
    searchProfile: Object.freeze({
      targetRoles: Object.freeze(profile.target_roles),
      preferredLocations: Object.freeze(profile.preferred_locations),
      desiredCountryCodes: Object.freeze(countryCodes as ("US" | "CA")[]),
      workModes: Object.freeze(workModes),
      employmentTypes: Object.freeze(employmentTypes),
      aggregateVersion: profile.aggregate_version,
    }),
  });
}

function writeError(error: { code?: string; message?: string; details?: string } | null): never {
  const serverCode = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code;
  if (serverCode === "CANDIDATE_SEARCH_PROFILE_VERSION_MISMATCH") {
    throw new CandidateOnboardingError(serverCode, "These preferences changed in another tab. Reload before saving.");
  }
  if (serverCode === "CANDIDATE_ONBOARDING_INCOMPLETE") {
    throw new CandidateOnboardingError(serverCode, "Finish each setup step before continuing.");
  }
  throw new CandidateOnboardingError(
    serverCode ?? "CANDIDATE_ONBOARDING_SAVE_FAILED",
    "Your setup could not be saved. Try again.",
  );
}

export async function saveCandidateSearchProfile(
  actor: AuthenticatedActor,
  command: SaveCandidateSearchProfileCommand,
): Promise<void> {
  if (!UUID_PATTERN.test(command.commandId)) {
    throw new CandidateOnboardingError("CANDIDATE_SEARCH_PROFILE_COMMAND_INVALID", "Reload before saving these preferences.");
  }
  if (
    command.expectedAggregateVersion !== null &&
    (!Number.isSafeInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion < 1)
  ) {
    throw new CandidateOnboardingError("CANDIDATE_SEARCH_PROFILE_VERSION_INVALID", "Reload before saving these preferences.");
  }
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));
  const { error } = await supabase.rpc("save_candidate_search_profile", {
    p_command_id: command.commandId,
    p_target_roles: [...command.targetRoles],
    p_preferred_locations: [...command.preferredLocations],
    p_desired_country_codes: [...command.desiredCountryCodes],
    p_work_modes: [...command.workModes],
    p_employment_types: [...command.employmentTypes],
    ...(command.expectedAggregateVersion === null
      ? {}
      : { p_expected_aggregate_version: command.expectedAggregateVersion }),
  });
  if (error) writeError(error);
}

export async function completeCandidateOnboarding(
  actor: AuthenticatedActor,
  commandId: string,
): Promise<void> {
  if (!UUID_PATTERN.test(commandId)) {
    throw new CandidateOnboardingError("CANDIDATE_ONBOARDING_COMMAND_INVALID", "Reload before finishing setup.");
  }
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));
  const { error } = await supabase.rpc("complete_candidate_onboarding", {
    p_command_id: commandId,
  });
  if (error) writeError(error);
}
