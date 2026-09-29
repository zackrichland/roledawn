import { runApplicationAutopilotCleanup, runApplicationAutopilotWorkerOnce } from "../src/server/workers/application-autopilot.ts";

const cleanup = await runApplicationAutopilotCleanup();
const application = await runApplicationAutopilotWorkerOnce();
process.stdout.write(`${JSON.stringify({ cleanup, application })}\n`);
