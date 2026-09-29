import { createHash } from "node:crypto";

/**
 * The structured career history a résumé is allowed to print: employers,
 * titles, dates, education, certifications, and skills. It is extracted from
 * the candidate's own reviewed résumé and editable by the candidate. Résumé
 * bullets remain separate approved evidence, attached to positions by key.
 */
export const CAREER_PROFILE_SCHEMA_VERSION = 1 as const;
export const CAREER_PROFILE_EXTRACTOR_RELEASE = "career-profile-extractor/1";

export const EMPLOYMENT_KINDS = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "FOUNDER", "VOLUNTEER", "OTHER"] as const;
export type EmploymentKind = (typeof EMPLOYMENT_KINDS)[number];

export type CareerPosition = Readonly<{
  positionKey: string;
  title: string;
  organization: string;
  location: string | null;
  /** "YYYY" or "YYYY-MM". */
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  employmentKind: EmploymentKind | null;
  /** One line of scope from the résumé, e.g. "600+ clinicians across six locations". */
  summary: string | null;
  /** candidate_evidence_items.evidence_key values that belong to this role. */
  evidenceKeys: readonly string[];
}>;

export type CareerEducation = Readonly<{
  educationKey: string;
  institution: string;
  credential: string;
  field: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  details: readonly string[];
}>;

export type CareerCertification = Readonly<{
  name: string;
  issuer: string | null;
  date: string | null;
}>;

export type CareerSkillGroup = Readonly<{
  label: string | null;
  items: readonly string[];
}>;

/** A period without a listed role, explained in the candidate's words. */
export type CareerGap = Readonly<{
  from: string;
  to: string;
  note: string;
}>;

export type CareerProfileContent = Readonly<{
  schemaVersion: typeof CAREER_PROFILE_SCHEMA_VERSION;
  headline: string | null;
  positions: readonly CareerPosition[];
  education: readonly CareerEducation[];
  certifications: readonly CareerCertification[];
  skills: readonly CareerSkillGroup[];
  gaps: readonly CareerGap[];
}>;

export class CareerProfileValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`CAREER_PROFILE_INVALID:${issues.slice(0, 3).join("|")}`);
    this.name = "CareerProfileValidationError";
    this.issues = issues;
  }
}

const DATE_PATTERN = /^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/u;
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const EVIDENCE_KEY_PATTERN = /^[0-9a-f]{64}$/u;

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };
function canonicalize(value: unknown): Canonical {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return null;
}

export function hashProfileDocument(content: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(content))).digest("hex");
}

function text(value: unknown, max: number, issues: string[], path: string, required = true): string | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    if (required) issues.push(`${path}:required`);
    return null;
  }
  if (typeof value !== "string") { issues.push(`${path}:type`); return null; }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length > max) { issues.push(`${path}:length`); return normalized.slice(0, max); }
  return normalized;
}

function date(value: unknown, issues: string[], path: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value.trim())) { issues.push(`${path}:date`); return null; }
  return value.trim();
}

function stringList(value: unknown, maxItems: number, maxLength: number, issues: string[], path: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) { issues.push(`${path}:type`); return []; }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [index, entry] of value.slice(0, maxItems).entries()) {
    const item = text(entry, maxLength, issues, `${path}[${index}]`);
    if (item && !seen.has(item.toLowerCase())) { seen.add(item.toLowerCase()); out.push(item); }
  }
  if (value.length > maxItems) issues.push(`${path}:too_many`);
  return out;
}

/** Stable, human-inspectable position key derived from organization + title + start. */
export function derivePositionKey(organization: string, title: string, startDate: string | null): string {
  const digest = createHash("sha256")
    .update(`${organization.toLowerCase().trim()}\n${title.toLowerCase().trim()}\n${startDate ?? ""}`)
    .digest("hex");
  return `p-${digest.slice(0, 10)}`;
}

export function parseCareerProfileContent(value: unknown): CareerProfileContent {
  const issues: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CareerProfileValidationError(["root:type"]);
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== CAREER_PROFILE_SCHEMA_VERSION) issues.push("schemaVersion");

  const positionsInput = Array.isArray(record.positions) ? record.positions.slice(0, 20) : [];
  if (!Array.isArray(record.positions)) issues.push("positions:type");
  const positionKeys = new Set<string>();
  const assignedEvidence = new Set<string>();
  const positions: CareerPosition[] = positionsInput.map((entry, index) => {
    const path = `positions[${index}]`;
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const title = text(item.title, 160, issues, `${path}.title`) ?? "";
    const organization = text(item.organization, 160, issues, `${path}.organization`) ?? "";
    const startDate = date(item.startDate, issues, `${path}.startDate`);
    const current = item.current === true;
    const endDate = current ? null : date(item.endDate, issues, `${path}.endDate`);
    if (startDate && endDate && endDate.slice(0, 7) < startDate.slice(0, 7)) issues.push(`${path}:date_order`);
    let positionKey = typeof item.positionKey === "string" ? item.positionKey.trim() : "";
    if (!KEY_PATTERN.test(positionKey)) positionKey = derivePositionKey(organization, title, startDate);
    if (positionKeys.has(positionKey)) positionKey = `${positionKey.slice(0, 56)}-${index}`;
    positionKeys.add(positionKey);
    const evidenceKeys = stringList(item.evidenceKeys, 40, 64, issues, `${path}.evidenceKeys`)
      .filter((key) => EVIDENCE_KEY_PATTERN.test(key) && !assignedEvidence.has(key));
    evidenceKeys.forEach((key) => assignedEvidence.add(key));
    const kind = typeof item.employmentKind === "string" && (EMPLOYMENT_KINDS as readonly string[]).includes(item.employmentKind)
      ? item.employmentKind as EmploymentKind : null;
    return Object.freeze({
      positionKey,
      title,
      organization,
      location: text(item.location, 120, issues, `${path}.location`, false),
      startDate,
      endDate,
      current,
      employmentKind: kind,
      summary: text(item.summary, 240, issues, `${path}.summary`, false),
      evidenceKeys: Object.freeze(evidenceKeys),
    });
  });

  const educationInput = Array.isArray(record.education) ? record.education.slice(0, 10) : [];
  const education: CareerEducation[] = educationInput.map((entry, index) => {
    const path = `education[${index}]`;
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const institution = text(item.institution, 160, issues, `${path}.institution`) ?? "";
    const credential = text(item.credential, 160, issues, `${path}.credential`) ?? "";
    let educationKey = typeof item.educationKey === "string" ? item.educationKey.trim() : "";
    if (!KEY_PATTERN.test(educationKey)) educationKey = `e-${createHash("sha256").update(`${institution}\n${credential}`.toLowerCase()).digest("hex").slice(0, 10)}`;
    return Object.freeze({
      educationKey,
      institution,
      credential,
      field: text(item.field, 120, issues, `${path}.field`, false),
      location: text(item.location, 120, issues, `${path}.location`, false),
      startDate: date(item.startDate, issues, `${path}.startDate`),
      endDate: date(item.endDate, issues, `${path}.endDate`),
      details: Object.freeze(stringList(item.details, 6, 200, issues, `${path}.details`)),
    });
  });

  const certifications: CareerCertification[] = (Array.isArray(record.certifications) ? record.certifications.slice(0, 20) : [])
    .map((entry, index) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return Object.freeze({
        name: text(item.name, 160, issues, `certifications[${index}].name`) ?? "",
        issuer: text(item.issuer, 120, issues, `certifications[${index}].issuer`, false),
        date: date(item.date, issues, `certifications[${index}].date`),
      });
    });

  const skills: CareerSkillGroup[] = (Array.isArray(record.skills) ? record.skills.slice(0, 12) : [])
    .map((entry, index) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return Object.freeze({
        label: text(item.label, 60, issues, `skills[${index}].label`, false),
        items: Object.freeze(stringList(item.items, 40, 60, issues, `skills[${index}].items`)),
      });
    })
    .filter((group) => group.items.length > 0);

  const gaps: CareerGap[] = (Array.isArray(record.gaps) ? record.gaps.slice(0, 6) : [])
    .map((entry, index) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return Object.freeze({
        from: date(item.from, issues, `gaps[${index}].from`) ?? "",
        to: date(item.to, issues, `gaps[${index}].to`) ?? "",
        note: text(item.note, 300, issues, `gaps[${index}].note`) ?? "",
      });
    });

  if (issues.length > 0) throw new CareerProfileValidationError(issues);
  return Object.freeze({
    schemaVersion: CAREER_PROFILE_SCHEMA_VERSION,
    headline: text(record.headline, 160, [], "headline", false),
    positions: Object.freeze(positions),
    education: Object.freeze(education),
    certifications: Object.freeze(certifications),
    skills: Object.freeze(skills),
    gaps: Object.freeze(gaps),
  });
}

export { displayCareerDate, displayCareerRange, sortPositionsNewestFirst } from "./career-dates.ts";

function normalizeForGrounding(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/[’‘]/gu, "'")
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}+#'.-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Deterministic grounding: organizations, titles, institutions, credentials,
 * certifications, and skills in an extracted profile must appear in the
 * candidate's own résumé text (or be edited by the candidate). Dates must use
 * years that appear in the résumé. Returns the list of ungrounded values.
 */
export function ungroundedCareerProfileValues(profile: CareerProfileContent, resumeText: string): readonly string[] {
  const haystack = ` ${normalizeForGrounding(resumeText)} `;
  const years = new Set(resumeText.match(/(?:19|20)\d{2}/gu) ?? []);
  const problems: string[] = [];
  const present = (value: string) => {
    const needle = normalizeForGrounding(value);
    if (!needle) return true;
    if (haystack.includes(` ${needle} `) || haystack.includes(needle)) return true;
    // Allow minor reordering: every meaningful token appears.
    const tokens = needle.split(" ").filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
  };
  for (const position of profile.positions) {
    if (!present(position.organization)) problems.push(`organization:${position.organization}`);
    if (!present(position.title)) problems.push(`title:${position.title}`);
    for (const value of [position.startDate, position.endDate]) {
      if (value && !years.has(value.slice(0, 4))) problems.push(`date:${value}`);
    }
  }
  for (const entry of profile.education) {
    if (!present(entry.institution)) problems.push(`institution:${entry.institution}`);
    if (!present(entry.credential)) problems.push(`credential:${entry.credential}`);
  }
  for (const certification of profile.certifications) {
    if (!present(certification.name)) problems.push(`certification:${certification.name}`);
  }
  for (const group of profile.skills) {
    for (const item of group.items) if (!present(item)) problems.push(`skill:${item}`);
  }
  return Object.freeze(problems);
}

/** Removes ungrounded skills (common extraction noise) but keeps the rest intact. */
export function withoutUngroundedSkills(profile: CareerProfileContent, resumeText: string): CareerProfileContent {
  const haystack = ` ${normalizeForGrounding(resumeText)} `;
  const skills = profile.skills
    .map((group) => Object.freeze({
      ...group,
      items: Object.freeze(group.items.filter((item) => {
        const needle = normalizeForGrounding(item);
        return Boolean(needle) && haystack.includes(needle);
      })),
    }))
    .filter((group) => group.items.length > 0);
  return Object.freeze({ ...profile, skills: Object.freeze(skills) });
}

export function emptyCareerProfile(): CareerProfileContent {
  return Object.freeze({
    schemaVersion: CAREER_PROFILE_SCHEMA_VERSION,
    headline: null,
    positions: Object.freeze([]),
    education: Object.freeze([]),
    certifications: Object.freeze([]),
    skills: Object.freeze([]),
    gaps: Object.freeze([]),
  });
}
