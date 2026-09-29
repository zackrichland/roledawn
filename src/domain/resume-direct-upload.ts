export const DIRECT_RESUME_MAX_BYTES = 10 * 1024 * 1024;
export const DIRECT_RESUME_PDF = "application/pdf";
export const DIRECT_RESUME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const RESUME_UPLOAD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export type DirectResumeMediaType = typeof DIRECT_RESUME_PDF | typeof DIRECT_RESUME_DOCX;
export type DirectResumeUploadRequest = Readonly<{ commandId: string; resumeVersionId?: string; filename: string; mediaType: DirectResumeMediaType; byteSize: number; sha256: string }>;
export type DirectResumeUploadTarget = Readonly<{ documentVersionId: string; bucket: "career-vault"; path: string; mediaType: DirectResumeMediaType; status: "RESERVED" | "FINALIZED" }>;
export type DirectResumeUploadActionResult = Readonly<{ ok: true; target: DirectResumeUploadTarget }> | Readonly<{ ok: false; message: string }>;

export class ResumeDirectUploadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "ResumeDirectUploadError"; this.code = code; }
}
export function resumeUploadMediaType(filename: string, declared: string): DirectResumeMediaType | null {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const type = declared.trim().toLowerCase();
  if (extension === ".pdf" && (!type || type === DIRECT_RESUME_PDF)) return DIRECT_RESUME_PDF;
  if (extension === ".docx" && (!type || type === DIRECT_RESUME_DOCX)) return DIRECT_RESUME_DOCX;
  return null;
}
export function validateDirectResumeUploadRequest(value: DirectResumeUploadRequest): void {
  if (!value || !RESUME_UPLOAD_UUID.test(value.commandId) || (value.resumeVersionId !== undefined && !RESUME_UPLOAD_UUID.test(value.resumeVersionId)) || typeof value.filename !== "string" || value.filename.trim() !== value.filename ||
    value.filename.length < 1 || value.filename.length > 180 || /[\u0000-\u001f/\\]/u.test(value.filename) ||
    typeof value.mediaType !== "string" || resumeUploadMediaType(value.filename, value.mediaType) !== value.mediaType ||
    typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    throw new ResumeDirectUploadError("RESUME_UPLOAD_INPUT_INVALID", "Choose a valid PDF or DOCX résumé with a short file name.");
  }
  if (!Number.isSafeInteger(value.byteSize) || value.byteSize < 1 || value.byteSize > DIRECT_RESUME_MAX_BYTES) {
    throw new ResumeDirectUploadError("RESUME_SIZE_INVALID", "Choose a résumé between 1 byte and 10 MB.");
  }
}
