import "server-only";

import type { ComputerRuntimeAdapter } from "./application-fill.ts";
import { createBrowserbaseRuntimeAdapterForNodeWorker } from "./browserbase-runtime.node.ts";

/**
 * The only production composition root for Browserbase. It cannot be imported
 * into a Client Component, and it remains disabled until the explicit enable
 * flag plus the private API key are present.
 */
export async function createBrowserbaseRuntimeAdapterFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ComputerRuntimeAdapter> {
  return createBrowserbaseRuntimeAdapterForNodeWorker(environment);
}
