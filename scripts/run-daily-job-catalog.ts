import { runJobSourceBatchWorker } from "../src/server/workers/job-source-batch-worker.ts";

const result = await runJobSourceBatchWorker();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.failed || result.uncertain || result.stopReason !== "IDLE") process.exitCode = 1;
