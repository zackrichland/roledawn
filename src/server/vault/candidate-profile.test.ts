import assert from "node:assert/strict";
import test from "node:test";

import { CandidateProfileError, normalizeCandidateFactValue } from "../../domain/candidate-profile-validation.ts";

test("given and family names stay separate exact candidate-entered facts", () => {
  assert.deepEqual(normalizeCandidateFactValue("identity.given_name", "  Zack  "), {
    value: "Zack",
    normalizedText: "Zack",
  });
  assert.deepEqual(normalizeCandidateFactValue("identity.family_name", "Richland"), {
    value: "Richland",
    normalizedText: "Richland",
  });
  assert.throws(
    () => normalizeCandidateFactValue("identity.given_name", " "),
    (error) => error instanceof CandidateProfileError && error.code === "CANDIDATE_FACT_VALUE_INVALID",
  );
});

test("phone answers normalize to E.164", () => {
  assert.deepEqual(normalizeCandidateFactValue("contact.phone", "+1 (202) 555-0123"), {
    value: "+12025550123",
    normalizedText: "+12025550123",
  });
});

test("LinkedIn answers require a public profile URL", () => {
  assert.throws(
    () => normalizeCandidateFactValue("contact.linkedin_url", "https://example.com/zack"),
    (error) => error instanceof CandidateProfileError && error.code === "CANDIDATE_FACT_LINKEDIN_INVALID",
  );
});

test("work authorization preserves uncertainty instead of guessing", () => {
  assert.deepEqual(normalizeCandidateFactValue("work_authorization.us.authorized", "unsure"), {
    value: "unsure",
    normalizedText: "I'm not sure",
  });
});
