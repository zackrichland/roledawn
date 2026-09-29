"use server";

import { revalidatePath } from "next/cache";

import type { StoryDisposition, StoryUsagePolicy } from "@/domain/candidate-stories";
import { getOptionalActor } from "@/server/auth/session";
import { sendInterviewMessage, startInterview, type InterviewStoryProposal } from "@/server/candidate/interview";
import {
  approveReviewedResumeEvidence,
  archiveStory,
  CandidateKnowledgeError,
  getCandidateKnowledge,
  requestCareerProfile,
  saveCareerProfile,
  saveStory,
  saveVoiceProfile,
} from "@/server/candidate/knowledge";
import { CandidateEvidenceError, getCandidateEvidenceWorkspace } from "@/server/vault/candidate-evidence";
import { CareerVaultError, reviewResumeText } from "@/server/vault/career-vault";

export type KnowledgeActionResult = Readonly<{ ok: true; message?: string } | { ok: false; message: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SESSION_ENDED = "Your session ended. Reload the page and sign in again.";

function failure(error: unknown, fallback: string): KnowledgeActionResult {
  if (error instanceof CandidateKnowledgeError || error instanceof CareerVaultError || error instanceof CandidateEvidenceError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof Error && /ValidationError$/u.test(error.name)) return { ok: false, message: error.message };
  return { ok: false, message: fallback };
}

function revalidateProfile() {
  for (const path of ["/vault", "/vault/experience", "/vault/stories", "/vault/interview", "/vault/facts", "/dashboard", "/onboarding"]) {
    revalidatePath(path);
  }
}

/**
 * "Looks right — use this résumé": saves the reviewed text when needed, turns
 * every passage into approved evidence, and organizes the work history. One
 * press replaces reviewing each line; any line can still be hidden later.
 */
export async function confirmResumeAction(input: Readonly<{
  documentId: string;
  extractionId: string;
  expectedAggregateVersion: number;
  reviewedText: string;
  saveText: boolean;
  approveCommandId: string;
  profileCommandId: string;
}>): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  if (![input.documentId, input.extractionId, input.approveCommandId, input.profileCommandId].every((id) => UUID.test(id)) ||
      !Number.isSafeInteger(input.expectedAggregateVersion) || input.expectedAggregateVersion < 1) {
    return { ok: false, message: "Reload the page and try again." };
  }
  if (input.saveText && !input.reviewedText.trim()) return { ok: false, message: "The résumé text can't be empty." };
  try {
    if (input.saveText) {
      await reviewResumeText(actor, {
        documentId: input.documentId,
        extractionId: input.extractionId,
        expectedAggregateVersion: input.expectedAggregateVersion,
        reviewedText: input.reviewedText,
      });
    }
    const workspace = await getCandidateEvidenceWorkspace(actor);
    if (workspace.status !== "READY" || !workspace.textReviewId) {
      return { ok: false, message: "Your résumé text isn't saved yet. Try again in a moment." };
    }
    const approval = await approveReviewedResumeEvidence(actor, {
      commandId: input.approveCommandId,
      textReviewId: workspace.textReviewId,
    });
    const knowledge = await getCandidateKnowledge(actor);
    // A new text version re-organizes the history; unchanged text keeps edits.
    if (input.saveText || !knowledge.career.profile) {
      await requestCareerProfile(actor, input.profileCommandId);
    }
    revalidateProfile();
    const lines = approval.approved + approval.carried;
    return { ok: true, message: `${lines} ${lines === 1 ? "line" : "lines"} from your résumé are ready to use.` };
  } catch (error) {
    return failure(error, "Your résumé couldn't be confirmed. Try again.");
  }
}

export async function requestCareerProfileAction(commandId: string): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  try {
    await requestCareerProfile(actor, commandId);
    revalidateProfile();
    return { ok: true };
  } catch (error) {
    return failure(error, "RoleDawn couldn't start organizing your experience. Try again.");
  }
}

export async function saveCareerProfileAction(input: Readonly<{
  commandId: string;
  content: unknown;
  expectedAggregateVersion: number | null;
}>): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  try {
    await saveCareerProfile(actor, input);
    revalidateProfile();
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error, "Your changes couldn't be saved. Try again.");
  }
}

export async function saveStoryAction(input: Readonly<{
  commandId: string;
  storyId: string | null;
  expectedAggregateVersion: number | null;
  draft: unknown;
  disposition: StoryDisposition;
  usagePolicy: StoryUsagePolicy;
}>): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  if (input.storyId !== null && !UUID.test(input.storyId)) return { ok: false, message: "Reload the page and try again." };
  try {
    await saveStory(actor, {
      commandId: input.commandId,
      storyId: input.storyId,
      expectedAggregateVersion: input.expectedAggregateVersion,
      draft: input.draft,
      disposition: input.disposition,
      usagePolicy: input.usagePolicy,
      sourceKind: "CANDIDATE_ENTRY",
    });
    revalidateProfile();
    return { ok: true, message: input.disposition === "APPROVED" ? "Saved. RoleDawn can use this story." : "Saved." };
  } catch (error) {
    return failure(error, "The story couldn't be saved. Try again.");
  }
}

/** Approve or set aside a story exactly as written, without editing it. */
export async function setStoryDispositionAction(input: Readonly<{
  commandId: string;
  storyId: string;
  expectedAggregateVersion: number;
  disposition: StoryDisposition;
  usagePolicy: StoryUsagePolicy;
}>): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  if (!UUID.test(input.storyId)) return { ok: false, message: "Reload the page and try again." };
  try {
    const knowledge = await getCandidateKnowledge(actor);
    const story = knowledge.stories.find((entry) => entry.storyId === input.storyId);
    if (!story) return { ok: false, message: "That story is gone. Reload the page." };
    await saveStory(actor, {
      commandId: input.commandId,
      storyId: story.storyId,
      expectedAggregateVersion: input.expectedAggregateVersion,
      draft: story.draft,
      disposition: input.disposition,
      usagePolicy: input.usagePolicy,
      sourceKind: story.sourceKind,
    });
    revalidateProfile();
    return { ok: true };
  } catch (error) {
    return failure(error, "That change didn't save. Try again.");
  }
}

export async function archiveStoryAction(input: Readonly<{
  commandId: string;
  storyId: string;
  expectedAggregateVersion: number;
}>): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  try {
    await archiveStory(actor, input);
    revalidateProfile();
    return { ok: true, message: "Story removed." };
  } catch (error) {
    return failure(error, "The story couldn't be removed. Try again.");
  }
}

export async function saveVoiceAction(input: Readonly<{
  commandId: string;
  content: unknown;
  expectedAggregateVersion: number | null;
}>): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  try {
    await saveVoiceProfile(actor, input);
    revalidateProfile();
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error, "Your writing preferences couldn't be saved. Try again.");
  }
}

export async function startInterviewAction(commandId: string): Promise<KnowledgeActionResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  try {
    await startInterview(actor, commandId);
    revalidatePath("/vault/interview");
    return { ok: true };
  } catch (error) {
    return failure(error, "The interview couldn't start. Try again.");
  }
}

export type InterviewReplyResult =
  | Readonly<{ ok: true; reply: string; complete: boolean; proposal: InterviewStoryProposal | null }>
  | Readonly<{ ok: false; message: string }>;

export async function sendInterviewMessageAction(input: Readonly<{
  commandId: string;
  storyCommandId: string;
  voiceCommandId: string;
  sessionId: string;
  expectedTurnCount: number;
  message: string;
  wantsToStop?: boolean;
}>): Promise<InterviewReplyResult> {
  const actor = await getOptionalActor();
  if (!actor) return { ok: false, message: SESSION_ENDED };
  try {
    const result = await sendInterviewMessage(actor, input);
    revalidatePath("/vault/stories");
    revalidatePath("/dashboard");
    return { ok: true, ...result };
  } catch (error) {
    const failed = failure(error, "The interviewer didn't respond. Your answer is still here; send it again.");
    return { ok: false, message: failed.ok ? "Try again." : failed.message };
  }
}
