import "server-only";

import { randomUUID } from "node:crypto";

import {
  candidateEvidenceCategoryLabel,
  isCandidateEvidenceUsagePolicy,
  isResumeEvidenceCategory,
  type CandidateEvidenceDisposition,
  type CandidateEvidenceItemView,
  type CandidateEvidenceReviewKind,
  type CandidateEvidenceReviewStatus,
  type CandidateEvidenceUsagePolicy,
  type CandidateEvidenceWorkspaceView,
  type ResumeEvidenceProposal,
} from "@/domain/candidate-evidence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  RESUME_EVIDENCE_SEGMENTER_RELEASE,
  segmentReviewedResume,
} from "@/server/resume/segment-reviewed-resume";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UntypedQueryResult = PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

type UntypedQuery = {
  select: (columns: string) => UntypedQuery;
  eq: (column: string, value: unknown) => UntypedQuery;
  in: (column: string, values: readonly unknown[]) => UntypedQuery;
  order: (column: string, options?: { ascending?: boolean }) => UntypedQuery;
  limit: (count: number) => UntypedQuery;
  maybeSingle: () => UntypedQueryResult;
} & UntypedQueryResult;

type UntypedSupabase = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
  from: (name: string) => UntypedQuery;
};

type DatabaseRow = Record<string, unknown>;

export type CandidateEvidenceReviewCommand = Readonly<{
  commandId: string;
  evidenceItemId: string;
  expectedAggregateVersion: number;
  disposition: Exclude<CandidateEvidenceDisposition, "PROPOSED">;
  claimText: string;
  usagePolicy: CandidateEvidenceUsagePolicy;
  candidateAttested: boolean;
}>;

export class CandidateEvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CandidateEvidenceError";
  }
}

function asUntyped(client: unknown): UntypedSupabase {
  return client as UntypedSupabase;
}

function actorLabel(actor: AuthenticatedActor): string {
  return actor.email?.split("@")[0]?.trim().slice(0, 80) || "Signed-in candidate";
}

function rows(value: unknown): DatabaseRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is DatabaseRow => Boolean(row) && typeof row === "object")
    : [];
}

function row(value: unknown): DatabaseRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DatabaseRow
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function databaseError(
  error: { code?: string; message?: string } | null,
  fallbackCode: string,
  fallbackMessage: string,
): never {
  const serverCode = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code;
  switch (serverCode) {
    case "CANDIDATE_EVIDENCE_VERSION_MISMATCH":
      throw new CandidateEvidenceError(serverCode, "This evidence changed in another tab. Reload before saving.");
    case "CANDIDATE_EVIDENCE_ATTESTATION_REQUIRED":
      throw new CandidateEvidenceError(serverCode, "Confirm that your edited wording is accurate before saving.");
    case "EVIDENCE_REVIEW_STALE":
      throw new CandidateEvidenceError(serverCode, "Your résumé changed. Reload this page to review the latest version.");
    case "REJECTED_EVIDENCE_MUST_NOT_BE_USED":
      throw new CandidateEvidenceError(serverCode, "Rejected evidence must stay unavailable to drafts.");
    case "COMMAND_ID_PAYLOAD_MISMATCH":
      throw new CandidateEvidenceError(serverCode, "This request no longer matches. Reload and try again.");
    default:
      throw new CandidateEvidenceError(serverCode ?? fallbackCode, fallbackMessage);
  }
}

function passagePayload(proposal: ResumeEvidenceProposal): Record<string, unknown> {
  return {
    stable_key: proposal.stableKey,
    ordinal: proposal.ordinal,
    category: proposal.category,
    start_offset: proposal.startOffset,
    end_offset: proposal.endOffset,
    excerpt: proposal.excerpt,
    excerpt_sha256: proposal.excerptSha256,
  };
}

async function loadPassages(
  supabase: UntypedSupabase,
  textReviewId: string,
): Promise<DatabaseRow[]> {
  const result = await supabase
    .from("source_evidence_passages")
    .select("id, text_review_id, stable_key, ordinal, evidence_category, start_offset, end_offset, excerpt, excerpt_sha256, segmenter_release")
    .eq("text_review_id", textReviewId)
    .order("ordinal", { ascending: true });
  if (result.error) {
    databaseError(result.error, "CANDIDATE_EVIDENCE_READ_FAILED", "Résumé evidence could not be loaded.");
  }
  return rows(result.data);
}

async function ensurePassages(
  supabase: UntypedSupabase,
  textReviewId: string,
  reviewedText: string,
): Promise<DatabaseRow[]> {
  const existing = await loadPassages(supabase, textReviewId);
  if (existing.length > 0) return existing;

  const proposals = segmentReviewedResume(textReviewId, reviewedText);
  const result = await supabase.rpc("ingest_resume_evidence_proposals", {
    p_command_id: randomUUID(),
    p_text_review_id: textReviewId,
    p_segmenter_release: RESUME_EVIDENCE_SEGMENTER_RELEASE,
    p_passages: proposals.map(passagePayload),
  });
  if (result.error) {
    databaseError(result.error, "CANDIDATE_EVIDENCE_INGEST_FAILED", "Résumé evidence could not be prepared.");
  }
  return loadPassages(supabase, textReviewId);
}

function isReviewStatus(value: unknown): value is CandidateEvidenceReviewStatus {
  return value === "NEEDS_REVIEW" || value === "VERIFIED" || value === "REJECTED";
}

function isDisposition(value: unknown): value is CandidateEvidenceDisposition {
  return value === "PROPOSED" || value === "APPROVED" || value === "REJECTED";
}

function isReviewKind(value: unknown): value is CandidateEvidenceReviewKind {
  return value === "PROPOSAL" || value === "EXACT_PASSAGE" || value === "CANDIDATE_EDIT";
}

function emptyView(
  status: CandidateEvidenceWorkspaceView["status"],
  resumeName: string | null,
): CandidateEvidenceWorkspaceView {
  return Object.freeze({
    status,
    resumeName,
    textReviewId: null,
    textReviewVersion: null,
    items: Object.freeze([]),
    counts: Object.freeze({ total: 0, needsReview: 0, approved: 0, restricted: 0, rejected: 0 }),
  });
}

export async function getCandidateEvidenceWorkspace(
  actor: AuthenticatedActor,
): Promise<CandidateEvidenceWorkspaceView> {
  const typedClient = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(typedClient, actor, actorLabel(actor));
  const supabase = asUntyped(typedClient);

  const documentResult = await supabase
    .from("source_documents")
    .select("id, display_name, status")
    .eq("document_kind", "RESUME")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (documentResult.error) {
    databaseError(documentResult.error, "CANDIDATE_EVIDENCE_READ_FAILED", "Résumé evidence could not be loaded.");
  }
  const document = row(documentResult.data);
  if (!document) return emptyView("NO_RESUME", null);
  const documentId = stringValue(document.id);
  const resumeName = stringValue(document.display_name);
  if (!documentId) {
    throw new CandidateEvidenceError("CANDIDATE_EVIDENCE_PROTOCOL_INVALID", "Résumé evidence returned an incomplete source.");
  }
  if (document.status !== "READY") return emptyView("RESUME_NEEDS_REVIEW", resumeName);

  const reviewResult = await supabase
    .from("source_document_text_reviews")
    .select("id, document_id, document_version_id, review_version_number, reviewed_text")
    .eq("document_id", documentId)
    .order("review_version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reviewResult.error) {
    databaseError(reviewResult.error, "CANDIDATE_EVIDENCE_READ_FAILED", "Reviewed résumé text could not be loaded.");
  }
  const review = row(reviewResult.data);
  const textReviewId = stringValue(review?.id);
  const reviewedText = stringValue(review?.reviewed_text);
  const textReviewVersion = positiveInteger(review?.review_version_number);
  if (!textReviewId || !reviewedText || !textReviewVersion) {
    return emptyView("RESUME_NEEDS_REVIEW", resumeName);
  }

  const passages = await ensurePassages(supabase, textReviewId, reviewedText);
  const passageIds = passages.map((passage) => stringValue(passage.id)).filter((id): id is string => Boolean(id));
  if (passageIds.length !== passages.length || passageIds.length === 0) {
    throw new CandidateEvidenceError("CANDIDATE_EVIDENCE_PROTOCOL_INVALID", "Résumé evidence returned incomplete source passages.");
  }

  const itemResult = await supabase
    .from("candidate_evidence_items")
    .select("id, primary_source_passage_id, evidence_key, evidence_category, review_status, aggregate_version, current_version_number")
    .in("primary_source_passage_id", passageIds);
  if (itemResult.error) {
    databaseError(itemResult.error, "CANDIDATE_EVIDENCE_READ_FAILED", "Résumé evidence could not be loaded.");
  }
  const items = rows(itemResult.data);
  const itemIds = items.map((item) => stringValue(item.id)).filter((id): id is string => Boolean(id));
  if (itemIds.length !== items.length || itemIds.length === 0) {
    throw new CandidateEvidenceError("CANDIDATE_EVIDENCE_PROTOCOL_INVALID", "Résumé evidence returned incomplete review items.");
  }

  const versionResult = await supabase
    .from("candidate_evidence_versions")
    .select("id, evidence_item_id, version_number, claim_text, usage_policy, candidate_disposition, review_kind, candidate_attested")
    .in("evidence_item_id", itemIds);
  if (versionResult.error) {
    databaseError(versionResult.error, "CANDIDATE_EVIDENCE_READ_FAILED", "Résumé evidence versions could not be loaded.");
  }
  const versions = rows(versionResult.data);
  const passagesById = new Map(passages.map((passage) => [stringValue(passage.id), passage] as const));
  const passageOrder = new Map(passages.map((passage) => [stringValue(passage.id), nonNegativeInteger(passage.ordinal) ?? 0] as const));
  const versionsByItemAndNumber = new Map(
    versions.map((version) => [
      `${stringValue(version.evidence_item_id)}:${positiveInteger(version.version_number)}`,
      version,
    ] as const),
  );

  const views: CandidateEvidenceItemView[] = [];
  for (const item of items) {
    const evidenceItemId = stringValue(item.id);
    const sourcePassageId = stringValue(item.primary_source_passage_id);
    const evidenceKey = stringValue(item.evidence_key);
    const aggregateVersion = positiveInteger(item.aggregate_version);
    const currentVersionNumber = positiveInteger(item.current_version_number);
    const category = stringValue(item.evidence_category);
    const reviewStatus = item.review_status;
    const passage = sourcePassageId ? passagesById.get(sourcePassageId) : null;
    const version = evidenceItemId && currentVersionNumber
      ? versionsByItemAndNumber.get(`${evidenceItemId}:${currentVersionNumber}`)
      : null;
    if (
      !evidenceItemId || !sourcePassageId || !evidenceKey || !aggregateVersion ||
      !currentVersionNumber || !category || !isResumeEvidenceCategory(category) ||
      !isReviewStatus(reviewStatus) || !passage || !version
    ) continue;

    const evidenceVersionId = stringValue(version.id);
    const claimText = stringValue(version.claim_text);
    const sourceExcerpt = stringValue(passage.excerpt);
    const disposition = version.candidate_disposition;
    const usagePolicy = stringValue(version.usage_policy);
    const reviewKind = version.review_kind;
    if (
      !evidenceVersionId || !claimText || !sourceExcerpt || !isDisposition(disposition) ||
      !usagePolicy || !isCandidateEvidenceUsagePolicy(usagePolicy) || !isReviewKind(reviewKind) ||
      typeof version.candidate_attested !== "boolean"
    ) continue;
    views.push(Object.freeze({
      evidenceItemId,
      evidenceVersionId,
      sourcePassageId,
      evidenceKey,
      category,
      categoryLabel: candidateEvidenceCategoryLabel(category),
      sourceExcerpt,
      claimText,
      reviewStatus,
      disposition,
      usagePolicy,
      aggregateVersion,
      versionNumber: currentVersionNumber,
      reviewKind,
      candidateAttested: version.candidate_attested,
    }));
  }
  views.sort((left, right) =>
    (passageOrder.get(left.sourcePassageId) ?? 0) - (passageOrder.get(right.sourcePassageId) ?? 0));
  if (views.length !== items.length) {
    throw new CandidateEvidenceError("CANDIDATE_EVIDENCE_PROTOCOL_INVALID", "Résumé evidence returned an incomplete review history.");
  }

  const counts = Object.freeze({
    total: views.length,
    needsReview: views.filter((item) => item.reviewStatus === "NEEDS_REVIEW").length,
    approved: views.filter((item) => item.reviewStatus === "VERIFIED" && item.usagePolicy === "RESUME_AND_COVER_LETTER").length,
    restricted: views.filter((item) => item.reviewStatus === "VERIFIED" && item.usagePolicy !== "RESUME_AND_COVER_LETTER").length,
    rejected: views.filter((item) => item.reviewStatus === "REJECTED").length,
  });

  return Object.freeze({
    status: "READY",
    resumeName,
    textReviewId,
    textReviewVersion,
    items: Object.freeze(views),
    counts,
  });
}

export async function reviewCandidateEvidence(
  actor: AuthenticatedActor,
  command: CandidateEvidenceReviewCommand,
): Promise<void> {
  if (!UUID_PATTERN.test(command.commandId) || !UUID_PATTERN.test(command.evidenceItemId)) {
    throw new CandidateEvidenceError("CANDIDATE_EVIDENCE_COMMAND_INVALID", "Reload before saving this evidence.");
  }
  if (!Number.isSafeInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion < 1) {
    throw new CandidateEvidenceError("CANDIDATE_EVIDENCE_VERSION_INVALID", "Reload before saving this evidence.");
  }
  const claimText = command.claimText.trim();
  const claimLength = Array.from(claimText).length;
  if (claimLength === 0 || claimLength > 4_000) {
    throw new CandidateEvidenceError("CANDIDATE_EVIDENCE_TEXT_INVALID", "Evidence must contain between 1 and 4,000 characters.");
  }
  if (command.disposition === "REJECTED" && command.usagePolicy !== "DO_NOT_USE") {
    throw new CandidateEvidenceError("REJECTED_EVIDENCE_MUST_NOT_BE_USED", "Rejected evidence must stay unavailable to drafts.");
  }

  const typedClient = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(typedClient, actor, actorLabel(actor));
  const result = await asUntyped(typedClient).rpc("review_candidate_evidence_item", {
    p_command_id: command.commandId,
    p_evidence_item_id: command.evidenceItemId,
    p_expected_aggregate_version: command.expectedAggregateVersion,
    p_disposition: command.disposition,
    p_claim_text: claimText,
    p_usage_policy: command.usagePolicy,
    p_candidate_attested: command.candidateAttested,
  });
  if (result.error) {
    databaseError(result.error, "CANDIDATE_EVIDENCE_REVIEW_FAILED", "This evidence could not be saved.");
  }
}
