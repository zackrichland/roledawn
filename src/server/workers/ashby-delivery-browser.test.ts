import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium, type Page } from "playwright-core";
import { ASHBY_FIXTURE_FINAL_ACTION, startSyntheticAshby, type AshbyFixtureMode } from "../../test-support/synthetic-ashby-delivery.ts";
import { createAgentBrowserTools } from "./agents-browser-tools.ts";
import { createApplicationDeliveryDriver } from "./application-delivery-driver.ts";
import { createApplicationDeliveryBrowser } from "./application-delivery-browser.ts";
import { pageShowsCaptchaChallenge } from "./agents-captcha.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((value): value is string => Boolean(value && existsSync(value)));
const options = { skip: chrome ? false : "No local Chromium installed" };
const bytes = Buffer.from("%PDF-1.7 synthetic approved bytes");
const artifact = { artifactVersionId: "fixture-artifact", variant: "RESUME_PDF" as const, filename: "Fixture-Resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };

async function fixture(mode: AshbyFixtureMode, run: (data: {
 page: Page;
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
    if (new URL(route.request().url()).origin === "https://www.recaptcha.net") {
      // Synthetic provider document only; these tests never run a CAPTCHA SDK.
      await route.fulfill({ status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: "<!doctype html><html><body></body></html>" });
    } else if (route.request().url() === "https://fixture-bucket.s3.amazonaws.com/") {
      if (route.request().method() === "POST") server.requests.uploadBytes.push(route.request().postDataBuffer()!);
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": new URL(server.policy.startUrl).origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "*" } });
    } else await route.continue();
   },
  });
  await runtime.open();
  const browserTools = createAgentBrowserTools(page, server.policy.startUrl, { ashbyLabels: true });
  await run({ page, runtime, browserTools, requests: server.requests, begins: () => begins });
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
  if (result.kind === "TAKEOVER") assert.equal(result.reasonCode, "DELIVERY_ASHBY_REQUEST_SUBMIT_SINGLE_ENVELOPE_QUERY_DOCUMENT");
  assert.equal(data.begins(), 0);
  assert.equal(data.requests.submits, 0);
 });
});
test("Ashby form script cannot autosave a different approved-field value", options, async () => {
 await fixture("wrong-value", async data => {
  const field = (await data.browserTools.inspect()).fields.find(field => field.domId === "_systemfield_name")!;
  await assert.rejects(data.runtime.withField(field, "Alex Fixture", () => data.browserTools.fillValue(field.fieldId, "Alex Fixture")), { message: "DELIVERY_ASHBY_REQUEST_FIELD_VALUE" });
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

for (const mode of ["multiple", "rotating-action", "public-refetches", "submit-disabled", "submit-disabled-value", "submit-disabled-label", "submit-disabled-removed", "submit-disabled-foreign"] as const) test("Ashby delivery driver seals " + mode + " autosave readbacks with the exact approved package", options, async () => {
 const server = await startSyntheticAshby(mode);
 const browser = await chromium.launch({ executablePath: chrome, headless: true });
 try {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const binding = { workspaceId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: "30000000-0000-4000-8000-000000000001", revisionId: "40000000-0000-4000-8000-000000000001", fillAttemptId: "50000000-0000-4000-8000-000000000001", computerSessionId: "60000000-0000-4000-8000-000000000001" };
  let sealed = false;
  const driver = createApplicationDeliveryDriver({ sitePolicy: server.policy, resolvePage: () => page, browserTimeoutMs: 1500,
   harness: { async run() {} },
   submissionHooks: { async begin(input) {
    const readback = (input.review.readbacks as { savedFields: { actionId: string }[] }[])[0];
    assert.equal(readback.savedFields.length, mode.startsWith("submit-disabled") ? 1 : 2);
    if (mode === "rotating-action") assert.equal(readback.savedFields[0].actionId, ASHBY_FIXTURE_FINAL_ACTION);
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
  if (mode.startsWith("submit-disabled-")) {
   assert.equal(result.kind, "TAKEOVER", JSON.stringify(result));
   if (result.kind === "TAKEOVER") assert.equal(result.reasonCode, mode === "submit-disabled-value" ? "AGENTS_FILL_READBACK_MISMATCH"
    : mode === "submit-disabled-foreign" ? "DELIVERY_FINAL_REVIEW_DRIFT" : "AGENTS_FILL_FIELD_DRIFT");
   assert.equal(sealed, false);
   assert.equal(server.requests.submits, 0);
   return;
  }
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(sealed, true);
  assert.equal(server.requests.submits, 1);
  if (mode === "rotating-action") assert.deepEqual(server.requests.submittedActions, [ASHBY_FIXTURE_FINAL_ACTION]);
  if (mode === "public-refetches") {
   assert.equal(server.requests.operations.filter(op => op === "ApiOrganizationFromHostedJobsPageName").length, 4);
   assert.equal(server.requests.operations.filter(op => op === "ApiAutocompleteGeoLocation").length, 3);
  }
 } finally { await browser.close(); await server.close(); }
});

test("Ashby stale action after valid autosave rotation cannot consume the sealed permission", options, async () => {
 await fixture("stale-action", async data => {
  await fill(data);
  const review = { savedFields: data.runtime.savedFieldProofs(), uploads: data.runtime.uploadProofs() };
  assert.equal(review.savedFields[0].actionId, ASHBY_FIXTURE_FINAL_ACTION);
  assert.equal((await data.runtime.submit("c".repeat(64), review)).kind, "TAKEOVER");
  assert.equal(data.begins(), 0);
  assert.equal(data.requests.submits, 0);
 });
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

for (const [mode, reason] of [["wrong-handle-length", "DELIVERY_ASHBY_REQUEST_HANDLE_BYTE_LENGTH"], ["late-field-save", "DELIVERY_ASHBY_REQUEST_FIELD_NO_ACTION"]] as const) {
 test("Ashby " + mode + " retains the precise first rejection through later chained upload requests", options, async () => {
  await fixture(mode, async data => {
   const fields = (await data.browserTools.inspect()).fields;
   const name = fields.find(field => field.domId === "_systemfield_name")!;
   await data.runtime.withField(name, "Alex Fixture", () => data.browserTools.fillValue(name.fieldId, "Alex Fixture"));
   await assert.rejects(data.runtime.upload(fields.find(field => field.kind === "FILE")!, artifact), { message: reason });
   assert.equal(data.requests.operations.includes("ApiCreateFileUploadHandle"), false);
   assert.equal(data.requests.operations.includes("ApiSetFormValueToFile"), false);
   assert.equal(data.requests.mutations.length, 1);
   assert.equal(data.requests.uploadBytes.length, 0);
   assert.equal(data.requests.submits, 0);
   assert.equal(data.begins(), 0);
   await assert.rejects(data.runtime.currentStep(), { message: reason });
  });
 });
}

test("a real newly attached iframe with an empty URL cannot crash passive-frame detection", options, async () => {
 await fixture("normal", async data => {
  const observations: { url: string; permitted: string[]; error: unknown }[] = [];
  data.page.on("frameattached", frame => {
   try { observations.push({ url: frame.url(), permitted: data.runtime.passiveFrameUrls(), error: null }); }
   catch (error) { observations.push({ url: frame.url(), permitted: [], error }); }
  });
  await data.page.evaluate(() => {
   const frame = document.createElement("iframe"); frame.style.display = "none"; document.body.append(frame);
  });
  await data.page.locator("iframe").waitFor({ state: "attached" });
  assert.ok(observations.some(item => item.url === ""), "exercise Playwright's transient frameattached state");
  assert.ok(observations.every(item => item.error === null && item.permitted.length === 0));
 });
});

test("transient frames supply no controls and their later foreign origin blocks final permission", options, async () => {
 await fixture("normal", async data => {
  let frameUrl = "";
  const transient = { url: () => frameUrl, locator() { throw new Error("UNTRUSTED_FRAME_MUST_NOT_BE_READ"); }, evaluate() { throw new Error("UNTRUSTED_FRAME_MUST_NOT_BE_READ"); } };
  const page = new Proxy(data.page, { get(target, property) {
   if (property === "frames") return () => [...target.frames(), transient];
   const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const observer = createAgentBrowserTools(page, data.runtime.policy.startUrl, { ashbyLabels: true });
  const initial = await observer.inspect();
  assert.equal(initial.takeoverReason, null);
  assert.equal(initial.fields.length, 2);
  assert.equal(await pageShowsCaptchaChallenge(page), false);
  await fill(data);
  frameUrl = "https://unreviewed.example/frame";
  assert.equal((await observer.verifyWrites()).takeoverReason, "AGENTS_FILL_CROSS_ORIGIN_FRAME_TAKEOVER");
  const result = await data.runtime.submit("f".repeat(64), {}, undefined, async () => {
   if ((await observer.verifyWrites()).takeoverReason) throw new Error("DELIVERY_FINAL_REVIEW_DRIFT");
  });
  assert.equal(result.kind, "TAKEOVER");
  assert.equal(data.begins(), 0);
  assert.equal(data.requests.submits, 0);
  frameUrl = "invalid-url";
  assert.equal((await observer.inspect()).takeoverReason, "AGENTS_FILL_CROSS_ORIGIN_FRAME_TAKEOVER");
 });
});

test("a late invisible anchor is checked against live adapter authority even before its frame URL exists", options, async () => {
 await fixture("normal", async data => {
  const key = "6LeFb_YUAAAAALUD5h-BiQEp8JaFChe0e0A6r49Y";
  const anchor = "https://www.recaptcha.net/recaptcha/api2/anchor?size=invisible&k=" + key;
  const observer = createAgentBrowserTools(data.page, data.runtime.policy.startUrl, { ashbyLabels: true, isPermittedPassiveFrameUrl: data.runtime.isPassiveFrameUrl });
  assert.equal(data.runtime.isPassiveFrameUrl(anchor), false, "an unseen key grants no permission");
  assert.deepEqual(data.runtime.passiveFrameUrls(), []);
  await data.page.evaluate(key => fetch("https://www.recaptcha.net/recaptcha/api.js?render=" + key), key);
  await data.page.evaluate(src => { const iframe = document.createElement("iframe"); iframe.style.display = "none"; iframe.src = src; document.body.append(iframe); }, anchor);
  assert.equal((await observer.inspect()).takeoverReason, null, "observer created before the anchor must use current authority");
  const pendingFrame = { url: () => "", locator() { throw new Error("TRANSIENT_FRAME_MUST_NOT_SUPPLY_CONTROLS"); } };
  const pendingPage = new Proxy(data.page, { get(target, property) {
   if (property === "frames") return () => [target.mainFrame(), pendingFrame];
   const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const pendingObserver = createAgentBrowserTools(pendingPage, data.runtime.policy.startUrl, { ashbyLabels: true, isPermittedPassiveFrameUrl: data.runtime.isPassiveFrameUrl });
  assert.equal((await pendingObserver.inspect()).takeoverReason, null, "DOM src supplies the same exact approved URL during frame navigation");
  assert.equal(await pageShowsCaptchaChallenge(data.page, data.runtime.passiveFrameUrls()), false);
  for (const src of [anchor.replace(key, "unreviewed-key"), anchor.replace("size=invisible", "size=normal"), anchor.replace("/anchor?", "/bframe?"), anchor.replace("www.recaptcha.net", "unreviewed.example")]) {
   assert.equal(data.runtime.isPassiveFrameUrl(src), false);
   await data.page.locator("iframe").evaluate((element, src) => { (element as HTMLIFrameElement).src = src; }, src);
   assert.equal((await pendingObserver.inspect()).takeoverReason, "APPLICATION_FILL_CAPTCHA_TAKEOVER");
  }
  await data.page.locator("iframe").evaluate((element, src) => { (element as HTMLIFrameElement).src = src; (element as HTMLElement).style.cssText = "display:block;width:400px;height:400px"; }, anchor.replace("/anchor?", "/bframe?"));
  assert.equal((await pendingObserver.inspect()).takeoverReason, "APPLICATION_FILL_CAPTCHA_TAKEOVER");
  assert.equal(await pageShowsCaptchaChallenge(pendingPage, []), true, "a visible challenge remains a stop");
  assert.equal(data.begins(), 0);
  assert.equal(data.requests.submits, 0);
 });
});
