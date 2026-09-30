import { getContext } from "@netlify/functions";

import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { parseHostedWorkerLane, type HostedWorkerLane, type WorkerDatabase } from "./hosted-worker-control.ts";
import { hostedWorkerUrl } from "./hosted-worker-environment.ts";

export const APPLICATION_PIPELINE_LANES = ["preparation", "kit", "autopilot"] as const;

/** Dispatch only durable, due work. A wake-up never creates application authority;
 * the receiving published worker must still acquire the existing database lease. */
export async function dispatchDueHostedWorkers(
  environment: NodeJS.ProcessEnv,
  options: Readonly<{
    lanes?: readonly HostedWorkerLane[];
    /** A newly saved send intent should not wait for periodic maintenance. */
    includeSendIntentSweep?: boolean;
    database?: WorkerDatabase;
    fetch?: typeof fetch;
  }> = {},
): Promise<number> {
  const secret = environment.ROLEDAWN_WORKER_DISPATCH_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/u.test(secret)) throw new Error("HOSTED_WORKER_SECRET_REQUIRED");
  const target = hostedWorkerUrl(environment);
  const database = options.database ?? createSupabaseAdminClient("hosted-worker-wakeup/1", environment) as unknown as WorkerDatabase;
  const result = await database.rpc("hosted_worker_due_lanes", {});
  if (result.error || !Array.isArray(result.data)) throw new Error("HOSTED_WORKER_DUE_QUERY_FAILED");
  // Validate the whole response before dispatching anything; no caller-supplied
  // URL, application id or policy can reach the background endpoint.
  const due = result.data.map(parseHostedWorkerLane);
  if (options.includeSendIntentSweep && options.lanes?.includes("cleanup")) due.push("cleanup");
  const lanes = [...new Set(due)]
    .filter(lane => !options.lanes || options.lanes.includes(lane));
  const results = await Promise.allSettled(lanes.map(async lane => {
    const response = await (options.fetch ?? fetch)(target, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ lane }), signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    if (response.status !== 202) throw new Error("HOSTED_WORKER_DISPATCH_REJECTED");
  }));
  if (results.some(result => result.status === "rejected")) throw new Error("HOSTED_WORKER_DISPATCH_FAILED");
  return results.length;
}

/** Best-effort latency improvement after an authenticated command commits.
 * The minute scheduler remains recovery for an unavailable wake-up. Never run
 * hosted work from a local server or a deploy preview. */
export async function requestHostedWorkerWakeup(
  lanes: readonly HostedWorkerLane[],
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: Readonly<{
    getDeploy?: () => Readonly<{ context: string; published: boolean }>;
    dispatch?: typeof dispatchDueHostedWorkers;
  }> = {},
): Promise<void> {
  if (environment.NODE_ENV !== "production" || environment.NETLIFY_DEV || environment.NETLIFY_LOCAL
    || environment.ROLEDAWN_HOSTED_WORKERS_ENABLED !== "true") return;
  // CONTEXT is build-only. The request context also excludes old production
  // deploys reached through skew protection or a deploy permalink.
  try {
    const deploy = (dependencies.getDeploy ?? (() => getContext().deploy))();
    if (deploy.context !== "production" || deploy.published !== true) return;
  } catch { return; } // next dev/next start have no Netlify request context.
  try {
    await (dependencies.dispatch ?? dispatchDueHostedWorkers)(environment, { lanes, includeSendIntentSweep: lanes.includes("cleanup") });
  } catch {
    // Do not turn a saved command into a reported failure or log credentials.
    console.warn(JSON.stringify({ event: "hosted_worker_wakeup_deferred" }));
  }
}
