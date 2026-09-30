import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  CareerVaultDocumentView,
  CareerVaultViewModel,
} from "@/domain/career-vault";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import {
  DOCX_MEDIA_TYPE,
  MAX_RESUME_TEXT_CHARACTERS,
  normalizeResumeText,
  PDF_MEDIA_TYPE,
  type SupportedResumeMediaType,
} from "@/server/resume/extract-resume";
import { cleanupResumeUploadReservation } from "@/server/vault/resume-upload-cleanup";
import { finalizeDirectResumeUpload, type DirectResumeReservation } from "@/server/vault/resume-direct-upload";
import { validateDirectResumeUploadRequest, type DirectResumeUploadRequest, type DirectResumeUploadTarget } from "@/domain/resume-direct-upload";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESUME_BUCKET = "career-vault";

type UntypedSupabase = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
  from: (name: string) => UntypedQuery;
};

type UntypedQueryResult = PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

type UntypedQuery = {
  select: (columns: string) => UntypedQuery;
  eq: (column: string, value: unknown) => UntypedQuery;
  order: (column: string, options?: { ascending?: boolean }) => UntypedQuery;
  limit: (count: number) => UntypedQuery;
  maybeSingle: () => UntypedQueryResult;
} & UntypedQueryResult;

type RpcRow = Record<string, unknown>;

export type ResumeReviewCommand = Readonly<{
  documentId: string;
  extractionId: string;
  expectedAggregateVersion: number;
  reviewedText: string;
}>;

export type ResumeDeleteCommand = Readonly<{
  documentId: string;
  expectedAggregateVersion: number;
}>;

export class CareerVaultError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CareerVaultError";
  }
}

function asUntyped(client: unknown): UntypedSupabase {
  return client as UntypedSupabase;
}

function firstRpcRow(value: unknown): RpcRow | null {
  if (Array.isArray(value)) {
    const row = value[0];
    return row && typeof row === "object" ? (row as RpcRow) : null;
  }
  return value && typeof value === "object" ? (value as RpcRow) : null;
}

function requiredString(row: RpcRow | null, key: string): string {
  const value = row?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CareerVaultError("VAULT_PROTOCOL_INVALID", "The profile returned an incomplete response.");
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function actorLabel(actor: AuthenticatedActor): string {
  return actor.email?.split("@")[0]?.trim().slice(0, 80) || "Signed-in candidate";
}

function isResumeMediaType(value: string): value is SupportedResumeMediaType {
  return value === PDF_MEDIA_TYPE || value === DOCX_MEDIA_TYPE;
}

function mapDatabaseError(
  error: { code?: string; message?: string } | null,
  fallbackCode: string,
  fallbackMessage: string,
): never {
  const messageCode = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];
  const serverCode = messageCode ?? error?.code;
  if (serverCode === "SOURCE_DOCUMENT_VERSION_MISMATCH") {
    throw new CareerVaultError(serverCode, "This résumé changed in another tab. Reload before saving.");
  }
  if (serverCode === "RESUME_UPLOAD_ALREADY_RESERVED") {
    throw new CareerVaultError(serverCode, "Another résumé upload is still being prepared. Try again shortly.");
  }
  if (serverCode === "DOCUMENT_ALREADY_DELETION_PENDING") {
    throw new CareerVaultError(
      serverCode,
      "Finish removing the current résumé before uploading another.",
    );
  }
  if (error?.code === "23505" && fallbackCode === "RESUME_RESERVATION_FAILED") {
    throw new CareerVaultError(
      "RESUME_DOCUMENT_CONFLICT",
      "Another résumé change is in progress. Reload before uploading again.",
    );
  }
  throw new CareerVaultError(serverCode ?? fallbackCode, fallbackMessage);
}

async function cancelReservation(
  documentVersionId: string,
  storagePath: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient("career-vault-cleanup/0.1");
  try {
    await cleanupResumeUploadReservation({
      storagePath,
      removeStorageObject: async (path) =>
        admin.storage.from(RESUME_BUCKET).remove([path]),
      cancelReservation: async () =>
        asUntyped(admin).rpc("cancel_resume_upload_reservation", {
          p_document_version_id: documentVersionId,
        }),
    });
  } catch {
    throw new CareerVaultError(
      "RESUME_UPLOAD_CLEANUP_FAILED",
      "The upload stopped before it was ready. Finish removing it before trying again.",
    );
  }
}

export async function getCareerVault(
  actor: AuthenticatedActor,
): Promise<CareerVaultViewModel> {
  const supabase = await createSupabaseServerClient();
  const scope = await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));

  const { data: documents, error: documentError } = await supabase
    .from("source_documents")
    .select("id, display_name, status, current_version_number, aggregate_version, updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("candidate_id", scope.candidateId)
    .eq("document_kind", "RESUME")
    .order("created_at", { ascending: false })
    .limit(1);

  if (documentError) {
    throw new CareerVaultError("VAULT_READ_FAILED", "The profile could not be loaded.");
  }
  const document = documents[0];
  if (!document) {
    return Object.freeze({
      actorLabel: actorLabel(actor),
      status: "empty",
      recoveryKind: null,
      document: null,
      deletionTarget: null,
      errorMessage: null,
    });
  }

  const deletionTarget = Object.freeze({
    documentId: document.id,
    documentAggregateVersion: document.aggregate_version,
  });
  const pendingResult = await asUntyped(supabase).from("source_document_upload_reservations")
    .select("document_version_id,expected_sha256,status,expires_at,version_number")
    .eq("workspace_id", scope.workspaceId).eq("candidate_id", scope.candidateId).eq("document_id", document.id)
    .order("reserved_at", { ascending: false }).limit(1).maybeSingle();
  if (pendingResult.error) throw new CareerVaultError("VAULT_UPLOAD_READ_FAILED", "The pending upload could not be checked.");
  const pending = firstRpcRow(pendingResult.data);
  const pendingUploadVersionId = pending && typeof pending.expected_sha256 === "string" &&
    Number(pending.version_number) > (document.current_version_number ?? 0) &&
    (pending.status === "FINALIZED" || (pending.status === "RESERVED" && Date.parse(String(pending.expires_at)) > Date.now()))
    ? requiredString(pending, "document_version_id") : undefined;

  if (document.status === "UPLOADING" || document.status === "SCANNING" || document.status === "PARSING") {
    return Object.freeze({
      actorLabel: actorLabel(actor),
      status: "uploading",
      pendingUploadVersionId,
      recoveryKind: "upload",
      document: null,
      deletionTarget,
      errorMessage: null,
    });
  }
  if (document.status === "DELETION_PENDING") {
    return Object.freeze({
      actorLabel: actorLabel(actor),
      status: "error",
      recoveryKind: "deletion",
      document: null,
      deletionTarget,
      errorMessage: "Deletion is waiting for the private file cleanup to finish.",
    });
  }
  if (document.status === "REJECTED" || document.current_version_number === null) {
    return Object.freeze({
      actorLabel: actorLabel(actor),
      status: "error",
      recoveryKind: "upload",
      document: null,
      deletionTarget,
      errorMessage: "The last résumé could not be prepared. Upload a fresh PDF or DOCX.",
    });
  }

  const { data: version, error: versionError } = await supabase
    .from("source_document_versions")
    .select("id, version_number, mime_type, byte_size, created_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("candidate_id", scope.candidateId)
    .eq("document_id", document.id)
    .eq("version_number", document.current_version_number)
    .maybeSingle();
  if (versionError || !version || !isResumeMediaType(version.mime_type)) {
    throw new CareerVaultError("VAULT_VERSION_READ_FAILED", "The current résumé version could not be loaded.");
  }

  const extractionQuery = asUntyped(supabase).from("source_document_extractions");
  const extractionResult = await extractionQuery
    .select("id, extracted_text, completed_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("candidate_id", scope.candidateId)
    .eq("document_id", document.id)
    .eq("document_version_id", version.id)
    .eq("status", "SUCCEEDED")
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const extraction = extractionResult.data as
    | { id: string; extracted_text: string | null; completed_at: string }
    | null;
  const extractionError = extractionResult.error;
  if (extractionError || !extraction || typeof extraction.extracted_text !== "string") {
    throw new CareerVaultError("VAULT_EXTRACTION_READ_FAILED", "The extracted résumé text could not be loaded.");
  }

  let displayedText = extraction.extracted_text;
  if (document.status === "READY") {
    const reviewQuery = asUntyped(supabase).from("source_document_text_reviews");
    const reviewResult = await reviewQuery
      .select("reviewed_text")
      .eq("workspace_id", scope.workspaceId)
      .eq("candidate_id", scope.candidateId)
      .eq("document_id", document.id)
      .eq("extraction_id", extraction.id)
      .order("review_version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const review = reviewResult.data as { reviewed_text: string } | null;
    const reviewError = reviewResult.error;
    if (reviewError || !review || typeof review.reviewed_text !== "string") {
      throw new CareerVaultError("VAULT_REVIEW_READ_FAILED", "The reviewed résumé text could not be loaded.");
    }
    displayedText = review.reviewed_text;
  }

  const view: CareerVaultDocumentView = Object.freeze({
    documentId: document.id,
    documentAggregateVersion: document.aggregate_version,
    documentVersionId: version.id,
    extractionId: extraction.id,
    versionNumber: version.version_number,
    filename: document.display_name,
    mimeType: version.mime_type,
    byteSize: version.byte_size,
    uploadedAt: version.created_at,
    extractedText: displayedText,
  });

  return Object.freeze({
    actorLabel: actorLabel(actor),
    status: document.status === "READY" ? "ready" : "needs-review",
    recoveryKind: null,
    document: view,
    pendingUploadVersionId,
    deletionTarget,
    errorMessage: null,
  });
}

export async function reviewResumeText(
  actor: AuthenticatedActor,
  command: ResumeReviewCommand,
): Promise<void> {
  if (!UUID_PATTERN.test(command.documentId) || !UUID_PATTERN.test(command.extractionId)) {
    throw new CareerVaultError("RESUME_REVIEW_INPUT_INVALID", "Reload before saving this résumé.");
  }
  if (!Number.isSafeInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion <= 0) {
    throw new CareerVaultError("RESUME_REVIEW_INPUT_INVALID", "Reload before saving this résumé.");
  }
  const reviewedText = normalizeResumeText(command.reviewedText);
  if (reviewedText.length === 0 || reviewedText.length > MAX_RESUME_TEXT_CHARACTERS) {
    throw new CareerVaultError("RESUME_REVIEW_TEXT_INVALID", "Résumé text must contain between 1 and 200,000 characters.");
  }

  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));
  const result = await asUntyped(supabase).rpc("review_resume_text", {
    p_command_id: randomUUID(),
    p_document_id: command.documentId,
    p_expected_aggregate_version: command.expectedAggregateVersion,
    p_extraction_id: command.extractionId,
    p_reviewed_text: reviewedText,
    p_text_sha256: sha256(reviewedText),
  });
  if (result.error) {
    mapDatabaseError(result.error, "RESUME_REVIEW_FAILED", "The reviewed résumé text could not be saved.");
  }
}

export async function deleteResume(
  actor: AuthenticatedActor,
  command: ResumeDeleteCommand,
): Promise<void> {
  if (!UUID_PATTERN.test(command.documentId) || !Number.isSafeInteger(command.expectedAggregateVersion)) {
    throw new CareerVaultError("RESUME_DELETE_INPUT_INVALID", "Reload before removing this résumé.");
  }
  const supabase = await createSupabaseServerClient();
  const scope = await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));

  const { data: currentDocument, error: currentDocumentError } = await supabase
    .from("source_documents")
    .select("id, status, aggregate_version")
    .eq("workspace_id", scope.workspaceId)
    .eq("candidate_id", scope.candidateId)
    .eq("id", command.documentId)
    .maybeSingle();
  if (currentDocumentError || !currentDocument) {
    throw new CareerVaultError("RESUME_DELETE_NOT_FOUND", "This résumé could not be found in your profile.");
  }
  const deletionAlreadyPending = currentDocument.status === "DELETION_PENDING";

  const { data: versions, error: versionsError } = await supabase
    .from("source_document_versions")
    .select("storage_bucket, storage_object_path")
    .eq("workspace_id", scope.workspaceId)
    .eq("candidate_id", scope.candidateId)
    .eq("document_id", command.documentId);
  if (versionsError) {
    throw new CareerVaultError("RESUME_DELETE_READ_FAILED", "The résumé file list could not be loaded.");
  }
  const reservationQuery = asUntyped(supabase).from("source_document_upload_reservations");
  const reservationsResult = await reservationQuery
    .select("storage_bucket, storage_object_path")
    .eq("workspace_id", scope.workspaceId)
    .eq("candidate_id", scope.candidateId)
    .eq("document_id", command.documentId);
  const reservations = (reservationsResult.data ?? []) as Array<{
    storage_bucket: string;
    storage_object_path: string;
  }>;
  const reservationsError = reservationsResult.error;
  if (reservationsError) {
    throw new CareerVaultError("RESUME_DELETE_READ_FAILED", "The résumé file list could not be loaded.");
  }

  if (!deletionAlreadyPending) {
    const requested = await asUntyped(supabase).rpc("request_source_document_deletion", {
      p_command_id: randomUUID(),
      p_document_id: command.documentId,
      p_expected_aggregate_version: command.expectedAggregateVersion,
    });
    if (requested.error) {
      mapDatabaseError(requested.error, "RESUME_DELETE_REQUEST_FAILED", "The résumé could not be marked for deletion.");
    }
  }

  const paths = Array.from(new Set(
    [...versions, ...reservations]
      .filter((row) => row.storage_bucket === RESUME_BUCKET)
      .map((row) => row.storage_object_path),
  ));
  const admin = createSupabaseAdminClient("career-vault-deletion/0.1");
  if (paths.length > 0) {
    const removed = await admin.storage.from(RESUME_BUCKET).remove(paths);
    if (removed.error) {
      throw new CareerVaultError(
        "RESUME_STORAGE_DELETE_FAILED",
        "Deletion is pending because the private file could not be removed. Try again shortly.",
      );
    }
  }
  const completed = await asUntyped(admin).rpc("complete_source_document_deletion", {
    p_document_id: command.documentId,
  });
  if (completed.error) {
    mapDatabaseError(completed.error, "RESUME_DELETE_FINALIZE_FAILED", "The résumé deletion could not be completed.");
  }
}

export async function reserveDirectResumeUpload(actor: AuthenticatedActor, command: DirectResumeUploadRequest): Promise<DirectResumeUploadTarget> {
  validateDirectResumeUploadRequest(command);
  const client = await createSupabaseServerClient();
  const scope = await bootstrapPersonalWorkspace(client, actor, actorLabel(actor));
  if (command.resumeVersionId) {
    const existing = await asUntyped(client).from("source_document_upload_reservations")
      .select("document_id,storage_object_path,expected_sha256,expected_byte_size,display_name,mime_type,status,expires_at")
      .eq("document_version_id", command.resumeVersionId).eq("workspace_id", scope.workspaceId)
      .eq("candidate_id", scope.candidateId).eq("reserved_by", actor.userId).maybeSingle();
    const row = firstRpcRow(existing.data);
    const expectedPath = `${scope.workspaceId}/${scope.candidateId}/resumes/${String(row?.document_id)}/${command.resumeVersionId}.${command.mediaType === "application/pdf" ? "pdf" : "docx"}`;
    if (existing.error || !row || row.expected_sha256 !== command.sha256 || Number(row.expected_byte_size) !== command.byteSize ||
      row.display_name !== command.filename || row.mime_type !== command.mediaType || row.storage_object_path !== expectedPath ||
      !(row.status === "FINALIZED" || (row.status === "RESERVED" && Date.parse(String(row.expires_at)) > Date.now()))) {
      throw new CareerVaultError("RESUME_UPLOAD_RESUME_MISMATCH", "Select the same file to finish this upload, or remove the unfinished upload first.");
    }
    return { documentVersionId: command.resumeVersionId, bucket: RESUME_BUCKET, path: expectedPath, mediaType: command.mediaType, status: row.status as "RESERVED" | "FINALIZED" };
  }
  const result = await asUntyped(client).rpc("reserve_direct_resume_upload", {
    p_command_id: command.commandId, p_display_name: command.filename, p_mime_type: command.mediaType,
    p_byte_size: command.byteSize, p_sha256: command.sha256,
  });
  if (result.error) mapDatabaseError(result.error, "RESUME_RESERVATION_FAILED", "This upload could not be reserved. Reload and try again.");
  const value = firstRpcRow(result.data);
  const versionId = requiredString(value, "document_version_id"); const bucket = requiredString(value, "storage_bucket");
  const path = requiredString(value, "storage_object_path"); const mediaType = requiredString(value, "mime_type");
  if (!UUID_PATTERN.test(versionId) || bucket !== RESUME_BUCKET || mediaType !== command.mediaType ||
    (value?.status !== "RESERVED" && value?.status !== "FINALIZED")) throw new CareerVaultError("VAULT_PROTOCOL_INVALID", "This upload could not be prepared.");
  return { documentVersionId: versionId, bucket, path, mediaType: command.mediaType, status: value.status };
}

export async function finishDirectResumeUpload(actor: AuthenticatedActor, documentVersionId: string): Promise<void> {
  const client = await createSupabaseServerClient();
  const scope = await bootstrapPersonalWorkspace(client, actor, actorLabel(actor));
  const admin = createSupabaseAdminClient("resume-direct-intake/1");
  await finalizeDirectResumeUpload({
    async readReservation(actorId, versionId) {
      const result = await asUntyped(client).from("source_document_upload_reservations")
        .select("document_id,document_version_id,workspace_id,candidate_id,reserved_by,storage_bucket,storage_object_path,mime_type,display_name,expected_byte_size,expected_sha256,status,expires_at,reserved_at")
        .eq("workspace_id", scope.workspaceId).eq("candidate_id", scope.candidateId).eq("reserved_by", actorId).eq("document_version_id", versionId).maybeSingle();
      if (result.error) throw new CareerVaultError("RESUME_RESERVATION_READ_FAILED", "The upload could not be checked. Try again.");
      const value = firstRpcRow(result.data);
      if (!value || value.storage_bucket !== RESUME_BUCKET || typeof value.mime_type !== "string" || !isResumeMediaType(value.mime_type)) return null;
      const document = await client.from("source_documents").select("id,status").eq("id", String(value.document_id))
        .eq("workspace_id", scope.workspaceId).eq("candidate_id", scope.candidateId).maybeSingle();
      if (document.error || !document.data || document.data.status === "DELETION_PENDING") return null;
      const extraction = await asUntyped(client).from("source_document_extractions").select("id")
        .eq("document_version_id", versionId).eq("status", "SUCCEEDED").limit(1).maybeSingle();
      if (extraction.error) throw new CareerVaultError("RESUME_EXTRACTION_READ_FAILED", "The upload could not be checked. Try again.");
      return { documentVersionId: requiredString(value,"document_version_id"), documentId: requiredString(value,"document_id"),
        workspaceId: requiredString(value,"workspace_id"), candidateId: requiredString(value,"candidate_id"), reservedBy: requiredString(value,"reserved_by"),
        path: requiredString(value,"storage_object_path"), mediaType: value.mime_type, filename: requiredString(value,"display_name"),
        byteSize: Number(value.expected_byte_size), sha256: requiredString(value,"expected_sha256"), status: value.status,
        expiresAt: requiredString(value,"expires_at"), reservedAt: requiredString(value,"reserved_at"), hasExtraction: Boolean(extraction.data) } as DirectResumeReservation;
    },
    async download(reservation) {
      const result = await admin.storage.from(RESUME_BUCKET).download(reservation.path);
      if (result.error) return null;
      return result.data;
    },
    async finalize(actorId, reservation, artifact) {
      const result = await asUntyped(admin).rpc("finalize_resume_upload", {
        p_actor_id: actorId, p_command_id: reservation.documentVersionId, p_document_version_id: reservation.documentVersionId,
        p_sha256: artifact.source.sha256, p_byte_size: artifact.source.byteSize,
      });
      if (result.error) mapDatabaseError(result.error, "RESUME_FINALIZE_FAILED", "The upload could not be confirmed. Retry to check the same file.");
    },
    async recordExtraction(reservation, artifact) {
      const result = await asUntyped(admin).rpc("record_resume_extraction", {
        p_attempt_number: 1, p_document_version_id: reservation.documentVersionId, p_extracted_text: artifact.extraction.normalizedText,
        p_extractor_kind: "LOCAL_DETERMINISTIC", p_extractor_release: artifact.extraction.parserRelease, p_failure_code: null,
        p_language_code: null, p_output_schema_version: `resume-text/${artifact.schemaVersion}`, p_page_count: artifact.extraction.pageCount,
        p_source_sha256: artifact.source.sha256, p_started_at: reservation.reservedAt, p_status: "SUCCEEDED",
        p_text_sha256: artifact.extraction.sha256, p_warnings: [...artifact.extraction.warnings] as Json[],
      });
      if (result.error) mapDatabaseError(result.error, "EXTRACTION_RECORD_FAILED", "The text could not be saved yet. Retry to finish this upload.");
    },
    async rejectAndCleanup(actorId, reservation) {
      const rejection = await asUntyped(admin).rpc("reject_direct_resume_upload", {
        p_actor_id: actorId, p_document_version_id: reservation.documentVersionId, p_expected_sha256: reservation.sha256,
      });
      if (rejection.error) throw new CareerVaultError("RESUME_UPLOAD_CLEANUP_FAILED", "Remove the unfinished upload before trying again.");
      if (rejection.data === false) return;
      if (rejection.data !== true) throw new CareerVaultError("VAULT_PROTOCOL_INVALID", "The upload could not be checked.");
      await cancelReservation(reservation.documentVersionId, reservation.path);
    },
  }, actor.userId, documentVersionId);
}
