import type { Config, Context } from "@netlify/functions";
import { createSupabaseAdminClient } from "../../src/lib/supabase/admin.ts";
import { hostedScheduleEnabled, hostedWorkerUrl, readHostedWorkerEnvironment } from "../../src/server/workers/hosted-worker-environment.ts";
import { parseHostedWorkerLane } from "../../src/server/workers/hosted-worker-control.ts";

export default async function workerDispatch(_request: Request, context: Context) {
  const environment = readHostedWorkerEnvironment(key => Netlify.env.get(key));
  if (!hostedScheduleEnabled(environment, context.deploy)) {
    console.info(JSON.stringify({ event: "hosted_worker_dispatch_disabled", context: context.deploy.context,
      published: context.deploy.published, enabled: environment.ROLEDAWN_HOSTED_WORKERS_ENABLED === "true", deploy: context.deploy.id }));
    return;
  }
  const secret = environment.ROLEDAWN_WORKER_DISPATCH_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/u.test(secret)) throw new Error("HOSTED_WORKER_SECRET_REQUIRED");
  const client = createSupabaseAdminClient("hosted-worker-dispatch/1", environment);
  const result = await client.rpc("hosted_worker_due_lanes" as never);
  const data: unknown = result.data;
  const error = result.error;
  if (error || !Array.isArray(data)) throw new Error("HOSTED_WORKER_DUE_QUERY_FAILED");
  const target = hostedWorkerUrl(environment);
  const results = await Promise.allSettled(data.map(async (lane: string) => {
    parseHostedWorkerLane(lane);
    const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify({ lane }), signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (response.status !== 202) throw new Error("HOSTED_WORKER_DISPATCH_REJECTED");
  }));
  if (results.some(result => result.status === "rejected")) throw new Error("HOSTED_WORKER_DISPATCH_FAILED");
  console.info(JSON.stringify({ event: "hosted_worker_dispatch", accepted: results.length }));
};

export const config: Config = { schedule: "* * * * *" };
