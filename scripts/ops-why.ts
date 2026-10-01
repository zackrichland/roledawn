#!/usr/bin/env node
// Why did my application stop? Read-only, for the founder and coding agents (D-149).
//   npm run ops:why                  the five newest applications, each with its stop explained
//   npm run ops:why -- --app <id>    one application (full id or 8-character prefix)
//   npm run ops:why -- --limit 10    more applications
//   npm run ops:why -- --json        raw rows for an agent to read
// Runs one `begin transaction read only; … rollback;` query through the linked
// Supabase CLI, like ops:status. It never selects tokens, codes, answers or
// document contents; worker events hold only sanitized shapes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diagnoseStop } from "../src/domain/stop-diagnosis.ts";

const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? String(process.argv[index + 1] ?? "") : null; };
const prefix = argument("--app");
const limit = Math.max(1, Math.min(25, Number(argument("--limit") ?? 5) || 5));
if (prefix !== null && !/^[0-9a-f-]{8,36}$/iu.test(prefix)) throw new Error("Pass --app with an application id or its first 8 characters.");

const sql = `begin transaction read only;
select json_build_object('now', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  'dead_letters_24h', (select count(*) from public.outbox where dead_lettered_at > now() - interval '24 hours'),
  'lanes', (select coalesce(json_agg(json_build_object('lane', lane, 'status', status, 'error', last_error_code) order by lane), '[]') from public.hosted_worker_lanes),
  'apps', (select coalesce(json_agg(x order by x.created_raw desc), '[]') from (
    select a.created_at as created_raw, to_char(a.created_at at time zone 'utc', 'MM-DD HH24:MI') as created, a.id::text as id, a.status,
      coalesce(v.employer_name, '?') as employer, left(coalesce(v.title, '?'), 60) as role,
      regexp_replace(coalesce(v.apply_url, ''), '[?#].*$', '') as apply_url,
      i.status as intake_status, i.failure_code as intake_failure,
      r.status as run_status, r.error_code as run_error,
      (si.application_id is not null and si.closed_at is null) as intent_open, si.close_reason,
      ap.status as send_status, ap.failure_code as send_failure, ap.transient_retries, ap.reconcile_count,
      (select w.detail from private.worker_events w where w.application_id = a.id and w.stage = 'stop-diagnosis' order by w.occurred_at desc limit 1) as diagnosis,
      (select w.code from private.worker_events w where w.application_id = a.id and w.stage = 'send-intent' order by w.occurred_at desc limit 1) as intent_error,
      (select coalesce(json_agg(json_build_object('at', to_char(e.occurred_at at time zone 'utc', 'HH24:MI:SS'), 'lane', e.lane, 'stage', e.stage,
          'outcome', e.outcome, 'code', e.code, 'seconds', round(e.duration_ms / 1000.0), 'message', e.detail->>'message') order by e.occurred_at), '[]')
        from (select * from private.worker_events w where w.application_id = a.id order by w.occurred_at desc limit 12) e) as events
    from public.applications a
    left join public.job_versions v on v.id = a.job_version_id
    left join public.job_intakes i on i.id = a.job_intake_id
    left join lateral (select * from public.application_runs r where r.application_id = a.id and r.run_kind = 'PREPARATION' order by r.created_at desc limit 1) r on true
    left join lateral (select * from public.application_send_intents s where s.application_id = a.id order by s.created_at desc limit 1) si on true
    left join lateral (select * from public.application_autopilots p where p.application_id = a.id order by p.created_at desc limit 1) ap on true
    where a.archived_at is null ${prefix ? `and a.id::text like '${prefix}%'` : ""}
    order by a.created_at desc limit ${limit}) x)) as status;
rollback;
`;

function query(text: string): Record<string, unknown> {
  const directory = mkdtempSync(join(tmpdir(), "roledawn-why-"));
  const file = join(directory, "why.sql");
  writeFileSync(file, text);
  try {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const out = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        const match = out.match(/"status":\s*(\{[\s\S]*\})\s*\}\s*\]/u);
        if (match) return JSON.parse(match[1]!) as Record<string, unknown>;
      } catch (error) {
        // The CLI's temporary login role intermittently fails (status 544); retry.
        if (attempt === 6) throw error;
      }
    }
    throw new Error("OPS_WHY_UNREADABLE");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

type Row = Record<string, unknown> & { diagnosis?: Record<string, unknown> | null; events?: Record<string, unknown>[] };
const result = query(sql);
if (process.argv.includes("--json")) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

console.log(`Why applications stopped — ${String(result.now)} UTC`);
const lanes = (result.lanes as Record<string, unknown>[] | undefined) ?? [];
const busy = lanes.filter((lane) => lane.error || lane.status === "RUNNING").map((lane) => `${lane.lane}=${lane.status}${lane.error ? `(${lane.error})` : ""}`);
if (busy.length) console.log(`Lanes: ${busy.join("  ")}`);
if (Number(result.dead_letters_24h)) console.log(`Outbox: ${result.dead_letters_24h} dead-lettered message(s) in 24 h — an application can sit in "Reading the job" or "Writing" until it is retried.`);
for (const row of (result.apps as Row[] | undefined) ?? []) {
  const diagnosis = row.diagnosis ?? null;
  const verdict = diagnoseStop({
    applicationStatus: row.status as string, intakeStatus: row.intake_status as string | null, intakeFailure: row.intake_failure as string | null,
    runStatus: row.run_status as string | null, runError: row.run_error as string | null,
    sendIntentOpen: row.intent_open === true, sendIntentClosedReason: row.close_reason as string | null, sendIntentError: row.intent_error as string | null,
    sendStatus: row.send_status as string | null, sendFailure: row.send_failure as string | null, diagnosis,
  });
  console.log(`\n[${row.created}] ${String(row.id).slice(0, 8)}  ${row.employer} — ${row.role}`);
  if (row.apply_url) console.log(`  Apply URL:  ${row.apply_url}`);
  console.log(`  Status:     application ${row.status}${row.send_status ? ` · send ${row.send_status}${row.send_failure ? ` (${row.send_failure})` : ""}` : ""}${Number(row.transient_retries) ? ` · automatic retries ${row.transient_retries}` : ""}`);
  console.log(`  Stopped at: ${verdict.stage}${diagnosis?.phase ? ` (phase ${diagnosis.phase})` : ""}${verdict.code ? ` · ${verdict.code}` : ""} · ${verdict.certainty}`);
  console.log(`  Cause:      ${verdict.cause}`);
  console.log(`  Next:       ${verdict.next}`);
  if (verdict.proposal) console.log(`  Decision:   proposal ${verdict.proposal} in docs/execution/reliability-review-2026-10-01.md`);
  if (diagnosis?.browserSession) console.log(`  Replay:     https://www.browserbase.com/sessions/${String(diagnosis.browserSession)}`);
  if (diagnosis?.page) console.log(`  Page:       ${String(diagnosis.page)}`);
  const top = (value: unknown) => Object.entries((value ?? {}) as Record<string, number>).sort(([, a], [, b]) => b - a).slice(0, 6).map(([key, count]) => `${key} ×${count}`);
  if (diagnosis?.blocked) console.log(`  Refused:    ${top(diagnosis.blocked).join("\n              ") || "(none)"}`);
  if (diagnosis?.frames) console.log(`  Frames:     ${top(diagnosis.frames).join("\n              ")}`);
  if (diagnosis && ("solverStarted" in diagnosis)) console.log(`  Solver:     started ${String(diagnosis.solverStarted)} · finished ${String(diagnosis.solverFinished)}`);
  const events = row.events ?? [];
  if (events.length) {
    console.log("  Events:");
    for (const event of events) console.log(`    ${event.at} ${event.lane}/${event.stage} ${event.outcome}${event.code ? ` ${event.code}` : ""}${event.seconds !== null && event.seconds !== undefined ? ` ${event.seconds}s` : ""}${event.message ? ` · ${event.message}` : ""}`);
  }
}
