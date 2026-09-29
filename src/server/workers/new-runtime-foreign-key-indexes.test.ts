import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260819063000_cover_new_runtime_foreign_keys.sql",
    import.meta.url,
  ),
  "utf8",
);

test("covers the new takeover and application-schema composite foreign keys", () => {
  assert.match(
    sql,
    /application_fill_resume_attempts_fill_binding_idx[\s\S]*\(\s*workspace_id, candidate_id, application_id, fill_attempt_id\s*\)/u,
  );
  assert.match(
    sql,
    /job_application_schema_versions_job_version_binding_idx[\s\S]*\(job_id, job_version_id\)/u,
  );
});
