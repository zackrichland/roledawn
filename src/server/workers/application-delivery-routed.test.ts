import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { createRoutedSyntheticAtsDelivery } from "../../test-support/synthetic-ats-routed-delivery.ts";
import { createApplicationDeliveryBrowser } from "./application-delivery-browser.ts";
import { createAgentBrowserTools } from "./agents-browser-tools.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].find((value): value is string => Boolean(value && existsSync(value)));
test("reserved-origin transport still requires upload verification and durable permission before one synthetic dispatch", { skip: !chrome }, async () => {
  const fixture = await createRoutedSyntheticAtsDelivery(randomUUID());
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage(); let begins = 0;
    const runtime = await createApplicationDeliveryBrowser({ page, policy: fixture.policy, requestTransport: fixture.requestTransport, timeoutMs: 2_000,
      hooks: { async begin() { assert.equal(fixture.requests.submits, 0); begins += 1; return { attemptId: randomUUID(), idempotencyKey: randomUUID() }; } } });
    await runtime.open();
    await page.evaluate(() => fetch('/submit', { method: 'POST' }).catch(() => undefined));
    assert.equal(fixture.requests.submits, 0);
    const field = (await createAgentBrowserTools(page, fixture.policy.startUrl).inspect()).fields.find((item) => item.kind === "FILE")!;
    const bytes = Buffer.from("%PDF-1.7 synthetic acceptance only");
    await runtime.upload(field, { artifactVersionId: randomUUID(), variant: "RESUME_PDF", filename: "Alex-Synthetic-Routed-Resume.pdf", mediaType: "application/pdf", bytes, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    await page.locator('[name="name"]').fill("Alex Synthetic"); await runtime.move("FORWARD"); await page.locator('[name="consent"]').check();
    const result = await runtime.submit("a".repeat(64), { syntheticOnly: true });
    assert.equal(result.kind, "CONFIRMED"); assert.equal(begins, 1); assert.equal(fixture.requests.submits, 1); assert.equal(fixture.requests.leaks, 0);
    await runtime.dispose();
  } finally { await browser.close(); await fixture.close(); }
});
