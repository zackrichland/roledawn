import { createHash } from "node:crypto";
import { roleFamiliesForTitle, normalizedCatalogJob, parseFitLocations, type CatalogFitJobVersionRow } from "./opportunity-fit-adapter.ts";
import type { OpportunityCatalogItem } from "./opportunity-catalog.ts";
import { parseAutopilotDestination } from "./application-autopilot-eligibility.ts";

export const CANDIDATE_MATCHING_POLICY_VERSION = "roledawn-candidate-matching/1" as const;
export type MatchingEvidence = Readonly<{ versionId: string; hash: string; text: string; category: string }>;
export type MatchingProfile = Readonly<{
  candidateId: string;
  candidateInputEpoch: number;
  searchVersion: number | null;
  targetRoles: readonly string[];
  preferredLocations: readonly string[];
  desiredCountryCodes: readonly string[];
  workModes: readonly string[];
  employmentTypes: readonly string[];
  reviewedResume: Readonly<{ versionId: string; hash: string }> | null;
  evidence: readonly MatchingEvidence[];
  workAuthorizations: readonly Readonly<{ countryCode: string; authorized: boolean | null; sponsorshipRequired: boolean | null; versionIds: readonly string[] }>[];
}>;
export type MatchingCatalogJob = OpportunityCatalogItem & Readonly<{ contentHash: string; versionNumber: number }>;
export type MatchAssessment = Readonly<{
  /** Internal ordering points, never an outcome probability or percentage. */
  score: number;
  band: "STRONG" | "POSSIBLE";
  reasons: readonly string[];
  reviewReasons: readonly string[];
  autoApplyEligible: boolean;
  profileHash: string;
  policyVersion: typeof CANDIDATE_MATCHING_POLICY_VERSION;
  jobVersionId: string;
  jobContentHash: string;
  evidenceRefs: readonly string[];
}>;
export type MatchedJob = OpportunityCatalogItem & Readonly<{ matching: MatchAssessment }>;
export type CandidateRecommendations = Readonly<{
  profileHash: string;
  policyVersion: typeof CANDIDATE_MATCHING_POLICY_VERSION;
  candidateInputEpoch: number;
  scannedJobs: number;
  complete: boolean;
  items: readonly MatchedJob[];
  diagnostics: readonly string[];
}>;

const EXTRA_FAMILIES: readonly [string, RegExp][] = [
  ["nursing", /\b(?:registered nurse|nurse|nursing|rn|lpn|lvn)\b/u],
  ["teaching", /\b(?:teacher|teaching|educator|classroom instructor)\b/u],
  ["accounting", /\b(?:accountant|accounting|auditor|bookkeeper|controller)\b/u],
  ["physical therapy", /\b(?:physical therapist|physical therapy)\b/u],
  ["occupational therapy", /\b(?:occupational therapist|occupational therapy)\b/u],
  ["speech therapy", /\b(?:speech language pathologist|speech therapist|slp)\b/u],
  ["medicine", /\b(?:physician|medical doctor|surgeon|pediatrician|psychiatrist)\b/u],
  ["social work", /\b(?:social worker|social work|licensed clinical social)\b/u],
  ["legal", /\b(?:attorney|lawyer|legal counsel|paralegal)\b/u],
  ["retail", /\b(?:cashier|retail associate|store associate|store manager)\b/u],
  ["food service", /\b(?:chef|cook|restaurant manager|server|barista)\b/u],
  ["mechanical engineering", /\b(?:mechanical|manufacturing|aerospace) engineer\b/u],
  ["electrical engineering", /\b(?:electrical|electronics|hardware) engineer\b/u],
];
const SKILLS = [
  "python", "typescript", "javascript", "react", "node.js", "sql", "postgresql", "supabase", "swift", "ios", "aws", "azure", "gcp", "kubernetes", "docker", "terraform",
  "machine learning", "artificial intelligence", "generative ai", "llm", "retrieval augmented generation", "api", "data pipeline", "data analysis", "excel", "tableau", "power bi",
  "customer discovery", "technical discovery", "implementation", "integration", "prototyping", "demonstration", "stakeholder management", "salesforce",
  "lesson planning", "curriculum", "classroom management", "student assessment", "special education", "differentiated instruction", "literacy", "mathematics",
  "patient assessment", "care planning", "medication administration", "wound care", "triage", "clinical documentation", "home health", "electronic health record",
  "financial modeling", "financial analysis", "forecasting", "budgeting", "variance analysis", "accounting", "gaap", "reconciliation", "audit", "month end close",
  "project management", "product management", "product roadmap", "product development", "workflow mapping", "automation", "user research", "figma", "customer success", "sales", "marketing", "recruiting", "inventory", "food safety",
] as const;
const SKILL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "api": ["apis", "rest api", "rest apis"], "llm": ["llms", "large language model", "large language models"],
  "generative ai": ["gen ai", "genai"], "retrieval augmented generation": ["rag"],
  "demonstration": ["demo", "demos", "demonstrations"], "integration": ["integrations"],
  "prototyping": ["prototype", "prototypes"], "forecasting": ["forecast", "forecasts"],
  "lesson planning": ["lesson plans"], "electronic health record": ["ehr", "emr"],
  "product roadmap": ["product roadmaps", "roadmap", "roadmaps"], "automation": ["automate", "automating", "automated"],
};
const ROLE_STOP_WORDS = new Set(["senior", "sr", "junior", "jr", "lead", "staff", "principal", "associate", "assistant", "manager", "director", "head", "of", "the", "and", "a", "an", "ii", "iii", "iv", "i", "remote", "us", "usa"]);
const ADJACENT: Readonly<Record<string, readonly string[]>> = {
  "forward deployed engineering": ["solutions engineering", "software engineering", "machine learning engineering"],
  "solutions engineering": ["forward deployed engineering"],
  "software engineering": ["forward deployed engineering"],
  "finance": ["accounting"], "accounting": ["finance"],
};

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/[–—‐-]/gu, " ").replace(/[^\p{L}\p{N}.+#/]+/gu, " ").replace(/\s+/gu, " ").trim();
}
function phrasePattern(phrase:string): RegExp {
  const escaped=normalized(phrase).replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,"u");
}
function includesPhrase(text: string, phrase: string): boolean { return phrasePattern(phrase).test(text); }
const SKILL_MATCHERS=SKILLS.map((skill)=>({skill,patterns:[skill,...(SKILL_ALIASES[skill] ?? [])].map(phrasePattern)}));
function families(value: string): readonly string[] {
  const text = normalized(value);
  const found = [...new Set([...roleFamiliesForTitle(text), ...EXTRA_FAMILIES.filter(([, pattern]) => pattern.test(text)).map(([family]) => family)])];
  if (/\bforward deployed (?:software |ai |application )?(?:engineer|engineering)\b/u.test(text) || (/\bforward deployed ai\b/u.test(text) && /\bsoftware engineer\b/u.test(text))) found.push("forward deployed engineering");
  const advancedNursing = /\b(?:nurse practitioner|nurse anesthetist|clinical nurse specialist|aprn|crna)\b/u.test(text);
  const nursingAssistant = /\b(?:nursing assistant|nurse aide|cna)\b/u.test(text);
  const practicalNursing = /\b(?:licensed practical nurse|licensed vocational nurse|lpn|lvn)\b/u.test(text);
  if (advancedNursing || nursingAssistant || practicalNursing) {
    return [...found.filter((family) => family !== "nursing"), advancedNursing ? "advanced practice nursing" : nursingAssistant ? "nursing assistance" : "practical nursing"];
  }
  return found;
}
function skills(value: string): readonly string[] {
  const text = normalized(value);
  const found: string[] = SKILL_MATCHERS.filter(({patterns})=>patterns.some((pattern)=>pattern.test(text))).map(({skill})=>skill);
  if (/\b(?:build|building|built|ship|shipping|shipped|launch|launched|develop|developed|developing)\b.{0,65}\b(?:product|products|platform|application|applications|app|apps)\b/u.test(text)) found.push("product development");
  if (/\b(?:mapped|mapping|map)\b.{0,30}\bworkflows?\b/u.test(text)) found.push("workflow mapping");
  return sortedUnique(found);
}
function sortedUnique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function locationPreferences(profile: MatchingProfile): readonly string[] {
  const result: string[] = [];
  for (let index=0;index<profile.preferredLocations.length;index++) {
    const current=profile.preferredLocations[index], next=profile.preferredLocations[index+1];
    // Earlier onboarding split comma-delimited city/state input into two rows.
    // Rejoin an adjacent recognized region rather than interpreting Washington
    // as both the city and the state, or DC as a separate alternative.
    const combined=next && /^[A-Z]{2}$/u.test(next) ? parseFitLocations(`${current}, ${next}`) : [];
    if (combined.some((location)=>location.city && location.regionCode===next)) { result.push(`${current}, ${next}`); index++; }
    else if (!/^(?:remote|anywhere)$/iu.test(current.trim())) result.push(current);
  }
  return result;
}
export function matchingProfileHash(profile: MatchingProfile): string {
  const projection = {
    policy: CANDIDATE_MATCHING_POLICY_VERSION, candidateId: profile.candidateId, epoch: profile.candidateInputEpoch,
    searchVersion: profile.searchVersion, targetRoles: sortedUnique(profile.targetRoles.map(normalized)),
    locations: sortedUnique(profile.preferredLocations.map(normalized)), countries: sortedUnique(profile.desiredCountryCodes),
    workModes: sortedUnique(profile.workModes), employmentTypes: sortedUnique(profile.employmentTypes), resume: profile.reviewedResume,
    evidence: [...profile.evidence].sort((a,b) => a.versionId.localeCompare(b.versionId)).map(({ versionId, hash, category }) => ({versionId, hash, category})),
    authorization: [...profile.workAuthorizations].sort((a,b)=>a.countryCode.localeCompare(b.countryCode)),
  };
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}
function seniority(value: string): number {
  const text = normalized(value);
  if (/\b(?:chief|vice president|vp|head of)\b/u.test(text)) return 4;
  if (/\b(?:director|principal|staff|controller)\b/u.test(text)) return 3;
  if (/\b(?:senior|sr|lead|manager)\b/u.test(text)) return 2;
  return 1;
}

// The catalog stores UNSPECIFIED/OTHER when a board omits a value (every
// Greenhouse posting does). Missing data must not exclude a job; only an
// explicit, different value may.
const UNKNOWN_CATALOG_VALUES = new Set(["", "UNKNOWN", "UNSPECIFIED", "OTHER"]);
function knownCatalogValue(value: string | null | undefined): boolean {
  return typeof value === "string" && !UNKNOWN_CATALOG_VALUES.has(value.trim().toUpperCase());
}

// Country and region mentions in free-text job locations. Anything detected
// here that is not one of the candidate's countries removes a job only when no
// wanted country is also listed ("Toronto · United States (Remote)" stays).
const COUNTRY_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["US", /\b(?:united states|usa|u\.s\.a?\.?|us remote|remote us|us only|us-based)\b/u],
  ["CA", /\b(?:canada|toronto|vancouver|montreal|ottawa|calgary|ontario|british columbia|quebec|alberta)\b/u],
  ["GB", /\b(?:united kingdom|uk|great britain|england|scotland|wales|london|manchester|edinburgh)\b/u],
  ["IE", /\b(?:ireland|dublin)\b/u], ["DE", /\b(?:germany|berlin|munich|hamburg|frankfurt)\b/u],
  ["FR", /\b(?:france|paris)\b/u], ["NL", /\b(?:netherlands|amsterdam)\b/u], ["ES", /\b(?:spain|madrid|barcelona)\b/u],
  ["PT", /\b(?:portugal|lisbon)\b/u], ["IT", /\b(?:italy|milan|rome)\b/u], ["CH", /\b(?:switzerland|zurich|geneva)\b/u],
  ["SE", /\b(?:sweden|stockholm)\b/u], ["DK", /\b(?:denmark|copenhagen)\b/u], ["NO", /\b(?:norway|oslo)\b/u],
  ["FI", /\b(?:finland|helsinki)\b/u], ["PL", /\b(?:poland|warsaw|krakow)\b/u], ["BE", /\b(?:belgium|brussels)\b/u],
  ["AT", /\b(?:austria|vienna)\b/u], ["CZ", /\b(?:czech|prague)\b/u], ["RO", /\b(?:romania|bucharest)\b/u],
  ["IL", /\b(?:israel|tel aviv)\b/u], ["AE", /\b(?:united arab emirates|uae|dubai|abu dhabi)\b/u],
  ["IN", /\b(?:india|bangalore|bengaluru|hyderabad|mumbai|pune|delhi|chennai|gurgaon|gurugram|noida)\b/u],
  ["SG", /\bsingapore\b/u], ["JP", /\b(?:japan|tokyo)\b/u], ["KR", /\b(?:korea|seoul)\b/u], ["CN", /\b(?:china|shanghai|beijing|shenzhen)\b/u],
  ["HK", /\bhong kong\b/u], ["TW", /\b(?:taiwan|taipei)\b/u], ["PH", /\b(?:philippines|manila)\b/u], ["VN", /\b(?:vietnam|ho chi minh|hanoi)\b/u],
  ["ID", /\b(?:indonesia|jakarta)\b/u], ["MY", /\b(?:malaysia|kuala lumpur)\b/u], ["TH", /\b(?:thailand|bangkok)\b/u],
  ["AU", /\b(?:australia|sydney|melbourne|brisbane|perth)\b/u], ["NZ", /\b(?:new zealand|auckland)\b/u],
  ["BR", /\b(?:brazil|brasil|sao paulo|são paulo|rio de janeiro)\b/u], ["MX", /\b(?:mexico|méxico|mexico city|guadalajara|monterrey)\b/u],
  ["AR", /\b(?:argentina|buenos aires)\b/u], ["CO", /\b(?:colombia|bogota|bogotá|medellin|medellín)\b/u], ["CL", /\b(?:chile|santiago)\b/u],
  ["PE", /\b(?:peru|lima)\b/u], ["UY", /\b(?:uruguay|montevideo)\b/u], ["CR", /\b(?:costa rica)\b/u],
  ["ZA", /\b(?:south africa|cape town|johannesburg)\b/u], ["NG", /\b(?:nigeria|lagos)\b/u], ["KE", /\b(?:kenya|nairobi)\b/u], ["EG", /\b(?:egypt|cairo)\b/u],
  ["EMEA", /\bemea\b/u], ["APAC", /\b(?:apac|asia pacific)\b/u], ["LATAM", /\b(?:latam|latin america)\b/u], ["EU", /\b(?:europe|european union)\b/u],
];
const US_STATE_ABBREVIATION = /(?:,|\s[-–|·]\s?)\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|D\.C\.|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b(?!\s*[a-z])/u;
function countryCodesInLocation(location: string): readonly string[] {
  const text = normalized(location);
  const codes = COUNTRY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
  // "Remote - US", a bare "US", or "Austin, TX" all mean the United States.
  if (!codes.includes("US") && (/(?:^|\s)us(?:$|\s)/u.test(text) || US_STATE_ABBREVIATION.test(location))) codes.push("US");
  return codes;
}

type PreparedProfile = Readonly<{evidenceText:string;candidateSkills:ReadonlySet<string>;evidenceFamilies:readonly string[];targets:readonly string[];activeFamilies:readonly string[]}>;
function assess(profile: MatchingProfile, job: MatchingCatalogJob, hash: string, prepared: PreparedProfile): MatchedJob | null {
  if (job.queuedApplicationId) return null;
  if (profile.workModes.length > 0 && knownCatalogValue(job.workMode) && !profile.workModes.includes(job.workMode!)) return null;
  if (profile.employmentTypes.length > 0 && knownCatalogValue(job.employmentType) && !profile.employmentTypes.includes(job.employmentType!)) return null;
  const {evidenceText,candidateSkills,evidenceFamilies,targets,activeFamilies}=prepared;
  const jobFamilies = families(job.title);
  // Evidence-derived focus requires a recognizable profession in an approved
  // experience/summary passage. An isolated shared word such as "care" cannot
  // expand a candidate's target roles.
  const directFamily = jobFamilies.some((family) => activeFamilies.includes(family));
  const adjacentFamily = jobFamilies.some((family) => activeFamilies.some((target) => ADJACENT[target]?.includes(family)));
  const normalizedTitle = normalized(job.title);
  const exactTarget = targets.some((target) => includesPhrase(normalizedTitle, target));
  const titleOverlap = targets.some((target) => {
    const targetFamilies=families(target);
    if (targetFamilies.length>0 && !targetFamilies.some((family)=>jobFamilies.includes(family))) return false;
    const tokens = target.split(" ").filter((word) => !ROLE_STOP_WORDS.has(word));
    const meaningful = tokens.filter((word) => word.length >= 3 || ["ai","ml","rn"].includes(word));
    return meaningful.length >= 2 && meaningful.every((word) => includesPhrase(normalizedTitle, word));
  });
  if (!directFamily && !exactTarget && !titleOverlap && !adjacentFamily) return null;
  const jobSkills = skills(job.description);
  const sharedSkills = jobSkills.filter((skill) => candidateSkills.has(skill));
  if (!directFamily && !exactTarget && !titleOverlap && sharedSkills.length < 3) return null;
  const reasons: string[] = [];
  const reviewReasons: string[] = [];
  let autoBlocked = false;
  let score = exactTarget ? 55 : titleOverlap ? 50 : directFamily ? 42 : 25;
  if (targets.length > 0) reasons.push(exactTarget || titleOverlap ? "Matches a role you chose." : directFamily ? "Matches one of your target professions." : "Related to your target roles and supported by your experience.");
  else { reasons.push("Your reviewed experience supports this profession."); reviewReasons.push("Choose target roles to guide automatic applications."); autoBlocked = true; }
  if (sharedSkills.length > 0) {
    score += Math.min(24, sharedSkills.length * 4);
    reasons.push(`Your reviewed experience includes ${sharedSkills.slice(0, 3).join(", ")}.`);
  }
  if (evidenceFamilies.some((family) => jobFamilies.includes(family))) score += 10;
  if (!profile.reviewedResume || profile.evidence.length === 0) {
    reviewReasons.push("Review your résumé experience before automatic applications."); autoBlocked = true;
  }
  const versionRow: CatalogFitJobVersionRow = { id: job.jobVersionId, jobId: job.jobId, versionNumber: job.versionNumber, title: job.title,
    descriptionText: job.description, locationText: job.location, workMode: job.workMode, employmentType: job.employmentType, observedAt: job.observedAt };
  const normalizedJob = normalizedCatalogJob(versionRow);
  const locations = normalizedJob.locations ?? [];
  const countries = sortedUnique([...(normalizedJob.workCountryCodes ?? []), ...countryCodesInLocation(job.location ?? "")]);
  if (profile.desiredCountryCodes.length > 0 && countries.length > 0 && !countries.some((country) => profile.desiredCountryCodes.includes(country))) return null;
  if (profile.workModes.length > 0 && knownCatalogValue(job.workMode) && !profile.workModes.includes(job.workMode!)) return null;
  if (profile.employmentTypes.length > 0 && knownCatalogValue(job.employmentType) && !profile.employmentTypes.includes(job.employmentType!)) return null;
  const preferences=locationPreferences(profile);
  if (job.workMode === "REMOTE" && profile.workModes.includes("REMOTE")) {
    const jobRegions=locations.map((location)=>location.regionCode).filter(Boolean);
    const preferredRegions=preferences.flatMap((preference)=>parseFitLocations(preference,profile.desiredCountryCodes)).map((location)=>location.regionCode).filter(Boolean);
    if (jobRegions.length>0 && preferredRegions.length>0 && !jobRegions.some((region)=>preferredRegions.includes(region))) return null;
    reasons.push("Fits your remote-work preference."); score += 5;
  } else if (preferences.length > 0) {
    const jobLocation = normalized(job.location ?? "");
    // Compare city/region tokens, never substring-match "York" to "Yorkshire".
    const matchingLocation = preferences.some((preference) => {
      const p = normalized(preference).replace(/\b(?:united states|usa|us|canada)\b/gu, "").trim();
      return Boolean(p) && (includesPhrase(jobLocation, p) || locations.some((loc) => loc.city && includesPhrase(p, loc.city) && (!loc.regionCode || includesPhrase(p, loc.regionCode) || p === normalized(loc.city))));
    });
    if (matchingLocation) { score += 5; reasons.push("Matches a saved location."); }
    else if (job.workMode === "ONSITE" || job.workMode === "HYBRID") return null;
    else { reviewReasons.push("The posting needs a location or work-mode check."); autoBlocked = true; }
  }
  if (countries.length === 0 && profile.desiredCountryCodes.length > 0) {
    reviewReasons.push("The posting's work country is unclear."); autoBlocked = true;
  }
  if (normalizedJob.clearance?.status === "REQUIRED") {
    reviewReasons.push("This job requires a clearance that needs an exact eligibility check."); autoBlocked = true;
  }
  const relevantCountries=countries.filter((country)=>profile.desiredCountryCodes.length===0 || profile.desiredCountryCodes.includes(country));
  const authorizationPaths=relevantCountries.map((country) => {
    const authorization = profile.workAuthorizations.find((entry) => entry.countryCode === country);
    if (authorization?.sponsorshipRequired && normalizedJob.sponsorshipAvailability === "NOT_AVAILABLE") return "BLOCK";
    return authorization?.authorized === false && authorization.sponsorshipRequired === false ? "REVIEW" : "OPEN";
  });
  if (authorizationPaths.length>0 && authorizationPaths.every((path)=>path==="BLOCK")) return null;
  if (authorizationPaths.includes("REVIEW") && !authorizationPaths.includes("OPEN")) {
    reviewReasons.push("Your saved work-authorization answers need review for this country."); autoBlocked = true;
  }
  // Credential checks flag missing evidence; a profession label alone never
  // establishes licensure, certification, clearance, citizenship or eligibility.
  const description = normalized(job.description);
  const credentials: readonly [RegExp, RegExp, string][] = [
    [/\b(?:rn license|registered nurse license|licensed registered nurse|valid nursing license|active nursing license)\b/u, /\b(?:rn license|registered nurse license|licensed registered nurse|active nursing license)\b/u, "nursing license"],
    [/\b(?:teaching license|teaching certificate|teacher certification|certified teacher)\b/u, /\b(?:licensed teacher|teaching license|teaching certificate|teacher certification|certified teacher)\b/u, "teaching credential"],
    [/\b(?:cpa required|required cpa|must (?:be|hold|have).{0,30}(?:cpa|certified public accountant))\b/u, /\b(?:certified public accountant|cpa)\b/u, "CPA credential"],
  ];
  for (const [required, supported, label] of credentials) if (required.test(description) && !supported.test(normalized(evidenceText))) {
    reviewReasons.push(`The stated ${label} needs verification.`); autoBlocked = true;
  }
  if (/\b(?:phd|ph.d|psyd)\b/u.test(normalizedTitle) && !profile.evidence.some((entry)=>entry.category==="EDUCATION" && /\b(?:phd|ph.d|psyd|doctorate)\b/u.test(normalized(entry.text)))) {
    reviewReasons.push("The title names a doctoral qualification that needs verification."); autoBlocked=true;
  }
  // Negated or aspiring credential mentions are not a valid credential.
  if ((/\b(?:no|not|without|pursuing|studying for|working toward|expired|suspended|lapsed|inactive).{0,35}\b(?:license|licensed|certification|cpa)\b/u.test(normalized(evidenceText)) || /\b(?:license|certification)\b.{0,20}\b(?:expired|suspended|lapsed|inactive)\b/u.test(normalized(evidenceText))) && credentials.some(([required])=>required.test(description))) {
    reviewReasons.push("The required credential is not established by your reviewed evidence."); autoBlocked = true;
  }
  const highestRelevantSeniority = Math.max(1, ...profile.targetRoles.map(seniority), ...profile.evidence.filter((entry) => entry.category === "EXPERIENCE").map((entry) => seniority(entry.text.split(/\n|[.!?]/u)[0].slice(0,160))));
  if (seniority(job.title) > highestRelevantSeniority) {
    reviewReasons.push("The posting's seniority is above your stated targets and reviewed roles."); score -= 15; autoBlocked = true;
  }
  if (/\b(?:assistant|aide|intern|internship)\b/u.test(normalizedTitle) && !targets.some((target)=>/\b(?:assistant|aide|intern|internship)\b/u.test(target))) {
    reviewReasons.push("This is an assistant or training role outside your stated level."); score -= 15; autoBlocked = true;
  }
  const careerSupported = evidenceFamilies.some((family)=>jobFamilies.includes(family)) || sharedSkills.length >= 2;
  if (!careerSupported) { reviewReasons.push("Your reviewed experience does not yet establish this role's core work."); autoBlocked = true; }
  const band = score >= 58 && careerSupported && (directFamily || exactTarget || titleOverlap) ? "STRONG" : "POSSIBLE";
  if (!parseAutopilotDestination(job.applyUrl)) {
    reviewReasons.push("This employer supports prepared files; automatic submission is not available yet."); autoBlocked = true;
  }
  const evidenceRefs = profile.evidence.filter((entry) => {
    const entrySkills = skills(entry.text);
    return entrySkills.some((skill) => sharedSkills.includes(skill)) || families(entry.text).some((family) => jobFamilies.includes(family));
  }).map((entry) => entry.versionId);
  return Object.freeze({ ...job, description: job.description.slice(0, 900), matching: Object.freeze({ score, band,
    reasons: Object.freeze(reasons), reviewReasons: Object.freeze(reviewReasons), autoApplyEligible: band === "STRONG" && !autoBlocked,
    profileHash: hash, policyVersion: CANDIDATE_MATCHING_POLICY_VERSION, jobVersionId: job.jobVersionId, jobContentHash: job.contentHash,
    evidenceRefs: Object.freeze(sortedUnique(evidenceRefs)),
  }) });
}

/** Compact catalog row used for the first, description-free matching pass. */
export type MatchingIndexJob = Readonly<{
  jobId: string;
  title: string;
  employerName: string;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  observedAt: string;
}>;

/**
 * Stage one of matching at catalog scale: rank every fresh job by title
 * relevance to the candidate's targets (or, without targets, the professions
 * in their reviewed experience) and keep a shortlist for full assessment.
 */
export function shortlistCandidateJobs(profile: MatchingProfile, jobs: readonly MatchingIndexJob[], max = 600): readonly string[] {
  const targets = profile.targetRoles.map(normalized).filter(Boolean);
  const evidenceFamilies = sortedUnique(profile.evidence.filter((entry) => ["EXPERIENCE", "SUMMARY"].includes(entry.category)).flatMap((entry) => families(entry.text)));
  const activeFamilies = targets.length ? sortedUnique(targets.flatMap(families)) : evidenceFamilies;
  const scored: { jobId: string; score: number; observedAt: string }[] = [];
  for (const job of jobs) {
    if (profile.workModes.length > 0 && knownCatalogValue(job.workMode) && !profile.workModes.includes(job.workMode!)) continue;
    if (profile.employmentTypes.length > 0 && knownCatalogValue(job.employmentType) && !profile.employmentTypes.includes(job.employmentType!)) continue;
    const title = normalized(job.title);
    const jobFamilies = families(job.title);
    const exact = targets.some((target) => includesPhrase(title, target));
    const overlap = !exact && targets.some((target) => {
      const meaningful = target.split(" ").filter((word) => !ROLE_STOP_WORDS.has(word) && (word.length >= 3 || ["ai", "ml", "rn"].includes(word)));
      return meaningful.length >= 2 && meaningful.every((word) => includesPhrase(title, word));
    });
    const direct = jobFamilies.some((family) => activeFamilies.includes(family));
    const adjacent = jobFamilies.some((family) => activeFamilies.some((target) => ADJACENT[target]?.includes(family)));
    const score = exact ? 4 : overlap ? 3 : direct ? 2 : adjacent ? 1 : 0;
    if (score > 0) scored.push({ jobId: job.jobId, score, observedAt: job.observedAt });
  }
  return Object.freeze(scored
    .sort((left, right) => right.score - left.score || right.observedAt.localeCompare(left.observedAt) || left.jobId.localeCompare(right.jobId))
    .slice(0, max)
    .map((entry) => entry.jobId));
}

function repostKey(job: MatchedJob): string {
  return `${normalized(job.employerName)}|${normalized(job.title)}|${normalized(job.location ?? "")}`;
}

export function rankCandidateJobs(profile: MatchingProfile, jobs: readonly MatchingCatalogJob[], limit = 24, options: Readonly<{automaticSelection?:boolean}> = {}): readonly MatchedJob[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("MATCHING_LIMIT_INVALID");
  const hash = matchingProfileHash(profile);
  const evidenceText=profile.evidence.map((entry)=>entry.text).join("\n");
  const evidenceFamilies=sortedUnique(profile.evidence.filter((entry)=>["EXPERIENCE","SUMMARY"].includes(entry.category)).flatMap((entry)=>families(entry.text)));
  const targets=profile.targetRoles.map(normalized).filter(Boolean);
  const prepared:PreparedProfile={evidenceText,candidateSkills:new Set(skills(evidenceText)),evidenceFamilies,targets,activeFamilies:targets.length ? sortedUnique(targets.flatMap(families)) : evidenceFamilies};
  const uniqueJobs = new Map<string, MatchingCatalogJob>();
  for (const job of jobs) {
    const existing = uniqueJobs.get(job.jobId);
    if (!existing || existing.observedAt < job.observedAt) uniqueJobs.set(job.jobId, job);
  }
  const ranked = [...uniqueJobs.values()].map((job) => assess(profile, job, hash,prepared)).filter((job): job is MatchedJob => job !== null && (!options.automaticSelection || job.matching.autoApplyEligible))
    .sort((a,b) => b.matching.score-a.matching.score || b.observedAt.localeCompare(a.observedAt) || a.jobId.localeCompare(b.jobId));
  // A reposted role (same employer, title, and location) appears once.
  const seenReposts = new Set<string>();
  const distinct = ranked.filter((job) => {
    const key = repostKey(job);
    if (seenReposts.has(key)) return false;
    seenReposts.add(key);
    return true;
  });
  return Object.freeze(distinct.slice(0,limit));
}
