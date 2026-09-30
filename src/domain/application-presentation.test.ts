import assert from "node:assert/strict";
import test from "node:test";

import { presentApplication } from "./application-presentation.ts";
import { applicationSendIntentState, canOfferApplicationSend } from "./application-send-intent.ts";
import type { AutopilotSummary } from "./dashboard-queue.ts";

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

const send = (status: AutopilotSummary["status"], extra: Partial<AutopilotSummary> = {}): AutopilotSummary =>
  ({ id: "0b2c6c1e-0000-4000-8000-000000000001", status, version: 3, failureCode: null, transientRetries: 0, reconcileCount: 0, expired: false, ...extra });
const stopped = { status: "FAILED_SAFE", intakeStatus: "RESOLVED", preparationStage: null, hasReceipt: false, hasDocuments: true } as const;

test("a live or stopped send speaks for the application, with the same words everywhere", () => {
  const retrying = presentApplication({ ...stopped, status: "EXECUTING", autopilot: send("QUEUED", { transientRetries: 1 }) });
  assert.equal(retrying.label, "Trying again");
  assert.equal(retrying.needsYou, false);
  assert.equal(retrying.tone, "working");

  const captcha = presentApplication({ ...stopped, autopilot: send("FAILED_SAFE", { failureCode: "APPLICATION_FILL_CAPTCHA_TAKEOVER" }) });
  assert.equal(captcha.label, "Finish on their site");
  assert.equal(captcha.needsYou, true);
  assert.equal(captcha.actionLabel, "Finish on site");
  assert.equal(captcha.guidance?.retry, "AFTER_CHANGE");
  assert.doesNotMatch(captcha.detail, /APPLICATION_FILL/u);

  const flaky = presentApplication({ ...stopped, autopilot: send("FAILED_SAFE", { failureCode: "OPENAI_AGENTS_ABORTED", transientRetries: 2 }) });
  assert.equal(flaky.actionLabel, "Try again");
  assert.equal(flaky.guidance?.retry, "MANUAL");

  const expired = presentApplication({ ...stopped, autopilot: send("FAILED_SAFE", { failureCode: "OPENAI_AGENTS_ABORTED", transientRetries: 2, expired: true }) });
  assert.equal(expired.actionLabel, "Finish on site");

  const unknown = presentApplication({ ...stopped, status: "RECONCILING", autopilot: send("UNCERTAIN") });
  assert.equal(unknown.label, "Confirming");
  assert.equal(unknown.needsYou, false);
  assert.equal(unknown.guidance?.retry, "NEVER");
  assert.equal(presentApplication({ ...stopped, status: "TAKEOVER", autopilot: send("PAUSED") }).label, "Paused");
});

test("a finished send request leaves the application's own status in charge", () => {
  assert.equal(presentApplication({ ...stopped, status: "CONFIRMED", hasReceipt: true, autopilot: send("CONFIRMED") }).label, "Applied");
  assert.equal(presentApplication({ ...stopped, status: "CONFIRMED", autopilot: send("CONFIRMED") }).label, "Check needed");
  assert.doesNotMatch(presentApplication({ ...stopped, status: "CONFIRMED" }).detail, /\bsent\b/iu);
  assert.equal(presentApplication({ ...stopped, status: "CANCELED", autopilot: send("CANCELED") }).label, "Canceled");
});

test("a stop without a send request is a writing stop only when no documents exist", () => {
  const writing = presentApplication({ ...stopped, hasDocuments: false, preparationFailureCode: "OPENAI_TIMEOUT" });
  assert.equal(writing.label, "Writing stopped");
  assert.equal(writing.actionLabel, "Try again");
  const profile = presentApplication({ ...stopped, hasDocuments: false, preparationFailureCode: "DRAFTING_CAREER_PROFILE_MISSING" });
  assert.equal(profile.actionLabel, "Open Profile");
  // Documents exist but the send request could not be read here: never guess a writing retry.
  const unread = presentApplication(stopped);
  assert.equal(unread.label, "Stopped");
  assert.equal(unread.actionLabel, undefined);
  assert.equal(unread.needsYou, true);
});

test("an unreadable posting settles when nothing can change and offers a retry only when one can help", () => {
  const closed = presentApplication({ ...stopped, intakeStatus: "FAILED", hasDocuments: false, failureCode: "JOB_NOT_FOUND" });
  assert.equal(closed.label, "Posting closed");
  assert.equal(closed.needsYou, false);
  assert.equal(closed.closed, true);
  const flaky = presentApplication({ ...stopped, intakeStatus: "FAILED", hasDocuments: false, failureCode: "FETCH_FAILED" });
  assert.equal(flaky.label, "Couldn’t read job");
  assert.equal(flaky.needsYou, true);
  assert.equal(flaky.actionLabel, "Try again");
});

test("an unsupported board and a profile gap say what to open", () => {
  assert.equal(presentApplication({ ...ready, sendIntent: "NOT_DELIVERABLE" }).actionLabel, "Open");
  assert.equal(presentApplication({ ...ready, status: "NEEDS_USER" }).actionLabel, "See what’s missing");
});
