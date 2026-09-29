import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { runPreparationWorkerOnce } from "./outbox-worker.ts";
import { runApplicationKitWorkerOnce } from "./application-kit.ts";
import { runApplicationAutopilotWorkerOnce, runApplicationAutopilotCleanup } from "./application-autopilot.ts";
import { runJobSourceBatchWorker } from "./job-source-batch-worker.ts";
import { createApplicationAgentCleanupRepository, runApplicationAgentCleanup } from "./application-agent-cleanup.ts";
import { createApplicationAgentStore } from "./application-agent-store.ts";
import { createOpenAIAgentsClient } from "./openai-agents-client.ts";
import { runResumeUploadCleanupWorker } from "../vault/resume-upload-maintenance.ts";
import { runAutoApplyWorkerOnce } from "./auto-apply.ts";
import { runSendIntentSweep } from "./send-intents.ts";

import { coordinateHostedWorker, runIndependentMaintenance, type HostedWorkerLane, type HostedWorkerSummary, type WorkerDatabase } from "./hosted-worker-control.ts";

export async function runHostedWorker(lane: HostedWorkerLane, environment: NodeJS.ProcessEnv) {
  const client = createSupabaseAdminClient("hosted-worker/1", environment);
  return coordinateHostedWorker({ lane, database: client as unknown as WorkerDatabase, async execute(): Promise<HostedWorkerSummary> {
    if (lane === "catalog") {
      const result = await runJobSourceBatchWorker({ maxMilliseconds: 600_000, maxSources: 100, concurrency: 2 }, environment);
      return { claimed: result.attempted, completed: result.completed, failed: result.failed, uncertain: result.uncertain, observedJobs: result.observedJobs };
    }
    if (lane === "preparation") return { ...await runPreparationWorkerOnce(environment) };
    if (lane === "kit") return { ...await runApplicationKitWorkerOnce(environment) };
    if (lane === "auto-apply") return { ...await runAutoApplyWorkerOnce(environment) };
    if (lane === "autopilot") {
      const result = await runApplicationAutopilotWorkerOnce(environment);
      return { claimed: result.claimed, completed: result.completed, failed: result.failed };
    }
    return runIndependentMaintenance([
      () => runSendIntentSweep(environment),
      () => runApplicationAutopilotCleanup(environment),
      async () => {
        const result = await runApplicationAgentCleanup(createApplicationAgentCleanupRepository(client),
          createOpenAIAgentsClient({ apiKey: environment.OPENAI_API_KEY ?? "" }), createApplicationAgentStore(client));
        return { claimed: result.completed + result.failed, completed: result.completed, failed: result.failed };
      },
      async () => {
        const result = await runResumeUploadCleanupWorker({ limit: 25 }, environment);
        return { claimed: result.checked, completed: result.removed, failed: result.failed };
      },
    ]);
  } });
}
