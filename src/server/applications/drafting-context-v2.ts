import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DraftingContextV2, DraftingEvidence, DraftingStory, DraftingUsage } from "../../domain/application-drafting-v2.ts";
import { hashProfileDocument, parseCareerProfileContent } from "../../domain/career-profile.ts";
import { parseVoiceProfileContent } from "../../domain/voice-profile.ts";
import type { Database } from "../../lib/supabase/database.types.ts";
import { loadApplicationDraftingContext, type ApplicationDraftingContextLocator } from "./drafting-context.ts";
import { createSupabaseDraftingContextReader } from "./supabase-drafting-context-reader.ts";

export class DraftingContextV2Error extends Error {
  readonly retryable: boolean;
  constructor(code: string, retryable = false) {
    super(code);
    this.name = "DraftingContextV2Error";
    this.retryable = retryable;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function firstSentence(text: string): string {
  return (text.replace(/\s+/gu, " ").trim().split(/(?<=[.!?])\s/u)[0] ?? "").slice(0, 280);
}

/**
 * Loads everything the v2 writer may use for one READY snapshot. Every
 * candidate input is read by exact version and verified against the hash the
 * snapshot froze; nothing "current" can slip in.
 */
export async function loadDraftingContextV2(
  supabase: SupabaseClient<Database>,
  locator: ApplicationDraftingContextLocator,
): Promise<DraftingContextV2> {
  const base = await loadApplicationDraftingContext(createSupabaseDraftingContextReader(supabase), locator);
  const scope = { workspaceId: base.application.workspaceId, candidateId: base.application.candidateId };
  const profile = base.profileContext;
  if (!profile?.career_profile_version_id || !profile.career_profile_sha256) {
    throw new DraftingContextV2Error("DRAFTING_CAREER_PROFILE_MISSING");
  }

  // Evidence keys and categories locate each passage in the career profile.
  const evidenceIds = base.approvedNarrativeEvidence.map((evidence) => evidence.evidenceVersionId);
  const { data: evidenceVersions, error: evidenceError } = evidenceIds.length
    ? await supabase.from("candidate_evidence_versions").select("id, evidence_item_id").in("id", evidenceIds)
    : { data: [], error: null };
  if (evidenceError) throw new DraftingContextV2Error("DRAFTING_EVIDENCE_READ_FAILED", true);
  const itemIds = [...new Set((evidenceVersions ?? []).map((version) => version.evidence_item_id))];
  const { data: items, error: itemError } = itemIds.length
    ? await supabase.from("candidate_evidence_items").select("id, evidence_key, evidence_category")
      .eq("workspace_id", scope.workspaceId).eq("candidate_id", scope.candidateId).in("id", itemIds)
    : { data: [], error: null };
  if (itemError) throw new DraftingContextV2Error("DRAFTING_EVIDENCE_READ_FAILED", true);
  const itemByVersion = new Map((evidenceVersions ?? []).map((version) => [version.id, (items ?? []).find((item) => item.id === version.evidence_item_id)] as const));
  const evidence: DraftingEvidence[] = base.approvedNarrativeEvidence.flatMap((entry) => {
    const item = itemByVersion.get(entry.evidenceVersionId);
    if (!item) return [];
    return [Object.freeze({
      evidenceVersionId: entry.evidenceVersionId,
      evidenceKey: item.evidence_key,
      documentId: entry.documentId,
      category: item.evidence_category,
      text: entry.claimText.replace(/[ \t]*\n[ \t]*/gu, " ").replace(/\s+/gu, " ").trim(),
      claimSha256: entry.claimSha256,
      usage: entry.usagePolicy,
    })];
  });

  const documentVersionIds = [profile.career_profile_version_id, profile.voice_profile_version_id].filter((id): id is string => Boolean(id));
  const { data: documents, error: documentError } = await supabase.from("candidate_profile_document_versions")
    .select("id, kind, content, content_sha256")
    .eq("workspace_id", scope.workspaceId).eq("candidate_id", scope.candidateId).in("id", documentVersionIds);
  if (documentError) throw new DraftingContextV2Error("DRAFTING_PROFILE_READ_FAILED", true);
  const careerRow = (documents ?? []).find((row) => row.id === profile.career_profile_version_id && row.kind === "CAREER_PROFILE");
  if (!careerRow || careerRow.content_sha256 !== profile.career_profile_sha256) throw new DraftingContextV2Error("DRAFTING_CAREER_PROFILE_MISMATCH");
  const career = parseCareerProfileContent(careerRow.content);
  if (hashProfileDocument(career) !== profile.career_profile_sha256) throw new DraftingContextV2Error("DRAFTING_CAREER_PROFILE_MISMATCH");

  let voice = null;
  if (profile.voice_profile_version_id) {
    const voiceRow = (documents ?? []).find((row) => row.id === profile.voice_profile_version_id && row.kind === "VOICE_PROFILE");
    if (!voiceRow || voiceRow.content_sha256 !== profile.voice_profile_sha256) throw new DraftingContextV2Error("DRAFTING_VOICE_PROFILE_MISMATCH");
    voice = parseVoiceProfileContent(voiceRow.content);
  }

  const storyIds = profile.stories.map((story) => story.story_version_id);
  const { data: storyRows, error: storyError } = storyIds.length
    ? await supabase.from("candidate_story_versions")
      .select("id, position_key, title, story_text, story_sha256, candidate_disposition, usage_policy")
      .eq("workspace_id", scope.workspaceId).eq("candidate_id", scope.candidateId).in("id", storyIds)
    : { data: [], error: null };
  if (storyError) throw new DraftingContextV2Error("DRAFTING_STORY_READ_FAILED", true);
  const stories: DraftingStory[] = profile.stories.map((reference) => {
    const row = (storyRows ?? []).find((story) => story.id === reference.story_version_id);
    if (!row || row.candidate_disposition !== "APPROVED" || row.story_sha256 !== reference.story_sha256
      || sha256(row.story_text) !== reference.story_sha256 || row.usage_policy !== reference.usage_policy) {
      throw new DraftingContextV2Error("DRAFTING_STORY_MISMATCH");
    }
    return Object.freeze({
      storyVersionId: row.id,
      storySha256: row.story_sha256,
      positionKey: row.position_key,
      title: row.title,
      text: row.story_text,
      usage: reference.usage_policy as DraftingUsage,
    });
  });

  // Recent openings keep letters from repeating their hook across applications.
  const { data: recent } = await supabase.from("application_revisions")
    .select("packet_manifest, application_id, created_at")
    .eq("workspace_id", scope.workspaceId)
    .neq("application_id", base.application.applicationId)
    .order("created_at", { ascending: false })
    .limit(10);
  const recentOpenings = (recent ?? []).flatMap((row) => {
    const manifest = row.packet_manifest as { drafting?: { proposal?: { coverLetter?: { paragraphs?: { text?: unknown }[] } } } } | null;
    const text = manifest?.drafting?.proposal?.coverLetter?.paragraphs?.[0]?.text;
    return typeof text === "string" && text.trim() ? [firstSentence(text)] : [];
  });

  const { data: search } = await supabase.from("candidate_search_profiles").select("target_roles")
    .eq("workspace_id", scope.workspaceId).eq("candidate_id", scope.candidateId).maybeSingle();

  return Object.freeze({
    binding: Object.freeze({
      workspaceId: scope.workspaceId,
      candidateId: scope.candidateId,
      applicationId: base.application.applicationId,
      inputSnapshotId: base.source.inputSnapshotId,
      snapshotHash: base.source.snapshotHash,
      capturedAt: base.source.capturedAt,
      jobId: base.job.jobId,
      jobVersionId: base.job.jobVersionId,
      jobContentSha256: base.job.contentSha256,
      resumeReviewedTextSha256: base.sourceResume.reviewedTextSha256,
    }),
    job: Object.freeze({
      employerName: base.job.employerName,
      title: base.job.title,
      description: base.job.description,
      location: base.job.location,
      employmentType: base.job.employmentType,
      workMode: base.job.workMode,
      applyUrl: base.job.applyUrl,
    }),
    tailoringMode: base.policy.tailoringMode,
    career,
    careerVersionId: profile.career_profile_version_id,
    evidence: Object.freeze(evidence),
    stories: Object.freeze(stories),
    voice,
    voiceVersionId: profile.voice_profile_version_id,
    recentOpenings: Object.freeze(recentOpenings),
    targetRoles: Object.freeze(search?.target_roles ?? []),
  });
}

export { firstSentence as openingSentence };
