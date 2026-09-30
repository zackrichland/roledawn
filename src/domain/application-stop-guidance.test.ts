import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { APPLICATION_AUTOPILOT_STATUSES } from "./application-autopilot.ts";
import {
  AUTOMATIC_RETRY_CODES, AUTOMATIC_RETRY_LIMIT, RECONCILE_LIMIT, deliveryStopGroup, deliveryStopRetryClass, guideIntakeFailure,
  guideProfileInput, guideSend, guideSendNotDeliverable, guideWritingFailure, homeActionLabel, intakeRetryClass, writingRetryClass,
  type DeliveryStopGroup, type StopGuidance,
} from "./application-stop-guidance.ts";

/** Every failure code the delivery worker can record on a stopped send, grouped by what it means. */
const CATALOGUE: Readonly<Record<DeliveryStopGroup, readonly string[]>> = {
  TEMPORARY: [
    "OPENAI_AGENTS_ABORTED", "OPENAI_AGENTS_NETWORK_ERROR", "OPENAI_AGENTS_HTTP_ERROR", "AGENTS_FILL_CANCELLED",
    "DELIVERY_BROWSER_CONCURRENCY_LIMIT", "APPLICATION_DELIVERY_FAILED", "OPENAI_AGENTS_INVALID_RESPONSE",
    "OPENAI_AGENTS_UNSUPPORTED_ACTION", "DELIVERY_RUNTIME_EXPIRED", "DELIVERY_RUNTIME_PROVIDER_FAILED",
    "BROWSERBASE_SESSION_NOT_CONNECTABLE", "DELIVERY_BROWSER_ACTION_FAILED", "DELIVERY_AGENT_TURN_INCOMPLETE",
  ],
  SERVICE_CREDITS: ["MODEL_CREDITS_EXHAUSTED"],
  CAPACITY: ["DELIVERY_BROWSER_QUOTA_EXHAUSTED"],
  UNSUPPORTED_SITE: ["DELIVERY_SITE_UNSUPPORTED", "APPLICATION_AUTOPILOT_DESTINATION_UNSUPPORTED"],
  HUMAN_CHECK: ["APPLICATION_FILL_CAPTCHA_TAKEOVER"],
  FORM_REJECTED: ["DELIVERY_FORM_VALIDATION_OR_CAPTCHA"],
  SIGN_IN: ["APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER", "APPLICATION_FILL_OTP_MFA_TAKEOVER"],
  UNSUPPORTED_FIELD: [
    "DELIVERY_REQUIRED_CONTROL_UNSUPPORTED", "DELIVERY_STEP_UNSUPPORTED_OR_LOOP", "DELIVERY_STEP_LIMIT", "DELIVERY_FINAL_CONTROL_UNSUPPORTED",
    "DELIVERY_PRIOR_STEP_REVIEW_REQUIRED", "DELIVERY_SUBMIT_POLICY_REQUIRED", "AGENTS_FILL_CROSS_ORIGIN_FRAME_TAKEOVER",
    "APPLICATION_FILL_UNKNOWN_REQUIRED_FIELD_TAKEOVER", "APPLICATION_FILL_SENSITIVE_LEGAL_TAKEOVER", "AGENTS_FILL_CONTROL_UNSUPPORTED",
  ],
  ANSWER_REJECTED: ["DELIVERY_ANSWER_NOT_ACCEPTED_BY_FORM"],
  CODE_NOT_ACCEPTED: ["DELIVERY_EMAIL_VERIFICATION_TIMEOUT", "DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED"],
  FORM_CHECK: [
    "DELIVERY_EXECUTION_FAILED", "AGENTS_FILL_FIELD_DRIFT", "AGENTS_FILL_READBACK_MISMATCH", "DELIVERY_FINAL_REVIEW_DRIFT",
    "DELIVERY_FINAL_SAVED_FIELD_DRIFT", "DELIVERY_FORM_CONTRACT_DRIFT", "DELIVERY_ASHBY_REQUEST_ENVELOPE_INVALID", "DELIVERY_ASHBY_RESPONSE_REJECTED",
    "AGENTS_FILL_OPTION_AMBIGUOUS", "DELIVERY_UPLOAD_NOT_ACKNOWLEDGED", "DELIVERY_ACTION_LIMIT",
  ],
  UNKNOWN: ["SOMETHING_ELSE_ENTIRELY", "MAILBOX_TOKEN_REVOKED"],
};
const ALL_CODES = Object.values(CATALOGUE).flat();
const INTAKE_CODES = ["ATS_UNSUPPORTED", "JOB_URL_SHAPE_UNSUPPORTED", "JOB_NOT_FOUND", "BODY_TOO_LARGE", "PAYLOAD_INVALID", "FETCH_FAILED", "HTTP_ERROR", "JSON_INVALID", "NEW_CODE", null];
const WRITING_CODES = ["DRAFTING_CAREER_PROFILE_MISSING", "LETTER_CLAIM_UNVERIFIED", "APPLICATION_KIT_NAME_REQUIRED", "APPLICATION_WRITING_FAILED", "APPLICATION_DRAFTING_FAILED", "OPENAI_TIMEOUT", "MODEL_UNAVAILABLE", "WORKER_UNEXPECTED_FAILURE", null];

function everyGuidance(): readonly StopGuidance[] {
  const found: StopGuidance[] = [];
  for (const status of APPLICATION_AUTOPILOT_STATUSES) {
    for (const provider of [null, "ASHBY"] as const) {
      found.push(guideSend({ status, provider }), guideSend({ status, provider, questionCount: 3, transientRetries: 1, reconcileCount: 3, verificationRecipient: "z***@example.test" }));
      for (const code of ALL_CODES) {
        found.push(guideSend({ status, failureCode: code, provider }), guideSend({ status, failureCode: code, provider, transientRetries: 2, expired: true }),
          guideSend({ status, failureCode: code, provider, profileChanged: true }));
      }
    }
  }
  for (const code of INTAKE_CODES) found.push(guideIntakeFailure(code));
  for (const code of WRITING_CODES) found.push(guideWritingFailure({ code }), guideWritingFailure({ code, profileChanged: true }));
  found.push(guideSendNotDeliverable(), guideProfileInput());
  return found;
}

test("every failure code lands in the group its meaning says, and unknown codes never guess a cause", () => {
  for (const [group, codes] of Object.entries(CATALOGUE)) {
    for (const code of codes) assert.equal(deliveryStopGroup(code), group, code);
  }
  assert.equal(deliveryStopGroup(null), "UNKNOWN");
  assert.equal(deliveryStopGroup(""), "UNKNOWN");
});

test("a stopped send offers Try again only when trying again can help, and always names one primary action", () => {
  for (const code of ALL_CODES) {
    const guidance = guideSend({ status: "FAILED_SAFE", failureCode: code });
    const group = deliveryStopGroup(code);
    const offers = [guidance.primary, guidance.secondary].filter((item) => item?.kind === "TRY_AGAIN").length;
    assert.notEqual(guidance.primary.kind, "NONE", code);
    assert.equal(guidance.needsYou, true, code);
    assert.equal(guidance.retry, deliveryStopRetryClass(code), code);
    assert.equal(guidance.canCancel, false, code);
    if (guidance.retry === "MANUAL") assert.equal(guidance.primary.kind, "TRY_AGAIN", code);
    // Browser time running out is the one outside cause that clears on its own side: a retry is offered, but never first.
    else if (group === "SERVICE_CREDITS") { assert.equal(guidance.primary.kind, "TRY_AGAIN"); assert.match(guidance.next, /Add credits/u); }
    else if (group === "CAPACITY") { assert.equal(guidance.primary.kind, "EMPLOYER_PAGE"); assert.equal(guidance.secondary?.kind, "TRY_AGAIN"); }
    else { assert.equal(offers, 0, `${code} must not offer Try again`); assert.equal(guidance.primary.kind, "EMPLOYER_PAGE", code); }
  }
});

test("codes the database retries by itself match the migration that does it", () => {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const latest = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => readFileSync(new URL(name, directory), "utf8")).filter((text) => /function public\.finish_application_autopilot/u.test(text)).at(-1);
  assert.ok(latest, "finish_application_autopilot is defined by a migration");
  const list = /p_failure_code in \(([^)]+)\)/u.exec(latest)?.[1];
  assert.ok(list);
  const sql = [...list.matchAll(/'([A-Z_]+)'/gu)].map((match) => match[1]).sort();
  assert.deepEqual([...AUTOMATIC_RETRY_CODES].sort(), sql);
  assert.match(latest, new RegExp(`transient_retries<${AUTOMATIC_RETRY_LIMIT}\\b`, "u"));
});

test("an automatic retry in flight is not a stop, and says how many tries remain", () => {
  const retrying = guideSend({ status: "QUEUED", transientRetries: 1 });
  assert.equal(retrying.label, "Trying again");
  assert.equal(retrying.retry, "AUTOMATIC");
  assert.equal(retrying.needsYou, false);
  assert.equal(retrying.primary.kind, "NONE");
  assert.match(retrying.happened, /try 2 of 3/u);
  assert.match(guideSend({ status: "RUNNING", transientRetries: 2 }).happened, /try 3 of 3/u);
  assert.equal(guideSend({ status: "QUEUED", transientRetries: 0 }).label, "Queued to apply");
  // After its automatic tries a temporary stop says so, and Try again is the next step.
  const exhausted = guideSend({ status: "FAILED_SAFE", failureCode: "OPENAI_AGENTS_ABORTED", transientRetries: 2 });
  assert.match(exhausted.happened, /already tried again on its own/u);
  assert.equal(exhausted.primary.kind, "TRY_AGAIN");
  assert.doesNotMatch(guideSend({ status: "FAILED_SAFE", failureCode: "DELIVERY_EXECUTION_FAILED", transientRetries: 2 }).happened, /on its own/u);
});

test("an unknown outcome is never retried and never described as refused, sent or safe to repeat", () => {
  for (const status of ["UNCERTAIN", "RECONCILING"] as const) {
    for (const reconcileCount of [0, RECONCILE_LIMIT]) {
      const guidance = guideSend({ status, reconcileCount, failureCode: "DELIVERY_RECEIPT_UNVERIFIED" });
      assert.equal(guidance.retry, "NEVER");
      assert.equal(guidance.primary.kind, "NONE");
      assert.equal(guidance.secondary, null);
      assert.equal(guidance.canCancel, false);
      assert.match(`${guidance.happened} ${guidance.next}`, /isn’t confirmed|hasn’t been found/u);
      assert.match(guidance.next, /appl(?:y|ying) again/u);
      assert.doesNotMatch(`${guidance.happened} ${guidance.next}`, /didn.t accept|refus|nothing was (?:sent|submitted)|wasn.t submitted/iu);
    }
  }
  assert.equal(guideSend({ status: "UNCERTAIN", reconcileCount: RECONCILE_LIMIT }).label, "Not confirmed yet");
  assert.equal(guideSend({ status: "UNCERTAIN", reconcileCount: 1 }).label, "Confirming");
  // The employer's confirmation is the only thing that says applied.
  for (const guidance of everyGuidance()) {
    if (guidance.label === "Applied") assert.equal(guidance.tone, "done");
    else assert.doesNotMatch(`${guidance.happened} ${guidance.next}`, /\b(?:you(?:’ve| have) applied|application was received|employer confirmed)\b/iu, guidance.label);
  }
});

test("no state claims something was sent, applied or received unless the employer confirmed it", () => {
  for (const guidance of everyGuidance()) {
    if (guidance.label === "Applied") continue;
    assert.doesNotMatch(`${guidance.happened} ${guidance.next}`, /(?<!nothing )(?<!not )(?<!n’t )\b(?:was|were|has been|have been|got) (?:sent|applied|received|delivered)\b/iu, `${guidance.label}: ${guidance.happened}`);
  }
});

test("copy has no codes, engineering talk or blame", () => {
  const banned = /[A-Z]{3,}_[A-Z_]{2,}|\b(?:browser|browserbase|worker|lease|checkpoint|readback|fingerprint|selector|iframe|http|api|timeout|timed out|drift|openai|gpt|model|captcha|error code|exception|stack)\b|\byou (?:failed|forgot|should have|did something wrong)\b/iu;
  for (const guidance of everyGuidance()) {
    for (const text of [guidance.label, guidance.heading, guidance.happened, guidance.next, guidance.primary.label, guidance.secondary?.label ?? ""]) {
      assert.doesNotMatch(text, banned, text);
    }
    // The code stays out of primary copy; it may only ride along in the details.
    if (guidance.code) for (const text of [guidance.label, guidance.heading, guidance.happened, guidance.next]) assert.ok(!text.includes(guidance.code), text);
    assert.ok(guidance.label.length > 0 && guidance.happened.length > 0 && guidance.next.length > 0);
  }
});

test("a stop names exactly one primary action and at most one secondary", () => {
  for (const guidance of everyGuidance()) {
    assert.ok(guidance.primary, guidance.label);
    if (guidance.needsYou) assert.notEqual(guidance.primary.kind, "NONE", `${guidance.label} needs you but offers nothing`);
    if (guidance.secondary) {
      assert.notEqual(guidance.secondary.kind, "NONE");
      assert.notEqual(guidance.secondary.kind, guidance.primary.kind, `${guidance.label} repeats its own action`);
    }
    if (guidance.retry === "NEVER") assert.equal(guidance.primary.kind, "NONE");
  }
});

test("Try again is withheld when the database would refuse it, and the way forward is named", () => {
  const expired = guideSend({ status: "FAILED_SAFE", failureCode: "OPENAI_AGENTS_ABORTED", transientRetries: 2, expired: true });
  assert.equal(expired.primary.kind, "EMPLOYER_PAGE");
  assert.equal(expired.secondary, null);
  assert.equal(expired.retry, "AFTER_CHANGE");
  assert.match(expired.next, /expired after 7 days/u);
  const stale = guideSend({ status: "FAILED_SAFE", failureCode: "DELIVERY_EXECUTION_FAILED", profileChanged: true });
  assert.equal(stale.primary.kind, "REFRESH_FILES");
  assert.equal(stale.secondary?.kind, "EMPLOYER_PAGE");
  assert.match(stale.next, /rewrite them before it can try again/u);
  // A stop with no retry to withhold is unchanged.
  assert.equal(guideSend({ status: "FAILED_SAFE", failureCode: "APPLICATION_FILL_CAPTCHA_TAKEOVER", profileChanged: true }).primary.kind, "EMPLOYER_PAGE");
});

test("a visible challenge always goes to the candidate and is never retried", () => {
  const guidance = guideSend({ status: "FAILED_SAFE", failureCode: "APPLICATION_FILL_CAPTCHA_TAKEOVER" });
  assert.equal(guidance.retry, "AFTER_CHANGE");
  assert.equal(guidance.primary.kind, "EMPLOYER_PAGE");
  assert.equal(guidance.secondary, null);
  assert.match(guidance.happened, /only you can complete/u);
  assert.match(guidance.happened, /doesn’t try to get past/u);
});

test("an Ashby stop mentions the employer's saved draft; other boards do not", () => {
  for (const code of ALL_CODES) {
    assert.match(guideSend({ status: "FAILED_SAFE", failureCode: code, provider: "ASHBY" }).happened, /may keep a saved draft/u, code);
    assert.doesNotMatch(guideSend({ status: "FAILED_SAFE", failureCode: code, provider: "GREENHOUSE" }).happened, /saved draft/u, code);
  }
  assert.doesNotMatch(guideSend({ status: "FAILED_SAFE", failureCode: "DELIVERY_ASHBY_REQUEST_ENVELOPE_INVALID", provider: "ASHBY" }).happened, /nothing was sent|no data|no draft/iu);
});

test("needs-you states each name their action", () => {
  const answers = guideSend({ status: "WAITING_ANSWERS", questionCount: 2 });
  assert.equal(answers.label, "Answer 2 questions");
  assert.equal(answers.primary.kind, "ANSWER");
  assert.equal(homeActionLabel(answers.primary), "Answer");
  assert.equal(guideSend({ status: "WAITING_ANSWERS", questionCount: 1 }).label, "Answer 1 question");
  const code = guideSend({ status: "SUBMITTING", verificationRecipient: "z***@example.test" });
  assert.equal(code.label, "Enter code");
  assert.equal(code.primary.kind, "CODE");
  assert.match(code.happened, /z\*\*\*@example\.test/u);
  assert.match(guideSend({ status: "SUBMITTING", verificationRecipient: "z***@example.test", verificationRetry: true }).happened, /newest code/u);
  assert.equal(guideSend({ status: "SUBMITTING" }).needsYou, false);
  const paused = guideSend({ status: "PAUSED" });
  assert.equal(paused.primary.kind, "RESUME");
  assert.equal(paused.canCancel, true);
  assert.equal(guideSend({ status: "RUNNING" }).secondary?.kind, "PAUSE");
  assert.equal(guideSend({ status: "CONFIRMED" }).tone, "done");
});

test("unreadable postings are retried only when the failure was a bad moment", () => {
  const offersTryAgain = (code: string | null) => [guideIntakeFailure(code).primary, guideIntakeFailure(code).secondary].some((item) => item?.kind === "TRY_AGAIN");
  for (const code of ["FETCH_FAILED", "HTTP_ERROR", "JSON_INVALID", "NEW_CODE", null]) {
    assert.equal(offersTryAgain(code), true, String(code));
    assert.equal(intakeRetryClass(code), "MANUAL");
    assert.equal(guideIntakeFailure(code).needsYou, true);
  }
  for (const code of ["ATS_UNSUPPORTED", "JOB_URL_SHAPE_UNSUPPORTED", "JOB_NOT_FOUND", "BODY_TOO_LARGE", "PAYLOAD_INVALID"]) {
    assert.equal(offersTryAgain(code), false, code);
    assert.equal(intakeRetryClass(code), "AFTER_CHANGE");
  }
  // Nothing the candidate can do about a closed posting or an unsupported board: the row settles instead of nagging.
  for (const code of ["JOB_NOT_FOUND", "ATS_UNSUPPORTED", "JOB_URL_SHAPE_UNSUPPORTED"]) {
    assert.equal(guideIntakeFailure(code).needsYou, false, code);
    assert.equal(guideIntakeFailure(code).closed, true, code);
  }
  assert.equal(guideIntakeFailure("JOB_NOT_FOUND").label, "Posting closed");
});

test("writing stops send the candidate to Profile when only a profile change helps, and retry when it can", () => {
  for (const code of ["DRAFTING_CAREER_PROFILE_MISSING", "LETTER_CLAIM_UNVERIFIED", "APPLICATION_KIT_NAME_REQUIRED"]) {
    const guidance = guideWritingFailure({ code });
    assert.equal(writingRetryClass(code), "AFTER_CHANGE");
    assert.equal(guidance.primary.kind, "OPEN_PROFILE");
    assert.match(guidance.primary.href ?? "", /^\/vault\//u);
    assert.equal([guidance.primary, guidance.secondary].some((item) => item?.kind === "TRY_AGAIN"), false, code);
    // Once the profile changed, a rewrite is the action.
    assert.equal(guideWritingFailure({ code, profileChanged: true }).primary.kind, "REFRESH_FILES");
  }
  for (const code of ["APPLICATION_WRITING_FAILED", "APPLICATION_DRAFTING_FAILED", "OPENAI_TIMEOUT", "MODEL_UNAVAILABLE", "WORKER_UNEXPECTED_FAILURE", null]) {
    assert.equal(writingRetryClass(code), "MANUAL", String(code));
    assert.equal(guideWritingFailure({ code }).primary.kind, "TRY_AGAIN", String(code));
  }
});

test("a send request that closed for an unsupported board and a profile gap each say what to open", () => {
  assert.equal(guideSendNotDeliverable().primary.kind, "OPEN_APPLICATION");
  assert.equal(guideSendNotDeliverable().needsYou, true);
  assert.equal(guideProfileInput().primary.kind, "OPEN_APPLICATION");
  assert.equal(homeActionLabel({ kind: "NONE", label: "" }), null);
});


test("credit exhaustion explains the account change required instead of reporting a busy service", () => {
  assert.equal(deliveryStopGroup("MODEL_CREDITS_EXHAUSTED"), "SERVICE_CREDITS");
  assert.equal(guideWritingFailure({ code: "MODEL_CREDITS_EXHAUSTED" }).retry, "AFTER_CHANGE");
  assert.match(guideWritingFailure({ code: "MODEL_CREDITS_EXHAUSTED" }).happened, /credits/u);
});
