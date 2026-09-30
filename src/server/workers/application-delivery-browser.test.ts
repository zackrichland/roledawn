import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";

import { chromium, type Page } from "playwright-core";
import { startSyntheticAtsDelivery, SYNTHETIC_VERIFICATION_CODE, type SyntheticDeliveryMode } from "../../test-support/synthetic-ats-delivery.ts";

import { validateAgentQuestionDescriptors, type AgentQuestionAnswer, type AgentQuestionDescriptor, type ApplicationAgentQuestionRepository } from "../../domain/application-agent-questions.ts";
import { createAgentBrowserTools, type AgentBrowserField } from "./agents-browser-tools.ts";
import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import { createApplicationDeliveryBrowser, displaysUploadFilename, resolveGreenhouseDeliveryPolicy, verificationBodyMatches, type DeliveryPriorSubmission, type DeliverySitePolicy, type DeliverySubmissionHooks } from "./application-delivery-browser.ts";
import { createApplicationDeliveryDriver } from "./application-delivery-driver.ts";
import type { AgentFormHarness } from "./agents-form-driver.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((value): value is string => Boolean(value && existsSync(value)));
const browserOptions = { skip: chrome ? false : "No local Chromium installed" };
const binding = { workspaceId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: "30000000-0000-4000-8000-000000000001", revisionId: "40000000-0000-4000-8000-000000000001", fillAttemptId: "50000000-0000-4000-8000-000000000001", computerSessionId: "60000000-0000-4000-8000-000000000001" };
const bytes = Buffer.from("%PDF-1.7 synthetic authorized resume bytes");
// Employers receive the reviewed display name, not a generic "resume.pdf".
const artifact = { artifactVersionId: "resume-1", variant: "RESUME_PDF" as const, filename: "Alex-Fixture-Synthetic-Systems-Resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
function packet(url: string): ApplicationFillExecutionPackage {
  return { schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", submitAuthorized: false, binding, destinationUrl: url,
    facts: [{ factVersionId: "name-1", factKey: "identity.legal_name", value: "Alex Fixture", valueHash: "a".repeat(64) }], artifacts: [artifact] };
}
type Fixture = { page: Page; policy: DeliverySitePolicy; requests: { submits: number; uploads: Buffer[]; next: number; back: number; leaks: number }; secondPage(): Promise<Page> };
async function fixture(run: (input: Fixture) => Promise<void>, mode: SyntheticDeliveryMode = "normal") {
  const { policy, requests, close } = await startSyntheticAtsDelivery(mode);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  try { await run({ page: await context.newPage(), policy, requests, secondPage: async () => (await browser.newContext({ serviceWorkers: "block" })).newPage() }); }
  finally { await browser.close(); await close(); }
}

function hooks(requests: Fixture["requests"]) {
  let begins = 0;
  let last: DeliveryPriorSubmission | null = null;
  const value: DeliverySubmissionHooks = {
    async begin(input) { assert.equal(requests.submits, 0); assert.match(input.reviewHash, /^[a-f0-9]{64}$/u); assert.match(input.requestFingerprint, /^[a-f0-9]{64}$/u); begins += 1; if (begins > 1) throw new Error("ALREADY_CONSUMED"); return { attemptId: "attempt-1", idempotencyKey: "once-1" }; },
    async checkpoint(state) { if (state.submission) last = state.submission as DeliveryPriorSubmission; },
  };
  return { value, begins: () => begins, last: () => last };
}
async function advance(page: Page, policy: DeliverySitePolicy, authority: DeliverySubmissionHooks) {
  const runtime = await createApplicationDeliveryBrowser({ page, policy, hooks: authority, timeoutMs: 400 });
  await runtime.open(); const fields = await createAgentBrowserTools(page, policy.startUrl).inspect();
  await runtime.upload(fields.fields.find((field) => field.kind === "FILE")!, artifact);
  await page.locator('[name="name"]').fill("Alex Fixture");
  await runtime.move("FORWARD"); await page.locator('[name="consent"]').check();
  return runtime;
}

test("isolated delivery verifies real HTTP upload, next/back, once-only submission and receipt", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const runtime = await advance(page, policy, authority.value);
    assert.deepEqual(requests.uploads[0], bytes);
    assert.equal(runtime.uploadProofs()[0].filename, artifact.filename);
    await runtime.move("BACK"); assert.equal(await page.locator('[name="note"]').inputValue(), "Keep my note");
    await runtime.move("FORWARD");
    await page.locator('[name="consent"]').check();
    const result = await runtime.submit("a".repeat(64), { applicationId: binding.applicationId });
    assert.equal(result.kind, "CONFIRMED");
    if (result.kind === "CONFIRMED") assert.equal(result.receipt.receiptId, "receipt-123");
    assert.equal(authority.begins(), 1); assert.equal(requests.submits, 1);
    assert.equal((await runtime.submit("a".repeat(64), {})).kind, "UNCERTAIN");
    await runtime.dispose();
    await page.evaluate(() => fetch('/submit', { method: 'POST' }).catch(() => undefined));
    assert.equal(requests.submits, 1, "disposing must retain deny-all until browser closure");
  });
});

test("duplicate employer script requests cannot consume a second submit", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests); const runtime = await advance(page, policy, authority.value);
    assert.equal((await runtime.submit("b".repeat(64), {})).kind, "CONFIRMED");
    assert.equal(requests.submits, 1); assert.equal(authority.begins(), 1);
    await runtime.dispose();
  }, "double");
});

test("uncertain receipt never retries; retained page and persisted response evidence can reconcile", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests); const runtime = await advance(page, policy, authority.value);
    const result = await runtime.submit("c".repeat(64), {});
    assert.equal(result.kind, "UNCERTAIN");
    assert.equal(requests.submits, 1);
    assert.ok(authority.last()?.response);
    await page.evaluate((url) => { document.body.innerHTML = '<main id="receipt" data-receipt-id="receipt-123">Application received. Thank you.</main>'; history.replaceState({}, '', url); }, policy.receipt.url);
    const recovered = await runtime.reconcile(authority.last()!);
    assert.equal(recovered.kind, "CONFIRMED");
    assert.equal(requests.submits, 1);
    assert.equal((await runtime.reconcile({ ...authority.last()!, response: undefined })).kind, "UNCERTAIN", "static receipt URL alone is not proof");
    await runtime.dispose();
  }, "uncertain");
});

test("failed upload response cannot count as acknowledged or authorize a submit", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests); const runtime = await createApplicationDeliveryBrowser({ page, policy, hooks: authority.value, timeoutMs: 300 });
    await runtime.open();
    const field = (await createAgentBrowserTools(page, policy.startUrl).inspect()).fields.find((item) => item.kind === "FILE")!;
    await assert.rejects(runtime.upload(field, artifact), /UPLOAD_NOT_ACKNOWLEDGED/u);
    assert.equal(runtime.uploaded(field.fieldId), false); assert.equal(authority.begins(), 0); assert.equal(requests.submits, 0);
    await runtime.dispose();
  }, "bad-upload");
});

test("delivery model fills known fields, pauses legal answers, rebuilds with exact answers and confirms once", browserOptions, async () => {
  await fixture(async ({ page, policy, requests, secondPage }) => {
    const answers: AgentQuestionAnswer[] = []; let pending: readonly AgentQuestionDescriptor[] = [];
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { validateAgentQuestionDescriptors(questions); return answers.filter((answer) => questions.some((question) => question.fieldId === answer.fieldId && question.fingerprint === answer.fingerprint)); },
      async requestQuestions({ questions }) { validateAgentQuestionDescriptors(questions); pending = questions; return questions.map((question) => ({ ...question, id: "question-1", status: "OPEN" })); },
    };
    const harness: AgentFormHarness = { async run(input) {
      const form = input.input.form as { fields: AgentBrowserField[]; answers: AgentQuestionAnswer[] };
      for (const field of form.fields) {
        if (field.hasValue) continue;
        let result: unknown;
        if (field.name === "name") result = await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-1" });
        else if (field.kind === "FILE") result = await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-1" });
        else if (field.name === "consent") {
          const answer = form.answers.find((item) => item.fieldId === field.fieldId);
          result = answer ? await input.executeTool("answer_field", { fieldId: field.fieldId, answerId: answer.answerId }) : await input.executeTool("request_questions", { fieldIds: [field.fieldId] });
        }
        if (result) assert.equal((result as { ok: boolean }).ok, true, JSON.stringify(result));
      }
      await input.executeTool("complete_review", {});
    } };
    const authority = hooks(requests);
    let activePage = page;
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => activePage, sitePolicy: policy, submissionHooks: authority.value, browserTimeoutMs: 600 });
    const input = { binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl) };
    const first = await driver.deliver(input);
    assert.equal(first.kind, "QUESTIONS_REQUIRED", JSON.stringify(first));
    assert.equal(first.filledFieldCount, 1); assert.equal(first.uploadedArtifactCount, 1);
    assert.equal(requests.submits, 0); assert.equal(pending.length, 1);
    answers.push({ answerId: "answer-1", fieldId: pending[0].fieldId, fingerprint: pending[0].fingerprint, value: true });
    activePage = await secondPage();
    const second = await driver.deliver(input);
    assert.equal(second.kind, "CONFIRMED", JSON.stringify(second));
    assert.equal(second.completedStepCount, 2); assert.equal(requests.submits, 1); assert.equal(authority.begins(), 1);
  });
});

test("standing answers fill a requested field in the same pass, so nothing is asked (D-117)", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const answers: AgentQuestionAnswer[] = []; let asked: readonly AgentQuestionDescriptor[] = []; let offered: readonly AgentQuestionDescriptor[] = [];
    // The resolver's own policy (which questions it may answer) is tested in standing-answers.test.ts.
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return answers.filter((answer) => questions.some((question) => question.fieldId === answer.fieldId && question.fingerprint === answer.fingerprint)); },
      async requestQuestions({ questions }) { asked = questions; return questions.map((question) => ({ ...question, id: "question-1", status: "OPEN" })); },
      async resolveSavedAnswers({ questions }) {
        validateAgentQuestionDescriptors(questions); offered = questions;
        const answer = { answerId: "standing-1", fieldId: questions[0].fieldId, fingerprint: questions[0].fingerprint, value: true };
        answers.push(answer);
        return [answer];
      },
    };
    const results: unknown[] = [];
    const harness: AgentFormHarness = { async run(input) {
      const form = input.input.form as { fields: AgentBrowserField[] };
      for (const field of form.fields) {
        if (field.hasValue) continue;
        if (field.name === "name") await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-1" });
        else if (field.kind === "FILE") await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-1" });
        else if (field.name === "consent") results.push(await input.executeTool("request_questions", { fieldIds: [field.fieldId] }));
      }
      await input.executeTool("complete_review", {});
    } };
    const authority = hooks(requests);
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, submissionHooks: authority.value, browserTimeoutMs: 600 });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl) });
    assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
    assert.equal(offered.length, 1);
    assert.equal(asked.length, 0, "a covered question is never sent to the candidate");
    assert.deepEqual((results[0] as { requestedFieldIds: string[] }).requestedFieldIds, []);
    assert.deepEqual((results[0] as { answeredFromSavedAnswers: string[] }).answeredFromSavedAnswers, [offered[0].fieldId]);
    assert.equal(requests.submits, 1); assert.equal(authority.begins(), 1);
  });
});

test("a Next rule cannot permit the final submission endpoint; Greenhouse routes bind one board/job", async () => {
  const greenhouse = resolveGreenhouseDeliveryPolicy("https://job-boards.greenhouse.io/example/jobs/1234");
  // Boards that redirect their hosted page to a custom careers site still
  // serve this embedded form, so every posting uses one route.
  assert.equal(greenhouse.startUrl, "https://job-boards.greenhouse.io/embed/job_app?for=example&token=1234");
  assert.equal(greenhouse.steps[0].url, greenhouse.startUrl);
  assert.equal(greenhouse.destinationUrl, "https://job-boards.greenhouse.io/example/jobs/1234");
  assert.equal(greenhouse.steps[0].submit?.request.url, "https://boards.greenhouse.io/embed/example/jobs/1234");
  assert.equal(greenhouse.receipt.url, "https://job-boards.greenhouse.io/embed/job_app/confirmation?for=example&token=1234");
  // The presign response names the bucket nearest the browser; only Greenhouse's own are accepted.
  assert.deepEqual(greenhouse.greenhouse?.uploadOrigins, ["https://grnhse-prod-jben-us-east-1.s3.amazonaws.com", "https://grnhse-prod-jben-us-west-2.s3.us-west-2.amazonaws.com"]);
  assert.throws(() => resolveGreenhouseDeliveryPolicy("https://evil.example/example/jobs/1234"), /SITE_UNSUPPORTED/u);
  await assert.rejects(createApplicationDeliveryBrowser({ page: {} as Page, hooks: { async begin() { throw new Error("UNREACHABLE"); } }, policy: {
    ...greenhouse, steps: [{ ...greenhouse.steps[0], forward: { selector: "#next", request: greenhouse.steps[0].submit!.request, nextStepId: "application" } }],
  } }), /NEXT_IS_SUBMIT/u);
});

test("normalized Greenhouse policy URLs retain the original exact content binding", async () => {
  const destination = "https://JOB-BOARDS.GREENHOUSE.IO:443/example/jobs/1234/";
  const driver = createApplicationDeliveryDriver({ harness: { async run() {} },
    resolvePage: () => ({ context() { throw new Error("RUNTIME_BOUNDARY_REACHED"); } }) as unknown as Page,
    submissionHooks: { async begin() { throw new Error("UNREACHABLE"); } },
  });
  const input = { binding, runtimeHandle: {}, startUrl: destination, executionPackage: packet(destination) };
  await assert.rejects(driver.deliver(input), /RUNTIME_BOUNDARY_REACHED/u);
  await assert.rejects(driver.deliver({ ...input, executionPackage: packet("https://job-boards.greenhouse.io/example/jobs/1234") }), /DELIVERY_CONTENT_BINDING_MISMATCH/u);
});

test("saved exact answers apply before a no-op harness; true completes and explicit false remains rejected", browserOptions, async () => {
  for (const consent of [true, false]) await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    let finalStepHarnessCalls = 0;
    const reviewedWrites: unknown[] = [];
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return questions.filter((item) => item.kind === "BOOLEAN").map((item) => ({ answerId: "saved-consent", fieldId: item.fieldId, fingerprint: item.fingerprint, value: consent })); },
      async requestQuestions({ questions }) { return questions.map((item) => ({ ...item, id: "question", status: "OPEN" })); },
    };
    const harness: AgentFormHarness = { async run(input) {
      const form = input.input.form as { fields: AgentBrowserField[] };
      if (form.fields.some((field) => field.name === "consent")) { finalStepHarnessCalls += 1; return; }
      for (const field of form.fields) {
        if (field.name === "name") await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-1" });
        else if (field.kind === "FILE") await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-1" });
      }
    } };
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, browserTimeoutMs: 600,
      submissionHooks: { ...authority.value, async checkpoint(state) { if (state.phase === "STEP_REVIEWED" && state.stepId === "second") reviewedWrites.push(...state.writes as unknown[]); await authority.value.checkpoint?.(state); } },
    });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl) });
    assert.equal(result.kind, consent ? "CONFIRMED" : "TAKEOVER", JSON.stringify(result));
    assert.equal(finalStepHarnessCalls, consent ? 0 : 1);
    assert.equal(requests.submits, consent ? 1 : 0);
    assert.equal(authority.begins(), consent ? 1 : 0);
    if (consent) assert.ok(reviewedWrites.some((write) => (write as { answerId?: string }).answerId === "saved-consent"));
    else {
      assert.equal(result.kind === "TAKEOVER" && result.reasonCode, "DELIVERY_ANSWER_NOT_ACCEPTED_BY_FORM");
      assert.equal(await page.locator('[name="consent"]').isChecked(), false);
    }
  });
});

test("employer-prechecked legal consent requires candidate authority and explicit false never flips", browserOptions, async () => {
  for (const mode of ["prefilled", "normal"] as const) await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return mode === "normal" ? questions.filter((item) => item.kind === "BOOLEAN").map((item) => ({ answerId: "explicit-false", fieldId: item.fieldId, fingerprint: item.fingerprint, value: false })) : []; },
      async requestQuestions({ questions }) { return questions.map((item) => ({ ...item, id: "question", status: "OPEN" })); },
    };
    const harness: AgentFormHarness = { async run(input) {
      const form = input.input.form as { fields: AgentBrowserField[]; answers: AgentQuestionAnswer[] };
      for (const field of form.fields.filter((item) => !item.hasValue)) {
        if (field.name === "name") await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-1" });
        else if (field.kind === "FILE") await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-1" });
        else if (field.name === "consent" && mode === "normal") await input.executeTool("answer_field", { fieldId: field.fieldId, answerId: "explicit-false" });
      }
      await input.executeTool("complete_review", {});
    } };
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, submissionHooks: authority.value, browserTimeoutMs: 600 });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl) });
    assert.equal(result.kind, mode === "prefilled" ? "QUESTIONS_REQUIRED" : "TAKEOVER", JSON.stringify(result));
    if (result.kind === "TAKEOVER") assert.equal(result.reasonCode, "DELIVERY_ANSWER_NOT_ACCEPTED_BY_FORM");
    assert.equal(await page.locator('[name="consent"]').isChecked(), mode === "prefilled");
    assert.equal(requests.submits, 0); assert.equal(authority.begins(), 0);
  }, mode);
});

test("optional contact defaults and exact fact mappings require matching provenance; conflicting email is preserved", browserOptions, async () => {
  for (const matches of [true, false]) await fixture(async ({ page, policy, requests }) => {
    const approvedEmail = "alex@example.test";
    const defaultEmail = matches ? approvedEmail : "someone-else@example.test";
    await page.addInitScript((value) => { document.addEventListener("DOMContentLoaded", () => {
      const form = document.querySelector("#first"); if (!form) return;
      const label = document.createElement("label"); label.textContent = "Email";
      const input = document.createElement("input"); input.name = "email"; input.type = "email"; input.value = value;
      label.append(input); form.prepend(label);
    }); }, defaultEmail);
    const authority = hooks(requests); let observedEmail = ""; const defaultProofs: unknown[] = [];
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return questions.filter((item) => item.kind === "BOOLEAN").map((item) => ({ answerId: "consent-true", fieldId: item.fieldId, fingerprint: item.fingerprint, value: true })); },
      async requestQuestions({ questions }) { return questions.map((item) => ({ ...item, id: "question", status: "OPEN" })); },
    };
    const harness: AgentFormHarness = { async run(input) {
      for (const field of (input.input.form as { fields: AgentBrowserField[] }).fields) {
        if (field.name === "name") {
          assert.deepEqual(await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "email-1" }), { ok: false, errorCode: "DELIVERY_FACT_FIELD_MISMATCH" });
          assert.equal(await page.locator('[name="name"]').inputValue(), "Alex Fixture");
          await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-1" });
        }
        else if (field.kind === "FILE") await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-1" });
      }
    } };
    const content = packet(policy.startUrl);
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, browserTimeoutMs: 600,
      submissionHooks: { ...authority.value, async checkpoint(state) {
        if (state.phase === "STEP_REVIEWED") defaultProofs.push(...state.verifiedDefaults as unknown[]);
        if (state.phase === "STEP_REVIEWED" && state.stepId === "first") {
          observedEmail = await page.locator('[name="email"]').inputValue();
          assert.equal(await page.locator('[name="note"]').inputValue(), "Keep my note");
        }
        await authority.value.checkpoint?.(state);
      } },
    });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl,
      executionPackage: { ...content, facts: [...content.facts, { factVersionId: "email-1", factKey: "contact.application_email", value: approvedEmail, valueHash: createHash("sha256").update(approvedEmail).digest("hex") }] },
    });
    assert.equal(result.kind, matches ? "CONFIRMED" : "QUESTIONS_REQUIRED", JSON.stringify(result));
    if (matches) assert.equal(observedEmail, defaultEmail);
    assert.equal(requests.submits, matches ? 1 : 0);
    if (matches) assert.ok(defaultProofs.some((proof) => (proof as { factVersionId?: string }).factVersionId === "email-1"));
    else {
      assert.equal(await page.locator('[name="email"]').inputValue(), defaultEmail);
      assert.equal(result.kind === "QUESTIONS_REQUIRED" && result.questions.some((question) => question.label === "Email" && !question.required), true);
    }
  });
});

test("Greenhouse-style presign and multipart upload validate exact signed fields and bytes before acknowledgement", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const runtime = await advance(page, policy, authority.value);
    assert.equal(requests.uploads.length, 1);
    assert.ok(requests.uploads[0].includes(bytes));
    assert.equal(runtime.uploadProofs()[0].sha256, artifact.sha256);
    assert.equal((await runtime.submit("d".repeat(64), {})).kind, "CONFIRMED");
    assert.equal(requests.submits, 1);
    await runtime.dispose();
  }, "greenhouse");
});

test("an emailed-code challenge resends only the same attempt with the candidate's code, then confirms", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const runtime = await advance(page, policy, authority.value);
    const first = await runtime.submit("e".repeat(64), {});
    assert.equal(first.kind, "VERIFICATION_REQUIRED", JSON.stringify(first));
    if (first.kind !== "VERIFICATION_REQUIRED") return;
    assert.equal(first.recipient, "a***@example.test");
    assert.equal(requests.submits, 1); assert.equal(authority.begins(), 1);
    // A malformed code never reaches the page; a wrong one is refused by the employer and asked again.
    assert.equal((await runtime.verify("ABC")).kind, "VERIFICATION_REQUIRED");
    assert.equal(requests.submits, 1);
    const wrong = await runtime.verify("WRONG123");
    assert.equal(wrong.kind === "VERIFICATION_REQUIRED" && wrong.reasonCode, "DELIVERY_VERIFICATION_CODE_REJECTED", JSON.stringify(wrong));
    assert.equal(requests.submits, 2);
    const done = await runtime.verify(SYNTHETIC_VERIFICATION_CODE);
    assert.equal(done.kind, "CONFIRMED", JSON.stringify(done));
    assert.equal(requests.submits, 3); assert.equal(authority.begins(), 1, "no new submission authority is taken");
    if (done.kind === "CONFIRMED") assert.equal(done.receipt.attemptId, first.submission.attemptId);
    assert.equal((await runtime.verify(SYNTHETIC_VERIFICATION_CODE)).kind, "UNCERTAIN", "nothing is pending after confirmation");
    await runtime.dispose();
  }, "greenhouse-verification");
});

test("a verification resend that changes the application is blocked before it leaves the browser", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const runtime = await advance(page, policy, authority.value);
    assert.equal((await runtime.submit("f".repeat(64), {})).kind, "VERIFICATION_REQUIRED");
    const result = await runtime.verify(SYNTHETIC_VERIFICATION_CODE);
    assert.equal(result.kind === "UNCERTAIN" && result.reasonCode, "DELIVERY_VERIFICATION_BODY_MISMATCH", JSON.stringify(result));
    assert.equal(requests.submits, 1);
    await runtime.dispose();
  }, "greenhouse-verification-tamper");
});

test("verification bodies must equal the first request apart from the code and CAPTCHA token", () => {
  const firstBody = { job_application: { first_name: "Alex", answers: [{ id: 1, value: "Yes" }] }, fingerprint: "fp", "g-recaptcha-enterprise-token": "token" };
  const body = (value: unknown) => Buffer.from(JSON.stringify(value));
  const expected = { code: "ABCD1234", firstBody };
  assert.equal(verificationBodyMatches(body({ job_application: firstBody.job_application, fingerprint: "fp", security_code: "ABCD1234" }), expected), true);
  assert.equal(verificationBodyMatches(body({ job_application: firstBody.job_application, fingerprint: "fp", security_code: "ABCD1235" }), expected), false);
  assert.equal(verificationBodyMatches(body({ job_application: { ...firstBody.job_application, first_name: "Sam" }, fingerprint: "fp", security_code: "ABCD1234" }), expected), false);
  assert.equal(verificationBodyMatches(body({ job_application: firstBody.job_application, security_code: "ABCD1234" }), expected), false, "a dropped field is a change");
  assert.equal(verificationBodyMatches(body({ job_application: firstBody.job_application, fingerprint: "fp", security_code: "ABCD1234", extra: 1 }), expected), false);
  assert.equal(verificationBodyMatches(body({ job_application: firstBody.job_application, fingerprint: "fp", security_code: "ABCD1234", "g-recaptcha-enterprise-token": "token" }), expected), false);
  assert.equal(verificationBodyMatches(Buffer.from("not json"), expected), false);
});

test("the driver relays the candidate's code, asks again after a rejection, and times out as unconfirmed", browserOptions, async () => {
  for (const codes of [["WRONG123", SYNTHETIC_VERIFICATION_CODE], []]) await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return questions.filter((item) => item.kind === "BOOLEAN").map((item) => ({ answerId: "saved-consent", fieldId: item.fieldId, fingerprint: item.fingerprint, value: true })); },
      async requestQuestions({ questions }) { return questions.map((item) => ({ ...item, id: "question", status: "OPEN" })); },
    };
    const harness: AgentFormHarness = { async run(input) {
      const form = input.input.form as { fields: AgentBrowserField[] };
      for (const field of form.fields) {
        if (field.name === "name") await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-1" });
        else if (field.kind === "FILE") await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-1" });
      }
    } };
    const asked: { recipient: string; retry: boolean }[] = [];
    const queue = [...codes];
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, browserTimeoutMs: 600, submissionHooks: authority.value,
      verification: { async requestCode({ recipient, retry }) { asked.push({ recipient, retry }); return queue.shift() ?? null; } } });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl) });
    if (codes.length) {
      assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
      assert.deepEqual(asked, [{ recipient: "a***@example.test", retry: false }, { recipient: "a***@example.test", retry: true }]);
      assert.equal(requests.submits, 3);
    } else {
      // No code in time: the employer explicitly did not accept this attempt, so it can run again.
      assert.equal(result.kind === "NOT_ACCEPTED" && result.reasonCode, "DELIVERY_EMAIL_VERIFICATION_TIMEOUT", JSON.stringify(result));
      assert.equal(requests.submits, 1);
    }
    assert.equal(authority.begins(), 1);
  }, "greenhouse-verification");
});

test("aborted durable authorization sends no final request and can never be automatically retried", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const controller = new AbortController(); let begins = 0;
    const runtime = await advance(page, policy, { async begin() { begins += 1; controller.abort(); return { attemptId: "attempt-canceled", idempotencyKey: "once-canceled" }; } });
    const result = await runtime.submit("e".repeat(64), {}, controller.signal);
    assert.equal(result.kind, "UNCERTAIN");
    assert.equal(requests.submits, 0); assert.equal(begins, 1);
    assert.equal((await runtime.submit("e".repeat(64), {})).kind, "UNCERTAIN");
    assert.equal(begins, 1);
    await runtime.dispose();
  });
});

test("pre-submit recovery restarts at page one; paused request rejects review drift before consuming authority", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const first = await advance(page, policy, authority.value);
    await first.dispose();
    const restored = await createApplicationDeliveryBrowser({ page, policy, hooks: authority.value, timeoutMs: 600 });
    await restored.open();
    assert.equal((await restored.currentStep())?.id, "first");
    assert.equal(await page.locator('[name="name"]').inputValue(), "");
    assert.equal(restored.uploadProofs().length, 0);
    await restored.move("FORWARD");
    const result = await restored.submit("f".repeat(64), {}, undefined, async () => { throw new Error("DELIVERY_FINAL_REVIEW_DRIFT"); });
    assert.equal(result.kind, "TAKEOVER"); assert.equal(authority.begins(), 0); assert.equal(requests.submits, 0);
    await restored.dispose();
  });
});

test("unambiguous frozen facts, acknowledged files and exact answers complete without model calls", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests); let modelCalls = 0;
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return questions.filter((field) => field.kind === "BOOLEAN").map((field) => ({ answerId: "consent-from-candidate", fieldId: field.fieldId, fingerprint: field.fingerprint, value: true })); },
      async requestQuestions({ questions }) { assert.equal(questions.length, 0); return []; },
    };
    const driver = createApplicationDeliveryDriver({ harness: { async run() { modelCalls += 1; } }, questions, resolvePage: () => page, sitePolicy: policy, submissionHooks: authority.value, browserTimeoutMs: 600 });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl) });
    assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
    assert.equal(modelCalls, 0); assert.equal(requests.uploads.length, 1); assert.equal(requests.submits, 1);
  });
});

test("conflicting frozen facts keep the exact field unresolved while the known file is uploaded", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests); let modelCalls = 0;
    const content = packet(policy.startUrl);
    const driver = createApplicationDeliveryDriver({ harness: { async run(input) {
      modelCalls += 1;
      const form = input.input.form as { fields: AgentBrowserField[] };
      assert.equal(form.fields.find((field) => field.name === "name")?.hasValue, false);
      assert.equal(requests.uploads.length, 1);
    } }, resolvePage: () => page, sitePolicy: policy, submissionHooks: authority.value, browserTimeoutMs: 600 });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: { ...content, facts: [...content.facts, { ...content.facts[0], factVersionId: "conflicting-name", value: "Another Synthetic" }] } });
    assert.equal(result.kind, "QUESTIONS_REQUIRED", JSON.stringify(result));
    assert.equal(modelCalls, 1); assert.equal(requests.submits, 0); assert.equal(authority.begins(), 0);
  });
});

test("displayed upload names must be the exact reviewed name or a clearly shortened form of it", () => {
  const name = "Alex-Fixture-Synthetic-Systems-Resume.pdf";
  for (const text of [name, `${name} (42 KB)`, "Alex-Fixture-S\u2026-Resume.pdf", "Alex-Fixture-Synthetic...ms-Resume.pdf", "Alex-Fixture-Synthetic-Sys\u2026"]) {
    assert.equal(displaysUploadFilename(text, name), true, text);
  }
  for (const text of ["", "resume.pdf", "Alex-Fixture-S\u2026-Resume.docx", "Alex\u2026Resume.pdf", "Alex-Fixture-X\u2026-Resume.pdf", "Alex-Fixture\u2026", "Other-Candidate-Synthetic-Systems-Resume.pdf"]) {
    assert.equal(displaysUploadFilename(text, name), false, text);
  }
  assert.equal(displaysUploadFilename("my resume.pdf", "my resume.pdf"), false, "names with spaces are never uploaded");
});

test("a shortened upload acknowledgement verifies; a different displayed name blocks the upload", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const runtime = await createApplicationDeliveryBrowser({ page, policy, hooks: authority.value, timeoutMs: 400 });
    await runtime.open();
    const field = (await createAgentBrowserTools(page, policy.startUrl).inspect()).fields.find((item) => item.kind === "FILE")!;
    await runtime.upload(field, artifact);
    assert.equal(await page.locator("#upload-ack").innerText(), "Alex-Fixture-S\u2026-Resume.pdf");
    assert.equal(runtime.uploadProofs()[0].filename, artifact.filename);
    await runtime.verifyCurrentUploads();
    await page.locator('[name="name"]').fill("Alex Fixture");
    await runtime.move("FORWARD"); await page.locator('[name="consent"]').check();
    assert.equal((await runtime.submit("9".repeat(64), {})).kind, "CONFIRMED");
    await runtime.dispose();
  }, "shortened-ack");
  await fixture(async ({ page, policy, requests }) => {
    const authority = hooks(requests);
    const runtime = await createApplicationDeliveryBrowser({ page, policy, hooks: authority.value, timeoutMs: 300 });
    await runtime.open();
    const field = (await createAgentBrowserTools(page, policy.startUrl).inspect()).fields.find((item) => item.kind === "FILE")!;
    await assert.rejects(runtime.upload(field, artifact), /UPLOAD_NOT_ACKNOWLEDGED/u);
    assert.equal(runtime.uploaded(field.fieldId), false); assert.equal(requests.submits, 0);
    await runtime.dispose();
  }, "wrong-ack");
});

test("saved answers fill only their own questions; self-identification uses equivalent wording or stays with the candidate", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    await page.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => {
      const select = (name: string, label: string, choices: readonly string[]) =>
        `<label>${label}<select name="${name}"><option value="">Select</option>${choices.map((choice, index) => `<option value="${index + 1}">${choice}</option>`).join("")}</select></label>`;
      document.querySelector("#first")?.insertAdjacentHTML("afterbegin", [
        '<label>Preferred first name<input name="preferred_name"></label>', '<label>ZIP code<input name="zip"></label>',
        '<label>What are your salary expectations?<input name="expected_salary"></label>', '<label>Current salary<input name="current_salary"></label>',
        '<label>Referrer\'s email<input name="referrer_email" type="email"></label>',
        select("source", "How did you hear about us?", ["LinkedIn", "Company careers page"]),
        select("gender", "Gender", ["Male", "Female", "Decline To Self Identify"]),
        select("hispanic", "Are you Hispanic/Latino?", ["Yes", "No", "Decline To Self Identify"]),
        // "I am not a protected veteran" is not "I am not a veteran": left for the candidate.
        select("veteran", "Veteran Status", ["I am a veteran", "I am not a veteran", "Decline to self-identify"]),
        select("disability", "Disability Status", ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"]),
      ].join(""));
    }); });
    const content = packet(policy.startUrl);
    const saved = (factKey: string, value: string) => ({ factVersionId: `${factKey}-v1`, factKey, value, valueHash: createHash("sha256").update(JSON.stringify(value)).digest("hex") }) as ApplicationFillExecutionPackage["facts"][number];
    const facts = [...content.facts, saved("contact.application_email", "alex@example.test"), saved("identity.preferred_name", "Sam"),
      saved("location.postal_code", "20001"), saved("compensation.expected_salary", "$150,000 base"), saved("application.heard_about", "Company careers page"),
      saved("self_id.gender", "Woman"), saved("self_id.hispanic_latino", "Decline to self-identify"),
      saved("self_id.veteran_status", "I am not a protected veteran"), saved("self_id.disability_status", "Decline to self-identify")];
    const authority = hooks(requests); let reviewed: Record<string, string> = {}; const writes: Record<string, unknown>[] = [];
    let modelCalls = 0;
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return questions.filter((item) => item.kind === "BOOLEAN").map((item) => ({ answerId: "consent-true", fieldId: item.fieldId, fingerprint: item.fingerprint, value: true })); },
      async requestQuestions({ questions }) { return questions.map((item) => ({ ...item, id: "question", status: "OPEN" })); },
    };
    // Every required field is filled from facts, so the model is not needed (D-115).
    const harness: AgentFormHarness = { async run() { modelCalls += 1; } };
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, browserTimeoutMs: 600,
      submissionHooks: { ...authority.value, async checkpoint(state) {
        if (state.phase === "STEP_REVIEWED" && state.stepId === "first") {
          reviewed = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#first input:not([type=file]), #first select")].map((element) => [element.name, element.value])));
          writes.push(...state.writes as Record<string, unknown>[]);
        }
        await authority.value.checkpoint?.(state);
      } },
    });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: { ...content, facts } });
    assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
    assert.equal(requests.submits, 1);
    assert.deepEqual({ preferred_name: reviewed.preferred_name, zip: reviewed.zip, expected_salary: reviewed.expected_salary, source: reviewed.source,
      gender: reviewed.gender, hispanic: reviewed.hispanic, disability: reviewed.disability },
    { preferred_name: "Sam", zip: "20001", expected_salary: "$150,000 base", source: "2", gender: "2", hispanic: "3", disability: "3" });
    for (const name of ["current_salary", "referrer_email", "veteran"]) assert.equal(reviewed[name], "", name);
    assert.equal(modelCalls, 0);
    // Every protected write is bound to its approved fact version, never a raw value.
    for (const key of ["self_id.gender", "self_id.hispanic_latino", "self_id.disability_status", "compensation.expected_salary"]) {
      assert.ok(writes.some((write) => write.factVersionId === `${key}-v1` && typeof write.valueHash === "string" && !("value" in write)), key);
    }
    assert.equal(writes.some((write) => write.factVersionId === "self_id.veteran_status-v1"), false);
  });
});

test("model-proposed look-alike facts are refused when a required field sends the step to the model", browserOptions, async () => {
  await fixture(async ({ page, policy, requests }) => {
    await page.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => {
      const select = (name: string, label: string, choices: readonly string[]) =>
        `<label>${label}<select name="${name}"><option value="">Select</option>${choices.map((choice, index) => `<option value="${index + 1}">${choice}</option>`).join("")}</select></label>`;
      document.querySelector("#first")?.insertAdjacentHTML("afterbegin", [
        '<label>Preferred first name<input name="preferred_name"></label>', '<label>ZIP code<input name="zip"></label>',
        '<label>Describe your portfolio<input name="portfolio_notes" required></label>',
        '<label>What are your salary expectations?<input name="expected_salary"></label>', '<label>Current salary<input name="current_salary"></label>',
        '<label>Referrer\'s email<input name="referrer_email" type="email"></label>',
        select("source", "How did you hear about us?", ["LinkedIn", "Company careers page"]),
        select("gender", "Gender", ["Male", "Female", "Decline To Self Identify"]),
        select("hispanic", "Are you Hispanic/Latino?", ["Yes", "No", "Decline To Self Identify"]),
        // "I am not a protected veteran" is not "I am not a veteran": left for the candidate.
        select("veteran", "Veteran Status", ["I am a veteran", "I am not a veteran", "Decline to self-identify"]),
        select("disability", "Disability Status", ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"]),
      ].join(""));
    }); });
    const content = packet(policy.startUrl);
    const saved = (factKey: string, value: string) => ({ factVersionId: `${factKey}-v1`, factKey, value, valueHash: createHash("sha256").update(JSON.stringify(value)).digest("hex") }) as ApplicationFillExecutionPackage["facts"][number];
    const facts = [...content.facts, saved("contact.application_email", "alex@example.test"), saved("identity.preferred_name", "Sam"),
      saved("location.postal_code", "20001"), saved("compensation.expected_salary", "$150,000 base"), saved("application.heard_about", "Company careers page"),
      saved("self_id.gender", "Woman"), saved("self_id.hispanic_latino", "Decline to self-identify"),
      saved("self_id.veteran_status", "I am not a protected veteran"), saved("self_id.disability_status", "Decline to self-identify")];
    const authority = hooks(requests); let reviewed: Record<string, string> = {}; const writes: Record<string, unknown>[] = [];
    const refusals: Record<string, string | undefined> = {};
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions }) { return questions.filter((item) => item.kind === "BOOLEAN").map((item) => ({ answerId: "consent-true", fieldId: item.fieldId, fingerprint: item.fingerprint, value: true })); },
      async requestQuestions({ questions }) { return questions.map((item) => ({ ...item, id: "question", status: "OPEN" })); },
    };
    // A naive model proposes the look-alike fact for every remaining field.
    const naive: Readonly<Record<string, string>> = { current_salary: "compensation.expected_salary", referrer_email: "contact.application_email", veteran: "self_id.veteran_status" };
    const harness: AgentFormHarness = { async run(input) {
      for (const field of (input.input.form as { fields: AgentBrowserField[] }).fields) {
        if (field.hasValue || !naive[field.name]) continue;
        refusals[field.name] = (await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: `${naive[field.name]}-v1` }) as { ok: boolean; errorCode?: string }).errorCode;
        assert.equal(refusals[field.name] === undefined, false, field.name);
      }
    } };
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, browserTimeoutMs: 600,
      submissionHooks: { ...authority.value, async checkpoint(state) {
        if (state.phase === "STEP_REVIEWED" && state.stepId === "first") {
          reviewed = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#first input:not([type=file]), #first select")].map((element) => [element.name, element.value])));
          writes.push(...state.writes as Record<string, unknown>[]);
        }
        await authority.value.checkpoint?.(state);
      } },
    });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: { ...content, facts } });
    // The unanswerable required field stops the step for the candidate; nothing is submitted.
    assert.equal(result.kind, "QUESTIONS_REQUIRED", JSON.stringify(result));
    assert.equal(requests.submits, 0);
    const values = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#first input:not([type=file]), #first select")].map((element) => [element.name, element.value])));
    for (const name of ["current_salary", "referrer_email", "veteran"]) assert.equal(values[name], "", name);
    assert.match(refusals.current_salary ?? "", /CANDIDATE_ANSWER_REQUIRED/u);
    assert.match(refusals.referrer_email ?? "", /CANDIDATE_ANSWER_REQUIRED|FACT_FIELD_MISMATCH/u);
    assert.equal(refusals.veteran, "AGENTS_FILL_OPTION_AMBIGUOUS");
    assert.equal(reviewed.current_salary, undefined, "no step was reviewed");
    assert.equal(writes.length, 0);
  });
});
