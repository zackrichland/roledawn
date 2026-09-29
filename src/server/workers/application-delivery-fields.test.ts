import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";

import { chromium, type Page } from "playwright-core";

import type { AgentQuestionAnswer, AgentQuestionDescriptor, ApplicationAgentQuestionRepository } from "../../domain/application-agent-questions.ts";
import { startSyntheticAtsDelivery, SYNTHETIC_TRAP_FIELDS, type SyntheticDeliveryMode } from "../../test-support/synthetic-ats-delivery.ts";
import { createAgentBrowserTools, type AgentBrowserField } from "./agents-browser-tools.ts";
import type { AgentFormHarness } from "./agents-form-driver.ts";
import type { DeliverySitePolicy, DeliverySubmissionHooks } from "./application-delivery-browser.ts";
import { createApplicationDeliveryDriver } from "./application-delivery-driver.ts";
import type { ApplicationFillExecutionPackage, MaterializedApplicationFact } from "./application-fill-materializer.ts";

const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"]
  .find((value): value is string => Boolean(value && existsSync(value)));
const browserOptions = { skip: chrome ? false : "No local Chromium installed" };
const binding = { workspaceId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: "30000000-0000-4000-8000-000000000001", revisionId: "40000000-0000-4000-8000-000000000001", fillAttemptId: "50000000-0000-4000-8000-000000000001", computerSessionId: "60000000-0000-4000-8000-000000000001" };
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const bytes = Buffer.from("%PDF-1.7 synthetic authorized resume bytes");
const FACTS: readonly MaterializedApplicationFact[] = Object.freeze(([
  ["identity.legal_name", "Alex Fixture"], ["identity.given_name", "Alex"], ["identity.family_name", "Fixture"],
  ["contact.application_email", "alex@example.test"], ["contact.phone", "+12025550123"], ["contact.website_url", "https://alex.example.test"],
  ["location.city", "Washington"], ["location.region", "DC"], ["location.country_code", "US"],
] as const).map(([factKey, value]) => ({ factVersionId: `${factKey}-v1`, factKey, value, valueHash: digest(JSON.stringify(value)) })));

function packet(url: string, facts: readonly MaterializedApplicationFact[] = FACTS): ApplicationFillExecutionPackage {
  return { schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", submitAuthorized: false, binding, destinationUrl: url, facts,
    artifacts: [{ artifactVersionId: "resume-1", variant: "RESUME_PDF", filename: "Alex-Fixture-Synthetic-Resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: digest(bytes) }] };
}

type Observed = { begins: number; firstStep: Record<string, string> | null; writes: Record<string, unknown>[] };
async function deliver(mode: SyntheticDeliveryMode, harness: AgentFormHarness, facts: readonly MaterializedApplicationFact[] = FACTS) {
  const { policy, requests, close } = await startSyntheticAtsDelivery(mode);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const observed: Observed = { begins: 0, firstStep: null, writes: [] };
  try {
    const page: Page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
    // The candidate's saved answer covers only the step-two legal consent.
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ questions: fields }) { return fields.filter((field) => field.kind === "BOOLEAN").map((field) => ({ answerId: "consent", fieldId: field.fieldId, fingerprint: field.fingerprint, value: true })); },
      async requestQuestions({ questions: fields }) { return fields.map((field) => ({ ...field, id: "question", status: "OPEN" as const })); },
    };
    const submissionHooks: DeliverySubmissionHooks = {
      async begin() { observed.begins += 1; return { attemptId: "attempt-1", idempotencyKey: "once-1" }; },
      async checkpoint(state) {
        if (state.phase !== "STEP_REVIEWED" || state.stepId !== "first") return;
        observed.firstStep = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=file]), select")].map((element) => [element.name, element.value])));
        observed.writes.push(...state.writes as Record<string, unknown>[]);
      },
    };
    const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy as DeliverySitePolicy, submissionHooks, browserTimeoutMs: 600 });
    const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl, facts) });
    return { result, requests, observed };
  } finally { await browser.close(); await close(); }
}

test("deterministic delivery fills anchored contact fields and leaves referral, emergency, salary and employer look-alikes empty", browserOptions, async () => {
  let modelCalls = 0;
  const { result, requests, observed } = await deliver("traps", { async run() { modelCalls += 1; } });
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.ok(modelCalls >= 1, "optional unresolved look-alikes still reach the model turn");
  assert.equal(requests.submits, 1);
  const values = observed.firstStep!;
  assert.equal(values.name, "Alex Fixture");
  assert.equal(values.email, "alex@example.test");
  assert.equal(values.phone, "+12025550123");
  assert.equal(values.state, "DC");
  for (const [name] of SYNTHETIC_TRAP_FIELDS) assert.equal(values[name], "", name);
  assert.equal(values.note, "Keep my note");
});

test("model-proposed candidate facts are refused for look-alike third-party, employer, salary and name-variant questions", browserOptions, async () => {
  // A naive keyword mapper: each trap receives the fact its keyword suggests.
  const naive: Readonly<Record<string, string>> = {
    referral_email: "contact.application_email", referred_by: "contact.application_email", referrer_name: "identity.legal_name",
    emergency_phone: "contact.phone", salary: "location.region", company_website: "contact.website_url", org: "identity.legal_name",
    manager_name: "identity.legal_name", preferred_first_name: "identity.given_name", school_state: "location.region", citizenship: "location.country_code",
  };
  const refusals: Record<string, string> = {};
  const harness: AgentFormHarness = { async run(input) {
    const form = input.input.form as { fields: AgentBrowserField[] };
    for (const field of form.fields) {
      const factKey = naive[field.name];
      if (!factKey || field.hasValue) continue;
      const result = await input.executeTool("fill_fact", { fieldId: field.fieldId, factVersionId: `${factKey}-v1` }) as { ok: boolean; errorCode?: string };
      assert.equal(result.ok, false, field.name);
      refusals[field.name] = result.errorCode!;
    }
  } };
  const { result, requests, observed } = await deliver("traps", harness);
  assert.equal(result.kind, "CONFIRMED", JSON.stringify(result));
  assert.equal(requests.submits, 1);
  assert.deepEqual(Object.keys(refusals).sort(), Object.keys(naive).sort());
  for (const [name, code] of Object.entries(refusals)) assert.match(code, /CANDIDATE_ANSWER_REQUIRED|FACT_TYPE_MISMATCH|FACT_FIELD_MISMATCH/u, name);
  for (const name of Object.keys(naive)) assert.equal(observed.firstStep![name], "", name);
});

type Run = Readonly<{ harness?: AgentFormHarness; facts?: readonly MaterializedApplicationFact[]; answers?: readonly AgentQuestionAnswer[] }>;
/** One synthetic employer server; each run is a fresh page rebuilt from page one. */
async function withDelivery(mode: SyntheticDeliveryMode, body: (deliverRun: (run: Run) => Promise<Readonly<{
  result: Awaited<ReturnType<ReturnType<typeof createApplicationDeliveryDriver>["deliver"]>>;
  values: Record<string, string>; requested: readonly AgentQuestionDescriptor[]; reviewed: Record<string, string> | null; modelFields: readonly AgentBrowserField[];
}>>, requests: Awaited<ReturnType<typeof startSyntheticAtsDelivery>>["requests"]) => Promise<void>) {
  const { policy, requests, close } = await startSyntheticAtsDelivery(mode);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const readValues = (page: Page) => page.evaluate(() => Object.fromEntries([
    ...[...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=file]), select")].map((element) => [element.name || element.id, element.value]),
    ...[...document.querySelectorAll(".select__single-value")].map((element) => ["location-display", (element.textContent ?? "").trim()]),
  ]));
  try {
    await body(async (run) => {
      const page = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
      let requested: readonly AgentQuestionDescriptor[] = [];
      let reviewed: Record<string, string> | null = null;
      let modelFields: readonly AgentBrowserField[] = [];
      const questions: ApplicationAgentQuestionRepository = {
        async loadAnswers({ questions: fields }) {
          const consent = fields.filter((field) => field.kind === "BOOLEAN").map((field) => ({ answerId: "consent", fieldId: field.fieldId, fingerprint: field.fingerprint, value: true }));
          return [...consent, ...(run.answers ?? []).filter((answer) => fields.some((field) => field.fieldId === answer.fieldId && field.fingerprint === answer.fingerprint))];
        },
        async requestQuestions({ questions: fields }) { requested = fields; return fields.map((field) => ({ ...field, id: "question", status: "OPEN" as const })); },
      };
      const harness: AgentFormHarness = { async run(input) {
        if (!modelFields.length) modelFields = (input.input.form as { fields: AgentBrowserField[] }).fields;
        await run.harness?.run(input);
      } };
      const driver = createApplicationDeliveryDriver({ harness, questions, resolvePage: () => page, sitePolicy: policy, browserTimeoutMs: 1_500,
        submissionHooks: { async begin() { return { attemptId: "attempt-1", idempotencyKey: "once-1" }; },
          async checkpoint(state) { if (state.phase === "STEP_REVIEWED" && state.stepId === "first") reviewed = await readValues(page); } } });
      const result = await driver.deliver({ binding, runtimeHandle: {}, startUrl: policy.startUrl, executionPackage: packet(policy.startUrl, run.facts ?? FACTS) });
      const values = await readValues(page).catch(() => ({}));
      await page.context().close();
      return { result, values, requested, reviewed, modelFields };
    }, requests);
  } finally { await browser.close(); await close(); }
}

test("long native country, region and school lists resolve exact approved values server-side; the model sees a sample", browserOptions, async () => {
  await withDelivery("large-select", async (deliverRun, requests) => {
    const first = await deliverRun({});
    assert.equal(first.result.kind, "QUESTIONS_REQUIRED", JSON.stringify(first.result));
    // Facts resolved by alias against the full lists: "US" and "DC" match opaque option values.
    assert.equal(first.values.country, "c-usa");
    assert.equal(first.values.state, "st-09");
    assert.equal(first.values.school, "");
    for (const name of ["country", "state", "school"]) {
      const field = first.modelFields.find((item) => item.name === name)!;
      assert.equal(field.kind, "SINGLE_SELECT", name);
      assert.equal(field.searchable, true, name);
      assert.ok(field.optionCount > 80, name);
      assert.ok(field.options.length <= 40, `${name} sends only a sample to the model`);
    }
    // The candidate is asked in free text; a question never carries the whole list.
    assert.equal(first.requested.length, 1);
    const school = first.requested[0];
    assert.equal(school.label, "School");
    assert.equal(school.kind, "TEXT");
    assert.deepEqual(school.options, []);
    assert.equal(requests.submits, 0);
    const second = await deliverRun({ answers: [{ answerId: "school-answer", fieldId: school.fieldId, fingerprint: school.fingerprint, value: "synthetic university 042" }] });
    assert.equal(second.result.kind, "CONFIRMED", JSON.stringify(second.result));
    assert.deepEqual([second.reviewed!.country, second.reviewed!.state, second.reviewed!.school], ["c-usa", "st-09", "school-042"]);
    assert.equal(requests.submits, 1);
  });
});

test("an ambiguous long list is never guessed, even from the candidate's own text", browserOptions, async () => {
  await withDelivery("large-select-ambiguous", async (deliverRun, requests) => {
    const first = await deliverRun({});
    assert.equal(first.result.kind, "QUESTIONS_REQUIRED", JSON.stringify(first.result));
    assert.equal(first.values.country, "", "\"United States\" and \"United States of America\" are both present");
    const country = first.requested.find((item) => item.label === "Country")!;
    assert.equal(country.kind, "TEXT");
    const second = await deliverRun({ answers: [{ answerId: "country-answer", fieldId: country.fieldId, fingerprint: country.fingerprint, value: "United States" }] });
    assert.equal(second.result.kind, "TAKEOVER", JSON.stringify(second.result));
    assert.equal(second.result.kind === "TAKEOVER" && second.result.reasonCode, "DELIVERY_ANSWER_NOT_ACCEPTED_BY_FORM");
    assert.equal(second.values.country, "");
    assert.equal(requests.submits, 0);
  });
});

test("type-to-search location selects only a result confirmed by the candidate's region and country", browserOptions, async () => {
  await withDelivery("greenhouse-location", async (deliverRun, requests) => {
    const confirmed = await deliverRun({});
    assert.equal(confirmed.result.kind, "CONFIRMED", JSON.stringify(confirmed.result));
    assert.equal(confirmed.reviewed!["location-display"], "Washington, District of Columbia, United States");
    assert.equal(confirmed.reviewed!["candidate-location"], "");
    assert.ok(requests.searches.includes("Washington"));
    assert.equal(confirmed.modelFields.length, 0, "approved facts completed the step without a model turn");
  });
  await withDelivery("greenhouse-location", async (deliverRun, requests) => {
    // The candidate lives in Washington State; neither DC nor PA may be chosen.
    const facts = FACTS.map((fact) => fact.factKey === "location.region" ? { ...fact, value: "WA", valueHash: digest(JSON.stringify("WA")) } : fact);
    const first = await deliverRun({ facts });
    assert.equal(first.result.kind, "QUESTIONS_REQUIRED", JSON.stringify(first.result));
    assert.equal(first.values["location-display"], "");
    assert.equal(first.values["candidate-location"], "", "typed search text is cleared");
    const question = first.requested.find((item) => item.label === "Location (City)")!;
    assert.equal(question.kind, "TEXT");
    assert.deepEqual(question.options, []);
    // The candidate's own text may pick the unique result that starts with it.
    const second = await deliverRun({ facts, answers: [{ answerId: "location-answer", fieldId: question.fieldId, fingerprint: question.fingerprint, value: "Washington, Pennsylvania" }] });
    assert.equal(second.result.kind, "CONFIRMED", JSON.stringify(second.result));
    assert.equal(second.reviewed!["location-display"], "Washington, Pennsylvania, United States");
    assert.equal(requests.submits, 1);
  });
});

test("search-only comboboxes stay unsupported unless the delivery policy permits their lookups", browserOptions, async () => {
  const { policy, close } = await startSyntheticAtsDelivery("greenhouse-location");
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(policy.startUrl);
    const location = (await createAgentBrowserTools(page, policy.startUrl, { allowReactSelectDisplay: true }).inspect()).fields.find((field) => field.domId === "candidate-location")!;
    assert.equal(location.kind, "UNSUPPORTED");
    const enabled = (await createAgentBrowserTools(page, policy.startUrl, { allowReactSelectDisplay: true, remoteSearch: true }).inspect()).fields.find((field) => field.domId === "candidate-location")!;
    assert.equal(enabled.kind, "SINGLE_SELECT");
    assert.equal(enabled.searchable, true);
  } finally { await browser.close(); await close(); }
});

test("a fully rendered long ARIA listbox is resolved by label; a partially rendered one stays unsupported", browserOptions, async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const regions = [["st-09", "District of Columbia"], ...Array.from({ length: 95 }, (_, index) => [`r-${index}`, `Synthetic Region ${index}`])];
    const html = `<!doctype html><html><body><form><label for="region">State</label>
      <input id="region" role="combobox" aria-haspopup="listbox" aria-controls="region-listbox" aria-expanded="false" aria-required="true" autocomplete="off">
      <input type="hidden" name="region-value"><div id="region-listbox" role="listbox" hidden></div></form>
      <script>const input=document.getElementById('region'),menu=document.getElementById('region-listbox');let selected=null;globalThis.partial=false;
      const items=${JSON.stringify(regions)};
      function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');}
      function render(){menu.replaceChildren(...items.map(([value,label])=>{const option=document.createElement('div');option.id='region-option-'+value;option.setAttribute('role','option');option.dataset.value=value;option.setAttribute('aria-selected',String(selected===value));
        if(globalThis.partial)option.setAttribute('aria-setsize','500');option.textContent=label;option.addEventListener('click',()=>{selected=value;document.querySelector('[name="region-value"]').value=value;close();});return option;}));}
      input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();render();menu.hidden=false;input.setAttribute('aria-expanded','true');}if(event.key==='Escape'){event.preventDefault();close();}});</script></body></html>`;
    await page.route("http://localhost/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
    await page.goto("http://localhost/fixture");
    const tools = createAgentBrowserTools(page, "http://localhost/fixture");
    const field = (await tools.inspect()).fields.find((item) => item.domId === "region")!;
    assert.equal(field.kind, "SINGLE_SELECT");
    assert.equal(field.searchable, true);
    assert.equal(field.optionCount, 96);
    await assert.rejects(tools.fillValue(field.fieldId, "WA", undefined, { semantic: "REGION" }), /OPTION_AMBIGUOUS/u);
    await tools.fillValue(field.fieldId, "DC", undefined, { semantic: "REGION" });
    assert.equal(await page.locator('[name="region-value"]').inputValue(), "st-09");
    await page.evaluate(() => { (globalThis as typeof globalThis & { partial: boolean }).partial = true; });
    const partial = (await createAgentBrowserTools(page, "http://localhost/fixture").inspect()).fields.find((item) => item.domId === "region")!;
    assert.equal(partial.kind, "UNSUPPORTED");
  } finally { await browser.close(); }
});
