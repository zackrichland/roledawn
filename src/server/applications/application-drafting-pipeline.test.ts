import assert from "node:assert/strict";
import test from "node:test";
import type { ApplicationDraftingAdapterResult, ApplicationDraftingProposal, ApplicationDraftingRevision } from "../../domain/application-drafting.ts";
import { applicationWritingFixture, WRITING_EVAL_PROFESSIONS } from "../../test-support/application-writing-fixtures.ts";
import { loadApplicationWritingPolicy } from "./application-writing-policy-loader.ts";
import { ApplicationDraftingPipelineError, generateValidatedApplicationDraft, withValidatedApplicationDraft } from "./application-drafting-pipeline.ts";

const provenance = (await loadApplicationWritingPolicy()).provenance;
const execution = { adapterRelease: "test/1", modelRelease: "synthetic/1", requestId: null, writingPolicy: provenance };
const completed = (proposal: ApplicationDraftingProposal): ApplicationDraftingAdapterResult => ({ status: "COMPLETED", proposal, execution });
function harness(outputs: ApplicationDraftingAdapterResult[], semanticFailAt = 0) {
  const revisions: Array<ApplicationDraftingRevision | undefined> = [];
  let semanticCalls = 0;
  const dependencies = { drafting: { adapterRelease: "test/1", async draft(_request: unknown, revision?: ApplicationDraftingRevision) {
    revisions.push(revision); assert.ok(outputs.length, "unexpected extra draft"); return outputs.shift()!;
  } }, entailment: { async validate(request: { claims: readonly { claimId: string }[] }) {
    semanticCalls += 1;
    return { execution: { adapterRelease: "openai-responses-entailment/2" as const, modelRelease: "synthetic/1", requestId: null }, result: {
      schemaVersion: 1 as const, decisions: request.claims.map(claim => ({ claimId: claim.claimId, verdict: semanticCalls === semanticFailAt ? "NOT_ENTAILED" as const : "ENTAILED" as const, reason: "Synthetic source check." })) } };
  } } };
  return { dependencies, revisions, semanticCalls: () => semanticCalls };
}
function short(proposal: ApplicationDraftingProposal): ApplicationDraftingProposal {
  return { ...proposal, coverLetter: { ...proposal.coverLetter, paragraphs: proposal.coverLetter.paragraphs.map(p => ({ ...p, text: p.text.split(/\s+/u).slice(0, 15).join(" ") })) } };
}
for (const profession of WRITING_EVAL_PROFESSIONS) test(`accepts sourced ${profession} materials without an unnecessary second draft`, async () => {
  const fixture = applicationWritingFixture(profession); const mock = harness([completed(fixture.proposal)]);
  const result = await generateValidatedApplicationDraft(fixture, mock.dependencies);
  assert.equal(result.draftingAttempts.attempts.length, 1);
  assert.equal(result.qualityValidation.readyForCandidateReview, true);
  assert.equal(mock.semanticCalls(), 1);
});

test("repairs a short letter with measured feedback and revalidates before the artifact/commit boundary", async () => {
  const fixture = applicationWritingFixture("teacher"); const bad = short(fixture.proposal);
  const mock = harness([completed(bad), completed(fixture.proposal)]); let artifactsAndCommit = 0;
  const result = await withValidatedApplicationDraft(fixture, mock.dependencies, async validated => {
    assert.equal(mock.semanticCalls(), 2); assert.equal(validated.qualityValidation.readyForCandidateReview, true);
    artifactsAndCommit += 1; return validated;
  });
  assert.equal(artifactsAndCommit, 1); assert.equal(mock.revisions.length, 2);
  assert.deepEqual(mock.revisions[1]?.previousProposal, bad);
  assert.ok(mock.revisions[1]?.issueCodes.includes("COVER_LETTER_LENGTH_OUT_OF_RANGE"));
  assert.equal(mock.revisions[1]?.targetCoverLetterWords, 210);
  assert.deepEqual(result.draftingAttempts.attempts.map(a => a.status), ["REPAIR_REQUESTED", "ACCEPTED"]);
  assert.deepEqual(result.drafting.execution.writingPolicy, provenance);
  assert.doesNotMatch(JSON.stringify(result.draftingAttempts), /Community School|Riverbend|claimText|previousProposal|morgan@/u);
});

test("repairs a deterministic prose violation only after the initial claims pass evidence validation", async () => {
  const fixture = applicationWritingFixture("finance"); const bad = structuredClone(fixture.proposal);
  const first = { ...bad, coverLetter: { ...bad.coverLetter, paragraphs: bad.coverLetter.paragraphs.map((p, i) => i ? p : { ...p, text: `${p.text} Utilize.` }) } };
  const mock = harness([completed(first), completed(fixture.proposal)]);
  const result = await generateValidatedApplicationDraft(fixture, mock.dependencies);
  assert.equal(mock.semanticCalls(), 2); assert.equal(result.deterministicValidation.deterministicChecksPassed, true);
  assert.deepEqual(mock.revisions[1]?.issueCodes, ["WRITING_POLICY_VIOLATION"]);
});

test("exhausted repair never reaches artifacts or commit and is nonretryable", async () => {
  const fixture = applicationWritingFixture("nursing"); const mock = harness([completed(short(fixture.proposal)), completed(short(fixture.proposal))]);
  let commits = 0;
  await assert.rejects(withValidatedApplicationDraft(fixture, mock.dependencies, async () => { commits++; }), (error: unknown) => {
    assert.ok(error instanceof ApplicationDraftingPipelineError); assert.equal(error.retryable, false);
    assert.match(error.message, /^APPLICATION_DRAFTING_REPAIR_EXHAUSTED:ATTEMPTS_2$/u);
    assert.equal(error.attempts.attempts.length, 2); return true;
  });
  assert.equal(commits, 0); assert.equal(mock.revisions.length, 2);
});

for (const status of ["REFUSED", "INCOMPLETE"] as const) test(`${status} is terminal and never triggers another draft`, async () => {
  const fixture = applicationWritingFixture("teacher"); const mock = harness([{ status, reasonCode: "PRIVATE_TEXT_MUST_NOT_LEAK", execution }]);
  await assert.rejects(generateValidatedApplicationDraft(fixture, mock.dependencies), (error: unknown) => {
    assert.ok(error instanceof ApplicationDraftingPipelineError); assert.equal(error.retryable, false);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TEXT/u); return true;
  });
  assert.equal(mock.revisions.length, 1); assert.equal(mock.semanticCalls(), 0);
});

test("unsupported facts are nonrepairable even when a letter also fails length", async () => {
  const fixture = applicationWritingFixture("teacher"); const bad = short(fixture.proposal);
  const mutated = { ...bad, resume: { ...bad.resume, handling: "TAILOR_FROM_APPROVED_EVIDENCE" as const, mode: "REORDER_AND_TIGHTEN" as const, text: "EXPERIENCE\nImproved outcomes by 999 percent." } };
  const mock = harness([completed(mutated)]);
  await assert.rejects(generateValidatedApplicationDraft(fixture, mock.dependencies), /FACTUAL_VALIDATION_FAILED:ATTEMPTS_1/u);
  assert.equal(mock.revisions.length, 1); assert.equal(mock.semanticCalls(), 0);
});

test("semantic rejection blocks repair; a repaired draft must also pass semantic checks", async () => {
  const fixture = applicationWritingFixture("teacher");
  for (const failAt of [1, 2]) {
    const mock = harness([completed(short(fixture.proposal)), completed(fixture.proposal)], failAt); let commits = 0;
    await assert.rejects(withValidatedApplicationDraft(fixture, mock.dependencies, async () => { commits++; }), /SEMANTIC_VALIDATION_FAILED/u);
    assert.equal(mock.revisions.length, failAt); assert.equal(commits, 0);
  }
});

test("provider errors expose only a fixed failure code and redacted attempt history", async () => {
  const fixture = applicationWritingFixture("teacher"); const mock = harness([]);
  mock.dependencies.drafting.draft = async () => { throw new Error("Secret key and candidate details"); };
  await assert.rejects(generateValidatedApplicationDraft(fixture, mock.dependencies), (error: unknown) => {
    assert.ok(error instanceof ApplicationDraftingPipelineError); assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message + JSON.stringify(error), /Secret|candidate details/u); return true;
  });
});


test("missing loaded policy provenance fails before evidence checking or artifacts", async () => {
  const fixture = applicationWritingFixture("teacher");
  const mock = harness([{ status: "COMPLETED", proposal: fixture.proposal, execution: { adapterRelease: "test/1", modelRelease: "synthetic/1", requestId: null } }]);
  await assert.rejects(generateValidatedApplicationDraft(fixture, mock.dependencies), /POLICY_PROVENANCE_MISSING:ATTEMPTS_1/u);
  assert.equal(mock.semanticCalls(), 0);
});

test("artifact QA failure remains terminal and retains only validated attempt metadata", async () => {
  const fixture = applicationWritingFixture("teacher"); const mock = harness([completed(fixture.proposal)]);
  await assert.rejects(withValidatedApplicationDraft(fixture, mock.dependencies, async () => {
    throw new Error("APPLICATION_ARTIFACT_QA_TEXT_MISSING");
  }), (error: unknown) => {
    assert.ok(error instanceof ApplicationDraftingPipelineError);
    assert.equal(error.retryable, false);
    assert.equal(error.attempts.attempts[0]?.status, "ACCEPTED");
    assert.match(error.message, /APPLICATION_DRAFTING_ARTIFACT_QA_FAILED:ATTEMPTS_1/u);
    return true;
  });
});
