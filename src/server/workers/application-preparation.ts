import type { SupabaseClient } from "@supabase/supabase-js";

import {
  APPLICATION_INPUT_ASSEMBLER_RELEASE,
  APPLICATION_WRITING_POLICY_RELEASE,
  buildApplicationInputSnapshot,
  type ApplicationEvidenceReference,
  type ApplicationExactFactReference,
  type ApplicationProfileContextReference,
  type ApplicationResumeReference,
} from "../../domain/application-input-snapshot.ts";
import type { Database, Json } from "../../lib/supabase/database.types.ts";
import { handleCareerProfileRequested } from "./career-profile-worker.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ApplicationPreparationPayload = Readonly<{
  application_id: string;
  preparation_run_id: string;
}>;

type DatabaseError = Readonly<{ code?: string; message?: string }>;
type UntypedRpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: DatabaseError | null;
  }>;
}>;
type DatabaseRow = Record<string, unknown>;

type PreparationClaim = Readonly<{
  applicationId: string;
  preparationRunId: string;
  workspaceId: string;
  candidateId: string;
  jobId: string;
  jobVersionId: string;
  aggregateVersion: number;
  candidateInputVersion: number;
  tailoringMode: "AS_UPLOADED" | "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS";
  submissionMode: "DRAFT_ONLY" | "PER_APPLICATION_APPROVAL";
  replayed: boolean;
}>;

type EvidenceItemRow = Readonly<{
  id: string;
  text_review_id: string;
  current_version_number: number | null;
  review_status: string;
}>;

type EvidenceVersionRow = Readonly<{
  id: string;
  evidence_item_id: string;
  document_id: string;
  version_number: number;
  claim_sha256: string;
  usage_policy: string;
  candidate_disposition: string;
}>;

type FactRow = Readonly<{
  id: string;
  current_version_number: number | null;
  verification_status: string;
  usage_policy: string;
}>;

type FactVersionRow = Readonly<{
  id: string;
  fact_id: string;
  version_number: number;
  candidate_disposition: string;
}>;

function asUntyped(client: unknown): UntypedRpcClient {
  return client as UntypedRpcClient;
}

function firstRow(value: unknown): DatabaseRow | null {
  if (!Array.isArray(value)) return null;
  const candidate = value[0];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as DatabaseRow
    : null;
}

function requiredString(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("PREPARATION_CLAIM_PROTOCOL_INVALID");
  }
  return value;
}

function positiveInteger(row: DatabaseRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("PREPARATION_CLAIM_PROTOCOL_INVALID");
  }
  return value;
}

function databaseError(error: DatabaseError | null, fallback: string): never {
  const stableCode = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code;
  throw new Error(stableCode ?? fallback);
}

export function parseApplicationPreparationPayload(value: Json): ApplicationPreparationPayload | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const applicationId = value.application_id;
  const preparationRunId = value.preparation_run_id;
  if (
    typeof applicationId !== "string" || !UUID_PATTERN.test(applicationId) ||
    typeof preparationRunId !== "string" || !UUID_PATTERN.test(preparationRunId)
  ) return null;
  return { application_id: applicationId, preparation_run_id: preparationRunId };
}

function parseClaim(value: unknown): PreparationClaim {
  const claim = firstRow(value);
  if (!claim || typeof claim.replayed !== "boolean") {
    throw new Error("PREPARATION_CLAIM_PROTOCOL_INVALID");
  }
  const tailoringMode = claim.tailoring_mode;
  const submissionMode = claim.submission_mode;
  if (
    tailoringMode !== "AS_UPLOADED" &&
    tailoringMode !== "REORDER_AND_TIGHTEN" &&
    tailoringMode !== "REWRITE_FROM_VERIFIED_FACTS"
  ) throw new Error("PREPARATION_CLAIM_PROTOCOL_INVALID");
  if (submissionMode !== "DRAFT_ONLY" && submissionMode !== "PER_APPLICATION_APPROVAL") {
    throw new Error("PREPARATION_CLAIM_PROTOCOL_INVALID");
  }
  return {
    applicationId: requiredString(claim, "application_id"),
    preparationRunId: requiredString(claim, "preparation_run_id"),
    workspaceId: requiredString(claim, "workspace_id"),
    candidateId: requiredString(claim, "candidate_id"),
    jobId: requiredString(claim, "job_id"),
    jobVersionId: requiredString(claim, "job_version_id"),
    aggregateVersion: positiveInteger(claim, "aggregate_version"),
    candidateInputVersion: positiveInteger(claim, "candidate_input_version"),
    tailoringMode,
    submissionMode,
    replayed: claim.replayed,
  };
}

export function selectCurrentApprovedEvidence(
  items: readonly EvidenceItemRow[],
  versions: readonly EvidenceVersionRow[],
  textReviewId: string,
): readonly ApplicationEvidenceReference[] {
  const currentByItem = new Map(
    items
      .filter((item) => item.text_review_id === textReviewId && item.review_status === "VERIFIED")
      .map((item) => [item.id, item.current_version_number] as const),
  );
  return versions
    .filter((version) => (
      currentByItem.get(version.evidence_item_id) === version.version_number &&
      version.candidate_disposition === "APPROVED" &&
      (version.usage_policy === "RESUME_AND_COVER_LETTER" || version.usage_policy === "COVER_LETTER_ONLY")
    ))
    .map((version) => ({
      evidenceVersionId: version.id,
      documentId: version.document_id,
      claimSha256: version.claim_sha256,
      usagePolicy: version.usage_policy as ApplicationEvidenceReference["usagePolicy"],
    }));
}

export function selectCurrentApprovedFacts(
  facts: readonly FactRow[],
  versions: readonly FactVersionRow[],
): readonly ApplicationExactFactReference[] {
  const currentByFact = new Map(
    facts
      .filter((fact) => fact.verification_status === "VERIFIED" && fact.usage_policy === "EXACT_FIELDS")
      .map((fact) => [fact.id, fact.current_version_number] as const),
  );
  return versions
    .filter((version) => (
      currentByFact.get(version.fact_id) === version.version_number &&
      version.candidate_disposition === "APPROVED"
    ))
    .map((version) => ({
      factVersionId: version.id,
    }));
}

async function loadResumeReference(
  supabase: SupabaseClient<Database>,
  claim: PreparationClaim,
): Promise<Readonly<{
  state: "MISSING" | "NEEDS_REVIEW" | "READY";
  resume: ApplicationResumeReference | null;
  evidence: readonly ApplicationEvidenceReference[];
}>> {
  const { data: document, error: documentError } = await supabase
    .from("source_documents")
    .select("id, status, current_version_number")
    .eq("workspace_id", claim.workspaceId)
    .eq("candidate_id", claim.candidateId)
    .eq("document_kind", "RESUME")
    .neq("status", "DELETION_PENDING")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (documentError) databaseError(documentError, "PREPARATION_RESUME_READ_FAILED");
  if (!document) return { state: "MISSING", resume: null, evidence: [] };
  if (document.status !== "READY" || document.current_version_number === null) {
    return { state: "NEEDS_REVIEW", resume: null, evidence: [] };
  }

  const { data: version, error: versionError } = await supabase
    .from("source_document_versions")
    .select("id, sha256")
    .eq("workspace_id", claim.workspaceId)
    .eq("candidate_id", claim.candidateId)
    .eq("document_id", document.id)
    .eq("version_number", document.current_version_number)
    .maybeSingle();
  if (versionError) databaseError(versionError, "PREPARATION_RESUME_VERSION_READ_FAILED");
  if (!version) return { state: "NEEDS_REVIEW", resume: null, evidence: [] };

  const { data: review, error: reviewError } = await supabase
    .from("source_document_text_reviews")
    .select("id, document_version_id, text_sha256")
    .eq("workspace_id", claim.workspaceId)
    .eq("candidate_id", claim.candidateId)
    .eq("document_id", document.id)
    .eq("document_version_id", version.id)
    .order("review_version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reviewError) databaseError(reviewError, "PREPARATION_RESUME_REVIEW_READ_FAILED");
  if (!review) return { state: "NEEDS_REVIEW", resume: null, evidence: [] };

  const { data: items, error: itemError } = await supabase
    .from("candidate_evidence_items")
    .select("id, text_review_id, current_version_number, review_status")
    .eq("workspace_id", claim.workspaceId)
    .eq("candidate_id", claim.candidateId)
    .eq("document_id", document.id)
    .eq("text_review_id", review.id);
  if (itemError) databaseError(itemError, "PREPARATION_EVIDENCE_READ_FAILED");

  const itemIds = items.map((item) => item.id);
  const { data: versions, error: evidenceVersionError } = itemIds.length > 0
    ? await supabase
        .from("candidate_evidence_versions")
        .select("id, evidence_item_id, document_id, version_number, claim_sha256, usage_policy, candidate_disposition")
        .in("evidence_item_id", itemIds)
    : { data: [], error: null };
  if (evidenceVersionError) databaseError(evidenceVersionError, "PREPARATION_EVIDENCE_READ_FAILED");

  return {
    state: "READY",
    resume: {
      documentId: document.id,
      documentVersionId: version.id,
      textReviewId: review.id,
      sourceSha256: version.sha256,
      reviewedTextSha256: review.text_sha256,
    },
    evidence: selectCurrentApprovedEvidence(items, versions, review.id),
  };
}

async function loadExactFactReferences(
  supabase: SupabaseClient<Database>,
  claim: PreparationClaim,
): Promise<readonly ApplicationExactFactReference[]> {
  const { data: facts, error: factError } = await supabase
    .from("candidate_facts")
    .select("id, current_version_number, verification_status, usage_policy")
    .eq("workspace_id", claim.workspaceId)
    .eq("candidate_id", claim.candidateId)
    .eq("usage_policy", "EXACT_FIELDS");
  if (factError) databaseError(factError, "PREPARATION_FACT_READ_FAILED");
  const factIds = facts.map((fact) => fact.id);
  const { data: versions, error: versionError } = factIds.length > 0
    ? await supabase
        .from("candidate_fact_versions")
        .select("id, fact_id, version_number, candidate_disposition")
        .in("fact_id", factIds)
    : { data: [], error: null };
  if (versionError) databaseError(versionError, "PREPARATION_FACT_READ_FAILED");
  return selectCurrentApprovedFacts(facts, versions);
}

type ProfileVersionRow = Readonly<{ id: string; content_sha256: string; source_kind: string; source_text_review_id: string | null }>;

async function currentProfileVersion(
  supabase: SupabaseClient<Database>,
  claim: PreparationClaim,
  kind: "CAREER_PROFILE" | "VOICE_PROFILE",
): Promise<ProfileVersionRow | null> {
  const { data: document, error } = await supabase.from("candidate_profile_documents")
    .select("current_version_id")
    .eq("workspace_id", claim.workspaceId).eq("candidate_id", claim.candidateId).eq("kind", kind)
    .maybeSingle();
  if (error) databaseError(error, "PREPARATION_PROFILE_READ_FAILED");
  if (!document?.current_version_id) return null;
  const { data: version, error: versionError } = await supabase.from("candidate_profile_document_versions")
    .select("id, content_sha256, source_kind, source_text_review_id")
    .eq("id", document.current_version_id).maybeSingle();
  if (versionError) databaseError(versionError, "PREPARATION_PROFILE_READ_FAILED");
  return version ?? null;
}

/**
 * Career profile, approved stories, and voice profile for the snapshot. A
 * missing or stale extracted career profile is rebuilt from the reviewed
 * résumé here; a candidate-edited profile is always kept.
 */
async function loadProfileContext(
  supabase: SupabaseClient<Database>,
  claim: PreparationClaim,
  textReviewId: string,
  environment: NodeJS.ProcessEnv,
): Promise<Readonly<{ reference: ApplicationProfileContextReference; careerUnavailable: boolean }>> {
  let career = await currentProfileVersion(supabase, claim, "CAREER_PROFILE");
  const stale = career !== null && career.source_kind === "RESUME_EXTRACTION" && career.source_text_review_id !== textReviewId;
  if ((!career || stale) && environment.OPENAI_API_KEY?.trim()) {
    try {
      await handleCareerProfileRequested(supabase, {
        workspace_id: claim.workspaceId,
        candidate_id: claim.candidateId,
        text_review_id: textReviewId,
      }, environment);
      career = await currentProfileVersion(supabase, claim, "CAREER_PROFILE");
    } catch {
      // Recorded as FAILED on the profile document; the snapshot blocks below.
    }
  }
  const voice = await currentProfileVersion(supabase, claim, "VOICE_PROFILE");

  const { data: stories, error: storyError } = await supabase.from("candidate_stories")
    .select("id, current_version_number")
    .eq("workspace_id", claim.workspaceId).eq("candidate_id", claim.candidateId).eq("status", "ACTIVE");
  if (storyError) databaseError(storyError, "PREPARATION_STORY_READ_FAILED");
  const storyIds = (stories ?? []).map((story) => story.id);
  const { data: versions, error: versionError } = storyIds.length
    ? await supabase.from("candidate_story_versions")
      .select("id, story_id, version_number, story_sha256, candidate_disposition, usage_policy")
      .in("story_id", storyIds)
    : { data: [], error: null };
  if (versionError) databaseError(versionError, "PREPARATION_STORY_READ_FAILED");
  const currentByStory = new Map((stories ?? []).map((story) => [story.id, story.current_version_number] as const));
  const approved = (versions ?? []).filter((version) => currentByStory.get(version.story_id) === version.version_number
    && version.candidate_disposition === "APPROVED"
    && (version.usage_policy === "RESUME_AND_COVER_LETTER" || version.usage_policy === "COVER_LETTER_ONLY"));

  const usableCareer = career && (career.source_kind !== "RESUME_EXTRACTION" || career.source_text_review_id === textReviewId) ? career : null;
  return {
    reference: {
      careerProfileVersionId: usableCareer?.id ?? null,
      careerProfileSha256: usableCareer?.content_sha256 ?? null,
      voiceProfileVersionId: voice?.id ?? null,
      voiceProfileSha256: voice?.content_sha256 ?? null,
      stories: approved.map((version) => ({
        storyVersionId: version.id,
        storySha256: version.story_sha256,
        usagePolicy: version.usage_policy as "RESUME_AND_COVER_LETTER" | "COVER_LETTER_ONLY",
      })),
    },
    careerUnavailable: !usableCareer,
  };
}

export async function handleApplicationPreparationRequested(
  supabase: SupabaseClient<Database>,
  rawPayload: Json,
  workerId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const payload = parseApplicationPreparationPayload(rawPayload);
  if (!payload) throw new Error("PREPARATION_OUTBOX_PAYLOAD_INVALID");

  const claimed = await asUntyped(supabase).rpc("claim_application_preparation", {
    p_application_id: payload.application_id,
    p_preparation_run_id: payload.preparation_run_id,
    p_worker_id: workerId,
    p_lease_seconds: 120,
  });
  if (claimed.error) databaseError(claimed.error, "PREPARATION_CLAIM_FAILED");
  const claim = parseClaim(claimed.data);
  if (claim.applicationId !== payload.application_id || claim.preparationRunId !== payload.preparation_run_id) {
    throw new Error("PREPARATION_CLAIM_PROTOCOL_INVALID");
  }
  if (claim.replayed) return;

  const { data: jobVersion, error: jobVersionError } = await supabase
    .from("job_versions")
    .select("content_hash")
    .eq("id", claim.jobVersionId)
    .eq("job_id", claim.jobId)
    .maybeSingle();
  if (jobVersionError) databaseError(jobVersionError, "PREPARATION_JOB_READ_FAILED");
  if (!jobVersion) throw new Error("PREPARATION_JOB_VERSION_MISSING");

  const [resume, exactFacts] = await Promise.all([
    loadResumeReference(supabase, claim),
    loadExactFactReferences(supabase, claim),
  ]);
  const profile = resume.resume
    ? await loadProfileContext(supabase, claim, resume.resume.textReviewId, environment)
    : null;
  const snapshot = buildApplicationInputSnapshot({
    applicationId: claim.applicationId,
    candidateId: claim.candidateId,
    candidateInputVersion: claim.candidateInputVersion,
    jobId: claim.jobId,
    jobVersionId: claim.jobVersionId,
    jobContentSha256: jobVersion.content_hash,
    tailoringMode: claim.tailoringMode,
    submissionMode: claim.submissionMode,
    resumeState: resume.state,
    resume: resume.resume,
    narrativeEvidence: resume.evidence,
    exactFacts,
    profileContext: profile?.reference ?? null,
    careerProfileUnavailable: profile?.careerUnavailable ?? false,
  });

  const committed = await asUntyped(supabase).rpc("commit_application_input_snapshot", {
    p_application_id: claim.applicationId,
    p_preparation_run_id: claim.preparationRunId,
    p_worker_id: workerId,
    p_expected_aggregate_version: claim.aggregateVersion,
    p_expected_candidate_input_version: claim.candidateInputVersion,
    p_source_document_id: resume.resume?.documentId ?? null,
    p_source_document_version_id: resume.resume?.documentVersionId ?? null,
    p_source_text_review_id: resume.resume?.textReviewId ?? null,
    p_readiness: snapshot.readiness,
    p_blockers: snapshot.blockers as unknown as Json,
    p_snapshot_manifest: snapshot.manifest as unknown as Json,
    p_snapshot_hash: snapshot.snapshotHash,
    p_policy_release: APPLICATION_WRITING_POLICY_RELEASE,
    p_assembler_release: APPLICATION_INPUT_ASSEMBLER_RELEASE,
    p_evidence_version_ids: [...snapshot.evidenceVersionIds],
    p_fact_version_ids: [...snapshot.factVersionIds],
  });
  if (committed.error) databaseError(committed.error, "PREPARATION_SNAPSHOT_COMMIT_FAILED");
  if (!firstRow(committed.data)) throw new Error("PREPARATION_COMMIT_PROTOCOL_INVALID");
}
