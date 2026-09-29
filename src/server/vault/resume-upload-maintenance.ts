import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { cleanupResumeUploadReservation } from "./resume-upload-cleanup.ts";

export async function runResumeUploadCleanupWorker(
  options: Readonly<{ limit?: number }> = {},
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<{ checked: number; removed: number; failed: number }>> {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("RESUME_CLEANUP_LIMIT_INVALID");
  const client = createSupabaseAdminClient("resume-upload-maintenance/1", environment);
  const result = await client.rpc("list_expired_resume_upload_reservations", { p_limit: limit });
  if (result.error || !Array.isArray(result.data)) throw new Error("RESUME_CLEANUP_READ_FAILED");
  let removed = 0; let failed = 0;
  for (const reservation of result.data) {
    try {
      if (reservation.storage_bucket !== "career-vault") throw new Error("RESUME_CLEANUP_SCOPE_INVALID");
      await cleanupResumeUploadReservation({
        storagePath: reservation.storage_object_path,
        removeStorageObject: path => client.storage.from("career-vault").remove([path]),
        cancelReservation: async () => await client.rpc("cancel_resume_upload_reservation", { p_document_version_id: reservation.document_version_id }),
      });
      removed += 1;
    } catch { failed += 1; }
  }
  // Counts only: paths, candidate IDs, parser errors and document values stay private.
  return { checked: result.data.length, removed, failed };
}
