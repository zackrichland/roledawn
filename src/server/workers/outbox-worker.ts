import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { handleApplicationQueued } from "./application-queued.ts";
import { decideOutboxFailureDisposition } from "./outbox-retry-policy.ts";

function firstBoolean(value: unknown): boolean {
  if (Array.isArray(value)) return value[0] === true;
  return value === true;
}

export async function runPreparationWorkerOnce(): Promise<Readonly<{
  claimed: number;
  completed: number;
  failed: number;
}>> {
  const supabase = createSupabaseAdminClient();
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 120);
  const { data, error } = await supabase.rpc("claim_outbox_batch", {
    p_worker_id: workerId,
    p_limit: 10,
    p_lease_seconds: 120,
    p_topics: ["application.queued"],
  });
  if (error) throw new Error("OUTBOX_CLAIM_FAILED");

  const messages = data ?? [];
  let completed = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      await handleApplicationQueued(supabase, message.payload);
      const { data: acked, error: ackError } = await supabase.rpc("ack_outbox_message", {
        p_worker_id: workerId,
        p_outbox_id: message.outbox_id,
      });
      if (ackError || !firstBoolean(acked)) throw new Error("OUTBOX_ACK_FAILED");
      completed += 1;
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "WORKER_UNEXPECTED_FAILURE";
      const disposition = decideOutboxFailureDisposition(message.attempt_count, code);
      const { data: released, error: releaseError } = disposition.action === "DEAD_LETTER"
        ? await supabase.rpc("dead_letter_outbox_message", {
            p_worker_id: workerId,
            p_outbox_id: message.outbox_id,
            p_error_code: disposition.errorCode,
          })
        : await supabase.rpc("fail_outbox_message", {
            p_worker_id: workerId,
            p_outbox_id: message.outbox_id,
            p_error_code: disposition.errorCode,
            p_retry_after_seconds: disposition.retryAfterSeconds,
          });
      if (releaseError || !firstBoolean(released)) {
        throw new Error("OUTBOX_FAILURE_RELEASE_FAILED", { cause: error });
      }
      failed += 1;
    }
  }
  return { claimed: messages.length, completed, failed };
}
