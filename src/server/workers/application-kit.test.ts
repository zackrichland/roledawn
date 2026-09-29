import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationDraftingPipelineError } from "../applications/application-drafting-pipeline.ts";
import { decideApplicationKitFailureDisposition } from "./application-kit.ts";

test("exhausted writing repair terminates the outbox job instead of starting another drafting cycle", () => {
  const failure = new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_REPAIR_EXHAUSTED", []);
  assert.deepEqual(decideApplicationKitFailureDisposition(1, failure), { action: "DEAD_LETTER", errorCode: "APPLICATION_DRAFTING_REPAIR_EXHAUSTED:ATTEMPTS_0" });
});
test("transient provider failure keeps bounded outbox recovery and redacts unknown messages", () => {
  const failure = new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_PROVIDER_FAILED", [], true);
  assert.equal(decideApplicationKitFailureDisposition(1, failure).action, "RETRY");
  assert.equal(decideApplicationKitFailureDisposition(5, failure).action, "DEAD_LETTER");
  assert.equal(decideApplicationKitFailureDisposition(1, new Error("Candidate text and API secret")).errorCode, "WORKER_UNEXPECTED_FAILURE");
});
