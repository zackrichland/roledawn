import assert from "node:assert/strict";
import test from "node:test";

import { applicationInputsChanged } from "./application-input-freshness.ts";

test("marks a packet stale only when the candidate input epoch changed", () => {
  assert.equal(applicationInputsChanged(105, 84), true);
  assert.equal(applicationInputsChanged(105, 105), false);
});

test("rejects invalid version values instead of guessing freshness", () => {
  assert.throws(
    () => applicationInputsChanged(0, 1),
    /APPLICATION_INPUT_VERSION_INVALID/u,
  );
  assert.throws(
    () => applicationInputsChanged(1, Number.MAX_SAFE_INTEGER + 1),
    /APPLICATION_INPUT_VERSION_INVALID/u,
  );
});
