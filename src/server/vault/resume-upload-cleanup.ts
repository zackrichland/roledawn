type CleanupCallResult = Readonly<{
  data?: unknown;
  error?: unknown;
}>;

type ResumeUploadCleanupInput = Readonly<{
  storagePath: string | null;
  removeStorageObject: (storagePath: string) => Promise<CleanupCallResult>;
  cancelReservation: () => Promise<CleanupCallResult>;
}>;

export class ResumeUploadCleanupFailure extends Error {
  readonly operation: "storage" | "reservation";

  constructor(operation: "storage" | "reservation") {
    super("RESUME_UPLOAD_CLEANUP_FAILED");
    this.name = "ResumeUploadCleanupFailure";
    this.operation = operation;
  }
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const row = value[0];
    return row && typeof row === "object"
      ? (row as Record<string, unknown>)
      : null;
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Deletes an uncommitted object before cancelling its reservation. The order
 * is intentional: a reservation remains recoverable unless Storage deletion
 * and the database cancellation both return explicit success.
 */
export async function cleanupResumeUploadReservation(
  input: ResumeUploadCleanupInput,
): Promise<void> {
  if (input.storagePath) {
    const removed = await input.removeStorageObject(input.storagePath);
    if (removed.error) {
      throw new ResumeUploadCleanupFailure("storage");
    }
  }

  const cancelled = await input.cancelReservation();
  const row = firstRow(cancelled.data);
  if (cancelled.error || row?.cancelled !== true) {
    throw new ResumeUploadCleanupFailure("reservation");
  }
}
