import type {
  ApplicationFillRuntimeSupervisor,
  ComputerRuntimeAdapter,
  ComputerRuntimeUsage,
  ProvisionedComputerRuntime,
  RetainedApplicationFillRuntime,
} from "./application-fill.ts";

export const APPLICATION_FILL_RUNTIME_SUPERVISOR_RELEASE =
  "application-fill-runtime-supervisor/1";

export type ApplicationFillRuntimeReleaseEvent = Readonly<{
  computerSessionId: string;
  fillAttemptId: string;
  reason: "TTL_EXPIRED" | "WORKER_STOPPED";
  outcome: "RELEASED" | "RELEASE_UNCERTAIN";
  usage: ComputerRuntimeUsage | null;
  errorCode: string | null;
}>;

export type ApplicationFillRuntimeSupervisorSnapshot = Readonly<{
  release: typeof APPLICATION_FILL_RUNTIME_SUPERVISOR_RELEASE;
  accepting: boolean;
  retainedCount: number;
}>;

type RetainedEntry = {
  fillAttemptId: string;
  expiresAtMs: number;
  runtimeAdapter: ComputerRuntimeAdapter;
  runtime: ProvisionedComputerRuntime;
  cancelExpiry: () => void;
  operation: Promise<void> | null;
};

type SupervisorDependencies = Readonly<{
  now?: () => number;
  schedule?: (
    delayMs: number,
    task: () => Promise<void>,
  ) => () => void;
  onRelease?: (
    event: ApplicationFillRuntimeReleaseEvent,
  ) => void | Promise<void>;
}>;

function defaultSchedule(
  delayMs: number,
  task: () => Promise<void>,
): () => void {
  const timer = setTimeout(() => {
    void task();
  }, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}

function safeReleaseErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,119}$/u.test(error.message)
  ) return error.message;
  return "APPLICATION_FILL_RUNTIME_RELEASE_FAILED";
}

function validUsage(usage: ComputerRuntimeUsage): boolean {
  return [
    usage.wallClockMs,
    usage.providerBilledMs,
    usage.uploadedByteCount,
    usage.blockedSubmissionAttemptCount,
    usage.outboundSubmissionRequestCount,
  ].every((value) => Number.isSafeInteger(value) && value >= 0) &&
    usage.outboundSubmissionRequestCount === 0;
}

/**
 * Keeps the worker's guarded CDP connection alive while a candidate reviews
 * or takes over a no-submit fill. Provider identifiers remain inside the
 * opaque runtime. The supervisor owns teardown on TTL or graceful shutdown.
 *
 * This is intentionally process-scoped. A production deployment still needs
 * one continuously running worker instance and durable release reconciliation
 * before retained sessions can be treated as production-complete.
 */
export function createApplicationFillRuntimeSupervisor(
  dependencies: SupervisorDependencies = {},
): ApplicationFillRuntimeSupervisor & Readonly<{
  stop(): Promise<void>;
  snapshot(): ApplicationFillRuntimeSupervisorSnapshot;
}> {
  const now = dependencies.now ?? Date.now;
  const schedule = dependencies.schedule ?? defaultSchedule;
  const retained = new Map<string, RetainedEntry>();
  let accepting = true;

  async function release(
    computerSessionId: string,
    reason: ApplicationFillRuntimeReleaseEvent["reason"],
  ): Promise<void> {
    const entry = retained.get(computerSessionId);
    if (!entry) return;
    retained.delete(computerSessionId);
    entry.cancelExpiry();
    // A TTL or graceful stop may race the candidate's continuation. Wait for
    // the bounded callback (including its database completion) before
    // destroying the guarded runtime and reconciling its release.
    await entry.operation?.catch(() => undefined);
    let event: ApplicationFillRuntimeReleaseEvent;
    try {
      const usage = await entry.runtimeAdapter.destroy(entry.runtime);
      if (!validUsage(usage)) {
        throw new Error("APPLICATION_FILL_RUNTIME_RELEASE_TELEMETRY_UNCERTAIN");
      }
      event = Object.freeze({
        computerSessionId,
        fillAttemptId: entry.fillAttemptId,
        reason,
        outcome: "RELEASED" as const,
        usage,
        errorCode: null,
      });
    } catch (error) {
      event = Object.freeze({
        computerSessionId,
        fillAttemptId: entry.fillAttemptId,
        reason,
        outcome: "RELEASE_UNCERTAIN" as const,
        usage: null,
        errorCode: safeReleaseErrorCode(error),
      });
    }
    // Teardown and its durable database reconciliation are one supervised
    // operation. Graceful shutdown does not complete while the control plane
    // still thinks this released browser is PAUSED_FOR_REVIEW.
    await dependencies.onRelease?.(event);
  }

  return Object.freeze({
    async retain(input: RetainedApplicationFillRuntime) {
      if (!accepting) throw new Error("APPLICATION_FILL_RUNTIME_SUPERVISOR_STOPPED");
      if (
        !Number.isSafeInteger(input.expiresAtMs) ||
        input.expiresAtMs <= now()
      ) throw new Error("APPLICATION_FILL_RUNTIME_RETENTION_EXPIRED");
      if (retained.has(input.computerSessionId)) {
        throw new Error("APPLICATION_FILL_RUNTIME_ALREADY_RETAINED");
      }
      const delayMs = input.expiresAtMs - now();
      let cancelExpiry: () => void = () => {};
      cancelExpiry = schedule(delayMs, () =>
        release(input.computerSessionId, "TTL_EXPIRED"));
      retained.set(input.computerSessionId, {
        fillAttemptId: input.fillAttemptId,
        expiresAtMs: input.expiresAtMs,
        runtimeAdapter: input.runtimeAdapter,
        runtime: input.runtime,
        cancelExpiry,
        operation: null,
      });
    },
    async resume<T>(input: Readonly<{
      computerSessionId: string;
      fillAttemptId: string;
      run(runtime: ProvisionedComputerRuntime): Promise<T>;
    }>): Promise<T> {
      if (!accepting) throw new Error("APPLICATION_FILL_RUNTIME_SUPERVISOR_STOPPED");
      const entry = retained.get(input.computerSessionId);
      if (!entry) throw new Error("APPLICATION_FILL_RUNTIME_NOT_RETAINED");
      if (entry.fillAttemptId !== input.fillAttemptId) {
        throw new Error("APPLICATION_FILL_RUNTIME_BINDING_MISMATCH");
      }
      if (entry.expiresAtMs <= now()) {
        await release(input.computerSessionId, "TTL_EXPIRED");
        throw new Error("APPLICATION_FILL_RUNTIME_RETENTION_EXPIRED");
      }
      if (entry.operation) throw new Error("APPLICATION_FILL_RUNTIME_BUSY");

      const task = Promise.resolve().then(() => input.run(entry.runtime));
      const completion = task.then(() => undefined, () => undefined);
      entry.operation = completion;
      try {
        return await task;
      } finally {
        if (entry.operation === completion) entry.operation = null;
      }
    },
    async stop() {
      if (!accepting && retained.size === 0) return;
      accepting = false;
      await Promise.all(
        [...retained.keys()].map((computerSessionId) =>
          release(computerSessionId, "WORKER_STOPPED")),
      );
    },
    snapshot() {
      return Object.freeze({
        release: APPLICATION_FILL_RUNTIME_SUPERVISOR_RELEASE,
        accepting,
        retainedCount: retained.size,
      });
    },
  });
}
