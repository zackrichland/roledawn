export const RESUME_EVIDENCE_CATEGORIES = [
  "EXPERIENCE",
  "PROJECT",
  "ACHIEVEMENT",
  "SKILL",
  "EDUCATION",
  "SUMMARY",
  "OTHER",
] as const;

export const CANDIDATE_EVIDENCE_USAGE_POLICIES = [
  "RESUME_AND_COVER_LETTER",
  "COVER_LETTER_ONLY",
  "DO_NOT_USE",
] as const;

export type ResumeEvidenceCategory = (typeof RESUME_EVIDENCE_CATEGORIES)[number];
export type CandidateEvidenceUsagePolicy = (typeof CANDIDATE_EVIDENCE_USAGE_POLICIES)[number];
export type CandidateEvidenceDisposition = "PROPOSED" | "APPROVED" | "REJECTED";
export type CandidateEvidenceReviewStatus = "NEEDS_REVIEW" | "VERIFIED" | "REJECTED";
export type CandidateEvidenceReviewKind = "PROPOSAL" | "EXACT_PASSAGE" | "CANDIDATE_EDIT";

export type ResumeEvidenceProposal = Readonly<{
  stableKey: string;
  ordinal: number;
  category: ResumeEvidenceCategory;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  excerptSha256: string;
}>;

export type CandidateEvidenceItemView = Readonly<{
  evidenceItemId: string;
  evidenceVersionId: string;
  sourcePassageId: string;
  evidenceKey: string;
  category: ResumeEvidenceCategory;
  categoryLabel: string;
  sourceExcerpt: string;
  claimText: string;
  reviewStatus: CandidateEvidenceReviewStatus;
  disposition: CandidateEvidenceDisposition;
  usagePolicy: CandidateEvidenceUsagePolicy;
  aggregateVersion: number;
  versionNumber: number;
  reviewKind: CandidateEvidenceReviewKind;
  candidateAttested: boolean;
}>;

export type CandidateEvidenceWorkspaceStatus =
  | "NO_RESUME"
  | "RESUME_NEEDS_REVIEW"
  | "READY";

export type CandidateEvidenceWorkspaceView = Readonly<{
  status: CandidateEvidenceWorkspaceStatus;
  resumeName: string | null;
  textReviewId: string | null;
  textReviewVersion: number | null;
  items: readonly CandidateEvidenceItemView[];
  counts: Readonly<{
    total: number;
    needsReview: number;
    approved: number;
    restricted: number;
    rejected: number;
  }>;
}>;

export type CandidateEvidenceReviewActionState = Readonly<{
  outcome: "idle" | "success" | "error";
  message: string;
}>;

export type CandidateEvidenceReviewFormAction = (
  previousState: CandidateEvidenceReviewActionState,
  formData: FormData,
) => Promise<CandidateEvidenceReviewActionState>;

export const EMPTY_CANDIDATE_EVIDENCE_REVIEW_ACTION_STATE: CandidateEvidenceReviewActionState =
  Object.freeze({ outcome: "idle", message: "" });

const CATEGORY_LABELS: Readonly<Record<ResumeEvidenceCategory, string>> = Object.freeze({
  EXPERIENCE: "Experience",
  PROJECT: "Project",
  ACHIEVEMENT: "Achievement",
  SKILL: "Skill",
  EDUCATION: "Education",
  SUMMARY: "Summary",
  OTHER: "Other",
});

export function isResumeEvidenceCategory(value: string): value is ResumeEvidenceCategory {
  return (RESUME_EVIDENCE_CATEGORIES as readonly string[]).includes(value);
}

export function isCandidateEvidenceUsagePolicy(
  value: string,
): value is CandidateEvidenceUsagePolicy {
  return (CANDIDATE_EVIDENCE_USAGE_POLICIES as readonly string[]).includes(value);
}

export function candidateEvidenceCategoryLabel(category: ResumeEvidenceCategory): string {
  return CATEGORY_LABELS[category];
}
