import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260817050040_cover_remaining_candidate_evidence_foreign_keys.sql",
    import.meta.url,
  ),
  "utf8",
);

test("covers every remaining candidate-evidence and resume foreign-key path", () => {
  const expectedIndexes = [
    /candidate_evidence_citations_evidence_version_fk_idx[\s\S]*\(workspace_id, candidate_id, document_id, evidence_version_id\)/,
    /candidate_evidence_citations_passage_fk_idx[\s\S]*\(workspace_id, candidate_id, document_id, passage_id\)/,
    /candidate_evidence_items_current_version_fk_idx[\s\S]*\(id, current_version_number\)[\s\S]*where current_version_number is not null/,
    /candidate_evidence_items_primary_passage_fk_idx[\s\S]*\(workspace_id, candidate_id, document_id, primary_source_passage_id\)/,
    /candidate_evidence_versions_item_context_fk_idx[\s\S]*\(workspace_id, candidate_id, document_id, evidence_item_id\)/,
    /candidate_fact_versions_reviewer_fk_idx[\s\S]*\(reviewed_by\)[\s\S]*where reviewed_by is not null/,
    /candidate_facts_current_version_fk_idx[\s\S]*\(id, current_version_number\)[\s\S]*where current_version_number is not null/,
    /source_document_upload_reservations_document_fk_idx[\s\S]*\(workspace_id, candidate_id, document_id\)/,
    /source_evidence_passages_review_context_fk_idx[\s\S]*\(workspace_id, candidate_id, document_id, document_version_id, text_review_id\)/,
  ];

  for (const pattern of expectedIndexes) {
    assert.match(migration, pattern);
  }

  assert.equal(migration.match(/^create index /gmu)?.length, expectedIndexes.length);
  assert.doesNotMatch(
    migration,
    /candidate_evidence_citations\s*\(workspace_id\)\s*;/,
    "the tenant-leading composite indexes already cover the workspace foreign key",
  );
});
