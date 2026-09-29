import {
  runApplicationFillRecoveryOnce,
  runApplicationFillWorkerOnce,
} from "../src/server/workers/application-fill.ts";
import { createBrowserbaseRuntimeAdapterForNodeWorker } from "../src/server/workers/browserbase-runtime.node.ts";
import { createApplicationFormDriver } from "../src/server/workers/application-form-driver.ts";

const runtimeAdapter = await createBrowserbaseRuntimeAdapterForNodeWorker(process.env);
const formDriver = createApplicationFormDriver(process.env);

// Recovery must run first so a crash-stranded PROVISIONING attempt is either
// reattached to its one metadata-bound provider session or failed safe before
// this process claims new work.
const recovery = await runApplicationFillRecoveryOnce({
  runtimeAdapter,
  formDriver,
});
const fill = await runApplicationFillWorkerOnce({
  runtimeAdapter,
  formDriver,
});

process.stdout.write(`${JSON.stringify({ recovery, fill })}\n`);
