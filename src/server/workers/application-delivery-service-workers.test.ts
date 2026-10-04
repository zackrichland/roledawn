import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserContext } from "playwright-core";
import { deliveryServiceWorkersAllowed } from "./application-delivery-service-workers.ts";

function context(...urls: string[]) {
  return { serviceWorkers: () => urls.map((url) => ({ url: () => url })) } as unknown as Pick<BrowserContext, "serviceWorkers">;
}

test("delivery worker gate permits only bounded provider extensions in the opt-in context", () => {
  const extension = `chrome-extension://${"a".repeat(32)}/background.js`;
  assert.equal(deliveryServiceWorkersAllowed(context()), true);
  assert.equal(deliveryServiceWorkersAllowed(context(extension)), false);
  assert.equal(deliveryServiceWorkersAllowed(context(extension), true), true);
  assert.equal(deliveryServiceWorkersAllowed(context("https://jobs.lever.co/sw.js"), true), false);
  assert.equal(deliveryServiceWorkersAllowed(context(extension, extension, extension), true), false);
  assert.equal(deliveryServiceWorkersAllowed(context("chrome-extension://unknown/worker.js"), true), false);
});
