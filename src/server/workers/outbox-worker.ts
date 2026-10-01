import { errorDetail, recordWorkerEvent } from "./worker-events.ts";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { handleApplicationQueued } from "./application-queued.ts";
import { handleApplicationPreparationRequested } from "./application-preparation.ts";
import { handleCareerProfileRequested } from "./career-profile-worker.ts";
import { decideOutboxFailureDisposition, MAX_OUTBOX_ATTEMPTS } from "./outbox-retry-policy.ts";

function firstBoolean(value: unknown): boolean {
  if (Array.isArray(value)) return value[0] === true;
  return value === true;
}

export type PreparationOutboxHandlerKind = "JOB_RESOLVER" | "INPUT_SNAPSHOT" | "CAREER_PROFILE";

export function preparationOutboxHandlerKind(topic: string): PreparationOutboxHandlerKind | null {
  if (topic === "application.queued") return "JOB_RESOLVER";
  if (topic === "application.job_resolved" || topic === "application.preparation_requested") {
    return "INPUT_SNAPSHOT";
  }
  if (topic === "candidate.career_profile_requested") return "CAREER_PROFILE";
  return null;
}

export async function runPreparationWorkerOnce(environment: NodeJS.ProcessEnv = process.env): Promise<Readonly<{
  claimed: number;
  completed: number;
  failed: number;
}>> {
  const supabase = createSupabaseAdminClient("preparation-worker/1", environment);
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 120);
  const { data, error } = await supabase.rpc("claim_outbox_batch", {
    p_worker_id: workerId,
    p_limit: 10,
    p_lease_seconds: 120,
    p_topics: [
      "application.queued",
      "application.job_resolved",
      "application.preparation_requested",
      "candidate.career_profile_requested",
    ],
  });
  if (error) throw new Error("OUTBOX_CLAIM_FAILED");

  const messages = data ?? [];
  let completed = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      const handlerKind = preparationOutboxHandlerKind(message.topic);
      if (handlerKind === "JOB_RESOLVER") {
        await handleApplicationQueued(supabase, message.payload, { finalAttempt: message.attempt_count >= MAX_OUTBOX_ATTEMPTS });
      } else if (handlerKind === "INPUT_SNAPSHOT") {
        await handleApplicationPreparationRequested(supabase, message.payload, workerId, environment);
      } else if (handlerKind === "CAREER_PROFILE") {
        await handleCareerProfileRequested(supabase, message.payload, environment);
      } else {
        throw new Error("OUTBOX_TOPIC_UNSUPPORTED");
      }
      const { data: acked, error: ackError } = await supabase.rpc("ack_outbox_message", {
        p_worker_id: workerId,
        p_outbox_id: message.outbox_id,
      });
      if (ackError || !firstBoolean(acked)) throw new Error("OUTBOX_ACK_FAILED");
      completed += 1;
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "WORKER_UNEXPECTED_FAILURE";
      const disposition = decideOutboxFailureDisposition(message.attempt_count, code);
      // The outbox clears its last error on the next success; keep the cause (D-116).
      const applicationId = typeof (message.payload as { applicationId?: unknown } | null)?.applicationId === "string"
        ? (message.payload as { applicationId: string }).applicationId : null;
      await recordWorkerEvent(supabase as never, { lane: "preparation", stage: `outbox:${String(message.topic ?? "unknown")}`.slice(0, 80), outcome: "FAILED",
        code: disposition.errorCode, detail: { ...errorDetail(error), attempt: String(message.attempt_count), action: disposition.action },
        applicationId: applicationId && /^[0-9a-f-]{36}$/iu.test(applicationId) ? applicationId : null });
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
