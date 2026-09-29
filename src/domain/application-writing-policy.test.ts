import assert from "node:assert/strict";
import test from "node:test";

import { APPLICATION_WRITING_POLICY_RELEASE } from "./application-input-snapshot.ts";
import { ROLEDAWN_APPLICATION_WRITING_POLICY } from "./application-writing-policy.ts";

test("promotes one immutable writing policy matching the input-snapshot release", () => {
  assert.equal(
    ROLEDAWN_APPLICATION_WRITING_POLICY.policyRelease,
    APPLICATION_WRITING_POLICY_RELEASE,
  );
  assert.equal(Object.isFrozen(ROLEDAWN_APPLICATION_WRITING_POLICY), true);
  assert.equal(Object.isFrozen(ROLEDAWN_APPLICATION_WRITING_POLICY.prohibitedPhrases), true);
  assert.equal(ROLEDAWN_APPLICATION_WRITING_POLICY.maxResumeWords > 0, true);
  assert.equal(ROLEDAWN_APPLICATION_WRITING_POLICY.minCoverLetterWords > 0, true);
  assert.equal(ROLEDAWN_APPLICATION_WRITING_POLICY.maxCoverLetterWords > 0, true);
  assert.equal(
    ROLEDAWN_APPLICATION_WRITING_POLICY.minCoverLetterWords <
      ROLEDAWN_APPLICATION_WRITING_POLICY.maxCoverLetterWords,
    true,
  );
  assert.equal(
    ROLEDAWN_APPLICATION_WRITING_POLICY.minCoverLetterParagraphs <=
      ROLEDAWN_APPLICATION_WRITING_POLICY.maxCoverLetterParagraphs,
    true,
  );
  assert.equal(ROLEDAWN_APPLICATION_WRITING_POLICY.minCandidateEvidenceClaimsInCoverLetter, 1);
  assert.equal(ROLEDAWN_APPLICATION_WRITING_POLICY.minRoleContextClaimsInCoverLetter, 1);
  assert.equal(ROLEDAWN_APPLICATION_WRITING_POLICY.minCandidateEvidenceClaimsInTailoredResume, 1);
  assert.equal(
    new Set(ROLEDAWN_APPLICATION_WRITING_POLICY.prohibitedPhrases).size,
    ROLEDAWN_APPLICATION_WRITING_POLICY.prohibitedPhrases.length,
  );
});
