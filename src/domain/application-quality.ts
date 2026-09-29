import type { ApplicationSemanticValidationReport } from "./application-entailment.ts";
import type {
  ApplicationDraftingContext,
  ApplicationDraftingProposal,
  ApplicationDraftingValidationReport,
  ApplicationDraftingWritingPolicy,
} from "./application-drafting.ts";
import type { BuiltApplicationResearchBundle } from "./application-research.ts";

export const APPLICATION_QUALITY_EVALUATOR_RELEASE = "roledawn-application-quality-evaluator/1";

export type ApplicationQualityIssueCode =
  | "SOURCE_VALIDATION_INCOMPLETE"
  | "POLICY_BINDING_MISMATCH"
  | "COVER_LETTER_LENGTH_OUT_OF_RANGE"
  | "COVER_LETTER_PARAGRAPH_COUNT_OUT_OF_RANGE"
  | "COVER_LETTER_CANDIDATE_PROOF_MISSING"
  | "COVER_LETTER_ROLE_CONTEXT_MISSING"
  | "COVER_LETTER_TARGET_MISSING"
  | "TAILORED_RESUME_CANDIDATE_PROOF_MISSING"
  | "CANDIDATE_FACING_PLACEHOLDER"
  | "INTERNAL_METADATA_EXPOSED"
  | "RESEARCH_DEPTH_LIMITED"
  | "RESUME_SECTION_STRUCTURE_WEAK"
  | "CEREMONIAL_OPENING"
  | "RHETORICAL_QUESTION"
  | "EM_DASH_DENSITY"
  | "DUPLICATE_COVER_LETTER_PARAGRAPH";

export type ApplicationQualityIssue = Readonly<{
  code: ApplicationQualityIssueCode;
  severity: "BLOCKING" | "WARNING";
  surface: "PACKET" | "RESEARCH" | "RESUME" | "COVER_LETTER";
  message: string;
}>;

export type ApplicationQualityReport = Readonly<{
  evaluatorRelease: typeof APPLICATION_QUALITY_EVALUATOR_RELEASE;
  policyRelease: string;
  status: "PASSED" | "PASSED_WITH_WARNINGS" | "BLOCKED";
  readyForCandidateReview: boolean;
  researchCoverage: "OFFICIAL_POSTING_ONLY" | "MULTI_PRIMARY_SOURCE";
  measurements: Readonly<{
    coverLetterWords: number;
    coverLetterParagraphs: number;
    coverLetterCandidateEvidenceClaims: number;
    coverLetterRoleContextClaims: number;
    tailoredResumeCandidateEvidenceClaims: number;
    resumeRecognizedSections: number;
    researchSources: number;
  }>;
  issues: readonly ApplicationQualityIssue[];
}>;

const PLACEHOLDER_PATTERN = /(?:\{\{[^}]+\}\}|\[\s*(?:insert|todo|tbd|confirm)[^\]]*\]|\b(?:lorem ipsum|claim to confirm|claims to confirm)\b)/iu;
const INTERNAL_METADATA_PATTERN = /\b(?:evidenceVersionId|researchClaimId|inputSnapshotId|claimIds?|snapshotHash)\b/iu;
const CEREMONIAL_OPENING_PATTERN = /^\s*(?:dear\s+[^\n]+[,\n]\s*)?i\s+(?:am|'m)\s+(?:writing|excited|thrilled)\s+to\s+(?:apply|submit)\b/iu;
const RESUME_SECTION_PATTERN = /^\s*(?:profile|summary|experience|work experience|professional experience|skills|education|projects|certifications)\s*:?\s*$/gimu;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function wordCount(value: string): number {
  return value.trim().match(/\S+/gu)?.length ?? 0;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function issue(
  code: ApplicationQualityIssueCode,
  severity: ApplicationQualityIssue["severity"],
  surface: ApplicationQualityIssue["surface"],
  message: string,
): ApplicationQualityIssue {
  return Object.freeze({ code, severity, surface, message });
}

function referencedClaims(
  proposal: ApplicationDraftingProposal,
  claimIds: readonly string[],
): readonly ApplicationDraftingProposal["claims"][number][] {
  const byId = new Map(proposal.claims.map((claim) => [claim.claimId, claim] as const));
  return [...new Set(claimIds)].flatMap((claimId) => {
    const claim = byId.get(claimId);
    return claim ? [claim] : [];
  });
}

/**
 * Deterministic, product-owned readiness checks for one generated packet.
 * This evaluates the artifact proposal, not the candidate and not protected
 * traits. It intentionally does not pretend to replace a human quality review.
 */
export function evaluateApplicationQuality(input: Readonly<{
  context: ApplicationDraftingContext;
  research: BuiltApplicationResearchBundle;
  proposal: ApplicationDraftingProposal;
  writingPolicy: ApplicationDraftingWritingPolicy;
  deterministicValidation: ApplicationDraftingValidationReport;
  semanticValidation: ApplicationSemanticValidationReport;
}>): ApplicationQualityReport {
  const issues: ApplicationQualityIssue[] = [];
  const coverLetterText = input.proposal.coverLetter.paragraphs
    .map((paragraph) => paragraph.text)
    .join("\n\n");
  const resumeText = input.proposal.resume.text ?? "";
  const candidateFacingText = `${resumeText}\n${input.proposal.coverLetter.title}\n${coverLetterText}`;

  if (
    !input.deterministicValidation.deterministicChecksPassed ||
    !input.semanticValidation.semanticChecksPassed
  ) {
    issues.push(issue(
      "SOURCE_VALIDATION_INCOMPLETE",
      "BLOCKING",
      "PACKET",
      "Evidence and semantic validation must pass before quality review.",
    ));
  }
  if (input.writingPolicy.policyRelease !== input.context.policy.writingPolicyRelease) {
    issues.push(issue(
      "POLICY_BINDING_MISMATCH",
      "BLOCKING",
      "PACKET",
      "The quality evaluator must use the writing policy frozen by the input snapshot.",
    ));
  }

  const coverLetterWords = wordCount(coverLetterText);
  const coverLetterParagraphs = input.proposal.coverLetter.paragraphs.length;
  if (
    coverLetterWords < input.writingPolicy.minCoverLetterWords ||
    coverLetterWords > input.writingPolicy.maxCoverLetterWords
  ) {
    issues.push(issue(
      "COVER_LETTER_LENGTH_OUT_OF_RANGE",
      "BLOCKING",
      "COVER_LETTER",
      `The cover letter must contain ${input.writingPolicy.minCoverLetterWords}-${input.writingPolicy.maxCoverLetterWords} words.`,
    ));
  }
  if (
    coverLetterParagraphs < input.writingPolicy.minCoverLetterParagraphs ||
    coverLetterParagraphs > input.writingPolicy.maxCoverLetterParagraphs
  ) {
    issues.push(issue(
      "COVER_LETTER_PARAGRAPH_COUNT_OUT_OF_RANGE",
      "BLOCKING",
      "COVER_LETTER",
      `The cover letter must contain ${input.writingPolicy.minCoverLetterParagraphs}-${input.writingPolicy.maxCoverLetterParagraphs} connected paragraphs.`,
    ));
  }

  const coverClaimIds = input.proposal.coverLetter.paragraphs.flatMap((paragraph) => paragraph.claimIds);
  const coverClaims = referencedClaims(input.proposal, coverClaimIds);
  const coverCandidateClaims = coverClaims.filter((claim) => claim.claimType === "CANDIDATE_EVIDENCE");
  const coverRoleClaims = coverClaims.filter((claim) => (
    claim.claimType === "JOB_CONTEXT" || claim.claimType === "RESEARCH_CONTEXT"
  ));
  if (coverCandidateClaims.length < input.writingPolicy.minCandidateEvidenceClaimsInCoverLetter) {
    issues.push(issue(
      "COVER_LETTER_CANDIDATE_PROOF_MISSING",
      "BLOCKING",
      "COVER_LETTER",
      "The cover letter needs at least one cited candidate proof point.",
    ));
  }
  if (coverRoleClaims.length < input.writingPolicy.minRoleContextClaimsInCoverLetter) {
    issues.push(issue(
      "COVER_LETTER_ROLE_CONTEXT_MISSING",
      "BLOCKING",
      "COVER_LETTER",
      "The cover letter needs at least one cited job or research connection.",
    ));
  }

  const normalizedCoverLetter = normalized(coverLetterText);
  if (
    !normalizedCoverLetter.includes(normalized(input.context.job.employerName)) ||
    !normalizedCoverLetter.includes(normalized(input.context.job.title))
  ) {
    issues.push(issue(
      "COVER_LETTER_TARGET_MISSING",
      "BLOCKING",
      "COVER_LETTER",
      "The cover letter must name the bound employer and role.",
    ));
  }

  const resumeClaims = referencedClaims(input.proposal, input.proposal.resume.claimIds);
  const tailoredResumeCandidateClaims = resumeClaims.filter((claim) => claim.claimType === "CANDIDATE_EVIDENCE");
  if (
    input.proposal.resume.handling === "TAILOR_FROM_APPROVED_EVIDENCE" &&
    tailoredResumeCandidateClaims.length < input.writingPolicy.minCandidateEvidenceClaimsInTailoredResume
  ) {
    issues.push(issue(
      "TAILORED_RESUME_CANDIDATE_PROOF_MISSING",
      "BLOCKING",
      "RESUME",
      "A tailored résumé needs at least one cited candidate proof point.",
    ));
  }

  if (PLACEHOLDER_PATTERN.test(candidateFacingText)) {
    issues.push(issue(
      "CANDIDATE_FACING_PLACEHOLDER",
      "BLOCKING",
      "PACKET",
      "Candidate-facing documents contain unresolved placeholder text.",
    ));
  }
  if (INTERNAL_METADATA_PATTERN.test(candidateFacingText)) {
    issues.push(issue(
      "INTERNAL_METADATA_EXPOSED",
      "BLOCKING",
      "PACKET",
      "Candidate-facing documents expose internal workflow metadata.",
    ));
  }

  const sourceTypes = new Set(input.research.manifest.research.sources.map((source) => source.source_type));
  const researchCoverage = sourceTypes.size === 1 && sourceTypes.has("JOB_POSTING")
    ? "OFFICIAL_POSTING_ONLY" as const
    : "MULTI_PRIMARY_SOURCE" as const;
  if (researchCoverage === "OFFICIAL_POSTING_ONLY") {
    issues.push(issue(
      "RESEARCH_DEPTH_LIMITED",
      "WARNING",
      "RESEARCH",
      "Research is limited to the official posting; broader primary-source company research has not run.",
    ));
  }

  const resumeRecognizedSections = new Set(
    [...resumeText.matchAll(RESUME_SECTION_PATTERN)].map((match) => normalized(match[0])),
  ).size;
  if (
    input.proposal.resume.handling === "TAILOR_FROM_APPROVED_EVIDENCE" &&
    resumeRecognizedSections < 2
  ) {
    issues.push(issue(
      "RESUME_SECTION_STRUCTURE_WEAK",
      "WARNING",
      "RESUME",
      "The tailored résumé has fewer than two recognizable ATS section labels.",
    ));
  }

  if (CEREMONIAL_OPENING_PATTERN.test(coverLetterText)) {
    issues.push(issue(
      "CEREMONIAL_OPENING",
      "WARNING",
      "COVER_LETTER",
      "The opening spends space announcing the application instead of leading with relevant substance.",
    ));
  }
  if (coverLetterText.includes("?")) {
    issues.push(issue(
      "RHETORICAL_QUESTION",
      "WARNING",
      "COVER_LETTER",
      "The cover letter contains a question; confirm it adds useful information rather than manufactured drama.",
    ));
  }
  if ((coverLetterText.match(/—/gu)?.length ?? 0) > 2) {
    issues.push(issue(
      "EM_DASH_DENSITY",
      "WARNING",
      "COVER_LETTER",
      "The cover letter relies on em dashes often enough to flatten its cadence.",
    ));
  }
  const normalizedParagraphs = input.proposal.coverLetter.paragraphs.map((paragraph) => normalized(paragraph.text));
  if (new Set(normalizedParagraphs).size !== normalizedParagraphs.length) {
    issues.push(issue(
      "DUPLICATE_COVER_LETTER_PARAGRAPH",
      "WARNING",
      "COVER_LETTER",
      "The cover letter repeats a paragraph verbatim.",
    ));
  }

  const readyForCandidateReview = !issues.some((entry) => entry.severity === "BLOCKING");
  const status = !readyForCandidateReview
    ? "BLOCKED" as const
    : issues.length > 0
      ? "PASSED_WITH_WARNINGS" as const
      : "PASSED" as const;
  return deepFreeze({
    evaluatorRelease: APPLICATION_QUALITY_EVALUATOR_RELEASE,
    policyRelease: input.writingPolicy.policyRelease,
    status,
    readyForCandidateReview,
    researchCoverage,
    measurements: {
      coverLetterWords,
      coverLetterParagraphs,
      coverLetterCandidateEvidenceClaims: coverCandidateClaims.length,
      coverLetterRoleContextClaims: coverRoleClaims.length,
      tailoredResumeCandidateEvidenceClaims: tailoredResumeCandidateClaims.length,
      resumeRecognizedSections,
      researchSources: input.research.manifest.research.sources.length,
    },
    issues,
  }) as ApplicationQualityReport;
}
