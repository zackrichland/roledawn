// Explicit opt-in, disposable real PostgreSQL race test. No ports, volumes or credentials from the app.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
const IMAGE = "postgres@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650";
if (process.argv[2] !== "--run-docker") throw Error("Use --run-docker for the disposable synthetic database test");
const name = `roledawn-canary-race-${process.pid}`;
const docker = (...args) => execFileSync("docker",args,{ encoding:"utf8",stdio:["pipe","pipe","pipe"] });
function sql(text, marker) {
  const child = spawn("docker",["exec","-i",name,"psql","-X","-qAt","-U","postgres","-v","ON_ERROR_STOP=1"],{ stdio:["pipe","pipe","pipe"] });
  let out = "", err = "", seen;
  const ready = new Promise(resolve => { seen = resolve; });
  child.stdout.on("data", chunk => { out += chunk; if (marker && out.includes(marker)) seen(); });
  child.stderr.on("data", chunk => { err += chunk; });
  const done = new Promise((resolve,reject) => {
    child.on("error",reject);
    child.on("close",code => { seen(); resolve({ code,out,err }); });
  });
  child.stdin.end(text); return { ready,done };
}
async function ok(text) { const r = await sql(text).done; assert.equal(r.code,0,r.err); return r.out.trim(); }
try {
  docker("run","--rm","-d","--name",name,"--network","none","--tmpfs","/var/lib/postgresql:rw,noexec,nosuid,size=512m","-e","POSTGRES_HOST_AUTH_METHOD=trust",IMAGE);
  let available = false;
  for (let n=0;n<60;n++) { try { docker("exec",name,"pg_isready","-U","postgres"); available=true; break; } catch { await new Promise(r=>setTimeout(r,250)); } }
  assert.ok(available,"ephemeral postgres did not start");
  const harness = await readFile("scripts/migration-harness.mjs","utf8");
  const bootstrap = harness.match(/await db\.exec\(`([\s\S]*?)`\);/)[1];
  await ok(bootstrap);
  for (const file of (await readdir("supabase/migrations")).filter(x=>x.endsWith(".sql")).sort()) {
    const migration = (await readFile(`supabase/migrations/${file}`,"utf8"))
      .replace(/create extension if not exists pgcrypto with schema extensions;/giu,"")
      .replace(/create extension if not exists "?pg_cron"?[^;]*;/giu,"").replace(/create extension if not exists "?pg_net"?[^;]*;/giu,"");
    await ok(migration);
  }
  const fixture = (await readFile("supabase/checks/autopilot_transient_retry.sql","utf8")).split("-- The worker claims")[0]
    .replaceAll("pg_temp.running","public.synthetic_running")
    .replaceAll("'https://job-boards.greenhouse.io/roledawncheck/jobs/1'",`case when p_label='lever' then 'https://jobs.lever.co/synthetic/33333333-3333-4333-8333-333333333333/apply'
      when p_label='ashby' then 'https://jobs.ashbyhq.com/synthetic/33333333-3333-4333-8333-333333333333/application'
      else 'https://job-boards.greenhouse.io/roledawncheck/jobs/1' end`);
  await ok(fixture+"\ncommit;\ncreate table public.synthetic_race_plans(label text primary key,plan_text text,autopilot uuid,gh uuid);\ninsert into private.hosted_canary_budget(prior_upper_cents,evidence_hash,valid_until) values(100,repeat('d',64),now()+interval '1 hour');");
  for (const board of ["lever","ashby"]) for (const order of ["browser","hosted","selected_row"]) {
    const label = `${board}_${order}`;
    await ok(`do $$ declare f jsonb:=public.synthetic_running('${board}'); g jsonb:=public.synthetic_running('greenhouse'); p jsonb; a public.application_autopilots%rowtype; begin
      select * into a from public.application_autopilots where id=(f->>'autopilot')::uuid;
      update public.application_autopilots set status='QUEUED',lease_token=null,lease_expires_at=null,created_at=now()-interval '1 hour',available_at=now()-interval '1 hour' where id=a.id;
      update public.application_autopilots set status='QUEUED',lease_token=null,lease_expires_at=null where id=(g->>'autopilot')::uuid;
      insert into private.application_autopilot_runtime(autopilot_id) values(a.id),((g->>'autopilot')::uuid);
      p:=jsonb_build_object('candidateId',a.candidate_id,'applicationId',a.application_id,'destinationUrl',a.destination_url,'intentSha256',encode(sha256(convert_to('${label}','UTF8')),'hex'),
        'deadlineMs',extract(epoch from clock_timestamp()+interval '10 minutes')*1000,'reservedRunCents',100,'priorSpendUpperBoundCents',100);
      insert into private.hosted_canary_approvals(intent_hash,plan_text,approval_hash,packet_readback_hash,future_cost_bound_hash,valid_until,enabled)
        values(p->>'intentSha256',p::text,repeat('a',64),repeat('b',64),repeat('c',64),now()+interval '1 hour',true);
      insert into public.synthetic_race_plans values('${label}',p::text,a.id,(g->>'autopilot')::uuid);
    end $$;`);
    const claimHosted = `select public.claim_hosted_canary((select plan_text from public.synthetic_race_plans where label='${label}'),false);`;
    const claimBrowser = `select public.claim_application_autopilot('race',60,(select autopilot from public.synthetic_race_plans where label='${label}'));`;
    const held = order === "hosted" ? claimHosted : order === "browser" ? claimBrowser : `select id from public.application_autopilots where id=(select autopilot from public.synthetic_race_plans where label='${label}') for update;`;
    const first = sql(`begin; ${held} select 'LOCK_HELD'; select pg_sleep(2); ${order === "selected_row" ? claimBrowser : ""} commit;`,"LOCK_HELD");
    await first.ready;
    const [second,global] = await Promise.all([
      order === "hosted" ? Promise.resolve(null) : sql(claimHosted).done,
      sql("select public.claim_application_autopilot('global-race',60);").done,
    ]);
    assert.equal(global.code,0,global.err);
    const claimed = JSON.parse(global.out.trim());
    const gh = await ok(`select gh from public.synthetic_race_plans where label='${label}';`);
    assert.equal(claimed.id,gh,"unrelated Greenhouse must progress while reserved/selected older row is locked");
    if (second) assert.notEqual(second.code,0,"hosted claim must lose to a browser lock/selected row");
    const firstResult = await first.done; assert.equal(firstResult.code,0,firstResult.err);
    const state = JSON.parse(await ok(`select jsonb_build_object('hosted',(select count(*) from private.hosted_canary_runs r where r.application_id=a.application_id),'browser',a.status)
      from public.application_autopilots a join public.synthetic_race_plans p on a.id=p.autopilot where p.label='${label}';`));
    assert.deepEqual(state,order === "hosted" ? { hosted:1,browser:"PAUSED" } : { hosted:0,browser:"RUNNING" });
    console.log(`PASS ${label}: one authority, Greenhouse progresses`);
  }
} finally { try { docker("rm","-f",name); } catch { /* --rm may already have removed it */ } }
