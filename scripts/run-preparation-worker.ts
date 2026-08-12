import { runPreparationWorkerOnce } from "../src/server/workers/outbox-worker.ts";

const result = await runPreparationWorkerOnce();
process.stdout.write(`${JSON.stringify(result)}\n`);
