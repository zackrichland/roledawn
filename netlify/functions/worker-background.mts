import type { Config, Context } from "@netlify/functions";
import { runHostedWorker } from "../../src/server/workers/hosted-worker.ts";
import { authorizedWorkerRequest, parseHostedWorkerLane } from "../../src/server/workers/hosted-worker-control.ts";
import { hostedWorkersEnabled, readHostedWorkerEnvironment } from "../../src/server/workers/hosted-worker-environment.ts";

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
};

export const config: Config = { background: true };
