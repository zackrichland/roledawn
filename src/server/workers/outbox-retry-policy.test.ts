import assert from "node:assert/strict";
import test from "node:test";

import { decideOutboxFailureDisposition } from "./outbox-retry-policy.ts";

test("outbox retries use bounded exponential backoff", () => {
  assert.deepEqual(decideOutboxFailureDisposition(1, "FETCH_FAILED"), {
    action: "RETRY",
    errorCode: "FETCH_FAILED",
    retryAfterSeconds: 60,
  });
  assert.equal(decideOutboxFailureDisposition(4, "FETCH_FAILED").action, "RETRY");
});

test("the fifth failed claim is dead-lettered", () => {
  assert.deepEqual(decideOutboxFailureDisposition(5, "FETCH_FAILED"), {
    action: "DEAD_LETTER",
    errorCode: "FETCH_FAILED",
  });
});

test("invalid attempt metadata fails closed", () => {
  assert.deepEqual(decideOutboxFailureDisposition(0, "FETCH_FAILED"), {
    action: "DEAD_LETTER",
    errorCode: "WORKER_ATTEMPT_COUNT_INVALID",
  });
});
