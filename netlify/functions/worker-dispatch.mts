import type { Config, Context } from "@netlify/functions";
import { hostedScheduleEnabled, readHostedWorkerEnvironment } from "../../src/server/workers/hosted-worker-environment.ts";
import { dispatchDueHostedWorkers } from "../../src/server/workers/hosted-worker-wakeup.ts";

export default async function workerDispatch(_request: Request, context: Context) {
  const environment = readHostedWorkerEnvironment(key => Netlify.env.get(key));
  if (!hostedScheduleEnabled(environment, context.deploy)) {
    console.info(JSON.stringify({ event: "hosted_worker_dispatch_disabled", context: context.deploy.context,
      published: context.deploy.published, enabled: environment.ROLEDAWN_HOSTED_WORKERS_ENABLED === "true", deploy: context.deploy.id }));
    return;
  }
  const accepted = await dispatchDueHostedWorkers(environment);
  console.info(JSON.stringify({ event: "hosted_worker_dispatch", accepted }));
};

export const config: Config = { schedule: "* * * * *" };
