import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260817044053_harden_resume_candidate_scope.sql",
    import.meta.url,
  ),
  "utf8",
);

test("resume source RLS replaces workspace-member reads with candidate-self reads", () => {
  assert.match(
    migration,
    /drop policy if exists source_documents_member_select on public\.source_documents;/,
  );
  assert.match(
    migration,
    /create policy source_documents_candidate_select[\s\S]*candidate\.auth_user_id = \(select auth\.uid\(\)\)[\s\S]*candidate\.workspace_id = source_documents\.workspace_id/,
  );
  assert.match(
    migration,
    /drop policy if exists document_versions_member_select on public\.source_document_versions;/,
  );
  assert.match(
    migration,
    /create policy source_document_versions_candidate_select[\s\S]*candidate\.auth_user_id = \(select auth\.uid\(\)\)[\s\S]*candidate\.workspace_id = source_document_versions\.workspace_id/,
  );
});

test("resume source RLS preserves authenticated reads and service processing", () => {
  assert.match(
    migration,
    /grant select on public\.source_documents, public\.source_document_versions to authenticated;/,
  );
  assert.match(
    migration,
    /grant all on public\.source_documents, public\.source_document_versions to service_role;/,
  );
});
