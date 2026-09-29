import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260819061711_resume_takeover_application_fill.sql",
  import.meta.url,
);

test("candidate continuation is owned, confirmed, replay-safe, and session bound", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /candidate\.auth_user_id = v_actor/u);
  assert.match(sql, /membership\.auth_user_id = v_actor/u);
  assert.match(sql, /p_candidate_completed_required_fields is distinct from true/u);
  assert.match(sql, /v_application\.status <> 'TAKEOVER'/u);
  assert.match(sql, /v_fill\.status <> 'TAKEOVER'/u);
  assert.match(sql, /v_session\.state <> 'PAUSED_FOR_REVIEW'/u);
  assert.match(sql, /v_session\.expires_at <= statement_timestamp\(\)/u);
  assert.match(sql, /v_fill\.approval_action <> 'FILL_APPLICATION_ONCE'/u);
  assert.match(sql, /v_fill\.authority_scope <> 'FILL_ONLY_NO_SUBMIT'/u);
  assert.match(sql, /command_type <> 'REQUEST_APPLICATION_FILL_RESUME'/u);
  assert.match(sql, /'application\.browser_fill_resume_requested'/u);
  assert.match(
    sql,
    /create index application_fill_resume_attempts_session_binding_idx\s+on public\.application_fill_resume_attempts \(\s*computer_session_id, fill_attempt_id/u,
  );
  assert.match(sql, /candidate\.auth_user_id = \(select auth\.uid\(\)\)/u);
});

test("continuation completion is leased, same-authority, and still cannot submit", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /current_user <> 'service_role'/u);
  assert.match(sql, /v_outbox\.lease_owner is distinct from v_worker_id/u);
  assert.match(sql, /v_outbox\.lease_expires_at <= statement_timestamp\(\)/u);
  assert.match(sql, /v_outbox\.payload ->> 'fill_attempt_id' <> v_fill\.id::text/u);
  assert.match(sql, /v_outbox\.payload ->> 'computer_session_id' <> v_session\.id::text/u);
  assert.match(sql, /v_outbox\.payload ->> 'authority_hash' <> v_fill\.authority_hash/u);
  assert.match(
    sql,
    /v_outbox\.payload ->> 'disclosure_manifest_hash'\s+<> v_fill\.disclosure_manifest_hash/u,
  );
  assert.match(sql, /p_redacted_summary ->> 'submission_request_count' is distinct from '0'/u);
  assert.match(sql, /p_redacted_summary ->> 'application_submitted' is distinct from 'false'/u);
  assert.match(sql, /from public\.application_attempts as submit_attempt/u);
  assert.match(sql, /from public\.receipts as receipt/u);
  assert.match(sql, /old\.status = 'TAKEOVER' and new\.status = 'FILLED_TO_REVIEW'/u);
  assert.doesNotMatch(sql, /SUBMIT_APPLICATION_ONCE/u);
  assert.doesNotMatch(sql, /insert into public\.receipts/u);
  assert.match(
    sql,
    /revoke all on function public\.complete_application_fill_resume[\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    sql,
    /grant execute on function public\.complete_application_fill_resume[\s\S]*to service_role/u,
  );
});
