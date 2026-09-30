import assert from "node:assert/strict";
import test from "node:test";
import { structuredResponse, StructuredResponseError } from "./structured-response.ts";

test("permanent credit exhaustion stops retries without leaking provider messages", async () => {
  for (const failure of [
    { status: 429, code: "credit_balance_exhausted", type: "insufficient_quota" },
    { status: 429, error: { code: "insufficient_quota" } },
    { status: 429, type: "insufficient_quota" },
    { status: 429, code: "rate_limit_exceeded" },
    { status: 503 },
  ]) {
    const client = { responses: { async create() { throw Object.assign(new Error("private candidate and credential text"), failure); } } };
    await assert.rejects(structuredResponse({ client: client as never, model: "synthetic", instructions: "Synthetic", input: "Synthetic", schemaName: "test", schema: {} }), (error: unknown) => {
      assert.ok(error instanceof StructuredResponseError);
      const credits = "type" in failure || "error" in failure || failure.code === "credit_balance_exhausted";
      assert.equal(error.code, credits ? "MODEL_CREDITS_EXHAUSTED" : failure.status === 503 ? "MODEL_HTTP_503" : "MODEL_RATE_LIMITED");
      assert.equal(error.retryable, !credits);
      assert.doesNotMatch(error.message, /private|credential/u);
      return true;
    });
  }
});
