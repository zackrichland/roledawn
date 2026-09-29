import { runApplicationKitWorkerOnce } from "../src/server/workers/application-kit.ts";

const result = await runApplicationKitWorkerOnce();
process.stdout.write(`${JSON.stringify(result)}\n`);
