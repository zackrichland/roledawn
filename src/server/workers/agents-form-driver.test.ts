import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { chromium, type Page } from "playwright-core";

import { validateAgentQuestionDescriptors, type AgentQuestionAnswer, type AgentQuestionDescriptor, type ApplicationAgentQuestionRepository } from "../../domain/application-agent-questions.ts";
import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import { createAgentBrowserTools, samePhoneNumber } from "./agents-browser-tools.ts";
import { createAgentsFormDriver, parseAgentFormToolArguments, type AgentFormHarness } from "./agents-form-driver.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"]
  .find((path): path is string => Boolean(path && existsSync(path)));
const browserOptions = { skip: chrome ? false : "No local Chromium executable is installed." };
const binding = Object.freeze({
  workspaceId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000002",
  applicationId: "30000000-0000-4000-8000-000000000003", revisionId: "40000000-0000-4000-8000-000000000004",
  fillAttemptId: "50000000-0000-4000-8000-000000000005", computerSessionId: "60000000-0000-4000-8000-000000000006",
});

function packet(url: string): ApplicationFillExecutionPackage {
  const bytes = new TextEncoder().encode("%PDF-1.7 fixture authorized bytes");
  return {
    schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", binding, destinationUrl: url, submitAuthorized: false,
    facts: [
      { factVersionId: "name-fact", factKey: "identity.legal_name", value: "Alex Candidate", valueHash: "a".repeat(64) },
      { factVersionId: "email-fact", factKey: "contact.application_email", value: "alex@example.test", valueHash: "b".repeat(64) },
      { factVersionId: "auth-fact", factKey: "work_authorization.us.authorized", value: "Yes", valueHash: "c".repeat(64) },
    ],
    artifacts: [{ artifactVersionId: "resume-artifact", variant: "RESUME_PDF", filename: "resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: createHash("sha256").update(bytes).digest("hex") }],
  };
}

async function fixture(html: string, run: (page: Page, url: string, requests: () => number) => Promise<void>) {
  let submissionRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/job" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><html><body>${html}</body></html>`);
    } else { submissionRequests += 1; response.writeHead(409).end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FIXTURE_ADDRESS_INVALID");
  const url = `http://127.0.0.1:${address.port}/job`;
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  // Mimic the independent production guard without contacting any provider.
  await page.route("**/*", async (route) => {
    if (route.request().url() === url && route.request().method() === "GET") await route.continue();
    else await route.abort();
  });
  try { await page.goto(url); await run(page, url, () => submissionRequests); }
  finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function repository() {
  let requested: readonly AgentQuestionDescriptor[] = [];
  const answers: AgentQuestionAnswer[] = [];
  const value: ApplicationAgentQuestionRepository = {
    async requestQuestions(input) {
      assert.deepEqual(input.binding, binding);
      validateAgentQuestionDescriptors(input.questions);
      requested = input.questions;
      return requested.map((question, index) => ({ ...question, id: `question-${index}`, status: "OPEN" }));
    },
    async loadAnswers(input) {
      assert.deepEqual(input.binding, binding);
      validateAgentQuestionDescriptors(input.questions);
      return answers.filter((answer) => input.questions.some((question) => question.fieldId === answer.fieldId && question.fingerprint === answer.fingerprint));
    },
  };
  return { value, answers, requested: () => requested };
}

type HarnessInput = Parameters<AgentFormHarness["run"]>[0];
type ModelField = { fieldId: string; fingerprint: string; label: string; kind: string; required: boolean; hasValue: boolean };
function modelFields(input: HarnessInput): ModelField[] {
  return (input.input.form as { fields: ModelField[] }).fields;
}
function driverFor(page: Page, harness: AgentFormHarness, questions?: ApplicationAgentQuestionRepository) {
  return createAgentsFormDriver({ harness, questions, resolvePage: () => page, recordUpload: () => undefined });
}
function driverInput(url: string) {
  return { binding, startUrl: url, executionPackage: packet(url), runtimeHandle: {}, submitAuthorized: false as const };
}

test("strict agent tools reject value injection, invented fields, extra arguments and submit tools", () => {
  assert.deepEqual(parseAgentFormToolArguments("inspect_form", {}), {});
  assert.throws(() => parseAgentFormToolArguments("fill_fact", { fieldId: "x", factVersionId: "fact", value: "invented" }), /ARGUMENTS_INVALID/u);
  assert.throws(() => parseAgentFormToolArguments("request_questions", { fieldIds: ["model-invented"] }), /ARGUMENTS_INVALID/u);
  assert.throws(() => parseAgentFormToolArguments("submit_application", {}), /ARGUMENTS_INVALID/u);
  assert.throws(() => parseAgentFormToolArguments("inspect_form", { url: "https://evil.test" }), /ARGUMENTS_INVALID/u);
});

test("agent maps varied labels, selects approved bytes, asks a real legal question after known fills, then resumes", browserOptions, async () => {
  await fixture(`<form action="/submit" method="post">
    <label>How should we address you?<input name="candidate" required></label>
    <label>Where can we reach you?<input name="updates" type="email" required></label>
    <label>Attach your profile document<input name="document" type="file" accept="application/pdf" required></label>
    <label>May we run a background check?<input name="consent" type="checkbox" required></label>
    <label>Your note<textarea name="existing">Written by candidate</textarea></label>
    <button type="submit">Submit</button></form>`, async (page, url, requests) => {
    const questions = repository();
    const harness: AgentFormHarness = { async run(input) {
      assert.deepEqual(input.binding, binding);
      const fields = modelFields(input);
      for (const field of fields.filter((item) => !item.hasValue)) {
        if (field.label.includes("address you")) assert.equal((await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-fact" }) as { ok: boolean }).ok, true);
        else if (field.label.includes("reach you")) await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "email-fact" });
        else if (field.kind === "FILE") await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-artifact" });
        else if (field.label.includes("background")) {
          const form = input.input.form as { answers: { answerId: string; fieldId: string }[] };
          const answer = form.answers.find((item) => item.fieldId === field.fieldId);
          if (answer) await input.executeTool("answer_field", { fieldId: field.fieldId, answerId: answer.answerId });
          else await input.executeTool("request_questions", { fieldIds: [field.fieldId] });
        }
      }
      await input.executeTool("complete_review", {});
    } };
    const driver = driverFor(page, harness, questions.value);
    const first = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(first.kind, "TAKEOVER");
    assert.equal(first.filledFieldCount, 2);
    assert.equal(first.uploadedArtifactCount, 1);
    assert.equal(await page.locator('[name="candidate"]').inputValue(), "Alex Candidate");
    assert.equal(await page.locator('[name="existing"]').inputValue(), "Written by candidate");
    assert.equal(questions.requested().length, 1);
    const question = questions.requested()[0];
    assert.equal(question.reasonCode, "SENSITIVE_REQUIRES_CANDIDATE");
    questions.answers.push({ answerId: "answer-consent", fieldId: question.fieldId, fingerprint: question.fingerprint, value: true });
    const second = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(second.kind, "FILLED_TO_REVIEW");
    assert.equal(await page.locator('[name="consent"]').isChecked(), true);
    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    assert.equal(requests(), 0);
  });
});

test("native radio, checkbox groups, multi-select and boolean controls have deterministic readback", browserOptions, async () => {
  await fixture(`<form>
    <fieldset><legend>Working arrangement</legend><label><input type="radio" name="mode" value="remote" required>Remote</label><label><input type="radio" name="mode" value="office">Office</label></fieldset>
    <fieldset><legend>Teams</legend><label><input type="checkbox" name="teams" value="product">Product</label><label><input type="checkbox" name="teams" value="platform">Platform</label></fieldset>
    <label>Regions<select name="regions" multiple required><option value="us">United States</option><option value="ca">Canada</option></select></label>
    <label>Contact permission<input name="contact" type="checkbox"></label></form>`, async (page, url) => {
    const tools = createAgentBrowserTools(page, url);
    const before = await tools.inspect();
    assert.equal(before.fields.length, 4);
    const field = (name: string) => before.fields.find((item) => item.name === name)!.fieldId;
    await tools.fillValue(field("mode"), "Remote");
    await tools.fillValue(field("teams"), ["Product", "Platform"]);
    await tools.fillValue(field("regions"), ["United States", "Canada"]);
    await tools.fillValue(field("contact"), false);
    const after = await tools.verifyWrites();
    assert.equal(after.fields.every((item) => !item.required || item.hasValue && item.valid), true);
    assert.equal(tools.counts().filledFieldCount, 4);
    assert.deepEqual(after.fields.map((item) => item.fingerprint), before.fields.map((item) => item.fingerprint));
  });
});

test("Ashby Yes/No buttons retain the question, requiredness, form identity and explicit No readback", browserOptions, async () => {
  await fixture(`<div class="ashby-application-form-field-entry" data-field-path="clearance" data-field-entry-id="form-one_clearance">
    <label class="ashby-application-form-question-title _required_fixture_1">Do you possess the required clearance?</label>
    <div class="ashby-application-form-input-yesno">
      <button data-option="yes" aria-pressed="false">Yes</button><button data-option="no" aria-pressed="false">No</button>
      <input style="display:none" type="checkbox" name="clearance">
    </div></div>
    <script>document.querySelectorAll('button').forEach(button => button.onclick = () => {
      document.querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    });</script>`, async (page, url, requests) => {
    const disabled = await createAgentBrowserTools(page, url).inspect();
    assert.equal(disabled.fields.length, 0);
    const tools = createAgentBrowserTools(page, url, { ashbyLabels: true });
    const before = await tools.inspect();
    assert.equal(before.fields.length, 1);
    const field = before.fields[0];
    assert.equal(field.label, "Do you possess the required clearance?");
    assert.equal(field.domId, "clearance"); assert.equal(field.formKey, "form-one");
    assert.equal(field.kind, "SINGLE_SELECT"); assert.equal(field.required, true); assert.equal(field.hasValue, false);
    await tools.fillValue(field.fieldId, "No");
    const after = await tools.verifyWrites();
    assert.equal(after.fields[0].fieldId, field.fieldId); assert.equal(after.fields[0].hasValue, true); assert.equal(after.fields[0].valid, true);
    assert.equal(await page.locator('button[data-option="no"]').getAttribute("aria-pressed"), "true");
    assert.equal(requests(), 0);
  });
});

test("Ashby city lookup selects one confirmed result and keeps identity after selection", browserOptions, async () => {
  await fixture(`<div class="ashby-application-form-field-entry" data-field-path="_systemfield_location" data-field-entry-id="form-one__systemfield_location">
    <label class="ashby-application-form-question-title _required_fixture_1">Location</label>
    <input class="ashby-application-form-input-autocomplete" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-haspopup="listbox">
    </div><script>
    const input = document.querySelector('input');
    input.oninput = () => {
      document.getElementById(':r0:')?.remove();
      const list = document.createElement('div'); list.id = ':r0:'; list.setAttribute('role', 'listbox');
      list.innerHTML = '<div class="ashby-application-form-input-autocomplete-popup"><div class="ashby-application-form-input-autocomplete-popup-result" role="option" id=":r1:" aria-selected="true">Springfield, Missouri, United States</div><div class="ashby-application-form-input-autocomplete-popup-result" role="option" id=":r2:" aria-selected="false">Springfield, Illinois, United States</div></div>';
      list.querySelectorAll('[role=option]').forEach(option => option.onclick = () => { input.value = option.textContent; input.setAttribute('aria-expanded', 'false'); list.remove(); });
      document.body.append(list); input.setAttribute('aria-controls', ':r0:'); input.setAttribute('aria-expanded', 'true');
    };</script>`, async (page, url) => {
    let approvedSearch = "";
    const tools = createAgentBrowserTools(page, url, { ashbyLabels: true, remoteSearch: true, remoteSearchSemantic: "CITY", withRemoteSearch: async (query, run) => { approvedSearch = query; return run(); } });
    const field = (await tools.inspect()).fields[0];
    assert.equal(field.label, "Location"); assert.equal(field.required, true); assert.equal(field.searchable, true);
    await tools.fillValue(field.fieldId, "Springfield", undefined, { semantic: "CITY", source: "FACT", hints: { region: "IL", country: "US" } });
    assert.equal(approvedSearch, "Springfield");
    assert.equal(await page.locator("input").inputValue(), "Springfield, Illinois, United States");
    const after = (await tools.verifyWrites()).fields[0];
    assert.equal(after.fieldId, field.fieldId); assert.equal(after.valid, true); assert.equal(after.hasValue, true);
  });
});

test("Ashby ambiguous button state is unsupported and cannot hide a required question", browserOptions, async () => {
  await fixture(`<div class="ashby-application-form-field-entry" data-field-path="clearance" data-field-entry-id="form-one_clearance">
    <label class="ashby-application-form-question-title _required_fixture_1">Do you currently possess an active TS/SCI with FSP or CI?</label>
    <div class="ashby-application-form-input-yesno"><button data-option="yes" aria-pressed="true">Yes</button><button data-option="no" aria-pressed="true">No</button></div>
    </div>`, async (page, url) => {
    const tools = createAgentBrowserTools(page, url, { ashbyLabels: true });
    const field = (await tools.inspect()).fields[0];
    assert.equal(field.kind, "UNSUPPORTED"); assert.equal(field.required, true); assert.equal(field.candidateOnly, true);
    assert.equal(field.valid, false);
    await assert.rejects(tools.fillValue(field.fieldId, "No"), /CONTROL_UNSUPPORTED/u);
  });
});

test("Ashby scoped instructions preserve candidate authorship without absorbing other fields", browserOptions, async () => {
  await fixture(`<div class="ashby-application-form-field-entry" data-field-path="interest" data-field-entry-id="form-one_interest">
    <label class="ashby-application-form-question-title">What interests you here?</label>
    <div class="ashby-application-form-question-description"><p>In your own words, without using AI.</p></div><textarea></textarea>
    </div><div class="ashby-application-form-field-entry" data-field-path="email" data-field-entry-id="form-one_email">
    <label class="ashby-application-form-question-title">Email</label><input type="email"></div>`, async (page, url) => {
    const browser = createAgentBrowserTools(page, url, { ashbyLabels: true });
    const fields = (await browser.inspect()).fields;
    assert.equal(fields[0].candidateOnly, true);
    assert.match(fields[0].label, /without using AI/u);
    assert.equal(fields[1].label, "Email"); assert.equal(fields[1].candidateOnly, false);
    await page.locator('.ashby-application-form-question-description').evaluate(node => { node.textContent = 'A brief answer is fine.'; });
    assert.notEqual((await browser.inspect()).fields[0].fingerprint, fields[0].fingerprint);
  });
});

test("agent declarations cannot bypass missing required fields or upload byte authority", browserOptions, async () => {
  await fixture('<form><label>Required reply<input name="reply" required></label><label>Resume<input type="file" name="file" required></label></form>', async (page, url) => {
    const questions = repository();
    const declared = driverFor(page, { async run(input) {
      const result = await input.executeTool("complete_review", {}) as { complete: boolean };
      assert.equal(result.complete, false);
    } }, questions.value);
    assert.equal((await declared.fillToPreSubmitReview(driverInput(url))).kind, "TAKEOVER");
    const tampered = driverInput(url);
    tampered.executionPackage.artifacts[0].bytes[0] ^= 1;
    const uploader = driverFor(page, { async run(input) {
      const field = modelFields(input).find((item) => item.kind === "FILE")!;
      await input.executeTool("upload_artifact", { fieldId: field.fieldId, artifactVersionId: "resume-artifact" });
    } });
    const result = await uploader.fillToPreSubmitReview(tampered);
    assert.equal(result.kind, "FAILED_SAFE");
    assert.equal(result.reasonCode, "AGENTS_FILL_ARTIFACT_HASH_MISMATCH");
  });
});

test("malicious tools and changed readback fail without submission", browserOptions, async () => {
  await fixture('<form action="/submit"><label>Contact<input name="email" type="email" required></label><button type="submit">Continue</button></form>', async (page, url, requests) => {
    const malicious = driverFor(page, { async run(input) { await input.executeTool("submit_application", {}); } });
    assert.equal((await malicious.fillToPreSubmitReview(driverInput(url))).kind, "FAILED_SAFE");
    await page.locator('input').evaluate((element) => element.addEventListener("input", () => { (element as HTMLInputElement).value = "replaced@example.test"; }));
    const changed = driverFor(page, { async run(input) {
      await input.executeTool("fill_fact", { fieldId: modelFields(input)[0].fieldId, factVersionId: "email-fact" });
    } });
    const outcome = await changed.fillToPreSubmitReview(driverInput(url));
    assert.equal(outcome.kind, "FAILED_SAFE");
    assert.equal(outcome.reasonCode, "AGENTS_FILL_READBACK_MISMATCH");
    assert.equal(requests(), 0);
  });
});

test("factual narrative requires cited evidence and independent validation; exact and legal fields cannot use it", browserOptions, async () => {
  await fixture('<form><label>Describe your relevant experience<textarea name="experience" required></textarea></label><label>How many years of experience?<input name="years" required></label></form>', async (page, url) => {
    let validations = 0;
    const questions = repository();
    const driver = createAgentsFormDriver({
      resolvePage: () => page, recordUpload: () => undefined, questions: questions.value,
      evidence: {
        async load() { return [{ sourceId: "resume-source", text: "Built clinician scheduling software." }]; },
        async validate({ text, sourceIds }) { validations += 1; return text === "Built clinician scheduling software." && sourceIds[0] === "resume-source"; },
      },
      harness: { async run(input) {
        const fields = modelFields(input);
        const experience = fields.find((field) => field.kind === "LONG_TEXT")!;
        const years = fields.find((field) => field.kind === "TEXT")!;
        const unsupported = await input.executeTool("fill_supported_text", { fieldId: experience.fieldId, text: "Won a national award.", sourceIds: ["resume-source"] }) as { ok: boolean };
        assert.equal(unsupported.ok, false);
        assert.equal(await page.locator("textarea").inputValue(), "");
        await input.executeTool("fill_supported_text", { fieldId: experience.fieldId, text: "Built clinician scheduling software.", sourceIds: ["resume-source"] });
        const exact = await input.executeTool("fill_supported_text", { fieldId: years.fieldId, text: "5", sourceIds: ["resume-source"] }) as { errorCode: string };
        assert.equal(exact.errorCode, "AGENTS_FILL_CANDIDATE_ANSWER_REQUIRED");
      } },
    });
    const result = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(result.kind, "TAKEOVER");
    assert.equal(result.filledFieldCount, 1);
    assert.equal(validations, 2);
    assert.equal(questions.requested()[0].label, "How many years of experience?");
  });
});

test("CAPTCHA and login gates avoid the harness; multi-page controls cannot imply completed review", browserOptions, async () => {
  await fixture('<form><label>Password<input type="password" required></label></form>', async (page, url) => {
    let calls = 0;
    const result = await driverFor(page, { async run() { calls += 1; } }).fillToPreSubmitReview(driverInput(url));
    assert.equal(result.kind, "TAKEOVER");
    assert.equal(calls, 0);
  });
  await fixture('<form><label>Name<input value="Candidate supplied" required></label><button type="button">Next step</button></form>', async (page, url) => {
    const result = await driverFor(page, { async run(input) { await input.executeTool("complete_review", {}); } }).fillToPreSubmitReview(driverInput(url));
    assert.equal(result.kind, "TAKEOVER");
    assert.equal(result.reasonCode, "AGENTS_FILL_NAVIGATION_REQUIRES_POLICY");
  });
});

test("stale answer fingerprints and sensitive fact substitution cannot fill a legal answer", browserOptions, async () => {
  await fixture('<form><label>Are you a United States citizen?<select required><option value="">Choose</option><option value="yes">Yes</option></select></label></form>', async (page, url) => {
    const questions = repository();
    const untrustedRepository: ApplicationAgentQuestionRepository = {
      requestQuestions: questions.value.requestQuestions,
      async loadAnswers({ questions: descriptors }) {
        return [{ answerId: "stale-answer", fieldId: descriptors[0].fieldId, fingerprint: "f".repeat(64), value: "yes" }];
      },
    };
    const driver = driverFor(page, { async run(input) {
      const fieldId = modelFields(input)[0].fieldId;
      const fact = await input.executeTool("fill_fact", { fieldId, factVersionId: "auth-fact" }) as { errorCode: string };
      assert.equal(fact.errorCode, "AGENTS_FILL_CANDIDATE_ANSWER_REQUIRED");
      const answer = await input.executeTool("answer_field", { fieldId, answerId: "stale-answer" }) as { errorCode: string };
      assert.equal(answer.errorCode, "AGENTS_FILL_ANSWER_NOT_AUTHORIZED");
    } }, untrustedRepository);
    assert.equal((await driver.fillToPreSubmitReview(driverInput(url))).kind, "TAKEOVER");
    assert.equal(await page.locator("select").inputValue(), "");
  });
});

test("nationality and religion cannot be inferred from an ordinary profile fact", browserOptions, async () => {
  await fixture('<form><label>Nationality<input name="nationality" required></label><label>Religion<input name="religion" required></label></form>', async (page, url) => {
    const questions = repository();
    const driver = driverFor(page, { async run(input) {
      for (const field of modelFields(input)) {
        const result = await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "name-fact" }) as { errorCode: string };
        assert.equal(result.errorCode, "AGENTS_FILL_CANDIDATE_ANSWER_REQUIRED");
      }
    } }, questions.value);
    const result = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(result.kind, "TAKEOVER");
    assert.equal(result.filledFieldCount, 0);
    assert.equal(questions.requested().length, 2);
  });
});

test("aborting during evidence validation prevents the late browser mutation", browserOptions, async () => {
  await fixture('<form><label>Describe relevant experience<textarea required></textarea></label></form>', async (page, url) => {
    const controller = new AbortController();
    const driver = createAgentsFormDriver({
      resolvePage: () => page, recordUpload: () => undefined,
      evidence: {
        async load() { return [{ sourceId: "source", text: "Built scheduling tools." }]; },
        async validate() { controller.abort(); return true; },
      },
      harness: { async run(input) {
        await input.executeTool("fill_supported_text", { fieldId: modelFields(input)[0].fieldId, text: "Built scheduling tools.", sourceIds: ["source"] }, controller.signal);
      } },
    });
    const outcome = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(outcome.kind, "FAILED_SAFE");
    assert.equal(outcome.reasonCode, "AGENTS_FILL_CANCELLED");
    assert.equal(await page.locator("textarea").inputValue(), "");
  });
});

test("successful complete_review closes the mutation boundary", browserOptions, async () => {
  await fixture('<form><label>Name<input name="name" value="Already reviewed" required></label><label>Email<input name="email" type="email"></label></form>', async (page, url) => {
    const driver = driverFor(page, { async run(input) {
      const completed = await input.executeTool("complete_review", {}) as { complete: boolean };
      assert.equal(completed.complete, true);
      const email = modelFields(input).find((item) => item.label === "Email")!;
      const late = await input.executeTool("fill_fact", { fieldId: email.fieldId, factVersionId: "email-fact" }) as { errorCode: string };
      assert.equal(late.errorCode, "AGENTS_FILL_REVIEW_ALREADY_COMPLETE");
    } });
    assert.equal((await driver.fillToPreSubmitReview(driverInput(url))).kind, "FILLED_TO_REVIEW");
    assert.equal(await page.locator('[name="email"]').inputValue(), "");
  });
});

test("React-style combobox typing cannot masquerade as a selected answer and hidden native uploads stay visible", browserOptions, async () => {
  await fixture('<form><label>Choose a country<input name="country_search" role="combobox" aria-required="true"></label><input name="resume" type="file" style="display:none" required></form>', async (page, url) => {
    const browser = createAgentBrowserTools(page, url);
    const snapshot = await browser.inspect();
    const combo = snapshot.fields.find((field) => field.name === "country_search")!;
    assert.equal(combo.kind, "UNSUPPORTED");
    assert.equal(snapshot.fields.some((field) => field.name === "resume" && field.kind === "FILE" && field.required), true);
    await assert.rejects(browser.fillValue(combo.fieldId, "United States"), /CONTROL_UNSUPPORTED/u);
    const outcome = await driverFor(page, { async run(input) { await input.executeTool("complete_review", {}); } }).fillToPreSubmitReview(driverInput(url));
    assert.equal(outcome.kind, "TAKEOVER");
    assert.equal(await page.locator('[name="country_search"]').inputValue(), "");
  });
});

function ariaMenu(id: string, label: string): string {
  return `<div class="field"><label for="${id}">${label}</label>
    <input id="${id}" role="combobox" aria-haspopup="listbox" aria-controls="${id}-listbox" aria-expanded="false" aria-required="true" autocomplete="off">
    <span id="${id}-display"></span><input name="${id}-value" type="hidden">
    <div id="${id}-listbox" role="listbox" hidden></div></div>
    <script>(() => {
      const input = document.getElementById('${id}');
      const menu = document.getElementById('${id}-listbox');
      const state = { selected: null, tamper: false, options: [{id:'${id}-option-yes',value:'yes-value',label:'Yes'},{id:'${id}-option-no',value:'no-value',label:'No'}] };
      globalThis['${id}State'] = state;
      function close() { menu.hidden = true; input.setAttribute('aria-expanded','false'); }
      function render() {
        menu.replaceChildren(...state.options.map(item => {
          const option = document.createElement(item.tag ?? 'div');
          option.id=item.id; option.role='option'; option.dataset.value=item.value;
          option.setAttribute('aria-selected',String(state.selected===item.value)); option.textContent=item.label;
          option.addEventListener('click',()=> {
            if(!state.tamper) state.selected=item.value;
            document.querySelector('[name="${id}-value"]').value=state.selected ?? '';
            document.getElementById('${id}-display').textContent=item.label;
            input.value=''; close();
          }); return option;
        }));
      }
      input.addEventListener('keydown',event=>{
        if(event.key==='ArrowDown') { event.preventDefault(); render(); menu.hidden=false; input.setAttribute('aria-expanded','true'); }
        if(event.key==='Escape') {event.preventDefault();close();}
      });
    })();</script>`;
}

test("observed ARIA options support exact work authorization then candidate consent on the same retained form", browserOptions, async () => {
  await fixture(`<form>${ariaMenu("authorization", "Are you legally authorized to work in the United States?")}${ariaMenu("consent", "Do you consent to background screening?")}<button type="submit">Submit</button></form>`, async (page, url, requests) => {
    const questions = repository();
    const harness: AgentFormHarness = { async run(input) {
      const fields = modelFields(input);
      for (const field of fields.filter((item) => !item.hasValue)) {
        if (field.label.includes("authorized to work")) {
          const filled = await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: "auth-fact" }) as { ok: boolean };
          assert.equal(filled.ok, true);
        } else {
          const answer = (input.input.form as { answers: { answerId: string; fieldId: string }[] }).answers.find((item) => item.fieldId === field.fieldId);
          if (answer) await input.executeTool("answer_field", { fieldId: field.fieldId, answerId: answer.answerId });
          else await input.executeTool("request_questions", { fieldIds: [field.fieldId] });
        }
      }
      await input.executeTool("complete_review", {});
    } };
    const driver = driverFor(page, harness, questions.value);
    const first = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(first.kind, "TAKEOVER");
    assert.equal(first.filledFieldCount, 1);
    assert.equal(await page.locator('[name="authorization-value"]').inputValue(), "yes-value");
    const descriptor = questions.requested()[0];
    assert.equal(descriptor.kind, "SINGLE_SELECT");
    assert.deepEqual(descriptor.options.map((option) => option.value), ["yes-value", "no-value"]);
    questions.answers.push({ answerId: "consent-answer", fieldId: descriptor.fieldId, fingerprint: descriptor.fingerprint, value: "yes-value" });
    const second = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(second.kind, "FILLED_TO_REVIEW");
    assert.equal(await page.locator('[name="consent-value"]').inputValue(), "yes-value");
    assert.equal(await page.locator('#consent').inputValue(), "");
    assert.equal(await page.locator('#consent').getAttribute("aria-expanded"), "false");
    assert.equal(requests(), 0);
  });
});

test("ARIA option fingerprints remain stable across opening and reject drift, fake selection and search text", browserOptions, async () => {
  await fixture(`<form>${ariaMenu("choice", "Choose one")}</form>`, async (page, url) => {
    const browser = createAgentBrowserTools(page, url);
    const first = await browser.inspect();
    assert.equal(first.fields[0].kind, "SINGLE_SELECT");
    assert.equal((await browser.inspect()).fields[0].fingerprint, first.fields[0].fingerprint);
    await page.evaluate(() => {
      (globalThis as typeof globalThis & { choiceState: { tamper: boolean } }).choiceState.tamper = true;
    });
    await assert.rejects(browser.fillValue(first.fields[0].fieldId, "Yes"), /READBACK_MISMATCH/u);
    await page.evaluate(() => {
      (globalThis as typeof globalThis & { choiceState: { options: { label: string }[] } }).choiceState.options[0].label = "Changed semantic answer";
    });
    await assert.rejects(browser.fillValue(first.fields[0].fieldId, "Yes"), /FIELD_DRIFT/u);
    await page.locator('#choice').fill("Yes");
    const searchOnly = await browser.inspect();
    assert.equal(searchOnly.fields[0].kind, "UNSUPPORTED");
    assert.equal((await driverFor(page, { async run() {} }).fillToPreSubmitReview(driverInput(url))).kind, "TAKEOVER");
  });
});

test("native select placeholders are excluded from question choices and upload labels include the field heading", browserOptions, async () => {
  await fixture('<form><label>Available arrangement<select name="arrangement" required><option value="">Select...</option><option value="remote">Remote</option></select></label><div class="file-upload"><label class="field-label">Resume/CV</label><div><label for="resume">Attach</label><input id="resume" type="file" style="display:none"></div></div></form>', async (page, url) => {
    const questions = repository();
    const browser = createAgentBrowserTools(page, url);
    const snapshot = await browser.inspect();
    assert.deepEqual(snapshot.fields.find((field) => field.name === "arrangement")!.options, [{ value: "remote", label: "Remote" }]);
    assert.match(snapshot.fields.find((field) => field.kind === "FILE")!.label, /Resume\/CV/u);
    const result = await driverFor(page, { async run() {} }, questions.value).fillToPreSubmitReview(driverInput(url));
    assert.equal(result.kind, "TAKEOVER");
    assert.equal(questions.requested().length, 1);
  });
});

test("Name a project is a narrative prompt, while a bare Name field remains exact", browserOptions, async () => {
  await fixture('<form><label>Name a project you built<textarea required></textarea></label><label>Name<input required></label></form>', async (page, url) => {
    let validations = 0;
    const driver = createAgentsFormDriver({ resolvePage: () => page, recordUpload: () => undefined,
      evidence: { async load() { return [{ sourceId: "source", text: "Built a scheduling portal." }]; }, async validate() { validations += 1; return true; } },
      harness: { async run(input) {
        const fields = modelFields(input);
        const narrative = await input.executeTool("fill_supported_text", { fieldId: fields.find((field) => field.kind === "LONG_TEXT")!.fieldId, text: "Built a scheduling portal.", sourceIds: ["source"] }) as { ok: boolean };
        assert.equal(narrative.ok, true);
        const exact = await input.executeTool("fill_supported_text", { fieldId: fields.find((field) => field.kind === "TEXT")!.fieldId, text: "Alex", sourceIds: ["source"] }) as { ok: boolean };
        assert.equal(exact.ok, false);
      } },
    });
    assert.equal((await driver.fillToPreSubmitReview(driverInput(url))).kind, "TAKEOVER");
    assert.equal(validations, 1);
  });
});

test("existing candidate ARIA selection is preserved and unverifiable option menus stay unsupported", browserOptions, async () => {
  await fixture(`<form>${ariaMenu("choice", "Choose one")}</form>`, async (page, url) => {
    await page.evaluate(() => {
      (globalThis as typeof globalThis & { choiceState: { selected: string } }).choiceState.selected = "no-value";
    });
    const browser = createAgentBrowserTools(page, url);
    const snapshot = await browser.inspect();
    assert.equal(snapshot.fields[0].hasValue, true);
    await assert.rejects(browser.fillValue(snapshot.fields[0].fieldId, "Yes"), /CANDIDATE_VALUE_PRESERVED/u);
    assert.equal((await browser.verifyWrites()).fields[0].fingerprint, snapshot.fields[0].fingerprint);
    await page.locator('#choice-listbox').evaluate((element) => element.setAttribute("aria-busy", "true"));
    assert.equal((await createAgentBrowserTools(page, url).inspect()).fields[0].kind, "UNSUPPORTED");
    await page.locator('#choice-listbox').evaluate((element) => element.removeAttribute("aria-busy"));
    await page.evaluate(() => {
      (globalThis as typeof globalThis & { choiceState: { options: { tag?: string }[] } }).choiceState.options[0].tag = "button";
    });
    assert.equal((await createAgentBrowserTools(page, url).inspect()).fields[0].kind, "UNSUPPORTED");
  });
});

test("unrepresentable native and ARIA choices do not abort known fills or complete required controls", browserOptions, async () => {
  await fixture(`<form>
    <label>Name<input name="name" required></label>
    <label>Oversized value<select required><option value="${"v".repeat(501)}">Choice</option></select></label>
    <label>Oversized label<select required><option value="valid">${"l".repeat(501)}</option></select></label>
    <label>Empty label<select required><option value="valid"></option></select></label>
    <label>Duplicate choices<select required><option value="duplicate">One</option><option value="duplicate">Two</option></select></label>
    ${ariaMenu("oversized", "Custom oversized choice")}
    <label>Available arrangement<select name="arrangement" required><option value="">Select...</option><option value="remote">Remote</option></select></label>
  </form>`, async (page, url) => {
    await page.evaluate(() => {
      const state = (globalThis as typeof globalThis & { oversizedState: { selected: string; options: { label: string }[] } }).oversizedState;
      state.selected = "yes-value";
      state.options[0].label = "x".repeat(501);
    });
    const questions = repository();
    const driver = driverFor(page, { async run(input) {
      const fields = modelFields(input);
      assert.equal(fields.filter((field) => field.kind === "UNSUPPORTED").length, 5);
      assert.equal(fields.find((field) => field.label === "Custom oversized choice")?.hasValue, true);
      const name = fields.find((field) => field.label === "Name")!;
      assert.equal((await input.executeTool("fill_fact", { fieldId: name.fieldId, factVersionId: "name-fact" }) as { ok: boolean }).ok, true);
      assert.equal((await input.executeTool("complete_review", {}) as { complete: boolean }).complete, false);
    } }, questions.value);
    const result = await driver.fillToPreSubmitReview(driverInput(url));
    assert.equal(result.kind, "TAKEOVER");
    assert.equal(result.filledFieldCount, 1);
    assert.equal(result.blockedFieldCount, 6);
    assert.equal(await page.locator('[name="name"]').inputValue(), "Alex Candidate");
    assert.equal(questions.requested().length, 1);
    assert.match(questions.requested()[0].label, /Available arrangement/u);
  });
});

test("compound and negative work authorization questions require an exact candidate answer", browserOptions, async () => {
  const prompts = [
    "Are you authorized to work in the US without sponsorship?",
    "Are you authorized to work in the US and will you require sponsorship?",
    "Do you NOT require sponsorship in the US?",
    "Will you never require sponsorship in the US?",
    "Are you authorized to work in the US unless sponsorship is required?",
    "Aren't you authorized to work in the US?",
  ];
  await fixture(`<form>${prompts.map((prompt, index) => `<label>${prompt}<select name="work_${index}" required><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select></label>`).join("")}</form>`, async (page, url) => {
    const questions = repository();
    const driver = driverFor(page, { async run(input) {
      for (const field of modelFields(input)) {
        for (const factVersionId of ["auth-fact", "sponsor-fact"]) {
          const result = await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId }) as { errorCode: string };
          assert.equal(result.errorCode, "AGENTS_FILL_CANDIDATE_ANSWER_REQUIRED");
        }
      }
      assert.equal((await input.executeTool("complete_review", {}) as { complete: boolean }).complete, false);
    } }, questions.value);
    const input = driverInput(url);
    const result = await driver.fillToPreSubmitReview({ ...input, executionPackage: {
      ...input.executionPackage, facts: [...input.executionPackage.facts,
        { factVersionId: "sponsor-fact", factKey: "work_authorization.us.sponsorship_required", value: "No", valueHash: "d".repeat(64) },
      ],
    } });
    assert.equal(result.kind, "TAKEOVER");
    assert.equal(result.filledFieldCount, 0);
    assert.equal(questions.requested().length, prompts.length);
    assert.equal(questions.requested().every((question) => question.reasonCode === "SENSITIVE_REQUIRES_CANDIDATE"), true);
    for (const select of await page.locator("select").all()) assert.equal(await select.inputValue(), "");
  });
});

test("a phone widget's own format of the same number reads back; any other change does not", () => {
  assert.equal(samePhoneNumber("+1 555-010-0199", "+15550100199"), true);
  assert.equal(samePhoneNumber("(555) 010-0199", "+15550100199"), true);
  assert.equal(samePhoneNumber("+44 20 7946 0958", "+442079460958"), true);
  assert.equal(samePhoneNumber("(555) 010-0198", "+15550100199"), false);
  assert.equal(samePhoneNumber("+1 555-010-0199", "(555) 010-0199"), false);
  assert.equal(samePhoneNumber("0199", "+15550100199"), false);
  assert.equal(samePhoneNumber("+1 555-010-0199 ext. 2", "+15550100199"), false);
  assert.equal(samePhoneNumber("555-010-0199", "5550100199"), true);
});

test("a reformatting tel input accepts the same number; plain text still needs an exact readback", browserOptions, async () => {
  await fixture(`<form><label for="phone">Phone</label><input id="phone" type="tel">
    <label for="city">City</label><input id="city" type="text"></form>
    <script>const phone=document.getElementById('phone');phone.addEventListener('input',()=>{const d=phone.value.replace(/\\D/g,'');if(d.length===11&&d.startsWith('1'))phone.value='+1 '+d.slice(1,4)+'-'+d.slice(4,7)+'-'+d.slice(7);});
      const city=document.getElementById('city');city.addEventListener('input',()=>{city.value=city.value.toUpperCase();});</script>`, async (page, url) => {
    const browser = createAgentBrowserTools(page, url);
    const fields = (await browser.inspect()).fields;
    const phone = fields.find((field) => field.domId === "phone")!;
    const city = fields.find((field) => field.domId === "city")!;
    await browser.fillValue(phone.fieldId, "+15550100199");
    assert.equal(await page.locator("#phone").inputValue(), "+1 555-010-0199");
    assert.equal(await browser.verifyValue(phone.fieldId, "+15550100199"), true);
    assert.equal(await browser.verifyValue(phone.fieldId, "+15550100198"), false);
    await assert.rejects(browser.fillValue(city.fieldId, "Tempe"), /READBACK_MISMATCH/u);
  });
});

test("an unchanged React Select menu is read once; a selection or form change re-reads it and a changed list is drift", browserOptions, async () => {
  await fixture(`<form id="form"><label for="choice">Choose one</label><div class="select-shell"><div class="select__control">
    <span class="select__single-value"></span><input id="choice" role="combobox" aria-haspopup="true" aria-controls="react-select-choice-listbox" aria-expanded="false" aria-required="true">
    </div><div id="react-select-choice-listbox" role="listbox" hidden></div></div></form>
    <script>let selected=null;globalThis.opens=0;globalThis.labels=['Yes','No'];const input=document.getElementById('choice'), menu=document.getElementById('react-select-choice-listbox'),display=document.querySelector('.select__single-value');
      function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');}
      input.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='ArrowDown'){e.preventDefault();globalThis.opens+=1;menu.replaceChildren();globalThis.labels.forEach((label,i)=>{const option=document.createElement('div');option.id='react-select-choice-option-'+i;option.role='option';option.className=selected===i?'select__option select__option--is-selected':'select__option';option.textContent=label;option.onclick=()=>{selected=i;display.textContent=label;input.value='';close();};menu.append(option);});menu.hidden=false;input.setAttribute('aria-expanded','true');}});
    </script>`, async (page, url) => {
    const opens = () => page.evaluate(() => (globalThis as typeof globalThis & { opens: number }).opens);
    const browser = createAgentBrowserTools(page, url, { allowReactSelectDisplay: true });
    const field = (await browser.inspect()).fields[0];
    assert.equal(field.kind, "SINGLE_SELECT");
    await browser.inspect(); await browser.inspect();
    assert.equal(await opens(), 1);
    // A selection reads the live menu before and after the click; the new
    // state is then reused.
    await browser.fillValue(field.fieldId, "Yes");
    assert.equal(await browser.verifyValue(field.fieldId, "Yes"), true);
    const settled = await opens();
    await browser.inspect(); await browser.inspect();
    assert.equal(await opens(), settled);
    // A display the page changes on its own is re-read, never assumed.
    await page.evaluate(() => { document.querySelector(".select__single-value")!.textContent = "No"; });
    await browser.inspect();
    assert.equal(await opens(), settled + 1);
    await page.evaluate(() => { document.querySelector(".select__single-value")!.textContent = "Yes"; });
    await browser.inspect();
    const beforeStructure = await opens();
    // A new control changes the form's structure, so every menu is re-read.
    await page.evaluate(() => { const extra = document.createElement("input"); extra.id = "extra"; extra.setAttribute("aria-label", "Extra"); document.getElementById("form")!.append(extra); });
    await browser.inspect();
    assert.equal(await opens(), beforeStructure + 1);
    // Options that change behind an unchanged display are caught before any click.
    const cached = (await browser.inspect()).fields.find((item) => item.kind === "SINGLE_SELECT")!;
    await page.evaluate(() => { (globalThis as typeof globalThis & { labels: string[] }).labels = ["Yes", "No", "Maybe"]; });
    await assert.rejects(browser.fillValue(cached.fieldId, "No"), /FIELD_DRIFT/u);
    assert.equal(await page.locator(".select__single-value").textContent(), "Yes");
  });
});

test("Greenhouse React Select mode verifies selected option class and display together, never search text", browserOptions, async () => {
  await fixture(`<form><label for="choice">Choose one</label><div class="select-shell"><div class="select__control">
    <span class="select__single-value"></span><input id="choice" role="combobox" aria-haspopup="true" aria-controls="react-select-choice-listbox" aria-expanded="false" aria-required="true">
    </div><div id="react-select-choice-listbox" role="listbox" hidden></div></div></form>
    <script>let selected=null;globalThis.tamper=false;const input=document.getElementById('choice'), menu=document.getElementById('react-select-choice-listbox'),display=document.querySelector('.select__single-value');
      function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');}
      input.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='ArrowDown'){e.preventDefault();menu.replaceChildren();['Yes','No'].forEach((label,i)=>{const option=document.createElement('div');option.id='react-select-choice-option-'+i;option.role='option';option.className=selected===i?'select__option select__option--is-selected':'select__option';option.textContent=label;option.onclick=()=>{if(!globalThis.tamper)selected=i;display.textContent=label;input.value='';close();};menu.append(option);});menu.hidden=false;input.setAttribute('aria-expanded','true');}});
    </script>`, async (page, url) => {
    assert.equal((await createAgentBrowserTools(page, url).inspect()).fields[0].kind, "UNSUPPORTED");
    const browser = createAgentBrowserTools(page, url, { allowReactSelectDisplay: true });
    const field = (await browser.inspect()).fields[0];
    assert.equal(field.kind, "SINGLE_SELECT");
    await browser.fillValue(field.fieldId, "Yes");
    assert.equal(await browser.verifyValue(field.fieldId, "Yes"), true);
    assert.equal(await page.locator('#choice').inputValue(), "");
    await page.evaluate(() => { (globalThis as typeof globalThis & { tamper: boolean }).tamper = true; });
    await assert.rejects(browser.fillValue(field.fieldId, "No"), /READBACK_MISMATCH/u);
  });
});

// React Select omits aria-selected on Apple platforms only; hosted browsers run
// Linux, where every option carries aria-selected="false".
for (const platform of ["apple", "linux"] as const) test(`Greenhouse React Select multi-select (${platform}) chooses by label, survives re-numbered options, and reads back the chips`, browserOptions, async () => {
  const id = "question_69070645[]";
  await fixture(`<form><label for="${id}">What were your undergrad GPAs?</label><div class="select-shell"><div class="select__control">
    <div class="select__value-container select__value-container--is-multi"></div>
    <input id="${id}" role="combobox" aria-haspopup="true" aria-controls="react-select-${id}-listbox" aria-expanded="false" aria-required="true">
    </div><div id="react-select-${id}-listbox" role="listbox" aria-multiselectable="true" hidden></div></div></form>
    <script>const all=['3.8 - 4.0','3.6 - 3.79','3.4 - 3.59','3.2 - 3.39','3.0 - 3.19','< 3.0'];let chosen=[];globalThis.tamper=false;
      const input=document.getElementById(${JSON.stringify(id)}), menu=document.getElementById(${JSON.stringify(`react-select-${id}-listbox`)}), chips=document.querySelector('.select__value-container');
      function render(){chips.replaceChildren(...chosen.map(label=>{const chip=document.createElement('div');chip.className='select__multi-value';const text=document.createElement('div');text.className='select__multi-value__label';text.textContent=label;chip.append(text);return chip;}));}
      function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');}
      input.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='ArrowDown'){e.preventDefault();
        // Like React Select: chosen options leave the menu and the rest are re-numbered.
        menu.replaceChildren(...all.filter(label=>!chosen.includes(label)).map((label,i)=>{const option=document.createElement('div');option.id=${JSON.stringify(`react-select-${id}-option-`)}+i;option.setAttribute('role','option');option.className='select__option';option.textContent=label;if(${JSON.stringify(platform === "linux")})option.setAttribute('aria-selected','false');
          option.addEventListener('click',()=>{chosen.push(globalThis.tamper?'3.8 - 4.0':label);render();close();});return option;}));
        menu.hidden=false;input.setAttribute('aria-expanded','true');}});
    </script>`, async (page, url) => {
    assert.equal((await createAgentBrowserTools(page, url).inspect()).fields[0].kind, "UNSUPPORTED");
    const browser = createAgentBrowserTools(page, url, { allowReactSelectDisplay: true });
    const field = (await browser.inspect()).fields[0];
    assert.equal(field.kind, "MULTI_SELECT");
    assert.equal(field.required, true);
    assert.equal(field.hasValue, false);
    assert.deepEqual(field.options.map((option) => option.value).sort(), ["3.8 - 4.0", "3.6 - 3.79", "3.4 - 3.59", "3.2 - 3.39", "3.0 - 3.19", "< 3.0"].sort());
    await browser.fillValue(field.fieldId, ["3.4 - 3.59"]);
    assert.equal(await browser.verifyValue(field.fieldId, ["3.4 - 3.59"]), true);
    const after = (await browser.inspect()).fields[0];
    assert.equal(after.fingerprint, field.fingerprint, "choosing an option must not change the field's identity");
    assert.equal(after.hasValue, true);
    // A page that records a different choice than the one clicked fails the readback.
    await page.evaluate(() => { (globalThis as typeof globalThis & { tamper: boolean }).tamper = true; });
    await assert.rejects(browser.fillValue(field.fieldId, ["3.4 - 3.59", "3.2 - 3.39"]), /READBACK_MISMATCH/u);
  });
});
