/**
 * RoleDawn-owned deterministic "no-slop" writing linter.
 *
 * Checks generated cover letters, résumé summaries, résumé bullets, and short
 * application answers for stock AI/HR phrasing, structural tells of generated
 * prose, placeholders, and internal leaks. The pattern catalog and all wording
 * are original to RoleDawn; no third-party skill text is reproduced (AGENTS.md).
 *
 * The linter is pure: no I/O, no clock, no randomness, no dependencies. The
 * same input always yields the same report.
 *
 * Severity contract:
 * - BLOCKING: unacceptable even once (placeholders, model or metadata leaks,
 *   fabricated quotes, emoji, first person in résumé bullets, broken text).
 * - REPAIR: must be fixed by a rewrite pass before the text passes.
 * - WARNING: stylistic nudge; never fails the gate.
 *
 * False-positive discipline: words with legitimate technical, financial,
 * medical, or proper-noun uses ("leverage ratio", "landscape architect",
 * "dynamic programming", "robust statistics", "test harness", "foster care",
 * "elevated privileges") are matched only in their cliché contexts. Text that
 * matches `allowTerms` is never flagged by phrase rules, and a cliché inside a
 * short quotation (a deliberately mirrored posting phrase) is only a WARNING.
 */

export const WRITING_LINT_RELEASE = "roledawn-writing-lint/1";

export type WritingSurface = "COVER_LETTER" | "RESUME_SUMMARY" | "RESUME_BULLET" | "ANSWER";
export type WritingLintSeverity = "BLOCKING" | "REPAIR" | "WARNING";

export type WritingLintIssue = Readonly<{
  /** Stable UPPER_SNAKE code; see WRITING_LINT_CODES. */
  code: string;
  severity: WritingLintSeverity;
  surface: WritingSurface;
  /** Paragraph, bullet, or answer index within its surface (0-based). */
  index: number;
  /** The offending span (at most 120 characters). */
  excerpt: string;
  /** One plain sentence for a human reviewer. */
  message: string;
  /** One concrete instruction for a rewriting model. */
  fix: string;
}>;

export type WritingLintInput = Readonly<{
  coverLetterParagraphs?: readonly string[];
  resumeSummary?: string | null;
  /** current=true means the bullet belongs to a present role (present tense allowed). */
  resumeBullets?: readonly Readonly<{ text: string; current: boolean }>[];
  answers?: readonly string[];
  /** Candidate-specific words or phrases they said they hate. Treated like cliché bans. */
  candidateBannedPhrases?: readonly string[];
  /** First sentences of the candidate's recent letters, newest first (up to 10 are used). */
  recentOpenings?: readonly string[];
  /** Employer, role, product, and mirrored posting phrases that must never be flagged. */
  allowTerms?: readonly string[];
}>;

export type WritingLintReport = Readonly<{
  release: typeof WRITING_LINT_RELEASE;
  /** True when there is no BLOCKING and no REPAIR issue. */
  passed: boolean;
  issues: readonly WritingLintIssue[];
  /** Cover-letter measurements (body paragraphs only for sentence statistics). */
  metrics: Readonly<{
    coverLetterWords: number;
    sentences: number;
    sentenceLengthCv: number | null;
    iStartShare: number | null;
    emDashesPer100Words: number;
    openingSimilarity: number | null;
  }>;
}>;

/**
 * Every issue code with its usual severity. Codes marked "varies" can also be
 * emitted at a lower severity; the comment names the rule.
 */
export const WRITING_LINT_CODES = Object.freeze({
  PLACEHOLDER_TEXT: "BLOCKING",
  MODEL_LEAK: "BLOCKING",
  INTERNAL_METADATA_LEAK: "BLOCKING",
  MARKDOWN_ARTIFACT: "BLOCKING",
  EMOJI_OR_HASHTAG: "BLOCKING",
  FABRICATED_QUOTE: "BLOCKING",
  FIRST_PERSON_IN_BULLET: "BLOCKING",
  BROKEN_TEXT: "BLOCKING",
  AI_CLICHE_PHRASE: "REPAIR",
  CANDIDATE_BANNED_PHRASE: "REPAIR",
  /** Disclaims or diminishes the candidate ("adjacent to, not the same as"). */
  SELF_UNDERCUT: "REPAIR",
  /** The same content phrase in three or more résumé lines. */
  REPEATED_PHRASE: "REPAIR",
  /** varies: WARNING for soft openers ("When I saw…") and dated salutations. */
  CEREMONIAL_OPENING: "REPAIR",
  ANSWER_PREAMBLE: "REPAIR",
  BINARY_CONTRAST: "REPAIR",
  FAUX_INSIGHT_SETUP: "REPAIR",
  /** varies: WARNING when a surface has exactly one question. */
  RHETORICAL_QUESTION: "REPAIR",
  TRIPLET_STACK: "REPAIR",
  EM_DASH_DENSITY: "REPAIR",
  EXCLAMATION: "REPAIR",
  SUMMARY_CLOSER: "REPAIR",
  I_START_OVERUSE: "REPAIR",
  WEASEL_ATTRIBUTION: "REPAIR",
  OPENING_REUSE: "REPAIR",
  WEAK_BULLET_OPENER: "REPAIR",
  BUZZWORD_SOUP: "REPAIR",
  /** varies: WARNING when 0.2 <= CV < 0.28. */
  SENTENCE_UNIFORMITY: "REPAIR",
  MIRRORED_POSTING_CLICHE: "WARNING",
  DRAMATIC_DASH_PAYOFF: "WARNING",
  TRANSITION_OPENER: "WARNING",
  INTENSIFIER_PILEUP: "WARNING",
  HEDGE_FILLER: "WARNING",
  WEAK_VERB: "WARNING",
  BULLET_NOT_ACTION_VERB: "WARNING",
  BULLET_TENSE_MISMATCH: "WARNING",
  BULLET_LENGTH: "WARNING",
  BULLET_PUNCTUATION_INCONSISTENT: "WARNING",
  BULLET_REPEATED_OPENER: "WARNING",
} as const satisfies Record<string, WritingLintSeverity>);

export type WritingLintCode = keyof typeof WRITING_LINT_CODES;

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

type Span = Readonly<{ start: number; end: number }>;
type Sentence = Readonly<{ text: string; start: number; end: number }>;
type QuoteSpan = Readonly<{ start: number; end: number; inner: string }>;
type ParagraphRole = "SALUTATION" | "SIGN_OFF" | "BODY";

type TextItem = Readonly<{
  surface: WritingSurface;
  index: number;
  text: string;
  current: boolean;
  role: ParagraphRole;
  /** Length before the MAX_ITEM_CHARS cap was applied. */
  originalLength: number;
}>;

type ItemContext = {
  readonly item: TextItem;
  readonly allowMasks: readonly Span[];
  readonly quotes: readonly QuoteSpan[];
  readonly sentences: readonly Sentence[];
  readonly claimed: Span[];
  /** Positions of "?" already explained by another rule (e.g. "The result?"). */
  readonly explainedQuestions: Set<number>;
  /** Number of stock phrases found (drives BUZZWORD_SOUP). */
  stockPhraseCount: number;
};

type Draft = {
  code: WritingLintCode;
  severity: WritingLintSeverity;
  surface: WritingSurface;
  index: number;
  excerpt: string;
  message: string;
  fix: string;
  offset: number;
};

const SEVERITY_RANK: Readonly<Record<WritingLintSeverity, number>> = { BLOCKING: 0, REPAIR: 1, WARNING: 2 };
const SURFACE_RANK: Readonly<Record<WritingSurface, number>> = {
  COVER_LETTER: 0,
  RESUME_SUMMARY: 1,
  RESUME_BULLET: 2,
  ANSWER: 3,
};

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;
const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200D\u2060\uFEFF]/gu;
const MAX_EXCERPT = 120;

function cleanText(value: string): string {
  return value.normalize("NFC").replace(INVISIBLE_CHARACTERS, "");
}

function words(text: string): string[] {
  return text.match(WORD_PATTERN) ?? [];
}

function wordCount(text: string): number {
  return words(text).length;
}

function lower(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function clip(text: string, max = MAX_EXCERPT): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function overlapsAny(span: Span, spans: readonly Span[]): boolean {
  return spans.some((entry) => overlaps(span, entry));
}

function insideAny(span: Span, spans: readonly Span[]): boolean {
  return spans.some((entry) => span.start >= entry.start && span.end <= entry.end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Letters and digits (ASCII plus Latin-1/Latin Extended) that must not touch a user term. */
const TERM_EDGE = "A-Za-z0-9\\u00C0-\\u024F";

/** Case-insensitive, word-boundary pattern for a user-supplied term. */
function termPattern(term: string): RegExp | null {
  const tokens = cleanText(term).trim().split(/[\s\-‐‑–—]+/u).filter(Boolean);
  if (tokens.length === 0) return null;
  const body = tokens.map(escapeRegExp).join("[\\s\\-‐‑–—]+");
  return new RegExp(`(?<![${TERM_EDGE}])${body}(?![${TERM_EDGE}])`, "gi");
}

function termSpans(text: string, terms: readonly RegExp[]): Span[] {
  const spans: Span[] = [];
  for (const pattern of terms) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
}

/** Words immediately after `end`, lower-cased. */
function nextWords(text: string, end: number, count = 2): string[] {
  return words(text.slice(end, end + 80)).slice(0, count).map(lower);
}

/** Words immediately before `start`, lower-cased, nearest last. */
function prevWords(text: string, start: number, count = 2): string[] {
  return words(text.slice(Math.max(0, start - 80), start)).map(lower).slice(-count);
}

const SENTENCE_WINDOW = 400;

/** The sentence-ish region containing [start, end), bounded so guards stay cheap per match. */
function sentenceAround(text: string, start: number, end: number): string {
  const floor = Math.max(0, start - SENTENCE_WINDOW);
  const ceiling = Math.min(text.length, end + SENTENCE_WINDOW);
  let left = start;
  while (left > floor && !/[.!?\n]/u.test(text[left - 1])) left -= 1;
  let right = end;
  while (right < ceiling && !/[.!?\n]/u.test(text[right])) right += 1;
  return text.slice(left, Math.min(text.length, right + 1));
}

/** A short window around a tiny match (a pronoun, "!", "?") for readable excerpts. */
function contextExcerpt(text: string, start: number, end: number, radius = 36): string {
  let left = Math.max(0, start - radius);
  let right = Math.min(text.length, end + radius);
  while (left > 0 && /\S/u.test(text[left - 1]) && start - left < radius + 12) left -= 1;
  while (right < text.length && /\S/u.test(text[right]) && right - end < radius + 12) right += 1;
  return clip(text.slice(left, right));
}

/**
 * True when `index` begins a sentence: start of text, after terminal punctuation,
 * after a line break, or after a line-initial list marker. Text after ":" or ";"
 * is not treated as a sentence start, so "Tools: Harness, Argo" keeps the
 * capitalized product name protected as a proper noun.
 */
function isSentenceStart(text: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /[\s"“‘'(\[]/u.test(text[cursor])) {
    if (text[cursor] === "\n") return true;
    cursor -= 1;
  }
  if (cursor < 0 || /[.!?]/u.test(text[cursor])) return true;
  return /[-*•]/u.test(text[cursor]) && (cursor === 0 || text[cursor - 1] === "\n");
}

// ---------------------------------------------------------------------------
// Sentence splitting and quotation spans
// ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "inc", "ltd", "co", "corp",
  "llc", "st", "no", "approx", "dept", "est", "fig", "u.s", "u.k", "ph.d", "m.s", "b.s", "b.a", "m.a",
  "m.b.a", "a.m", "p.m", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov",
  "dec", "mt", "ft", "vol", "rev", "gen", "gov", "sen", "rep", "univ", "assn", "bros", "al",
]);

const SENTENCE_END = /[.!?…]+["”’')\]]*(?=\s|$)/gu;
const NEXT_NON_SPACE = /\s*(\S)/uy;

function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  const pushSentence = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed && /[\p{L}\p{N}]/u.test(trimmed)) {
      sentences.push({ text: trimmed, start: from + lead, end: from + lead + trimmed.length });
    }
  };
  const boundaries: number[] = [];
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (match[0].startsWith(".") && match[0].replace(/["”’')\]]+$/u, "") === ".") {
      const before = text.slice(Math.max(0, match.index - 12), match.index).match(/([\p{L}\p{N}.]+)$/u)?.[1] ?? "";
      const token = lower(before);
      if (ABBREVIATIONS.has(token) || /^\p{Lu}$/u.test(before)) continue;
    }
    NEXT_NON_SPACE.lastIndex = end;
    const nextChar = NEXT_NON_SPACE.exec(text)?.[1];
    if (nextChar && /\p{Ll}/u.test(nextChar)) continue;
    boundaries.push(end);
  }
  for (let cursor = text.indexOf("\n"); cursor !== -1; cursor = text.indexOf("\n", cursor + 1)) {
    boundaries.push(cursor);
  }
  boundaries.sort((a, b) => a - b);
  for (const boundary of boundaries) {
    if (boundary <= start) continue;
    pushSentence(start, boundary);
    start = boundary;
  }
  pushSentence(start, text.length);
  return sentences;
}

const QUOTE_PATTERN = /"([^"\n]{1,400})"|“([^”\n]{1,400})”/gu;

function quoteSpans(text: string): QuoteSpan[] {
  return [...text.matchAll(QUOTE_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    inner: match[1] ?? match[2] ?? "",
  }));
}

function normalizePhrase(value: string): string {
  return lower(cleanText(value))
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Context guards: legitimate uses of words that are clichés elsewhere
// ---------------------------------------------------------------------------

type SkipGuard = (text: string, start: number, end: number) => boolean;

const FINANCE_NEXT = new Set([
  "ratio", "ratios", "buyout", "buyouts", "loan", "loans", "finance", "financing", "lending", "multiple",
  "multiples", "covenant", "covenants", "recap", "recapitalization", "etf", "etfs", "fund", "funds",
  "position", "positions", "target", "targets", "profile", "test", "level", "levels", "limit", "limits",
]);
const FINANCE_PREV = new Set([
  "operating", "financial", "net", "gross", "total", "senior", "excess", "debt", "high", "higher", "low",
  "lower", "reduced", "reduce", "reducing", "peak", "portfolio", "bank", "market", "consolidated",
  "lease", "adjusted", "x", "×",
]);
const FINANCE_CONTEXT = /\b(?:EBITDA|LBO|debt|covenants?|credit\s+facilit(?:y|ies)|capital\s+structure|balance\s+sheet|bps|basis\s+points|high[- ]yield|private\s+equity|hedge\s+funds?|margin\s+loans?|deleverag\w*)\b/i;
const LEVERAGE_NOUN_PREV = new Set([
  "the", "our", "their", "his", "her", "its", "more", "less", "some", "any", "no", "gained", "gain",
  "gaining", "had", "have", "has", "having", "much", "negotiating", "bargaining", "political", "as",
  "for", "of", "with", "enough", "significant", "little",
]);

const leverageIsLegit: SkipGuard = (text, start, end) => {
  const next = nextWords(text, end, 1)[0] ?? "";
  const prev = prevWords(text, start, 1)[0] ?? "";
  if (FINANCE_NEXT.has(next) || FINANCE_PREV.has(prev)) return true;
  if (/\d(?:\.\d+)?\s*[x×]\s*$/u.test(text.slice(Math.max(0, start - 12), start))) return true;
  if (FINANCE_CONTEXT.test(sentenceAround(text, start, end))) return true;
  return lower(text.slice(start, end)) === "leverage" && LEVERAGE_NOUN_PREV.has(prev);
};

const SYNERGY_NEXT = new Set(["target", "targets", "capture", "realization", "model", "case", "plan", "tracking", "tracker"]);
const SYNERGY_PREV = new Set(["cost", "revenue", "operating", "operational", "expense", "merger", "deal", "integration", "procurement", "tax"]);
const PHARMA_NEXT = new Set(["effect", "effects", "combination", "combinations", "interaction", "interactions", "activity", "killing", "inhibition"]);

const synergyIsLegit: SkipGuard = (text, start, end) => {
  const form = lower(text.slice(start, end));
  const next = nextWords(text, end, 1)[0] ?? "";
  if (form.startsWith("synergistic")) return PHARMA_NEXT.has(next);
  if (form !== "synergy" && form !== "synergies") return false;
  const prev = prevWords(text, start, 1)[0] ?? "";
  if (SYNERGY_NEXT.has(next) || SYNERGY_PREV.has(prev)) return true;
  return /\$\s?\d|\bM&A\b|\bmergers?\b|\bacquisitions?\b/i.test(sentenceAround(text, start, end));
};

const SEAMLESS_NEXT = new Set(["steel", "pipe", "pipes", "tube", "tubes", "tubing", "garment", "garments", "knit", "knitting", "gutter", "gutters", "flooring", "stockings"]);
const HONE_NEXT = new Set(["cylinder", "cylinders", "bore", "bores", "blade", "blades", "knife", "knives", "edge", "edges", "machine", "machines", "stone", "stones", "tool", "tools", "oil", "engine", "valve", "valves"]);
const JOURNEY_PREV = new Set(["customer", "user", "buyer", "patient", "member", "employee", "donor", "shopper", "guest", "client", "traveler", "traveller", "purchase", "candidate", "student", "citizen"]);
const JOURNEY_NEXT = new Set(["map", "maps", "mapping", "mapped", "analytics", "orchestration", "stage", "stages", "builder", "design"]);
const ELEVATE_NEXT = new Set([
  "blood", "privilege", "privileges", "permission", "permissions", "access", "risk", "risks", "level", "levels",
  "temperature", "temperatures", "liver", "heart", "rate", "rates", "pressure", "enzymes", "readings",
  "concentration", "concentrations", "platform", "platforms", "walkway", "train", "highway", "roadway",
  "track", "tank", "tanks", "terrain", "glucose", "cholesterol", "troponin", "lactate", "bilirubin", "creatinine",
]);
const HARNESS_PREV = new Set(["wiring", "wire", "test", "testing", "safety", "cable", "climbing", "dog", "horse", "evaluation", "eval", "benchmark", "fuzzing", "fuzz", "integration", "automotive", "aircraft", "engine"]);
const HARNESS_NEXT = new Set(["assembly", "assemblies", "design", "designs", "manufacturing", "routing", "drawing", "drawings", "racing", "fabrication", "board", "boards"]);
const FOSTER_NEXT = new Set([
  "care", "parent", "parents", "home", "homes", "youth", "kids", "children", "child", "family", "families",
  "system", "placement", "placements", "mom", "mother", "dad", "father", "dog", "dogs", "cat", "cats",
  "pet", "pets", "animals", "agency", "agencies", "city",
]);
const HOLISTIC_NEXT = new Set(["nursing", "nurse", "nurses", "medicine", "health", "care", "practitioner", "therapy"]);
const REVOLUTION_NEXT = new Set(["war", "period", "era", "army", "guard", "committee", "france"]);
const WEASEL_PREV = new Set(["our", "my", "their", "internal", "company", "team", "customer", "user", "its", "your", "his", "her"]);
const DOUBLED_WORD_ALLOWED = new Set(["had", "that", "bye"]);

const nextIn = (set: ReadonlySet<string>): SkipGuard => (text, _start, end) => set.has(nextWords(text, end, 1)[0] ?? "");

const harnessIsLegit: SkipGuard = (text, start, end) => (
  HARNESS_PREV.has(prevWords(text, start, 1)[0] ?? "") || HARNESS_NEXT.has(nextWords(text, end, 1)[0] ?? "")
);
const journeyIsLegit: SkipGuard = (text, start, end) => (
  JOURNEY_PREV.has(prevWords(text, start, 1)[0] ?? "") || JOURNEY_NEXT.has(nextWords(text, end, 1)[0] ?? "")
);
const weaselIsLegit: SkipGuard = (text, start) => {
  const prev = prevWords(text, start, 1)[0] ?? "";
  if (WEASEL_PREV.has(prev)) return true;
  // "The data shows ..." points at a specific dataset; bare "Data shows ..." does not.
  return /^data\b/i.test(text.slice(start, start + 5)) && ["the", "this", "that", "these"].includes(prev);
};

// ---------------------------------------------------------------------------
// Phrase catalog (RoleDawn-authored). "{match}" in a fix is replaced by the
// matched text. Rules run in order; a later rule never re-flags a span an
// earlier rule already explained.
// ---------------------------------------------------------------------------

type PhraseCode =
  | "SELF_UNDERCUT"
  | "AI_CLICHE_PHRASE"
  | "HEDGE_FILLER"
  | "WEAK_VERB"
  | "WEASEL_ATTRIBUTION"
  | "SUMMARY_CLOSER"
  | "BINARY_CONTRAST"
  | "FAUX_INSIGHT_SETUP";

type PhraseRule = Readonly<{
  id: string;
  code: PhraseCode;
  pattern: RegExp;
  fix: string;
  skip?: SkipGuard;
}>;

const ENTHUSIASM_FIX = "Delete the enthusiasm claim '{match}'; show interest through one specific detail about the team, product, or problem.";
const SELF_LABEL_FIX = "Delete the self-label '{match}'; show the trait with a concrete example.";
const CONTRAST_FIX = "Rewrite '{match}' as one direct claim about what it is; drop the 'not X but Y' setup.";

const UNDERCUT_FIX = "Delete '{match}'. Don't point out what the candidate lacks or compare their record unfavorably with the posting; leave gaps unmentioned and lead with what transfers.";

const PHRASE_RULES: readonly PhraseRule[] = [
  // Self-undercutting runs first: a disclaimer is never acceptable, even
  // when it would also match a softer style rule.
  { id: "undercut-adjacent", code: "SELF_UNDERCUT", pattern: /\b(?:experience|work|background|record|evidence|skills?|this|that|it)\s+(?:is|are|was|were|remains?)\s+adjacent\s+to\b[^.;!?]{0,120}|\badjacent\s+to,?\s+(?:rather\s+than|not)\b[^.;!?]{0,80}/gi, fix: UNDERCUT_FIX },
  { id: "undercut-not-same", code: "SELF_UNDERCUT", pattern: /\bnot\s+a\s+claim\s+that\b[^.;!?]{0,100}|\b(?:not|rather\s+than)\s+equivalent\s+to\b[^.;!?]{0,100}|\brather\s+than\s+the\s+same\s+as\b[^.;!?]{0,100}|\bnot\s+the\s+same\s+as\s+(?:the\s+|this\s+|your\s+)?(?:[\w-]+\s+){0,3}(?:role|work|requirements?|experience|position)\b[^.;!?]{0,60}/gi, fix: UNDERCUT_FIX },
  { id: "undercut-would-not", code: "SELF_UNDERCUT", pattern: /\bI\s+(?:would|will|do|can)\s*(?:not|n['’]t)\s+(?:present|claim|describe|call|represent|pretend)\b[^.;!?]{0,100}/gi, fix: UNDERCUT_FIX },
  { id: "undercut-lack", code: "SELF_UNDERCUT", pattern: /\b(?:although|while|though|even\s+though)\s+I\s+(?:have\s+not|haven['’]t|lack|do\s+not\s+have|don['’]t\s+have|have\s+no|did\s+not|didn['’]t)\b[^.;!?]{0,100}|\bI\s+(?:lack|do\s+not\s+have|don['’]t\s+have|have\s+not\s+(?:yet\s+)?(?:worked|built|used|led|shipped|held)|haven['’]t\s+(?:yet\s+)?(?:worked|built|used|led|shipped|held))\b[^.;!?]{0,100}/gi, fix: UNDERCUT_FIX },
  { id: "undercut-rather-than-request", code: "SELF_UNDERCUT", pattern: /\brather\s+than\s+(?:the\s+)?[^.;!?]{1,80}?\b(?:you\s+(?:request|require|list|ask\s+for|want|need)|the\s+(?:role|posting|position)\s+(?:requires|asks\s+for|lists|calls\s+for))\b/gi, fix: UNDERCUT_FIX },
  { id: "undercut-not-match", code: "SELF_UNDERCUT", pattern: /\b(?:my\s+)?(?:experience|background|record|work|profile)\s+(?:is|was)\s+not\s+(?:a\s+|an\s+)?(?:direct|exact|perfect|one-to-one|complete)\s+(?:match|fit)\b[^.;!?]{0,80}/gi, fix: UNDERCUT_FIX },
  { id: "undercut-limited", code: "SELF_UNDERCUT", pattern: /\bmy\s+(?:experience|background|evidence|record|exposure)\s+(?:is|was|remains)\s+(?:limited|thin|narrower|lighter|indirect|adjacent)\b[^.;!?]{0,80}/gi, fix: UNDERCUT_FIX },
  // Multi-word structural rules first so single-word rules do not split them.
  { id: "contrast-not-just", code: "BINARY_CONTRAST", pattern: /\bnot\s+(?:just|only|merely|simply)\s+(?:about\s+)?[^.;:!?]{1,80}?[,;—–]?\s+but\b/gi, fix: CONTRAST_FIX },
  { id: "contrast-its-not", code: "BINARY_CONTRAST", pattern: /\b(?:it|this|that)(?:['’]s|\s+is|\s+was)\s+not\s+(?:just\s+|only\s+|merely\s+)?(?:about\s+)?[^.,;:!?—–]{1,60}?(?:[,;—–]|\.\s+|\s-{1,2}\s)\s*(?:it|this|that)(?:['’]s|\s+is|\s+was)\b/gi, fix: CONTRAST_FIX },
  { id: "contrast-isnt", code: "BINARY_CONTRAST", pattern: /\b(?:is|was|are|were)n['’]t\s+(?:just\s+|only\s+|about\s+)?[^.,;:!?—–]{1,60}?(?:[,;—–]|\.\s+|\s-{1,2}\s)\s*(?:it|they|this|that)(?:['’]s|\s+is|\s+was|\s+are|\s+were)\b/gi, fix: CONTRAST_FIX },
  { id: "contrast-less-more", code: "BINARY_CONTRAST", pattern: /\bless\s+about\s+[^.;:!?]{1,60}?\s+and\s+more\s+about\b/gi, fix: CONTRAST_FIX },
  { id: "faux-insight", code: "FAUX_INSIGHT_SETUP", pattern: /(?<=^|[.!?]["”’)]?\s{1,3}|\n)(?:here(?:['’]s|\s+is)\s+(?:the\s+thing|(?:why|how|what)(?:\s+[\w'’]+){0,4}|the\s+(?:kicker|twist|catch|deal))|the\s+(?:result|results|outcome|payoff|kicker|best\s+part|twist|catch|secret|lesson|takeaway|answer|truth|bottom\s+line|upshot|punchline|short\s+version|reason|verdict|real\s+(?:story|question|lesson))(?:\s+(?:is|was)(?:\s+(?:simple|clear|obvious|this|straightforward))?)?|bottom\s+line|spoiler(?:\s+alert)?|plot\s+twist|long\s+story\s+short)\s*[:?—–]/gi, fix: "Remove the setup '{match}' and state the result directly in one sentence." },
  { id: "summary-closer", code: "SUMMARY_CLOSER", pattern: /\bin\s+(?:conclusion|summary|closing)\b|(?<=^|[.!?]["”’)]?\s{1,3}|\n)(?:ultimately|in\s+short|all\s+in\s+all|to\s+sum\s+(?:it\s+)?up|to\s+summari[sz]e|in\s+the\s+end),|\bat\s+the\s+end\s+of\s+the\s+day\b|\b(?:that|this)(?:['’]s|\s+is)\s+(?:exactly\s+|precisely\s+)?(?:the\s+(?:kind|type|sort)\s+of\s+[^.!?]{1,40}?|what)\s+I\s+(?:would\s+|will\s+|want\s+to\s+|hope\s+to\s+|can\s+|plan\s+to\s+|intend\s+to\s+)?(?:bring|offer|deliver)\b/gi, fix: "Delete the summary line '{match}'; end on your last concrete point or a plain next step." },
  { id: "weasel", code: "WEASEL_ATTRIBUTION", pattern: /\b(?:studies|research|experts|surveys|science|statistics|data)\s+(?:shows?|suggests?|proves?|ha(?:ve|s)\s+shown|indicates?|agree|says?|confirms?)\b|\b(?:many|most|some)\s+(?:people|experts|leaders|researchers|professionals|studies)\s+(?:believe|say|argue|agree|think|feel|suggest|show)\b|\bmany\s+(?:believe|argue|say|agree)\b|\bit\s+is\s+(?:widely|commonly|generally|often)\s+(?:known|believed|accepted|agreed|said|understood|recognized)\b|\beveryone\s+knows\b|\bas\s+we\s+all\s+know\b|\bit(?:['’]s|\s+is)\s+no\s+secret\b/gi, fix: "Remove the unattributed claim '{match}' or name the specific source.", skip: weaselIsLegit },

  // Openers and enthusiasm.
  { id: "announcement", code: "AI_CLICHE_PHRASE", pattern: /\bI\s+am\s+writing\s+(?:to|in\s+(?:response|regard|reference))\b|\bI['’]m\s+writing\s+to\b|\bI(?:\s+am|['’]m)\s+reaching\s+out\b|\bI\s+wanted\s+to\s+reach\s+out\b|\bplease\s+accept\s+(?:this|my)\s+(?:letter|application)\b/gi, fix: "Cut the announcement '{match}'; start with what you did or why this role." },
  { id: "excited-to", code: "AI_CLICHE_PHRASE", pattern: /\b(?:excited|eager)\s+(?:to\s+(?:apply|join|bring|contribute|be\s+(?:a\s+)?part|learn\s+more|explore|submit|discuss|share|help|work|grow|see|have\s+the\s+(?:chance|opportunity))|(?:about|by)\s+(?:the|this|your)\s+(?:opportunity|role|position|prospect|possibility|chance|mission))\b/gi, fix: ENTHUSIASM_FIX },
  { id: "enthusiasm", code: "AI_CLICHE_PHRASE", pattern: /\b(?:thrilled|delighted|elated|ecstatic)\b/gi, fix: ENTHUSIASM_FIX },
  { id: "passion", code: "AI_CLICHE_PHRASE", pattern: /\bpassionate(?:ly)?\s+(?:about|for|in)\b|\b(?:my|a|an|deep|genuine|true|real|lifelong|strong|burning)\s+passion\b|\bpassion\s+for\b|\bI(?:\s+am|['’]m)\s+(?:\w+\s+)?passionate\b/gi, fix: "Replace the passion claim '{match}' with evidence: something you built, studied, or chose because of this interest." },

  // Fit and self-assessment claims.
  { id: "confident", code: "AI_CLICHE_PHRASE", pattern: /\bI(?:\s+am|['’]m)\s+(?:fully\s+|very\s+|highly\s+|extremely\s+|truly\s+)?confident\s+(?:that\s+)?(?:I|my|in\s+my)\b/gi, fix: "Delete '{match}'; state the evidence instead of your confidence." },
  { id: "fit-claim", code: "AI_CLICHE_PHRASE", pattern: /\b(?:(?:would|will|could)\s+be|I\s+am|I['’]m)\s+(?:a|an|the)\s+(?:great|good|strong|excellent|perfect|ideal|natural|fantastic|valuable|wonderful|tremendous|outstanding|right)\s+(?:fit|addition|candidate|match|asset|person)\b|\b(?:perfect|ideal|natural)\s+(?:fit|match|candidate)\b|\bI\s+believe\s+I\s+(?:would|will)\s+be\s+(?:a|an)\s+(?:[\w-]+\s+)?(?:fit|addition|candidate|match|asset)\b|\b(?:would|will|could)\s+be\s+an\s+asset\b/gi, fix: "Delete the fit claim '{match}'; show the match with one requirement and one example." },
  { id: "asset", code: "AI_CLICHE_PHRASE", pattern: /\b(?:valuable|great|strong|tremendous|invaluable)\s+(?:asset|addition)\b|\ban\s+asset\s+to\s+(?:your|the|any)\b/gi, fix: "Delete the self-assessment '{match}'; let the evidence carry it." },
  { id: "dream", code: "AI_CLICHE_PHRASE", pattern: /\bdream\s+(?:job|role|company|position|team|opportunity|employer|career|workplace)\b/gi, fix: "Replace '{match}' with the specific reason this role matters to you." },
  { id: "self-label", code: "AI_CLICHE_PHRASE", pattern: /\b(?:results|goal|detail)[- ](?:driven|oriented)\b|\bself[- ](?:starter|motivated)\b|\bteam\s+player\b|\bgo[- ]getter\b|\bhard[- ]?working\b|\bhighly\s+motivated\b|\bstrong\s+work\s+ethic\b|\b(?:quick|fast)\s+learner\b|\bpeople\s+person\b|\b(?:strategic|critical|creative|innovative|big[- ]picture)\s+(?:thinker|problem[- ]solver)\b|\b(?:seasoned|dedicated|accomplished|motivated|driven|versatile|passionate)\s+(?:professional|individual|self-starter)\b/gi, fix: SELF_LABEL_FIX },
  { id: "track-record", code: "AI_CLICHE_PHRASE", pattern: /\bproven\s+(?:track\s+record|record|ability|abilities|success|results|leader|leadership|history|expertise)\b|\btrack\s+record\s+of\s+(?:success|excellence|delivering|driving|achievement)\b/gi, fix: "Replace '{match}' with one result that proves it." },
  { id: "skills-claim", code: "AI_CLICHE_PHRASE", pattern: /\b(?:excellent|strong|exceptional|outstanding|superb|great)\s+(?:(?:written\s+and\s+verbal|verbal\s+and\s+written|interpersonal\s+and)\s+)?(?:communication|interpersonal|leadership|organi[sz]ational|problem[- ]solving|analytical)\s+skills\b/gi, fix: "Replace '{match}' with an example: who you worked with and what it changed." },
  { id: "wealth", code: "AI_CLICHE_PHRASE", pattern: /\b(?:a\s+)?wealth\s+of\s+(?:experience|knowledge|expertise)\b/gi, fix: "Replace '{match}' with the years and the specific work." },
  { id: "unique-blend", code: "AI_CLICHE_PHRASE", pattern: /\bunique\s+(?:blend|combination|mix|intersection|set|perspective|skill\s*set|background)\b|\b(?:rare|perfect|powerful)\s+(?:blend|combination|mix)\s+of\b/gi, fix: "Cut '{match}'; name the two skills and one place you used them together." },
  { id: "intersection", code: "AI_CLICHE_PHRASE", pattern: /\b(?:at|sits\s+at|lives\s+at|lies\s+at|work(?:s|ing)?\s+at)\s+the\s+intersection\s+of\b/gi, fix: "Cut '{match}'; say plainly what the work combines." },
  { id: "aligns-with", code: "AI_CLICHE_PHRASE", pattern: /\baligns?\s+(?:perfectly|closely|seamlessly|well|strongly|directly|beautifully|deeply)\s+with\b|\baligned\s+(?:perfectly|seamlessly|beautifully|deeply)\s+with\b|\b(?:aligns?|aligned)\s+with\s+(?:my|your)\s+(?:own\s+)?(?:values|passions?|goals|experience|background|skills|skill\s*set|career|interests|mission|vision|expertise|aspirations|strengths|professional|personal|beliefs)\b|\b(?:perfectly|seamlessly)\s+align(?:s|ed)?\b/gi, fix: "Replace '{match}' with the specific overlap: name one requirement and the matching work." },
  { id: "resonates", code: "AI_CLICHE_PHRASE", pattern: /\bresonat(?:e|es|ed|ing)\s+(?:(?:deeply|strongly|so|really)\s+)?with\s+(?:me|my)\b|\b(?:deeply|truly|really|strongly|profoundly)\s+resonat(?:e|es|ed|ing)\b|\bstr(?:ikes|uck|ike)\s+a\s+chord\b/gi, fix: "Replace '{match}' with what, specifically, you connected with and why." },
  { id: "key-role", code: "AI_CLICHE_PHRASE", pattern: /\bplay(?:ed|s|ing)?\s+(?:a|an)\s+(?:key|pivotal|crucial|vital|instrumental|critical|central|integral|significant|major|important)\s+role\b|\binstrumental\s+in\b/gi, fix: "Replace '{match}' with your exact action." },
  { id: "had-the-opportunity", code: "AI_CLICHE_PHRASE", pattern: /\b(?:had|have\s+had)\s+the\s+(?:privilege|opportunity|pleasure|honou?r)\s+(?:to|of)\b/gi, fix: "Cut '{match}' and start with the verb for what you did." },
  { id: "stock-close", code: "AI_CLICHE_PHRASE", pattern: /\bhow\s+my\s+(?:skills|experience|background|expertise|qualifications)(?:\s+and\s+[\w-]+)?\s+(?:can|could|would|will|might)\s+(?:contribute|benefit|add\s+value|help|align|make)\b/gi, fix: "Replace the stock close '{match}' with one concrete next step or a plain thank-you." },

  // Scene-setting and impact language.
  { id: "todays-world", code: "AI_CLICHE_PHRASE", pattern: /\bin\s+today['’]s\s+(?:[\w-]+\s+){0,2}(?:world|landscape|market|marketplace|economy|environment|age|era|climate|society)\b|\bin\s+(?:an?\s+)?(?:increasingly|ever)[- ][\w-]+\s+world\b|\bin\s+a\s+world\s+where\b/gi, fix: "Delete the scene-setting '{match}'; start with the specific point." },
  { id: "ever-evolving", code: "AI_CLICHE_PHRASE", pattern: /\b(?:ever|constantly|continually|continuously|rapidly|always)[- ](?:evolving|changing|shifting)\b/gi, fix: "Cut '{match}'; say what specifically changed and when." },
  { id: "landscape", code: "AI_CLICHE_PHRASE", pattern: /\b(?:digital|evolving|changing|shifting|competitive|business|tech|technology|AI|current|modern|complex|dynamic|startup|funding|hiring|job|talent)\s+landscape\b/gi, fix: "Replace '{match}' with the specific market, customers, or change you mean." },
  { id: "fast-paced", code: "AI_CLICHE_PHRASE", pattern: /\bfast[- ]paced\b/gi, fix: "Replace '{match}' with a concrete detail about pace, e.g. release frequency, volume, or deadlines." },
  { id: "dynamic-praise", code: "AI_CLICHE_PHRASE", pattern: /\bdynamic\s+(?:and\s+[\w-]+\s+)?(?:team|teams|environment|environments|workplace|company|organi[sz]ation|culture|leader|leaders|professional|individual|self-starter|role|industry|world|market|setting|startup|people|group|personality|person|thinker|force|presence|career)\b|\bI(?:\s+am|['’]m)\s+(?:a\s+)?(?:highly\s+|very\s+)?dynamic\b|\b(?:exciting|innovative|collaborative)\s+and\s+dynamic\b/gi, fix: "Replace '{match}' with the specific trait or situation you mean." },
  { id: "navigate", code: "AI_CLICHE_PHRASE", pattern: /\bnavigat(?:e|ed|es|ing)\s+(?:the\s+)?(?:complex(?:ities|ity)|intricacies|nuances|challenges|ambiguit(?:y|ies)|uncertaint(?:y|ies)|landscape|waters|terrain|maze)\b/gi, fix: "Replace '{match}' with the specific problem you worked through." },
  { id: "meaningful-impact", code: "AI_CLICHE_PHRASE", pattern: /\bmak(?:e|es|ing)\s+(?:a|an)\s+(?:(?:real|meaningful|lasting|significant|positive|tangible|immediate|genuine|measurable|big|huge|major|profound)\s+)?(?:impact|difference)\b|\bmeaningful\s+(?:impact|contributions?|difference|change|work)\b/gi, fix: "Replace '{match}' with the specific outcome you expect to affect." },
  { id: "drive-results", code: "AI_CLICHE_PHRASE", pattern: /\b(?:driv(?:e|es|en|ing)|drove)\s+(?:(?:impactful|meaningful|tangible|real|significant|measurable|positive|lasting|transformative|exceptional|outstanding|strong|business|bottom-line)\s+)?(?:results|impact|innovation|excellence|value|success|outcomes|change|transformation)\b/gi, fix: "Replace '{match}' with the number or outcome that moved." },
  { id: "unlock", code: "AI_CLICHE_PHRASE", pattern: /\bunlock(?:s|ed|ing)?\s+(?:(?:the|new|your|our|their|its|hidden|full|untapped|real|true)\s+)?(?:potential|value|growth|insights?|power|opportunit(?:y|ies)|possibilit(?:y|ies)|efficienc(?:y|ies)|synergies|innovation|success|creativity|talent|capabilities|impact|levels?|heights?|revenue)\b/gi, fix: "Replace '{match}' with the specific result it produced." },
  { id: "cultivate", code: "AI_CLICHE_PHRASE", pattern: /\bcultivat(?:e|es|ed|ing)\s+(?:(?:a|an|the|strong|deep|lasting|long-term|meaningful|trusted|trusting|healthy|positive|inclusive|collaborative)\s+){0,2}(?:relationships?|culture|environment|talent|partnerships?|mindset|trust|community|communities|loyalty|engagement|connections?|network|sense)\b/gi, fix: "Replace '{match}' with the concrete actions you took." },
  { id: "facilitate-abstract", code: "AI_CLICHE_PHRASE", pattern: /\bfacilitat(?:e|es|ed|ing)\s+(?:(?:the|a|an|cross-functional|seamless|effective|open|better)\s+)?(?:growth|success|collaboration|communication|innovation|change|alignment|synerg(?:y|ies)|transformation|learning|dialogue)\b/gi, fix: "Replace '{match}' with what you actually did, e.g. 'ran', 'scheduled', or 'moderated'." },
  { id: "robust-praise", code: "AI_CLICHE_PHRASE", pattern: /\brobust\s+(?:(?:and|,)\s*[\w-]+\s+)?(?:solutions?|platforms?|systems?|frameworks?|experience|background|skill\s*sets?|skills|understanding|knowledge|portfolio|track\s+record|foundation|expertise|strateg(?:y|ies)|process(?:es)?|infrastructure|tooling|offerings?|products?|capabilit(?:y|ies)|network|relationships|set\s+of|communication|approach|methodology|features?|architecture|pipelines?)\b|\brobust,?\s+(?:and\s+)?(?:scalable|reliable|secure|efficient|seamless|flexible)\b|\b(?:scalable|reliable|secure|efficient|flexible),?\s+(?:and\s+)?robust\b/gi, fix: "Replace '{match}' with the property you can show, e.g. uptime, test coverage, or failure handling." },
  { id: "state-of-the-art", code: "AI_CLICHE_PHRASE", pattern: /\bstate[- ]of[- ]the[- ]art\b/gi, fix: "Replace '{match}' with the specific technology, version, or benchmark result.", skip: (text, _start, end) => /^(?:[\s-]+[A-Za-z-]+)?\s+(?:results?|accuracy|performance|scores?|benchmarks?|f1|bleu|precision|recall)\s+(?:on|in|for)\b/i.test(text.slice(end, end + 60)) },
  { id: "cutting-edge", code: "AI_CLICHE_PHRASE", pattern: /\b(?:cutting|leading|bleeding)[- ]edge\b/gi, fix: "Replace '{match}' with the specific technology or method by name." },
  { id: "world-class", code: "AI_CLICHE_PHRASE", pattern: /\b(?:best[- ]in[- ]class|world[- ]class|top[- ]notch|second[- ]to[- ]none|industry[- ]leading|unparalleled|unmatched)\b/gi, fix: "Replace '{match}' with a comparison you can prove, e.g. a rank, benchmark, or named peer." },
  { id: "innovative-solutions", code: "AI_CLICHE_PHRASE", pattern: /\binnovative\s+(?:solutions?|ideas|approaches|products|thinking|mindset|strateg(?:y|ies))\b/gi, fix: "Replace '{match}' with the named solution and what was new about it." },
  { id: "idiom", code: "AI_CLICHE_PHRASE", pattern: /\bhit(?:s|ting)?\s+the\s+ground\s+running\b|\bw(?:ear|ore|earing|ears)\s+many\s+hats\b|\bmov(?:e|ed|es|ing)\s+the\s+needle\b|\blow[- ]hanging\s+fruit\b|\babove\s+and\s+beyond\b|\bpush(?:ed|es|ing)?\s+the\s+envelope\b|\braise[sd]?\s+the\s+bar\b|\bparadigm\s+shifts?\b|\bthought\s+leader(?:s|ship)?\b|\bnext[- ]level\b|\bsupercharg(?:e|ed|es|ing)\b|\bthink(?:ing)?\s+outside\s+(?:of\s+)?the\s+box\b|\bout[- ]of[- ]the[- ]box\s+think(?:ing|er)\b/gi, fix: "Replace the idiom '{match}' with the plain fact it stands for." },
  { id: "game-changer", code: "AI_CLICHE_PHRASE", pattern: /\bgame[- ]?chang(?:er|ers|ing)\b/gi, fix: "Replace '{match}' with the measurable change it caused." },
  { id: "testament", code: "AI_CLICHE_PHRASE", pattern: /\b(?:(?:is|was|stands\s+as|serves\s+as)\s+)?(?:a\s+)?testament\s+to\b/gi, fix: "Replace '{match}' with a direct statement of cause and result." },
  { id: "look-no-further", code: "AI_CLICHE_PHRASE", pattern: /\blook\s+no\s+further\b/gi, fix: "Delete '{match}'; it is a sales line, not evidence." },
  { id: "meta-filler", code: "AI_CLICHE_PHRASE", pattern: /\bit\s+is\s+(?:worth\s+(?:noting|mentioning)|important\s+to\s+(?:note|mention|highlight))\b|\bit['’]s\s+worth\s+(?:noting|mentioning)\b|\bneedless\s+to\s+say\b|\bit\s+goes\s+without\s+saying\b/gi, fix: "Delete '{match}' and state the point." },
  { id: "realm", code: "AI_CLICHE_PHRASE", pattern: /\bin\s+the\s+realm\s+of\b|\brealm\s+of\s+possibilit(?:y|ies)\b/gi, fix: "Replace '{match}' with 'in' or name the field." },
  { id: "thrive", code: "AI_CLICHE_PHRASE", pattern: /\bI\s+thrive\s+(?:in|on|when|under)\b/gi, fix: "Replace '{match}' with an example of doing that work." },
  { id: "excellence", code: "AI_CLICHE_PHRASE", pattern: /\bcommitment\s+to\s+(?:excellence|quality|innovation|success)\b|\bpursuit\s+of\s+excellence\b|\bdriven\s+by\s+(?:a\s+)?(?:passion|curiosity|desire)\b|\bfresh\s+perspectives?\b/gi, fix: "Replace '{match}' with a concrete example of the standard you held." },
  { id: "adept", code: "AI_CLICHE_PHRASE", pattern: /\badept\s+(?:at|in|with)\b/gi, fix: "Replace '{match}' with an example that shows the skill." },
  { id: "keen", code: "AI_CLICHE_PHRASE", pattern: /\bkeen\s+(?:interest|eye|sense|understanding|awareness|insight|ability|attention)\b/gi, fix: "Cut '{match}'; show the interest or skill with a specific example." },

  // Single-word stock vocabulary (context-guarded where the word has real uses).
  { id: "leverage", code: "AI_CLICHE_PHRASE", pattern: /\bleverag(?:e|ed|es|ing)\b/gi, fix: "Replace '{match}' with the plain verb for what you did, e.g. 'used', 'applied', or 'built on'.", skip: leverageIsLegit },
  { id: "synergy", code: "AI_CLICHE_PHRASE", pattern: /\bsynerg(?:y|ies|istic|istically|i[sz]e|i[sz]ed|i[sz]es|i[sz]ing)\b/gi, fix: "Replace '{match}' with what the groups actually did together and the result.", skip: synergyIsLegit },
  { id: "spearhead", code: "AI_CLICHE_PHRASE", pattern: /\bspearhead(?:ed|ing|s)?\b/gi, fix: "Replace '{match}' with the specific action, e.g. 'started', 'led', or 'proposed'." },
  { id: "utilize", code: "AI_CLICHE_PHRASE", pattern: /\butili[sz](?:e|ed|es|ing)\b/gi, fix: "Replace '{match}' with 'use' in the matching tense." },
  { id: "delve", code: "AI_CLICHE_PHRASE", pattern: /\bdelv(?:e|ed|es|ing)\b/gi, fix: "Replace '{match}' with a plain verb such as 'study', 'examine', or 'dig into'." },
  { id: "tapestry", code: "AI_CLICHE_PHRASE", pattern: /\btapestr(?:y|ies)\b/gi, fix: "Cut the '{match}' metaphor; name the actual parts or people involved." },
  { id: "honed", code: "AI_CLICHE_PHRASE", pattern: /\bhon(?:ed|ing)\b|\bhone\s+(?:my|his|her|their|our|your)\b/gi, fix: "Replace '{match}' with how the skill was built, e.g. 'practiced', 'built', or 'learned by doing'.", skip: nextIn(HONE_NEXT) },
  { id: "seamless", code: "AI_CLICHE_PHRASE", pattern: /\bseamless(?:ly)?\b/gi, fix: "Replace '{match}' with what actually happened, e.g. 'without downtime' or 'with no manual steps'.", skip: nextIn(SEAMLESS_NEXT) },
  { id: "embark", code: "AI_CLICHE_PHRASE", pattern: /\bembark(?:s|ed|ing)?\b/gi, fix: "Replace '{match}' with a plain verb such as 'start' or 'begin'." },
  { id: "journey", code: "AI_CLICHE_PHRASE", pattern: /\bjourneys?\b/gi, fix: "Replace the '{match}' metaphor with the actual timeline or roles.", skip: journeyIsLegit },
  { id: "elevate", code: "AI_CLICHE_PHRASE", pattern: /\belevat(?:e|es|ed|ing)\b/gi, fix: "Replace '{match}' with the concrete improvement, e.g. 'raised', 'improved', or the metric.", skip: nextIn(ELEVATE_NEXT) },
  { id: "empower", code: "AI_CLICHE_PHRASE", pattern: /\bempower(?:s|ed|ing|ment)?\b/gi, fix: "Replace '{match}' with what people could do afterward that they could not do before." },
  { id: "transformative", code: "AI_CLICHE_PHRASE", pattern: /\btransformati(?:ve|onal)\b/gi, fix: "Replace '{match}' with the before-and-after change." },
  { id: "revolutionize", code: "AI_CLICHE_PHRASE", pattern: /\brevolution(?:i[sz](?:e|es|ed|ing)|ary)\b/gi, fix: "Replace '{match}' with the specific change and who it affected.", skip: nextIn(REVOLUTION_NEXT) },
  { id: "harness", code: "AI_CLICHE_PHRASE", pattern: /\bharness(?:es|ed|ing)?\b/gi, fix: "Replace '{match}' with 'use' or the specific method.", skip: harnessIsLegit },
  { id: "foster", code: "AI_CLICHE_PHRASE", pattern: /\bfoster(?:s|ed|ing)?\b/gi, fix: "Replace '{match}' with the specific practice you set up and what changed.", skip: nextIn(FOSTER_NEXT) },
  { id: "impactful", code: "AI_CLICHE_PHRASE", pattern: /\bimpactful\b/gi, fix: "Replace '{match}' with the measured effect." },
  { id: "ai-vocabulary", code: "AI_CLICHE_PHRASE", pattern: /\b(?:multifaceted|holistic(?:ally)?|meticulous(?:ly)?|intricate|pivotal|paramount|invaluable|indispensable|unwavering|commendable|noteworthy|bustling)\b/gi, fix: "Replace '{match}' with a plain word or a specific fact.", skip: nextIn(HOLISTIC_NEXT) },

  // Warnings.
  { id: "facilitate", code: "WEAK_VERB", pattern: /\bfacilitat(?:e|es|ed|ing)\b/gi, fix: "Consider naming what you did instead of '{match}', e.g. 'ran', 'led', or 'moderated'." },
  { id: "hedge", code: "HEDGE_FILLER", pattern: /\b(?:various|numerous|myriad|countless|a\s+(?:wide|broad|diverse)\s+(?:range|array|variety|spectrum)\s+of|a\s+variety\s+of|a\s+(?:plethora|multitude|host)\s+of|plethora\s+of)\b/gi, fix: "Replace '{match}' with the actual number or the named items." },
];

// ---------------------------------------------------------------------------
// Blocking rules: placeholders, leaks, markdown, broken text
// ---------------------------------------------------------------------------

type BlockingRule = Readonly<{
  code: WritingLintCode;
  pattern: RegExp;
  message: string;
  fix: string;
  surfaces?: ReadonlySet<WritingSurface>;
  skip?: SkipGuard;
  /** Excerpt a window around the match instead of the bare match. */
  contextual?: boolean;
  /** allowTerms may suppress this rule (never true for placeholders or leaks). */
  maskable?: boolean;
}>;

const PLACEHOLDER_MESSAGE = "Unresolved placeholder text would reach the employer.";
const PLACEHOLDER_FIX = "Replace the placeholder '{match}' with the real value from the job or candidate record, or delete the sentence.";
const PROSE_SURFACES: ReadonlySet<WritingSurface> = new Set(["COVER_LETTER", "RESUME_SUMMARY", "RESUME_BULLET"]);

const doubledWordIsLegit: SkipGuard = (text, start, end) => {
  const match = text.slice(start, end);
  const first = match.match(/^\p{L}+/u)?.[0] ?? "";
  const second = match.match(/\p{L}+$/u)?.[0] ?? "";
  return DOUBLED_WORD_ALLOWED.has(lower(first)) || /^\p{Lu}/u.test(second);
};

const PLACEHOLDER_KEYWORD = /\b(?:company|employer|organi[sz]ation|position|role|job|title|name|manager|recipient|date|address|insert|placeholder|tbd|todo|fill|add|specific|relevant|x{1,3}|number|metric|percent(?:age)?|skill|industry|field|team|product|project|city|state|phone|email|link|url|years?|amount|goal|achievement|accomplishment|result|here)\b/i;

/** "[Company]" is a placeholder; "[sic]" and markdown link text "[label](url)" are not. */
const bracketIsNotPlaceholder: SkipGuard = (text, start, end) => (
  text[end] === "(" || !PLACEHOLDER_KEYWORD.test(text.slice(start + 1, end - 1))
);

const BLOCKING_RULES: readonly BlockingRule[] = [
  { code: "PLACEHOLDER_TEXT", pattern: /\[[^[\]\n]{1,60}\]/gu, message: PLACEHOLDER_MESSAGE, fix: PLACEHOLDER_FIX, skip: bracketIsNotPlaceholder },
  { code: "PLACEHOLDER_TEXT", pattern: /\{\{[^{}\n]{0,60}\}\}|\{\{|\}\}|\$\{[^}\n]{0,60}\}|\{\s*[A-Za-z_][\w.]*\s*\}/gu, message: PLACEHOLDER_MESSAGE, fix: PLACEHOLDER_FIX },
  { code: "PLACEHOLDER_TEXT", pattern: /<\s*(?:insert|add\s|your\s|company|employer|hiring|name|role|position)[^>\n]{0,60}>?/gi, message: PLACEHOLDER_MESSAGE, fix: PLACEHOLDER_FIX },
  { code: "PLACEHOLDER_TEXT", pattern: /<[A-Z][A-Z _]{2,40}>/gu, message: PLACEHOLDER_MESSAGE, fix: PLACEHOLDER_FIX },
  { code: "PLACEHOLDER_TEXT", pattern: /\b(?:TBD|tbd|Tbd|TODO|FIXME)\b|\bX{3,}\b|\[object\s+Object\]|\$\s?X{1,3}\b|\bX{1,3}\s?%|\b[NX]\+?\s+years\b/gu, message: PLACEHOLDER_MESSAGE, fix: PLACEHOLDER_FIX },
  { code: "PLACEHOLDER_TEXT", pattern: /\blorem\s+ipsum\b/gi, message: PLACEHOLDER_MESSAGE, fix: PLACEHOLDER_FIX },
  { code: "PLACEHOLDER_TEXT", pattern: /\b(?:Hiring\s+Manager(?:['’]s)?\s+Name|Your\s+Name|Company\s+Name|Recipient(?:['’]s)?\s+Name|Job\s+Title|Position\s+Title|Employer\s+Name)\b/gu, message: PLACEHOLDER_MESSAGE, fix: PLACEHOLDER_FIX },
  { code: "MODEL_LEAK", pattern: /\bas\s+an\s+AI(?:\s+(?:language\s+)?model|\s+assistant|\s*,\s*I\b)|\bas\s+a\s+(?:large\s+)?language\s+model\b|\bI\s+(?:cannot|can['’]t|am\s+unable\s+to|am\s+not\s+able\s+to)\s+(?:assist|help\s+with\s+(?:that|this)|fulfill|comply|browse|access\s+(?:the\s+internet|real-time|external)|provide\s+(?:personal\s+opinions|real-time)|generate\s+(?:that|this))\b|\bmy\s+(?:knowledge\s+cutoff|training\s+data)\b|\bas\s+of\s+my\s+last\s+(?:update|training)\b|\bI\s+hope\s+this\s+helps\b|\blet\s+me\s+know\s+if\s+you(?:['’]d|\s+would)\s+like\b|\bfeel\s+free\s+to\s+(?:adjust|modify|tweak|customi[sz]e|edit)\b|\bhere(?:['’]s|\s+is)\s+(?:a|an|the|your)\s+(?:(?:revised|rewritten|updated|polished|tailored|improved|shorter|longer)\s+(?:version|cover\s+letter|letter|answer|response|draft)|cover\s+letter|answer\s+to\s+(?:the|your)|response\s+to\s+(?:the|your))\b/gi, message: "Text from the drafting model's conversation leaked into the application.", fix: "Delete the model's meta text '{match}' and keep only the application content." },
  { code: "INTERNAL_METADATA_LEAK", pattern: /\b(?:evidenceVersionId|evidenceId|claimIds?|researchClaimId|inputSnapshotId|snapshotHash|documentVersionId|textReviewId|applicationId|candidateId|workspaceId|jobVersionId|claimSha256|sourceSha256)\b|【[^】\n]{0,40}】/gu, message: "Internal workflow identifiers leaked into candidate-facing text.", fix: "Delete the internal identifier '{match}'; application text never cites evidence or claim IDs." },
  { code: "INTERNAL_METADATA_LEAK", pattern: /\[\s*(?:claim|evidence|source|cite|citation|ref)(?:[\s:#_-]+[\w-]*)?\s*\]|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, message: "Internal workflow identifiers leaked into candidate-facing text.", fix: "Delete the internal identifier '{match}'; application text never cites evidence or claim IDs." },
  { code: "MARKDOWN_ARTIFACT", pattern: /\*\*[^*\n]{1,200}\*\*|__[^_\n]{1,200}__|```|(?<![\w*])\*(?!\s)[^*\n]{1,60}(?<!\s)\*(?![\w*])/gu, message: "Markdown formatting would show up as literal symbols.", fix: "Remove the markdown symbols in '{match}' and keep plain text." },
  { code: "MARKDOWN_ARTIFACT", pattern: /^[ \t]*#{1,6}[ \t]+\S[^\n]{0,60}/gmu, message: "A markdown heading marker would show up as a literal '#'.", fix: "Remove the heading marker in '{match}'; write the line as plain text or delete it." },
  { code: "MARKDOWN_ARTIFACT", pattern: /\[[^[\]\n]{1,200}\]\((?:https?:|www\.|mailto:)[^)\s]{0,400}\)/gi, message: "A markdown link would show up as literal brackets.", fix: "Replace the markdown link '{match}' with plain text." },
  { code: "MARKDOWN_ARTIFACT", pattern: /^[ \t]*(?:[-*•▪◦●‣∙]|\d{1,2}[.)])[ \t]+\S[^\n]{0,40}/gmu, surfaces: PROSE_SURFACES, message: "A list marker is embedded in text that the renderer formats itself.", fix: "Remove the list marker in '{match}'; letters use connected prose and the résumé renderer adds its own bullets." },
  { code: "BROKEN_TEXT", pattern: /\uFFFD|\u00E2\u20AC[\u2122\u0153\u009D\u201C\u201D\u02DC\u00A6\u00A2]|\u00C3[\u0080-\u00BF]|\u00C2[\u00A0-\u00BF]/gu, message: "The text contains mis-encoded characters.", fix: "Retype the garbled characters near '{match}'; the text was mis-encoded.", contextual: true },
  { code: "BROKEN_TEXT", pattern: /\b([a-z]{2,})\s+\1\b/gi, message: "A word is repeated back to back.", fix: "Delete the repeated word in '{match}'.", skip: doubledWordIsLegit, maskable: true },
  { code: "BROKEN_TEXT", pattern: /(?<!\.)\.\.(?!\.)|,,|;;|(?<=\p{L})[ \t]+\.(?=\s|$)/gu, message: "The text has doubled or detached punctuation.", fix: "Fix the punctuation near '{match}'.", contextual: true },
];

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|\u20E3/gu;
const EMOJI_ALLOWED = new Set(["©", "®", "™"]);
const HASHTAG_PATTERN = /(?<![\p{L}\p{N}&#/])#\p{L}[\p{L}\p{N}_]*/gu;

// ---------------------------------------------------------------------------
// Openings, answers, transitions, quotes
// ---------------------------------------------------------------------------

const SALUTATION_PREFIX = /^\s*(?:(?:dear|hi|hello|hey|greetings)\b[^,\n:]{0,60}[,:]|to\s+whom\s+it\s+may\s+concern\s*[,:]?)/i;
const DATED_SALUTATION = /\bto\s+whom\s+it\s+may\s+concern\b|\bdear\s+sir\s*(?:or|\/)\s*madam\b|\bdear\s+sirs?\b/i;
const SIGN_OFF_LINE = /^[ \t]*(?:sincerely|best(?:\s+regards|\s+wishes)?|regards|kind\s+regards|warm(?:est)?\s+regards|warmly|respectfully(?:\s+yours)?|yours\s+(?:truly|sincerely|faithfully)|cheers|all\s+the\s+best|with\s+gratitude|gratefully|thank\s+you(?:\s+(?:again|for\s+your\s+(?:time|consideration)(?:\s+and\s+consideration)?))?|thanks(?:\s+again)?)[ \t]*[,.!]?[ \t]*$/im;

const OPENING_FIX = "Open with a specific fact about your work or this team instead of announcing the application.";
const OPENING_RULES: readonly Readonly<{ pattern: RegExp; severity: WritingLintSeverity }>[] = [
  { pattern: /^(I(?:\s+am|['’]m)\s+writing\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^(I(?:\s+am|['’]m|\s+was)\s+(?:so\s+|very\s+|truly\s+|really\s+|incredibly\s+|extremely\s+)?(?:excited|thrilled|delighted|pleased|happy|eager|honou?red|elated)\s+to\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^((?:please\s+accept|allow\s+me\s+to\s+introduce|let\s+me\s+introduce)\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^(my\s+name\s+is\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^(as\s+an?\s+[^,.!?]{0,60}?\bwith\s+(?:over\s+|more\s+than\s+|nearly\s+|almost\s+|close\s+to\s+)?[\w-]+\+?\s+years?\b)[^.!?]{0,40}/i, severity: "REPAIR" },
  { pattern: /^(with\s+(?:over\s+|more\s+than\s+|nearly\s+|almost\s+|close\s+to\s+)?[\w-]+\+?\s+years?\s+of\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^(I\s+(?:would\s+like|wish|want|wanted)\s+to\s+(?:express|apply|submit|take\s+this\s+opportunity|reach\s+out|formally)\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^(I(?:\s+am|['’]m)\s+(?:reaching\s+out|applying\s+(?:for|to)|interested\s+in\s+(?:the|your|applying))\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^(it\s+is\s+with\s+(?:great\s+)?(?:enthusiasm|excitement|interest|pleasure)\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^(thank\s+you\s+for\s+(?:the\s+opportunity|considering|taking\s+the\s+time)\b)[^.!?]{0,60}/i, severity: "REPAIR" },
  { pattern: /^((?:when\s+I\s+(?:first\s+)?(?:saw|came\s+across|read|found|discovered|learned\s+about|noticed)|I\s+(?:recently\s+)?(?:came\s+across|saw|noticed|found)\s+(?:your|the)\s+(?:posting|listing|job|opening|advertisement|ad|role|position))\b)[^.!?]{0,60}/i, severity: "WARNING" },
];

const ANSWER_PREAMBLE = /^\s*((?:(?:that['’]s|that\s+is|what)\s+an?\s+)?(?:great|good|excellent|fantastic|wonderful|interesting)\s+question|certainly|(?:thank\s+you|thanks)\s+for\s+(?:asking|the\s+question)|here(?:['’]s|\s+is)\s+(?:my|the)\s+(?:answer|response))\b[^.!?\n]{0,40}[.!?:]?/i;
const TRANSITION_OPENER = /^\s*(furthermore|moreover|additionally|in\s+addition|what['’]s\s+more|on\s+top\s+of\s+that)\b/i;

const SPEECH_BEFORE = /\b(?:said|told\s+(?:me|us|the\s+team|him|her|them)|remarked|exclaimed|replied|whispered|asked\s+(?:me|us)|put\s+it|wrote\s+to\s+me)\s*[,:]?\s*$/i;
const DOCUMENT_SAID = /\b(?:posting|description|listing|ad|advert|job|role|page|website|site|report|article|document|spec|brief)\s+(?:also\s+)?said\s*[,:]?\s*$/i;
const SPEECH_AFTER = /^\s*[,.]?\s*(?:[A-Za-z'’]+\s+){0,3}(?:said|told\s+(?:me|us)|remarked|exclaimed|replied|whispered|added)\b/i;

// ---------------------------------------------------------------------------
// Style lexicons (RoleDawn-authored)
// ---------------------------------------------------------------------------

const DASH_PATTERN = /—|(?<=\S)(?<!\d)[ \t]+(?:--?|–)[ \t]+(?=\S)(?!\d)/gu;
const INTENSIFIER_PATTERN = /\b(?:truly|genuinely|deeply|incredibly|extremely|highly|exceptionally|immensely|tremendously|remarkably|profoundly)\b(?!\s+(?:available|concurrent|regulated|cited|parallel|sensitive|confidential|variable|correlated|nested|linked|skewed|compressed|compressible))/gi;
const TRIPLET_PATTERN = /\b([a-z][a-z-]*),\s+([a-z][a-z-]*)(?:,?\s+(?:and|or)\s+|,\s+)([a-z][a-z-]*)\b/gi;
const STACK_SUFFIX = /(?:ive|ic|al|ous|ful|able|ible|ent|ant|ness|ity|ship|ism|ence|ance|tion|sion|ment)$/u;
const STACK_WORDS = new Set([
  "innovative", "strategic", "collaborative", "creative", "passionate", "driven", "dedicated", "motivated",
  "analytical", "adaptable", "empathetic", "curious", "resilient", "efficient", "effective", "impactful",
  "meaningful", "transparent", "inclusive", "dynamic", "agile", "versatile", "proactive", "resourceful",
  "thoughtful", "rigorous", "holistic", "authentic", "visionary", "reliable", "scalable", "robust", "seamless",
  "intuitive", "flexible", "organized", "diligent", "meticulous", "compassionate", "ambitious", "energetic",
  "enthusiastic", "disciplined", "insightful", "inspiring", "decisive", "entrepreneurial", "pragmatic",
  "purposeful", "responsive", "sustainable", "trusted", "trustworthy", "genuine", "intentional", "cohesive",
  "engaging", "compelling", "exceptional", "outstanding", "forward-thinking", "results-driven",
  "detail-oriented", "customer-centric", "data-driven", "user-centric", "human-centered", "mission-driven",
  "high-impact", "high-performing", "world-class", "cutting-edge", "hardworking", "hard-working",
  "collaboration", "innovation", "creativity", "passion", "leadership", "curiosity", "ownership",
  "accountability", "resilience", "growth", "impact", "vision", "purpose", "trust", "transparency",
  "craftsmanship", "efficiency", "scalability", "reliability", "excellence", "integrity", "clarity", "empathy",
  "rigor", "humility", "grit", "dedication", "commitment", "empowerment", "agility", "alignment", "synergy",
  "teamwork", "adaptability", "inclusion", "strategy", "communication", "authenticity", "flexibility",
]);

const WEAK_BULLET_OPENER = /^((?:(?:was|were|am|is|are)\s+)?(?:responsible\s+for|in\s+charge\s+of|duties\s+(?:included|include)|tasked\s+with|helped(?:\s+to)?|helping|helps?(?:\s+to)?|assisted(?:\s+(?:with|in))?|assisting(?:\s+(?:with|in))?|assists?\s+(?:with|in)|worked\s+on|works?\s+on|working\s+on|involved\s+in|participated\s+in|participates?\s+in|participating\s+in))\b/i;
const LEADING_LIST_MARKER = /^[ \t]*(?:[-*•▪◦●‣∙]|\d{1,2}[.)])[ \t]+/u;
/** Pronouns as words, not inside identifiers such as "us-east-1", "I/O", or "my-service". */
const FIRST_PERSON_PATTERN = /(?<![\p{L}\p{N}'’_./@-])(?:I(?:['’](?:m|ve|d|ll))?|[Mm]e|[Mm]y|[Mm]yself|[Ww]e|[Oo]ur|[Oo]urs|[Oo]urselves|us)(?![\p{L}\p{N}]|[-_./][\p{L}\p{N}])/gu;
const ROMAN_NUMERAL_CONTEXT = /\b(?:phase|type|tier|level|class|grade|stage|title|part|series|section|chapter|volume|division|category|schedule|war|gen|generation|model|mark|mk|block|unit|round|step|appendix|article|book|act)\s*$/i;

const ACTION_VERBS = new Set([
  "accelerate", "achieve", "acquire", "adapt", "add", "address", "administer", "advise", "advocate", "align",
  "analyze", "analyse", "answer", "apply", "architect", "arrange", "assemble", "assess", "audit", "author",
  "automate", "bake", "balance", "bring", "build", "calculate", "care", "chair", "champion", "clean", "close",
  "coach", "code", "collaborate", "collect", "compile", "complete", "compose", "compute", "conduct",
  "configure", "consolidate", "construct", "consult", "convert", "cook", "coordinate", "count", "create",
  "cut", "debug", "decrease", "define", "deliver", "deploy", "design", "detect", "develop", "devise",
  "diagnose", "direct", "discover", "document", "double", "draft", "draw", "drill", "drive", "edit",
  "eliminate", "enable", "engineer", "establish", "evaluate", "execute", "expand", "expedite", "extend",
  "facilitate", "file", "find", "fix", "forecast", "form", "found", "generate", "give", "greet", "grow",
  "guide", "halve", "handle", "help", "hire", "hold", "identify", "implement", "improve", "increase",
  "initiate", "inspect", "install", "instrument", "integrate", "interview", "introduce", "investigate",
  "keep", "launch", "lead", "load", "lower", "maintain", "make", "manage", "map", "measure", "meet", "mentor",
  "merge", "migrate", "mix", "model", "moderate", "modernize", "monitor", "move", "negotiate", "onboard",
  "open", "operate", "optimize", "organize", "oversee", "own", "pack", "paint", "partner", "pay", "perform",
  "pilot", "plan", "prepare", "present", "prevent", "prioritize", "process", "produce", "program", "propose",
  "prototype", "publish", "put", "raise", "read", "rebuild", "recruit", "redesign", "reduce", "refactor",
  "remove", "repair", "replace", "report", "research", "resolve", "restructure", "review", "revise",
  "rewrite", "run", "save", "scale", "schedule", "secure", "sell", "send", "serve", "set", "ship",
  "simplify", "solve", "sort", "source", "speak", "specify", "speed", "spend", "standardize", "start",
  "steer", "stock", "streamline", "strengthen", "structure", "supervise", "supply", "support", "survey",
  "take", "teach", "test", "track", "train", "transform", "translate", "treat", "triage", "troubleshoot",
  "tune", "unify", "update", "upgrade", "validate", "verify", "weld", "win", "wire", "write",
]);
const IRREGULAR_PAST = new Set([
  "built", "led", "ran", "wrote", "made", "won", "grew", "cut", "drove", "took", "gave", "set", "sold",
  "bought", "brought", "taught", "found", "held", "kept", "met", "paid", "put", "sent", "spent", "split",
  "spun", "stood", "began", "chose", "drew", "fed", "fought", "flew", "got", "knew", "laid", "left", "lent",
  "lost", "meant", "overcame", "oversaw", "rebuilt", "rewrote", "rode", "rose", "saw", "sought", "shot",
  "shut", "slid", "spoke", "struck", "swept", "thought", "threw", "told", "understood", "undertook",
  "withdrew", "wound", "upheld", "outsold", "outgrew", "underwent", "broke", "became", "bound", "bred",
  "came", "cast", "caught", "dealt", "did", "dug", "fell", "felt", "fled", "foresaw", "forecast", "froze",
  "ground", "hung", "heard", "hit", "hid", "hurt", "let", "lit", "misled", "quit", "read", "rang", "reset",
  "sang", "sank", "sat", "shook", "shone", "shrank", "slept", "sped", "spread", "sprang", "strode", "strove",
  "swore", "swung", "tore", "woke", "wore", "wove", "broadcast", "offset", "outran", "outbid", "overran",
  "overtook", "underwrote", "redrew", "remade", "resold", "retook", "reran", "cowrote",
]);
const ED_NOT_PAST = new Set(["embed", "shed", "bed", "red", "wed", "sled", "shred", "hundred", "sacred", "naked", "wicked", "rugged", "ragged", "kindred"]);
const EED_PAST = new Set(["agreed", "freed", "guaranteed", "decreed", "refereed", "disagreed", "emceed"]);

type VerbClass = "PAST" | "PRESENT" | "GERUND" | "UNKNOWN";

function classifyVerb(word: string): VerbClass {
  const whole = lower(word);
  const core = whole.split("-").pop() ?? whole;
  for (const candidate of [whole, core]) {
    if (IRREGULAR_PAST.has(candidate)) return "PAST";
    if (
      candidate.length >= 4 &&
      candidate.endsWith("ed") &&
      !ED_NOT_PAST.has(candidate) &&
      (!candidate.endsWith("eed") || EED_PAST.has(candidate))
    ) return "PAST";
  }
  for (const candidate of [whole, core]) {
    if (ACTION_VERBS.has(candidate)) return "PRESENT";
    if (candidate.endsWith("ies") && ACTION_VERBS.has(`${candidate.slice(0, -3)}y`)) return "PRESENT";
    if (candidate.endsWith("es") && ACTION_VERBS.has(candidate.slice(0, -2))) return "PRESENT";
    if (candidate.endsWith("s") && ACTION_VERBS.has(candidate.slice(0, -1))) return "PRESENT";
  }
  return core.length > 5 && core.endsWith("ing") ? "GERUND" : "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Per-item checks
// ---------------------------------------------------------------------------

type BannedTerm = Readonly<{ phrase: string; pattern: RegExp }>;

type Shared = Readonly<{
  allowPatterns: readonly RegExp[];
  allowNormalized: readonly string[];
  banned: readonly BannedTerm[];
}>;

const PHRASE_MESSAGES: Readonly<Record<PhraseCode, (fragment: string) => string>> = {
  SELF_UNDERCUT: (fragment) => `"${fragment}" talks the candidate down; applications never volunteer what the candidate lacks.`,
  AI_CLICHE_PHRASE: (fragment) => `"${fragment}" is stock application phrasing that reads as generated.`,
  HEDGE_FILLER: (fragment) => `"${fragment}" is vague filler where a number or named examples would be stronger.`,
  WEAK_VERB: (fragment) => `"${fragment}" is a weak verb that hides what was actually done.`,
  WEASEL_ATTRIBUTION: (fragment) => `"${fragment}" makes a claim without naming a source.`,
  SUMMARY_CLOSER: (fragment) => `"${fragment}" is a summary or fake-profound closing move.`,
  BINARY_CONTRAST: (fragment) => `"${fragment}" uses the "not X but Y" framing common in generated prose.`,
  FAUX_INSIGHT_SETUP: (fragment) => `"${fragment}" sets up a reveal instead of stating the point.`,
};

function makeContext(
  surface: WritingSurface,
  index: number,
  text: string,
  current: boolean,
  role: ParagraphRole,
  shared: Shared,
  originalLength: number = text.length,
): ItemContext {
  return {
    item: { surface, index, text, current, role, originalLength },
    allowMasks: termSpans(text, shared.allowPatterns),
    quotes: quoteSpans(text),
    sentences: splitSentences(text),
    claimed: [],
    explainedQuestions: new Set<number>(),
    stockPhraseCount: 0,
  };
}

/** Per-item character cap: far above any real paragraph, bullet, or answer. */
const MAX_ITEM_CHARS = 20_000;
/** Per-rule match cap per item; duplicates collapse in the report anyway. */
const MAX_MATCHES_PER_RULE = 50;

function prepareText(raw: unknown): Readonly<{ text: string; originalLength: number }> {
  const cleaned = typeof raw === "string" ? cleanText(raw) : "";
  return {
    text: cleaned.length > MAX_ITEM_CHARS ? cleaned.slice(0, MAX_ITEM_CHARS) : cleaned,
    originalLength: cleaned.length,
  };
}

function emit(
  drafts: Draft[],
  ctx: ItemContext,
  code: WritingLintCode,
  severity: WritingLintSeverity,
  offset: number,
  excerpt: string,
  message: string,
  fix: string,
): void {
  drafts.push({
    code,
    severity,
    surface: ctx.item.surface,
    index: ctx.item.index,
    excerpt: clip(excerpt),
    message,
    fix,
    offset,
  });
}

/** Phrase fragments are lower-cased (keeping "I") so repeated phrases group together in the brief. */
function phraseFragment(match: string): string {
  return lower(clip(match, 60)).replace(/(?<![\p{L}\p{N}.])i(?=['’]|\s|$)/gu, "I");
}

function fillFix(template: string, fragment: string): string {
  return template.replace(/\{match\}/gu, () => fragment);
}

function sentenceAt(ctx: ItemContext, index: number): Sentence | undefined {
  let low = 0;
  let high = ctx.sentences.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const sentence = ctx.sentences[middle];
    if (index < sentence.start) high = middle - 1;
    else if (index >= sentence.end) low = middle + 1;
    else return sentence;
  }
  return undefined;
}

function looksLikeProperNoun(text: string, start: number, match: string): boolean {
  return !/\s/u.test(match) && /^\p{Lu}/u.test(match) && !isSentenceStart(text, start);
}

function runBlockingRules(ctx: ItemContext, drafts: Draft[]): void {
  const { text, surface } = ctx.item;
  const flaggedByCode = new Map<WritingLintCode, Span[]>();
  for (const rule of BLOCKING_RULES) {
    if (rule.surfaces && !rule.surfaces.has(surface)) continue;
    let matches = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (++matches > MAX_MATCHES_PER_RULE) break;
      const span = { start: match.index, end: match.index + match[0].length };
      if (rule.skip?.(text, span.start, span.end)) continue;
      if (rule.maskable && overlapsAny(span, ctx.allowMasks)) continue;
      const flagged = flaggedByCode.get(rule.code) ?? [];
      if (overlapsAny(span, flagged)) continue;
      flaggedByCode.set(rule.code, [...flagged, span]);
      const excerpt = rule.contextual ? contextExcerpt(text, span.start, span.end) : match[0];
      const fragment = rule.contextual ? clip(excerpt, 60) : clip(match[0], 60);
      emit(drafts, ctx, rule.code, WRITING_LINT_CODES[rule.code], span.start, excerpt, rule.message, fillFix(rule.fix, fragment));
    }
  }
}

function runEmojiCheck(ctx: ItemContext, drafts: Draft[]): void {
  const found: string[] = [];
  let offset = -1;
  const consider = (value: string, index: number) => {
    const span = { start: index, end: index + value.length };
    if (overlapsAny(span, ctx.allowMasks)) return;
    found.push(value);
    if (offset < 0 || index < offset) offset = index;
  };
  for (const match of ctx.item.text.matchAll(EMOJI_PATTERN)) {
    if (!EMOJI_ALLOWED.has(match[0])) consider(match[0], match.index);
  }
  for (const match of ctx.item.text.matchAll(HASHTAG_PATTERN)) consider(match[0], match.index);
  if (found.length === 0) return;
  emit(
    drafts,
    ctx,
    "EMOJI_OR_HASHTAG",
    "BLOCKING",
    offset,
    [...new Set(found)].join(" "),
    "Emoji and hashtags do not belong in application materials.",
    "Remove every emoji and hashtag; keep the plain words.",
  );
}

function runQuoteChecks(ctx: ItemContext, shared: Shared, drafts: Draft[]): void {
  const { text } = ctx.item;
  for (const quote of ctx.quotes) {
    const normalized = normalizePhrase(quote.inner);
    if (!normalized || shared.allowNormalized.some((term) => term.includes(normalized))) continue;
    const count = wordCount(quote.inner);
    const before = text.slice(Math.max(0, quote.start - 48), quote.start);
    const after = text.slice(quote.end, quote.end + 48);
    const dialogue = count >= 2 && (
      (SPEECH_BEFORE.test(before) && !DOCUMENT_SAID.test(before)) || SPEECH_AFTER.test(after)
    );
    if (count < 6 && !dialogue) continue;
    emit(
      drafts,
      ctx,
      "FABRICATED_QUOTE",
      "BLOCKING",
      quote.start,
      text.slice(quote.start, quote.end),
      dialogue
        ? "The text puts invented dialogue in someone's mouth."
        : "A quoted sentence cannot be traced to any supplied source.",
      "Remove the quotation marks and state the point in your own words; never invent quotes or dialogue.",
    );
  }
}

function runBannedPhrases(ctx: ItemContext, shared: Shared, drafts: Draft[]): void {
  for (const { phrase, pattern } of shared.banned) {
    let matches = 0;
    for (const match of ctx.item.text.matchAll(pattern)) {
      if (++matches > MAX_MATCHES_PER_RULE) break;
      const span = { start: match.index, end: match.index + match[0].length };
      if (overlapsAny(span, ctx.allowMasks) || overlapsAny(span, ctx.claimed)) continue;
      ctx.claimed.push(span);
      ctx.stockPhraseCount += 1;
      emit(
        drafts,
        ctx,
        "CANDIDATE_BANNED_PHRASE",
        "REPAIR",
        span.start,
        match[0],
        `"${clip(match[0], 60)}" is on the candidate's list of phrases to avoid.`,
        `Remove '${clip(phrase, 60)}' entirely; the candidate asked never to use it. Use a plain, specific alternative.`,
      );
    }
  }
}

function runOpeningCheck(ctx: ItemContext, sentence: Sentence, drafts: Draft[]): void {
  for (const rule of OPENING_RULES) {
    const match = sentence.text.match(rule.pattern);
    if (!match) continue;
    const core = match[1] ?? match[0];
    const span = { start: sentence.start, end: sentence.start + core.length };
    if (overlapsAny(span, ctx.allowMasks)) return;
    ctx.claimed.push(span);
    emit(
      drafts,
      ctx,
      "CEREMONIAL_OPENING",
      rule.severity,
      span.start,
      match[0],
      rule.severity === "WARNING"
        ? "The opening leans on a stock 'when I saw your posting' setup."
        : "The opening announces the application instead of leading with substance.",
      OPENING_FIX,
    );
    return;
  }
}

function runSalutationCheck(ctx: ItemContext, drafts: Draft[]): void {
  const match = ctx.item.text.slice(0, 160).match(DATED_SALUTATION);
  if (!match || match.index === undefined) return;
  emit(
    drafts,
    ctx,
    "CEREMONIAL_OPENING",
    "WARNING",
    match.index,
    match[0],
    "The salutation is a dated form-letter greeting.",
    "Address a named person or the team (for example 'Dear Payments hiring team') instead of a form-letter greeting.",
  );
}

function runAnswerPreamble(ctx: ItemContext, drafts: Draft[]): void {
  const match = ctx.item.text.match(ANSWER_PREAMBLE);
  if (!match || match.index === undefined) return;
  const core = match[1] ?? match[0];
  const start = match.index + match[0].indexOf(core);
  ctx.claimed.push({ start, end: start + core.length });
  emit(
    drafts,
    ctx,
    "ANSWER_PREAMBLE",
    "REPAIR",
    start,
    match[0].trim(),
    "The answer opens with chatbot-style preamble.",
    "Delete the preamble and open with the answer itself.",
  );
}

function runPhraseRules(ctx: ItemContext, drafts: Draft[]): void {
  const { text } = ctx.item;
  for (const rule of PHRASE_RULES) {
    let matches = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (++matches > MAX_MATCHES_PER_RULE) break;
      const span = { start: match.index, end: match.index + match[0].length };
      // Naming the employer inside a disclaimer ("…the work GitLab describes")
      // never excuses talking the candidate down.
      if (overlapsAny(span, ctx.claimed) || (rule.code !== "SELF_UNDERCUT" && overlapsAny(span, ctx.allowMasks))) continue;
      if (rule.skip?.(text, span.start, span.end)) continue;
      if (rule.code !== "SELF_UNDERCUT" && looksLikeProperNoun(text, span.start, match[0])) continue;
      ctx.claimed.push(span);
      const fragment = phraseFragment(match[0]);
      if (insideAny(span, ctx.quotes)) {
        if (rule.code === "AI_CLICHE_PHRASE") {
          emit(
            drafts,
            ctx,
            "MIRRORED_POSTING_CLICHE",
            "WARNING",
            span.start,
            match[0],
            `"${fragment}" is quoted, likely mirrored from the posting, but still reads as boilerplate.`,
            `Consider describing the requirement in your own words instead of quoting '${fragment}'.`,
          );
        }
        continue;
      }
      if (rule.code === "FAUX_INSIGHT_SETUP" && match[0].endsWith("?")) ctx.explainedQuestions.add(span.end - 1);
      if (rule.code === "AI_CLICHE_PHRASE") ctx.stockPhraseCount += 1;
      emit(
        drafts,
        ctx,
        rule.code,
        WRITING_LINT_CODES[rule.code],
        span.start,
        match[0],
        PHRASE_MESSAGES[rule.code](fragment),
        fillFix(rule.fix, fragment),
      );
    }
  }
}

function runTripletCheck(ctx: ItemContext, drafts: Draft[]): void {
  const { text } = ctx.item;
  const pattern = new RegExp(TRIPLET_PATTERN.source, TRIPLET_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const items = [match[1], match[2], match[3]].map(lower);
    const inLexicon = items.filter((word) => STACK_WORDS.has(word)).length;
    const stackable = items.every((word) => STACK_WORDS.has(word) || STACK_SUFFIX.test(word));
    const span = { start: match.index, end: match.index + match[0].length };
    if (inLexicon >= 2 && stackable && !overlapsAny(span, ctx.allowMasks) && !insideAny(span, ctx.quotes)) {
      const fragment = phraseFragment(match[0]);
      emit(
        drafts,
        ctx,
        "TRIPLET_STACK",
        "REPAIR",
        span.start,
        match[0],
        `"${fragment}" stacks abstract qualities instead of showing one.`,
        `Replace the stacked list '${fragment}' with the one quality that matters here and an example that proves it.`,
      );
      pattern.lastIndex = span.end;
    } else {
      pattern.lastIndex = match.index + match[1].length + 1;
    }
  }
}

function runExclamationCheck(ctx: ItemContext, drafts: Draft[]): void {
  const { text } = ctx.item;
  const flaggedSentences = new Set<number>();
  for (const match of text.matchAll(/!/gu)) {
    const span = { start: match.index, end: match.index + 1 };
    if (text[match.index + 1] === "=") continue;
    if (insideAny(span, ctx.quotes) || overlapsAny(span, ctx.allowMasks)) continue;
    const sentence = sentenceAt(ctx, match.index);
    const key = sentence?.start ?? match.index;
    if (flaggedSentences.has(key)) continue;
    flaggedSentences.add(key);
    emit(
      drafts,
      ctx,
      "EXCLAMATION",
      "REPAIR",
      match.index,
      sentence?.text ?? contextExcerpt(text, span.start, span.end),
      "Exclamation marks read as forced enthusiasm in application writing.",
      "Replace each exclamation mark with a period and let the fact carry the energy.",
    );
  }
}

function runDashPayoffCheck(ctx: ItemContext, drafts: Draft[]): void {
  for (const sentence of ctx.sentences) {
    const dashes = [...sentence.text.matchAll(DASH_PATTERN)];
    if (dashes.length !== 1) continue;
    const dash = dashes[0];
    const absolute = sentence.start + dash.index;
    if (insideAny({ start: absolute, end: absolute + dash[0].length }, ctx.quotes)) continue;
    if (!/[.!]["”’)]*$/u.test(sentence.text)) continue;
    const tailWords = wordCount(sentence.text.slice(dash.index + dash[0].length));
    if (tailWords < 1 || tailWords > 4 || wordCount(sentence.text.slice(0, dash.index)) < 4) continue;
    emit(
      drafts,
      ctx,
      "DRAMATIC_DASH_PAYOFF",
      "WARNING",
      absolute,
      sentence.text.slice(Math.max(0, dash.index - 40)),
      "A dash sets up a dramatic payoff at the end of the sentence.",
      "Fold the dash payoff into the sentence as a plain clause, or end the sentence before the dash.",
    );
  }
}

function runTransitionCheck(ctx: ItemContext, drafts: Draft[], segments: readonly Span[]): void {
  for (const segment of segments) {
    const match = ctx.item.text.slice(segment.start, segment.end).match(TRANSITION_OPENER);
    if (!match || match.index === undefined) continue;
    const word = match[1];
    emit(
      drafts,
      ctx,
      "TRANSITION_OPENER",
      "WARNING",
      segment.start + match.index + match[0].indexOf(word),
      word,
      `The paragraph opens with the connector "${word}".`,
      `Start the paragraph with its point instead of '${lower(word)}'.`,
    );
  }
}

/** Blocking, emoji, quote, and candidate-ban checks. Returns false for an empty item. */
function runCommonChecks(ctx: ItemContext, shared: Shared, drafts: Draft[]): boolean {
  runEmojiCheck(ctx, drafts);
  if (!/[\p{L}\p{N}]/u.test(ctx.item.text)) {
    emit(
      drafts,
      ctx,
      "BROKEN_TEXT",
      "BLOCKING",
      0,
      ctx.item.text.trim() || "(empty)",
      "This item is empty or contains no words.",
      "Write the missing text or remove the empty item.",
    );
    return false;
  }
  if (ctx.item.originalLength > ctx.item.text.length) {
    emit(
      drafts,
      ctx,
      "BROKEN_TEXT",
      "BLOCKING",
      MAX_ITEM_CHARS,
      `${ctx.item.originalLength} characters`,
      `This item is ${ctx.item.originalLength} characters long; only the first ${MAX_ITEM_CHARS} were checked.`,
      "Rewrite this item at a normal length; text this long is almost certainly malformed output.",
    );
  }
  runBlockingRules(ctx, drafts);
  runQuoteChecks(ctx, shared, drafts);
  runBannedPhrases(ctx, shared, drafts);
  return true;
}

function runStyleChecks(ctx: ItemContext, drafts: Draft[]): void {
  runPhraseRules(ctx, drafts);
  runTripletCheck(ctx, drafts);
  runExclamationCheck(ctx, drafts);
  runDashPayoffCheck(ctx, drafts);
}

// ---------------------------------------------------------------------------
// Résumé bullets
// ---------------------------------------------------------------------------

type BulletShape = Readonly<{ ctx: ItemContext; firstWord: string | null; endsWithPeriod: boolean | null }>;

function emitTenseMismatch(ctx: ItemContext, drafts: Draft[], offset: number, verb: string): void {
  emit(
    drafts,
    ctx,
    "BULLET_TENSE_MISMATCH",
    "WARNING",
    offset,
    verb,
    `"${verb}" is present tense in a past role.`,
    `Use the past tense of '${lower(verb)}' for a past role.`,
  );
}

function runBulletVerbCheck(ctx: ItemContext, body: string, offset: number, drafts: Draft[]): void {
  const tokens = words(body);
  const first = tokens[0];
  if (!first) return;
  const firstClass = classifyVerb(first);
  if (firstClass === "UNKNOWN" && /ly$/i.test(first) && tokens.length > 1) {
    const verb = tokens[1];
    const verbClass = classifyVerb(verb);
    if (verbClass === "PAST" || verbClass === "PRESENT") {
      emit(
        drafts,
        ctx,
        "BULLET_NOT_ACTION_VERB",
        "WARNING",
        offset,
        `${first} ${verb}`,
        `The bullet opens with the adverb "${first}" instead of the action.`,
        `Drop '${lower(first)}' and start the bullet with '${lower(verb)}'.`,
      );
      if (!ctx.item.current && verbClass === "PRESENT") emitTenseMismatch(ctx, drafts, offset, verb);
      return;
    }
  }
  if (firstClass === "PAST") return;
  if (firstClass === "PRESENT") {
    if (!ctx.item.current) emitTenseMismatch(ctx, drafts, offset, first);
    return;
  }
  emit(
    drafts,
    ctx,
    "BULLET_NOT_ACTION_VERB",
    "WARNING",
    offset,
    first,
    `The bullet does not open with an action verb ("${first}").`,
    ctx.item.current
      ? "Start the bullet with a specific action verb (present or past tense)."
      : "Start the bullet with a specific past-tense action verb.",
  );
}

function runBulletChecks(ctx: ItemContext, drafts: Draft[]): BulletShape {
  const { text } = ctx.item;
  const markerLength = text.match(LEADING_LIST_MARKER)?.[0].length ?? 0;
  const body = text.slice(markerLength).trim();
  const bodyOffset = body ? text.indexOf(body, markerLength) : markerLength;

  const pronouns: string[] = [];
  let pronounOffset = -1;
  for (const match of text.matchAll(FIRST_PERSON_PATTERN)) {
    const span = { start: match.index, end: match.index + match[0].length };
    if (match[0] === "I" && (
      /^(?:-\d|\/)/u.test(text.slice(span.end, span.end + 2)) ||
      ROMAN_NUMERAL_CONTEXT.test(text.slice(Math.max(0, span.start - 24), span.start))
    )) continue;
    if (overlapsAny(span, ctx.allowMasks) || insideAny(span, ctx.quotes)) continue;
    pronouns.push(match[0]);
    if (pronounOffset < 0) pronounOffset = span.start;
  }
  if (pronouns.length > 0) {
    emit(
      drafts,
      ctx,
      "FIRST_PERSON_IN_BULLET",
      "BLOCKING",
      pronounOffset,
      contextExcerpt(text, pronounOffset, pronounOffset + pronouns[0].length),
      `Résumé bullets must not use first-person pronouns (found: ${[...new Set(pronouns)].join(", ")}).`,
      "Rewrite the bullet without first-person pronouns; start with the action verb.",
    );
  }

  const weak = body.match(WEAK_BULLET_OPENER);
  if (weak) {
    emit(
      drafts,
      ctx,
      "WEAK_BULLET_OPENER",
      "REPAIR",
      bodyOffset,
      weak[1],
      `"${weak[1]}" describes a duty instead of an accomplishment.`,
      `Replace '${lower(weak[1])}' with the specific action verb and add the result.`,
    );
  } else {
    runBulletVerbCheck(ctx, body, bodyOffset, drafts);
  }

  const count = wordCount(body);
  if (count > 0 && (count < 7 || count > 34)) {
    emit(
      drafts,
      ctx,
      "BULLET_LENGTH",
      "WARNING",
      bodyOffset,
      body,
      `The bullet has ${count} words; aim for 7 to 34.`,
      count < 7
        ? "Add the scope or result to this bullet: what changed, for whom, and by how much."
        : "Split or tighten this bullet to one action and one result.",
    );
  }

  if (ctx.stockPhraseCount >= 2) {
    emit(
      drafts,
      ctx,
      "BUZZWORD_SOUP",
      "REPAIR",
      bodyOffset,
      body,
      `The bullet stacks ${ctx.stockPhraseCount} stock phrases.`,
      "Rewrite the bullet around one concrete action, its scope, and a measured result; drop the stock phrases.",
    );
  }

  const firstWord = words(body)[0];
  return {
    ctx,
    firstWord: firstWord ? lower(firstWord) : null,
    endsWithPeriod: body ? /\.["”’)]*$/u.test(body) : null,
  };
}

// ---------------------------------------------------------------------------
// Surface-level aggregates
// ---------------------------------------------------------------------------

function questionMarks(ctx: ItemContext): number[] {
  const { text } = ctx.item;
  const positions: number[] = [];
  for (const match of text.matchAll(/\?/gu)) {
    const span = { start: match.index, end: match.index + 1 };
    if (ctx.explainedQuestions.has(match.index)) continue;
    if (insideAny(span, ctx.quotes) || overlapsAny(span, ctx.allowMasks)) continue;
    if (/[^\s"”’')\]]/u.test(text[match.index + 1] ?? " ")) continue;
    positions.push(match.index);
  }
  return positions;
}

function emitQuestions(drafts: Draft[], units: readonly ItemContext[]): void {
  const found = units.flatMap((ctx) => questionMarks(ctx).map((position) => ({ ctx, position })));
  if (found.length === 0) return;
  const severity: WritingLintSeverity = found.length === 1 ? "WARNING" : "REPAIR";
  const seen = new Set<string>();
  for (const { ctx, position } of found) {
    const sentence = sentenceAt(ctx, position);
    const key = `${ctx.item.index}:${sentence?.start ?? position}`;
    if (seen.has(key)) continue;
    seen.add(key);
    emit(
      drafts,
      ctx,
      "RHETORICAL_QUESTION",
      severity,
      position,
      sentence?.text ?? contextExcerpt(ctx.item.text, position, position + 1),
      found.length === 1
        ? "The text asks a rhetorical question instead of making the point."
        : `The text asks ${found.length} rhetorical questions instead of making its points.`,
      "Turn each rhetorical question into a direct statement of the answer.",
    );
  }
}

function emitIntensifiers(drafts: Draft[], units: readonly ItemContext[]): void {
  const perUnit = units.map((ctx) => {
    const found: string[] = [];
    let offset = -1;
    for (const match of ctx.item.text.matchAll(INTENSIFIER_PATTERN)) {
      const span = { start: match.index, end: match.index + match[0].length };
      if (insideAny(span, ctx.quotes) || overlapsAny(span, ctx.allowMasks)) continue;
      found.push(lower(match[0]));
      if (offset < 0) offset = span.start;
    }
    return { ctx, found, offset };
  });
  const all = perUnit.flatMap((entry) => entry.found);
  if (all.length <= 2) return;
  const anchor = perUnit.find((entry) => entry.found.length > 0);
  if (!anchor) return;
  emit(
    drafts,
    anchor.ctx,
    "INTENSIFIER_PILEUP",
    "WARNING",
    anchor.offset,
    all.join(", "),
    `The text leans on ${all.length} intensifiers.`,
    "Delete intensifiers such as 'truly', 'deeply', and 'incredibly'; let specific facts show degree.",
  );
}

/** Emits EM_DASH_DENSITY when dashes exceed one per 90 words (one dash is always allowed). Returns the dash count. */
function emitDashDensity(drafts: Draft[], units: readonly ItemContext[], totalWords: number): number {
  const counts = units.map((ctx) => ({ ctx, count: [...ctx.item.text.matchAll(DASH_PATTERN)].length }));
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0 || counts.length === 0 || total <= Math.max(1, totalWords / 90)) return total;
  const anchor = counts.reduce((best, entry) => (entry.count > best.count ? entry : best));
  emit(
    drafts,
    anchor.ctx,
    "EM_DASH_DENSITY",
    "REPAIR",
    0,
    `${total} dashes in ${totalWords} words`,
    `The text uses ${total} dashes in ${totalWords} words; the limit is one per 90 words.`,
    "Rewrite so the text uses at most one dash per 90 words; use commas, periods, or parentheses instead.",
  );
  return total;
}

function paragraphSpans(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const match of text.matchAll(/\n[ \t]*\n\s*/gu)) {
    spans.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  spans.push({ start, end: text.length });
  return spans.filter((span) => span.end > span.start);
}

// ---------------------------------------------------------------------------
// Surface flows
// ---------------------------------------------------------------------------

type LetterContext = ItemContext & Readonly<{ bodyStart: number; bodyEnd: number; bodySentences: readonly Sentence[] }>;
type LetterMetrics = WritingLintReport["metrics"];

const I_START = /^["“'‘(]*I(?:['’](?:m|ve|d|ll))?(?![\p{L}\p{N}])/u;
const NUMBER_WORD = /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|dozen|several)$/u;
const OPENING_REUSE_FIX = "Write a new first sentence built on a detail specific to this employer or role; do not reuse the structure of recent openings.";
const MAX_RECENT_OPENINGS = 10;

function letterRole(text: string): ParagraphRole {
  const trimmed = text.trim();
  const salutation = trimmed.match(SALUTATION_PREFIX);
  if (salutation && trimmed.slice(salutation[0].length).trim() === "") return "SALUTATION";
  const firstLine = trimmed.split("\n")[0] ?? "";
  return SIGN_OFF_LINE.test(firstLine) && wordCount(trimmed) <= 12 ? "SIGN_OFF" : "BODY";
}

function letterBodyRange(text: string, role: ParagraphRole): Span {
  if (role !== "BODY") return { start: text.length, end: text.length };
  const start = text.match(SALUTATION_PREFIX)?.[0].length ?? 0;
  const signOff = text.slice(start).match(SIGN_OFF_LINE);
  return { start, end: signOff?.index !== undefined ? start + signOff.index : text.length };
}

function openingTokens(sentence: string): string[] {
  return words(lower(sentence.replace(/[’‘]/gu, "'"))).map((token) => (
    /^\d/u.test(token) || NUMBER_WORD.test(token) ? "#" : token.replace(/\.$/u, "")
  ));
}

function coefficientOfVariation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return mean > 0 ? Math.sqrt(variance) / mean : 0;
}

function lintCoverLetter(
  paragraphs: readonly string[],
  recentOpenings: readonly string[],
  shared: Shared,
  drafts: Draft[],
): LetterMetrics {
  const contexts: LetterContext[] = [];
  let signedOff = false;
  paragraphs.forEach((raw, index) => {
    const { text, originalLength } = prepareText(raw);
    let role = letterRole(text);
    if (signedOff && role === "BODY" && wordCount(text) <= 6 && !/[.!?]\s*$/u.test(text)) role = "SIGN_OFF";
    if (role === "SIGN_OFF") signedOff = true;
    const range = letterBodyRange(text, role);
    const bodySentences = role === "BODY"
      ? splitSentences(text.slice(range.start, range.end)).map((sentence) => ({
        text: sentence.text,
        start: sentence.start + range.start,
        end: sentence.end + range.start,
      }))
      : [];
    contexts.push({
      ...makeContext("COVER_LETTER", index, text, false, role, shared, originalLength),
      bodyStart: range.start,
      bodyEnd: range.end,
      bodySentences,
    });
  });

  const firstBody = contexts.find((ctx) => ctx.item.role === "BODY" && ctx.bodySentences.length > 0);
  for (const ctx of contexts) {
    if (!runCommonChecks(ctx, shared, drafts)) continue;
    if (ctx.item.index <= (firstBody?.item.index ?? 0)) runSalutationCheck(ctx, drafts);
    if (ctx === firstBody) runOpeningCheck(ctx, ctx.bodySentences[0], drafts);
    runStyleChecks(ctx, drafts);
    if (ctx.item.role === "BODY") runTransitionCheck(ctx, drafts, [{ start: ctx.bodyStart, end: ctx.bodyEnd }]);
  }

  const coverLetterWords = contexts.reduce((sum, ctx) => sum + wordCount(ctx.item.text), 0);
  emitQuestions(drafts, contexts);
  emitIntensifiers(drafts, contexts);
  const dashes = emitDashDensity(drafts, contexts, coverLetterWords);

  const sentences = contexts.flatMap((ctx) => ctx.bodySentences.map((sentence) => ({ ctx, sentence })));
  const lengths = sentences.map(({ sentence }) => wordCount(sentence.text));
  const cv = lengths.length >= 2 ? coefficientOfVariation(lengths) : null;
  if (cv !== null && lengths.length >= 6 && cv < 0.28 && firstBody) {
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    emit(
      drafts,
      firstBody,
      "SENTENCE_UNIFORMITY",
      cv < 0.2 ? "REPAIR" : "WARNING",
      0,
      `${lengths.length} sentences, mean ${mean.toFixed(1)} words, variation ${cv.toFixed(2)}`,
      "Sentence lengths are unusually uniform, a common trait of generated prose.",
      "Vary sentence length: merge two short related sentences and break up one long one, keeping every fact.",
    );
  }

  const iStarts = sentences.filter(({ sentence }) => I_START.test(sentence.text));
  const iStartShare = sentences.length > 0 ? iStarts.length / sentences.length : null;
  const bodyParagraphs = contexts.filter((ctx) => ctx.bodySentences.length > 0);
  const everyParagraphStartsWithI = bodyParagraphs.length >= 3 &&
    bodyParagraphs.every((ctx) => I_START.test(ctx.bodySentences[0].text));
  if ((iStartShare !== null && sentences.length >= 4 && iStartShare > 0.5) || everyParagraphStartsWithI) {
    const anchor = iStarts[0];
    emit(
      drafts,
      anchor?.ctx ?? bodyParagraphs[0],
      "I_START_OVERUSE",
      "REPAIR",
      anchor?.sentence.start ?? 0,
      iStartShare !== null && iStartShare > 0.5
        ? `${iStarts.length} of ${sentences.length} sentences start with "I"`
        : "every paragraph starts with \"I\"",
      "Too many sentences or paragraphs start with \"I\", which makes the letter read as a list of claims.",
      "Restructure some sentences to lead with the work, the team, or the result instead of \"I\".",
    );
  }

  let openingSimilarity: number | null = null;
  const firstSentence = firstBody?.bodySentences[0];
  const recent = recentOpenings
    .slice(0, MAX_RECENT_OPENINGS)
    .map((opening) => cleanText(opening).replace(SALUTATION_PREFIX, ""))
    .map((opening) => splitSentences(opening)[0]?.text ?? "")
    .filter((opening) => opening.length > 0);
  if (firstBody && firstSentence && recent.length > 0) {
    const tokens = openingTokens(firstSentence.text);
    const tokenSet = new Set(tokens);
    let best = { similarity: 0, samePrefix: false };
    for (const other of recent) {
      const otherTokens = openingTokens(other);
      const otherSet = new Set(otherTokens);
      const shared = [...tokenSet].filter((token) => otherSet.has(token)).length;
      const union = new Set([...tokenSet, ...otherSet]).size;
      const similarity = union > 0 ? shared / union : 0;
      const samePrefix = tokens.length >= 6 && otherTokens.length >= 6 &&
        tokens.slice(0, 6).join(" ") === otherTokens.slice(0, 6).join(" ");
      if (similarity > best.similarity || (samePrefix && !best.samePrefix)) {
        best = { similarity: Math.max(similarity, best.similarity), samePrefix: samePrefix || best.samePrefix };
      }
    }
    openingSimilarity = round(best.similarity, 3);
    if (best.similarity >= 0.55 || best.samePrefix) {
      emit(
        drafts,
        firstBody,
        "OPENING_REUSE",
        "REPAIR",
        firstSentence.start,
        firstSentence.text,
        best.samePrefix
          ? "The opening repeats the first six words of a recent letter's opening."
          : `The opening is ${Math.round(best.similarity * 100)}% similar to a recent letter's opening.`,
        OPENING_REUSE_FIX,
      );
    }
  }

  return {
    coverLetterWords,
    sentences: sentences.length,
    sentenceLengthCv: cv === null ? null : round(cv, 3),
    iStartShare: iStartShare === null ? null : round(iStartShare, 3),
    emDashesPer100Words: coverLetterWords > 0 ? round((dashes / coverLetterWords) * 100, 2) : 0,
    openingSimilarity,
  };
}

function lintSummary(summary: string | null, shared: Shared, drafts: Draft[]): void {
  if (summary === null || summary.trim() === "") return;
  const prepared = prepareText(summary);
  const ctx = makeContext("RESUME_SUMMARY", 0, prepared.text, false, "BODY", shared, prepared.originalLength);
  if (!runCommonChecks(ctx, shared, drafts)) return;
  runStyleChecks(ctx, drafts);
  runTransitionCheck(ctx, drafts, [{ start: 0, end: ctx.item.text.length }]);
  emitQuestions(drafts, [ctx]);
  emitIntensifiers(drafts, [ctx]);
  emitDashDensity(drafts, [ctx], wordCount(ctx.item.text));
}

function lintBullets(
  bullets: readonly Readonly<{ text: string; current: boolean }>[],
  shared: Shared,
  drafts: Draft[],
): void {
  const contexts = bullets.map((bullet, index) => {
    const prepared = prepareText(bullet?.text);
    return makeContext("RESUME_BULLET", index, prepared.text, bullet?.current === true, "BODY", shared, prepared.originalLength);
  });
  const shapes: BulletShape[] = [];
  for (const ctx of contexts) {
    if (!runCommonChecks(ctx, shared, drafts)) continue;
    runStyleChecks(ctx, drafts);
    shapes.push(runBulletChecks(ctx, drafts));
    emitQuestions(drafts, [ctx]);
    emitDashDensity(drafts, [ctx], wordCount(ctx.item.text));
  }
  emitIntensifiers(drafts, contexts);

  const punctuated = shapes.filter((shape) => shape.endsWithPeriod !== null);
  const withPeriod = punctuated.filter((shape) => shape.endsWithPeriod === true).length;
  if (withPeriod > 0 && withPeriod < punctuated.length) {
    const minorityHasPeriod = withPeriod <= punctuated.length - withPeriod;
    const anchor = punctuated.find((shape) => shape.endsWithPeriod === minorityHasPeriod) ?? punctuated[0];
    emit(
      drafts,
      anchor.ctx,
      "BULLET_PUNCTUATION_INCONSISTENT",
      "WARNING",
      0,
      `${withPeriod} of ${punctuated.length} bullets end with a period`,
      "Bullets end inconsistently: some with a period, some without.",
      "End every bullet the same way: all with a period or none.",
    );
  }

  const byFirstWord = new Map<string, BulletShape[]>();
  for (const shape of shapes) {
    if (!shape.firstWord) continue;
    byFirstWord.set(shape.firstWord, [...(byFirstWord.get(shape.firstWord) ?? []), shape]);
  }
  for (const [word, group] of byFirstWord) {
    if (group.length <= 2) continue;
    emit(
      drafts,
      group[2].ctx,
      "BULLET_REPEATED_OPENER",
      "WARNING",
      0,
      word,
      `${group.length} bullets start with "${word}".`,
      `Vary the opening verbs; keep '${word}' on at most two bullets.`,
    );
  }
}

const REPEAT_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "across", "that", "this", "their", "its", "our", "your", "via", "per", "over",
  "about", "while", "through", "within", "using", "each", "every", "more", "than", "then", "also", "both",
]);

/**
 * A distinctive two-word phrase repeated across three or more résumé lines
 * ("the operator-led approach") reads as padding. Skills, tools, titles and
 * employers the candidate lists are exempt.
 */
function emitRepeatedPhrases(
  summary: string | null,
  bullets: readonly Readonly<{ text: string; current: boolean }>[],
  shared: Shared,
  drafts: Draft[],
): void {
  const items: { surface: WritingSurface; index: number; text: string }[] = [
    ...(summary && summary.trim() ? [{ surface: "RESUME_SUMMARY" as const, index: 0, text: summary }] : []),
    ...bullets.map((bullet, index) => ({ surface: "RESUME_BULLET" as const, index, text: typeof bullet?.text === "string" ? bullet.text : "" })),
  ];
  const allowed = new Set(shared.allowNormalized);
  const positionsByGram = new Map<string, number[]>();
  items.forEach((item, position) => {
    const tokens = lower(cleanText(item.text)).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
    const grams = new Set<string>();
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      const first = tokens[index];
      const second = tokens[index + 1];
      if (first.length < 3 || second.length < 3 || REPEAT_STOPWORDS.has(first) || REPEAT_STOPWORDS.has(second)) continue;
      if (/\d/u.test(first + second) || allowed.has(first) || allowed.has(second)) continue;
      grams.add(`${first} ${second}`);
    }
    for (const gram of grams) positionsByGram.set(gram, [...(positionsByGram.get(gram) ?? []), position]);
  });
  for (const [gram, positions] of positionsByGram) {
    if (positions.length < 3 || shared.allowNormalized.some((term) => term.includes(gram))) continue;
    const item = items[positions[2]];
    const prepared = prepareText(item.text);
    const ctx = makeContext(item.surface, item.index, prepared.text, false, "BODY", shared, prepared.originalLength);
    emit(
      drafts,
      ctx,
      "REPEATED_PHRASE",
      "REPAIR",
      Math.max(0, lower(prepared.text).indexOf(gram)),
      gram,
      `"${gram}" appears in ${positions.length} résumé lines.`,
      `Keep '${gram}' in one line at most; make the other lines say something specific instead.`,
    );
  }
}

function lintAnswers(answers: readonly string[], shared: Shared, drafts: Draft[]): void {
  answers.forEach((raw, index) => {
    const prepared = prepareText(raw);
    const ctx = makeContext("ANSWER", index, prepared.text, false, "BODY", shared, prepared.originalLength);
    if (!runCommonChecks(ctx, shared, drafts)) return;
    runAnswerPreamble(ctx, drafts);
    runStyleChecks(ctx, drafts);
    runTransitionCheck(ctx, drafts, paragraphSpans(ctx.item.text));
    emitQuestions(drafts, [ctx]);
    emitIntensifiers(drafts, [ctx]);
    emitDashDensity(drafts, [ctx], wordCount(ctx.item.text));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_USER_TERMS = 200;
const MAX_USER_TERM_LENGTH = 120;

function uniqueTerms(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values ?? []) {
    if (typeof value !== "string") continue;
    const term = cleanText(value).trim();
    const key = lower(term);
    if (!term || term.length > MAX_USER_TERM_LENGTH || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_USER_TERMS) break;
  }
  return terms;
}

function buildShared(input: WritingLintInput): Shared {
  const allowTerms = uniqueTerms(input.allowTerms);
  return {
    allowPatterns: allowTerms.flatMap((term) => termPattern(term) ?? []),
    allowNormalized: allowTerms.map(normalizePhrase).filter((term) => term.length > 0),
    banned: uniqueTerms(input.candidateBannedPhrases).flatMap((phrase) => {
      const pattern = termPattern(phrase);
      return pattern ? [{ phrase, pattern }] : [];
    }),
  };
}

function finalizeIssues(drafts: readonly Draft[]): WritingLintIssue[] {
  const sorted = [...drafts].sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    SURFACE_RANK[a.surface] - SURFACE_RANK[b.surface] ||
    a.index - b.index ||
    a.offset - b.offset ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
  ));
  const seen = new Set<string>();
  const issues: WritingLintIssue[] = [];
  for (const draft of sorted) {
    const key = `${draft.code}|${draft.surface}|${draft.index}|${lower(draft.excerpt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      code: draft.code,
      severity: draft.severity,
      surface: draft.surface,
      index: draft.index,
      excerpt: draft.excerpt,
      message: draft.message,
      fix: draft.fix,
    });
  }
  return issues;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/**
 * Lints generated application writing. Deterministic and side-effect free:
 * identical input always yields an identical, deeply frozen report.
 */
export function lintApplicationWriting(input: WritingLintInput): WritingLintReport {
  const shared = buildShared(input);
  const drafts: Draft[] = [];
  const metrics = lintCoverLetter(input.coverLetterParagraphs ?? [], input.recentOpenings ?? [], shared, drafts);
  lintSummary(input.resumeSummary ?? null, shared, drafts);
  lintBullets(input.resumeBullets ?? [], shared, drafts);
  emitRepeatedPhrases(input.resumeSummary ?? null, input.resumeBullets ?? [], shared, drafts);
  lintAnswers(input.answers ?? [], shared, drafts);
  const issues = finalizeIssues(drafts);
  return deepFreeze({
    release: WRITING_LINT_RELEASE,
    passed: !issues.some((issue) => issue.severity !== "WARNING"),
    issues,
    metrics,
  });
}

const MAX_BRIEF_LINES = 25;

function issueLocation(issue: WritingLintIssue): string {
  switch (issue.surface) {
    case "COVER_LETTER":
      return `letter ¶${issue.index + 1}`;
    case "RESUME_SUMMARY":
      return "résumé summary";
    case "RESUME_BULLET":
      return `bullet ${issue.index + 1}`;
    case "ANSWER":
      return `answer ${issue.index + 1}`;
  }
}

/**
 * Compact repair brief for a rewriting model: at most 25 lines, one line per
 * distinct fix, BLOCKING first, then REPAIR, then optional WARNING nudges.
 */
export function writingLintRepairBrief(report: WritingLintReport): string {
  if (report.issues.length === 0) return `Writing lint (${report.release}): no issues; no rewrite needed.`;
  const counts: Record<WritingLintSeverity, number> = { BLOCKING: 0, REPAIR: 0, WARNING: 0 };
  type Group = { severity: WritingLintSeverity; fix: string; order: number; locations: string[]; excerpts: string[] };
  const groups = new Map<string, Group>();
  report.issues.forEach((issue, order) => {
    counts[issue.severity] += 1;
    let group = groups.get(issue.fix);
    if (!group) {
      group = { severity: issue.severity, fix: issue.fix, order, locations: [], excerpts: [] };
      groups.set(issue.fix, group);
    }
    if (SEVERITY_RANK[issue.severity] < SEVERITY_RANK[group.severity]) group.severity = issue.severity;
    const location = issueLocation(issue);
    if (!group.locations.includes(location)) group.locations.push(location);
    const excerpt = clip(issue.excerpt, 50);
    if (!group.excerpts.some((entry) => lower(entry) === lower(excerpt))) group.excerpts.push(excerpt);
  });
  const ordered = [...groups.values()].sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.order - b.order
  ));
  const lines = [
    `Writing repair brief (${report.release}): ${counts.BLOCKING} blocking, ${counts.REPAIR} repair, ${counts.WARNING} optional.`,
    "Change only what is listed. Keep every fact, number, name, and date; do not add new claims.",
  ];
  const room = MAX_BRIEF_LINES - lines.length;
  const shown = ordered.length <= room ? ordered : ordered.slice(0, room - 1);
  for (const group of shown) {
    const label = group.severity === "WARNING" ? "OPTIONAL" : group.severity;
    const where = group.locations.slice(0, 3).join(", ") +
      (group.locations.length > 3 ? ` +${group.locations.length - 3} more` : "");
    const examples = group.excerpts.slice(0, 2).map((excerpt) => `"${excerpt}"`).join("; ") +
      (group.excerpts.length > 2 ? `; +${group.excerpts.length - 2} more` : "");
    lines.push(`- [${label}] ${group.fix} (${where}: ${examples})`);
  }
  const omitted = ordered.length - shown.length;
  if (omitted > 0) lines.push(`- (+${omitted} lower-priority fixes omitted; rerun the linter after this pass.)`);
  return lines.join("\n");
}
