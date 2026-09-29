export const ONBOARDING_MISSING_ITEM_CODES = [
  "RESUME",
  "GIVEN_NAME",
  "FAMILY_NAME",
  "LEGAL_NAME",
  "APPLICATION_EMAIL",
  "PHONE",
  "LOCATION",
  "SEARCH_RULES",
] as const;

export type OnboardingMissingItemCode = (typeof ONBOARDING_MISSING_ITEM_CODES)[number];
export const LEGACY_ONBOARDING_ELIGIBILITY_CODES = [
  "US_WORK_ELIGIBILITY",
  "CA_WORK_ELIGIBILITY",
] as const;
export type LegacyOnboardingEligibilityCode = (typeof LEGACY_ONBOARDING_ELIGIBILITY_CODES)[number];
export type OnboardingReadinessResponseCode = OnboardingMissingItemCode | LegacyOnboardingEligibilityCode;
export type CandidateAccountStatus = "ONBOARDING" | "ACTIVE" | "PAUSED";
export type CandidateOnboardingStep = "resume" | "goals" | "answers" | "finish";
export type CandidateWorkMode = "REMOTE" | "HYBRID" | "ONSITE";
export type CandidateEmploymentType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERN"
  | "TEMPORARY";

export const WORK_MODE_OPTIONS: readonly Readonly<{ value: CandidateWorkMode; label: string }>[] = Object.freeze([
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "On-site" },
]);

export const EMPLOYMENT_TYPE_OPTIONS: readonly Readonly<{ value: CandidateEmploymentType; label: string }>[] = Object.freeze([
  { value: "FULL_TIME", label: "Full-time" },
  { value: "PART_TIME", label: "Part-time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERN", label: "Internship" },
  { value: "TEMPORARY", label: "Temporary" },
]);

export type CandidateSearchProfileViewModel = Readonly<{
  targetRoles: readonly string[];
  preferredLocations: readonly string[];
  desiredCountryCodes: readonly ("US" | "CA")[];
  workModes: readonly CandidateWorkMode[];
  employmentTypes: readonly CandidateEmploymentType[];
  aggregateVersion: number | null;
}>;

export type CandidateOnboardingReadiness = Readonly<{
  candidateStatus: CandidateAccountStatus;
  missingItems: readonly OnboardingMissingItemCode[];
}>;

export type CandidateSearchProfileActionState = Readonly<{
  outcome: "idle" | "success" | "error";
  message: string;
}>;

export const EMPTY_SEARCH_PROFILE_ACTION_STATE: CandidateSearchProfileActionState = Object.freeze({
  outcome: "idle",
  message: "",
});

export type CandidateSearchProfileFormAction = (
  previousState: CandidateSearchProfileActionState,
  formData: FormData,
) => Promise<CandidateSearchProfileActionState>;

const MISSING_ITEM_SET = new Set<string>(ONBOARDING_MISSING_ITEM_CODES);
const READINESS_RESPONSE_CODE_SET = new Set<string>([
  ...ONBOARDING_MISSING_ITEM_CODES,
  ...LEGACY_ONBOARDING_ELIGIBILITY_CODES,
]);
const WORK_MODE_SET = new Set<string>(WORK_MODE_OPTIONS.map((option) => option.value));
const EMPLOYMENT_TYPE_SET = new Set<string>(EMPLOYMENT_TYPE_OPTIONS.map((option) => option.value));

export function isOnboardingMissingItemCode(value: unknown): value is OnboardingMissingItemCode {
  return typeof value === "string" && MISSING_ITEM_SET.has(value);
}

export function isOnboardingReadinessResponseCode(value: unknown): value is OnboardingReadinessResponseCode {
  return typeof value === "string" && READINESS_RESPONSE_CODE_SET.has(value);
}

export function isCandidateWorkMode(value: unknown): value is CandidateWorkMode {
  return typeof value === "string" && WORK_MODE_SET.has(value);
}

export function isCandidateEmploymentType(value: unknown): value is CandidateEmploymentType {
  return typeof value === "string" && EMPLOYMENT_TYPE_SET.has(value);
}

function cleanListValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function parseCandidatePreferenceList(
  rawValue: string,
  limits: Readonly<{ maxItems: number; maxItemLength?: number; splitCommas?: boolean }>,
): readonly string[] {
  const maxItemLength = limits.maxItemLength ?? 120;
  const values = rawValue
    .split(limits.splitCommas === false ? /\n/gu : /[\n,]/gu)
    .map(cleanListValue)
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (value.length > maxItemLength) throw new Error("CANDIDATE_SEARCH_PROFILE_ITEM_TOO_LONG");
    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  if (unique.length > limits.maxItems) throw new Error("CANDIDATE_SEARCH_PROFILE_TOO_MANY_ITEMS");
  return Object.freeze(unique);
}

export function firstIncompleteOnboardingStep(
  missingItems: readonly OnboardingMissingItemCode[],
): CandidateOnboardingStep {
  const missing = new Set(missingItems);
  if (missing.has("RESUME")) return "resume";
  if (missing.has("SEARCH_RULES")) return "goals";
  if ([
    "GIVEN_NAME",
    "FAMILY_NAME",
    "LEGAL_NAME",
    "APPLICATION_EMAIL",
    "PHONE",
    "LOCATION",
  ].some((code) => missing.has(code as OnboardingMissingItemCode))) return "answers";
  return "finish";
}

export function onboardingProgress(missingItems: readonly OnboardingMissingItemCode[]): number {
  const step = firstIncompleteOnboardingStep(missingItems);
  if (step === "resume") return 25;
  if (step === "goals") return 50;
  if (step === "answers") return 75;
  return 100;
}
