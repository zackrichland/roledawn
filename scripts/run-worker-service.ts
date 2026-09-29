import {
  createSupabaseApplicationFillRuntimeReleaseDatabase,
  runApplicationFillRecoveryOnce,
  runApplicationFillWorkerOnce,
} from "../src/server/workers/application-fill.ts";
import {
  APPLICATION_FILL_RUNTIME_SUPERVISOR_RELEASE,
  createApplicationFillRuntimeSupervisor,
} from "../src/server/workers/application-fill-runtime-supervisor.ts";
import { runApplicationFillResumeWorkerOnce } from "../src/server/workers/application-fill-resume.ts";
import { runApplicationKitWorkerOnce } from "../src/server/workers/application-kit.ts";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
import { createBrowserbaseRuntimeAdapterForNodeWorker } from "../src/server/workers/browserbase-runtime.node.ts";
import { createApplicationFormDriver } from "../src/server/workers/application-form-driver.ts";
import { createApplicationAgentCleanupRepository, runApplicationAgentCleanup } from "../src/server/workers/application-agent-cleanup.ts";
import { createApplicationAgentStore } from "../src/server/workers/application-agent-store.ts";
import { createOpenAIAgentsClient } from "../src/server/workers/openai-agents-client.ts";
import { runJobSourceWorkerOnce } from "../src/server/workers/job-source-worker.ts";
import { runPreparationWorkerOnce } from "../src/server/workers/outbox-worker.ts";
import {
  createWorkerService,
  parseWorkerServiceEnvironment,
  startWorkerHealthServer,
  type WorkerLaneConfiguration,
  type WorkerServiceLogEvent,
} from "../src/server/workers/worker-service.ts";
import { createWorkerEntrypointShutdownCoordinator } from "./run-worker-service-lifecycle.ts";
import { runApplicationAutopilotCleanup, runApplicationAutopilotWorkerOnce } from "../src/server/workers/application-autopilot.ts";
import { runAutoApplyWorkerOnce } from "../src/server/workers/auto-apply.ts";
import { runSendIntentSweep } from "../src/server/workers/send-intents.ts";

const configuration = parseWorkerServiceEnvironment(process.env);

function writeLog(event: WorkerServiceLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

const fillRuntimeReleaseDatabase =
  createSupabaseApplicationFillRuntimeReleaseDatabase(
    createSupabaseAdminClient("fill-runtime-release-reconciler/1"),
  );

const fillRuntimeSupervisor = createApplicationFillRuntimeSupervisor({
  async onRelease(event) {
    const reconciliation =
      await fillRuntimeReleaseDatabase.reconcileRuntimeRelease({
        ...event,
        supervisorRelease: APPLICATION_FILL_RUNTIME_SUPERVISOR_RELEASE,
      });
    writeLog(Object.freeze({
      timestamp: new Date().toISOString(),
      release: "roledawn-worker-service/1",
      level: event.outcome === "RELEASED" ? "info" : "error",
      event: "fill_review_runtime_released",
      lane: "fill",
      outcome: Object.freeze({
        kind: event.reason,
        completed: event.outcome === "RELEASED" ? 1 : 0,
        failed: event.outcome === "RELEASED" ? 0 : 1,
        outcome: reconciliation.computerSessionState,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      }),
    }));
  },
});

let fillDependenciesPromise: Promise<Readonly<{
  runtimeAdapter: Awaited<ReturnType<typeof createBrowserbaseRuntimeAdapterForNodeWorker>>;
  formDriver: ReturnType<typeof createApplicationFormDriver>;
}>> | null = null;

function loadFillDependencies() {
  fillDependenciesPromise ??= createBrowserbaseRuntimeAdapterForNodeWorker(process.env)
    .then((runtimeAdapter) => Object.freeze({
      runtimeAdapter,
      formDriver: createApplicationFormDriver(process.env),
    }))
    .catch((error) => {
      // A configuration or provider outage is retried by the fill lane's
      // bounded backoff. Other lanes remain independently available.
      fillDependenciesPromise = null;
      throw error;
    });
  return fillDependenciesPromise;
}

const commonLaneConfiguration = Object.freeze({
  busyIntervalMs: configuration.busyIntervalMs,
  errorBackoffBaseMs: configuration.errorBackoffBaseMs,
  errorBackoffMaxMs: configuration.errorBackoffMaxMs,
});

const lanes: readonly WorkerLaneConfiguration[] = Object.freeze([
  ...(process.env.ROLEDAWN_AUTOPILOT_ENABLED === "true" ? [{
    name: "autopilot" as const,
    idleIntervalMs: configuration.fillIntervalMs,
    ...commonLaneConfiguration,
    run: runApplicationAutopilotWorkerOnce,
  }, {
    // Account autopilot: choose the next strong match for candidates who
    // turned it on. The database enforces consent and the send rate.
    name: "auto_apply" as const,
    idleIntervalMs: 30_000,
    ...commonLaneConfiguration,
    run: runAutoApplyWorkerOnce,
  }, {
    // "Apply" pressed before files were ready: send once they are.
    name: "send_intents" as const,
    idleIntervalMs: 15_000,
    ...commonLaneConfiguration,
    run: runSendIntentSweep,
  }] : []),
  // Cleanup continues when new delegations are disabled.
  ...(process.env.ROLEDAWN_FORM_DRIVER === "agents" ? [{
    name: "autopilot_cleanup" as const,
    idleIntervalMs: 60_000,
    ...commonLaneConfiguration,
    run: runApplicationAutopilotCleanup,
  }] : []),
  ...(process.env.ROLEDAWN_FORM_DRIVER === "agents" ? [{
    name: "agent_cleanup" as const,
    idleIntervalMs: 60_000,
    ...commonLaneConfiguration,
    async run() {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");
      const supabase = createSupabaseAdminClient("application-agent-cleanup/1");
      return runApplicationAgentCleanup(createApplicationAgentCleanupRepository(supabase),
        createOpenAIAgentsClient({ apiKey }), createApplicationAgentStore(supabase));
    },
  }] : []),
  {
    name: "catalog",
    idleIntervalMs: configuration.catalogIntervalMs,
    ...commonLaneConfiguration,
    run: runJobSourceWorkerOnce,
  },
  {
    name: "preparation",
    idleIntervalMs: configuration.preparationIntervalMs,
    ...commonLaneConfiguration,
    run: runPreparationWorkerOnce,
  },
  {
    name: "kit",
    idleIntervalMs: configuration.kitIntervalMs,
    ...commonLaneConfiguration,
    run: runApplicationKitWorkerOnce,
  },
  {
    name: "fill",
    idleIntervalMs: configuration.fillIntervalMs,
    ...commonLaneConfiguration,
    async run() {
      const { runtimeAdapter, formDriver } = await loadFillDependencies();
      // Recovery always precedes new claims. A crash-stranded attempt is
      // reattached or failed safe before another fill is provisioned.
      const recovery = await runApplicationFillRecoveryOnce({
        runtimeAdapter,
        formDriver,
        runtimeSupervisor: fillRuntimeSupervisor,
      });
      const resume = await runApplicationFillResumeWorkerOnce({
        formDriver,
        runtimeSupervisor: fillRuntimeSupervisor,
      });
      const fill = await runApplicationFillWorkerOnce({
        runtimeAdapter,
        formDriver,
        runtimeSupervisor: fillRuntimeSupervisor,
      });
      return Object.freeze({
        kind: "FILL_CYCLE",
        claimed: recovery.claimed + resume.claimed + fill.claimed,
        completed: resume.completed + fill.completed,
        failed: resume.failed + fill.failed,
        recovered: recovery.recovered,
        failedSafe: recovery.failedSafe,
      });
    },
  },
]);

const service = createWorkerService(lanes, { log: writeLog });
const health = await startWorkerHealthServer(service, {
  host: configuration.healthHost,
  port: configuration.healthPort,
  log: writeLog,
});
writeLog(Object.freeze({
  timestamp: new Date().toISOString(),
  release: "roledawn-worker-service/1",
  level: "info",
  event: "worker_health_listening",
  reason: health.address,
}));

const shutdown = createWorkerEntrypointShutdownCoordinator({
  service,
  closeHealthServer: () => new Promise<void>((resolve) => {
    health.server.close(() => resolve());
  }),
  fillRuntimeSupervisor,
});

process.once("SIGINT", () => { void shutdown.requestStop("SIGINT"); });
process.once("SIGTERM", () => { void shutdown.requestStop("SIGTERM"); });

service.start();
await shutdown.waitForExit();
