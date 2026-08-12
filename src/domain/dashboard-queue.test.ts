import assert from "node:assert/strict";
import test from "node:test";

import { canPresentAsSubmitted } from "./dashboard-queue.ts";

test("confirmed without a receipt is not presented as submitted", () => {
  assert.equal(canPresentAsSubmitted("CONFIRMED", false), false);
});

test("a confirmed application with a receipt can be presented as submitted", () => {
  assert.equal(canPresentAsSubmitted("CONFIRMED", true), true);
});

test("a receipt cannot make a non-confirmed application look submitted", () => {
  assert.equal(canPresentAsSubmitted("EXECUTING", true), false);
});
