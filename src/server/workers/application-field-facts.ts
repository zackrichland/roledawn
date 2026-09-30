import { CANDIDATE_ANSWER_FACT_KEYS, type CandidateFactKey } from "../../domain/candidate-profile.ts";
import type { OptionMatch, OptionSemantic } from "./agents-option-match.ts";

/**
 * Deterministic mapping from one observed employer field to one approved
 * candidate fact key. A wrong value in an employer form is worse than an empty
 * field, so every rule is a full, anchored label match over a small table and a
 * global exclusion list wins over every rule. Anything else returns null and is
 * left to the constrained model tools or to the candidate.
 */
export type FieldFactDescriptor = Readonly<{
  label: string;
  /** Observed control kind: TEXT, LONG_TEXT, SINGLE_SELECT, MULTI_SELECT, BOOLEAN, FILE or UNSUPPORTED. */
  kind: string;
  /** Native input type, `select-one` for a native select, or the ARIA role. */
  inputType: string;
  name?: string;
  domId?: string;
  /** Trusted observer metadata from the reviewed board adapter. */
  provider?: "ASHBY";
}>;

type FactLabelRule = Readonly<{
  factKey: CandidateFactKey;
  labels: readonly string[];
  kinds: Readonly<Partial<Record<string, readonly string[]>>>;
}>;

const TEXT_ONLY = ["", "text"] as const;
const LOCATION_KINDS = Object.freeze({
  TEXT: ["", "text", "search"],
  // Native select, or an ARIA combobox (input or element role).
  SINGLE_SELECT: ["select-one", "", "text", "search", "combobox"],
});

/**
 * Ordered table of accepted labels. Each entry is a regular-expression fragment
 * matched against the whole normalized label after an optional lead-in such as
 * "Please enter your" or "Current". Deliberately excluded: bare "Website"
 * (often a company or referral website), "Preferred/Legal/Middle" name
 * variants, "Work/Other/Alternate" contact points and combined "City, State".
 * A clean "Preferred name" is the saved preferred-name answer below, never the
 * given name.
 */
export const FACT_LABEL_RULES: readonly FactLabelRule[] = Object.freeze([
  { factKey: "identity.given_name", kinds: { TEXT: TEXT_ONLY },
    labels: ["first name", "firstname", "first", "given names?", "forenames?"] },
  { factKey: "identity.family_name", kinds: { TEXT: TEXT_ONLY },
    labels: ["last name", "lastname", "last", "family name", "surnames?", "family name/surname", "surname/family name",
      "last name/surname", "surname/last name", "last name/family name", "family name/last name"] },
  { factKey: "identity.legal_name", kinds: { TEXT: TEXT_ONLY },
    labels: ["name", "full name", "fullname", "legal name", "full legal name", "legal full name", "first and last name",
      "first & last name", "name \\(first and last\\)", "full name \\(first and last\\)", "candidate name", "applicant name"] },
  { factKey: "contact.application_email", kinds: { TEXT: ["", "text", "email"] },
    labels: ["e-?mail", "e-?mail address", "e-?mail id", "(?:personal|contact|primary) e-?mail(?: address)?",
      "(?:confirm|re-?enter|repeat|verify) (?:your )?e-?mail(?: address)?", "(?:candidate|applicant) e-?mail(?: address)?"] },
  { factKey: "contact.phone", kinds: { TEXT: ["", "text", "tel"] },
    labels: ["phone", "phone number", "phone no", "phone #", "telephone", "telephone number", "mobile", "mobile phone",
      "mobile number", "mobile phone number", "cell", "cellphone", "cell phone", "cell number", "cell phone number",
      "contact number", "contact phone(?: number)?", "(?:primary|personal) phone(?: number)?", "phone number \\(mobile\\)",
      "mobile/phone", "phone/mobile", "(?:candidate|applicant) phone(?: number)?"] },
  { factKey: "contact.linkedin_url", kinds: { TEXT: ["", "text", "url"] },
    labels: ["linkedin", "linkedin url", "linkedin profile", "linkedin profile url", "linkedin profile link", "linkedin link",
      "linkedin page", "linkedin \\(url\\)", "linkedin profile \\(url\\)", "(?:link|url) to (?:your )?linkedin(?: profile)?"] },
  { factKey: "contact.website_url", kinds: { TEXT: ["", "text", "url"] },
    labels: ["portfolio", "portfolio (?:url|link|website|site)", "online portfolio", "link to (?:your )?(?:online )?portfolio",
      "personal (?:website|web site|site|webpage|web page|homepage|home page)(?: url)?", "personal url", "website \\(personal\\)",
      "your (?:personal )?(?:website|web site|site)(?: url)?", "portfolio/(?:personal )?website(?: url)?",
      "(?:personal )?website/portfolio(?: url)?", "portfolio or (?:personal )?website(?: url)?", "(?:personal )?website or portfolio(?: url)?"] },
  { factKey: "location.city", kinds: LOCATION_KINDS,
    labels: ["city", "town", "city/town", "town/city", "city of residence", "residence city", "location \\(city\\)", "city \\(location\\)"] },
  { factKey: "location.region", kinds: LOCATION_KINDS,
    labels: ["state", "province", "region", "state/province", "province/state", "state or province", "province or state",
      "state/region", "region/state", "state or region", "state/province/region", "province/territory", "state/territory",
      "(?:state|province|region|state/province) of residence", "location \\((?:state|province|region|state/province)\\)"] },
  { factKey: "location.country_code", kinds: LOCATION_KINDS,
    labels: ["country", "country of residence", "location \\(country\\)"] },
] satisfies FactLabelRule[]);

const LEAD_IN = String.raw`(?:(?:please )?(?:enter|provide) )?(?:(?:your|current) )?`;
const COMPILED_RULES = FACT_LABEL_RULES.map((rule) => Object.freeze({
  ...rule, pattern: new RegExp(`^${LEAD_IN}(?:${rule.labels.join("|")})$`, "u"),
}));

type AnswerLabelRule = FactLabelRule & Readonly<{
  /** Extra words that disqualify the label or field identifiers for this answer only. */
  excluded?: string;
}>;

// Native select, ARIA combobox (input or element role) or a radio group.
const CHOICE = ["select-one", "", "text", "search", "combobox", "radio"] as const;
const SELF_ID_KINDS = Object.freeze({ SINGLE_SELECT: CHOICE });
const FOR_ROLE = String.raw`(?: for this (?:role|position|job|opportunity))?`;
const PAY = String.raw`(?:(?:annual|yearly|base|annual base|base annual|total) )?(?:salary|compensation|pay)`;
const JOB_NOUN = String.raw`(?:job|role|position|opportunity|opening|posting|vacancy|job posting|job opening|job opportunity)`;
const COMPANY_NAME = String.raw`[\p{L}\p{N}&.'-]+(?: [\p{L}\p{N}&.'-]+){0,2}`;
const JOB_REF = String.raw`(?:this|the|our) ${JOB_NOUN}(?: (?:at|with) ${COMPANY_NAME})?`;
const COMPLETED = String.raw`(?:completed|attained|achieved|obtained|earned|received)`;
const EDUCATION_LEVEL = String.raw`(?:level of education|education(?:al)? level|education|educational attainment|degree(?: level)?|academic degree|qualification|level of (?:schooling|study))`;
const ADDRESS_EXCLUDED = String.raw`billing|shipping|mailing|permanent|temporary|hometown|work|e-?mail|web|ip`;

/**
 * Reusable answers the candidate saved for specific questions. These rules
 * have their own lead-in and exclusions because the global EXCLUDED list
 * rejects the very words these questions use ("preferred", "expected", "how",
 * "when", "salary"). Every rule is still a full anchored match: "Current
 * salary", a bare "Start date" (often employment history), a bare "Address" or
 * "Degree", "Sex" and relocation-assistance questions stay unmapped. Each
 * answer is written only where its own rule matches (see assertFactCompatible).
 */
export const ANSWER_LABEL_RULES: readonly AnswerLabelRule[] = Object.freeze([
  { factKey: "identity.preferred_name", kinds: { TEXT: TEXT_ONLY },
    labels: [String.raw`preferred (?:first |given )?name(?: \(if different\))?`, String.raw`(?:first|given) name \(preferred\)`, String.raw`preferred name \(first\)`],
    excluded: String.raw`last|family|surname|middle|legal|full|maiden|nick ?names?|alias\w*|pronunciation|phonetic|spelling` },
  { factKey: "identity.pronouns", kinds: { TEXT: TEXT_ONLY, SINGLE_SELECT: CHOICE },
    labels: ["(?:preferred |personal |gender )?pronouns?", "what are your (?:preferred |personal )?pronouns", "which pronouns do you use", "pronouns you use"] },
  { factKey: "contact.address_line1", kinds: { TEXT: TEXT_ONLY },
    labels: ["street", "street address", "(?:home|residential) street address", "(?:street )?address(?: line)? ?(?:1|one)", String.raw`(?:street )?address \(line 1\)`],
    excluded: ADDRESS_EXCLUDED },
  { factKey: "contact.address_line2", kinds: { TEXT: TEXT_ONLY },
    labels: ["(?:street )?address(?: line)? ?(?:2|two)", String.raw`(?:street )?address \(line 2\)`, "(?:apartment|apt|suite)(?: (?:number|no|#))?",
      "(?:apartment|apt|suite|unit)(?:(?:, ?|/| or | )(?:apartment|apt|suite|ste|unit|building|bldg|floor|room|etc))+"],
    excluded: ADDRESS_EXCLUDED },
  { factKey: "location.postal_code", kinds: { TEXT: TEXT_ONLY },
    labels: ["zip(?: ?code)?", "postal code", "post ?code", "(?:zip|postal)(?: ?code)?(?:/| or )(?:zip|postal|post)(?: ?code)?", "(?:zip|postal) code of residence"],
    excluded: ADDRESS_EXCLUDED },
  // Only an expectation. "Current", past or hourly pay never takes it.
  { factKey: "compensation.expected_salary", kinds: { TEXT: TEXT_ONLY, LONG_TEXT: ["textarea"] },
    labels: [`${PAY} (?:expectations?|requirements?)${FOR_ROLE}`, `(?:expected|desired|target) ${PAY}(?: range)?${FOR_ROLE}`,
      String.raw`(?:salary|compensation|pay) \((?:expected|desired)\)`, `(?:please )?state your ${PAY} (?:expectations?|requirements?)${FOR_ROLE}`,
      `what (?:are|is) your ${PAY} (?:expectations?|requirements?)${FOR_ROLE}`, `what (?:are|is) your (?:expected|desired|target) ${PAY}(?: range)?${FOR_ROLE}`,
      `what (?:salary|compensation|pay)(?: range)? are you (?:looking for|seeking|expecting|targeting)${FOR_ROLE}`,
      "what are you (?:looking for|seeking|expecting) (?:in terms of|for) (?:salary|compensation|pay)"],
    excluded: String.raw`current\w*|present|last|recent|history|historical|existing|hourly|monthly|weekly|daily|per hour|rate|bonus|equity|stock|commission` },
  { factKey: "availability.start_date", kinds: { TEXT: TEXT_ONLY, LONG_TEXT: ["textarea"], SINGLE_SELECT: CHOICE },
    labels: ["(?:earliest|expected|desired|preferred|anticipated|available|proposed|target)(?: possible)? start(?:ing)? date", "start date availability",
      "availability to (?:start|begin)(?: work(?:ing)?)?", "date available (?:to (?:start|begin)|for (?:work|employment))",
      "(?:if (?:offered|hired|selected), )?when (?:can|could|would) you (?:start|begin)(?: work(?:ing)?)?",
      "when (?:are|would) you (?:be )?(?:available|able) to (?:start|begin)(?: work(?:ing)?)?", "how soon (?:can|could|would) you (?:start|begin)(?: work(?:ing)?)?",
      "how soon (?:are|would) you (?:be )?(?:available|able) to (?:start|begin)(?: work(?:ing)?)?",
      "when is the earliest (?:date )?(?:that )?you (?:can|could) (?:start|begin)(?: work(?:ing)?)?(?: (?:in|for) this (?:role|position|job|opportunity))?",
      "what is your (?:earliest|expected|desired|preferred|anticipated|available|target)(?: possible)? start(?:ing)? date"],
    excluded: String.raw`interview\w*` },
  { factKey: "preferences.willing_to_relocate", kinds: { TEXT: TEXT_ONLY, SINGLE_SELECT: CHOICE },
    labels: [`(?:are you )?(?:willing|open) to relocat(?:e|ion|ing)${FOR_ROLE}`, `would you (?:be )?(?:willing|open) to relocat(?:e|ion)${FOR_ROLE}`,
      `would you (?:consider )?relocat(?:e|ing)${FOR_ROLE}`, "(?:willingness|openness) to relocate"],
    excluded: String.raw`assist\w*|package|reimburs\w*|expense\w*|support|benefit\w*|stipend|bonus|cost\w*|allowance|require\w*|need\w*|help` },
  // Company names are accepted after "hear about" only: "How did you learn
  // about Python?" is a skills question, not a source question.
  { factKey: "application.heard_about", kinds: { TEXT: TEXT_ONLY, LONG_TEXT: ["textarea"], SINGLE_SELECT: CHOICE },
    labels: [String.raw`how did you (?:first )?hear about (?:us|it|${JOB_REF}|(?!(?:our|this|the|your|my|a|an|it|us)\b)${COMPANY_NAME})`,
      `how did you (?:first )?(?:learn|find out) about (?:us|${JOB_REF})`, `where did you (?:first )?(?:hear|learn) about (?:us|${JOB_REF})`,
      `how did you (?:find|discover|come across) (?:us|${JOB_REF})`, `where did you (?:find|see|discover|come across) ${JOB_REF}`] },
  { factKey: "education.highest_degree", kinds: { TEXT: TEXT_ONLY, SINGLE_SELECT: CHOICE },
    labels: [`highest ${EDUCATION_LEVEL}(?: (?:you have |you've )?${COMPLETED})?`, `what is (?:your|the) highest ${EDUCATION_LEVEL}(?: (?:you have |you've )?${COMPLETED})?`,
      `(?:level of education|education(?:al)? level)(?: ${COMPLETED})?`],
    excluded: String.raw`major|minor|discipline|field|gpa|pursu\w*|current\w*|expected|anticipated|required|requirement\w*|minimum|preferred` },
  // Voluntary self-identification: choice controls only, never free text.
  { factKey: "self_id.gender", kinds: SELF_ID_KINDS,
    labels: ["gender(?: identity)?", "what is your gender(?: identity)?", "what gender do you identify (?:as|with)", "i identify my gender as"],
    excluded: String.raw`pronouns?|assigned|sex|sexual|orientation|trans\w*|expression|history` },
  { factKey: "self_id.hispanic_latino", kinds: SELF_ID_KINDS,
    labels: ["(?:are you )?(?:of )?hispanic(?:/| or |, )latin(?:o|a|x|e)(?:/a|/o)?(?: (?:origin|descent|heritage|ethnicity))?", "are you hispanic"] },
  { factKey: "self_id.race_ethnicity", kinds: SELF_ID_KINDS,
    // A "select one" instruction keeps the single-answer question; "check all
    // that apply" (a different, multi-answer question) stays unmapped.
    labels: ["race", "race(?:/| or | and | & |, )ethnicity", "ethnicity(?:/| or | and | & |, )race", "what is your race(?:(?:/| or | and )ethnicity)?",
      String.raw`race \((?:please )?select one(?: option)?(?: that best describes (?:how you identify|you))?\)`] },
  { factKey: "self_id.veteran_status", kinds: SELF_ID_KINDS,
    labels: ["(?:protected )?veteran(?:'s)? status", "veteran", String.raw`are you a (?:protected |u\.?s\.? |military )?veteran`, String.raw`(?:u\.?s\.? )?military veteran(?: status)?`] },
  { factKey: "self_id.disability_status", kinds: SELF_ID_KINDS,
    labels: ["disability(?: status)?", "do you have a disability", "(?:voluntary )?self-identification of disability", "disability self-identification"],
    excluded: String.raw`accommodat\w*|insurance|benefit\w*|leave` },
] satisfies AnswerLabelRule[]);

/**
 * Every saved answer is refused for another person, an organization, a past
 * status, a different variant or a free-text prompt, in the label or in the
 * field's name and ID.
 */
const ANSWER_EXCLUDED = String.raw`refer\w*|recommend\w*|emergency|kin|manager\w*|supervisor\w*|boss|reference\w*|recruiter\w*|interviewer\w*|agenc(?:y|ies)|agent|spouse|partner\w*|husband|wife|parent\w*|guardian\w*|mother|father|relative\w*|sibling\w*|dependent\w*|child\w*|family members?|previous\w*|prior|former\w*|past|compan(?:y|ies)|employer\w*|business\w*|organi[sz]ation\w*|firm|office|school\w*|universit\w*|college\w*|institution\w*|campus|other|additional|secondary|alternat\w*|backup|describe|explain|why|tell us|citizen\w*|nationality|passport\w*|birth\w*|sponsor\w*|visa`;
const ANSWER_LEAD_IN = String.raw`(?:(?:please )?(?:enter|provide|share|select|indicate|list) )?(?:your )?`;
const COMPILED_ANSWER_RULES = ANSWER_LABEL_RULES.map((rule) => Object.freeze({
  ...rule,
  pattern: new RegExp(`^${ANSWER_LEAD_IN}(?:${rule.labels.join("|")})$`, "u"),
  excludedPattern: new RegExp(String.raw`\b(?:${ANSWER_EXCLUDED}${rule.excluded ? `|${rule.excluded}` : ""})\b`, "u"),
}));
// An answer key without a rule here classifies nowhere, so it is never filled
// (fail closed); a test keeps this table complete.
const ANSWER_RULE_BY_KEY = new Map<string, (typeof COMPILED_ANSWER_RULES)[number]>(COMPILED_ANSWER_RULES.map((rule) => [rule.factKey, rule]));

function answerRuleMatches(rule: (typeof COMPILED_ANSWER_RULES)[number], label: string, identifiers: string): boolean {
  return rule.pattern.test(label) && !rule.excludedPattern.test(label) && !rule.excludedPattern.test(identifiers);
}

/** True for a candidate-saved answer that may only reach its own anchored question. */
export function isCandidateAnswerFactKey(factKey: string): boolean {
  return CANDIDATE_ANSWER_FACT_KEYS.has(factKey as CandidateFactKey);
}

/**
 * Global exclusions: another person or organization, a different identity or
 * contact point, compensation, sentences and free-text prompts. These win over
 * every positive rule, input type and autocomplete hint.
 */
const EXCLUDED = new RegExp(String.raw`\b(?:refer\w*|recommend\w*|emergency|kin|manager\w*|supervisor\w*|boss|reference\w*|recruiter\w*|interviewer\w*|agenc(?:y|ies)|agent|spouse|partner\w*|husband|wife|parent\w*|guardian\w*|mother|father|relative\w*|sibling\w*|dependent\w*|child\w*|previous\w*|prior|former\w*|past|compan(?:y|ies)|employer\w*|business\w*|organi[sz]ation\w*|firm|office|work|school\w*|universit\w*|college\w*|institution\w*|campus|salary|salaries|compensation|pay|wage\w*|expectation\w*|expected|desired|preferred|preference\w*|nick ?names?|middle|maiden|alias\w*|alternat\w*|secondary|second|additional|other|backup|birth\w*|citizen\w*|nationality|passport\w*|billing|shipping|mailing|permanent|temporary|hometown|describe|explain|why|how|what|which|who|whom|whose|where|when|sponsor\w*|state your|please describe|tell us)\b`, "u");

/**
 * Narrower hard block for any fact application, including model-selected
 * facts: a field about another person, an organization or a different
 * identity can never receive the candidate's own contact or identity fact.
 */
const THIRD_PARTY = new RegExp(String.raw`\b(?:refer\w*|recommend\w*|emergency|next of kin|manager\w*|supervisor\w*|reference\w*|recruiter\w*|interviewer\w*|spouse|husband|wife|domestic partner|parent\w*|guardian\w*|mother|father|relative\w*|sibling\w*|dependent\w*|child\w*|previous\w*|prior|former\w*|past|compan(?:y|ies)|employer\w*|business\w*|organi[sz]ation\w*|school\w*|universit\w*|college\w*|institution\w*|agenc(?:y|ies)|nick ?names?|maiden|alias\w*)\b`, "u");
const IDENTITY_VARIANT = /\b(?:prefer\w*|middle|other|alternat\w*|additional|previous|former|maiden|nick ?names?|pronunciation|phonetic)\b/u;

export function normalizeFieldLabel(value: string): string {
  const label = value.normalize("NFKC").toLowerCase()
    // Required markers used by common ATS pages: *, ✱, ✳, ⁎ and full-width asterisks.
    .replace(/[*\u2217\u204e\u2731-\u2733\u273a-\u273d\u2747\uff0a]/gu, " ")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/[\u2018\u2019\u02bc`\u00b4]/gu, "'")
    .replace(/[([]\s*(?:required|optional|mandatory)\s*[)\]]/gu, " ")
    .replace(/\s*\/\s*/gu, "/")
    .replace(/\(\s+/gu, "(").replace(/\s+\)/gu, ")")
    .replace(/\s+/gu, " ").trim()
    .replace(/(?:\s*[:?.!;,])+$/u, "")
    .replace(/\s+(?:required|optional)$/u, "")
    .trim();
  // Hosted Greenhouse forms name a required control twice: its accessible
  // name ("Email") and its visible label ("Email*"). The observer joins both,
  // so the label arrives as "Email Email*". The same words twice in a row are
  // one question; any other combination is left as observed. (Bounded: a
  // longer label is never classified anyway.)
  return label.length <= 400 ? /^(.+?)(?:\s*[:?.!;,])* \1$/u.exec(label)?.[1] ?? label : label;
}

function identifierText(field: Pick<FieldFactDescriptor, "name" | "domId">): string {
  return `${field.name ?? ""} ${field.domId ?? ""}`
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Returns one fact key only for an exact, unambiguous, anchored label match. */
export function classifyFieldFact(field: FieldFactDescriptor): CandidateFactKey | null {
  const label = normalizeFieldLabel(field.label);
  if (!label || label.length > 80) return null;
  const identifiers = identifierText(field);
  // Ashby's reviewed system Location field is a city lookup, despite its broad
  // label. Generic "Location" controls retain no inferred location semantic.
  if (field.provider === "ASHBY" && label === "location" && field.domId === "_systemfield_location" &&
    field.name === "_systemfield_location" && field.kind === "SINGLE_SELECT" && field.inputType === "text") return "location.city";
  // The global exclusions govern the profile-fact table unchanged; saved
  // answers apply their own narrower exclusions (see ANSWER_LABEL_RULES).
  const matches = [
    ...(EXCLUDED.test(label) || EXCLUDED.test(identifiers) ? [] : COMPILED_RULES.filter((rule) => rule.pattern.test(label))),
    ...COMPILED_ANSWER_RULES.filter((rule) => answerRuleMatches(rule, label, identifiers)),
  ];
  if (matches.length !== 1) return null;
  const [rule] = matches;
  const inputTypes = rule.kinds[field.kind];
  if (!inputTypes || !inputTypes.includes(field.inputType.toLowerCase())) return null;
  return rule.factKey;
}

/**
 * True when no candidate fact of this key may be written to the field, even
 * if a model proposes it. Location and identity values are never inferred for
 * a third party, an organization or a different name/contact variant.
 */
export function fieldRejectsCandidateFact(field: Pick<FieldFactDescriptor, "label" | "name" | "domId">, factKey: string): boolean {
  const label = normalizeFieldLabel(field.label);
  const identifiers = identifierText(field);
  if (THIRD_PARTY.test(label) || THIRD_PARTY.test(identifiers)) return true;
  const compensationField = /\b(?:salary|compensation|pay|wage\w*|expectation\w*)\b|\bstate your\b/u.test(label);
  // A saved answer goes only to its own anchored question. The salary
  // expectation is the one fact a compensation question can take.
  const answerRule = ANSWER_RULE_BY_KEY.get(factKey);
  if (answerRule) return !answerRuleMatches(answerRule, label, identifiers) || (compensationField && factKey !== "compensation.expected_salary");
  if (compensationField) return true;
  return factKey.startsWith("identity.") && (IDENTITY_VARIANT.test(label) || IDENTITY_VARIANT.test(identifiers));
}

/**
 * A work-eligibility answer describes the candidate now. A question about
 * another person or a past status cannot reuse the candidate's current answer.
 */
const OTHER_PERSON_OR_PAST = /\b(?:spouse|husband|wife|partner\w*|dependent\w*|parent\w*|guardian\w*|relative\w*|child\w*|family members?|refer\w*|reference\w*|emergency|manager\w*|supervisor\w*|previous\w*|former\w*|past)\b/u;
export function describesOtherPersonOrPast(text: string): boolean {
  return OTHER_PERSON_OR_PAST.test(text.normalize("NFKC").toLowerCase());
}

/** Only a clean anchored legal-name label can take the candidate's legal name. */
export function isLegalNameField(field: FieldFactDescriptor): boolean {
  return classifyFieldFact(field) === "identity.legal_name";
}

const OPTION_SEMANTICS: Readonly<Partial<Record<string, OptionSemantic>>> = Object.freeze({
  "location.country_code": "COUNTRY", "location.region": "REGION", "location.city": "CITY",
  "self_id.gender": "SELF_ID", "self_id.hispanic_latino": "SELF_ID", "self_id.race_ethnicity": "SELF_ID",
  "self_id.veteran_status": "SELF_ID", "self_id.disability_status": "SELF_ID",
});

/**
 * How an approved value is matched to the field's options. Location and
 * self-identification aliases apply only when the field's own anchored label
 * names that fact (for a fact) or that question (for a candidate answer); the
 * candidate's approved region and country confirm type-to-search results.
 */
export function optionMatchForField(field: FieldFactDescriptor, factKey: string | null,
  facts: readonly Readonly<{ factKey: string; value: string }>[]): OptionMatch {
  const classified = classifyFieldFact(field);
  const key = factKey === null ? classified : classified === factKey ? factKey : null;
  const approved = (name: string) => facts.find((fact) => fact.factKey === name)?.value ?? null;
  // Intended work location is a candidate choice, not current residence.
  // Only an exact saved answer gets city lookup semantics in this reviewed slot.
  const intendedCityAnswer = factKey === null && field.provider === "ASHBY" && field.domId === "_systemfield_location" &&
    field.name === "_systemfield_location" && field.kind === "SINGLE_SELECT" && field.inputType === "text" &&
    normalizeFieldLabel(field.label) === "which city and country do you intend to work from";
  return { semantic: intendedCityAnswer ? "CITY" : key ? OPTION_SEMANTICS[key] ?? null : null, source: factKey === null ? "ANSWER" : "FACT",
    hints: { region: approved("location.region"), country: approved("location.country_code") } };
}
