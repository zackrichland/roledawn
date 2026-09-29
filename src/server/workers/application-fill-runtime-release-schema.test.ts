import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260819051428_reconcile_retained_browser_runtime_release.sql",
  import.meta.url,
);

test("runtime release reconciliation is service-only, bound, and idempotent", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /current_user <> 'service_role'/u);
  assert.match(
    sql,
    /p_supervisor_release is distinct from\s+'application-fill-runtime-supervisor\/1'/u,
  );
  assert.match(
    sql,
    /session\.id = p_computer_session_id[\s\S]*session\.fill_attempt_id = v_fill\.id/u,
  );
  assert.match(sql, /RUNTIME_RELEASE_REPLAY_MISMATCH/u);
  assert.match(
    sql,
    /create unique index application_fill_checkpoints_one_runtime_release_idx/u,
  );
  assert.match(
    sql,
    /revoke all on function public\.reconcile_application_fill_runtime_release[\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    sql,
    /grant execute on function public\.reconcile_application_fill_runtime_release[\s\S]*to service_role/u,
  );
});

test("runtime release preserves review or takeover and never invents submission proof", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /v_fill\.status = 'FILLED_TO_REVIEW'/u);
  assert.match(sql, /v_expected_application_status := 'PRE_SUBMIT_REVIEW'/u);
  assert.match(sql, /v_expected_application_status := 'TAKEOVER'/u);
  assert.match(sql, /set aggregate_version = v_new_aggregate/u);
  assert.doesNotMatch(sql, /set status = v_expected_application_status/u);
  assert.match(
    sql,
    /p_usage_summary ->> 'submission_request_count' is distinct from '0'/u,
  );
  assert.match(
    sql,
    /when p_release_outcome = 'RELEASED' then to_jsonb\(false\)[\s\S]*else 'null'::jsonb/u,
  );
  assert.match(sql, /application\.fill_review_runtime_release_uncertain/u);
  assert.doesNotMatch(sql, /SUBMIT_APPLICATION_ONCE/u);
  assert.doesNotMatch(sql, /insert into public\.receipts/u);
});
