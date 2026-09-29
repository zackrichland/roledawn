import "server-only";

import type { ResumeConfirmation } from "@/components/profile/ResumePanel";
import type { CandidateEvidenceWorkspaceView } from "@/domain/candidate-evidence";
import type { CareerVaultViewModel } from "@/domain/career-vault";
import type { AuthenticatedActor } from "@/server/auth/session";
import { getCandidateKnowledge, type CandidateKnowledge } from "@/server/candidate/knowledge";
import { getCandidateEvidenceWorkspace } from "@/server/vault/candidate-evidence";
import { CareerVaultError, getCareerVault } from "@/server/vault/career-vault";

/** The résumé, whether its lines are approved, and whether roles are organized. */
export async function loadResumeState(actor: AuthenticatedActor): Promise<Readonly<{
  vault: CareerVaultViewModel;
  confirmation: ResumeConfirmation | null;
}>> {
  let vault: CareerVaultViewModel;
  try {
    vault = await getCareerVault(actor);
  } catch (error) {
    vault = {
      actorLabel: actor.email?.split("@")[0] ?? "You",
      status: "error",
      recoveryKind: null,
      document: null,
      deletionTarget: null,
      errorMessage: error instanceof CareerVaultError ? error.message : "Your résumé couldn't be loaded. Reload to try again.",
    };
  }
  if (vault.status !== "ready") return { vault, confirmation: null };
  const [evidence, knowledge] = await Promise.all([
    getCandidateEvidenceWorkspace(actor).catch(() => null),
    getCandidateKnowledge(actor).catch(() => null),
  ]);
  return { vault, confirmation: resumeConfirmation(evidence, knowledge) };
}

export function resumeConfirmation(
  evidence: CandidateEvidenceWorkspaceView | null,
  knowledge: CandidateKnowledge | null,
): ResumeConfirmation | null {
  if (!evidence || evidence.status !== "READY") return null;
  const career = knowledge?.career;
  return {
    approvedLines: evidence.counts.approved,
    linesAwaitingReview: evidence.counts.needsReview,
    careerProfile: career?.extractionStatus === "REQUESTED"
      ? "ORGANIZING"
      : career?.profile
        ? "READY"
        : career?.extractionStatus === "FAILED" ? "FAILED" : "MISSING",
  };
}

/** Every line reviewed, at least one approved, and roles organized (or organizing). */
export function isResumeConfirmed(confirmation: ResumeConfirmation | null): boolean {
  return confirmation !== null && confirmation.approvedLines > 0 &&
    confirmation.linesAwaitingReview === 0 && confirmation.careerProfile !== "MISSING";
}
