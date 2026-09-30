import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationWritingError } from "../applications/application-writing-pipeline.ts";
import { decideApplicationKitFailureDisposition } from "./application-kit.ts";

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
