import assert from "node:assert/strict";
import test from "node:test";

import {
  parseApplicationPreparationPayload,
  selectCurrentApprovedEvidence,
  selectCurrentApprovedFacts,
} from "./application-preparation.ts";

const APPLICATION_ID = "10000000-0000-4000-a000-000000000001";
const RUN_ID = "20000000-0000-4000-a000-000000000002";

test("parses the two stable preparation identifiers and ignores extra payload fields", () => {
  assert.deepEqual(parseApplicationPreparationPayload({
    application_id: APPLICATION_ID,
    preparation_run_id: RUN_ID,
    job_id: "30000000-0000-4000-a000-000000000003",
  }), { application_id: APPLICATION_ID, preparation_run_id: RUN_ID });
  assert.equal(parseApplicationPreparationPayload({ application_id: APPLICATION_ID }), null);
  assert.equal(parseApplicationPreparationPayload({
    application_id: "not-a-uuid",
    preparation_run_id: RUN_ID,
  }), null);
});

test("selects only current, verified, approved narrative evidence from the frozen review", () => {
  const selected = selectCurrentApprovedEvidence([
    { id: "item-current", text_review_id: "review-1", current_version_number: 2, review_status: "VERIFIED" },
    { id: "item-stale-review", text_review_id: "review-0", current_version_number: 1, review_status: "VERIFIED" },
    { id: "item-unreviewed", text_review_id: "review-1", current_version_number: 1, review_status: "NEEDS_REVIEW" },
  ], [
    { id: "old", evidence_item_id: "item-current", document_id: "doc", version_number: 1, claim_sha256: "a".repeat(64), usage_policy: "RESUME_AND_COVER_LETTER", candidate_disposition: "APPROVED" },
    { id: "current", evidence_item_id: "item-current", document_id: "doc", version_number: 2, claim_sha256: "b".repeat(64), usage_policy: "COVER_LETTER_ONLY", candidate_disposition: "APPROVED" },
    { id: "wrong-review", evidence_item_id: "item-stale-review", document_id: "doc", version_number: 1, claim_sha256: "c".repeat(64), usage_policy: "RESUME_AND_COVER_LETTER", candidate_disposition: "APPROVED" },
    { id: "not-reviewed", evidence_item_id: "item-unreviewed", document_id: "doc", version_number: 1, claim_sha256: "d".repeat(64), usage_policy: "RESUME_AND_COVER_LETTER", candidate_disposition: "APPROVED" },
    { id: "restricted", evidence_item_id: "item-current", document_id: "doc", version_number: 2, claim_sha256: "e".repeat(64), usage_policy: "DO_NOT_USE", candidate_disposition: "APPROVED" },
  ], "review-1");

  assert.deepEqual(selected.map((reference) => reference.evidenceVersionId), ["current"]);
});

test("selects only current approved exact-fact versions without copying values", () => {
  const selected = selectCurrentApprovedFacts([
    { id: "fact-1", current_version_number: 2, verification_status: "VERIFIED", usage_policy: "EXACT_FIELDS" },
    { id: "fact-2", current_version_number: 1, verification_status: "NEEDS_REVIEW", usage_policy: "EXACT_FIELDS" },
  ], [
    { id: "old", fact_id: "fact-1", version_number: 1, candidate_disposition: "APPROVED" },
    { id: "current", fact_id: "fact-1", version_number: 2, candidate_disposition: "APPROVED" },
    { id: "unreviewed", fact_id: "fact-2", version_number: 1, candidate_disposition: "APPROVED" },
  ]);

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.factVersionId, "current");
  assert.deepEqual(Object.keys(selected[0] ?? {}), ["factVersionId"]);
});
