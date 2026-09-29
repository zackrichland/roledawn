import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260819052544_refresh_stale_application_packet.sql",
  import.meta.url,
);

test("fill authorization rejects a revision bound to an older candidate input epoch", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /before insert on public\.approval_challenges/iu);
  assert.match(sql, /revision\.input_snapshot_id/iu);
  assert.match(
    sql,
    /v_snapshot_candidate_input_version\s+<>\s+v_current_candidate_input_version/iu,
  );
  assert.match(sql, /APPLICATION_FILL_INPUTS_STALE/iu);
  assert.match(sql, /using errcode = 'PT409'/iu);
});

test("the candidate refresh command is owned, replay-safe, and queues preparation only", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /create function public\.refresh_stale_application_packet/iu);
  assert.match(sql, /v_actor uuid := auth\.uid\(\)/iu);
  assert.match(sql, /candidate\.auth_user_id = v_actor/iu);
  assert.match(sql, /membership\.auth_user_id = v_actor/iu);
  assert.match(sql, /workspace\.status = 'ACTIVE'/iu);
  assert.match(sql, /REFRESH_STALE_APPLICATION_PACKET/iu);
  assert.match(sql, /APPLICATION_PACKET_INPUTS_UNCHANGED/iu);
  assert.match(sql, /status not in \('READY', 'NEEDS_USER', 'FAILED_SAFE'\)/iu);
  assert.match(sql, /run\.status in \('QUEUED', 'RUNNING'\)/iu);
  assert.match(sql, /run\.preparation_stage is distinct from 'BLOCKED'/iu);
  assert.match(sql, /fill\.status in \('QUEUED', 'STARTED'\)/iu);
  assert.match(sql, /APPLICATION_FILL_ALREADY_ACTIVE/iu);
  assert.match(sql, /'application\.files_refresh_queued'/iu);
  assert.match(sql, /'application\.preparation_requested'/iu);
  assert.match(sql, /result_event_id = v_event_id/iu);
  assert.match(sql, /aggregate_version = v_new_aggregate/iu);
  assert.match(sql, /to authenticated, service_role/iu);
  assert.doesNotMatch(sql, /SUBMIT_APPLICATION_ONCE/iu);
});

test("replacement keeps immutable history and swaps the current revision in one transaction", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /commit_application_kit_single_revision_v1/iu);
  assert.match(sql, /for update of application/iu);
  assert.match(
    sql,
    /v_replacement_snapshot\.candidate_input_version\s+<=\s+v_current_snapshot\.candidate_input_version/iu,
  );
  assert.match(
    sql,
    /v_replacement_snapshot\.candidate_input_version\s+<>\s+v_candidate\.application_input_version/iu,
  );
  assert.match(sql, /set current_revision_id = null/iu);
  assert.match(sql, /private\.commit_application_kit_single_revision_v1/iu);
  assert.doesNotMatch(sql, /delete from public\.application_revisions/iu);
  assert.doesNotMatch(sql, /delete from public\.artifact_versions/iu);
});
