export const CANDIDATE_FACT_KEYS = [
  "identity.given_name",
  "identity.family_name",
  "identity.legal_name",
  "contact.application_email",
  "contact.phone",
  "contact.linkedin_url",
  "contact.website_url",
  "location.city",
  "location.region",
  "location.country_code",
  "work_authorization.us.authorized",
  "work_authorization.us.sponsorship_required",
  "work_authorization.ca.authorized",
  "work_authorization.ca.sponsorship_required",
  "identity.preferred_name",
  "identity.pronouns",
  "contact.address_line1",
  "contact.address_line2",
  "location.postal_code",
  "compensation.expected_salary",
  "availability.start_date",
  "preferences.willing_to_relocate",
  "application.heard_about",
  "education.highest_degree",
  "self_id.gender",
  "self_id.hispanic_latino",
  "self_id.race_ethnicity",
  "self_id.veteran_status",
  "self_id.disability_status",
] as const;

export type CandidateFactKey = (typeof CANDIDATE_FACT_KEYS)[number];
export type CandidateFactSensitivity = "STANDARD" | "SENSITIVE" | "PROTECTED";
export type CandidateFactUsagePolicy =
  | "EXACT_FIELDS"
  | "RESUME_AND_ANSWERS"
  | "NARRATIVE_ONLY"
  | "NEVER_AUTOFILL";

export type CandidateFactValue = string | boolean | "unsure";

export type CandidateFactGroup =
  | "IDENTITY"
  | "CONTACT"
  | "LOCATION"
  | "WORK_ELIGIBILITY"
  | "APPLICATION"
  | "SELF_ID";

export type CandidateFactDefinition = Readonly<{
  key: CandidateFactKey;
  label: string;
  sensitivity: CandidateFactSensitivity;
  usagePolicy: CandidateFactUsagePolicy;
  group: CandidateFactGroup;
  /** Fixed answer choices. Free text when absent. */
  choices?: readonly string[];
  /** Pre-selected answer shown to the candidate; saved only when they save. */
  suggestedValue?: string;
  placeholder?: string;
  help?: string;
}>;

/** The explicit answer every voluntary self-identification question defaults to. */
export const DECLINE_TO_SELF_IDENTIFY = "Decline to self-identify";

export const CANDIDATE_FACT_DEFINITIONS: readonly CandidateFactDefinition[] = Object.freeze([
  { key: "identity.given_name", label: "First name", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "IDENTITY" },
  { key: "identity.family_name", label: "Last name", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "IDENTITY" },
  { key: "identity.legal_name", label: "Full legal name", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "IDENTITY" },
  { key: "contact.application_email", label: "Application email", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "CONTACT" },
  { key: "contact.phone", label: "Phone number", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "CONTACT" },
  { key: "contact.linkedin_url", label: "LinkedIn", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "CONTACT" },
  { key: "contact.website_url", label: "Portfolio or website", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "CONTACT" },
  { key: "location.city", label: "City", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "LOCATION" },
  { key: "location.region", label: "State or region", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "LOCATION" },
  { key: "location.country_code", label: "Country", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "LOCATION" },
  { key: "work_authorization.us.authorized", label: "Authorized to work in the United States", sensitivity: "SENSITIVE", usagePolicy: "EXACT_FIELDS", group: "WORK_ELIGIBILITY" },
  { key: "work_authorization.us.sponsorship_required", label: "Needs U.S. employer sponsorship", sensitivity: "SENSITIVE", usagePolicy: "EXACT_FIELDS", group: "WORK_ELIGIBILITY" },
  { key: "work_authorization.ca.authorized", label: "Authorized to work in Canada", sensitivity: "SENSITIVE", usagePolicy: "EXACT_FIELDS", group: "WORK_ELIGIBILITY" },
  { key: "work_authorization.ca.sponsorship_required", label: "Needs Canadian employer sponsorship", sensitivity: "SENSITIVE", usagePolicy: "EXACT_FIELDS", group: "WORK_ELIGIBILITY" },
  { key: "identity.preferred_name", label: "Preferred first name", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "IDENTITY", help: "Only if it differs from your legal first name." },
  { key: "identity.pronouns", label: "Pronouns", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "IDENTITY", placeholder: "Optional" },
  { key: "contact.address_line1", label: "Street address", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "LOCATION", help: "Some employer forms require it. Never printed on your résumé." },
  { key: "contact.address_line2", label: "Apartment or suite", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "LOCATION", placeholder: "Optional" },
  { key: "location.postal_code", label: "ZIP or postal code", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "LOCATION" },
  { key: "compensation.expected_salary", label: "Salary expectation", sensitivity: "SENSITIVE", usagePolicy: "EXACT_FIELDS", group: "APPLICATION", placeholder: "e.g. $140,000–$160,000 base", help: "Used only when a form asks. Leave blank to be asked each time." },
  { key: "availability.start_date", label: "Earliest start", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "APPLICATION", placeholder: "e.g. Two weeks after an offer", suggestedValue: "Two weeks after an offer" },
  { key: "preferences.willing_to_relocate", label: "Open to relocating", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "APPLICATION", choices: ["Yes", "No", "Open to discussing"] },
  { key: "application.heard_about", label: "How you found the job", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "APPLICATION", suggestedValue: "Company careers page", help: "Answer for “How did you hear about us?”" },
  { key: "education.highest_degree", label: "Highest degree", sensitivity: "STANDARD", usagePolicy: "EXACT_FIELDS", group: "APPLICATION", choices: ["High school diploma or GED", "Some college", "Associate degree", "Bachelor's degree", "Master's degree", "MBA", "Doctorate", "Professional degree (JD, MD, etc.)"] },
  { key: "self_id.gender", label: "Gender", sensitivity: "PROTECTED", usagePolicy: "EXACT_FIELDS", group: "SELF_ID", choices: ["Man", "Woman", "Non-binary", DECLINE_TO_SELF_IDENTIFY], suggestedValue: DECLINE_TO_SELF_IDENTIFY },
  { key: "self_id.hispanic_latino", label: "Hispanic or Latino", sensitivity: "PROTECTED", usagePolicy: "EXACT_FIELDS", group: "SELF_ID", choices: ["Yes", "No", DECLINE_TO_SELF_IDENTIFY], suggestedValue: DECLINE_TO_SELF_IDENTIFY },
  { key: "self_id.race_ethnicity", label: "Race or ethnicity", sensitivity: "PROTECTED", usagePolicy: "EXACT_FIELDS", group: "SELF_ID", choices: ["American Indian or Alaska Native", "Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander", "White", "Two or more races", DECLINE_TO_SELF_IDENTIFY], suggestedValue: DECLINE_TO_SELF_IDENTIFY },
  { key: "self_id.veteran_status", label: "Veteran status", sensitivity: "PROTECTED", usagePolicy: "EXACT_FIELDS", group: "SELF_ID", choices: ["I am not a protected veteran", "I identify as a protected veteran", DECLINE_TO_SELF_IDENTIFY], suggestedValue: DECLINE_TO_SELF_IDENTIFY },
  { key: "self_id.disability_status", label: "Disability status", sensitivity: "PROTECTED", usagePolicy: "EXACT_FIELDS", group: "SELF_ID", choices: ["No, I do not have a disability", "Yes, I have a disability (or previously had one)", DECLINE_TO_SELF_IDENTIFY], suggestedValue: DECLINE_TO_SELF_IDENTIFY },
]);

/** Keys written through `save_candidate_answer_fact` rather than the original commands. */
export const CANDIDATE_ANSWER_FACT_KEYS: ReadonlySet<CandidateFactKey> = new Set<CandidateFactKey>([
  "identity.preferred_name",
  "identity.pronouns",
  "contact.address_line1",
  "contact.address_line2",
  "location.postal_code",
  "compensation.expected_salary",
  "availability.start_date",
  "preferences.willing_to_relocate",
  "application.heard_about",
  "education.highest_degree",
  "self_id.gender",
  "self_id.hispanic_latino",
  "self_id.race_ethnicity",
  "self_id.veteran_status",
  "self_id.disability_status",
]);

const DEFINITION_BY_KEY = new Map(CANDIDATE_FACT_DEFINITIONS.map((definition) => [definition.key, definition]));

export function isCandidateFactKey(value: string): value is CandidateFactKey {
  return DEFINITION_BY_KEY.has(value as CandidateFactKey);
}

export function candidateFactDefinition(key: CandidateFactKey): CandidateFactDefinition {
  const definition = DEFINITION_BY_KEY.get(key);
  if (!definition) throw new Error("CANDIDATE_FACT_DEFINITION_MISSING");
  return definition;
}

export type CandidateProfileFactView = Readonly<{
  factId: string;
  factVersionId: string;
  key: CandidateFactKey;
  label: string;
  value: CandidateFactValue;
  displayValue: string;
  sensitivity: CandidateFactSensitivity;
  usagePolicy: CandidateFactUsagePolicy;
  aggregateVersion: number;
  factVersionNumber: number;
  reviewedAt: string;
  sourceKind: "CANDIDATE_ENTRY" | "RESUME_EVIDENCE";
  resolved: boolean;
}>;

export type CandidateProfileViewModel = Readonly<{
  actorLabel: string;
  accountEmail: string | null;
  facts: readonly CandidateProfileFactView[];
}>;

export type CandidateProfileActionState = Readonly<{
  outcome: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Readonly<Record<string, string>>;
}>;

export type CandidateProfileFormAction = (
  previousState: CandidateProfileActionState,
  formData: FormData,
) => Promise<CandidateProfileActionState>;

export const EMPTY_CANDIDATE_PROFILE_ACTION_STATE: CandidateProfileActionState = Object.freeze({
  outcome: "idle",
  message: "",
});
