import type { SourceFetchPort } from "../ingestion/contracts.ts";
import { CATALOG_LEASE_SECONDS, runJobSourcePollOnce, type JobSourcePollDatabasePort, type JobSourcePollResult } from "./job-source-poll.ts";

export type JobSourceBatchOptions = Readonly<{
  workerId: string;
  maxSources?: number;
  concurrency?: number;
  maxMilliseconds?: number;
  leaseSeconds?: number;
}>;
export type JobSourceBatchResult = Readonly<{
  attempted: number; completed: number; failed: number; uncertain: number; observedJobs: number;
  stopReason: "IDLE" | "SOURCE_BUDGET" | "TIME_BUDGET" | "DATABASE_UNAVAILABLE";
  results: readonly JobSourcePollResult[];
  errors: readonly string[];
}>;

/** Drain durable due-source work; source failures never cancel sibling boards. */
export async function runJobSourceBatch(
  database: JobSourcePollDatabasePort,
  fetchPort: SourceFetchPort,
  options: JobSourceBatchOptions,
  clock: () => number = Date.now,
): Promise<JobSourceBatchResult> {
  const { workerId, maxSources = 100, concurrency = 2, maxMilliseconds = 600_000, leaseSeconds = CATALOG_LEASE_SECONDS } = options;
  if (!workerId.trim() || workerId.length > 112 || !Number.isSafeInteger(maxSources) || maxSources < 1 || maxSources > 1000 ||
    !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
    !Number.isSafeInteger(maxMilliseconds) || maxMilliseconds < 1000 || maxMilliseconds > 720_000 ||
    !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) throw new Error("JOB_SOURCE_BATCH_OPTIONS_INVALID");
  const deadline = clock() + maxMilliseconds;
  const results: JobSourcePollResult[] = []; const errors: string[] = [];
  let attempted = 0; let idle = false; let timedOut = false; let databaseUnavailable = false;
  await Promise.all(Array.from({ length: concurrency }, async (_, slot) => {
    while (!idle && !databaseUnavailable && attempted < maxSources) {
      if (clock() >= deadline) { timedOut = true; return; }
      attempted += 1;
      try {
        const result = await runJobSourcePollOnce(database, fetchPort, { workerId: `${workerId}:${slot}`, leaseSeconds });
        if (result.kind === "IDLE") { attempted -= 1; idle = true; return; }
        results.push(result);
      } catch (error) {
        // A lost commit response is not permission to fail or repeat the write.
        // The stored run and its expiring lease are reconciled by the next poll.
        const code = error instanceof Error && /^JOB_SOURCE_[A-Z0-9_]{1,100}$/u.test(error.message) ? error.message : "JOB_SOURCE_BATCH_OPERATION_UNCERTAIN";
        errors.push(code);
        if (code === "JOB_SOURCE_CLAIM_FAILED") databaseUnavailable = true;
      }
    }
  }));
  return Object.freeze({ attempted, completed: results.filter(r => r.kind === "COMPLETED").length,
    failed: results.filter(r => r.kind === "FAILED").length, uncertain: errors.length,
    observedJobs: results.reduce((sum, result) => sum + (result.kind === "COMPLETED" ? result.observedCount : 0), 0),
    stopReason: databaseUnavailable ? "DATABASE_UNAVAILABLE" : timedOut ? "TIME_BUDGET" : idle ? "IDLE" : "SOURCE_BUDGET", results, errors });
}
