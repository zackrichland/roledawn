import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { createNativeJobApiFetchPort } from "../ingestion/fetch-port.ts";
import { createSupabaseJobSourcePollDatabasePort } from "./job-source-worker.ts";
import { runJobSourceBatch, type JobSourceBatchOptions } from "./job-source-batch.ts";
import { CATALOG_FETCH_TIMEOUT_MILLISECONDS, CATALOG_LEASE_SECONDS } from "./job-source-poll.ts";

/** Node/serverless entry point. Due-source leases also coordinate the service lane. */
export async function runJobSourceBatchWorker(options: Partial<JobSourceBatchOptions> = {}, environment: NodeJS.ProcessEnv = process.env) {
  const client = createSupabaseAdminClient("job-source-batch/1", environment);
  const maintenance = await client.rpc("mark_stale_catalog_jobs" as never);
  if (maintenance.error) throw new Error("JOB_SOURCE_FRESHNESS_MAINTENANCE_FAILED");
  return runJobSourceBatch(createSupabaseJobSourcePollDatabasePort(client as never),
    createNativeJobApiFetchPort({ userAgent: "RoleDawn-JobCatalog/1", timeoutMilliseconds: CATALOG_FETCH_TIMEOUT_MILLISECONDS }),
    { leaseSeconds: CATALOG_LEASE_SECONDS, ...options, workerId: options.workerId ?? `catalog:${new Date().toISOString().slice(0, 10)}:${randomUUID()}` });
}
