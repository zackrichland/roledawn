import type { Config, Context } from "@netlify/functions";
import { runHostedWorker } from "../../src/server/workers/hosted-worker.ts";
import { authorizedWorkerRequest, parseHostedWorkerLane } from "../../src/server/workers/hosted-worker-control.ts";
import { hostedWorkersEnabled, readHostedWorkerEnvironment } from "../../src/server/workers/hosted-worker-environment.ts";
import { APPLICATION_PIPELINE_LANES, dispatchDueHostedWorkers } from "../../src/server/workers/hosted-worker-wakeup.ts";

export default async function workerBackground(request: Request, context: Context) {
  const environment = readHostedWorkerEnvironment(key => Netlify.env.get(key));
  if (!hostedWorkersEnabled(environment, context.deploy)) return;
  if (request.method !== "POST" || !authorizedWorkerRequest(request.headers.get("authorization"), environment.ROLEDAWN_WORKER_DISPATCH_SECRET)) return;
  // No URLs, candidate IDs, scripts or policy overrides can enter through this endpoint.
  const text = await request.text();
  if (text.length > 100) return;
  let lane;
  try { lane = parseHostedWorkerLane((JSON.parse(text) as { lane?: unknown }).lane); } catch { return; }
  const result = await runHostedWorker(lane, environment);
  console.info(JSON.stringify({ event: "hosted_worker_finished", lane, ...result }));
  // A resolver can enqueue a snapshot, a snapshot a kit, and a kit a send.
  // Wake those durable successors after releasing this lane instead of adding
  // a minute of idle time at each boundary. An occupied/empty lane never loops.
  if (result.claimed && typeof result.summary?.completed === "number" && result.summary.completed > 0) {
    try {
      await dispatchDueHostedWorkers(environment, { lanes: APPLICATION_PIPELINE_LANES });
    } catch {
      console.warn(JSON.stringify({ event: "hosted_worker_wakeup_deferred", lane }));
    }
  }
};

export const config: Config = { background: true };
