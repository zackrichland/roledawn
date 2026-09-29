/** Real Agents API + local synthetic HTTP forms only. No employer or hosted candidate writes. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { chromium } from "playwright-core";
import type { AgentQuestionAnswer, AgentQuestionDescriptor, ApplicationAgentQuestionRepository } from "../src/domain/application-agent-questions.ts";
import { createApplicationDeliveryDriver } from "../src/server/workers/application-delivery-driver.ts";
import { createApplicationDeliveryHarness, type ApplicationDeliveryAgentStore } from "../src/server/workers/application-delivery-harness.ts";
import type { ApplicationFillExecutionPackage } from "../src/server/workers/application-fill-materializer.ts";
import { createOpenAIAgentsClient, type OpenAIAgentCallKey, type OpenAIAgentToolResult } from "../src/server/workers/openai-agents-client.ts";
import { startSyntheticAtsDelivery } from "../src/test-support/synthetic-ats-delivery.ts";

if (process.env.RUN_APPLICATION_DELIVERY_ACCEPTANCE !== "true") throw new Error("DELIVERY_ACCEPTANCE_EXPLICIT_GATE_REQUIRED");
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("DELIVERY_ACCEPTANCE_KEY_REQUIRED");
const chrome = [process.env.ROLEDAWN_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((path): path is string => Boolean(path && existsSync(path)));
if (!chrome) throw new Error("DELIVERY_ACCEPTANCE_CHROME_REQUIRED");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const site = await startSyntheticAtsDelivery();
const binding = { workspaceId: randomUUID(), candidateId: randomUUID(), applicationId: randomUUID(), revisionId: randomUUID(), fillAttemptId: randomUUID(), computerSessionId: randomUUID() };
const lease = { id: binding.fillAttemptId, leaseToken: randomUUID() };
const document = new PDFDocument({ margin: 50 });
const chunks: Buffer[] = [];
const rendered = new Promise<Uint8Array>((resolve, reject) => { document.on("data", (chunk: Buffer) => chunks.push(chunk)); document.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks)))); document.on("error", reject); });
document.text("Synthetic cover letter for local acceptance only."); document.addPage().text("Synthetic resume: Alex Fixture."); document.end();
const bytes = await rendered;
const execution: ApplicationFillExecutionPackage = { schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", submitAuthorized: false, binding, destinationUrl: site.policy.startUrl,
  facts: [{ factVersionId: randomUUID(), factKey: "identity.legal_name", value: "Alex Fixture", valueHash: hash(JSON.stringify("Alex Fixture")) }],
  artifacts: [{ artifactVersionId: randomUUID(), variant: "APPLICATION_PDF", filename: "Alex-Fixture-Application.pdf", mediaType: "application/pdf", byteSize: bytes.length, sha256: hash(bytes), bytes }],
};
const client = createOpenAIAgentsClient({ apiKey });
const sessions = new Set<string>();
const deleted = new Set<string>();
const activeSessions: string[] = [];
const calls = new Map<string, { key: OpenAIAgentCallKey; result?: OpenAIAgentToolResult }>();
let totalActions = 0;
let pass = 1;
const store: ApplicationDeliveryAgentStore = {
  async assertLease(value) { assert.deepEqual(value, lease); },
  async setAgentSession(_lease, sessionId) {
    if (sessionId) { sessions.add(sessionId); activeSessions.push(sessionId); }
    else { const current = activeSessions.pop(); assert.ok(current); deleted.add(current); }
  },
  ledger() { return {
    async begin(key) { const id = `${key.sessionId}:${key.turnId}:${key.callId}`; const prior = calls.get(id); if (prior) { assert.deepEqual(prior.key, key); return prior.result ? { status: "completed", result: prior.result } : { status: "uncertain" }; } calls.set(id, { key }); return { status: "new" }; },
    async complete(key, result) { const prior = calls.get(`${key.sessionId}:${key.turnId}:${key.callId}`); assert.ok(prior); prior.result = result; totalActions += 1; process.stdout.write(`${JSON.stringify({ event: "synthetic-delivery-tool", pass, tool: key.name, totalActions })}\n`); },
  }; },
};
let pendingQuestions: readonly AgentQuestionDescriptor[] = [];
const answers: AgentQuestionAnswer[] = [];
const questions: ApplicationAgentQuestionRepository = {
  async requestQuestions(input) { assert.deepEqual(input.binding, binding); pendingQuestions = input.questions; return input.questions.map(question => ({ ...question, id: randomUUID(), status: "OPEN" })); },
  async loadAnswers(input) { assert.deepEqual(input.binding, binding); return answers.filter(answer => input.questions.some(question => question.fieldId === answer.fieldId && question.fingerprint === answer.fingerprint)); },
};
let begins = 0;
let accepted = false;
try {
  for (pass = 1; pass <= 2; pass += 1) {
    // A wholly new browser proves answers survive beyond a retained session.
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage({ serviceWorkers: "block" });
      const signal = AbortSignal.timeout(240_000);
      const driver = createApplicationDeliveryDriver({
        resolvePage: () => page, sitePolicy: site.policy, questions,
        harness: createApplicationDeliveryHarness({ configuration: { driver: "agents", apiKey, model: process.env.ROLEDAWN_APPLICATION_AGENT_MODEL || "gpt-6-astra", timeoutMs: 180_000, maxActions: 50 }, client, store, lease, signal }),
        assertLease: () => store.assertLease(lease),
        submissionHooks: { async begin(input) { assert.equal(begins, 0); assert.match(input.reviewHash, /^[a-f0-9]{64}$/u); assert.match(input.requestFingerprint, /^[a-f0-9]{64}$/u); begins += 1; return { attemptId: randomUUID(), idempotencyKey: `synthetic-${randomUUID()}` }; } },
      });
      const result = await driver.deliver({ binding, runtimeHandle: page, startUrl: site.policy.startUrl, executionPackage: execution, signal });
      process.stdout.write(`${JSON.stringify({ event: "synthetic-delivery-pass", pass, kind: result.kind, reasonCode: "reasonCode" in result ? result.reasonCode : null, completedSteps: result.completedStepCount })}\n`);
      if (pass === 1) {
        assert.equal(result.kind, "QUESTIONS_REQUIRED"); assert.equal(site.requests.submits, 0); assert.equal(pendingQuestions.length, 1);
        const question = pendingQuestions[0]!; assert.equal(question.kind, "BOOLEAN");
        // This explicit fixture answer belongs to a fictitious applicant and local endpoint only.
        answers.push({ answerId: randomUUID(), fieldId: question.fieldId, fingerprint: question.fingerprint, value: true });
      } else {
        assert.equal(result.kind, "CONFIRMED");
        if (result.kind === "CONFIRMED") { assert.equal(result.receipt.receiptId, "receipt-123"); assert.match(result.receipt.bodyHash, /^[a-f0-9]{64}$/u); }
      }
    } finally { await browser.close(); }
  }
  assert.equal(begins, 1); assert.equal(site.requests.submits, 1); assert.equal(site.requests.uploads.length, 2); assert.equal(site.requests.next, 2); assert.equal(site.requests.leaks, 0);
  for (const uploaded of site.requests.uploads) assert.equal(hash(uploaded), execution.artifacts[0]!.sha256);
  assert.equal(deleted.size, sessions.size);
  accepted = true;
  process.stdout.write(`${JSON.stringify({ accepted, syntheticOnly: true, toolActions: totalActions, modelSessions: sessions.size, modelSessionDeletionAcknowledgements: deleted.size, freshBrowserPasses: 2, verifiedUploads: site.requests.uploads.length, localSubmissionRequests: site.requests.submits, employerSubmissionRequests: 0 })}\n`);
} finally {
  for (const sessionId of sessions) if (!deleted.has(sessionId)) { try { await client.deleteSession(sessionId, AbortSignal.timeout(10_000)); deleted.add(sessionId); } catch {} }
  bytes.fill(0); await site.close();
  if (!accepted) process.stdout.write(`${JSON.stringify({ accepted: false, modelSessions: sessions.size, deleted: deleted.size })}\n`);
}
