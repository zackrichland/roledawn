#!/usr/bin/env node
// Read-only production status: where every live application is, what the
// background lanes are doing, and what failed recently.
//   npm run ops:status                    one snapshot
//   npm run ops:status -- --watch         refresh every 20 s until Ctrl-C
//   npm run ops:status -- --app <id>      one application's timeline (full id or 8-character prefix)
// Runs one `begin transaction read only; … rollback;` query through the linked
// Supabase CLI. It never selects tokens, codes, or document contents.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SQL = `begin transaction read only;
select json_build_object(
  'now', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  'lanes', (select coalesce(json_agg(json_build_object('lane', lane, 'status', status,
      'finished', to_char(last_finished_at at time zone 'utc', 'MM-DD HH24:MI:SS'), 'error', last_error_code) order by lane), '[]')
    from public.hosted_worker_lanes),
  'applications', (select coalesce(json_agg(x order by x.created desc), '[]') from (
    select to_char(a.created_at at time zone 'utc', 'MM-DD HH24:MI:SS') as created, left(a.id::text, 8) as id, a.status,
      coalesce(v.employer_name, '?') as employer, left(coalesce(v.title, '?'), 40) as role,
      ap.status as send, ap.failure_code as failure, rt.checkpoint->>'stage' as stage,
      (select count(*) from public.application_autopilot_questions q where q.autopilot_id = ap.id and q.status = 'OPEN') as open_questions,
      (select string_agg(c.status || ':' || coalesce(c.source, '?'), ',' order by c.requested_at) from public.application_autopilot_verifications c where c.autopilot_id = ap.id) as codes,
      (select string_agg(t.status, ',' order by t.started_at) from public.application_attempts t where t.application_id = a.id) as attempts,
      exists(select 1 from public.receipts r where r.application_id = a.id) as receipt
    from public.applications a
    left join public.job_versions v on v.id = a.job_version_id
    left join lateral (select * from public.application_autopilots p where p.application_id = a.id order by p.created_at desc limit 1) ap on true
    left join private.application_autopilot_runtime rt on rt.autopilot_id = ap.id
    where a.archived_at is null order by a.created_at desc limit 15) x),
  'failures_24h', (select coalesce(json_agg(json_build_object('failure', failure_code, 'count', n)), '[]') from (
    select failure_code, count(*) n from public.application_autopilots
    where failure_code is not null and updated_at > now() - interval '24 hours' group by failure_code order by n desc) f),
  'recent_failures', (select coalesce(json_agg(e order by e.at desc), '[]') from (
    select to_char(occurred_at at time zone 'utc', 'MM-DD HH24:MI:SS') as at, lane, stage, code,
      left(coalesce(detail->>'message', detail->>'kind', ''), 90) as cause, left(coalesce(application_id::text, ''), 8) as app,
      round(duration_ms / 1000.0) as seconds
    from private.worker_events where outcome = 'FAILED' and occurred_at > now() - interval '24 hours'
    order by occurred_at desc limit 12) e),
  'pending_outbox', (select count(*) from public.outbox where published_at is null),
  'oldest_pending_outbox_minutes', (select round(extract(epoch from now() - min(created_at)) / 60) from public.outbox where published_at is null)
) as status;
rollback;
`;

function timelineSql(prefix) {
  if (!/^[0-9a-f-]{8,36}$/iu.test(prefix)) throw new Error("Pass --app with an application id or its first 8 characters.");
  return `begin transaction read only;
select json_build_object('now', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'), 'timeline', (select coalesce(json_agg(t order by t.at), '[]') from (
  select d.occurred_at as at_raw, to_char(d.occurred_at at time zone 'utc', 'HH24:MI:SS') as at, 'event' as source, d.event_type as what,
    coalesce(d.payload->>'status', '') || coalesce(' ' || (d.payload->>'failure_code'), '') as info
  from public.domain_events d join public.applications a on a.id = d.aggregate_id where a.id::text like '${prefix}%'
  union all
  select w.occurred_at, to_char(w.occurred_at at time zone 'utc', 'HH24:MI:SS'), 'worker:' || w.lane, w.stage || ' ' || w.outcome,
    coalesce(w.code, '') || coalesce(' ' || round(w.duration_ms / 1000.0) || 's', '') || coalesce(' ' || left(w.detail->>'message', 80), '')
      || coalesce(' (' || (select string_agg(replace(key, 'Ms', '') || ' ' || round(value::numeric / 1000) || 's', ', ' order by key)
        from jsonb_each_text(w.detail) where key in ('openMs', 'readMs', 'modelMs', 'submitMs')) || ')', '')
      || coalesce(' answered ' || (w.detail->>'answered') || '/' || (w.detail->>'questions'), '')
  from private.worker_events w where w.application_id::text like '${prefix}%'
  union all
  select c.created_at, to_char(c.created_at at time zone 'utc', 'HH24:MI:SS'), 'agent', c.tool_name, coalesce(c.result->>'success', 'pending')
  from private.application_autopilot_tool_calls c join public.application_autopilots p on p.id = c.autopilot_id where p.application_id::text like '${prefix}%'
  order by 1) t)) as status;
rollback;
`;
}

function query(sql = SQL) {
  const directory = mkdtempSync(join(tmpdir(), "roledawn-ops-"));
  const file = join(directory, "status.sql");
  writeFileSync(file, sql);
  try {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const out = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        const match = out.match(/"status":\s*(\{[\s\S]*\})\s*\}\s*\]/u);
        if (match) return JSON.parse(match[1]);
      } catch (error) {
        // The CLI's temporary login role intermittently times out (status 544); retry.
        if (attempt === 6) throw error;
      }
    }
    throw new Error("OPS_STATUS_UNREADABLE");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function table(rows, columns) {
  if (!rows.length) return "  (none)";
  const widths = columns.map((column) => Math.min(42, Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length))));
  const line = (cells) => "  " + cells.map((cell, index) => String(cell ?? "").slice(0, widths[index]).padEnd(widths[index])).join("  ");
  return [line(columns), line(widths.map((width) => "-".repeat(width))), ...rows.map((row) => line(columns.map((column) => row[column])))].join("\n");
}

function print(status) {
  console.log(`RoleDawn status at ${status.now} UTC`);
  console.log("\nLanes");
  console.log(table(status.lanes, ["lane", "status", "finished", "error"]));
  console.log("\nApplications (not archived, newest first)");
  console.log(table(status.applications, ["created", "id", "employer", "role", "status", "send", "stage", "open_questions", "codes", "attempts", "receipt", "failure"]));
  console.log("\nSend failures in the last 24 hours");
  console.log(table(status.failures_24h, ["failure", "count"]));
  console.log("\nRecent failures with their cause (24 hours)");
  console.log(table(status.recent_failures ?? [], ["at", "lane", "stage", "code", "seconds", "app", "cause"]));
  console.log(`\nOutbox: ${status.pending_outbox} pending${status.pending_outbox ? `, oldest ${status.oldest_pending_outbox_minutes} min` : ""}`);
}

const appIndex = process.argv.indexOf("--app");
if (appIndex >= 0) {
  const status = query(timelineSql(String(process.argv[appIndex + 1] ?? "")));
  console.log(`Timeline at ${status.now} UTC`);
  console.log(table(status.timeline, ["at", "source", "what", "info"]));
  process.exit(0);
}
const watch = process.argv.includes("--watch");
do {
  const status = query();
  if (watch) console.clear();
  print(status);
  if (watch) await new Promise((resolve) => setTimeout(resolve, 20_000));
} while (watch);
