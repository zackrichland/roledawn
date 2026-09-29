import assert from "node:assert/strict";
import test from "node:test";

import { createWorkerEntrypointShutdownCoordinator } from "./run-worker-service-lifecycle.ts";

function deferred(): Readonly<{
  promise: Promise<void>;
  resolve(): void;
}> {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve() {
      resolvePromise?.();
    },
  });
}

test("entrypoint awaits lane stop and retained-runtime reconciliation before exit", async () => {
  const events: string[] = [];
  const serviceStopped = deferred();
  const supervisorStopped = deferred();

  const coordinator = createWorkerEntrypointShutdownCoordinator({
    service: {
      stop(reason) {
        events.push(`service.stop:${reason}`);
      },
      async wait() {
        events.push("service.wait");
        await serviceStopped.promise;
      },
    },
    async closeHealthServer() {
      events.push("health.close");
    },
    fillRuntimeSupervisor: {
      async stop() {
        events.push("fillRuntimeSupervisor.stop:start");
        await supervisorStopped.promise;
        events.push("fillRuntimeSupervisor.stop:end");
      },
    },
  });

  const stopPromise = coordinator.requestStop("SIGTERM");
  assert.equal(coordinator.requestStop("SIGINT"), stopPromise);

  let entrypointExited = false;
  const entrypoint = coordinator.waitForExit().then(() => {
    entrypointExited = true;
    events.push("entrypoint.exit");
  });

  await Promise.resolve();
  assert.deepEqual(events.slice(0, 2), ["service.stop:SIGTERM", "health.close"]);
  assert.equal(entrypointExited, false);

  serviceStopped.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(events.includes("fillRuntimeSupervisor.stop:start"), true);
  assert.equal(entrypointExited, false);

  supervisorStopped.resolve();
  await Promise.all([stopPromise, entrypoint]);
  assert.ok(
    events.indexOf("fillRuntimeSupervisor.stop:end") < events.indexOf("entrypoint.exit"),
  );
  assert.equal(events.filter((event) => event === "fillRuntimeSupervisor.stop:start").length, 1);
});
