import { APPLICATION_WRITING_POLICY_RELEASE } from "./application-input-snapshot.ts";
import type { ApplicationDraftingWritingPolicy } from "./application-drafting.ts";

export type ApplicationWritingPolicyProvenance = Readonly<{
  release: string;
  sha256: string;
  documents: readonly Readonly<{ name: string; sha256: string }>[];
}>;

export type ApplicationWritingPolicyBundle = Readonly<{
  provenance: ApplicationWritingPolicyProvenance;
  instructions: string;
}>;

/**
 * RoleDawn-owned writing policy. This is intentionally a compact product
 * contract, not a redistributed third-party editing prompt.
 */
export const ROLEDAWN_APPLICATION_WRITING_POLICY = Object.freeze({
  policyRelease: APPLICATION_WRITING_POLICY_RELEASE,
  prohibitedPhrases: Object.freeze([
    "cutting-edge",
    "delve",
    "dream role",
    "elevate",
    "ever-evolving",
    "game changer",
    "harness",
    "I am thrilled to apply",
    "leverage",
    "paradigm shift",
    "passionate about leveraging",
    "robust",
    "streamline",
    "supercharge",
    "transformative",
    "unique intersection",
    "utilize",
  ]),
  maxResumeWords: 850,
  minCoverLetterWords: 120,
  maxCoverLetterWords: 300,
  minCoverLetterParagraphs: 3,
  maxCoverLetterParagraphs: 5,
  minCandidateEvidenceClaimsInCoverLetter: 1,
  minRoleContextClaimsInCoverLetter: 1,
  minCandidateEvidenceClaimsInTailoredResume: 1,
}) satisfies ApplicationDraftingWritingPolicy;
