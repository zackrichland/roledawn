import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { chromium } from "playwright-core";

import { startSyntheticAtsDelivery } from "../../test-support/synthetic-ats-delivery.ts";
import { createApplicationDeliveryBrowser } from "./application-delivery-browser.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome", "/opt/pw-browsers/chromium"]
  .find((value): value is string => Boolean(value && existsSync(value)));
const browserOptions = { skip: chrome ? false : "No local Chromium installed" };
const hooks = { async begin(): Promise<never> { throw new Error("NOT_EXPECTED"); } };

test("a slow first page load gets the longer open budget; later actions keep the short wait (D-149)", browserOptions, async () => {
  const { policy, requests, close } = await startSyntheticAtsDelivery("slow-render");
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const short = await createApplicationDeliveryBrowser({ page: await (await browser.newContext({ serviceWorkers: "block" })).newPage(), policy, hooks, timeoutMs: 400 });
    await assert.rejects(short.open(), /Timeout|DELIVERY_STEP_UNSUPPORTED/u, "the old 400 ms budget fails the slow page");
    await short.dispose();
    const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
    const patient = await createApplicationDeliveryBrowser({ page, policy, hooks, timeoutMs: 400, openTimeoutMs: 5_000 });
    await patient.open();
    assert.equal((await patient.currentStep())?.id, "first");
    assert.equal(requests.submits, 0);
    await patient.dispose();
  } finally { await browser.close(); await close(); }
});
