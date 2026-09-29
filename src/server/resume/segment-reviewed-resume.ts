import { createHash } from "node:crypto";

import type {
  ResumeEvidenceCategory,
  ResumeEvidenceProposal,
} from "../../domain/candidate-evidence.ts";

export const RESUME_EVIDENCE_SEGMENTER_RELEASE = "resume-passages/2";
export const MAX_RESUME_EVIDENCE_PASSAGES = 250;
export const MAX_RESUME_EVIDENCE_PASSAGE_CHARACTERS = 4_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SECTION_HEADINGS: ReadonlyArray<Readonly<{
  category: ResumeEvidenceCategory;
  pattern: RegExp;
}>> = Object.freeze([
  { category: "EXPERIENCE", pattern: /^(?:professional |relevant |work )?(?:experience|employment|work history)$/i },
  { category: "PROJECT", pattern: /^(?:selected |technical |personal )?projects?$/i },
  { category: "ACHIEVEMENT", pattern: /^(?:selected )?(?:achievements?|awards?|honors?)$/i },
  { category: "SKILL", pattern: /^(?:technical |core )?(?:skills?|competencies|technologies|toolkit)$/i },
  { category: "EDUCATION", pattern: /^(?:education|academic background|coursework)$/i },
  { category: "SUMMARY", pattern: /^(?:professional )?(?:summary|profile|objective|about)$/i },
]);

type SourceLine = Readonly<{
  start: number;
  end: number;
  text: string;
}>;

type PassageSpan = Readonly<{
  start: number;
  end: number;
  category: ResumeEvidenceCategory;
}>;

export class ResumeEvidenceSegmentationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ResumeEvidenceSegmentationError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceLines(codePoints: readonly string[]): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let cursor = 0; cursor <= codePoints.length; cursor += 1) {
    if (cursor < codePoints.length && codePoints[cursor] !== "\n") continue;
    let end = cursor;
    if (end > start && codePoints[end - 1] === "\r") end -= 1;
    lines.push(Object.freeze({ start, end, text: codePoints.slice(start, end).join("") }));
    start = cursor + 1;
  }
  return lines;
}

function sectionCategory(line: string): ResumeEvidenceCategory | null {
  const candidate = line.trim().replace(/[:|]+$/u, "").trim();
  for (const heading of SECTION_HEADINGS) {
    if (heading.pattern.test(candidate)) return heading.category;
  }
  return null;
}

function looksLikeHeading(line: string): boolean {
  const candidate = line.trim();
  if (!candidate || Array.from(candidate).length > 60) return false;
  if (sectionCategory(candidate)) return true;
  if (/[.!?]$/u.test(candidate)) return false;
  const letters = Array.from(candidate).filter((character) => /[A-Za-z]/u.test(character));
  if (letters.length < 3) return false;
  const uppercase = letters.filter((character) => character === character.toUpperCase()).length;
  const wordCount = candidate.split(/\s+/u).length;
  return wordCount <= 7 && uppercase / letters.length >= 0.82;
}

function isBullet(line: string): boolean {
  return /^\s*(?:[•◦▪●*-]|\d{1,2}[.)])\s+/u.test(line);
}

function looksLikeRoleHeading(line: string): boolean {
  const candidate = line.trim();
  if (!candidate.includes("|")) return false;
  return /\b(?:19|20)\d{2}\b|\b(?:present|current)\b/iu.test(candidate);
}

function trimSpan(codePoints: readonly string[], start: number, end: number): Readonly<{ start: number; end: number }> | null {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(codePoints[trimmedStart] ?? "")) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/u.test(codePoints[trimmedEnd - 1] ?? "")) trimmedEnd -= 1;
  return trimmedEnd > trimmedStart ? Object.freeze({ start: trimmedStart, end: trimmedEnd }) : null;
}

function splitSpan(
  codePoints: readonly string[],
  span: PassageSpan,
): PassageSpan[] {
  const result: PassageSpan[] = [];
  let cursor = span.start;
  while (cursor < span.end) {
    const hardEnd = Math.min(cursor + MAX_RESUME_EVIDENCE_PASSAGE_CHARACTERS, span.end);
    let end = hardEnd;
    if (hardEnd < span.end) {
      const preferredFloor = cursor + Math.floor(MAX_RESUME_EVIDENCE_PASSAGE_CHARACTERS * 0.72);
      for (let candidate = hardEnd; candidate > preferredFloor; candidate -= 1) {
        if (/\s/u.test(codePoints[candidate - 1] ?? "")) {
          end = candidate;
          break;
        }
      }
    }
    const trimmed = trimSpan(codePoints, cursor, end);
    if (trimmed) result.push(Object.freeze({ ...trimmed, category: span.category }));
    cursor = end;
  }
  return result;
}

function semanticSpans(codePoints: readonly string[]): PassageSpan[] {
  const lines = sourceLines(codePoints);
  const spans: PassageSpan[] = [];
  let category: ResumeEvidenceCategory = "OTHER";
  let sawSectionHeading = false;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  const flush = () => {
    if (currentStart === null || currentEnd === null) return;
    const trimmed = trimSpan(codePoints, currentStart, currentEnd);
    if (trimmed) spans.push(Object.freeze({ ...trimmed, category }));
    currentStart = null;
    currentEnd = null;
  };

  for (const line of lines) {
    if (!line.text.trim()) {
      flush();
      continue;
    }
    const headingCategory = sectionCategory(line.text);
    if (headingCategory) {
      flush();
      category = headingCategory;
      sawSectionHeading = true;
      continue;
    }
    // Contact details and identity belong in exact candidate facts, never in
    // narrative evidence. If a resume has no recognizable section headings,
    // the bounded exact fallback below still makes the document reviewable.
    if (!sawSectionHeading) continue;
    if (looksLikeRoleHeading(line.text)) {
      flush();
      currentStart = line.start;
      currentEnd = line.end;
      continue;
    }
    if (looksLikeHeading(line.text)) {
      flush();
      continue;
    }
    if (isBullet(line.text)) {
      flush();
      currentStart = line.start;
      currentEnd = line.end;
      continue;
    }
    if (currentStart === null) {
      currentStart = line.start;
    }
    // A physical PDF line following a bullet or role heading is continuation
    // text until the next semantic boundary. Keeping one contiguous span
    // preserves exact source offsets while avoiding fragmentary claims.
    currentEnd = line.end;
  }
  flush();
  return spans.flatMap((span) => splitSpan(codePoints, span));
}

function safeFallbackSpans(codePoints: readonly string[]): PassageSpan[] {
  const trimmed = trimSpan(codePoints, 0, codePoints.length);
  if (!trimmed) return [];
  return splitSpan(codePoints, Object.freeze({ ...trimmed, category: "OTHER" }));
}

/**
 * Segments the exact reviewed text. Offsets are zero-based, end-exclusive
 * Unicode code-point offsets, matching PostgreSQL `substring` character units.
 */
export function segmentReviewedResume(
  textReviewId: string,
  reviewedText: string,
): readonly ResumeEvidenceProposal[] {
  if (!UUID_PATTERN.test(textReviewId)) {
    throw new ResumeEvidenceSegmentationError(
      "RESUME_EVIDENCE_REVIEW_ID_INVALID",
      "The reviewed résumé reference is invalid.",
    );
  }
  const codePoints = Array.from(reviewedText);
  if (codePoints.length === 0 || codePoints.length > 200_000 || !reviewedText.trim()) {
    throw new ResumeEvidenceSegmentationError(
      "RESUME_EVIDENCE_TEXT_INVALID",
      "Reviewed résumé text must contain between 1 and 200,000 characters.",
    );
  }

  let spans = semanticSpans(codePoints);
  if (spans.length === 0 || spans.length > MAX_RESUME_EVIDENCE_PASSAGES) {
    spans = safeFallbackSpans(codePoints);
  }
  if (spans.length === 0 || spans.length > MAX_RESUME_EVIDENCE_PASSAGES) {
    throw new ResumeEvidenceSegmentationError(
      "RESUME_EVIDENCE_PASSAGE_LIMIT_EXCEEDED",
      "This résumé cannot be split into a safe number of evidence passages.",
    );
  }

  return Object.freeze(spans.map((span, ordinal) => {
    const excerpt = codePoints.slice(span.start, span.end).join("");
    const excerptSha256 = sha256(excerpt);
    return Object.freeze({
      stableKey: sha256(`${textReviewId}\n${span.start}\n${span.end}\n${excerptSha256}`),
      ordinal,
      category: span.category,
      startOffset: span.start,
      endOffset: span.end,
      excerpt,
      excerptSha256,
    });
  }));
}
