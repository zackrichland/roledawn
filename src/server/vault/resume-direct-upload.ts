import { createHash } from "node:crypto";
import { DIRECT_RESUME_MAX_BYTES, DIRECT_RESUME_PDF, DIRECT_RESUME_DOCX, RESUME_UPLOAD_UUID, ResumeDirectUploadError, type DirectResumeMediaType } from "../../domain/resume-direct-upload.ts";
import { extractResumeText, type ResumeExtractionResult, type ResumeTextArtifact } from "../resume/extract-resume.ts";

export type DirectResumeReservation = Readonly<{
  documentVersionId: string; documentId: string; workspaceId: string; candidateId: string; reservedBy: string;
  path: string; mediaType: DirectResumeMediaType; filename: string; byteSize: number; sha256: string;
  status: "RESERVED" | "FINALIZED"; expiresAt: string; reservedAt: string; hasExtraction: boolean;
}>;
export interface DirectResumeFinalizationPort {
  readReservation(actorId: string, versionId: string): Promise<DirectResumeReservation | null>;
  download(reservation: DirectResumeReservation): Promise<Blob | null>;
  finalize(actorId: string, reservation: DirectResumeReservation, artifact: ResumeTextArtifact): Promise<void>;
  recordExtraction(reservation: DirectResumeReservation, artifact: ResumeTextArtifact): Promise<void>;
  rejectAndCleanup(actorId: string, reservation: DirectResumeReservation): Promise<void>;
}
const unreadable = () => new ResumeDirectUploadError("RESUME_UPLOAD_NOT_FOUND", "This upload is unavailable. Reload your profile and try again.");

export async function finalizeDirectResumeUpload(
  port: DirectResumeFinalizationPort, actorId: string, versionId: string,
  extract: typeof extractResumeText = extractResumeText,
): Promise<void> {
  if (!RESUME_UPLOAD_UUID.test(actorId) || !RESUME_UPLOAD_UUID.test(versionId)) throw unreadable();
  const reservation = await port.readReservation(actorId, versionId);
  if (!reservation || reservation.reservedBy !== actorId || reservation.documentVersionId !== versionId ||
    ![reservation.workspaceId,reservation.candidateId,reservation.documentId].every(id => RESUME_UPLOAD_UUID.test(id)) ||
    ![DIRECT_RESUME_PDF,DIRECT_RESUME_DOCX].includes(reservation.mediaType) || !Number.isSafeInteger(reservation.byteSize) || reservation.byteSize < 1 || reservation.byteSize > DIRECT_RESUME_MAX_BYTES ||
    !Number.isFinite(Date.parse(reservation.reservedAt)) || !Number.isFinite(Date.parse(reservation.expiresAt)) ||
    !/^[a-f0-9]{64}$/u.test(reservation.sha256) ||
    reservation.path !== `${reservation.workspaceId}/${reservation.candidateId}/resumes/${reservation.documentId}/${versionId}.${reservation.mediaType === "application/pdf" ? "pdf" : "docx"}` ||
    (reservation.status !== "RESERVED" && reservation.status !== "FINALIZED") ||
    (reservation.status === "RESERVED" && Date.parse(reservation.expiresAt) <= Date.now())) throw unreadable();
  if (reservation.status === "FINALIZED" && reservation.hasExtraction) return;
  const blob = await port.download(reservation);
  if (!blob) throw new ResumeDirectUploadError("RESUME_UPLOAD_OBJECT_MISSING", "The file has not finished uploading. Try again with the same file.");
  let extraction: ResumeExtractionResult;
  try {
    if (blob.size < 1 || blob.size > DIRECT_RESUME_MAX_BYTES || blob.size !== reservation.byteSize || blob.type.split(";",1)[0].toLowerCase() !== reservation.mediaType) {
      throw new ResumeDirectUploadError("RESUME_UPLOAD_METADATA_MISMATCH", "The stored file does not match this upload. Choose the file again.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== reservation.sha256) {
      throw new ResumeDirectUploadError("RESUME_UPLOAD_HASH_MISMATCH", "The stored file changed during upload. Choose the file again.");
    }
    extraction = await extract({ bytes, filename: reservation.filename, declaredMediaType: reservation.mediaType });
    if (!extraction.ok) throw new ResumeDirectUploadError(extraction.error.code, extraction.error.message);
  } catch (error) {
    // A database compare-and-set cancels only an unfinalized reservation before
    // deleting invalid bytes. A competing successful finalization prevents deletion.
    if (reservation.status === "RESERVED" && error instanceof ResumeDirectUploadError) await port.rejectAndCleanup(actorId, reservation);
    throw error;
  }
  // From this point, failures may be lost success responses. Preserve the object
  // and use the same durable command/attempt on retry; never cancel it speculatively.
  if (reservation.status === "RESERVED") await port.finalize(actorId, reservation, extraction.value);
  await port.recordExtraction(reservation, extraction.value);
}
