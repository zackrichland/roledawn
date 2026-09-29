import "server-only";

import { displayCareerRange } from "@/domain/career-profile";
import { storyReadback, type StoryDraft } from "@/domain/candidate-stories";
import {
  groundStoryDraft,
  INTERVIEWER_INSTRUCTIONS,
  INTERVIEWER_OUTPUT_SCHEMA,
  INTERVIEWER_RELEASE,
  interviewerInput,
  openingInterviewMessage,
  parseInterviewerOutput,
  parseInterviewState,
  type InterviewContext,
  type InterviewState,
  type InterviewTurn,
} from "@/domain/interview";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { modelFor } from "@/server/ai/models";
import { structuredResponse, StructuredResponseError } from "@/server/ai/structured-response";
import { CandidateKnowledgeError, getCandidateKnowledge, saveStory, saveVoiceProfile } from "@/server/candidate/knowledge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type InterviewView = Readonly<{
  sessionId: string;
  status: "ACTIVE" | "COMPLETED" | "ABANDONED";
  turnCount: number;
  state: InterviewState;
  turns: readonly InterviewTurn[];
}>;

export type InterviewStoryProposal = Readonly<{
  storyId: string;
  aggregateVersion: number;
  draft: StoryDraft;
  readback: string;
}>;

function stableCode(error: { message?: string; code?: string } | null, fallback: string): string {
  return error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code ?? fallback;
}

function monthIndex(value: string | null): number | null {
  if (!value) return null;
  const [year, month] = value.split("-");
  return Number(year) * 12 + (month ? Number(month) - 1 : 6);
}

async function interviewContext(actor: AuthenticatedActor): Promise<InterviewContext> {
  const supabase = await createSupabaseServerClient();
  const [knowledge, nameFact, searchProfile] = await Promise.all([
    getCandidateKnowledge(actor),
    supabase.from("candidate_facts").select("id, current_version_number").eq("fact_key", "identity.given_name").maybeSingle(),
    supabase.from("candidate_search_profiles").select("target_roles").maybeSingle(),
  ]);
  let firstName: string | null = null;
  if (nameFact.data?.current_version_number) {
    const { data } = await supabase.from("candidate_fact_versions").select("normalized_text")
      .eq("fact_id", nameFact.data.id).eq("version_number", nameFact.data.current_version_number).maybeSingle();
    firstName = data?.normalized_text ?? null;
  }
  const positions = knowledge.career.profile?.content.positions ?? [];
  // Highlights come from the candidate's approved résumé passages for the role.
  const evidenceKeys = [...new Set(positions.flatMap((position) => position.evidenceKeys))];
  const highlightsByKey = new Map<string, string>();
  if (evidenceKeys.length > 0) {
    const { data: items } = await supabase.from("candidate_evidence_items")
      .select("id, evidence_key, current_version_number").in("evidence_key", evidenceKeys);
    const ids = (items ?? []).map((item) => item.id);
    if (ids.length) {
      const { data: versions } = await supabase.from("candidate_evidence_versions")
        .select("evidence_item_id, version_number, claim_text").in("evidence_item_id", ids);
      for (const item of items ?? []) {
        const version = (versions ?? []).find((row) => row.evidence_item_id === item.id && row.version_number === item.current_version_number);
        if (version) highlightsByKey.set(item.evidence_key, version.claim_text.replace(/\s+/gu, " ").replace(/^[•\-–]\s*/u, "").slice(0, 280));
      }
    }
  }
  const gaps: string[] = [];
  const dated = [...positions].filter((position) => position.startDate)
    .sort((left, right) => (monthIndex(left.startDate) ?? 0) - (monthIndex(right.startDate) ?? 0));
  for (let index = 1; index < dated.length; index += 1) {
    const previousEnd = dated.slice(0, index).reduce((latest, position) =>
      Math.max(latest, position.current ? Number.MAX_SAFE_INTEGER : monthIndex(position.endDate) ?? monthIndex(position.startDate) ?? 0), 0);
    const nextStart = monthIndex(dated[index].startDate) ?? 0;
    if (previousEnd !== Number.MAX_SAFE_INTEGER && nextStart - previousEnd > 6) {
      gaps.push(`Between ${dated[index - 1].organization} and ${dated[index].organization}`);
    }
  }
  return Object.freeze({
    candidateFirstName: firstName,
    positions: positions.map((position) => Object.freeze({
      positionKey: position.positionKey,
      title: position.title,
      organization: position.organization,
      dates: displayCareerRange(position.startDate, position.endDate, position.current),
      summary: position.summary,
      highlights: Object.freeze(position.evidenceKeys.map((key) => highlightsByKey.get(key)).filter((text): text is string => Boolean(text))),
    })),
    gaps: Object.freeze(gaps),
    existingStories: Object.freeze(knowledge.stories.map((story) => Object.freeze({
      title: story.draft.title, positionKey: story.draft.positionKey, approved: story.disposition === "APPROVED",
    }))),
    hasVoiceProfile: Boolean(knowledge.voice),
    targetRoles: Object.freeze(searchProfile.data?.target_roles ?? []),
  });
}

export async function getActiveInterview(): Promise<InterviewView | null> {
  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase.from("candidate_interview_sessions")
    .select("id, status, turn_count, state")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !session) return null;
  const { data: turns } = await supabase.from("candidate_interview_turns")
    .select("sequence_number, speaker, content, created_at")
    .eq("session_id", session.id).order("sequence_number", { ascending: true });
  return Object.freeze({
    sessionId: session.id,
    status: session.status as InterviewView["status"],
    turnCount: session.turn_count,
    state: parseInterviewState(session.state),
    turns: Object.freeze((turns ?? []).map((turn) => Object.freeze({
      sequenceNumber: turn.sequence_number,
      speaker: turn.speaker === "CANDIDATE" ? "CANDIDATE" as const : "INTERVIEWER" as const,
      content: turn.content,
      createdAt: turn.created_at,
    }))),
  });
}

export async function startInterview(actor: AuthenticatedActor, commandId: string): Promise<string> {
  if (!UUID.test(commandId)) throw new CandidateKnowledgeError("COMMAND_INVALID", "Reload and try again.");
  const opening = openingInterviewMessage(await interviewContext(actor));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_candidate_interview", {
    p_command_id: commandId,
    p_interviewer_release: INTERVIEWER_RELEASE,
    p_opening: opening.message,
    p_state: opening.state as unknown as Json,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new CandidateKnowledgeError(stableCode(error, "INTERVIEW_START_FAILED"), "The interview could not start. Try again.");
  return row.session_id;
}

export async function sendInterviewMessage(actor: AuthenticatedActor, input: Readonly<{
  commandId: string;
  storyCommandId: string;
  voiceCommandId: string;
  sessionId: string;
  expectedTurnCount: number;
  message: string;
  wantsToStop?: boolean;
}>): Promise<Readonly<{ reply: string; complete: boolean; proposal: InterviewStoryProposal | null }>> {
  for (const id of [input.commandId, input.storyCommandId, input.voiceCommandId, input.sessionId]) {
    if (!UUID.test(id)) throw new CandidateKnowledgeError("COMMAND_INVALID", "Reload and try again.");
  }
  const message = input.message.replace(/\r\n?/gu, "\n").trim().slice(0, 6000);
  if (!message) throw new CandidateKnowledgeError("INTERVIEW_MESSAGE_EMPTY", "Type an answer first.");
  const [view, context] = await Promise.all([getActiveInterview(), interviewContext(actor)]);
  if (!view || view.sessionId !== input.sessionId || view.status !== "ACTIVE") {
    throw new CandidateKnowledgeError("CANDIDATE_INTERVIEW_CLOSED", "This interview has ended. Start a new one to add more stories.");
  }
  if (view.turnCount !== input.expectedTurnCount) {
    throw new CandidateKnowledgeError("CANDIDATE_INTERVIEW_VERSION_MISMATCH", "The interview moved on in another tab. Reload to continue.");
  }

  let output;
  try {
    const result = await structuredResponse({
      model: modelFor("INTERVIEW"),
      instructions: INTERVIEWER_INSTRUCTIONS,
      input: interviewerInput({
        context,
        state: view.state,
        turns: view.turns,
        latestMessage: input.wantsToStop ? `${message}\n\n(The candidate pressed "Finish for now".)` : message,
      }),
      schemaName: "roledawn_interviewer_turn",
      schema: INTERVIEWER_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      reasoningEffort: "low",
      maxOutputTokens: 2_500,
      timeoutMs: 25_000,
    });
    output = parseInterviewerOutput(result.value, new Set(context.positions.map((position) => position.positionKey)));
  } catch (error) {
    const code = error instanceof StructuredResponseError ? error.code : "INTERVIEWER_FAILED";
    throw new CandidateKnowledgeError(code, "The interviewer did not respond. Your answer is still here; send it again.");
  }

  const candidateWords = [...view.turns.filter((turn) => turn.speaker === "CANDIDATE").map((turn) => turn.content), message].join("\n");
  let proposal: InterviewStoryProposal | null = null;
  if (output.storyDraft) {
    const draft = groundStoryDraft(output.storyDraft, candidateWords);
    const position = context.positions.find((entry) => entry.positionKey === draft.positionKey);
    const enriched: StoryDraft = Object.freeze({
      ...draft,
      organization: draft.organization ?? position?.organization ?? null,
      roleTitle: draft.roleTitle ?? position?.title ?? null,
      periodLabel: draft.periodLabel ?? position?.dates ?? null,
    });
    const saved = await saveStory(actor, {
      commandId: input.storyCommandId,
      storyId: null,
      expectedAggregateVersion: null,
      draft: enriched,
      disposition: "PROPOSED",
      usagePolicy: "RESUME_AND_COVER_LETTER",
      sourceKind: "INTERVIEW",
      interviewSessionId: input.sessionId,
    });
    proposal = Object.freeze({ storyId: saved.storyId, aggregateVersion: saved.aggregateVersion, draft: enriched, readback: storyReadback(enriched) });
  }

  if (output.voiceDraft) {
    const knowledge = await getCandidateKnowledge(actor);
    const current = knowledge.voice?.content;
    const merge = (left: readonly string[] = [], right: readonly string[] = []) =>
      [...new Map([...left, ...right].map((phrase) => [phrase.toLocaleLowerCase("en-US"), phrase])).values()].slice(0, 40);
    try {
      await saveVoiceProfile(actor, {
        commandId: input.voiceCommandId,
        expectedAggregateVersion: knowledge.voiceAggregateVersion,
        content: {
          schemaVersion: 1,
          selfDescription: output.voiceDraft.selfDescription ?? current?.selfDescription ?? null,
          writingSample: current?.writingSample ?? null,
          toneNotes: output.voiceDraft.toneNotes ?? current?.toneNotes ?? null,
          preferredPhrases: merge(current?.preferredPhrases, output.voiceDraft.preferredPhrases),
          avoidPhrases: merge(current?.avoidPhrases, output.voiceDraft.avoidPhrases),
          signOff: output.voiceDraft.signOff ?? current?.signOff ?? null,
        },
      });
    } catch {
      // Voice notes are a convenience; the transcript keeps their words.
    }
  }

  const complete = output.complete || Boolean(input.wantsToStop);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("append_candidate_interview_exchange", {
    p_command_id: input.commandId,
    p_session_id: input.sessionId,
    p_expected_turn_count: input.expectedTurnCount,
    p_candidate_message: message,
    p_interviewer_reply: output.reply,
    p_state: output.state as unknown as Json,
    p_complete: complete,
  });
  if (error) {
    throw new CandidateKnowledgeError(stableCode(error, "INTERVIEW_SAVE_FAILED"), "Your answer could not be saved. Reload and try again.");
  }
  return Object.freeze({ reply: output.reply, complete, proposal });
}
