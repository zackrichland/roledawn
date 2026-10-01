import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseStop } from "./stop-diagnosis.ts";

test("a blocked third-party frame is named as the likely cause and points at the proposal", () => {
  const result = diagnoseStop({ applicationStatus: "FAILED_SAFE", sendStatus: "FAILED_SAFE", sendFailure: "AGENTS_FILL_CROSS_ORIGIN_FRAME_TAKEOVER",
    diagnosis: { stage: "form", phase: "inspect", frames: { "https://jobs.lever.co/acme/1/apply": 1, "chrome-error://chromewebdata/": 1 } } });
  assert.equal(result.stage, "FORM");
  assert.equal(result.certainty, "likely");
  assert.equal(result.proposal, "P1");
  assert.match(result.cause, /error page/u);
});

test("a form that never rendered names the refused assets", () => {
  const result = diagnoseStop({ applicationStatus: "FAILED_SAFE", sendStatus: "FAILED_SAFE", sendFailure: "DELIVERY_STEP_UNSUPPORTED",
    diagnosis: { stage: "form", phase: "open", blocked: { "unreviewed GET script https://cdn.new-vendor.test/app.js": 3 } } });
  assert.match(result.cause, /cdn\.new-vendor\.test/u);
  assert.equal(result.proposal, "P3");
  const slow = diagnoseStop({ applicationStatus: "FAILED_SAFE", sendStatus: "FAILED_SAFE", sendFailure: "DELIVERY_STEP_UNSUPPORTED", diagnosis: { phase: "open" } });
  assert.equal(slow.proposal, undefined);
  assert.match(slow.cause, /did not appear in time/u);
});

test("startup failures are attributed to the browser stage with a concrete configuration fix", () => {
  const result = diagnoseStop({ applicationStatus: "FAILED_SAFE", sendStatus: "FAILED_SAFE", sendFailure: "BROWSERBASE_PROJECT_SCOPE_INVALID", diagnosis: { stage: "browser-start" } });
  assert.equal(result.stage, "BROWSER_START");
  assert.equal(result.certainty, "confirmed");
  assert.match(result.next, /BROWSERBASE_PROJECT_ID/u);
});

test("Ashby client drift is confirmed from its code", () => {
  const result = diagnoseStop({ applicationStatus: "FAILED_SAFE", sendStatus: "FAILED_SAFE", sendFailure: "DELIVERY_ASHBY_REQUEST_POSTING_ENVELOPE_QUERY_DOCUMENT", diagnosis: { phase: "open" } });
  assert.equal(result.certainty, "confirmed");
  assert.equal(result.proposal, "P5");
});

test("a CAPTCHA stop distinguishes a solver that never engaged from one that ran out of time", () => {
  const never = diagnoseStop({ applicationStatus: "FAILED_SAFE", sendStatus: "FAILED_SAFE", sendFailure: "APPLICATION_FILL_CAPTCHA_TAKEOVER", diagnosis: { solverStarted: 0 } });
  assert.equal(never.proposal, "P4");
  const slow = diagnoseStop({ applicationStatus: "FAILED_SAFE", sendStatus: "FAILED_SAFE", sendFailure: "APPLICATION_FILL_CAPTCHA_TAKEOVER", diagnosis: { solverStarted: 1 } });
  assert.match(slow.cause, /started but did not finish/u);
});

test("earlier stages are attributed before any send exists", () => {
  assert.equal(diagnoseStop({ applicationStatus: "FAILED_SAFE", intakeStatus: "FAILED", intakeFailure: "ATS_UNSUPPORTED" }).stage, "INTAKE");
  assert.equal(diagnoseStop({ applicationStatus: "NEEDS_USER" }).stage, "PREPARATION");
  assert.equal(diagnoseStop({ applicationStatus: "FAILED_SAFE", runStatus: "FAILED", runError: "MODEL_CREDITS_EXHAUSTED" }).stage, "WRITING");
  assert.equal(diagnoseStop({ applicationStatus: "FAILED_SAFE", runStatus: "FAILED", runError: "PREPARATION_JOB_NOT_RESOLVED" }).stage, "PREPARATION");
  assert.equal(diagnoseStop({ applicationStatus: "READY", sendIntentClosedReason: "NOT_DELIVERABLE" }).stage, "SEND_QUEUE");
  assert.match(diagnoseStop({ applicationStatus: "READY", sendIntentOpen: true }).cause, /swallowed/u);
  assert.equal(diagnoseStop({ applicationStatus: "CONFIRMED" }).stage, "DONE");
  assert.equal(diagnoseStop({ applicationStatus: "EXECUTING", sendStatus: "UNCERTAIN", sendFailure: "DELIVERY_RECEIPT_UNVERIFIED" }).stage, "CONFIRMATION");
});
