import assert from "node:assert/strict";
import test from "node:test";

import { presentHomeApplication } from "./home-presentation.ts";

const base = { status: "TAKEOVER", intakeStatus: "RESOLVED", preparationStage: null, hasReceipt: false, sendIntent: "NONE", autoApplySelected: false } as const;

test("a Home row says exactly what the application needs", () => {
  const code = presentHomeApplication({ ...base, need: { kind: "CODE", recipient: "z***@example.test", expiresAt: "2026-09-29T00:00:00Z" } });
  assert.equal(code.label, "Enter code");
  assert.equal(code.needsYou, true);
  assert.equal(code.actionLabel, "Enter code");
  assert.match(code.detail, /z\*\*\*@example\.test/u);
  assert.equal(presentHomeApplication({ ...base, need: { kind: "ANSWERS", count: 1 } }).label, "Answer 1 question");
  assert.equal(presentHomeApplication({ ...base, need: { kind: "ANSWERS", count: 1 } }).actionLabel, "Answer");
  assert.equal(presentHomeApplication({ ...base, need: { kind: "ANSWERS", count: 9 } }).label, "Answer 9 questions");
  // Without a specific need, the application's own status stands.
  const plain = presentHomeApplication({ ...base, need: null });
  assert.equal(plain.label, "Needs you");
});

test("a Home row reads a queue row as it arrives: intake failure, send request and documents", () => {
  const queueRow = { ...base, status: "FAILED_SAFE", intakeStatus: "FAILED", failureCode: "JOB_NOT_FOUND", hasDocuments: false, autopilot: null, need: null } as const;
  const closed = presentHomeApplication(queueRow);
  assert.equal(closed.label, "Posting closed");
  assert.equal(closed.needsYou, false);
  const stopped = presentHomeApplication({ ...base, status: "FAILED_SAFE", failureCode: null, hasDocuments: true, need: null,
    autopilot: { id: "0b2c6c1e-0000-4000-8000-000000000001", status: "FAILED_SAFE", version: 4, failureCode: "DELIVERY_SITE_UNSUPPORTED", transientRetries: 0, reconcileCount: 0, expired: false } });
  assert.equal(stopped.label, "Finish on their site");
  assert.equal(stopped.needsYou, true);
  // A live need outranks everything the row would otherwise say.
  assert.equal(presentHomeApplication({ ...queueRow, need: { kind: "ANSWERS", count: 2 } }).label, "Answer 2 questions");
});
