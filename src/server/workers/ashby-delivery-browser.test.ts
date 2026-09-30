import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { startSyntheticAshby, type AshbyFixtureMode } from "../../test-support/synthetic-ashby-delivery.ts";
import { createAgentBrowserTools } from "./agents-browser-tools.ts";
import { createApplicationDeliveryDriver } from "./application-delivery-driver.ts";
import { createApplicationDeliveryBrowser } from "./application-delivery-browser.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((value): value is string => Boolean(value && existsSync(value)));
const options = { skip: chrome ? false : "No local Chromium installed" };
const bytes = Buffer.from("%PDF-1.7 synthetic approved bytes");
const artifact = { artifactVersionId: "fixture-artifact", variant: "RESUME_PDF" as const, filename: "Fixture-Resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };

async function fixture(mode: AshbyFixtureMode, run: (data: {
 runtime: Awaited<ReturnType<typeof createApplicationDeliveryBrowser>>;
 browserTools: ReturnType<typeof createAgentBrowserTools>;
 requests: Awaited<ReturnType<typeof startSyntheticAshby>>["requests"];
 begins: () => number;
}) => Promise<void>) {
 const server = await startSyntheticAshby(mode);
 const browser = await chromium.launch({ executablePath: chrome, headless: true });
 let begins = 0;
 try {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const runtime = await createApplicationDeliveryBrowser({ page, policy: server.policy, timeoutMs: 1500,
   hooks: { async begin() { assert.equal(server.requests.submits, 0); begins++; return { attemptId: "fixture-attempt", idempotencyKey: "once" }; } },
   requestTransport: async (route) => {
    if (route.request().url() === "https://fixture-bucket.s3.amazonaws.com/") {
      if (route.request().method() === "POST") server.requests.uploadBytes.push(route.request().postDataBuffer()!);
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": new URL(server.policy.startUrl).origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "*" } });
    } else await route.continue();
   },
  });
  await runtime.open();
  const browserTools = createAgentBrowserTools(page, server.policy.startUrl, { ashbyLabels: true });
  await run({ runtime, browserTools, requests: server.requests, begins: () => begins });
  await runtime.dispose();
 } finally { await browser.close(); await server.close(); }
}
async function fill(data: Parameters<Parameters<typeof fixture>[1]>[0]) {
 const fields = (await data.browserTools.inspect()).fields;
 const name = fields.find(field => field.domId === "_systemfield_name")!;
 assert.ok(name);
 await data.runtime.withField(name, "Alex Fixture", () => data.browserTools.fillValue(name.fieldId, "Alex Fixture"));
 await data.runtime.upload(fields.find(field => field.kind === "FILE")!, artifact);
 await data.browserTools.verifyWrites();
 await data.runtime.verifyCurrentUploads();
 assert.equal(data.requests.uploadBytes.length, 1);
 assert.ok(data.requests.uploadBytes[0].includes(bytes));
}

for (const mode of ["normal", "multiple"] as const) test("Ashby " + mode + " saves exact fields/uploads then submits once with employer receipt", options, async () => {
 await fixture(mode, async data => {
  await fill(data);
  const review = { savedFields: data.runtime.savedFieldProofs(), uploads: data.runtime.uploadProofs() };
  const result = await data.runtime.submit("a".repeat(64), review);
  assert.equal(result.kind, "CONFIRMED");
  assert.equal(data.begins(), 1);
  assert.equal(data.requests.submits, 1);
  assert.equal((await data.runtime.submit("a".repeat(64), review)).kind, "UNCERTAIN");
  assert.equal(data.requests.submits, 1);
 });
});
test("Ashby wrong-query final envelope cannot fall through generic submit guard", options, async () => {
 await fixture("bad-submit", async data => {
  await fill(data);
  const result = await data.runtime.submit("b".repeat(64), {});
  assert.equal(result.kind, "TAKEOVER");
  assert.equal(data.begins(), 0);
  assert.equal(data.requests.submits, 0);
 });
});
test("Ashby form script cannot autosave a different approved-field value", options, async () => {
 await fixture("wrong-value", async data => {
  const field = (await data.browserTools.inspect()).fields.find(field => field.domId === "_systemfield_name")!;
  await assert.rejects(data.runtime.withField(field, "Alex Fixture", () => data.browserTools.fillValue(field.fieldId, "Alex Fixture")), /NOT_ACKNOWLEDGED/u);
  assert.equal(data.requests.mutations.length, 0);
  assert.equal(data.begins(), 0);
 });
});
test("Ashby corrupt uploaded bytes cannot reach S3 or attach to form", options, async () => {
 await fixture("upload-corrupt", async data => {
  const field = (await data.browserTools.inspect()).fields.find(field => field.kind === "FILE")!;
  await assert.rejects(data.runtime.upload(field, artifact), /UPLOAD_BODY_MISMATCH/u);
  assert.equal(data.requests.uploadBytes.length, 0);
  assert.equal(data.requests.operations.includes("ApiSetFormValueToFile"), false);
 });
});
for (const mode of ["fake-receipt", "survey-missing"] as const) test("Ashby " + mode + " success-looking DOM remains uncertain and cannot retry", options, async () => {
 await fixture(mode, async data => {
  await fill(data);
  assert.equal((await data.runtime.submit("a".repeat(64), {})).kind, "UNCERTAIN");
  assert.equal((await data.runtime.submit("a".repeat(64), {})).kind, "UNCERTAIN");
  assert.equal(data.begins(), 1);
  assert.equal(data.requests.submits, 1);
 });
});

test("Ashby delivery driver seals autosave readbacks with the exact approved package", options, async () => {
 const server = await startSyntheticAshby("multiple");
 const browser = await chromium.launch({ executablePath: chrome, headless: true });
 try {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const binding = { workspaceId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: "30000000-0000-4000-8000-000000000001", revisionId: "40000000-0000-4000-8000-000000000001", fillAttemptId: "50000000-0000-4000-8000-000000000001", computerSessionId: "60000000-0000-4000-8000-000000000001" };
  let sealed = false;
  const driver = createApplicationDeliveryDriver({ sitePolicy: server.policy, resolvePage: () => page, browserTimeoutMs: 1500,
   harness: { async run() {} },
   submissionHooks: { async begin(input) {
    const readback = (input.review.readbacks as { savedFields: unknown[] }[])[0];
    assert.equal(readback.savedFields.length, 2);
    assert.equal(server.requests.submits, 0);
    sealed = true;
    return { attemptId: "attempt", idempotencyKey: "once" };
   } },
   requestTransport: async route => {
    if (route.request().url() === "https://fixture-bucket.s3.amazonaws.com/") await route.fulfill({ status: 204, headers: { "access-control-allow-origin": new URL(server.policy.startUrl).origin } });
    else await route.continue();
   },
  });
  const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: server.policy.startUrl,
   executionPackage: { schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", submitAuthorized: false, binding, destinationUrl: server.policy.startUrl,
    facts: [{ factVersionId: "fixture-name", factKey: "identity.legal_name", value: "Alex Fixture", valueHash: createHash("sha256").update("Alex Fixture").digest("hex") }], artifacts: [artifact] },
  });
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(sealed, true);
  assert.equal(server.requests.submits, 1);
 } finally { await browser.close(); await server.close(); }
});

test("Ashby cancellation revokes pending autosave authority before dispatch", options, async () => {
 await fixture("normal", async data => {
  const field = (await data.browserTools.inspect()).fields.find(field => field.domId === "_systemfield_name")!;
  const controller = new AbortController();
  await assert.rejects(data.runtime.withField(field, "Alex Fixture", async () => {
   controller.abort();
   await data.browserTools.fillValue(field.fieldId, "Alex Fixture");
  }, controller.signal), /DELIVERY_CANCELED/u);
  assert.equal(data.requests.mutations.length, 0);
 });
});
