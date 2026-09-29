/**
 * Server-side resolution of one approved value to one observed option. Only
 * exact matches after normalization (case, diacritics, abbreviation periods,
 * separators) and a small fixed alias table count. There is no "closest"
 * option: no unique exact match means the field stays with the candidate.
 */
export type OptionSemantic = "COUNTRY" | "REGION" | "CITY" | "SELF_ID";
/** Largest fully rendered option list the server resolves itself. */
export const MAX_SEARCHABLE_OPTIONS = 5_000;
/** Lists longer than this are shown to the model as a sample plus a count. */
export const MODEL_OPTION_SAMPLE = 40;
export type OptionMatch = Readonly<{
  /** Set only when the field's own anchored label classified it for this kind of fact. */
  semantic?: OptionSemantic | null;
  /** Approved region/country facts used to confirm the rest of a location result. */
  hints?: Readonly<{ region?: string | null; country?: string | null }>;
  /** A candidate-typed answer may pick a longer search result that starts with it. */
  source?: "FACT" | "ANSWER";
}>;
export type ObservedOption = Readonly<{ value: string; label: string }>;

/** Candidate country facts are validated to these ISO codes. */
const COUNTRY_ALIASES: readonly (readonly string[])[] = [
  ["US", "USA", "United States", "United States of America", "The United States", "The United States of America"],
  ["CA", "CAN", "Canada"],
];

const REGION_ALIASES: readonly (readonly string[])[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia", "Washington DC", "Washington D.C."], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"],
  ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"],
  ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands", "US Virgin Islands", "United States Virgin Islands"],
  ["AS", "American Samoa"], ["MP", "Northern Mariana Islands"],
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"],
  ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

/**
 * Voluntary self-identification wordings. Each group is one claim spelled
 * several ways; a saved answer never widens to a different claim. "I am not a
 * protected veteran" is not "I am not a veteran", and "No, I do not have a
 * disability" is not "...and have not had one in the past". Anything outside a
 * group must match the saved choice exactly, or the question goes to the
 * candidate.
 */
const SELF_ID_ALIASES: readonly (readonly string[])[] = [
  ["Decline to self-identify", "I decline to self-identify", "Decline to identify", "Decline to answer", "Decline to state", "Decline",
    "I don't wish to answer", "I do not wish to answer", "I don't want to answer", "I do not want to answer",
    "I prefer not to answer", "Prefer not to answer", "I prefer not to say", "Prefer not to say", "I'd prefer not to say", "I would prefer not to say",
    "I choose not to answer", "Choose not to answer", "I choose not to disclose", "Choose not to disclose",
    "I don't wish to disclose", "I do not wish to disclose", "I prefer not to disclose", "Prefer not to disclose",
    "I don't wish to self-identify", "I do not wish to self-identify", "I choose not to self-identify", "I prefer not to self-identify",
    "Rather not say", "I'd rather not say",
    // Lever's standard veteran question words its decline option this way.
    "I decline to self-identify for protected veteran status"],
  ["Man", "Male"],
  ["Woman", "Female"],
  ["Non-binary", "Nonbinary"],
  ["American Indian or Alaska Native", "American Indian or Alaskan Native", "American Indian/Alaska Native", "American Indian/Alaskan Native"],
  ["Black or African American", "Black/African American"],
  ["Native Hawaiian or Other Pacific Islander", "Native Hawaiian/Other Pacific Islander", "Native Hawaiian or Pacific Islander", "Native Hawaiian/Pacific Islander"],
  ["Two or more races", "Multiracial"],
  ["I am not a protected veteran", "Not a protected veteran", "No, I am not a protected veteran"],
  ["I identify as a protected veteran", "I am a protected veteran", "Yes, I am a protected veteran",
    "I identify as one or more of the classifications of protected veteran", "I identify as one or more of the classifications of protected veterans",
    "I identify as one or more of the classifications of protected veteran listed above",
    // Greenhouse's standard self-identification section, and a custom Greenhouse wording.
    "I identify as one or more of the classifications of a protected veteran", "I am one or more of the classifications of protected veterans"],
  ["No, I do not have a disability", "No, I don't have a disability"],
  ["Yes, I have a disability (or previously had one)", "Yes, I have a disability, or have had one in the past",
    "Yes, I have a disability (or previously had a disability)", "Yes, I have (or have previously had) a disability"],
];

export function normalizeOptionText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
    // "U.S.A." and "St." lose abbreviation periods; "1.5" keeps its decimal point.
    .replace(/(?<=\p{L})\.+/gu, "")
    .replace(/[’']/gu, "")
    .replace(/&/gu, " and ")
    .replace(/[\s\-_,;:()[\]"/]+/gu, " ")
    .trim();
}

function aliasTable(table: readonly (readonly string[])[]) {
  const index = new Map<string, ReadonlySet<string>>();
  for (const entry of table) {
    const group = new Set(entry.map(normalizeOptionText));
    for (const alias of group) {
      if (index.has(alias)) throw new Error("OPTION_ALIAS_TABLE_AMBIGUOUS");
      index.set(alias, group);
    }
  }
  return index;
}
const COUNTRIES = aliasTable(COUNTRY_ALIASES);
const REGIONS = aliasTable(REGION_ALIASES);
const SELF_ID = aliasTable(SELF_ID_ALIASES);

/** Every exact spelling accepted for an approved value of this semantic. */
export function optionAliases(value: string, semantic: OptionSemantic | null | undefined): ReadonlySet<string> {
  const normalized = normalizeOptionText(value);
  const table = semantic === "COUNTRY" ? COUNTRIES : semantic === "REGION" ? REGIONS : semantic === "SELF_ID" ? SELF_ID : null;
  return table?.get(normalized) ?? new Set(normalized ? [normalized] : []);
}

// "United States (+1)", "Canada +1" and "United States (US)" are the same
// entity spelled with a dial code or a parenthesized code.
function locationLabelMatches(label: string, aliases: ReadonlySet<string>, semantic: OptionSemantic): boolean {
  let base = label.trim();
  if (semantic === "COUNTRY") base = base.replace(/\s*\(?\+\d{1,4}(?:[\s-]\d{1,4})?\)?\s*$/u, "").trim();
  if (aliases.has(normalizeOptionText(base))) return true;
  const parts = /^(.+?)\s*\(([^()]+)\)$/u.exec(base);
  return Boolean(parts && aliases.has(normalizeOptionText(parts[1])) && aliases.has(normalizeOptionText(parts[2])));
}

/**
 * Returns the observed option value for an approved value, or throws
 * AGENTS_FILL_OPTION_AMBIGUOUS when zero or several options match exactly.
 */
export function resolveOptionValue(options: readonly ObservedOption[], answer: string, match?: OptionMatch): string {
  const semantic = match?.semantic ?? null;
  let matches: ObservedOption[];
  if (semantic === "COUNTRY" || semantic === "REGION") {
    // Location options are matched by their visible label: a value such as
    // "CA" could still be a different entity than the label shows.
    const aliases = optionAliases(answer, semantic);
    matches = options.filter((option) => locationLabelMatches(option.label, aliases, semantic));
  } else if (semantic === "SELF_ID") {
    // Self-identification options are matched by the wording the candidate
    // sees, never by an opaque option value.
    const aliases = optionAliases(answer, semantic);
    matches = options.filter((option) => aliases.has(normalizeOptionText(option.label)));
  } else {
    const exact = options.filter((option) => option.value === answer);
    if (exact.length === 1 && exact[0].value !== "") return exact[0].value;
    const target = normalizeOptionText(answer);
    matches = target ? options.filter((option) => normalizeOptionText(option.label) === target || normalizeOptionText(option.value) === target) : [];
  }
  const values = [...new Set(matches.map((option) => option.value))];
  if (values.length !== 1 || values[0] === "") throw new Error("AGENTS_FILL_OPTION_AMBIGUOUS");
  return values[0];
}

/**
 * Chooses one type-to-search result. A result qualifies when its leading
 * comma-separated segments equal the approved value's segments. For an
 * approved fact, every remaining segment must be the candidate's own approved
 * region or country; with no such facts, only an exact result qualifies. A
 * candidate-typed answer may pick a unique longer result that starts with it.
 */
export function chooseSearchResult(labels: readonly string[], query: string, match?: OptionMatch): string | null {
  const segments = (value: string) => value.split(",").map(normalizeOptionText).filter(Boolean);
  const wanted = segments(query);
  if (!wanted.length) return null;
  const semantic = match?.semantic ?? null;
  const allowed = new Set<string>([
    ...(match?.hints?.region ? optionAliases(match.hints.region, "REGION") : []),
    ...(match?.hints?.country ? optionAliases(match.hints.country, "COUNTRY") : []),
  ]);
  const leading = semantic === "REGION" ? optionAliases(query, "REGION") : null;
  const qualifying = labels.filter((label) => {
    const parts = segments(label);
    if (parts.length < wanted.length) return false;
    const head = parts.slice(0, wanted.length);
    const headMatches = leading && wanted.length === 1 ? leading.has(head[0]) : head.every((part, index) => part === wanted[index]);
    if (!headMatches) return false;
    const rest = parts.slice(wanted.length);
    if (match?.source === "ANSWER") return true;
    return rest.every((part) => allowed.has(part));
  });
  return new Set(qualifying).size === 1 && qualifying.length === 1 ? qualifying[0] : null;
}
