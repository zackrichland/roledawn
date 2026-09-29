import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260819025852_enforce_application_quality_manifest.sql",
  import.meta.url,
);

test("new passed revisions require the versioned quality report at the database boundary", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /before insert on public\.application_revisions/iu);
  assert.match(sql, /application-kit\/2/iu);
  assert.match(sql, /roledawn-writing-policy\/2/iu);
  assert.match(sql, /roledawn-application-quality-evaluator\/1/iu);
  assert.match(sql, /readyForCandidateReview\}'\s+is distinct from 'true'/iu);
  assert.match(sql, /APPLICATION_REVISION_QUALITY_MANIFEST_INVALID/iu);
  assert.match(sql, /revoke all .* from authenticated/iu);
  assert.doesNotMatch(sql, /for each statement/iu);
});
