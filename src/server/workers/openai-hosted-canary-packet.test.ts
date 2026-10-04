import assert from "node:assert/strict";
import test from "node:test";

import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import { packetFromMaterializedReadback, prepareHostedCanaryPlanFromReadback } from "./openai-hosted-canary-packet.ts";

const bytes = new TextEncoder().encode("%PDF-synthetic");
const execution = (): ApplicationFillExecutionPackage => ({
  schemaRelease: "application-fill-execution-package/1", authorityScope: "FILL_ONLY_NO_SUBMIT", submitAuthorized: false,
  binding: { workspaceId: "w", candidateId: "c", applicationId: "a", revisionId: "r", fillAttemptId: "f", computerSessionId: "s" },
  destinationUrl: "https://jobs.lever.co/fixture/123/apply",
  facts: [
    { factKey: "identity.legal_name", factVersionId: "name-v1", value: "Synthetic Candidate", valueHash: "a".repeat(64) },
    { factKey: "contact.application_email", factVersionId: "email-v1", value: "synthetic@example.invalid", valueHash: "b".repeat(64) },
    { factKey: "education.highest_degree", factVersionId: "degree-v1", value: "Synthetic Degree", valueHash: "c".repeat(64) },
    { factKey: "work_authorization.us.authorized", factVersionId: "auth-v1", value: "Yes", valueHash: "d".repeat(64) },
    { factKey: "application.heard_about", factVersionId: "source-v1", value: "Synthetic Source", valueHash: "e".repeat(64) },
  ],
  artifacts: [{ artifactVersionId: "resume-v1", variant: "RESUME_PDF", filename: "Synthetic-Resume.pdf",
    mediaType: "application/pdf", byteSize: bytes.length, sha256: "f".repeat(64), bytes }],
});

test("hosted packet uses exact materialized facts and PDF bytes without inventing absent fields", () => {
  const result = packetFromMaterializedReadback(execution());
  assert.deepEqual(result.packet.facts, { name: "Synthetic Candidate", email: "synthetic@example.invalid",
    heardAbout: "Synthetic Source", highestDegree: "Synthetic Degree", usAuthorized: "Yes" });
  assert.equal(result.packet.resumeBase64, Buffer.from(bytes).toString("base64"));
  assert.equal(result.packet.coverLetterBase64, undefined);
  assert.match(result.packetReadbackHash, /^[a-f0-9]{64}$/u);
});

test("readback hash changes when an approved fact version changes and rejects missing résumé", () => {
  const first = execution();
  const second = { ...first, facts: first.facts.map(fact => fact.factKey === "education.highest_degree"
    ? { ...fact, factVersionId: "degree-v2" } : fact) };
  assert.notEqual(packetFromMaterializedReadback(first).packetReadbackHash, packetFromMaterializedReadback(second).packetReadbackHash);
  assert.throws(() => packetFromMaterializedReadback({ ...first, artifacts: [] }), /HOSTED_CANARY_PDF_SET_INVALID/u);
  assert.throws(() => packetFromMaterializedReadback({ ...first, facts: first.facts.filter(fact =>
    fact.factKey !== "contact.application_email") }), /HOSTED_CANARY_REQUIRED_FACT_MISSING/u);
});

test("plan builder refuses a packet for another applicant, application or destination", () => {
  const input = { candidateId: "c", applicationId: "a", destinationUrl: execution().destinationUrl,
    admissionKey: "canary_one", allowedDomains: ["jobs.lever.co"],
    originDecisions: { "https://jobs.lever.co": "approve" as const },
    deadlineMs: Date.now() + 60_000, priorSpendUpperBoundCents: 100, reservedRunCents: 100 };
  for (const changed of [
    { candidateId: "other" }, { applicationId: "other" },
    { destinationUrl: "https://jobs.lever.co/fixture/other/apply" },
  ]) assert.throws(() => prepareHostedCanaryPlanFromReadback(execution(), { ...input, ...changed }),
    /HOSTED_CANARY_READBACK_BINDING_MISMATCH/u);
});

test("plan builder includes only the materialized packet for the same application", () => {
  const candidateId = "11111111-1111-4111-8111-111111111111";
  const applicationId = "22222222-2222-4222-8222-222222222222";
  const destinationUrl = "https://jobs.lever.co/fixture/33333333-3333-4333-8333-333333333333/apply";
  const readback = { ...execution(), binding: { ...execution().binding, candidateId, applicationId }, destinationUrl };
  const { plan, packetReadbackHash } = prepareHostedCanaryPlanFromReadback(readback, {
    candidateId, applicationId, destinationUrl, admissionKey: "canary_one",
    allowedDomains: ["jobs.lever.co"], originDecisions: { "https://jobs.lever.co": "approve" },
    deadlineMs: Date.now() + 60_000, priorSpendUpperBoundCents: 100, reservedRunCents: 100,
  });
  assert.equal(packetReadbackHash, packetFromMaterializedReadback(readback).packetReadbackHash);
  assert.match(plan.packetSha256, /^[a-f0-9]{64}$/u);
  assert.match(JSON.stringify(plan.taskBody), /Synthetic Degree/u);
  assert.equal(plan.applicationId, applicationId);
});

test("one application salary answer is separately bound and cannot become a materialized fact", () => {
  const candidateId = "11111111-1111-4111-8111-111111111111";
  const applicationId = "22222222-2222-4222-8222-222222222222";
  const destinationUrl = "https://jobs.ashbyhq.com/fixture/33333333-3333-4333-8333-333333333333/application";
  const readback = { ...execution(), binding: { ...execution().binding, candidateId, applicationId }, destinationUrl };
  const input = { candidateId, applicationId, destinationUrl, admissionKey: "canary_one",
    allowedDomains: ["jobs.ashbyhq.com"], originDecisions: { "https://jobs.ashbyhq.com": "approve" as const },
    deadlineMs: Date.now() + 60_000, priorSpendUpperBoundCents: 100, reservedRunCents: 100 };
  const base = prepareHostedCanaryPlanFromReadback(readback, input);
  const withAnswer = prepareHostedCanaryPlanFromReadback(readback, { ...input, salaryExpectationAnnualUsd: "98765" });
  assert.equal(base.packetReadbackHash, withAnswer.packetReadbackHash);
  assert.notEqual(base.plan.packetSha256, withAnswer.plan.packetSha256);
  assert.match(JSON.stringify(withAnswer.plan.taskBody), /98765 USD annually for this application only/u);
  assert.equal(JSON.stringify(base.plan.taskBody).includes("98765"), false);
  assert.throws(() => prepareHostedCanaryPlanFromReadback(readback, { ...input, salaryExpectationAnnualUsd: "about 50k" }), /HOSTED_CANARY_PACKET_INVALID/u);
});
