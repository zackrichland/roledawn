type EntrypointWorkerService = Readonly<{
  stop(reason?: string): void;
  wait(): Promise<void>;
}>;

type FillRuntimeSupervisor = Readonly<{
  stop(): Promise<void>;
}>;

type WorkerEntrypointShutdownDependencies = Readonly<{
  service: EntrypointWorkerService;
  closeHealthServer(): Promise<void>;
  fillRuntimeSupervisor: FillRuntimeSupervisor;
}>;

export type WorkerEntrypointShutdownCoordinator = Readonly<{
  requestStop(signal: NodeJS.Signals): Promise<void>;
  waitForExit(): Promise<void>;
}>;

/**
 * Own the entrypoint's one graceful-shutdown promise.
 *
 * Lane loops must stop before retained browser runtimes are released, and the
 * executable must not exit until the runtime supervisor has completed its
 * durable release reconciliation.
 */
export function createWorkerEntrypointShutdownCoordinator(
  dependencies: WorkerEntrypointShutdownDependencies,
): WorkerEntrypointShutdownCoordinator {
  let stopPromise: Promise<void> | null = null;

  function requestStop(signal: NodeJS.Signals): Promise<void> {
    stopPromise ??= (async () => {
      dependencies.service.stop(signal);
      await dependencies.closeHealthServer();
      await dependencies.service.wait();
      await dependencies.fillRuntimeSupervisor.stop();
    })();
    return stopPromise;
  }

  async function waitForExit(): Promise<void> {
    await dependencies.service.wait();
    // `service.wait()` resolves as soon as lane loops stop. A signal-triggered
    // shutdown may still be destroying and reconciling retained runtimes.
    if (stopPromise) await stopPromise;
  }

  return Object.freeze({ requestStop, waitForExit });
}
