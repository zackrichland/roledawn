import {
  proposalSegments,
  WRITING_BOUNDS,
  wordCount,
  type DraftingIssue,
  type DraftingProposalV2,
  type DraftingSource,
  type EmployerResearch,
} from "./application-drafting-v2.ts";

export const APPLICATION_QUALITY_EVALUATOR_RELEASE_V2 = "roledawn-application-quality-evaluator/2";

export type QualityIssueV2 = Readonly<{
  code: string;
  severity: "BLOCKING" | "WARNING";
  surface: "PACKET" | "RESEARCH" | "RESUME" | "COVER_LETTER" | "ANSWER";
  segmentId: string | null;
  message: string;
}>;

export type QualityReportV2 = Readonly<{
  evaluatorRelease: typeof APPLICATION_QUALITY_EVALUATOR_RELEASE_V2;
  policyRelease: string;
  status: "PASSED" | "PASSED_WITH_WARNINGS" | "BLOCKED";
  readyForCandidateReview: boolean;
  researchCoverage: EmployerResearch["coverage"];
  measurements: Readonly<{
    coverLetterWords: number;
    coverLetterParagraphs: number;
    resumeBullets: number;
    rolesWithBullets: number;
    storiesCited: number;
    resumePassagesCited: number;
    researchFactsCited: number;
    researchFacts: number;
    requirementsDirect: number;
    requirementsAdjacent: number;
    requirementsGap: number;
    attempts: number;
    droppedSegments: number;
  }>;
  issues: readonly QualityIssueV2[];
}>;

/** Truth failures in these segments are removed rather than shipped. */
export function isSalvageableSegment(segmentId: string): boolean {
  return segmentId.startsWith("resume.") || segmentId.startsWith("answer.");
}

/** Removes the named résumé segments and answers, and any unsupported skills. */
export function salvageProposal(
  proposal: DraftingProposalV2,
  failingSegmentIds: ReadonlySet<string>,
  unsupportedSkills: ReadonlySet<string>,
): DraftingProposalV2 {
  return Object.freeze({
    ...proposal,
    resume: Object.freeze({
      headline: failingSegmentIds.has("resume.headline") ? null : proposal.resume.headline,
      summary: failingSegmentIds.has("resume.summary") ? null : proposal.resume.summary,
      positions: Object.freeze(proposal.resume.positions.map((position) => Object.freeze({
        positionKey: position.positionKey,
        bullets: Object.freeze(position.bullets.filter((_, index) => !failingSegmentIds.has(`resume.${position.positionKey}.${index + 1}`))),
      }))),
      skills: Object.freeze(proposal.resume.skills
        .map((group) => Object.freeze({ label: group.label, items: Object.freeze(group.items.filter((item) => !unsupportedSkills.has(item))) }))
        .filter((group) => group.items.length > 0)),
    }),
    answers: Object.freeze(proposal.answers.filter((answer) => !failingSegmentIds.has(`answer.${answer.kind}`))),
  });
}

function surfaceFor(segmentId: string | null): QualityIssueV2["surface"] {
  if (!segmentId) return "PACKET";
  if (segmentId.startsWith("resume.")) return "RESUME";
  if (segmentId.startsWith("letter.")) return "COVER_LETTER";
  if (segmentId.startsWith("answer.")) return "ANSWER";
  return "PACKET";
}

export function evaluateApplicationQualityV2(input: Readonly<{
  policyRelease: string;
  proposal: DraftingProposalV2;
  sources: ReadonlyMap<string, DraftingSource>;
  research: EmployerResearch;
  /** Problems still present after the final attempt and salvage. */
  remainingDeterministic: readonly DraftingIssue[];
  remainingStyle: readonly DraftingIssue[];
  unsupportedLetterSegments: readonly string[];
  attempts: number;
  droppedSegments: number;
}>): QualityReportV2 {
  const issues: QualityIssueV2[] = [];
  const letterText = input.proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text).join(" ");
  const letterWords = wordCount(letterText);
  const segments = proposalSegments(input.proposal);
  const cited = new Set(segments.flatMap((segment) => segment.sourceIds));
  const citedOfKind = (kind: DraftingSource["kind"]) => [...cited].filter((id) => input.sources.get(id)?.kind === kind).length;
  const bullets = input.proposal.resume.positions.reduce((total, position) => total + position.bullets.length, 0);

  for (const segmentId of input.unsupportedLetterSegments) {
    issues.push(Object.freeze({ code: "LETTER_CLAIM_UNVERIFIED", severity: "BLOCKING", surface: "COVER_LETTER", segmentId,
      message: "A cover-letter paragraph still contains a statement its sources do not support." }));
  }
  for (const problem of input.remainingDeterministic) {
    const lengthOnly = problem.code === "LETTER_LENGTH" || problem.code === "BULLET_LENGTH" || problem.code === "SUMMARY_LENGTH"
      || problem.code === "HEADLINE_LENGTH" || problem.code === "ANSWER_LENGTH" || problem.code === "TOO_MANY_BULLETS";
    const hardLengthFailure = problem.code === "LETTER_LENGTH" && (letterWords < 150 || letterWords > 450);
    issues.push(Object.freeze({
      code: problem.code,
      severity: problem.severity === "WARNING" || (lengthOnly && !hardLengthFailure) ? "WARNING" : "BLOCKING",
      surface: surfaceFor(problem.segmentId),
      segmentId: problem.segmentId,
      message: problem.message,
    }));
  }
  for (const problem of input.remainingStyle) {
    issues.push(Object.freeze({
      code: problem.code,
      severity: problem.severity === "BLOCKING" ? "BLOCKING" : "WARNING",
      surface: surfaceFor(problem.segmentId),
      segmentId: problem.segmentId,
      message: problem.message,
    }));
  }
  if (input.research.coverage === "OFFICIAL_POSTING_ONLY") {
    issues.push(Object.freeze({ code: "RESEARCH_DEPTH_LIMITED", severity: "WARNING", surface: "RESEARCH", segmentId: null,
      message: "Company research found nothing reliable beyond the posting." }));
  }
  const gaps = input.proposal.strategy.topRequirements.filter((requirement) => requirement.coverage === "GAP");
  if (gaps.length > 0) {
    issues.push(Object.freeze({ code: "REQUIREMENT_GAPS", severity: "WARNING", surface: "PACKET", segmentId: null,
      message: `No evidence for: ${gaps.map((gap) => gap.requirement).join("; ").slice(0, 400)}` }));
  }
  if (input.droppedSegments > 0) {
    issues.push(Object.freeze({ code: "SEGMENTS_DROPPED", severity: "WARNING", surface: "RESUME", segmentId: null,
      message: `${input.droppedSegments} résumé line${input.droppedSegments === 1 ? "" : "s"} could not be verified and ${input.droppedSegments === 1 ? "was" : "were"} left out.` }));
  }
  if (bullets === 0 && input.proposal.resume.positions.length > 0) {
    issues.push(Object.freeze({ code: "RESUME_WITHOUT_BULLETS", severity: "WARNING", surface: "RESUME", segmentId: null,
      message: "The résumé lists roles without bullets." }));
  }
  const paragraphs = input.proposal.coverLetter.paragraphs.length;
  if (paragraphs < WRITING_BOUNDS.minParagraphs || paragraphs > WRITING_BOUNDS.maxParagraphs) {
    issues.push(Object.freeze({ code: "LETTER_PARAGRAPH_COUNT", severity: "WARNING", surface: "COVER_LETTER", segmentId: null,
      message: `The letter has ${paragraphs} paragraphs.` }));
  }

  const blocked = issues.some((entry) => entry.severity === "BLOCKING");
  return Object.freeze({
    evaluatorRelease: APPLICATION_QUALITY_EVALUATOR_RELEASE_V2,
    policyRelease: input.policyRelease,
    status: blocked ? "BLOCKED" : issues.length > 0 ? "PASSED_WITH_WARNINGS" : "PASSED",
    readyForCandidateReview: !blocked,
    researchCoverage: input.research.coverage,
    measurements: Object.freeze({
      coverLetterWords: letterWords,
      coverLetterParagraphs: paragraphs,
      resumeBullets: bullets,
      rolesWithBullets: input.proposal.resume.positions.filter((position) => position.bullets.length > 0).length,
      storiesCited: citedOfKind("STORY"),
      resumePassagesCited: citedOfKind("RESUME_EVIDENCE"),
      researchFactsCited: citedOfKind("COMPANY_RESEARCH"),
      researchFacts: input.research.facts.length,
      requirementsDirect: input.proposal.strategy.topRequirements.filter((requirement) => requirement.coverage === "DIRECT").length,
      requirementsAdjacent: input.proposal.strategy.topRequirements.filter((requirement) => requirement.coverage === "ADJACENT").length,
      requirementsGap: gaps.length,
      attempts: input.attempts,
      droppedSegments: input.droppedSegments,
    }),
    issues: Object.freeze(issues),
  });
}
