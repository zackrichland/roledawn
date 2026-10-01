import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";
import { syntheticLeverDelivery, type SyntheticLeverMode } from "../../test-support/synthetic-lever-delivery.ts";
import { createApplicationDeliveryDriver } from "./application-delivery-driver.ts";
import { createApplicationDeliveryBrowser, type DeliveryPriorSubmission } from "./application-delivery-browser.ts";
import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import { createAgentBrowserTools } from "./agents-browser-tools.ts";
import { frameShowsCaptchaChallenge } from "./agents-captcha.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((path): path is string => Boolean(path && existsSync(path)));
const options = { skip: chrome ? false : "No local Chromium installed" };
const binding = { workspaceId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: "30000000-0000-4000-8000-000000000001", revisionId: "40000000-0000-4000-8000-000000000001", fillAttemptId: "50000000-0000-4000-8000-000000000001", computerSessionId: "60000000-0000-4000-8000-000000000001" };
const bytes = Buffer.from("%PDF-1.7 synthetic authorized resume bytes");
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function packet(url: string): ApplicationFillExecutionPackage {
  return { schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", submitAuthorized: false, binding, destinationUrl: url,
    facts: [{ factVersionId: "name-1", factKey: "identity.legal_name", value: "Alex Fixture", valueHash: digest(JSON.stringify("Alex Fixture")) }],
    artifacts: [{ artifactVersionId: "resume-1", variant: "RESUME_PDF", filename: "Alex-Fixture-Lever-Synthetic-Resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: digest(bytes) }],
  };
}

async function run(mode: SyntheticLeverMode, after?: (result: Awaited<ReturnType<ReturnType<typeof createApplicationDeliveryDriver>["deliver"]>>, fixture: ReturnType<typeof syntheticLeverDelivery>, state: { begins: number; prior: DeliveryPriorSubmission | null }, page: import("playwright-core").Page) => Promise<void>) {
  const fixture = syntheticLeverDelivery(mode);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const state: { begins: number; prior: DeliveryPriorSubmission | null } = { begins: 0, prior: null };
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    const driver = createApplicationDeliveryDriver({ resolvePage: () => page, requestTransport: fixture.transport, browserTimeoutMs: 500, captchaSolveTimeoutMs: 1_500,
      harness: { async run() {} },
      submissionHooks: {
        async begin() { assert.equal(fixture.observed.submits, 0); state.begins += 1; return { attemptId: "attempt-1", idempotencyKey: "once-1" }; },
        async checkpoint(record) { if (record.submission) state.prior = record.submission as DeliveryPriorSubmission; },
      },
    });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: fixture.policy.startUrl, executionPackage: packet(fixture.policy.startUrl) });
    await after?.(result, fixture, state, page);
    return { result, observed: fixture.observed, state };
  } finally { await browser.close(); }
}

test("concrete Lever policy uploads approved multipart bytes and confirms exactly one final dispatch", options, async () => {
  for (const mode of ["normal", "duplicate"] as const) {
    const { result, observed, state } = await run(mode);
    assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
    assert.equal(result.uploadedArtifactCount, 1);
    assert.equal(observed.uploads.length, 1);
    assert.ok(observed.uploads[0].includes(bytes));
    assert.equal(observed.submits, 1);
    assert.equal(state.begins, 1);
  }
});

test("Lever refuses failed uploads, extra upload fields and changed final artifact bytes before authority", options, async () => {
  for (const mode of ["bad-upload", "upload-extra-field", "altered-file"] as const) {
    const { result, observed, state } = await run(mode);
    assert.equal(result.kind, "TAKEOVER", JSON.stringify(result));
    assert.equal(observed.submits, 0);
    assert.equal(state.begins, 0);
    if (mode === "upload-extra-field") assert.equal(observed.uploads.length, 0);
  }
});

test("Lever omits unapproved parser values from initially empty optional system slots", options, async () => {
  const { result, observed, state } = await run("parser-autofill");
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(observed.submits, 1);
  assert.equal(state.begins, 1);
  assert.equal(observed.submissions[0].includes("Unverified employer"), false);
  assert.equal(observed.submissions[0].includes("Unverified city"), false);
  assert.match(observed.submissions[0].toString(), /name="org"\r\n\r\n\r\n/u);
  assert.match(observed.submissions[0].toString(), /name="location"\r\n\r\n\r\n/u);
});

test("Lever never clears initial values, required answers or unreviewed parser slots", options, async () => {
  for (const mode of ["parser-prefilled", "parser-required", "parser-other-slot"] as const) {
    await run(mode, async (result, fixture, state, page) => {
      assert.equal(result.kind, "QUESTIONS_REQUIRED", JSON.stringify(result));
      assert.equal(fixture.observed.submits, 0);
      assert.equal(state.begins, 0);
      const selector = mode === "parser-other-slot" ? '[name="otherOrg"]' : '[name="org"]';
      assert.equal(await page.locator(selector).inputValue(), mode === "parser-prefilled" ? "Existing company" : "Unverified employer");
    });
  }
});

test("Lever blocks a parser value reintroduced after the sealed empty readback", options, async () => {
  const { result, observed, state } = await run("parser-repopulate");
  assert.equal(result.kind, "TAKEOVER", JSON.stringify(result));
  assert.equal(observed.submits, 0);
  assert.equal(state.begins, 0);
});

test("Lever completes the native field change before upload so its parser preserves approved values", options, async () => {
  const { result, observed, state } = await run("parser-change-events");
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(observed.uploads.length, 1);
  assert.equal(observed.submits, 1);
  assert.equal(state.begins, 1);
});

test("Lever verifies the exact uploaded filename through presentation case changes", options, async () => {
  const { result, observed, state } = await run("filename-uppercase");
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(observed.submits, 1);
  assert.equal(state.begins, 1);
});

test("Lever still rejects a changed filename in the underlying acknowledgement before submit authority", options, async () => {
  const { result, observed, state } = await run("filename-changed");
  assert.equal(result.kind, "TAKEOVER", JSON.stringify(result));
  assert.equal(observed.uploads.length, 1);
  assert.equal(observed.submits, 0);
  assert.equal(state.begins, 0);
});

test("an unsolved Lever CAPTCHA and a changed employer form contract stop before uploads or submission", options, async () => {
  // "captcha" renders a visible checkbox widget the fixture never solves, so the solver wait runs out.
  for (const mode of ["captcha", "form-drift"] as const) {
    const { result, observed, state } = await run(mode);
    assert.equal(result.kind, mode === "form-drift" ? "FAILED_SAFE" : "TAKEOVER", JSON.stringify(result));
    if (result.kind === "TAKEOVER") assert.equal(result.reasonCode, "APPLICATION_FILL_CAPTCHA_TAKEOVER");
    assert.equal(observed.uploads.length, 0);
    assert.equal(observed.submits, 0);
    assert.equal(state.begins, 0);
  }
});

test("Lever missing receipt remains uncertain; retained success plus persisted response reconciles without retry", options, async () => {
  await run("uncertain", async (result, fixture, state, page) => {
    assert.equal(result.kind, "UNCERTAIN", JSON.stringify(result));
    assert.equal(fixture.observed.submits, 1);
    assert.ok(state.prior?.response);
    await page.evaluate((url) => { document.body.innerHTML = '<h3 data-qa="msg-submit-success">Application submitted!</h3>'; history.replaceState({}, "", url); }, fixture.policy.receipt.url);
    const runtime = await createApplicationDeliveryBrowser({ page, policy: fixture.policy, hooks: { async begin() { throw new Error("MUST_NOT_RETRY"); } }, requestTransport: fixture.transport });
    assert.equal((await runtime.reconcile({ ...state.prior!, response: undefined })).kind, "UNCERTAIN");
    assert.equal((await runtime.reconcile(state.prior!)).kind, "CONFIRMED");
    assert.equal(fixture.observed.submits, 1);
    await runtime.dispose();
  });
});

test("Lever question wrappers retain sensitive question text and file fingerprints survive displayed filenames", options, async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.setContent('<label><div class="application-label">Resume/CV <span class="required">✱</span></div><div class="application-field"><span class="filename"></span><input id="resume-upload-input" type="file" name="resume"></div></label><div><div class="application-label"><div class="text">Are you legally eligible to work in the United States?<span class="required">✱</span></div></div><div class="application-field"><label><input type="radio" name="cards[abc][field0]" value="Yes">Yes</label><label><input type="radio" name="cards[abc][field0]" value="No">No</label></div></div>');
    // Local loopback origin only, no remote request or employer fixture.
    await page.route("http://localhost/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" }));
    const html = await page.content();
    await page.goto("http://localhost/fixture");
    await page.setContent(html);
    const tools = createAgentBrowserTools(page, "http://localhost/fixture", { leverLabels: true });
    const before = await tools.inspect();
    const file = before.fields.find((field) => field.kind === "FILE")!;
    assert.equal(file.required, true);
    const sensitive = before.fields.find((field) => field.kind === "SINGLE_SELECT")!;
    assert.equal(sensitive.candidateOnly, true);
    assert.match(sensitive.label, /legally eligible/u);
    assert.deepEqual(sensitive.options, [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }]);
    await page.locator('.filename').evaluate((element) => { element.textContent = "resume.pdf"; });
    assert.equal((await tools.inspect()).fields.find((field) => field.kind === "FILE")?.fingerprint, file.fingerprint);
  } finally { await browser.close(); }
});

test("Lever's invisible hCaptcha scores on submit and one application is confirmed", options, async () => {
  const { result, observed, state } = await run("invisible-captcha");
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(observed.submits, 1);
  assert.equal(state.begins, 1);
  // CAPTCHA provider traffic is admitted for the session's solver (D-146); it never carries candidate data.
  assert.ok(observed.captchaScores >= 1);
});

test("a hidden CAPTCHA from another provider no longer stops the send", options, async () => {
  const { result, observed, state } = await run("foreign-captcha");
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(observed.submits, 1);
  assert.equal(state.begins, 1);
});

test("a challenge that appears after the submit click and is solved sends exactly once", options, async () => {
  const { result, observed, state } = await run("captcha-solved-on-submit");
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(observed.submits, 1, "one final request, never a duplicate after the solve");
  assert.equal(state.begins, 1);
});

test("a challenge that appears after the submit click and is never solved stops before the final request", options, async () => {
  const { result, observed, state } = await run("captcha-on-submit");
  assert.equal(result.kind, "TAKEOVER", JSON.stringify(result));
  assert.equal(result.kind === "TAKEOVER" && result.reasonCode, "APPLICATION_FILL_CAPTCHA_TAKEOVER");
  assert.equal(observed.uploads.length, 1, "the approved upload happened before the challenge");
  assert.equal(observed.submits, 0);
  assert.equal(state.begins, 0);
  assert.ok(observed.requests.some(request => request === "GET https://imgs.hcaptcha.com/fixture-check.png"), "the challenge image loads for the solver");
});

test("the CAPTCHA detector treats hidden, zero-size and off-page widgets as passive and anything asking the person as a challenge", options, async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const frameSrc = "https://newassets.hcaptcha.com/captcha/v1/fixture/static/hcaptcha.html";
    const cases: readonly [string, string, boolean][] = [
      ["invisible widget", `<div class="h-captcha" data-sitekey="x" data-size="invisible"><iframe src="${frameSrc}#frame=checkbox-invisible" style="display:none"></iframe></div>`, false],
      ["idle challenge frame", `<div style="visibility:hidden;position:absolute;top:-10000px"><iframe src="${frameSrc}#frame=challenge" style="width:400px;height:580px"></iframe></div>`, false],
      ["off-page challenge frame", `<div style="position:absolute;top:-10000px"><iframe src="${frameSrc}#frame=challenge" style="width:400px;height:580px"></iframe></div>`, false],
      ["transparent challenge frame", `<div style="opacity:0"><iframe src="${frameSrc}#frame=challenge" style="width:400px;height:580px"></iframe></div>`, false],
      ["tiny frame", `<iframe src="${frameSrc}#frame=challenge" style="width:1px;height:1px"></iframe>`, false],
      ["disclosure text", "<p>This site is protected by hCaptcha and its Privacy Policy and Terms of Service apply.</p>", false],
      ["visible challenge frame", `<iframe src="${frameSrc}#frame=challenge" style="width:400px;height:580px"></iframe>`, true],
      ["visible checkbox widget", `<div class="h-captcha" data-sitekey="x"><iframe src="${frameSrc}#frame=checkbox" style="width:303px;height:78px"></iframe></div>`, true],
      ["visible prompt", "<p class=\"error\">Please complete the captcha to submit.</p>", true],
      ["hidden prompt", "<p style=\"display:none\">Please complete the captcha to submit.</p>", false],
    ];
    await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("http://localhost/fixture");
    for (const [name, body, expected] of cases) {
      await page.setContent(`<!doctype html><html><body><form id="application-form">${body}</form></body></html>`);
      assert.equal(await frameShowsCaptchaChallenge(page.mainFrame()), expected, name);
    }
  } finally { await browser.close(); }
});


test("Lever's hidden enclave bootstrap is passive; visible and unreviewed frames still stop inspection", options, async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" }));
    await page.goto("http://localhost/fixture");
    for (const [src, visibility, expected] of [
      ["https://newassets.hcaptcha.com/captcha/v1/fixture/static/hcaptcha-enclave.html", "hidden", null],
      ["https://newassets.hcaptcha.com/captcha/v1/fixture/static/hcaptcha-enclave.html", "visible", "APPLICATION_FILL_CAPTCHA_TAKEOVER"],
      ["https://newassets.hcaptcha.com/captcha/v1/fixture/static/unreviewed-hcaptcha.html", "hidden", "APPLICATION_FILL_CAPTCHA_TAKEOVER"],
      ["https://untrusted.invalid/captcha/v1/fixture/static/hcaptcha-enclave.html", "hidden", "APPLICATION_FILL_CAPTCHA_TAKEOVER"],
    ] as const) {
      await page.setContent(`<html><body><form id="application-form"><iframe src="${src}" style="position:fixed;top:0;left:0;width:100%;height:100%;visibility:${visibility}"></iframe></form></body></html>`);
      const tools = createAgentBrowserTools(page, "http://localhost/fixture", { leverLabels: true, invisibleHcaptcha: true });
      assert.equal((await tools.inspect()).takeoverReason, expected, `${src} ${visibility}`);
    }
  } finally { await browser.close(); }
});
