import assert from "node:assert/strict";
import test from "node:test";

import { presentHomeApplication } from "./home-presentation.ts";

const base = { status: "TAKEOVER", intakeStatus: "RESOLVED", preparationStage: null, hasReceipt: false, sendIntent: "NONE", autoApplySelected: false } as const;

test("a Home row says exactly what the application needs", () => {
  const code = presentHomeApplication({ ...base, need: { kind: "CODE", recipient: "z***@example.test", expiresAt: "2026-09-29T00:00:00Z" } });
  assert.equal(code.label, "Enter code");
  assert.equal(code.needsYou, true);
  assert.match(code.detail, /z\*\*\*@example\.test/u);
  assert.equal(presentHomeApplication({ ...base, need: { kind: "ANSWERS", count: 1 } }).label, "Answer 1 question");
  assert.equal(presentHomeApplication({ ...base, need: { kind: "ANSWERS", count: 9 } }).label, "Answer 9 questions");
  // Without a specific need, the application's own status stands.
  const plain = presentHomeApplication({ ...base, need: null });
  assert.equal(plain.label, "Needs you");
});
