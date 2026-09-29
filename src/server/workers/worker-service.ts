import { createServer, type Server } from "node:http";

export const WORKER_SERVICE_RELEASE = "roledawn-worker-service/1";

export type WorkerLaneName = "catalog" | "preparation" | "kit" | "fill" | "agent_cleanup" | "autopilot" | "autopilot_cleanup" | "auto_apply" | "send_intents";

export type WorkerLaneOutcome = Readonly<{
  claimed?: number;
  completed?: number;
  failed?: number;
  recovered?: number;
  failedSafe?: number;
  kind?: string;
  outcome?: string;
  observedCount?: number;
  retryable?: boolean;
  errorCode?: string;
}>;

export type WorkerLaneConfiguration = Readonly<{
  name: WorkerLaneName;
  idleIntervalMs: number;
  busyIntervalMs: number;
  errorBackoffBaseMs: number;
  errorBackoffMaxMs: number;
  run: () => Promise<WorkerLaneOutcome>;
}>;

export type WorkerServiceLogEvent = Readonly<{
  timestamp: string;
  release: typeof WORKER_SERVICE_RELEASE;
  level: "info" | "error";
  event: string;
  lane?: WorkerLaneName;
  duration_ms?: number;
  delay_ms?: number;
  outcome?: WorkerLaneOutcome;
  error_code?: string;
  reason?: string;
}>;

export type WorkerLaneSnapshot = Readonly<{
  name: WorkerLaneName;
  status: "STARTING" | "RUNNING" | "WAITING" | "BACKING_OFF" | "STOPPED";
  runCount: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  nextRunAt: string | null;
  lastErrorCode: string | null;
  lastOutcome: WorkerLaneOutcome | null;
}>;

export type WorkerServiceSnapshot = Readonly<{
  release: typeof WORKER_SERVICE_RELEASE;
  status: "STARTING" | "RUNNING" | "STOPPING" | "STOPPED";
  ready: boolean;
  startedAt: string | null;
  stoppingReason: string | null;
  lanes: readonly WorkerLaneSnapshot[];
}>;

export type WorkerService = Readonly<{
  start(): void;
  stop(reason?: string): void;
  wait(): Promise<void>;
  snapshot(): WorkerServiceSnapshot;
}>;

export type WorkerServiceEnvironment = Readonly<{
  healthHost: string;
  healthPort: number;
  catalogIntervalMs: number;
  preparationIntervalMs: number;
  kitIntervalMs: number;
  fillIntervalMs: number;
  busyIntervalMs: number;
  errorBackoffBaseMs: number;
  errorBackoffMaxMs: number;
}>;

type MutableWorkerLaneState = {
  name: WorkerLaneName;
  status: WorkerLaneSnapshot["status"];
  runCount: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  nextRunAt: string | null;
  lastErrorCode: string | null;
  lastOutcome: WorkerLaneOutcome | null;
};

type WorkerServiceDependencies = Readonly<{
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  log?: (event: WorkerServiceLogEvent) => void;
}>;

const DEFAULT_HEALTH_PORT = 8788;
const MIN_INTERVAL_MS = 10;
const MAX_INTERVAL_MS = 60 * 60 * 1_000;

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum = MIN_INTERVAL_MS,
  maximum = MAX_INTERVAL_MS,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label}_INVALID`);
  }
  return parsed;
}

export function parseWorkerServiceEnvironment(
  environment: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): WorkerServiceEnvironment {
  const healthHost = environment.ROLEDAWN_WORKER_HEALTH_HOST?.trim() || "0.0.0.0";
  if (
    healthHost.length > 255 || /[\r\n/]/u.test(healthHost) ||
    !/^[a-zA-Z0-9.:-]+$/u.test(healthHost)
  ) {
    throw new Error("ROLEDAWN_WORKER_HEALTH_HOST_INVALID");
  }
  const healthPort = parseBoundedInteger(
    environment.ROLEDAWN_WORKER_HEALTH_PORT ?? environment.PORT,
    DEFAULT_HEALTH_PORT,
    "ROLEDAWN_WORKER_HEALTH_PORT",
    1,
    65_535,
  );
  const errorBackoffBaseMs = parseBoundedInteger(
    environment.ROLEDAWN_WORKER_ERROR_BACKOFF_BASE_MS,
    1_000,
    "ROLEDAWN_WORKER_ERROR_BACKOFF_BASE_MS",
  );
  const errorBackoffMaxMs = parseBoundedInteger(
    environment.ROLEDAWN_WORKER_ERROR_BACKOFF_MAX_MS,
    60_000,
    "ROLEDAWN_WORKER_ERROR_BACKOFF_MAX_MS",
  );
  if (errorBackoffMaxMs < errorBackoffBaseMs) {
    throw new Error("ROLEDAWN_WORKER_ERROR_BACKOFF_RANGE_INVALID");
  }
  return Object.freeze({
    healthHost,
    healthPort,
    catalogIntervalMs: parseBoundedInteger(
      environment.ROLEDAWN_WORKER_CATALOG_INTERVAL_MS,
      30_000,
      "ROLEDAWN_WORKER_CATALOG_INTERVAL_MS",
    ),
    preparationIntervalMs: parseBoundedInteger(
      environment.ROLEDAWN_WORKER_PREPARATION_INTERVAL_MS,
      2_000,
      "ROLEDAWN_WORKER_PREPARATION_INTERVAL_MS",
    ),
    kitIntervalMs: parseBoundedInteger(
      environment.ROLEDAWN_WORKER_KIT_INTERVAL_MS,
      2_000,
      "ROLEDAWN_WORKER_KIT_INTERVAL_MS",
    ),
    fillIntervalMs: parseBoundedInteger(
      environment.ROLEDAWN_WORKER_FILL_INTERVAL_MS,
      5_000,
      "ROLEDAWN_WORKER_FILL_INTERVAL_MS",
    ),
    busyIntervalMs: parseBoundedInteger(
      environment.ROLEDAWN_WORKER_BUSY_INTERVAL_MS,
      250,
      "ROLEDAWN_WORKER_BUSY_INTERVAL_MS",
    ),
    errorBackoffBaseMs,
    errorBackoffMaxMs,
  });
}

function normalizeCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 120 || /[\r\n]/u.test(normalized)) return undefined;
  return normalized;
}

/**
 * Allowlist worker result fields before they reach logs or health responses.
 * Provider/session identifiers and arbitrary error messages remain private.
 */
export function summarizeWorkerOutcome(value: unknown): WorkerLaneOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  const candidate = value as Readonly<Record<string, unknown>>;
  return Object.freeze({
    ...(normalizeCount(candidate.claimed) === undefined ? {} : { claimed: normalizeCount(candidate.claimed) }),
    ...(normalizeCount(candidate.completed) === undefined ? {} : { completed: normalizeCount(candidate.completed) }),
    ...(normalizeCount(candidate.failed) === undefined ? {} : { failed: normalizeCount(candidate.failed) }),
    ...(normalizeCount(candidate.recovered) === undefined ? {} : { recovered: normalizeCount(candidate.recovered) }),
    ...(normalizeCount(candidate.failedSafe) === undefined ? {} : { failedSafe: normalizeCount(candidate.failedSafe) }),
    ...(normalizeText(candidate.kind) === undefined ? {} : { kind: normalizeText(candidate.kind) }),
    ...(normalizeText(candidate.outcome) === undefined ? {} : { outcome: normalizeText(candidate.outcome) }),
    ...(normalizeCount(candidate.observedCount) === undefined
      ? {}
      : { observedCount: normalizeCount(candidate.observedCount) }),
    ...(typeof candidate.retryable === "boolean" ? { retryable: candidate.retryable } : {}),
    ...(normalizeText(candidate.errorCode) === undefined
      ? {}
      : { errorCode: normalizeText(candidate.errorCode) }),
  });
}

export function shouldLogWorkerOutcome(outcome: WorkerLaneOutcome): boolean {
  return [
    outcome.claimed,
    outcome.completed,
    outcome.failed,
    outcome.recovered,
    outcome.failedSafe,
    outcome.observedCount,
  ].some((value) => typeof value === "number" && value > 0);
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,119}$/u.test(error.message)
  ) return error.message;
  return "WORKER_LANE_UNEXPECTED_FAILURE";
}

export function computeWorkerBackoffMs(
  baseMs: number,
  maxMs: number,
  consecutiveFailures: number,
  randomValue: number,
): number {
  if (
    !Number.isSafeInteger(baseMs) || baseMs < 1 ||
    !Number.isSafeInteger(maxMs) || maxMs < baseMs ||
    !Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 1 ||
    !Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1
  ) throw new Error("WORKER_BACKOFF_INPUT_INVALID");
  const exponent = Math.min(consecutiveFailures - 1, 20);
  const unjittered = Math.min(maxMs, baseMs * (2 ** exponent));
  // Up to 20% positive jitter prevents synchronized retry storms without ever
  // retrying faster than the configured backoff.
  return Math.min(maxMs, Math.round(unjittered * (1 + randomValue * 0.2)));
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function iso(now: () => number): string {
  return new Date(now()).toISOString();
}

function snapshotLane(state: MutableWorkerLaneState): WorkerLaneSnapshot {
  return Object.freeze({ ...state, lastOutcome: state.lastOutcome && Object.freeze({ ...state.lastOutcome }) });
}

function validateLane(lane: WorkerLaneConfiguration): void {
  if (
    !Number.isSafeInteger(lane.idleIntervalMs) || lane.idleIntervalMs < MIN_INTERVAL_MS ||
    !Number.isSafeInteger(lane.busyIntervalMs) || lane.busyIntervalMs < MIN_INTERVAL_MS ||
    !Number.isSafeInteger(lane.errorBackoffBaseMs) || lane.errorBackoffBaseMs < MIN_INTERVAL_MS ||
    !Number.isSafeInteger(lane.errorBackoffMaxMs) || lane.errorBackoffMaxMs < lane.errorBackoffBaseMs
  ) throw new Error("WORKER_LANE_CONFIGURATION_INVALID");
}

export function createWorkerService(
  lanes: readonly WorkerLaneConfiguration[],
  dependencies: WorkerServiceDependencies = {},
): WorkerService {
  if (lanes.length === 0) throw new Error("WORKER_LANES_REQUIRED");
  const names = new Set<WorkerLaneName>();
  for (const lane of lanes) {
    validateLane(lane);
    if (names.has(lane.name)) throw new Error("WORKER_LANE_DUPLICATED");
    names.add(lane.name);
  }

  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const sleep = dependencies.sleep ?? defaultSleep;
  const log = dependencies.log ?? (() => undefined);
  const controller = new AbortController();
  const states = new Map<WorkerLaneName, MutableWorkerLaneState>(lanes.map((lane) => [
    lane.name,
    {
      name: lane.name,
      status: "STARTING",
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastStartedAt: null,
      lastCompletedAt: null,
      nextRunAt: null,
      lastErrorCode: null,
      lastOutcome: null,
    },
  ]));
  let status: WorkerServiceSnapshot["status"] = "STARTING";
  let startedAt: string | null = null;
  let stoppingReason: string | null = null;
  let waitPromise: Promise<void> | null = null;

  const emit = (event: Omit<WorkerServiceLogEvent, "timestamp" | "release">) => {
    log(Object.freeze({ timestamp: iso(now), release: WORKER_SERVICE_RELEASE, ...event }));
  };

  const laneLoop = async (lane: WorkerLaneConfiguration): Promise<void> => {
    const state = states.get(lane.name);
    if (!state) throw new Error("WORKER_LANE_STATE_MISSING");
    while (!controller.signal.aborted) {
      state.status = "RUNNING";
      state.nextRunAt = null;
      state.runCount += 1;
      state.lastStartedAt = iso(now);
      const startedMs = now();

      let delayMs: number;
      try {
        const outcome = summarizeWorkerOutcome(await lane.run());
        state.successCount += 1;
        state.consecutiveFailures = 0;
        state.lastErrorCode = null;
        state.lastOutcome = outcome;
        state.lastCompletedAt = iso(now);
        const claimed = outcome.claimed ?? 0;
        delayMs = claimed > 0 ? lane.busyIntervalMs : lane.idleIntervalMs;
        state.status = "WAITING";
        // Idle polling is visible in the health snapshot. Keeping it out of
        // stdout prevents 2-second no-op cycles from burying claimed work,
        // failures, and service lifecycle events.
        if (shouldLogWorkerOutcome(outcome)) {
          emit({
            level: "info",
            event: "worker_lane_completed",
            lane: lane.name,
            duration_ms: Math.max(0, now() - startedMs),
            delay_ms: delayMs,
            outcome,
          });
        }
      } catch (error) {
        const errorCode = safeErrorCode(error);
        state.failureCount += 1;
        state.consecutiveFailures += 1;
        state.lastErrorCode = errorCode;
        state.lastOutcome = null;
        state.lastCompletedAt = iso(now);
        delayMs = computeWorkerBackoffMs(
          lane.errorBackoffBaseMs,
          lane.errorBackoffMaxMs,
          state.consecutiveFailures,
          random(),
        );
        state.status = "BACKING_OFF";
        emit({
          level: "error",
          event: "worker_lane_failed",
          lane: lane.name,
          duration_ms: Math.max(0, now() - startedMs),
          delay_ms: delayMs,
          error_code: errorCode,
        });
      }

      if (controller.signal.aborted) break;
      state.nextRunAt = new Date(now() + delayMs).toISOString();
      await sleep(delayMs, controller.signal);
    }
    state.status = "STOPPED";
    state.nextRunAt = null;
  };

  return Object.freeze({
    start() {
      if (waitPromise) throw new Error("WORKER_SERVICE_ALREADY_STARTED");
      status = "RUNNING";
      startedAt = iso(now);
      emit({ level: "info", event: "worker_service_started" });
      waitPromise = Promise.all(lanes.map((lane) => laneLoop(lane))).then(() => {
        status = "STOPPED";
        emit({ level: "info", event: "worker_service_stopped", reason: stoppingReason ?? "completed" });
      });
    },
    stop(reason = "requested") {
      if (status === "STOPPED" || status === "STOPPING") return;
      stoppingReason = normalizeText(reason) ?? "requested";
      status = "STOPPING";
      emit({ level: "info", event: "worker_service_stopping", reason: stoppingReason });
      controller.abort();
      if (!waitPromise) {
        for (const state of states.values()) state.status = "STOPPED";
        status = "STOPPED";
      }
    },
    async wait() {
      await (waitPromise ?? Promise.resolve());
    },
    snapshot() {
      const laneSnapshots = lanes.map((lane) => snapshotLane(
        states.get(lane.name) ?? (() => { throw new Error("WORKER_LANE_STATE_MISSING"); })(),
      ));
      const ready = status === "RUNNING" && laneSnapshots.every((lane) =>
        lane.successCount > 0 && lane.consecutiveFailures === 0
      );
      return Object.freeze({
        release: WORKER_SERVICE_RELEASE,
        status,
        ready,
        startedAt,
        stoppingReason,
        lanes: Object.freeze(laneSnapshots),
      });
    },
  });
}

export function startWorkerHealthServer(
  service: Pick<WorkerService, "snapshot">,
  input: Readonly<{
    host: string;
    port: number;
    log?: (event: WorkerServiceLogEvent) => void;
  }>,
): Promise<Readonly<{ server: Server; address: string }>> {
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
      return;
    }
    const snapshot = service.snapshot();
    if (request.url === "/live") {
      response.writeHead(snapshot.status === "STOPPED" ? 503 : 200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ release: snapshot.release, status: snapshot.status }));
      return;
    }
    if (request.url === "/ready" || request.url === "/health") {
      response.writeHead(snapshot.ready ? 200 : 503, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(snapshot));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(input.port, input.host, () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("WORKER_HEALTH_ADDRESS_INVALID"));
        return;
      }
      resolve(Object.freeze({
        server,
        address: `http://${input.host}:${address.port}`,
      }));
    });
  });
}
