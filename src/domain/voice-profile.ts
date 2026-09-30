/**
 * How the candidate actually sounds. Drafting uses it for tone and phrasing
 * only; nothing in a voice profile can support a factual claim.
 */
export const VOICE_PROFILE_SCHEMA_VERSION = 1 as const;

export type VoiceProfileContent = Readonly<{
  schemaVersion: typeof VOICE_PROFILE_SCHEMA_VERSION;
  /** How they describe their work to a friend, in their own words. */
  selfDescription: string | null;
  /** Something they wrote themselves: an email, a post, a note. */
  writingSample: string | null;
  /** e.g. "Direct. Short sentences. A little dry. No exclamation marks." */
  toneNotes: string | null;
  preferredPhrases: readonly string[];
  /** Words and phrases they never want in their materials. */
  avoidPhrases: readonly string[];
  signOff: string | null;
}>;

export class VoiceProfileValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "VoiceProfileValidationError";
    this.field = field;
  }
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/\r\n?/gu, "\n").replace(/[ \t]+/gu, " ").trim();
  if (normalized.length > max) throw new VoiceProfileValidationError(field, `Keep this under ${max} characters.`);
  return normalized;
}

function phraseList(value: unknown, field: string): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" ? value.split(/[\n,;]+/u) : [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const phrase = item.replace(/\s+/gu, " ").replace(/^["'“”]+|["'“”]+$/gu, "").trim();
    if (!phrase) continue;
    if (phrase.length > 60) throw new VoiceProfileValidationError(field, "Keep each phrase under 60 characters.");
    if (!out.some((existing) => existing.toLocaleLowerCase("en-US") === phrase.toLocaleLowerCase("en-US"))) out.push(phrase);
  }
  if (out.length > 40) throw new VoiceProfileValidationError(field, "Keep the list under 40 phrases.");
  return out;
}

export function parseVoiceProfileContent(value: unknown): VoiceProfileContent {
  const record = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return Object.freeze({
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    selfDescription: optionalText(record.selfDescription, "selfDescription", 1200),
    writingSample: optionalText(record.writingSample, "writingSample", 6000),
    toneNotes: optionalText(record.toneNotes, "toneNotes", 600),
    preferredPhrases: Object.freeze(phraseList(record.preferredPhrases, "preferredPhrases")),
    avoidPhrases: Object.freeze(phraseList(record.avoidPhrases, "avoidPhrases")),
    signOff: optionalText(record.signOff, "signOff", 40),
  });
}
