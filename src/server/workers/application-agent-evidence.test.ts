import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createApplicationAgentEvidence, mayDraftApplicationAnswer } from "./application-agent-evidence.ts";
import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";

test("narrative answers cannot manufacture exact or sensitive decisions", () => {
  assert.equal(mayDraftApplicationAnswer("Describe a project you built."), true);
  assert.equal(mayDraftApplicationAnswer("Name a project you built."), true);
  assert.equal(mayDraftApplicationAnswer("Describe your technical background."), true);
  for (const question of ["Desired salary", "What is your nationality?", "Are you authorized to work?", "Years of Python experience", "Can you relocate?", "Do you consent?", "Full name", "When can you start?"]) {
    assert.equal(mayDraftApplicationAnswer(question), false, question);
  }
});

test("narrative evidence verifies bytes and removes identity facts before disclosure", async () => {
  const bytes = new TextEncoder().encode("synthetic-pdf");
  const artifact = { artifactVersionId: "document", variant: "RESUME_PDF" as const, filename: "resume.pdf", mediaType: "application/pdf", byteSize: bytes.length, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  const packet = { artifacts: [artifact], facts: [{ factKey: "identity.legal_name", value: "Alex Example" }, { factKey: "contact.application_email", value: "alex@example.test" }] } as unknown as ApplicationFillExecutionPackage;
  let extractions = 0;
  const evidence = createApplicationAgentEvidence({ extract: async input => {
    extractions++;
    return { ok: true, value: { schemaVersion: 1, source: { filename: input.filename, mediaType: "application/pdf", byteSize: input.bytes.length, sha256: artifact.sha256 }, extraction: {
      parserRelease: "synthetic", pageCount: 1, normalizedText: "Alex Example\nalex@example.test\n\nBuilt an intake portal.", characterCount: 70, sha256: artifact.sha256, warningCount: 0, warnings: [],
    } } };
  } });
  const sources = await evidence.load(packet);
  assert.equal(sources.length, 1);
  assert.match(sources[0].text, /Built an intake portal/u);
  assert.doesNotMatch(sources[0].text, /Alex Example|alex@example/u);
  await assert.rejects(evidence.load({ ...packet, artifacts: [{ ...artifact, sha256: "0".repeat(64) }] }), /BYTES_CHANGED/u);
  assert.equal(extractions, 1);
});

test("paraphrases require independent entailment and valid provenance; abort wins", async () => {
  let verifications = 0;
  const evidence = createApplicationAgentEvidence({ verify: async text => { verifications++; return ["I developed an intake portal.", "Built an intake portal."].includes(text); } });
  const input = { question: "Describe a project you built.", text: "Built an intake portal.", sourceIds: ["document:0"], sources: [{ sourceId: "document:0", text: "Built an intake portal." }] };
  assert.equal(await evidence.validate(input), true);
  assert.equal(verifications, 1);
  assert.equal(await evidence.validate({ ...input, text: "I developed an intake portal." }), true);
  assert.equal(await evidence.validate({ ...input, text: "I improved revenue by 200%." }), false);
  assert.equal(await evidence.validate({ ...input, sourceIds: ["invented"] }), false);
  assert.equal(await evidence.validate({ ...input, sourceIds: ["document:0", "document:0"] }), false);
  assert.equal(await evidence.validate({ ...input, question: "What is your salary?" }), false);
  assert.equal(await evidence.validate({ ...input, signal: AbortSignal.abort() }), false);
  assert.equal(verifications, 3);
});

test("an exact substring cannot discard negation from its evidence", async () => {
  let verified = false;
  const evidence = createApplicationAgentEvidence({ verify: async () => { verified = true; return false; } });
  assert.equal(await evidence.validate({ question: "Describe your leadership experience.", text: "led a team",
    sourceIds: ["source"], sources: [{ sourceId: "source", text: "I have never led a team." }] }), false);
  assert.equal(verified, true);
});
