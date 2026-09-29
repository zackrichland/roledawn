import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hashProfileDocument, parseCareerProfileContent, type CareerProfileContent } from "../../domain/career-profile.ts";
import type { Database, Json } from "../../lib/supabase/database.types.ts";
import { CAREER_PROFILE_PRODUCER_RELEASE, extractCareerProfile } from "../candidate/career-profile-extractor.ts";
import { StructuredResponseError } from "../ai/structured-response.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CareerProfileRequestPayload = Readonly<{
  workspaceId: string;
  candidateId: string;
  textReviewId: string;
}>;

export function parseCareerProfileRequestPayload(value: Json): CareerProfileRequestPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Json | undefined>;
  const workspaceId = record.workspace_id;
  const candidateId = record.candidate_id;
  const textReviewId = record.text_review_id;
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId)
    || typeof candidateId !== "string" || !UUID.test(candidateId)
    || typeof textReviewId !== "string" || !UUID.test(textReviewId)) return null;
  return { workspaceId, candidateId, textReviewId };
}

type UntypedRpc = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}>;

async function loadPreviousProfile(supabase: SupabaseClient<Database>, payload: CareerProfileRequestPayload): Promise<CareerProfileContent | null> {
  const { data: document } = await supabase.from("candidate_profile_documents")
    .select("current_version_id")
    .eq("workspace_id", payload.workspaceId).eq("candidate_id", payload.candidateId).eq("kind", "CAREER_PROFILE")
    .maybeSingle();
  if (!document?.current_version_id) return null;
  const { data: version } = await supabase.from("candidate_profile_document_versions")
    .select("content").eq("id", document.current_version_id).maybeSingle();
  if (!version) return null;
  try { return parseCareerProfileContent(version.content); } catch { return null; }
}

/** Handles one `candidate.career_profile_requested` outbox message. */
export async function handleCareerProfileRequested(
  supabase: SupabaseClient<Database>,
  payloadValue: Json,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<{ recorded: boolean }>> {
  const payload = parseCareerProfileRequestPayload(payloadValue);
  if (!payload) throw new Error("CAREER_PROFILE_PAYLOAD_INVALID");
  try {
    const { data: review, error: reviewError } = await supabase.from("source_document_text_reviews")
      .select("id, reviewed_text")
      .eq("workspace_id", payload.workspaceId).eq("candidate_id", payload.candidateId).eq("id", payload.textReviewId)
      .maybeSingle();
    if (reviewError) throw new Error("CAREER_PROFILE_REVIEW_READ_FAILED");
    if (!review) return { recorded: false };

    const { data: items, error: itemError } = await supabase.from("candidate_evidence_items")
      .select("id, evidence_key, evidence_category, current_version_number, review_status")
      .eq("workspace_id", payload.workspaceId).eq("candidate_id", payload.candidateId)
      .eq("text_review_id", payload.textReviewId);
    if (itemError) throw new Error("CAREER_PROFILE_EVIDENCE_READ_FAILED");
    const itemIds = (items ?? []).map((item) => item.id);
    const { data: versions, error: versionError } = itemIds.length
      ? await supabase.from("candidate_evidence_versions")
        .select("evidence_item_id, version_number, claim_text")
        .in("evidence_item_id", itemIds)
      : { data: [], error: null };
    if (versionError) throw new Error("CAREER_PROFILE_EVIDENCE_READ_FAILED");
    const textByItem = new Map<string, string>((versions ?? []).map((version) => [`${version.evidence_item_id}:${version.version_number}`, version.claim_text]));
    const evidence = (items ?? [])
      .filter((item) => item.review_status !== "REJECTED")
      .map((item) => ({
        key: item.evidence_key,
        category: item.evidence_category,
        text: textByItem.get(`${item.id}:${item.current_version_number}`) ?? "",
      }))
      .filter((item) => item.text);

    const extracted = await extractCareerProfile({
      resumeText: review.reviewed_text,
      evidence,
      previousProfile: await loadPreviousProfile(supabase, payload),
    }, { environment });
    const { error } = await (supabase as unknown as UntypedRpc).rpc("record_candidate_career_profile_extraction", {
      p_workspace_id: payload.workspaceId,
      p_candidate_id: payload.candidateId,
      p_text_review_id: payload.textReviewId,
      p_content: extracted.profile,
      p_content_sha256: hashProfileDocument(extracted.profile),
      p_producer_release: `${CAREER_PROFILE_PRODUCER_RELEASE}:${extracted.model}`.slice(0, 120),
      p_correlation_id: randomUUID(),
    });
    if (error) throw new Error(error.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? "CAREER_PROFILE_RECORD_FAILED");
    return { recorded: true };
  } catch (error) {
    const code = error instanceof StructuredResponseError ? error.code
      : error instanceof Error && /^[A-Z][A-Z0-9_]{3,119}$/u.test(error.message) ? error.message : "CAREER_PROFILE_EXTRACTION_FAILED";
    await (supabase as unknown as UntypedRpc).rpc("fail_candidate_career_profile_extraction", {
      p_workspace_id: payload.workspaceId,
      p_candidate_id: payload.candidateId,
      p_error_code: code,
    });
    throw new Error(code, { cause: error });
  }
}
