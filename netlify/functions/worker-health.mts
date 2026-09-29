import { createSupabaseAdminClient } from "../../src/lib/supabase/admin.ts";
import { authorizedWorkerRequest } from "../../src/server/workers/hosted-worker-control.ts";
import { hostedWorkersEnabled, readHostedWorkerEnvironment } from "../../src/server/workers/hosted-worker-environment.ts";

export default async function workerHealth(request: Request, context: Context) {
  const environment = readHostedWorkerEnvironment(key => Netlify.env.get(key));
  if (!authorizedWorkerRequest(request.headers.get("authorization"), environment.ROLEDAWN_WORKER_DISPATCH_SECRET)) return new Response(null, { status: 401 });
  const client = createSupabaseAdminClient("hosted-worker-health/1", environment);
  const { data, error } = await client.from("hosted_worker_lanes" as never).select("lane,status,lease_expires_at,last_started_at,last_finished_at,last_error_code,last_summary,completed_runs,failed_runs");
  if (error) return Response.json({ status: "unavailable" }, { status: 503 });
  return Response.json({ enabled: hostedWorkersEnabled(environment, context.deploy), deploy: context.deploy.id, lanes: data }, { headers: { "Cache-Control": "private, no-store" } });
};
import type { Context } from "@netlify/functions";
