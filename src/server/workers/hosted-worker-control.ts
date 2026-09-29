import { timingSafeEqual } from "node:crypto";

export const HOSTED_WORKER_LANES = ["catalog", "preparation", "kit", "auto-apply", "autopilot", "cleanup"] as const;
export type HostedWorkerLane = typeof HOSTED_WORKER_LANES[number];
export type HostedWorkerSummary = Record<string, number | boolean>;

export async function runIndependentMaintenance(tasks: (() => Promise<{ claimed: number; completed: number; failed: number }>)[]) {
  const results = await Promise.allSettled(tasks.map(task => Promise.resolve().then(task)));
  return results.reduce((total, result) => result.status === "fulfilled"
    ? { claimed: total.claimed + result.value.claimed, completed: total.completed + result.value.completed, failed: total.failed + result.value.failed }
    : { ...total, failed: total.failed + 1 }, { claimed: 0, completed: 0, failed: 0 });
}

export function authorizedWorkerRequest(header: string | null, secret: string | undefined): boolean {
  if (!secret || !/^[a-f0-9]{64}$/u.test(secret)) return false;
  const actual = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseHostedWorkerLane(value: unknown): HostedWorkerLane {
  if (typeof value !== "string" || !HOSTED_WORKER_LANES.includes(value as HostedWorkerLane)) throw new Error("HOSTED_WORKER_LANE_INVALID");
  return value as HostedWorkerLane;
}

export type WorkerDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

/** A 202 response is not completion. Both claim and result are durable and inspectable. */
export async function coordinateHostedWorker(input: {
  lane: HostedWorkerLane;
  database: WorkerDatabase;
  execute(): Promise<HostedWorkerSummary>;
}) {
  const claim = await input.database.rpc("claim_hosted_worker_lane", { p_lane: input.lane, p_lease_seconds: 900 });
  if (claim.error) throw new Error("HOSTED_WORKER_CLAIM_FAILED");
  if (claim.data === null) return { claimed: false };
  if (typeof claim.data !== "string" || !/^[a-f0-9-]{36}$/iu.test(claim.data)) throw new Error("HOSTED_WORKER_CLAIM_INVALID");
  let summary: HostedWorkerSummary = {};
  let errorCode: string | null = null;
  try {
    summary = await input.execute();
    if (Object.values(summary).some(value => typeof value !== "boolean" && (!Number.isSafeInteger(value) || value < 0))) {
      summary = {};
      throw new Error("HOSTED_WORKER_SUMMARY_INVALID");
    }
    if (typeof summary.failed === "number" && summary.failed > 0) errorCode = "HOSTED_WORKER_ITEMS_FAILED";
    if (typeof summary.uncertain === "number" && summary.uncertain > 0) errorCode = "HOSTED_WORKER_ITEMS_UNCERTAIN";
  } catch (error) {
    errorCode = error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/u.test(error.message) ? error.message : "HOSTED_WORKER_EXECUTION_FAILED";
  }
  const result = await input.database.rpc("finish_hosted_worker_lane", {
    p_lane: input.lane, p_lease_token: claim.data, p_summary: summary, p_error_code: errorCode,
  });
  if (result.error || result.data !== true) throw new Error("HOSTED_WORKER_RESULT_NOT_RECORDED");
  return { claimed: true, success: errorCode === null, summary, errorCode };
}
