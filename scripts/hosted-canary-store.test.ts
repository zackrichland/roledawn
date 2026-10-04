import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createMigratedDatabase } from "./migration-harness.mjs";
import { prepareHostedCanaryPlan } from "../src/server/workers/openai-hosted-canary.ts";
import { createHostedCanaryStore } from "../src/server/workers/openai-hosted-canary-store.ts";

for (const board of ["lever", "ashby"] as const) test(`${board}: actual RPC store fences delivery, retains evidence/cleanup and excludes uncertainty without an attempt`, async () => {
  const { db } = await createMigratedDatabase();
  try {
    const url = board === "lever" ? "https://jobs.lever.co/synthetic/33333333-3333-4333-8333-333333333333/apply" : "https://jobs.ashbyhq.com/synthetic/33333333-3333-4333-8333-333333333333/application";
    // Reuse the repository's complete synthetic application fixture; no real candidate data.
    const fixture = (await readFile("supabase/checks/autopilot_transient_retry.sql", "utf8")).split("-- The worker claims")[0];
    await db.exec(fixture.replaceAll("'https://job-boards.greenhouse.io/roledawncheck/jobs/1'", `case when p_label='hosted' then '${url}' else 'https://job-boards.greenhouse.io/roledawncheck/jobs/1' end`));
    const f = (await db.query<{ f: { application: string; autopilot: string } }>("select pg_temp.running('hosted') as f")).rows[0].f;
    const row = (await db.query<{ candidate_id: string; job_version_id: string }>("select candidate_id,job_version_id from public.applications where id=$1", [f.application])).rows[0];
    const plan = prepareHostedCanaryPlan({ candidateId: row.candidate_id, applicationId: f.application, destinationUrl: url,
      admissionKey: "fixture-admission", allowedDomains: [new URL(url).hostname], originDecisions: { [new URL(url).origin]: "approve" },
      deadlineMs: Date.now()+120_000, priorSpendUpperBoundCents: 100, reservedRunCents: 100,
      packet: { facts: { name: "Fixture", email: "fixture@example.invalid" }, resumeBase64: Buffer.from("%PDF-fixture").toString("base64") } });
    await db.query(`insert into private.hosted_canary_approvals(intent_hash,plan_text,approval_hash,packet_readback_hash,future_cost_bound_hash,valid_until,enabled)
      values($1,$2,repeat('a',64),repeat('b',64),repeat('c',64),now()+interval '1 hour',true)`, [plan.intentSha256,JSON.stringify(plan)]);
    await db.exec("insert into private.hosted_canary_budget(prior_upper_cents,evidence_hash,valid_until) values(100,repeat('d',64),now()+interval '1 hour')");
    const rpc = { async rpc(name: string,args: Record<string, unknown>) {
      // Run the same public functions under their actual restricted service-role grants.
      await db.exec("savepoint rpc_call; set local role service_role");
      try {
        const keys = Object.keys(args); const params = keys.map((k,i) => `${k}=>$${i+1}`).join(",");
        const result = await db.query<{ value: unknown }>(`select public.${name}(${params}) as value`, Object.values(args));
        return { data: result.rows[0].value, error: null };
      } catch { await db.exec("rollback to savepoint rpc_call"); return { data: null, error: { code: "SQL_REFUSED" } }; }
      finally { await db.exec("reset role; release savepoint rpc_call"); }
    } };
    const store = createHostedCanaryStore(rpc);
    const refuseBrowserbase = async () => {
      await db.exec("savepoint refused");
      await assert.rejects(db.query("update public.application_autopilots set status='RUNNING' where id=$1", [f.autopilot]), /PROVIDER_EXCLUDED/);
      await db.exec("rollback to savepoint refused; release savepoint refused");
    };
    await assert.rejects(store.claim(plan), /STORE_REFUSED/, "existing active Browserbase work wins");
    await db.query("update public.application_autopilots set status='QUEUED',lease_token=null,lease_expires_at=null,created_at=now()-interval '1 hour',available_at=now()-interval '1 hour' where id=$1", [f.autopilot]);
    let run = await store.claim(plan);
    await assert.rejects(store.claim(plan), /STORE_REFUSED/, "competing controller refused");
    await refuseBrowserbase();
    const reserved = (await db.query<{ reserved_cents: number }>("select reserved_cents from private.hosted_canary_budget")).rows[0].reserved_cents;
    assert.equal(reserved,100);
    assert.equal(await store.budgetAvailable(run),true);
    await db.exec("update private.hosted_canary_budget set valid_until=now()-interval '1 second'");
    assert.equal(await store.budgetAvailable(run),false);
    await db.exec("update private.hosted_canary_budget set valid_until=now()+interval '1 hour'");
    const stale = run;
    run = await store.commit(run,{ phase: "CREATING", possibleEgress: true, cleanupPending: true });
    await assert.rejects(store.commit(stale,{ phase: "STOPPED" }), /STORE_REFUSED/);
    run = await store.commit(run,{ phase: "READY", sessionId: "session_fixture" });
    run = await store.commit(run,{ phase: "ADMISSION_PENDING" });
    run = await store.commit(run,{ phase: "ACTIVE" });
    run = await store.commit(run,{ phase: "UNCERTAIN" });
    await store.releaseController(run);
    run = await store.claim(plan,true);
    assert.equal(run.phase,"UNCERTAIN"); assert.equal(run.cleanupPending,true);
    await assert.rejects(store.commit(run,{ phase: "ACTIVE" }), /STORE_REFUSED/);
    await assert.rejects(store.commit(run,{ phase: "CONFIRMED" }), /STORE_REFUSED/);
    await db.query("insert into private.hosted_canary_verified_evidence(run_id,evidence,verifier_reference_hash) values($1,$2,repeat('f',64))", [run.runId,
      { source: "VERIFIED_EMPLOYER_EVIDENCE", applicationId: plan.applicationId, destinationUrl: url, packetSha256: plan.packetSha256, evidenceSha256: "e".repeat(64), outcome: "CONFIRMED" }]);
    run = await store.commit(run,{ phase: "CONFIRMED", evidence: { source: "VERIFIED_EMPLOYER_EVIDENCE", applicationId: plan.applicationId,
      destinationUrl: url, packetSha256: plan.packetSha256, evidenceSha256: "e".repeat(64), outcome: "CONFIRMED" } });
    assert.equal(run.evidence?.evidenceSha256,"e".repeat(64));
    await store.releaseController(run); run = await store.claim(plan,true);
    run = await store.commit(run,{ cleanupPending: false }); assert.equal(run.phase,"CONFIRMED");
    await refuseBrowserbase();
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.application_attempts where application_id=$1",[f.application])).rows[0].n,0);
    // Unrelated Greenhouse fixture and its normal RUNNING state are unchanged.
    const gh = (await db.query<{ f: { autopilot: string } }>("select pg_temp.running('greenhouse-unaffected') as f")).rows[0].f;
    await db.query("update public.application_autopilots set status='QUEUED',lease_token=null,lease_expires_at=null where id=$1",[gh.autopilot]);
    await db.query("insert into private.application_autopilot_runtime(autopilot_id) values($1)",[gh.autopilot]);
    const claimed = await rpc.rpc("claim_application_autopilot",{ p_worker_id: "synthetic-global-worker",p_lease_seconds: 60 });
    assert.equal(claimed.error,null); assert.equal((claimed.data as { id: string }).id,gh.autopilot,"reserved older job cannot starve global Greenhouse claim");
    await db.query("update public.application_autopilots set status='QUEUED' where id=$1",[f.autopilot]);
    assert.equal((await db.query<{ status: string }>("select status from public.application_autopilots where id=$1",[f.autopilot])).rows[0].status,"PAUSED");
    // No anonymous or ordinary authenticated caller can claim or inspect the private plan.
    assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.claim_hosted_canary(text,boolean)','execute') as allowed")).rows[0].allowed,false);
    await db.exec("rollback");
  } finally { await db.close(); }
});
