import "server-only";

import {
  hashProfileDocument,
  parseCareerProfileContent,
  sortPositionsNewestFirst,
  type CareerProfileContent,
} from "@/domain/career-profile";
import {
  parseStoryDraft,
  renderStoryText,
  type CandidateStoryView,
  type StoryDisposition,
  type StoryDraft,
  type StoryUsagePolicy,
} from "@/domain/candidate-stories";
import { parseVoiceProfileContent, type VoiceProfileContent } from "@/domain/voice-profile";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class CandidateKnowledgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CandidateKnowledgeError";
    this.code = code;
  }
}

export type ProfileDocumentView<T> = Readonly<{
  content: T;
  versionId: string;
  versionNumber: number;
  aggregateVersion: number;
  sourceKind: string;
  updatedAt: string;
}>;

export type CareerProfileState = Readonly<{
  profile: ProfileDocumentView<CareerProfileContent> | null;
  aggregateVersion: number | null;
  extractionStatus: "IDLE" | "REQUESTED" | "FAILED";
  extractionError: string | null;
}>;

export type CandidateKnowledge = Readonly<{
  career: CareerProfileState;
  voice: ProfileDocumentView<VoiceProfileContent> | null;
  voiceAggregateVersion: number | null;
  stories: readonly CandidateStoryView[];
}>;

function actorLabel(actor: AuthenticatedActor): string {
  return actor.email?.split("@")[0]?.trim().slice(0, 80) || "Signed-in candidate";
}

function stableCode(error: { message?: string; code?: string } | null, fallback: string): string {
  return error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code ?? fallback;
}

function friendly(code: string): string {
  switch (code) {
    case "CANDIDATE_PROFILE_DOCUMENT_VERSION_MISMATCH":
    case "CANDIDATE_STORY_VERSION_MISMATCH":
      return "This changed in another tab. Reload and try again.";
    case "RESUME_REVIEW_REQUIRED":
      return "Upload and confirm your résumé first.";
    case "EVIDENCE_REVIEW_STALE":
      return "Your résumé changed. Reload and confirm it again.";
    default:
      return "That could not be saved. Try again in a moment.";
  }
}

async function client(actor: AuthenticatedActor) {
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));
  return supabase;
}

function storyView(story: {
  id: string; status: string; aggregate_version: number; updated_at: string;
}, version: {
  id: string; version_number: number; title: string; position_key: string | null; organization: string | null;
  role_title: string | null; period_label: string | null; situation: string; task: string; action: string; result: string;
  metrics: Json; themes: string[]; guardrails: string | null; story_text: string; story_sha256: string;
  candidate_disposition: string; usage_policy: string; source_kind: string;
}): CandidateStoryView | null {
  let draft: StoryDraft;
  try {
    draft = parseStoryDraft({
      title: version.title, positionKey: version.position_key, organization: version.organization,
      roleTitle: version.role_title, periodLabel: version.period_label, situation: version.situation,
      task: version.task, action: version.action, result: version.result, metrics: version.metrics,
      themes: version.themes, guardrails: version.guardrails,
    });
  } catch {
    return null;
  }
  return Object.freeze({
    storyId: story.id,
    storyVersionId: version.id,
    aggregateVersion: story.aggregate_version,
    versionNumber: version.version_number,
    status: story.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    disposition: version.candidate_disposition as StoryDisposition,
    usagePolicy: version.usage_policy as StoryUsagePolicy,
    sourceKind: version.source_kind === "INTERVIEW" ? "INTERVIEW" : "CANDIDATE_ENTRY",
    draft,
    storyText: version.story_text,
    storySha256: version.story_sha256,
    updatedAt: story.updated_at,
  });
}

export async function getCandidateKnowledge(actor: AuthenticatedActor): Promise<CandidateKnowledge> {
  const supabase = await client(actor);
  const [documents, stories] = await Promise.all([
    supabase.from("candidate_profile_documents")
      .select("kind, current_version_id, aggregate_version, extraction_status, extraction_error, updated_at"),
    supabase.from("candidate_stories").select("id, status, current_version_number, aggregate_version, updated_at")
      .eq("status", "ACTIVE").order("updated_at", { ascending: false }).limit(100),
  ]);
  if (documents.error || stories.error) {
    throw new CandidateKnowledgeError("CANDIDATE_KNOWLEDGE_READ_FAILED", "Your profile could not be loaded.");
  }
  const versionIds = (documents.data ?? []).map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  const storyIds = (stories.data ?? []).map((row) => row.id);
  const [documentVersions, storyVersions] = await Promise.all([
    versionIds.length
      ? supabase.from("candidate_profile_document_versions")
        .select("id, kind, version_number, content, source_kind, created_at").in("id", versionIds)
      : Promise.resolve({ data: [], error: null }),
    storyIds.length
      ? supabase.from("candidate_story_versions")
        .select("id, story_id, version_number, title, position_key, organization, role_title, period_label, situation, task, action, result, metrics, themes, guardrails, story_text, story_sha256, candidate_disposition, usage_policy, source_kind")
        .in("story_id", storyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (documentVersions.error || storyVersions.error) {
    throw new CandidateKnowledgeError("CANDIDATE_KNOWLEDGE_READ_FAILED", "Your profile could not be loaded.");
  }
  const careerRow = (documents.data ?? []).find((row) => row.kind === "CAREER_PROFILE");
  const voiceRow = (documents.data ?? []).find((row) => row.kind === "VOICE_PROFILE");
  const versionById = new Map((documentVersions.data ?? []).map((row) => [row.id, row] as const));

  let career: ProfileDocumentView<CareerProfileContent> | null = null;
  const careerVersion = careerRow?.current_version_id ? versionById.get(careerRow.current_version_id) : undefined;
  if (careerRow && careerVersion) {
    try {
      const content = parseCareerProfileContent(careerVersion.content);
      career = Object.freeze({
        content: Object.freeze({ ...content, positions: sortPositionsNewestFirst(content.positions) }),
        versionId: careerVersion.id,
        versionNumber: careerVersion.version_number,
        aggregateVersion: careerRow.aggregate_version,
        sourceKind: careerVersion.source_kind,
        updatedAt: careerVersion.created_at,
      });
    } catch {
      career = null;
    }
  }
  let voice: ProfileDocumentView<VoiceProfileContent> | null = null;
  const voiceVersion = voiceRow?.current_version_id ? versionById.get(voiceRow.current_version_id) : undefined;
  if (voiceRow && voiceVersion) {
    try {
      voice = Object.freeze({
        content: parseVoiceProfileContent(voiceVersion.content),
        versionId: voiceVersion.id,
        versionNumber: voiceVersion.version_number,
        aggregateVersion: voiceRow.aggregate_version,
        sourceKind: voiceVersion.source_kind,
        updatedAt: voiceVersion.created_at,
      });
    } catch {
      voice = null;
    }
  }

  const latestVersionByStory = new Map<string, NonNullable<typeof storyVersions.data>[number]>();
  for (const version of storyVersions.data ?? []) {
    const story = (stories.data ?? []).find((row) => row.id === version.story_id);
    if (story && version.version_number === story.current_version_number) latestVersionByStory.set(version.story_id, version);
  }
  const storyViews = (stories.data ?? []).flatMap((story) => {
    const version = latestVersionByStory.get(story.id);
    const view = version ? storyView(story, version) : null;
    return view ? [view] : [];
  });

  return Object.freeze({
    career: Object.freeze({
      profile: career,
      aggregateVersion: careerRow?.aggregate_version ?? null,
      extractionStatus: (careerRow?.extraction_status as CareerProfileState["extractionStatus"]) ?? "IDLE",
      extractionError: careerRow?.extraction_error ?? null,
    }),
    voice,
    voiceAggregateVersion: voiceRow?.aggregate_version ?? null,
    stories: Object.freeze(storyViews),
  });
}

function assertCommand(commandId: string): void {
  if (!UUID.test(commandId)) throw new CandidateKnowledgeError("COMMAND_INVALID", "Reload and try again.");
}

export async function saveCareerProfile(actor: AuthenticatedActor, input: Readonly<{
  commandId: string; content: unknown; expectedAggregateVersion: number | null;
}>): Promise<void> {
  assertCommand(input.commandId);
  const content = parseCareerProfileContent(input.content);
  const supabase = await client(actor);
  const { error } = await supabase.rpc("save_candidate_profile_document", {
    p_command_id: input.commandId,
    p_kind: "CAREER_PROFILE",
    p_content: content as unknown as Json,
    p_content_sha256: hashProfileDocument(content),
    ...(input.expectedAggregateVersion ? { p_expected_aggregate_version: input.expectedAggregateVersion } : {}),
  });
  if (error) {
    const code = stableCode(error, "CAREER_PROFILE_SAVE_FAILED");
    throw new CandidateKnowledgeError(code, friendly(code));
  }
}

export async function saveVoiceProfile(actor: AuthenticatedActor, input: Readonly<{
  commandId: string; content: unknown; expectedAggregateVersion: number | null;
}>): Promise<void> {
  assertCommand(input.commandId);
  const content = parseVoiceProfileContent(input.content);
  const supabase = await client(actor);
  const { error } = await supabase.rpc("save_candidate_profile_document", {
    p_command_id: input.commandId,
    p_kind: "VOICE_PROFILE",
    p_content: content as unknown as Json,
    p_content_sha256: hashProfileDocument(content),
    ...(input.expectedAggregateVersion ? { p_expected_aggregate_version: input.expectedAggregateVersion } : {}),
  });
  if (error) {
    const code = stableCode(error, "VOICE_PROFILE_SAVE_FAILED");
    throw new CandidateKnowledgeError(code, friendly(code));
  }
}

export async function saveStory(actor: AuthenticatedActor, input: Readonly<{
  commandId: string;
  storyId: string | null;
  expectedAggregateVersion: number | null;
  draft: unknown;
  disposition: StoryDisposition;
  usagePolicy: StoryUsagePolicy;
  sourceKind: "INTERVIEW" | "CANDIDATE_ENTRY";
  interviewSessionId?: string | null;
}>): Promise<Readonly<{ storyId: string; aggregateVersion: number }>> {
  assertCommand(input.commandId);
  const draft = parseStoryDraft(input.draft);
  const usagePolicy = input.disposition === "REJECTED" ? "DO_NOT_USE" : input.usagePolicy;
  const supabase = await client(actor);
  const { data, error } = await supabase.rpc("save_candidate_story", {
    p_command_id: input.commandId,
    // Null creates a new story. Generated types mark every SQL parameter
    // without a default as non-null, so these two are asserted.
    p_story_id: input.storyId as string,
    p_expected_aggregate_version: (input.storyId ? input.expectedAggregateVersion : null) as number,
    p_story: { ...draft, storyText: renderStoryText(draft) } as unknown as Json,
    p_disposition: input.disposition,
    p_usage_policy: usagePolicy,
    p_source_kind: input.sourceKind,
    ...(input.interviewSessionId ? { p_interview_session_id: input.interviewSessionId } : {}),
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    const code = stableCode(error, "CANDIDATE_STORY_SAVE_FAILED");
    throw new CandidateKnowledgeError(code, friendly(code));
  }
  return Object.freeze({ storyId: row.story_id, aggregateVersion: row.aggregate_version });
}

export async function archiveStory(actor: AuthenticatedActor, input: Readonly<{
  commandId: string; storyId: string; expectedAggregateVersion: number;
}>): Promise<void> {
  assertCommand(input.commandId);
  const supabase = await client(actor);
  const { error } = await supabase.rpc("archive_candidate_story", {
    p_command_id: input.commandId,
    p_story_id: input.storyId,
    p_expected_aggregate_version: input.expectedAggregateVersion,
  });
  if (error) {
    const code = stableCode(error, "CANDIDATE_STORY_ARCHIVE_FAILED");
    throw new CandidateKnowledgeError(code, friendly(code));
  }
}

export async function requestCareerProfile(actor: AuthenticatedActor, commandId: string): Promise<void> {
  assertCommand(commandId);
  const supabase = await client(actor);
  const { error } = await supabase.rpc("request_candidate_career_profile", { p_command_id: commandId });
  if (error) {
    const code = stableCode(error, "CAREER_PROFILE_REQUEST_FAILED");
    throw new CandidateKnowledgeError(code, friendly(code));
  }
}

export async function approveReviewedResumeEvidence(actor: AuthenticatedActor, input: Readonly<{
  commandId: string; textReviewId: string;
}>): Promise<Readonly<{ approved: number; carried: number }>> {
  assertCommand(input.commandId);
  if (!UUID.test(input.textReviewId)) throw new CandidateKnowledgeError("EVIDENCE_REVIEW_INPUT_INVALID", "Reload and try again.");
  const supabase = await client(actor);
  const { data, error } = await supabase.rpc("approve_reviewed_resume_evidence", {
    p_command_id: input.commandId,
    p_text_review_id: input.textReviewId,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    const code = stableCode(error, "RESUME_EVIDENCE_APPROVAL_FAILED");
    throw new CandidateKnowledgeError(code, friendly(code));
  }
  return Object.freeze({ approved: row.approved_count, carried: row.carried_count });
}
