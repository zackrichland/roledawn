import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260819033000_candidate_browser_live_view_binding.sql",
  import.meta.url,
);

test("live-view provider binding stays service-only and limited to unexpired live sessions", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /current_user\s*<>\s*'service_role'/u);
  assert.match(sql, /session\.state in \('ACTIVE', 'PAUSED_FOR_REVIEW'\)/u);
  assert.match(sql, /session\.expires_at > statement_timestamp\(\)/u);
  assert.match(
    sql,
    /revoke all on function public\.get_active_computer_session_provider_binding\(uuid\)[\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    sql,
    /grant execute on function public\.get_active_computer_session_provider_binding\(uuid\)[\s\S]*to service_role/u,
  );
});
