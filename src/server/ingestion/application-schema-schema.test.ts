import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260819061712_greenhouse_application_schema_versions.sql",
  import.meta.url,
);

test("application schemas are append-only, job-version-bound, and unavailable to candidate clients", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /create table public\.job_application_schema_versions/u);
  assert.match(
    sql,
    /foreign key \(job_id, job_version_id\)[\s\S]*references public\.job_versions\(job_id, id\)/u,
  );
  assert.match(sql, /unique \(job_version_id, schema_hash\)/u);
  assert.match(sql, /schema_hash ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(sql, /jsonb_typeof\(normalized_schema\) = 'object'/u);
  assert.match(sql, /jsonb_typeof\(provider_binding\) = 'object'/u);
  assert.match(
    sql,
    /job_application_schema_versions_immutable[\s\S]*private\.reject_row_mutation\(\)/u,
  );
  assert.match(sql, /alter table public\.job_application_schema_versions enable row level security/u);
  assert.match(
    sql,
    /revoke all on public\.job_application_schema_versions[\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    sql,
    /grant select, insert on public\.job_application_schema_versions[\s\S]*to service_role/u,
  );
  assert.doesNotMatch(sql, /create policy/u);
});
