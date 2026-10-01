import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationWritingError } from "../applications/application-writing-pipeline.ts";
import { decideApplicationKitFailureDisposition, KIT_BUDGET_MS, kitHasTimeForAnotherAttempt } from "./application-kit.ts";

test("a writing failure that won't clear by retrying terminates the outbox job instead of starting another drafting cycle", () => {
  const failure = new ApplicationWritingError("APPLICATION_WRITING_QUALITY_BLOCKED", false);
  assert.deepEqual(decideApplicationKitFailureDisposition(1, failure), { action: "DEAD_LETTER", errorCode: "APPLICATION_WRITING_QUALITY_BLOCKED" });
});
test("transient provider failure keeps bounded outbox recovery and redacts unknown messages", () => {
  const failure = new ApplicationWritingError("APPLICATION_WRITER_FAILED", true);
  assert.equal(decideApplicationKitFailureDisposition(1, failure).action, "RETRY");
  assert.equal(decideApplicationKitFailureDisposition(5, failure).action, "DEAD_LETTER");
  assert.equal(decideApplicationKitFailureDisposition(1, new Error("Candidate text and API secret")).errorCode, "WORKER_UNEXPECTED_FAILURE");
});


test("credit exhaustion terminates research and writing failures immediately", async () => {
  const { StructuredResponseError } = await import("../ai/structured-response.ts");
  const { generateApplicationWriting } = await import("../applications/application-writing-pipeline.ts");
  const error = new StructuredResponseError("MODEL_CREDITS_EXHAUSTED", false);
  assert.equal(decideApplicationKitFailureDisposition(1, error).action, "DEAD_LETTER");
  let calls = 0;
  await assert.rejects(generateApplicationWriting({} as never, {
    async write() { calls += 1; throw error; }, async verify() { throw new Error("not reached"); }, lintStyle() { return []; },
  }), (wrapped: unknown) => {
    assert.ok(wrapped instanceof ApplicationWritingError);
    assert.equal(wrapped.retryable, false);
    assert.equal(decideApplicationKitFailureDisposition(1, wrapped).action, "DEAD_LETTER");
    return true;
  });
  assert.equal(calls, 1);
});

test("a transient drafting-context read retries, while missing or mismatched context stays terminal (D-149)", async () => {
  const { DraftingContextV2Error } = await import("../applications/drafting-context-v2.ts");
  assert.equal(decideApplicationKitFailureDisposition(1, new DraftingContextV2Error("DRAFTING_EVIDENCE_READ_FAILED", true)).action, "RETRY");
  assert.equal(decideApplicationKitFailureDisposition(1, new DraftingContextV2Error("DRAFTING_CAREER_PROFILE_MISSING")).action, "DEAD_LETTER");
  assert.equal(decideApplicationKitFailureDisposition(1, new Error("DRAFTING_STORY_MISMATCH")).action, "DEAD_LETTER");
});

test("verifier credit exhaustion is terminal; a verifier timeout still retries (D-149)", async () => {
  const { StructuredResponseError } = await import("../ai/structured-response.ts");
  const { verifierFailure } = await import("../applications/application-writing-pipeline.ts");
  const credits = verifierFailure(new StructuredResponseError("MODEL_CREDITS_EXHAUSTED", false));
  assert.equal(credits.retryable, false);
  assert.equal(decideApplicationKitFailureDisposition(1, credits).action, "DEAD_LETTER");
  assert.equal(verifierFailure(new StructuredResponseError("MODEL_REQUEST_FAILED", true)).retryable, true);
  const unknown = verifierFailure(new Error("socket closed with candidate text"));
  assert.equal(unknown.retryable, true);
  assert.equal(unknown.message, "APPLICATION_VERIFIER_FAILED");
});

test("a writing repair round starts only when it and rendering still fit the kit budget (D-149)", () => {
  assert.equal(KIT_BUDGET_MS < 900_000, true, "the kit budget stays inside the 900 s outbox lease");
  assert.equal(kitHasTimeForAnotherAttempt(200_000, 150_000), true);
  assert.equal(kitHasTimeForAnotherAttempt(500_000, 200_000), false);
  assert.equal(kitHasTimeForAnotherAttempt(600_000, 60_000), true);
  assert.equal(kitHasTimeForAnotherAttempt(700_000, 10_000), false);
});
