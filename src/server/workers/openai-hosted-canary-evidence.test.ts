import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureHostedOutputs, evidenceHash, expectedEmployerBinding, openPrivateEvidenceArchive, verificationDigest, verifyArchivedEmployerEvidence, type EmployerVerification } from "./openai-hosted-canary-evidence.ts";
import { prepareHostedCanaryPlan, type CanaryRun } from "./openai-hosted-canary.ts";
import type { HostedCanaryTransport } from "./openai-hosted-canary-transport.ts";
const now = Date.now();
const plan = prepareHostedCanaryPlan({ candidateId: "11111111-1111-4111-8111-111111111111", applicationId: "22222222-2222-4222-8222-222222222222",
  destinationUrl: "https://jobs.lever.co/fixture/33333333-3333-4333-8333-333333333333/apply", admissionKey: "one", allowedDomains: ["jobs.lever.co"],
  originDecisions: { "https://jobs.lever.co": "approve" }, deadlineMs: now+120000, priorSpendUpperBoundCents: 100, reservedRunCents: 100,
  packet: { facts: { name: "Synthetic Private Name", email: "fixture@example.invalid" }, resumeBase64: Buffer.from("%PDF-fixture").toString("base64") } });
const run: CanaryRun = { runId: "run_1", controllerToken: "token", version: 1, intentSha256: plan.intentSha256, phase: "UNCERTAIN", sessionId: "session_1", possibleEgress: true,cancelRequested: true,cleanupPending: true,evidence: null };

test("bound independently reviewed employer bytes pass; model claims, stale/wrong receipt and unverified screenshots fail", async () => {
  const root = await mkdtemp(join(tmpdir(),"hosted-evidence-"));
  try {
    const archive = await openPrivateEvidenceArchive(root), rawSha256 = await archive.put(Buffer.from("Synthetic employer response: application received for fixture@example.invalid and role 33333333."));
    const verification: EmployerVerification = { ...expectedEmployerBinding(plan,run),sourceKind: "EMPLOYER_RESPONSE",sourceUrl: plan.destinationUrl,rawSha256,
      observedAt: new Date(now).toISOString(), runStartedAt: new Date(now-1000).toISOString(),verifiedAt: new Date(now+100).toISOString(),
      explicitOutcome: "CONFIRMED",reviewerReferenceSha256: "a".repeat(64),employerOriginIndependentlyVerified: true,exactCandidateAndJobIndependentlyVerified: true };
    const evidence = { source: "VERIFIED_EMPLOYER_EVIDENCE",applicationId: plan.applicationId,destinationUrl: plan.destinationUrl,packetSha256: plan.packetSha256,
      evidenceSha256: verificationDigest(verification),outcome: "CONFIRMED",verification };
    assert.equal((await verifyArchivedEmployerEvidence(plan,run,evidence,archive,now+1000)).outcome,"CONFIRMED");
    // JSONB key reordering must not invalidate the content digest.
    const reordered = Object.fromEntries(Object.entries(verification).reverse());
    assert.equal(verificationDigest(reordered),evidence.evidenceSha256);
    for (const patch of [
      { sourceKind: "MODEL_STATEMENT" }, { sourceKind: "SCREENSHOT",employerOriginIndependentlyVerified: false },
      { sourceUrl: "https://untrusted.example/fixture/33333333-3333-4333-8333-333333333333/apply" },
      { jobSha256: "f".repeat(64) }, { candidateContactSha256: "f".repeat(64) }, { sessionSha256: "f".repeat(64) },
      { observedAt: new Date(now-86400000).toISOString() }, { explicitOutcome: "AMBIGUOUS" }, { rawSha256: "f".repeat(64) },
    ]) {
      const v = { ...verification,...patch };
      await assert.rejects(verifyArchivedEmployerEvidence(plan,run,{ ...evidence,verification:v,evidenceSha256:verificationDigest(v) },archive,now+1000));
    }
    assert.equal((await stat(join(root,rawSha256))).mode & 0o777,0o600);
  } finally { await rm(root,{ recursive:true,force:true }); }
});

test("lost-stream recovery archives saved turns, tool screenshots and published bytes without treating any as a receipt", async () => {
  const root = await mkdtemp(join(tmpdir(),"hosted-capture-"));
  try {
    const archive = await openPrivateEvidenceArchive(root), jpeg = Buffer.from([0xff,0xd8,0xff,0xd9]);
    const response = (data: unknown[]) => ({ object: "list",data,has_more:false });
    const transport = {
      async turns() { return response([{ id:"turn_1",session_id:"session_1",subagent_id:null,status:"completed" }]); },
      async items() { return response([{ type:"computer_use_call",turn_id:"turn_1",output:{ type:"computer_screenshot",image_url:`data:image/jpeg;base64,${jpeg.toString("base64")}` } },
        { type:"message",turn_id:"turn_1",role:"assistant",content:[{ type:"output_text",text:"Model says application succeeded" }] }]); },
      async artifacts() { return response([{ object:"agent.session.artifact",id:"artifact_1",session_id:"session_1",turn_id:"turn_1",size_bytes:jpeg.length,path:"/workspace/outputs/receipt.jpg",created_at:now/1000,environment_id:"environment_1" }]); },
      async artifactContent() { return jpeg; },
    } as Pick<HostedCanaryTransport,"turns" | "items" | "artifacts" | "artifactContent">;
    const result = await captureHostedOutputs(run,transport,archive); assert.equal(result.status,"CAPTURED");
    const manifest = JSON.parse(Buffer.from(await archive.get(result.manifestSha256!)).toString());
    assert.equal(manifest.type,"HOSTED_DIAGNOSTICS_NOT_RECEIPT"); assert.equal(manifest.sessionSha256,evidenceHash(run.sessionId!));
    assert.equal(manifest.artifacts,1); assert.ok(manifest.saved.some((x: { kind: string }) => x.kind === "unverified_screenshot"));
    const printed = JSON.stringify(result); assert.ok(!printed.includes("application succeeded")); assert.ok(!printed.includes("session_1"));
    transport.artifacts = async () => ({ object:"list",data:[],has_more:true });
    assert.equal((await captureHostedOutputs(run,transport,archive)).status,"INCOMPLETE");
    transport.turns = async () => { throw Error("private provider details"); };
    const incomplete = await captureHostedOutputs(run,transport,archive);
    assert.equal(incomplete.status,"INCOMPLETE"); assert.ok(!JSON.stringify(incomplete).includes("private provider details"));
  } finally { await rm(root,{ recursive:true,force:true }); }
});
