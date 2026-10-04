import type { BrowserContext } from "playwright-core";

/** Only the provider's extension workers may pre-exist in its default context. */
export function deliveryServiceWorkersAllowed(
  context: Pick<BrowserContext, "serviceWorkers">,
  providerDefaultContext = false,
): boolean {
  const workers = context.serviceWorkers();
  if (!providerDefaultContext) return workers.length === 0;
  // An employer page cannot register a chrome-extension worker. Still reject
  // every page-origin worker and unexpected extension population before loading
  // candidate data; the route and init-script guards remain in force.
  return workers.length <= 2 && workers.every((worker) =>
    /^chrome-extension:\/\/[a-p]{32}\/[A-Za-z0-9_./-]+$/u.test(worker.url()));
}
