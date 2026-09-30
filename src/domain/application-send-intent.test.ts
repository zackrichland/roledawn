import assert from "node:assert/strict";
import { test } from "node:test";
import { mayRequestInitialSend, parseSendIntentResult } from "./application-send-intent.ts";

test("send requests report the durable result, including a canceled command replay", () => {
  assert.deepEqual(parseSendIntentResult([{ application_id: "app", intent_open: true, replayed: false }], "app"), { open: true, replayed: false });
  assert.deepEqual(parseSendIntentResult([{ application_id: "app", intent_open: false, replayed: true }], "app"), { open: false, replayed: true });
  for (const value of [null, [], [{ application_id: "other", intent_open: true, replayed: false }], [{ application_id: "app", intent_open: "true", replayed: false }]]) {
    assert.equal(parseSendIntentResult(value, "app"), null);
  }
});

test("pasting a duplicate cannot restart a canceled application or an uncertain delivery", () => {
  for (const status of ["CONFIRMED", "CANCELED", "SKIPPED", "EXECUTING", "RECONCILING", "AUTHORIZED"]) {
    assert.equal(mayRequestInitialSend(status), false, status);
  }
  for (const status of ["DRAFTING", "READY", "NEEDS_USER"]) assert.equal(mayRequestInitialSend(status), true, status);
});
