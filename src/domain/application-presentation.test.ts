import assert from "node:assert/strict";
import test from "node:test";

import { presentApplication, presentAutopilotStatus } from "./application-presentation.ts";
import { applicationSendIntentState, canOfferApplicationSend } from "./application-send-intent.ts";
import { APPLICATION_AUTOPILOT_STATUSES } from "./application-autopilot.ts";

const ready = { status: "READY", intakeStatus: "RESOLVED", preparationStage: null, hasReceipt: false } as const;

test("document readiness does not ask for a second send when one is already requested", () => {
  for (const sendIntent of ["OPEN", "DELEGATED"] as const) {
    const state = presentApplication({ ...ready, sendIntent });
    assert.equal(state.tone, "working");
    assert.equal(state.step, 3);
    assert.equal(state.needsYou, false);
    assert.equal(canOfferApplicationSend(sendIntent), false);
  }
  assert.equal(canOfferApplicationSend("NONE"), true);
  assert.equal(canOfferApplicationSend("CANCELED"), true);
});

test("a stopped or unreadable send stays visible instead of becoming an ordinary ready packet", () => {
  const sendIntent = applicationSendIntentState({ closed_at: "2026-09-30T00:00:00Z", close_reason: "NOT_DELIVERABLE" });
  assert.equal(sendIntent, "NOT_DELIVERABLE");
  assert.equal(canOfferApplicationSend(sendIntent), false);
  assert.equal(presentApplication({ ...ready, sendIntent }).needsYou, true);
  assert.equal(canOfferApplicationSend("UNAVAILABLE"), false);
  assert.equal(presentApplication({ ...ready, sendIntent: "UNAVAILABLE" }).label, "Status unavailable");
  assert.equal(applicationSendIntentState({ closed_at: null, close_reason: "NOT_DELIVERABLE" }), "UNAVAILABLE");
  assert.equal(applicationSendIntentState(null), "NONE");
  assert.equal(applicationSendIntentState({ closed_at: null, close_reason: null }), "OPEN");
});

test("an existing delivery displays progress instead of repeating the apply authorization heading", () => {
  for (const status of APPLICATION_AUTOPILOT_STATUSES) {
    assert.notEqual(presentAutopilotStatus(status).heading, "Apply for me");
  }
  assert.equal(presentAutopilotStatus(undefined).heading, "Apply for me");
  assert.equal(presentAutopilotStatus("SUBMITTING", true).heading, "Check your email");
});

test("unknown outcomes do not claim refusal or invite a duplicate application", () => {
  for (const status of ["UNCERTAIN", "RECONCILING"] as const) {
    const copy = presentAutopilotStatus(status).detail;
    assert.match(copy, /outcome is unknown/u);
    assert.doesNotMatch(copy, /didn.t accept|finish it on|before submission/iu);
  }
  assert.doesNotMatch(presentAutopilotStatus("FAILED_SAFE").detail, /before submission|nothing was sent/iu);
});
