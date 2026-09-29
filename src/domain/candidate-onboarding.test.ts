import assert from "node:assert/strict";

test("location preferences preserve city and state on one line", () => {
  assert.deepEqual(parseCandidatePreferenceList("Washington, DC\nNew York, NY\n Washington, DC", { maxItems: 12, splitCommas: false }), ["Washington, DC", "New York, NY"]);
});
import test from "node:test";

import {
  firstIncompleteOnboardingStep,
  isOnboardingMissingItemCode,
  isOnboardingReadinessResponseCode,
  onboardingProgress,
  parseCandidatePreferenceList,
} from "./candidate-onboarding.ts";

test("preference lists are trimmed, deduplicated, and bounded", () => {
  assert.deepEqual(
    parseCandidatePreferenceList("Solutions Engineer, Product Manager\n solutions engineer ", { maxItems: 8 }),
    ["Solutions Engineer", "Product Manager"],
  );
  assert.throws(
    () => parseCandidatePreferenceList("one,two,three", { maxItems: 2 }),
    /CANDIDATE_SEARCH_PROFILE_TOO_MANY_ITEMS/u,
  );
});

test("the first incomplete step follows the candidate setup dependency order", () => {
  assert.equal(firstIncompleteOnboardingStep(["RESUME", "SEARCH_RULES"]), "resume");
  assert.equal(firstIncompleteOnboardingStep(["SEARCH_RULES", "PHONE"]), "goals");
  assert.equal(firstIncompleteOnboardingStep(["GIVEN_NAME", "FAMILY_NAME"]), "answers");
  assert.equal(firstIncompleteOnboardingStep(["PHONE"]), "answers");
  assert.equal(firstIncompleteOnboardingStep([]), "finish");
  assert.equal(onboardingProgress([]), 100);
});

test("legacy eligibility flags remain wire-compatible without becoming global setup blockers", () => {
  assert.equal(isOnboardingReadinessResponseCode("US_WORK_ELIGIBILITY"), true);
  assert.equal(isOnboardingReadinessResponseCode("CA_WORK_ELIGIBILITY"), true);
  assert.equal(isOnboardingMissingItemCode("US_WORK_ELIGIBILITY"), false);
  assert.equal(isOnboardingMissingItemCode("CA_WORK_ELIGIBILITY"), false);
  assert.equal(isOnboardingReadinessResponseCode("UNRECOGNIZED_CODE"), false);
});
