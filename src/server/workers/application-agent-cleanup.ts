import type { ApplicationAgentStore } from "./application-agent-store.ts";
import type { OpenAIAgentsClient } from "./openai-agents-client.ts";
import type { Database } from "../../lib/supabase/database.types.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PendingAgentCleanup = Readonly<{ id: string; providerSessionId: string; status: "COMPLETED" | "FAILED"; failureCode: string | null }>;
export interface ApplicationAgentCleanupRepository {
  expireInactiveRuns(): Promise<void>;
  pending(): Promise<readonly PendingAgentCleanup[]>;
}

export function createApplicationAgentCleanupRepository(supabase: SupabaseClient<Database>): ApplicationAgentCleanupRepository {
  const client = supabase as unknown as SupabaseClient;
  return {
    async expireInactiveRuns() {
      try {
        const { error } = await client.rpc("expire_application_agent_runs", { p_limit: 20 });
        if (error) throw new Error();
      } catch { throw new Error("APPLICATION_AGENT_CLEANUP_QUERY_FAILED"); }
    },
    async pending() {
      try {
        // Persist backoff before provider I/O. A failed oldest batch must not
        // starve later sessions, including when this process restarts.
        const { data, error } = await client.rpc("claim_application_agent_cleanup", { p_limit: 20 });
        if (error || !Array.isArray(data) || data.length > 20) throw new Error();
        return data.map(row => {
          if (typeof row.id !== "string" || !/^[0-9a-f-]{36}$/iu.test(row.id) ||
            typeof row.provider_session_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(row.provider_session_id) ||
            !["COMPLETED", "FAILED"].includes(row.status) ||
            (row.failure_code !== null && (typeof row.failure_code !== "string" || !/^[A-Z][A-Z0-9_]{2,119}$/u.test(row.failure_code)))) throw new Error();
          return { id: row.id, providerSessionId: row.provider_session_id, status: row.status, failureCode: row.failure_code };
        });
      } catch { throw new Error("APPLICATION_AGENT_CLEANUP_QUERY_FAILED"); }
    },
  };
}

/** Idempotent deletion only; never resumes tools or creates a provider session. */
export async function runApplicationAgentCleanup(
  repository: ApplicationAgentCleanupRepository,
  client: Pick<OpenAIAgentsClient, "deleteSession">,
  store: Pick<ApplicationAgentStore, "finishRun">,
): Promise<Readonly<{ kind: "AGENT_SESSION_CLEANUP"; completed: number; failed: number }>> {
  let pending: readonly PendingAgentCleanup[];
  try {
    await repository.expireInactiveRuns();
    pending = await repository.pending();
  } catch { throw new Error("APPLICATION_AGENT_CLEANUP_QUERY_FAILED"); }
  let completed = 0;
  let failed = 0;
  for (const run of pending) {
    try {
      await client.deleteSession(run.providerSessionId, AbortSignal.timeout(10_000));
      await store.finishRun(run.id, run.status, run.failureCode, true);
      completed++;
    } catch { failed++; }
  }
  return { kind: "AGENT_SESSION_CLEANUP", completed, failed };
}
