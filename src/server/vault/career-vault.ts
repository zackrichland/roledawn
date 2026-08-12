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
  extractResumeText,
  MAX_RESUME_FILE_BYTES,
  MAX_RESUME_TEXT_CHARACTERS,
  normalizeResumeText,
  PDF_MEDIA_TYPE,
  type ResumeExtractionFailureCode,
  type SupportedResumeMediaType,
} from "@/server/resume/extract-resume";
import { cleanupResumeUploadReservation } from "@/server/vault/resume-upload-cleanup";

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

export type ResumeUploadCommand = Readonly<{
  filename: string;
  mediaType: SupportedResumeMediaType;
  bytes: Uint8Array;
}>;

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
    throw new CareerVaultError("VAULT_PROTOCOL_INVALID", "The Career Vault returned an incomplete response.");
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

function formatExtractionMessage(code: ResumeExtractionFailureCode): string {
  switch (code) {
    case "OCR_REQUIRED":
      return "That PDF appears to be scanned. Upload a text-based PDF or DOCX for now.";
    case "ENCRYPTED_DOCUMENT":
      return "Password-protected résumés are not supported.";
    case "FILE_TOO_LARGE":
      return "Choose a résumé smaller than 10 MB.";
    case "PDF_PAGE_LIMIT_EXCEEDED":
      return "Choose a résumé with 25 pages or fewer.";
    case "UNSUPPORTED_MEDIA_TYPE":
    case "FILE_EXTENSION_MISMATCH":
    case "CONTENT_SIGNATURE_MISMATCH":
      return "Choose a valid PDF or DOCX résumé.";
    default:
      return "We could not read that résumé safely. Try exporting it as a fresh PDF or DOCX.";
  }
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

async function recordExtractionFailure(
  documentVersionId: string,
  sourceSha256: string,
  code: ResumeExtractionFailureCode,
  startedAt: string,
): Promise<void> {
  const admin = createSupabaseAdminClient("resume-extraction/0.1");
  const result = await asUntyped(admin).rpc("record_resume_extraction", {
    p_attempt_number: 1,
    p_document_version_id: documentVersionId,
    p_extracted_text: null,
    p_extractor_kind: "LOCAL_DETERMINISTIC",
    p_extractor_release: "resume-intake-validation/1",
    p_failure_code: code,
    p_language_code: null,
    p_output_schema_version: "resume-text/1",
    p_page_count: null,
    p_source_sha256: sourceSha256,
    p_started_at: startedAt,
    p_status: "FAILED",
    p_text_sha256: null,
    p_warnings: [] as Json[],
  });
  if (result.error) {
    mapDatabaseError(result.error, "EXTRACTION_RECORD_FAILED", "The résumé could not be prepared.");
  }
}

export async function getCareerVault(
  actor: AuthenticatedActor,
): Promise<CareerVaultViewModel> {
  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));

  const { data: documents, error: documentError } = await supabase
    .from("source_documents")
    .select("id, display_name, status, current_version_number, aggregate_version, updated_at")
    .eq("document_kind", "RESUME")
    .order("created_at", { ascending: false })
    .limit(1);

  if (documentError) {
    throw new CareerVaultError("VAULT_READ_FAILED", "The Career Vault could not be loaded.");
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

  if (document.status === "UPLOADING" || document.status === "SCANNING" || document.status === "PARSING") {
    return Object.freeze({
      actorLabel: actorLabel(actor),
      status: "uploading",
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
    .eq("document_id", document.id)
    .eq("version_number", document.current_version_number)
    .maybeSingle();
  if (versionError || !version || !isResumeMediaType(version.mime_type)) {
    throw new CareerVaultError("VAULT_VERSION_READ_FAILED", "The current résumé version could not be loaded.");
  }

  const extractionQuery = asUntyped(supabase).from("source_document_extractions");
  const extractionResult = await extractionQuery
    .select("id, extracted_text, completed_at")
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
    deletionTarget,
    errorMessage: null,
  });
}

export async function uploadResume(
  actor: AuthenticatedActor,
  command: ResumeUploadCommand,
): Promise<void> {
  if (command.bytes.byteLength === 0 || command.bytes.byteLength > MAX_RESUME_FILE_BYTES) {
    throw new CareerVaultError("RESUME_SIZE_INVALID", "Choose a résumé between 1 byte and 10 MB.");
  }

  const startedAt = new Date().toISOString();
  const extraction = await extractResumeText({
    bytes: command.bytes,
    filename: command.filename,
    declaredMediaType: command.mediaType,
  });
  if (!extraction.ok) {
    throw new CareerVaultError(extraction.error.code, formatExtractionMessage(extraction.error.code));
  }

  const supabase = await createSupabaseServerClient();
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));
  const reserved = await asUntyped(supabase).rpc("reserve_resume_upload", {
    p_byte_size: command.bytes.byteLength,
    p_command_id: randomUUID(),
    p_display_name: extraction.value.source.filename,
    p_mime_type: extraction.value.source.mediaType,
  });
  if (reserved.error) {
    mapDatabaseError(reserved.error, "RESUME_RESERVATION_FAILED", "The résumé upload could not be started.");
  }
  const reservation = firstRpcRow(reserved.data);
  const documentVersionId = requiredString(reservation, "document_version_id");
  const storageBucket = requiredString(reservation, "storage_bucket");
  const storagePath = requiredString(reservation, "storage_object_path");

  let objectUploaded = false;
  let uploadFinalized = false;
  try {
    const uploaded = await supabase.storage.from(storageBucket).upload(
      storagePath,
      command.bytes,
      {
        cacheControl: "3600",
        contentType: extraction.value.source.mediaType,
        upsert: false,
      },
    );
    if (uploaded.error) {
      throw new CareerVaultError("RESUME_STORAGE_FAILED", "The private résumé file could not be stored.");
    }
    objectUploaded = true;

    const admin = createSupabaseAdminClient("resume-intake/0.1");
    const finalized = await asUntyped(admin).rpc("finalize_resume_upload", {
      p_actor_id: actor.userId,
      p_byte_size: extraction.value.source.byteSize,
      p_command_id: randomUUID(),
      p_document_version_id: documentVersionId,
      p_sha256: extraction.value.source.sha256,
    });
    if (finalized.error) {
      mapDatabaseError(finalized.error, "RESUME_FINALIZE_FAILED", "The résumé upload could not be finalized.");
    }
    uploadFinalized = true;

    const recorded = await asUntyped(admin).rpc("record_resume_extraction", {
      p_attempt_number: 1,
      p_document_version_id: documentVersionId,
      p_extracted_text: extraction.value.extraction.normalizedText,
      p_extractor_kind: "LOCAL_DETERMINISTIC",
      p_extractor_release: extraction.value.extraction.parserRelease,
      p_failure_code: null,
      p_language_code: null,
      p_output_schema_version: `resume-text/${extraction.value.schemaVersion}`,
      p_page_count: extraction.value.extraction.pageCount,
      p_source_sha256: extraction.value.source.sha256,
      p_started_at: startedAt,
      p_status: "SUCCEEDED",
      p_text_sha256: extraction.value.extraction.sha256,
      p_warnings: [...extraction.value.extraction.warnings] as Json[],
    });
    if (recorded.error) {
      mapDatabaseError(recorded.error, "EXTRACTION_RECORD_FAILED", "The résumé text could not be saved for review.");
    }
  } catch (error) {
    if (!uploadFinalized) {
      try {
        await cancelReservation(documentVersionId, objectUploaded ? storagePath : null);
      } catch (cleanupError) {
        throw cleanupError instanceof CareerVaultError
          ? cleanupError
          : new CareerVaultError(
              "RESUME_UPLOAD_CLEANUP_FAILED",
              "The upload stopped before it was ready. Finish removing it before trying again.",
            );
      }
    } else {
      try {
        await recordExtractionFailure(
          documentVersionId,
          extraction.value.source.sha256,
          "PARSER_FAILED",
          startedAt,
        );
      } catch {
        // The finalized immutable source version remains visible to operations
        // for recovery; never silently delete a committed source on this path.
      }
    }
    throw error;
  }
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
  await bootstrapPersonalWorkspace(supabase, actor, actorLabel(actor));

  const { data: currentDocument, error: currentDocumentError } = await supabase
    .from("source_documents")
    .select("id, status, aggregate_version")
    .eq("id", command.documentId)
    .maybeSingle();
  if (currentDocumentError || !currentDocument) {
    throw new CareerVaultError("RESUME_DELETE_NOT_FOUND", "This résumé could not be found in your Career Vault.");
  }
  const deletionAlreadyPending = currentDocument.status === "DELETION_PENDING";

  const { data: versions, error: versionsError } = await supabase
    .from("source_document_versions")
    .select("storage_bucket, storage_object_path")
    .eq("document_id", command.documentId);
  if (versionsError) {
    throw new CareerVaultError("RESUME_DELETE_READ_FAILED", "The résumé file list could not be loaded.");
  }
  const reservationQuery = asUntyped(supabase).from("source_document_upload_reservations");
  const reservationsResult = await reservationQuery
    .select("storage_bucket, storage_object_path")
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
