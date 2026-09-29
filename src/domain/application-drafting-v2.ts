import {
  APPLICATION_DOCUMENT_MODEL_RELEASE,
  displayPhone,
  formatLetterDate,
  resumePlainText,
  coverLetterPlainText,
  shortEmployerName,
  type CoverLetterDocumentModel,
  type DocumentContact,
  type ResumeDocumentModel,
  type ResumeSection,
} from "./application-documents.ts";
import { displayCareerRange, sortPositionsNewestFirst } from "./career-dates.ts";
import type { CareerPosition, CareerProfileContent } from "./career-profile.ts";
import type { VoiceProfileContent } from "./voice-profile.ts";

/**
 * Drafting v2: every candidate-facing segment (headline, summary, bullet,
 * letter paragraph, short answer) carries the exact sources it rests on.
 * Employer names, titles, dates, and education are printed from the
 * candidate-reviewed career profile; the model never writes them.
 */
export const APPLICATION_DRAFTING_RELEASE = "application-drafting/2";
export const APPLICATION_WRITING_POLICY_RELEASE_V4 = "roledawn-writing-policy/4";

export type TailoringMode = "AS_UPLOADED" | "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS";

export const WRITING_BOUNDS = Object.freeze({
  minCoverLetterWords: 200,
  maxCoverLetterWords: 400,
  preferredMinCoverLetterWords: 260,
  preferredMaxCoverLetterWords: 340,
  minParagraphs: 3,
  maxParagraphs: 5,
  maxBulletsPerPosition: 6,
  maxTotalBullets: 22,
  minBulletWords: 6,
  maxBulletWords: 40,
  maxSummaryWords: 75,
  maxHeadlineWords: 14,
  minAnswerWords: 25,
  maxAnswerWords: 170,
});

export type DraftingSourceKind = "RESUME_EVIDENCE" | "STORY" | "JOB_POSTING" | "COMPANY_RESEARCH";
export type DraftingUsage = "RESUME_AND_COVER_LETTER" | "COVER_LETTER_ONLY";

export type DraftingSource = Readonly<{
  sourceId: string;
  kind: DraftingSourceKind;
  text: string;
  usage: DraftingUsage;
  positionKey: string | null;
}>;

export type DraftingEvidence = Readonly<{
  evidenceVersionId: string;
  evidenceKey: string;
  documentId: string;
  category: string;
  text: string;
  claimSha256: string;
  usage: DraftingUsage;
}>;

export type DraftingStory = Readonly<{
  storyVersionId: string;
  storySha256: string;
  positionKey: string | null;
  title: string;
  text: string;
  usage: DraftingUsage;
}>;

export type DraftingContextV2 = Readonly<{
  binding: Readonly<{
    workspaceId: string;
    candidateId: string;
    applicationId: string;
    inputSnapshotId: string;
    snapshotHash: string;
    capturedAt: string;
    jobId: string;
    jobVersionId: string;
    jobContentSha256: string;
    resumeReviewedTextSha256: string;
  }>;
  job: Readonly<{
    employerName: string;
    title: string;
    description: string;
    location: string | null;
    employmentType: string | null;
    workMode: string | null;
    applyUrl: string;
  }>;
  tailoringMode: TailoringMode;
  career: CareerProfileContent;
  careerVersionId: string | null;
  evidence: readonly DraftingEvidence[];
  stories: readonly DraftingStory[];
  voice: VoiceProfileContent | null;
  voiceVersionId: string | null;
  recentOpenings: readonly string[];
  targetRoles: readonly string[];
}>;

export const RESEARCH_FACT_KINDS = ["COMPANY", "PRODUCT", "NEWS", "FUNDING", "LEADERSHIP", "CUSTOMERS", "CULTURE"] as const;
export const WHY_NOW_TYPES = ["NEW_BET", "SCALING", "BACKFILL", "TURNAROUND", "COMPETITIVE", "COMPLIANCE", "COST", "LEADERSHIP_GAP", "UNKNOWN"] as const;

export type ResearchFact = Readonly<{
  id: string;
  kind: (typeof RESEARCH_FACT_KINDS)[number];
  text: string;
  url: string;
  sourceTitle: string;
  published: string | null;
}>;

export type NeedsBrief = Readonly<{
  roleSummary: string;
  topRequirements: readonly string[];
  theirLanguage: readonly string[];
  whyNow: Readonly<{ type: (typeof WHY_NOW_TYPES)[number]; hypothesis: string; basis: string }>;
  sixMonthOutcome: string;
  readerModel: string;
}>;

export type EmployerResearch = Readonly<{
  coverage: "OFFICIAL_POSTING_ONLY" | "MULTI_PRIMARY_SOURCE";
  facts: readonly ResearchFact[];
  brief: NeedsBrief;
  model: string | null;
}>;

export type Segment = Readonly<{ text: string; sourceIds: readonly string[] }>;

export const LETTER_SHAPES = ["PROBLEM_PROOF", "STORY_LED", "RESULTS_LED", "CAREER_BRIDGE"] as const;
export const ANSWER_KINDS = ["WHY_COMPANY", "WHY_ROLE", "RELEVANT_EXPERIENCE"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

export type DraftingProposalV2 = Readonly<{
  strategy: Readonly<{
    angle: string;
    hiringNeed: string;
    letterShape: (typeof LETTER_SHAPES)[number];
    topRequirements: readonly Readonly<{ requirement: string; coverage: "DIRECT" | "ADJACENT" | "GAP"; sourceIds: readonly string[] }>[];
    mirroredTerms: readonly string[];
  }>;
  resume: Readonly<{
    headline: Segment | null;
    summary: Segment | null;
    positions: readonly Readonly<{ positionKey: string; bullets: readonly Segment[] }>[];
    skills: readonly Readonly<{ label: string | null; items: readonly string[] }>[];
  }>;
  coverLetter: Readonly<{ paragraphs: readonly Segment[] }>;
  answers: readonly Readonly<{ kind: AnswerKind; text: string; sourceIds: readonly string[] }>[];
}>;

export type SegmentSurface = "RESUME_HEADLINE" | "RESUME_SUMMARY" | "RESUME_BULLET" | "COVER_LETTER" | "ANSWER";

export type ProposalSegment = Readonly<{
  segmentId: string;
  surface: SegmentSurface;
  text: string;
  sourceIds: readonly string[];
  positionKey: string | null;
}>;

export type DraftingIssue = Readonly<{
  code: string;
  severity: "BLOCKING" | "REPAIR" | "WARNING";
  segmentId: string | null;
  message: string;
  fix: string;
}>;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export function positionKeyByEvidenceKey(career: CareerProfileContent): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const position of career.positions) for (const key of position.evidenceKeys) map.set(key, position.positionKey);
  return map;
}

export function jobSourceText(job: DraftingContextV2["job"]): string {
  return [
    `Employer: ${job.employerName}`,
    `Role: ${job.title}`,
    ...(job.location ? [`Location: ${job.location}`] : []),
    ...(job.workMode ? [`Work mode: ${job.workMode}`] : []),
    "Posting:",
    job.description,
  ].join("\n");
}

/**
 * "Role: Head of Business Development & AI Engineering, Human Touch Home Health
 * (2024 – Present)". Résumé bullets rarely name their employer; the
 * candidate-reviewed career profile establishes which role each belongs to,
 * so the writer and the checker both see that relationship explicitly.
 */
export function roleLabel(position: CareerPosition): string {
  const dates = displayCareerRange(position.startDate, position.endDate, position.current);
  return `Role: ${position.title}, ${position.organization}${position.location ? `, ${position.location}` : ""}${dates ? ` (${dates})` : ""}`;
}

export function buildDraftingSources(context: DraftingContextV2, research: EmployerResearch): ReadonlyMap<string, DraftingSource> {
  const byEvidenceKey = positionKeyByEvidenceKey(context.career);
  const positions = new Map(context.career.positions.map((position) => [position.positionKey, position] as const));
  const sources = new Map<string, DraftingSource>();
  for (const evidence of context.evidence) {
    const positionKey = byEvidenceKey.get(evidence.evidenceKey) ?? null;
    const position = positionKey ? positions.get(positionKey) : undefined;
    sources.set(`ev:${evidence.evidenceVersionId}`, Object.freeze({
      sourceId: `ev:${evidence.evidenceVersionId}`,
      kind: "RESUME_EVIDENCE",
      text: position ? `${roleLabel(position)}\n${evidence.text}` : evidence.text,
      usage: evidence.usage,
      positionKey,
    }));
  }
  for (const story of context.stories) {
    sources.set(`st:${story.storyVersionId}`, Object.freeze({
      sourceId: `st:${story.storyVersionId}`,
      kind: "STORY",
      text: story.text,
      usage: story.usage,
      positionKey: story.positionKey && context.career.positions.some((position) => position.positionKey === story.positionKey)
        ? story.positionKey : null,
    }));
  }
  sources.set("job", Object.freeze({
    sourceId: "job", kind: "JOB_POSTING", text: jobSourceText(context.job), usage: "COVER_LETTER_ONLY", positionKey: null,
  }));
  for (const fact of research.facts) {
    sources.set(`rs:${fact.id}`, Object.freeze({
      sourceId: `rs:${fact.id}`,
      kind: "COMPANY_RESEARCH",
      text: `${fact.text}${fact.published ? ` (published ${fact.published})` : ""} — ${fact.sourceTitle}`,
      usage: "COVER_LETTER_ONLY",
      positionKey: null,
    }));
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Model input and output schema
// ---------------------------------------------------------------------------

export function draftingModelInput(context: DraftingContextV2, research: EmployerResearch, sources: ReadonlyMap<string, DraftingSource>): string {
  const positions = sortPositionsNewestFirst(context.career.positions).map((position) => ({
    positionKey: position.positionKey,
    title: position.title,
    organization: position.organization,
    dates: displayCareerRange(position.startDate, position.endDate, position.current),
    current: position.current,
    scope: position.summary,
    sources: [...sources.values()]
      .filter((source) => source.positionKey === position.positionKey && (source.kind === "RESUME_EVIDENCE" || source.kind === "STORY"))
      .map((source) => ({ sourceId: source.sourceId, kind: source.kind, usage: source.usage, text: source.text })),
  }));
  const unassigned = [...sources.values()]
    .filter((source) => source.positionKey === null && (source.kind === "RESUME_EVIDENCE" || source.kind === "STORY"))
    .map((source) => ({ sourceId: source.sourceId, kind: source.kind, usage: source.usage, text: source.text }));
  return JSON.stringify({
    target: {
      employer: context.job.employerName,
      role: context.job.title,
      location: context.job.location,
      workMode: context.job.workMode,
      postingSourceId: "job",
      posting: context.job.description.slice(0, 16_000),
    },
    needsBrief: research.brief,
    companyResearch: research.facts.map((fact) => ({ sourceId: `rs:${fact.id}`, kind: fact.kind, text: fact.text, published: fact.published, source: fact.sourceTitle })),
    candidate: {
      ownHeadline: context.career.headline,
      targetRoles: context.targetRoles,
      positions,
      unassignedSources: unassigned,
      skills: context.career.skills,
      education: context.career.education.map((entry) => `${entry.credential}, ${entry.institution}`),
      certifications: context.career.certifications.map((entry) => entry.name),
      gaps: context.career.gaps,
    },
    voice: context.voice ? {
      toneNotes: context.voice.toneNotes,
      selfDescription: context.voice.selfDescription,
      preferredPhrases: context.voice.preferredPhrases,
      avoidPhrases: context.voice.avoidPhrases,
      writingSampleExcerpt: context.voice.writingSample?.slice(0, 1_500) ?? null,
    } : null,
    recentOpenings: context.recentOpenings.slice(0, 10),
    tailoringMode: context.tailoringMode,
    bounds: {
      coverLetterWords: `${WRITING_BOUNDS.minCoverLetterWords}-${WRITING_BOUNDS.maxCoverLetterWords} (aim ${WRITING_BOUNDS.preferredMinCoverLetterWords}-${WRITING_BOUNDS.preferredMaxCoverLetterWords})`,
      coverLetterParagraphs: `${WRITING_BOUNDS.minParagraphs}-${WRITING_BOUNDS.maxParagraphs}`,
      bulletsPerPosition: `0-${WRITING_BOUNDS.maxBulletsPerPosition}`,
      totalBullets: `at most ${WRITING_BOUNDS.maxTotalBullets}`,
      bulletWords: "12-28 typical",
      summaryWords: `at most ${WRITING_BOUNDS.maxSummaryWords}`,
      answerWords: "60-150",
    },
  });
}

const SEGMENT = {
  type: "object",
  additionalProperties: false,
  required: ["text", "sourceIds"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 3_000 },
    sourceIds: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", maxLength: 80 } },
  },
} as const;

export const DRAFTING_PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["strategy", "resume", "coverLetter", "answers"],
  properties: {
    strategy: {
      type: "object",
      additionalProperties: false,
      required: ["angle", "hiringNeed", "letterShape", "topRequirements", "mirroredTerms"],
      properties: {
        angle: { type: "string", minLength: 1, maxLength: 400 },
        hiringNeed: { type: "string", minLength: 1, maxLength: 400 },
        letterShape: { type: "string", enum: [...LETTER_SHAPES] },
        topRequirements: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["requirement", "coverage", "sourceIds"],
            properties: {
              requirement: { type: "string", minLength: 1, maxLength: 200 },
              coverage: { type: "string", enum: ["DIRECT", "ADJACENT", "GAP"] },
              sourceIds: { type: "array", maxItems: 6, items: { type: "string", maxLength: 80 } },
            },
          },
        },
        mirroredTerms: { type: "array", maxItems: 12, items: { type: "string", maxLength: 60 } },
      },
    },
    resume: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "summary", "positions", "skills"],
      properties: {
        headline: { anyOf: [{ type: "null" }, SEGMENT] },
        summary: { anyOf: [{ type: "null" }, SEGMENT] },
        positions: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["positionKey", "bullets"],
            properties: {
              positionKey: { type: "string", maxLength: 64 },
              bullets: { type: "array", maxItems: WRITING_BOUNDS.maxBulletsPerPosition, items: SEGMENT },
            },
          },
        },
        skills: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "items"],
            properties: {
              label: { type: ["string", "null"], maxLength: 60 },
              items: { type: "array", minItems: 1, maxItems: 14, items: { type: "string", maxLength: 60 } },
            },
          },
        },
      },
    },
    coverLetter: {
      type: "object",
      additionalProperties: false,
      required: ["paragraphs"],
      properties: {
        paragraphs: { type: "array", minItems: WRITING_BOUNDS.minParagraphs, maxItems: WRITING_BOUNDS.maxParagraphs, items: SEGMENT },
      },
    },
    answers: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "sourceIds"],
        properties: {
          kind: { type: "string", enum: [...ANSWER_KINDS] },
          text: { type: "string", minLength: 1, maxLength: 1_500 },
          sourceIds: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", maxLength: 80 } },
        },
      },
    },
  },
} as const;

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

function cleanIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))].slice(0, 8)
    : [];
}

function parseSegment(value: unknown, max: number): Segment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = cleanText(record.text, max);
  return text ? Object.freeze({ text, sourceIds: Object.freeze(cleanIds(record.sourceIds)) }) : null;
}

/** Fail-closed parse of untrusted model output into the v2 proposal shape. */
export function parseDraftingProposalV2(value: unknown): DraftingProposalV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DRAFTING_OUTPUT_INVALID");
  const record = value as Record<string, unknown>;
  const strategy = (record.strategy ?? {}) as Record<string, unknown>;
  const resume = (record.resume ?? {}) as Record<string, unknown>;
  const letter = (record.coverLetter ?? {}) as Record<string, unknown>;
  const letterShape = LETTER_SHAPES.includes(strategy.letterShape as (typeof LETTER_SHAPES)[number])
    ? strategy.letterShape as (typeof LETTER_SHAPES)[number] : "PROBLEM_PROOF";
  const paragraphs = (Array.isArray(letter.paragraphs) ? letter.paragraphs : [])
    .map((paragraph) => parseSegment(paragraph, 3_000)).filter((segment): segment is Segment => Boolean(segment));
  if (paragraphs.length === 0) throw new Error("DRAFTING_OUTPUT_INVALID");
  return Object.freeze({
    strategy: Object.freeze({
      angle: cleanText(strategy.angle, 400),
      hiringNeed: cleanText(strategy.hiringNeed, 400),
      letterShape,
      topRequirements: Object.freeze((Array.isArray(strategy.topRequirements) ? strategy.topRequirements : []).slice(0, 6).flatMap((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        const requirement = cleanText(item.requirement, 200);
        if (!requirement) return [];
        const coverage = item.coverage === "DIRECT" || item.coverage === "ADJACENT" ? item.coverage : "GAP";
        return [Object.freeze({ requirement, coverage, sourceIds: Object.freeze(cleanIds(item.sourceIds)) })];
      })),
      mirroredTerms: Object.freeze((Array.isArray(strategy.mirroredTerms) ? strategy.mirroredTerms : [])
        .map((term) => cleanText(term, 60)).filter(Boolean).slice(0, 12)),
    }),
    resume: Object.freeze({
      headline: parseSegment(resume.headline, 200),
      summary: parseSegment(resume.summary, 800),
      positions: Object.freeze((Array.isArray(resume.positions) ? resume.positions : []).slice(0, 20).flatMap((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        const positionKey = cleanText(item.positionKey, 64);
        if (!positionKey) return [];
        const bullets = (Array.isArray(item.bullets) ? item.bullets : []).slice(0, WRITING_BOUNDS.maxBulletsPerPosition)
          .map((bullet) => parseSegment(bullet, 600)).filter((segment): segment is Segment => Boolean(segment));
        return [Object.freeze({ positionKey, bullets: Object.freeze(bullets) })];
      })),
      skills: Object.freeze((Array.isArray(resume.skills) ? resume.skills : []).slice(0, 5).flatMap((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        const items = (Array.isArray(item.items) ? item.items : []).map((skill) => cleanText(skill, 60)).filter(Boolean).slice(0, 14);
        return items.length ? [Object.freeze({ label: cleanText(item.label, 60) || null, items: Object.freeze(items) })] : [];
      })),
    }),
    coverLetter: Object.freeze({ paragraphs: Object.freeze(paragraphs) }),
    answers: Object.freeze((Array.isArray(record.answers) ? record.answers : []).slice(0, 3).flatMap((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const kind = ANSWER_KINDS.includes(item.kind as AnswerKind) ? item.kind as AnswerKind : null;
      const text = cleanText(item.text, 1_500);
      return kind && text ? [Object.freeze({ kind, text, sourceIds: Object.freeze(cleanIds(item.sourceIds)) })] : [];
    })),
  });
}

// ---------------------------------------------------------------------------
// Segments and deterministic validation
// ---------------------------------------------------------------------------

export function proposalSegments(proposal: DraftingProposalV2): readonly ProposalSegment[] {
  const segments: ProposalSegment[] = [];
  if (proposal.resume.headline) segments.push({ segmentId: "resume.headline", surface: "RESUME_HEADLINE", positionKey: null, ...proposal.resume.headline });
  if (proposal.resume.summary) segments.push({ segmentId: "resume.summary", surface: "RESUME_SUMMARY", positionKey: null, ...proposal.resume.summary });
  for (const position of proposal.resume.positions) {
    position.bullets.forEach((bullet, index) => segments.push({
      segmentId: `resume.${position.positionKey}.${index + 1}`, surface: "RESUME_BULLET", positionKey: position.positionKey, ...bullet,
    }));
  }
  proposal.coverLetter.paragraphs.forEach((paragraph, index) => segments.push({
    segmentId: `letter.${index + 1}`, surface: "COVER_LETTER", positionKey: null, ...paragraph,
  }));
  for (const answer of proposal.answers) {
    segments.push({ segmentId: `answer.${answer.kind}`, surface: "ANSWER", positionKey: null, text: answer.text, sourceIds: answer.sourceIds });
  }
  return Object.freeze(segments.map((segment) => Object.freeze(segment)));
}

export function wordCount(value: string): number {
  return value.trim().match(/\S+/gu)?.length ?? 0;
}

function numericTokens(value: string): string[] {
  return (value.match(/(?<![\p{L}])\d[\d,]*(?:\.\d+)?/gu) ?? []).map((token) => token.replace(/,/gu, "").replace(/\.0+$/u, ""));
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}+#.]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function issue(code: string, severity: DraftingIssue["severity"], segmentId: string | null, message: string, fix: string): DraftingIssue {
  return Object.freeze({ code, severity, segmentId, message, fix });
}

const CANDIDATE_KINDS: ReadonlySet<DraftingSourceKind> = new Set(["RESUME_EVIDENCE", "STORY"]);

export function validateDraftingProposalV2(
  context: DraftingContextV2,
  sources: ReadonlyMap<string, DraftingSource>,
  proposal: DraftingProposalV2,
): readonly DraftingIssue[] {
  const issues: DraftingIssue[] = [];
  const knownPositions = new Set(context.career.positions.map((position) => position.positionKey));
  const seenPositions = new Set<string>();
  let totalBullets = 0;
  for (const position of proposal.resume.positions) {
    if (!knownPositions.has(position.positionKey)) {
      issues.push(issue("UNKNOWN_POSITION", "REPAIR", `resume.${position.positionKey}`, "A résumé section refers to a role that is not in the candidate's profile.",
        "Use only positionKey values supplied in candidate.positions."));
    }
    if (seenPositions.has(position.positionKey)) {
      issues.push(issue("DUPLICATE_POSITION", "REPAIR", `resume.${position.positionKey}`, "A role appears twice.", "List each positionKey once."));
    }
    seenPositions.add(position.positionKey);
    totalBullets += position.bullets.length;
  }
  if (totalBullets > WRITING_BOUNDS.maxTotalBullets) {
    issues.push(issue("TOO_MANY_BULLETS", "REPAIR", null, "The résumé has too many bullets for one page.",
      `Keep at most ${WRITING_BOUNDS.maxTotalBullets} bullets; cut the weakest and least relevant.`));
  }
  if (context.tailoringMode !== "AS_UPLOADED" && totalBullets === 0) {
    issues.push(issue("RESUME_EMPTY", "REPAIR", null, "The résumé has no bullets.", "Write bullets for each role from its sources."));
  }

  for (const segment of proposalSegments(proposal)) {
    const cited = segment.sourceIds.map((id) => sources.get(id));
    if (segment.sourceIds.length === 0) {
      issues.push(issue("SOURCE_REQUIRED", "REPAIR", segment.segmentId, "This text lists no sources.", "Attach the sourceIds that support every statement in it."));
      continue;
    }
    segment.sourceIds.forEach((id, index) => {
      if (!cited[index]) {
        issues.push(issue("UNKNOWN_SOURCE", "REPAIR", segment.segmentId, `Source ${id} does not exist.`, "Use only sourceIds supplied in the input."));
      }
    });
    const known = cited.filter((source): source is DraftingSource => Boolean(source));
    const candidateSources = known.filter((source) => CANDIDATE_KINDS.has(source.kind));
    if (segment.surface.startsWith("RESUME")) {
      if (known.some((source) => !CANDIDATE_KINDS.has(source.kind))) {
        issues.push(issue("RESUME_EMPLOYER_SOURCE", "REPAIR", segment.segmentId, "Résumé text cites the job posting or company research.",
          "Résumé text describes only the candidate: cite résumé evidence or stories, never job or company sources."));
      }
      if (known.some((source) => source.usage === "COVER_LETTER_ONLY" && CANDIDATE_KINDS.has(source.kind))) {
        issues.push(issue("RESUME_USE_NOT_ALLOWED", "REPAIR", segment.segmentId, "This source is approved for cover letters only.",
          "Remove it from résumé text."));
      }
      if (candidateSources.length === 0) {
        issues.push(issue("RESUME_CANDIDATE_SOURCE_REQUIRED", "REPAIR", segment.segmentId, "Résumé text needs candidate evidence.", "Cite the résumé passage or story it comes from."));
      }
      if (segment.surface === "RESUME_BULLET" && candidateSources.some((source) => source.positionKey !== segment.positionKey)) {
        issues.push(issue("BULLET_WRONG_ROLE", "REPAIR", segment.segmentId, "A bullet cites evidence from a different role.",
          "Move the bullet under the role its evidence belongs to, or drop it."));
      }
    }
    if (segment.surface === "RESUME_BULLET") {
      const words = wordCount(segment.text);
      if (words < WRITING_BOUNDS.minBulletWords || words > WRITING_BOUNDS.maxBulletWords) {
        issues.push(issue("BULLET_LENGTH", "REPAIR", segment.segmentId, "A bullet is too short or too long.", "Keep bullets to one idea in roughly 12–28 words."));
      }
    }
    if (segment.surface === "RESUME_SUMMARY" && wordCount(segment.text) > WRITING_BOUNDS.maxSummaryWords) {
      issues.push(issue("SUMMARY_LENGTH", "REPAIR", segment.segmentId, "The summary is too long.", "Two or three sentences, under 60 words."));
    }
    if (segment.surface === "RESUME_HEADLINE" && wordCount(segment.text) > WRITING_BOUNDS.maxHeadlineWords) {
      issues.push(issue("HEADLINE_LENGTH", "REPAIR", segment.segmentId, "The headline is too long.", "Use 3–10 words."));
    }
    if (segment.surface === "ANSWER") {
      const words = wordCount(segment.text);
      if (words < WRITING_BOUNDS.minAnswerWords || words > WRITING_BOUNDS.maxAnswerWords) {
        issues.push(issue("ANSWER_LENGTH", "REPAIR", segment.segmentId, "A short answer is outside its length.", "Answer in 60–150 words."));
      }
    }
    // Every number must appear in the sources this segment cites.
    const available = new Set(known.flatMap((source) => numericTokens(source.text)));
    for (const token of numericTokens(segment.text)) {
      if (!available.has(token)) {
        issues.push(issue("UNSUPPORTED_NUMBER", "REPAIR", segment.segmentId, `The number ${token} is not in this text's sources.`,
          `Remove ${token} or cite the source that states it exactly. Never compute, round, or combine numbers.`));
      }
    }
  }

  // Skills must come from the candidate's profile or evidence.
  const skillHaystack = normalizeTerm([
    ...context.career.skills.flatMap((group) => group.items),
    ...[...sources.values()].filter((source) => CANDIDATE_KINDS.has(source.kind)).map((source) => source.text),
  ].join(" \n "));
  for (const group of proposal.resume.skills) {
    for (const item of group.items) {
      const needle = normalizeTerm(item);
      if (needle && !skillHaystack.includes(needle)) {
        issues.push(issue("UNSUPPORTED_SKILL", "REPAIR", "resume.skills", `The skill "${item}" is not in the candidate's profile.`,
          "List only skills that appear in candidate.skills or the candidate's sources."));
      }
    }
  }

  const letterWords = wordCount(proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text).join(" "));
  if (letterWords < WRITING_BOUNDS.minCoverLetterWords || letterWords > WRITING_BOUNDS.maxCoverLetterWords) {
    issues.push(issue("LETTER_LENGTH", "REPAIR", null, `The cover letter is ${letterWords} words.`,
      `Write ${WRITING_BOUNDS.preferredMinCoverLetterWords}–${WRITING_BOUNDS.preferredMaxCoverLetterWords} words (hard range ${WRITING_BOUNDS.minCoverLetterWords}–${WRITING_BOUNDS.maxCoverLetterWords}) by adding or cutting proof, never filler.`));
  }
  if (letterWords >= WRITING_BOUNDS.minCoverLetterWords && letterWords < WRITING_BOUNDS.preferredMinCoverLetterWords - 20) {
    const letterCited = new Set(proposal.coverLetter.paragraphs.flatMap((paragraph) => paragraph.sourceIds));
    const unused = [...sources.values()].filter((source) => CANDIDATE_KINDS.has(source.kind) && !letterCited.has(source.sourceId));
    issues.push(issue("LETTER_SHORT", unused.length >= 2 ? "REPAIR" : "WARNING", null, `The cover letter is ${letterWords} words, short of the ${WRITING_BOUNDS.preferredMinCoverLetterWords}–${WRITING_BOUNDS.preferredMaxCoverLetterWords} target.`,
      "Add one more concrete proof point from an unused candidate source (a story, a result, or how the candidate worked), not filler."));
  }
  const letterText = proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text).join("\n");
  if (/^\s*(?:dear|hi|hello|to whom)\b/imu.test(letterText) || /\b(?:sincerely|best regards|kind regards|warm regards|respectfully),?\s*$/imu.test(letterText)) {
    issues.push(issue("LETTER_FRAMING_INCLUDED", "REPAIR", "letter.1", "The letter body includes a salutation or sign-off.",
      "Return body paragraphs only; the system adds the greeting and sign-off."));
  }
  const employer = normalizeTerm(shortEmployerName(context.job.employerName));
  if (employer && !normalizeTerm(letterText).includes(employer)) {
    issues.push(issue("LETTER_EMPLOYER_MISSING", "REPAIR", null, "The letter never names the employer.", `Refer to ${context.job.employerName} by name at least once.`));
  }
  const firstTwo = proposal.coverLetter.paragraphs.slice(0, 2).flatMap((paragraph) => paragraph.sourceIds);
  if (!firstTwo.some((id) => { const source = sources.get(id); return source && CANDIDATE_KINDS.has(source.kind); })) {
    issues.push(issue("LETTER_PROOF_LATE", "REPAIR", "letter.1", "The candidate's proof does not appear in the first two paragraphs.",
      "Bring the strongest matching story or result into paragraph one or two."));
  }
  for (const answer of proposal.answers) {
    const kinds = new Set(answer.sourceIds.map((id) => sources.get(id)?.kind));
    if (answer.kind === "WHY_COMPANY" && !kinds.has("JOB_POSTING") && !kinds.has("COMPANY_RESEARCH")) {
      issues.push(issue("ANSWER_EMPLOYER_SOURCE", "REPAIR", `answer.${answer.kind}`, "The company answer cites nothing about the company.",
        "Ground it in the posting or company research."));
    }
  }
  return Object.freeze(issues);
}

// ---------------------------------------------------------------------------
// Assembly into rendered document models
// ---------------------------------------------------------------------------

export type DocumentExactFacts = Readonly<{
  legalName: string | null;
  preferredName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
}>;

const US_STATES: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

export function documentName(facts: DocumentExactFacts): string {
  if (facts.preferredName && facts.familyName) return `${facts.preferredName} ${facts.familyName}`;
  return facts.legalName ?? "Candidate";
}

export function documentContact(facts: DocumentExactFacts): DocumentContact {
  const region = facts.region
    ? (facts.countryCode === "US" ? US_STATES[facts.region.toLocaleLowerCase("en-US")] ?? facts.region : facts.region)
    : null;
  const location = facts.city && region ? `${facts.city}, ${region}` : facts.city ?? region ?? null;
  return Object.freeze({
    location,
    email: facts.email,
    phone: displayPhone(facts.phone),
    linkedinUrl: facts.linkedinUrl,
    websiteUrl: facts.websiteUrl,
  });
}

function positionForKey(career: CareerProfileContent, key: string): CareerPosition | undefined {
  return career.positions.find((position) => position.positionKey === key);
}

export function assembleResumeModel(
  context: DraftingContextV2,
  proposal: DraftingProposalV2,
  facts: DocumentExactFacts,
): ResumeDocumentModel {
  const bulletsByPosition = new Map(proposal.resume.positions.map((position) => [position.positionKey, position.bullets.map((bullet) => bullet.text)] as const));
  const positions = sortPositionsNewestFirst(context.career.positions);
  const experience = positions.map((position) => Object.freeze({
    title: position.title,
    organization: position.organization,
    location: position.location,
    dates: displayCareerRange(position.startDate, position.endDate, position.current),
    context: null,
    bullets: Object.freeze(bulletsByPosition.get(position.positionKey) ?? []),
  }));
  const sections: ResumeSection[] = [];
  if (experience.length > 0) sections.push(Object.freeze({ kind: "EXPERIENCE", heading: "Experience", entries: Object.freeze(experience) }));
  const skills = proposal.resume.skills.length > 0 ? proposal.resume.skills : context.career.skills;
  if (skills.length > 0) sections.push(Object.freeze({ kind: "SKILLS", heading: "Skills", groups: Object.freeze(skills.map((group) => Object.freeze({ label: group.label, items: Object.freeze([...group.items]) }))) }));
  if (context.career.education.length > 0) {
    sections.push(Object.freeze({
      kind: "EDUCATION",
      heading: "Education",
      entries: Object.freeze(context.career.education.map((entry) => Object.freeze({
        credential: entry.field && !entry.credential.toLocaleLowerCase("en-US").includes(entry.field.toLocaleLowerCase("en-US"))
          ? `${entry.credential}, ${entry.field}` : entry.credential,
        institution: entry.institution,
        location: entry.location,
        dates: displayCareerRange(entry.startDate, entry.endDate, false),
        details: Object.freeze([...entry.details]),
      }))),
    }));
  }
  if (context.career.certifications.length > 0) {
    sections.push(Object.freeze({
      kind: "LIST",
      heading: "Certifications",
      items: Object.freeze(context.career.certifications.map((entry) => [entry.name, entry.issuer, displayCareerRange(entry.date, null, false)].filter(Boolean).join(", "))),
    }));
  }
  return Object.freeze({
    release: APPLICATION_DOCUMENT_MODEL_RELEASE,
    name: documentName(facts),
    headline: proposal.resume.headline?.text ?? context.career.headline ?? null,
    contact: documentContact(facts),
    summary: proposal.resume.summary?.text ?? null,
    sections: Object.freeze(sections),
  });
}

export function assembleCoverLetterModel(
  context: DraftingContextV2,
  proposal: DraftingProposalV2,
  facts: DocumentExactFacts,
  date: Date,
): CoverLetterDocumentModel {
  const name = documentName(facts);
  return Object.freeze({
    release: APPLICATION_DOCUMENT_MODEL_RELEASE,
    name,
    contact: documentContact(facts),
    dateLine: formatLetterDate(date),
    recipientLines: Object.freeze([`${context.job.employerName} hiring team`, `Re: ${displayRoleTitle(context.job.title)}`]),
    salutation: `Dear ${shortEmployerName(context.job.employerName)} team,`,
    paragraphs: Object.freeze(proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text)),
    closing: context.voice?.signOff?.replace(/,?\s*$/u, ",") ?? "Sincerely,",
    signature: name,
  });
}

/** "Senior PM (AI Data Platform), Remote" -> "Senior PM (AI Data Platform)" for letter headers. */
export function displayRoleTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[,\-–|/]\s*(?:remote|hybrid|on-?site)(?:\s*[-–(]?\s*(?:us|usa|united states|u\.s\.|canada|amer|emea|apac)\)?)?\s*$/iu, "")
    .replace(/\s*\((?:remote|hybrid|on-?site)[^)]*\)\s*$/iu, "")
    .trim();
  return cleaned.length >= 3 ? cleaned : title;
}

export function positionForSegment(context: DraftingContextV2, positionKey: string | null): CareerPosition | null {
  return positionKey ? positionForKey(context.career, positionKey) ?? null : null;
}

export { resumePlainText, coverLetterPlainText };

/** Short employer name for allow-lists ("Palantir Technologies" -> "Palantir"). */
export function shortEmployerNameForLint(employer: string): string {
  return shortEmployerName(employer);
}
