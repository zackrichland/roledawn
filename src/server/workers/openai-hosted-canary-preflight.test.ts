import assert from "node:assert/strict";
import test from "node:test";
import { prepareHostedCanaryPlan } from "./openai-hosted-canary.ts";
import { hostedCanaryPreflight, type CanaryOperatorManifest } from "./openai-hosted-canary-preflight.ts";
const now = Date.now();
const plan = prepareHostedCanaryPlan({ candidateId: "11111111-1111-4111-8111-111111111111", applicationId: "22222222-2222-4222-8222-222222222222",
  destinationUrl: "https://jobs.lever.co/fixture/33333333-3333-4333-8333-333333333333/apply", admissionKey: "one", allowedDomains: ["jobs.lever.co"],
  originDecisions: { "https://jobs.lever.co": "approve" }, deadlineMs: now+100000, priorSpendUpperBoundCents: 200, reservedRunCents: 100,
  packet: { facts: { name: "PRIVATE CANDIDATE VALUE", email: "private@example.invalid" }, resumeBase64: Buffer.from("%PDF-private-resume").toString("base64") } });
const manifest: CanaryOperatorManifest = { plan, approval: { intentSha256: plan.intentSha256, packetSha256: plan.packetSha256,
  destinationUrl: plan.destinationUrl, approvalHash: "a".repeat(64), packetReadbackHash: "b".repeat(64), priorSpendEvidenceHash: "c".repeat(64),
  futureCostBoundHash: "d".repeat(64), schemaReviewHash: "e".repeat(64), expiresAt: new Date(now+120000).toISOString() } };
const env = { ROLEDAWN_HOSTED_CANARY_EVIDENCE_DIR: "/private/synthetic", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic", ROLEDAWN_HOSTED_CANARY_ENABLED: "true", OPENAI_API_KEY: "SECRET OPENAI VALUE", NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", SUPABASE_SECRET_KEY: "SECRET DB VALUE" };
test("preflight is redacted and distinguishes local checks from deployed authorization", () => {
  const result = hostedCanaryPreflight(env,manifest,now);
  assert.equal(result.localChecksPass,true); assert.equal(result.deployedApprovalAndExclusionVerified,false);
  const printed = JSON.stringify(result); for (const secret of ["PRIVATE CANDIDATE VALUE","private@example.invalid","SECRET OPENAI VALUE","SECRET DB VALUE",plan.destinationUrl]) assert.ok(!printed.includes(secret));
});
test("preflight reports missing names and exact approval mismatch without values", () => {
  const missing = hostedCanaryPreflight({},undefined,now); assert.ok(missing.missingConfig.includes("OPENAI_API_KEY"));
  const changed = structuredClone(manifest); changed.approval.packetSha256 = "f".repeat(64);
  assert.ok(hostedCanaryPreflight(env,changed,now).blockers.includes("APPROVED_BINDING_MISMATCH"));
  assert.ok(hostedCanaryPreflight(env,manifest,now+200000).blockers.includes("NEW_ADMISSION_DEADLINE_INVALID"));
});
