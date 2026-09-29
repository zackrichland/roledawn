/**
 * Candidate-facing document models. These are the only shapes the artifact
 * renderer accepts: every string here is final, reviewed copy. Model output is
 * validated and merged with exact candidate facts before it becomes one of
 * these records, so the renderer never decides what is true.
 */

export const APPLICATION_DOCUMENT_MODEL_RELEASE = "application-documents/1";

export type DocumentContact = Readonly<{
  /** Display-ready "City, ST" or "City, Region". */
  location: string | null;
  email: string | null;
  /** Display-ready phone, e.g. "(571) 332-1254". */
  phone: string | null;
  /** Absolute https URL; the renderer shows it without the scheme. */
  linkedinUrl: string | null;
  websiteUrl: string | null;
}>;

export type ResumeExperienceEntry = Readonly<{
  /** Job title exactly as the candidate held it. */
  title: string;
  organization: string;
  location: string | null;
  /** Display-ready date range, e.g. "Mar 2024 – Present" or "2019 – 2020". */
  dates: string | null;
  /** Optional one-line scope note shown under the role line (team, scale). */
  context: string | null;
  bullets: readonly string[];
}>;

export type ResumeEducationEntry = Readonly<{
  /** Degree or program, e.g. "B.S., Business Management". */
  credential: string;
  institution: string;
  location: string | null;
  dates: string | null;
  details: readonly string[];
}>;

export type ResumeSkillGroup = Readonly<{
  /** Null renders the items as one plain line. */
  label: string | null;
  items: readonly string[];
}>;

export type ResumeSection =
  | Readonly<{ kind: "EXPERIENCE"; heading: string; entries: readonly ResumeExperienceEntry[] }>
  | Readonly<{ kind: "PROJECTS"; heading: string; entries: readonly ResumeExperienceEntry[] }>
  | Readonly<{ kind: "EDUCATION"; heading: string; entries: readonly ResumeEducationEntry[] }>
  | Readonly<{ kind: "SKILLS"; heading: string; groups: readonly ResumeSkillGroup[] }>
  | Readonly<{ kind: "LIST"; heading: string; items: readonly string[] }>;

export type ResumeDocumentModel = Readonly<{
  release: typeof APPLICATION_DOCUMENT_MODEL_RELEASE;
  name: string;
  /** Short positioning line under the name, e.g. "Forward Deployed Engineer · Healthcare AI". */
  headline: string | null;
  contact: DocumentContact;
  /** Two to three sentences; null omits the section. */
  summary: string | null;
  /** Rendered in order. Bullets are ordered most important first. */
  sections: readonly ResumeSection[];
}>;

export type CoverLetterDocumentModel = Readonly<{
  release: typeof APPLICATION_DOCUMENT_MODEL_RELEASE;
  name: string;
  contact: DocumentContact;
  /** Display-ready date, e.g. "September 28, 2026". */
  dateLine: string;
  /** Employer and role lines above the salutation. */
  recipientLines: readonly string[];
  salutation: string;
  paragraphs: readonly string[];
  closing: string;
  signature: string;
}>;

const US_PHONE = /^\+1(\d{3})(\d{3})(\d{4})$/u;

/** E.164 values are stored exactly; documents show the familiar national form. */
export function displayPhone(e164: string | null | undefined): string | null {
  const value = e164?.trim();
  if (!value) return null;
  const us = US_PHONE.exec(value);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : value;
}

export function displayUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  return value.replace(/^https?:\/\//iu, "").replace(/^www\./iu, "").replace(/\/+$/u, "");
}

const EMPLOYER_SUFFIX = /(?:,?\s+(?:inc\.?|incorporated|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.?|company|pbc|plc|gmbh|s\.a\.|technologies|technology|labs))+$/iu;

/** "Palantir Technologies" -> "Palantir"; used only in the salutation. */
export function shortEmployerName(employer: string): string {
  const trimmed = employer.trim();
  const short = trimmed.replace(EMPLOYER_SUFFIX, "").trim();
  return short.length >= 2 ? short : trimmed;
}

export function formatLetterDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(value);
}

function contactLine(contact: DocumentContact): string {
  return [contact.location, contact.email, contact.phone, displayUrl(contact.linkedinUrl), displayUrl(contact.websiteUrl)]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" · ");
}

/**
 * Plain text for paste boxes, ATS text QA, and semantic checking. Its reading
 * order is the rendered reading order.
 */
export function resumePlainText(model: ResumeDocumentModel): string {
  const lines: string[] = [model.name];
  if (model.headline) lines.push(model.headline);
  const contact = contactLine(model.contact);
  if (contact) lines.push(contact);
  if (model.summary) lines.push("", "SUMMARY", model.summary);
  for (const section of model.sections) {
    const empty = section.kind === "SKILLS" ? section.groups.every((group) => group.items.length === 0)
      : section.kind === "LIST" ? section.items.length === 0 : section.entries.length === 0;
    if (empty) continue;
    lines.push("", section.heading.toLocaleUpperCase("en-US"));
    if (section.kind === "EXPERIENCE" || section.kind === "PROJECTS") {
      for (const entry of section.entries) {
        lines.push([`${entry.title}, ${entry.organization}`, entry.location, entry.dates].filter(Boolean).join(" | "));
        if (entry.context) lines.push(entry.context);
        for (const bullet of entry.bullets) lines.push(`• ${bullet}`);
      }
    } else if (section.kind === "EDUCATION") {
      for (const entry of section.entries) {
        lines.push([`${entry.credential}, ${entry.institution}`, entry.location, entry.dates].filter(Boolean).join(" | "));
        for (const detail of entry.details) lines.push(`• ${detail}`);
      }
    } else if (section.kind === "SKILLS") {
      for (const group of section.groups) {
        if (group.items.length === 0) continue;
        lines.push(group.label ? `${group.label}: ${group.items.join(", ")}` : group.items.join(", "));
      }
    } else {
      for (const item of section.items) lines.push(`• ${item}`);
    }
  }
  return lines.join("\n");
}

export function coverLetterPlainText(model: CoverLetterDocumentModel): string {
  const contact = contactLine(model.contact);
  return [
    model.name,
    ...(contact ? [contact] : []),
    "",
    model.dateLine,
    ...model.recipientLines,
    "",
    model.salutation,
    "",
    model.paragraphs.join("\n\n"),
    "",
    model.closing,
    model.signature,
  ].join("\n");
}
