import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260817063813_add_application_fill_recovery_lease.sql",
  import.meta.url,
);

test("the fill recovery migration fences workers and never grants submission authority", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /current_user <> 'service_role'/u);
  assert.match(sql, /for update of attempt skip locked/u);
  assert.match(sql, /execution_lease_owner is distinct from v_worker_id/u);
  assert.match(sql, /execution_lease_expires_at <= statement_timestamp\(\)/u);
  assert.match(sql, /v_session\.state = 'PROVISIONING'/u);
  assert.match(sql, /RESUME_IDEMPOTENT_PROVISION/u);
  assert.match(sql, /FAIL_SAFE_DISCLOSURE_POSSIBLE/u);
  assert.match(sql, /FAIL_SAFE_SESSION_EXPIRED/u);
  assert.match(sql, /authority_scope', 'FILL_ONLY_NO_SUBMIT'/u);
  assert.match(sql, /application_submitted', false/u);
  assert.doesNotMatch(sql, /SUBMIT_APPLICATION_ONCE/u);
});

test("the public execution RPCs wrap private unleased primitives", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /set schema private/u);
  assert.match(sql, /activate_leased_computer_session/u);
  assert.match(sql, /complete_leased_application_fill_attempt/u);
  assert.match(sql, /claim_stale_application_fill_attempt/u);
  assert.match(sql, /grant execute[\s\S]*to service_role/u);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/u);
});
