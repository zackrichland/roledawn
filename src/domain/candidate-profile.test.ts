import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateFactDefinition,
  CANDIDATE_FACT_DEFINITIONS,
  isCandidateFactKey,
} from "./candidate-profile.ts";

test("candidate fact keys are unique and mapped to fixed server-owned policy", () => {
  const keys = CANDIDATE_FACT_DEFINITIONS.map((definition) => definition.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(candidateFactDefinition("identity.given_name").usagePolicy, "EXACT_FIELDS");
  assert.equal(candidateFactDefinition("identity.family_name").sensitivity, "STANDARD");
  assert.equal(candidateFactDefinition("work_authorization.us.authorized").sensitivity, "SENSITIVE");
  assert.equal(candidateFactDefinition("contact.application_email").usagePolicy, "EXACT_FIELDS");
});

test("unknown fact keys are rejected", () => {
  assert.equal(isCandidateFactKey("contact.application_email"), true);
  assert.equal(isCandidateFactKey("demographics.race_ethnicity"), false);
  assert.equal(isCandidateFactKey("contact.street_address"), false);
});
