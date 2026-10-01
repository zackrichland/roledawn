import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { chromium } from "playwright-core";

import { startSyntheticAtsDelivery } from "../../test-support/synthetic-ats-delivery.ts";
import { createApplicationDeliveryBrowser } from "./application-delivery-browser.ts";
import { boundDiagnostics, createBlockedRequestLedger, describeFrames, describeUrl, SOLVER_CONSOLE_EVENTS, watchCaptchaSolver } from "./delivery-diagnostics.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome", "/opt/pw-browsers/chromium"]
  .find((value): value is string => Boolean(value && existsSync(value)));
const browserOptions = { skip: chrome ? false : "No local Chromium installed" };

test("URLs are described by origin and bounded path only; queries, fragments and credentials never survive", () => {
  assert.equal(describeUrl("https://jobs.example.test/apply/123?email=alex%40example.test#frag"), "https://jobs.example.test/apply/123");
  assert.equal(describeUrl("https://user:secret@cdn.example.test/a.js"), "https://cdn.example.test/a.js");
  assert.equal(describeUrl(`https://cdn.example.test/${"p".repeat(200)}`).length, "https://cdn.example.test".length + 60);
  assert.equal(describeUrl("chrome-error://chromewebdata/"), "chrome-error://chromewebdata/");
  assert.equal(describeUrl("chrome-extension://abcdef/solver.html?token=1"), "chrome-extension:");
  assert.equal(describeUrl("data:text/html,<p>Alex</p>"), "data:");
  assert.equal(describeUrl(""), "(empty)");
  assert.equal(describeUrl("not a url"), "(malformed)");
});

test("the refused-request ledger groups by reason and destination and caps distinct keys", () => {
  const ledger = createBlockedRequestLedger();
  const request = (url: string, method = "GET", type = "script") => ({ url: () => url, method: () => method, resourceType: () => type });
  ledger.record(request("https://cdn.vendor.test/app.js?v=1"), "unreviewed");
  ledger.record(request("https://cdn.vendor.test/app.js?v=2"), "unreviewed");
  for (let index = 0; index < 40; index += 1) ledger.record(request(`https://t${index}.test/p`, "POST", "ping"), "unreviewed");
  const { blockedTotal, blocked } = ledger.summary();
  assert.equal(blockedTotal, 42);
  assert.equal(blocked["unreviewed GET script https://cdn.vendor.test/app.js"], 2);
  assert.ok(Object.keys(blocked).length <= 17);
  assert.ok((blocked["(other)"] ?? 0) > 0);
  assert.equal(JSON.stringify(blocked).includes("v=1"), false);
});

test("bounded diagnostics shrink nested records first and keep plain fields", () => {
  const big = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`https://host${index}.test/${"x".repeat(30)}`, index]));
  const bounded = boundDiagnostics({ phase: "open", page: "https://jobs.example.test/apply", blocked: big, frames: { "https://jobs.example.test/apply": 1 } }, 1_500);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 1_500);
  assert.equal(bounded.phase, "open");
  assert.equal(bounded.truncated, true);
  assert.deepEqual(boundDiagnostics({ phase: "open" }), { phase: "open" });
});

test("only Browserbase's two fixed solver messages are counted", () => {
  const listeners: ((message: { text(): string }) => void)[] = [];
  const page = { on: (_event: string, listener: (message: { text(): string }) => void) => { listeners.push(listener); }, off: () => { listeners.length = 0; } };
  const solver = watchCaptchaSolver(page as never);
  for (const text of [SOLVER_CONSOLE_EVENTS.started, "candidate typed alex@example.test", SOLVER_CONSOLE_EVENTS.finished, SOLVER_CONSOLE_EVENTS.started]) listeners[0]!({ text: () => text });
  assert.deepEqual(solver.counts(), { started: 2, finished: 1 });
  solver.stop();
  assert.equal(listeners.length, 0);
});

test("a refused page request is recorded by destination without its query, and admission is unchanged", browserOptions, async () => {
  const { policy, requests, close } = await startSyntheticAtsDelivery("normal");
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
    const runtime = await createApplicationDeliveryBrowser({ page, policy, timeoutMs: 400, hooks: { async begin() { throw new Error("NOT_EXPECTED"); } } });
    await runtime.open();
    const leaked = await page.evaluate(() => fetch("/collect?email=alex%40example.test", { method: "POST", body: "Alex" }).then(() => "sent", () => "blocked"));
    assert.equal(leaked, "blocked");
    const diagnostics = runtime.diagnostics();
    assert.ok(diagnostics.blockedTotal >= 1);
    const key = Object.keys(diagnostics.blocked).find((item) => item.includes("/collect"));
    assert.ok(key, JSON.stringify(diagnostics));
    assert.match(key!, /^unreviewed POST fetch http:\/\/127\.0\.0\.1:\d+\/collect$/u);
    assert.equal(JSON.stringify(diagnostics).includes("alex"), false);
    assert.equal(requests.submits, 0);
    assert.ok(Object.keys(describeFrames(page)).every((frame) => !frame.includes("?")));
    await runtime.dispose();
  } finally { await browser.close(); await close(); }
});
