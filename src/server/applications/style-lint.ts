import {
  proposalSegments,
  shortEmployerNameForLint,
  type DraftingContextV2,
  type DraftingIssue,
  type DraftingProposalV2,
  type DraftingSource,
} from "../../domain/application-drafting-v2.ts";
import { lintApplicationWriting, type WritingLintIssue } from "../../domain/writing-lint.ts";

/**
 * Runs the owned no-slop linter over the candidate-facing text of one draft
 * and maps each finding onto the segment it came from.
 */
export function lintApplicationStyle(input: Readonly<{ proposal: DraftingProposalV2; context: DraftingContextV2 }>): readonly DraftingIssue[] {
  const { proposal, context } = input;
  const bulletSegments = proposalSegments(proposal).filter((segment) => segment.surface === "RESUME_BULLET");
  const currentPositions = new Set(context.career.positions.filter((position) => position.current).map((position) => position.positionKey));
  const report = lintApplicationWriting({
    coverLetterParagraphs: proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text),
    resumeSummary: proposal.resume.summary?.text ?? null,
    resumeBullets: bulletSegments.map((segment) => ({ text: segment.text, current: segment.positionKey !== null && currentPositions.has(segment.positionKey) })),
    answers: proposal.answers.map((answer) => answer.text),
    candidateBannedPhrases: context.voice?.avoidPhrases ?? [],
    recentOpenings: context.recentOpenings,
    allowTerms: [
      context.job.employerName,
      shortEmployerNameForLint(context.job.employerName),
      context.job.title,
      ...context.career.positions.flatMap((position) => [position.organization, position.title]),
      ...context.career.skills.flatMap((group) => group.items),
    ],
  });
  const segmentFor = (issue: WritingLintIssue): string | null => {
    switch (issue.surface) {
      case "COVER_LETTER": return `letter.${issue.index + 1}`;
      case "RESUME_SUMMARY": return "resume.summary";
      case "RESUME_BULLET": return bulletSegments[issue.index]?.segmentId ?? null;
      case "ANSWER": return proposal.answers[issue.index] ? `answer.${proposal.answers[issue.index]!.kind}` : null;
    }
  };
  return Object.freeze(report.issues.map((issue) => Object.freeze({
    code: issue.code,
    severity: issue.severity,
    segmentId: segmentFor(issue),
    message: `${issue.message}${issue.excerpt ? ` (“${issue.excerpt}”)` : ""}`,
    fix: issue.fix,
  })));
}

/**
 * AS_UPLOADED keeps the candidate's own words: every approved passage under
 * its role, in résumé order, with no rewriting.
 */
export function withResumeAsWritten(
  context: DraftingContextV2,
  proposal: DraftingProposalV2,
  sources: ReadonlyMap<string, DraftingSource>,
): DraftingProposalV2 {
  const bulletText = (text: string) => text.replace(/^[\s•*\-–]+/u, "").replace(/\s+/gu, " ").trim();
  const positions = context.career.positions.map((position) => {
    const headingLike = (text: string) => text.includes(position.organization) && text.includes(position.title);
    const bullets = [...sources.values()]
      .filter((source) => source.kind === "RESUME_EVIDENCE" && source.positionKey === position.positionKey
        && source.usage === "RESUME_AND_COVER_LETTER" && !headingLike(source.text))
      .map((source) => Object.freeze({ text: bulletText(source.text), sourceIds: Object.freeze([source.sourceId]) }))
      .filter((bullet) => bullet.text.length > 0);
    return Object.freeze({ positionKey: position.positionKey, bullets: Object.freeze(bullets) });
  });
  return Object.freeze({
    ...proposal,
    resume: Object.freeze({
      headline: null,
      summary: null,
      positions: Object.freeze(positions),
      skills: Object.freeze(context.career.skills.map((group) => Object.freeze({ label: group.label, items: Object.freeze([...group.items]) }))),
    }),
  });
}
