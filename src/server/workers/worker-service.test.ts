import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import {
  computeWorkerBackoffMs,
  createWorkerService,
  parseWorkerServiceEnvironment,
  shouldLogWorkerOutcome,
  startWorkerHealthServer,
  summarizeWorkerOutcome,
  WORKER_SERVICE_RELEASE,
  type WorkerServiceLogEvent,
  type WorkerServiceSnapshot,
} from "./worker-service.ts";

function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("TEST_WAIT_TIMEOUT"));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}

test("parses bounded service settings without treating provider secrets as service config", () => {
  const defaults = parseWorkerServiceEnvironment({});
  assert.deepEqual(defaults, {
    healthHost: "0.0.0.0",
    healthPort: 8788,
    catalogIntervalMs: 30_000,
    preparationIntervalMs: 2_000,
    kitIntervalMs: 2_000,
    fillIntervalMs: 5_000,
    busyIntervalMs: 250,
    errorBackoffBaseMs: 1_000,
    errorBackoffMaxMs: 60_000,
  });

  const configured = parseWorkerServiceEnvironment({
    PORT: "9090",
    ROLEDAWN_WORKER_HEALTH_HOST: "127.0.0.1",
    ROLEDAWN_WORKER_CATALOG_INTERVAL_MS: "100",
    ROLEDAWN_WORKER_ERROR_BACKOFF_BASE_MS: "200",
    ROLEDAWN_WORKER_ERROR_BACKOFF_MAX_MS: "400",
  });
  assert.equal(configured.healthPort, 9090);
  assert.equal(configured.healthHost, "127.0.0.1");
  assert.equal(configured.catalogIntervalMs, 100);
  assert.equal(configured.errorBackoffBaseMs, 200);
  assert.equal(configured.errorBackoffMaxMs, 400);

  assert.throws(
    () => parseWorkerServiceEnvironment({ ROLEDAWN_WORKER_HEALTH_HOST: "host/path" }),
    /ROLEDAWN_WORKER_HEALTH_HOST_INVALID/u,
  );
  assert.throws(
    () => parseWorkerServiceEnvironment({
      ROLEDAWN_WORKER_ERROR_BACKOFF_BASE_MS: "1000",
      ROLEDAWN_WORKER_ERROR_BACKOFF_MAX_MS: "100",
    }),
    /ROLEDAWN_WORKER_ERROR_BACKOFF_RANGE_INVALID/u,
  );
});

test("redacts provider and session identifiers from structured outcomes", () => {
  assert.deepEqual(summarizeWorkerOutcome({
    kind: "COMPLETED",
    claimed: 1,
    completed: 1,
    failed: 0,
    observedCount: 14,
    sourceId: "private-source-id",
    ingestionRunId: "private-run-id",
    connectUrl: "wss://secret.example",
    arbitrary: "not logged",
  }), {
    claimed: 1,
    completed: 1,
    failed: 0,
    kind: "COMPLETED",
    observedCount: 14,
  });
});

test("logs claimed work but suppresses repetitive successful idle polls", () => {
  assert.equal(shouldLogWorkerOutcome({
    kind: "IDLE",
    claimed: 0,
    completed: 0,
    failed: 0,
  }), false);
  assert.equal(shouldLogWorkerOutcome({
    kind: "COMPLETED",
    claimed: 1,
    completed: 1,
    failed: 0,
  }), true);
  assert.equal(shouldLogWorkerOutcome({ observedCount: 14 }), true);
});

test("exponential backoff is capped and never retries faster than the base", () => {
  assert.equal(computeWorkerBackoffMs(100, 1_000, 1, 0), 100);
  assert.equal(computeWorkerBackoffMs(100, 1_000, 2, 0.5), 220);
  assert.equal(computeWorkerBackoffMs(100, 1_000, 10, 1), 1_000);
  assert.throws(() => computeWorkerBackoffMs(100, 10, 1, 0), /WORKER_BACKOFF_INPUT_INVALID/u);
});

test("lanes progress independently, back off on failure, never overlap themselves, and stop cleanly", async () => {
  const logs: WorkerServiceLogEvent[] = [];
  let catalogRuns = 0;
  let preparationRuns = 0;
  let activeCatalog = 0;
  let maxActiveCatalog = 0;
  const service = createWorkerService([
    {
      name: "catalog",
      idleIntervalMs: 10,
      busyIntervalMs: 10,
      errorBackoffBaseMs: 30,
      errorBackoffMaxMs: 60,
      async run() {
        catalogRuns += 1;
        activeCatalog += 1;
        maxActiveCatalog = Math.max(maxActiveCatalog, activeCatalog);
        try {
          if (catalogRuns === 1) throw new Error("JOB_SOURCE_CLAIM_FAILED");
          return { kind: "IDLE", claimed: 0, completed: 0, failed: 0 };
        } finally {
          activeCatalog -= 1;
        }
      },
    },
    {
      name: "preparation",
      idleIntervalMs: 10,
      busyIntervalMs: 10,
      errorBackoffBaseMs: 30,
      errorBackoffMaxMs: 60,
      async run() {
        preparationRuns += 1;
        return { claimed: 0, completed: 0, failed: 0 };
      },
    },
  ], {
    random: () => 0,
    log: (event) => logs.push(event),
  });

  service.start();
  await waitUntil(() => catalogRuns >= 2 && preparationRuns >= 3);
  const running = service.snapshot();
  assert.equal(running.ready, true);
  assert.equal(maxActiveCatalog, 1);
  assert.ok(preparationRuns > catalogRuns);
  assert.equal(
    logs.find((event) => event.event === "worker_lane_failed")?.error_code,
    "JOB_SOURCE_CLAIM_FAILED",
  );
  assert.equal(
    logs.some((event) => event.event === "worker_lane_started"),
    false,
  );
  assert.equal(
    logs.some((event) => event.event === "worker_lane_completed"),
    false,
  );
  assert.equal(JSON.stringify(logs).includes("private"), false);

  service.stop("test_complete");
  await service.wait();
  const stopped = service.snapshot();
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.ready, false);
  assert.ok(stopped.lanes.every((lane) => lane.status === "STOPPED"));
});

test("health server separates liveness from readiness and exposes no credentials", async () => {
  let ready = false;
  const snapshot = (): WorkerServiceSnapshot => Object.freeze({
    release: WORKER_SERVICE_RELEASE,
    status: "RUNNING",
    ready,
    startedAt: "2026-08-18T00:00:00.000Z",
    stoppingReason: null,
    lanes: Object.freeze([]),
  });
  const health = await startWorkerHealthServer({ snapshot }, { host: "127.0.0.1", port: 0 });
  try {
    const live = await fetch(`${health.address}/live`);
    assert.equal(live.status, 200);
    const notReady = await fetch(`${health.address}/ready`);
    assert.equal(notReady.status, 503);
    ready = true;
    const nowReady = await fetch(`${health.address}/health`);
    assert.equal(nowReady.status, 200);
    assert.equal((await nowReady.text()).includes("BROWSERBASE_API_KEY"), false);
    const missing = await fetch(`${health.address}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    // fetch keeps connections alive; close() alone can wait on them indefinitely.
    health.server.close();
    health.server.closeAllConnections();
    await once(health.server, "close");
  }
});
