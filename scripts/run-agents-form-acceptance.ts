/**
 * Live managed-harness acceptance against a local synthetic form only.
 * Never reads candidate records, employer URLs, or Browserbase credentials.
 * Run only intentionally; this spends model tokens and creates temporary API sessions.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";

import PDFDocument from "pdfkit";
import { chromium } from "playwright-core";

import type { AgentQuestionAnswer, AgentQuestionDescriptor, ApplicationAgentQuestionRepository } from "../src/domain/application-agent-questions.ts";
import { createApplicationAgentEvidence } from "../src/server/workers/application-agent-evidence.ts";
import type { ApplicationFillExecutionPackage } from "../src/server/workers/application-fill-materializer.ts";
import { createAgentsFormDriver, type AgentFormHarness } from "../src/server/workers/agents-form-driver.ts";
import { createManagedApplicationFormHarness } from "../src/server/workers/application-form-driver.ts";
import type { ApplicationAgentStore } from "../src/server/workers/application-agent-store.ts";
import {
  createOpenAIAgentsClient, type OpenAIAgentActionLedger,
  type OpenAIAgentCallKey, type OpenAIAgentToolResult,
} from "../src/server/workers/openai-agents-client.ts";

if (process.env.RUN_AGENTS_FORM_ACCEPTANCE !== "true") throw new Error("AGENTS_FORM_ACCEPTANCE_EXPLICIT_GATE_REQUIRED");
const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.ROLEDAWN_APPLICATION_AGENT_MODEL?.trim() || "gpt-6-astra";
if (!apiKey) throw new Error("AGENTS_FORM_ACCEPTANCE_API_KEY_REQUIRED");
const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"]
  .find((path): path is string => Boolean(path && existsSync(path)));
if (!chrome) throw new Error("AGENTS_FORM_ACCEPTANCE_LOCAL_CHROME_REQUIRED");

const narrative = "Built a scheduling portal that lets clinicians review available visits and request assignments.";
const binding = Object.freeze({ workspaceId: randomUUID(), candidateId: randomUUID(), applicationId: randomUUID(), revisionId: randomUUID(), fillAttemptId: randomUUID(), computerSessionId: randomUUID() });

async function createSyntheticPdf(): Promise<Uint8Array> {
  const document = new PDFDocument({ size: "LETTER", margin: 50, info: { Title: "Synthetic acceptance resume" } });
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    document.on("error", reject);
  });
  document.fontSize(16).text("Alex Fixture").moveDown();
  document.fontSize(11).text("alex@synthetic.example").moveDown().text(narrative);
  document.end();
  return finished;
}

/** Explicit synthetic-only ledger. Production uses the database ledger. */
function syntheticLedger(onAction: () => void): OpenAIAgentActionLedger {
  const rows = new Map<string, { key: OpenAIAgentCallKey; result?: OpenAIAgentToolResult }>();
  const id = (key: OpenAIAgentCallKey) => `${key.sessionId}:${key.turnId}:${key.callId}`;
  return {
    async begin(key) {
      const prior = rows.get(id(key));
      if (!prior) { rows.set(id(key), { key }); return { status: "new" }; }
      assert.deepEqual(prior.key, key);
      return prior.result ? { status: "completed", result: prior.result } : { status: "uncertain" };
    },
    async complete(key, result) {
      const prior = rows.get(id(key));
      assert.ok(prior);
      assert.deepEqual(prior.key, key);
      if (!prior.result) onAction();
      prior.result = result;
    },
  };
}

let pendingQuestions: readonly AgentQuestionDescriptor[] = [];
const syntheticAnswers: AgentQuestionAnswer[] = [];
const questions: ApplicationAgentQuestionRepository = {
  async requestQuestions(input) {
    assert.deepEqual(input.binding, binding);
    pendingQuestions = input.questions;
    return input.questions.map((question) => ({ ...question, id: `synthetic-${question.fingerprint}`, status: "OPEN" }));
  },
  async loadAnswers(input) {
    assert.deepEqual(input.binding, binding);
    return syntheticAnswers.filter((answer) => input.questions.some((question) => question.fieldId === answer.fieldId && question.fingerprint === answer.fingerprint));
  },
};

let outboundSubmissionRequests = 0;
const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/synthetic-application") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body><h1>Synthetic application acceptance</h1>
      <p>This is a local synthetic test. No employer application is being made.</p>
      <form action="/submit" method="post">
        <label>How should our team address you?<input name="applicant" autocomplete="name" required></label>
        <label>Where should recruiting send updates?<input name="updates" type="email" required></label>
        <div class="field">
          <label for="country">Country of residence</label>
          <input id="country" role="combobox" aria-haspopup="listbox" aria-controls="country-listbox" aria-expanded="false" aria-required="true" autocomplete="off">
          <span id="country-display"></span><input name="country-value" type="hidden">
          <div id="country-listbox" role="listbox" hidden></div>
        </div>
        <label>Attach a resume for this role<input name="document" type="file" accept="application/pdf" required></label>
        <label>Describe relevant experience<textarea name="experience" required></textarea></label>
        <label>Do you consent to background screening?<input name="screening_consent" type="checkbox" required></label>
        <label>Candidate note<textarea name="note">Keep this candidate-written note.</textarea></label>
        <button type="submit">Submit application</button>
      </form>
      <script>
        const country = document.getElementById("country");
        const countryMenu = document.getElementById("country-listbox");
        const countryDisplay = document.getElementById("country-display");
        const countryValue = document.querySelector('[name="country-value"]');
        const countryChoices = [
          { id: "country-option-us", value: "US", label: "United States" },
          { id: "country-option-ca", value: "CA", label: "Canada" }
        ];
        let selectedCountry = null;
        function closeCountry() {
          countryMenu.hidden = true;
          country.setAttribute("aria-expanded", "false");
        }
        function openCountry() {
          countryMenu.replaceChildren();
          for (const choice of countryChoices) {
            const option = document.createElement("div");
            option.id = choice.id;
            option.setAttribute("role", "option");
            option.setAttribute("data-value", choice.value);
            option.setAttribute("aria-selected", String(selectedCountry === choice.value));
            option.textContent = choice.label;
            option.addEventListener("click", () => {
              selectedCountry = choice.value;
              countryValue.value = choice.value;
              countryDisplay.textContent = choice.label;
              countryDisplay.dataset.selectedOptionId = choice.id;
              country.value = "";
              closeCountry();
            });
            countryMenu.append(option);
          }
          countryMenu.hidden = false;
          country.setAttribute("aria-expanded", "true");
        }
        country.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); openCountry(); }
          if (event.key === "Escape") { event.preventDefault(); closeCountry(); }
        });
      </script></body></html>`);
  } else { outboundSubmissionRequests += 1; response.writeHead(409).end(); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("AGENTS_FORM_ACCEPTANCE_ADDRESS_INVALID");
const url = `http://127.0.0.1:${address.port}/synthetic-application`;
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
const client = createOpenAIAgentsClient({ apiKey });
const sessionIds = new Set<string>();
let deletedSessionCount = 0;
let initialLoad = true;
let totalActions = 0;
let pass = 0;
let accepted = false;
const deletedSessions = new Set<string>();
const syntheticRuns = new Map<string, { ledger: OpenAIAgentActionLedger; sessionId?: string; status?: string; providerDeleted?: boolean }>();
/** Explicit test store. No Supabase candidate/application writes occur. */
const store: ApplicationAgentStore = {
  async expireRuns() { return 0; },
  async startRun(actualBinding, actualModel) {
    assert.deepEqual(actualBinding, binding);
    assert.equal(actualModel, model);
    const runId = randomUUID();
    syntheticRuns.set(runId, { ledger: syntheticLedger(() => {
      totalActions += 1;
      if (totalActions % 5 === 0) process.stdout.write(`${JSON.stringify({ event: "synthetic-agent-progress", pass, toolActions: totalActions })}\n`);
    }) });
    return runId;
  },
  async bindSession(runId, sessionId) {
    const run = syntheticRuns.get(runId);
    assert.ok(run);
    run.sessionId = sessionId;
    sessionIds.add(sessionId);
    process.stdout.write(`${JSON.stringify({ event: "synthetic-agent-session-created", pass })}\n`);
  },
  ledger(runId) {
    const run = syntheticRuns.get(runId);
    assert.ok(run);
    return run.ledger;
  },
  async finishRun(runId, status, failureCode, providerDeleted) {
    const run = syntheticRuns.get(runId);
    assert.ok(run);
    run.status = status;
    run.providerDeleted = providerDeleted;
    if (status === "COMPLETED") assert.equal(failureCode, null);
    if (providerDeleted && run.sessionId) { deletedSessions.add(run.sessionId); deletedSessionCount += 1; }
  },
};

try {
  await page.route("**/*", async (route) => {
    if (initialLoad && route.request().url() === url && route.request().method() === "GET") await route.continue();
    else await route.abort("blockedbyclient");
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  initialLoad = false;
  const bytes = await createSyntheticPdf();
  const executionPackage: ApplicationFillExecutionPackage = {
    schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", binding, destinationUrl: url, submitAuthorized: false,
    facts: [
      { factVersionId: randomUUID(), factKey: "identity.legal_name", value: "Alex Fixture", valueHash: createHash("sha256").update(JSON.stringify("Alex Fixture")).digest("hex") },
      { factVersionId: randomUUID(), factKey: "contact.application_email", value: "alex@synthetic.example", valueHash: createHash("sha256").update(JSON.stringify("alex@synthetic.example")).digest("hex") },
      { factVersionId: randomUUID(), factKey: "location.country_code", value: "US", valueHash: createHash("sha256").update(JSON.stringify("US")).digest("hex") },
    ],
    artifacts: [{ artifactVersionId: randomUUID(), variant: "RESUME_PDF", filename: "resume.pdf", mediaType: "application/pdf", byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), bytes }],
  };
  const managedHarness = createManagedApplicationFormHarness({ driver: "agents", apiKey, model, timeoutMs: 180_000, maxActions: 40 }, client, store);
  const harness: AgentFormHarness = { async run(input) {
    pass += 1;
    // New managed reasoning session per driver call; the guarded browser and
    // exact application binding remain the same during candidate continuation.
    await managedHarness.run({
      ...input,
      instructions: `${input.instructions}\nThis is a synthetic acceptance form. For narrative evidence, use the shortest directly relevant supported passage without adding claims. Fill known fields before requesting the missing candidate consent. End the turn after completing all possible fills and requesting questions, or after complete_review reports complete.`,
    });
  } };
  const driver = createAgentsFormDriver({
    harness, questions, resolvePage: () => page, recordUpload: () => undefined, maxActions: 40,
    evidence: createApplicationAgentEvidence({
      // This independent exact synthetic validator keeps the acceptance from
      // silently adding another live model route. Production uses entailment.
      verify: async (text) => text.normalize("NFKC").replace(/\s+/gu, " ").trim() === narrative,
    }),
  });
  const input = { runtimeHandle: {}, binding, startUrl: url, executionPackage, submitAuthorized: false as const };
  const first = await driver.fillToPreSubmitReview(input);
  assert.equal(first.kind, "TAKEOVER", `AGENTS_FORM_ACCEPTANCE_FIRST_OUTCOME_${first.kind}_${"reasonCode" in first ? first.reasonCode : ""}`);
  assert.equal(first.filledFieldCount, 4, "AGENTS_FORM_ACCEPTANCE_KNOWN_FIELDS_NOT_FILLED");
  assert.equal(first.uploadedArtifactCount, 1, "AGENTS_FORM_ACCEPTANCE_FILE_NOT_SELECTED");
  assert.equal(await page.locator('[name="applicant"]').inputValue(), "Alex Fixture");
  assert.equal(await page.locator('[name="updates"]').inputValue(), "alex@synthetic.example");
  assert.equal(await page.locator('[name="experience"]').inputValue(), narrative);
  assert.equal(await page.locator('[name="country-value"]').inputValue(), "US");
  assert.equal(await page.locator("#country-display").getAttribute("data-selected-option-id"), "country-option-us");
  assert.equal(await page.locator("#country").inputValue(), "", "AGENTS_FORM_ACCEPTANCE_SEARCH_TEXT_IS_NOT_SELECTION");
  assert.equal(await page.locator('[name="note"]').inputValue(), "Keep this candidate-written note.");
  assert.equal(pendingQuestions.length, 1);
  const consent = pendingQuestions[0];
  assert.equal(consent.kind, "BOOLEAN");
  assert.equal(consent.reasonCode, "SENSITIVE_REQUIRES_CANDIDATE");
  syntheticAnswers.push({ answerId: randomUUID(), fieldId: consent.fieldId, fingerprint: consent.fingerprint, value: true });
  const second = await driver.fillToPreSubmitReview(input);
  assert.equal(second.kind, "FILLED_TO_REVIEW", `AGENTS_FORM_ACCEPTANCE_RESUME_OUTCOME_${second.kind}_${"reasonCode" in second ? second.reasonCode : ""}`);
  assert.equal(await page.locator('[name="screening_consent"]').isChecked(), true);
  assert.equal(await page.locator('[name="country-value"]').inputValue(), "US");
  assert.equal(await page.locator("#country-display").getAttribute("data-selected-option-id"), "country-option-us");
  assert.equal(await page.locator("#country").inputValue(), "");
  assert.equal(await page.locator('[name="note"]').inputValue(), "Keep this candidate-written note.");
  await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  assert.equal(outboundSubmissionRequests, 0);
  assert.equal(sessionIds.size, 2);
  accepted = true;
} finally {
  const failures: unknown[] = [];
  for (const sessionId of sessionIds) {
    if (deletedSessions.has(sessionId)) continue;
    try { await client.deleteSession(sessionId, AbortSignal.timeout(10_000)); deletedSessionCount += 1; }
    catch { failures.push(new Error("AGENTS_FORM_ACCEPTANCE_SESSION_CLEANUP_FAILED")); }
  }
  await browser.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (failures.length) throw new AggregateError(failures, "AGENTS_FORM_ACCEPTANCE_CLEANUP_INCOMPLETE");
}
assert.equal(accepted, true);
assert.equal(deletedSessionCount, 2);
assert.equal([...syntheticRuns.values()].every((run) => run.status === "COMPLETED" && run.providerDeleted === true), true);
process.stdout.write(`${JSON.stringify({ acceptance: "agents-form-synthetic/1", status: "PASSED", passes: pass, managedSessionsCreated: sessionIds.size, managedSessionsDeleted: deletedSessionCount, toolActions: totalActions, knownFieldsFilledBeforeQuestion: true, dropdownSelectionVerified: true, prefilledValuePreserved: true, candidateAnswerContinuedSameBrowser: true, outboundSubmissionRequests, employerApplicationSubmitted: false })}\n`);
