import { runJobSourceWorkerOnce } from "../src/server/workers/job-source-worker.ts";

const result = await runJobSourceWorkerOnce();
process.stdout.write(`${JSON.stringify(result)}\n`);
