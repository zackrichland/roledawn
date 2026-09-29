import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";

/**
 * Delegates applications the candidate asked RoleDawn to send once their files
 * were ready. The database performs the same checks as the candidate's own
 * "Apply for me" and leaves an intent open if delegation cannot happen yet.
 */
export async function runSendIntentSweep(environment: NodeJS.ProcessEnv = process.env, applicationId: string | null = null): Promise<Readonly<{
  claimed: number;
  completed: number;
  failed: number;
}>> {
  const supabase = createSupabaseAdminClient("send-intent-sweep/1", environment);
  const { data, error } = await supabase.rpc("delegate_ready_send_intents", { ...(applicationId ? { p_application_id: applicationId } : {}), p_limit: 10 });
  if (error) throw new Error("SEND_INTENT_SWEEP_FAILED");
  const result = (data ?? {}) as { delegated?: number; closed?: number };
  const delegated = Number(result.delegated ?? 0);
  const closed = Number(result.closed ?? 0);
  return Object.freeze({ claimed: delegated + closed, completed: delegated + closed, failed: 0 });
}
