/** Generates a rollback-only SQL acceptance. No model, browser or external sends. */
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createFullstackScope, buildFullstackSeedSql, syntheticHash } from "./application-delivery-fullstack-lib.ts";
import { loadApplicationWritingPolicy } from "../src/server/applications/application-writing-policy-loader.ts";
import type { RenderedApplicationKitArtifact } from "../src/server/applications/application-kit-renderer.ts";
const s = createFullstackScope();
// Bytes are deliberately absent: this tests durable authority, not document rendering.
const artifacts = ["RESUME_PDF", "RESUME_DOCX", "COVER_LETTER_PDF", "COVER_LETTER_DOCX", "APPLICATION_PDF"].map((variant) => ({
  id: randomUUID(), path: `${s.workspaceId}/auto-apply-test/${randomUUID()}`, variant,
  kind: variant.startsWith("RESUME") ? "RESUME" : variant === "APPLICATION_PDF" ? "OTHER" : "COVER_LETTER",
  displayName: `Synthetic ${variant}`, mimeType: variant.endsWith("PDF") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  byteSize: 100, sha256: syntheticHash(variant), rendererRelease: "synthetic-authority-fixture/1",
}));
const seed = buildFullstackSeedSql({scope:s,text:"Synthetic candidate evidence only.",sourcePath:`${s.workspaceId}/synthetic-resume.pdf`,
  sourceArtifact:artifacts[0] as unknown as RenderedApplicationKitArtifact,
  artifacts:artifacts as unknown as (RenderedApplicationKitArtifact & {id:string;path:string})[],factVersionIds:[],writingPolicy:(await loadApplicationWritingPolicy()).provenance});
const url = `https://job-boards.greenhouse.io/roledawnsynthetic/jobs/999999999`;
let seedSql = seed.sql.replace(/^begin;\n/u, "").replace(/commit;\nselect true as synthetic_seed_created;$/u, "").replaceAll(s.destinationUrl,url);
// Seed guard still expects its reserved fixture identity before inserting any job.
seedSql = seedSql.replace(`canonical_url='${url}'`, `canonical_url='${s.destinationUrl}'`);
const newJob=randomUUID(), newVersion=randomUUID(), sourceId=randomUUID(),listingId=randomUUID();
const decision = (version: string) => JSON.stringify({autoApplyEligible:true,band:"STRONG",jobVersionId:version,profileHash:"a".repeat(64),policyVersion:"synthetic-match/1",jobContentHash:version===newVersion?"b".repeat(64):syntheticHash(s.destinationUrl),score:90,reasons:["Synthetic evidence"],reviewReasons:[],evidenceRefs:[]});
const body = `
create temporary table auto_apply_checks(check_name text primary key,passed boolean not null) on commit drop;
insert into auth.users(id,email,raw_app_meta_data) values('${s.userId}','${s.email}', '{"roledawn_delivery_acceptance_run_id":"${s.runId}"}');
insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values('${s.workspaceId}','${s.workspaceName}','PERSONAL','ACTIVE','${s.userId}');
insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values('${s.workspaceId}','${s.userId}','OWNER','ACTIVE');
insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values('${s.candidateId}','${s.workspaceId}','${s.userId}','Synthetic auto-apply candidate','ACTIVE');
insert into public.candidate_search_profiles(workspace_id,candidate_id,target_roles,desired_country_codes,work_modes,employment_types)
 values('${s.workspaceId}','${s.candidateId}',array['Synthetic tester'],array['US'],array['REMOTE'],array['FULL_TIME']);
insert into public.candidate_facts(workspace_id,candidate_id,fact_key,sensitivity,usage_policy,verification_status,current_version_number)
 select '${s.workspaceId}','${s.candidateId}',key,'STANDARD','EXACT_FIELDS','VERIFIED',1 from unnest(array['identity.given_name','identity.family_name','identity.legal_name','contact.application_email','contact.phone','location.city','location.region','location.country_code']) key;
${seedSql}
insert into public.job_sources(id,provider,tenant_key,application_domain,policy_status,polling_enabled,adapter_release)
 values('${sourceId}','GREENHOUSE','synthetic-${s.runId}','job-boards.greenhouse.io','ALLOWLISTED',true,'synthetic/1');
insert into public.source_job_listings(id,source_id,external_job_id,source_url,apply_url,state,first_seen_at,last_seen_at)
 values('${listingId}','${sourceId}','999999998','https://job-boards.greenhouse.io/roledawnsynthetic/jobs/999999998','https://job-boards.greenhouse.io/roledawnsynthetic/jobs/999999998','OPEN',now(),now());
insert into public.jobs(id,source_listing_id,canonical_url,state) values('${newJob}','${listingId}','https://job-boards.greenhouse.io/roledawnsynthetic/jobs/999999998','OPEN');
insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
 values('${newVersion}','${newJob}',1,repeat('b',64),'Synthetic queue job','Synthetic fixture','Synthetic only','https://job-boards.greenhouse.io/roledawnsynthetic/jobs/999999998',now());
update public.jobs set current_version_id='${newVersion}' where id='${newJob}';
do $test$
declare state jsonb; claim jsonb; result jsonb; token uuid; command uuid:=gen_random_uuid(); autopilot uuid; lease uuid; seal text; attempt uuid; count_before integer;
begin
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if has_function_privilege('anon','public.read_auto_apply_state()','EXECUTE')
   or has_function_privilege('authenticated','public.claim_auto_apply_candidate(text,uuid)','EXECUTE')
   or has_function_privilege('service_role','public.set_auto_apply_enabled(uuid,bigint,boolean)','EXECUTE')
   or has_function_privilege('authenticated','private.delegate_auto_apply_as_candidate(uuid,uuid,bigint,uuid,text,uuid)','EXECUTE')
   or has_table_privilege('authenticated','public.candidate_auto_apply_settings','UPDATE') then raise exception 'AUTO_APPLY_TEST_ACL'; end if;
 insert into auto_apply_checks values('client_service_and_private_authority_boundaries',true);
 perform set_config('request.jwt.claim.sub','${s.userId}',true);
 execute 'set local role authenticated';
 state:=public.read_auto_apply_state();
 if state->>'enabled'<>'false' or state->>'version'<>'0' then raise exception 'AUTO_APPLY_TEST_DEFAULT_OFF'; end if;
 state:=public.set_auto_apply_enabled(command,0,true);
 if state->>'enabled'<>'true' or state->>'version'<>'1' then raise exception 'AUTO_APPLY_TEST_ENABLE'; end if;
 result:=public.set_auto_apply_enabled(command,0,true);
 if result->>'version'<>'1' then raise exception 'AUTO_APPLY_TEST_REPLAY'; end if;
 begin perform public.set_auto_apply_enabled(command,0,false); raise exception 'AUTO_APPLY_TEST_REPLAY_ACCEPTED';
 exception when unique_violation then null; end;
 begin perform public.set_auto_apply_enabled(gen_random_uuid(),0,false); raise exception 'AUTO_APPLY_TEST_STALE_ACCEPTED';
 exception when sqlstate 'PT409' then null; end;
 execute 'reset role';
 insert into auto_apply_checks values('default_off_owned_enable_replay_and_stale_toggle',true);
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.candidate_auto_apply_settings where candidate_id='${s.candidateId}') then raise exception 'AUTO_APPLY_TEST_RLS_LEAK'; end if;
 begin perform public.set_auto_apply_enabled(gen_random_uuid(),1,false); raise exception 'AUTO_APPLY_TEST_OTHER_ACTOR';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 insert into auto_apply_checks values('other_candidate_cannot_read_or_change',true);
 execute 'set local role service_role';
 if exists(select 1 from public.hosted_worker_lanes where lane='auto-apply') then
   if not (public.hosted_worker_due_lanes() ? 'auto-apply') then raise exception 'AUTO_APPLY_TEST_HOSTED_NOT_DUE'; end if;
   lease:=public.claim_hosted_worker_lane('auto-apply',30);
   if lease is null or public.claim_hosted_worker_lane('auto-apply',30) is not null or public.hosted_worker_due_lanes() ? 'auto-apply' then raise exception 'AUTO_APPLY_TEST_HOSTED_LANE_COLLISION'; end if;
   if not public.finish_hosted_worker_lane('auto-apply',lease,'{"claimed":0}',null) then raise exception 'AUTO_APPLY_TEST_HOSTED_LANE_FINISH'; end if;
 end if;
 claim:=public.claim_auto_apply_candidate('synthetic-auto-apply','${s.candidateId}'); token:=(claim->>'lease_token')::uuid;
 if token is null or public.claim_auto_apply_candidate('other-worker','${s.candidateId}') is not null then raise exception 'AUTO_APPLY_TEST_LEASE_COLLISION'; end if;
 result:=public.advance_auto_apply_candidate('${s.candidateId}',token,1);
 if result->>'outcome'<>'SELECT_MATCH' then raise exception 'AUTO_APPLY_TEST_SELECTION'; end if;
 begin perform public.advance_auto_apply_candidate('${s.candidateId}',gen_random_uuid(),1); raise exception 'AUTO_APPLY_TEST_BAD_LEASE';
 exception when sqlstate '55000' then if sqlerrm<>'AUTO_APPLY_LEASE_INACTIVE' then raise; end if; end;
 begin
   perform public.enqueue_auto_apply_match('${s.candidateId}',token,1,'${newJob}','${newVersion}',repeat('a',64),'synthetic-match/1','${decision(newVersion)}'::jsonb||'{"jobContentHash":"wrong"}'::jsonb);
   raise exception 'AUTO_APPLY_TEST_WRONG_CONTENT_HASH';
 exception when others then if sqlerrm<>'AUTO_APPLY_JOB_UNAVAILABLE' then raise; end if; end;
 result:=public.enqueue_auto_apply_match('${s.candidateId}',token,1,'${newJob}','${newVersion}',repeat('a',64),'synthetic-match/1','${decision(newVersion)}');
 if result->>'outcome'<>'PREPARED' then raise exception 'AUTO_APPLY_TEST_QUEUE'; end if;
 if public.finish_auto_apply_check('${s.candidateId}',gen_random_uuid(),'PREPARED') then raise exception 'AUTO_APPLY_TEST_BAD_FINISH'; end if;
 if not public.finish_auto_apply_check('${s.candidateId}',token,'PREPARED') or public.finish_auto_apply_check('${s.candidateId}',token,'PREPARED') then raise exception 'AUTO_APPLY_TEST_FINISH_REPLAY'; end if;
 execute 'reset role';
 insert into auto_apply_checks values('lease_collision_atomic_selection_and_completion_replay',true);
 perform set_config('request.jwt.claim.sub','${s.userId}',true);
 execute 'set local role authenticated';
 state:=public.set_auto_apply_enabled(gen_random_uuid(),1,false);
 execute 'reset role';
 if not exists(select 1 from public.applications a join public.auto_apply_enrollments e on e.application_id=a.id where e.job_id='${newJob}' and a.status='CANCELED') then raise exception 'AUTO_APPLY_TEST_PAUSE_QUEUE'; end if;
 if exists(select 1 from public.application_runs r join public.auto_apply_enrollments e on e.application_id=r.application_id where e.job_id='${newJob}' and r.status in ('QUEUED','RUNNING')) then raise exception 'AUTO_APPLY_TEST_PAUSE_PREP'; end if;
 if (select status from public.applications where id='${s.applicationId}') <> 'READY' then raise exception 'AUTO_APPLY_TEST_MANUAL_APPLICATION_CHANGED'; end if;
 insert into auto_apply_checks values('pause_cancels_only_automatic_unsent_preparation',true);
 execute 'set local role authenticated'; state:=public.set_auto_apply_enabled(gen_random_uuid(),2,true); execute 'reset role';
 -- Ready synthetic packet: writing/bytes were independently accepted elsewhere.
 insert into public.auto_apply_enrollments(application_id,workspace_id,candidate_id,job_id,job_version_id,consent_version,candidate_input_version,search_profile_version,profile_hash,matching_policy,matching_decision)
 select '${s.applicationId}','${s.workspaceId}','${s.candidateId}','${s.jobId}','${s.jobVersionId}',3,application_input_version,1,repeat('a',64),'synthetic-match/1','${decision(s.jobVersionId)}' from public.candidates where id='${s.candidateId}';
 execute 'set local role service_role'; claim:=public.claim_auto_apply_candidate('synthetic-auto-apply','${s.candidateId}'); token:=(claim->>'lease_token')::uuid;
 result:=public.advance_auto_apply_candidate('${s.candidateId}',token,3);
 if result->>'outcome'<>'DELEGATED' then raise exception 'AUTO_APPLY_TEST_DELEGATE'; end if;
 autopilot:=(result->>'autopilot_id')::uuid;
 result:=public.advance_auto_apply_candidate('${s.candidateId}',token,3);
 if result->>'outcome'<>'WAITING_APPLICATION' then raise exception 'AUTO_APPLY_TEST_DOUBLE_DELEGATE'; end if;
 claim:=public.claim_application_autopilot('synthetic-auto-apply',300,autopilot); lease:=(claim->>'lease_token')::uuid;
 seal:=public.seal_application_autopilot(autopilot,lease,'{"synthetic":true}',repeat('c',64),repeat('d',64),'${url}');
 result:=public.begin_application_autopilot_submit(autopilot,lease,seal,repeat('d',64),'synthetic-no-network/1'); attempt:=(result->>'attempt_id')::uuid;
 execute 'reset role';
 if attempt is null or not exists(select 1 from public.candidate_auto_apply_settings where candidate_id='${s.candidateId}' and next_submission_at>=statement_timestamp()+interval '59 minutes') then raise exception 'AUTO_APPLY_TEST_RATE_NOT_RESERVED'; end if;
 insert into auto_apply_checks values('standing_consent_freezes_packet_and_single_use_submit',true);
 -- BEFORE INSERT rate gate runs before FK checks; a second fabricated attempt is denied.
 begin
   insert into public.application_attempts(workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status)
    values('${s.workspaceId}','${s.applicationId}','${s.revisionId}',gen_random_uuid(),'SUBMIT_APPLICATION_ONCE',gen_random_uuid()::text,'synthetic/1','STARTED');
   raise exception 'AUTO_APPLY_TEST_RATE_BURST';
 exception when sqlstate '55000' then if sqlerrm<>'AUTO_APPLY_RATE_LIMITED' then raise; end if; end;
 insert into auto_apply_checks values('actual_attempt_boundary_prevents_submission_burst',true);
 insert into private.auto_apply_plans values('SYNTHETIC_CAP_ONE_ACTIVE',3600,1);
 update public.candidate_auto_apply_settings set plan_key='SYNTHETIC_CAP_ONE_ACTIVE',next_submission_at=now()-interval '1 second' where candidate_id='${s.candidateId}';
 begin
   insert into public.application_attempts(workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status)
    values('${s.workspaceId}','${s.applicationId}','${s.revisionId}',gen_random_uuid(),'SUBMIT_APPLICATION_ONCE',gen_random_uuid()::text,'synthetic/1','STARTED');
   raise exception 'AUTO_APPLY_TEST_DAILY_CAP_BYPASSED';
 exception when sqlstate '55000' then if sqlerrm<>'AUTO_APPLY_RATE_LIMITED' then raise; end if; end;
 update public.candidate_auto_apply_settings set plan_key='PILOT',next_submission_at=now()+interval '1 hour' where candidate_id='${s.candidateId}';
 insert into auto_apply_checks values('server_owned_daily_cap_counts_all_attempts',true);

 execute 'set local role service_role';
 perform public.finish_application_autopilot(autopilot,lease,'UNCERTAIN','SYNTHETIC_NO_NETWORK'); execute 'reset role';
 perform set_config('request.jwt.claim.sub','${s.userId}',true);
 execute 'set local role authenticated'; state:=public.set_auto_apply_enabled(gen_random_uuid(),3,false); execute 'reset role';
 if not exists(select 1 from public.application_autopilots where id=autopilot and status='UNCERTAIN' and attempt_id=attempt) then raise exception 'AUTO_APPLY_TEST_UNCERTAIN_LOST'; end if;
 execute 'set local role service_role'; claim:=public.claim_application_autopilot('synthetic-reconcile',300,autopilot); execute 'reset role';
 -- UNCERTAIN has a five-minute reconciliation delay, which pause must preserve.
 if claim is not null then raise exception 'AUTO_APPLY_TEST_RECONCILE_DELAY'; end if;
 execute 'set local role authenticated'; state:=public.set_auto_apply_enabled(gen_random_uuid(),4,true); execute 'reset role';
 if state->>'attempted_today'<>'1' or state->>'confirmed_today'<>'0' or state->>'next_submission_at' is null then raise exception 'AUTO_APPLY_TEST_USAGE_RESET'; end if;
 insert into auto_apply_checks values('pause_preserves_uncertain_and_consumed_capacity',true);
 -- The one-hour gate and the plan cap are independent. Simulate the passage of
 -- one hour without changing or deleting the immutable submission attempt.
 update public.candidate_auto_apply_settings set next_submission_at=now()-interval '1 second' where candidate_id='${s.candidateId}';
 insert into private.auto_apply_plans values('SYNTHETIC_CAP_ONE',3600,1);
 update public.candidate_auto_apply_settings set plan_key='SYNTHETIC_CAP_ONE' where candidate_id='${s.candidateId}';
 -- The old enrollment is tied to its old consent and cannot receive new authority.
 begin
   insert into public.application_attempts(workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status)
    values('${s.workspaceId}','${s.applicationId}','${s.revisionId}',gen_random_uuid(),'SUBMIT_APPLICATION_ONCE',gen_random_uuid()::text,'synthetic/1','STARTED');
   raise exception 'AUTO_APPLY_TEST_OLD_CONSENT_REUSED';
 exception when sqlstate '55000' then if sqlerrm<>'AUTO_APPLY_CONSENT_INACTIVE' then raise; end if; end;
 insert into auto_apply_checks values('old_enrollment_cannot_borrow_new_consent',true);

 update public.candidate_search_profiles set aggregate_version=aggregate_version+1 where candidate_id='${s.candidateId}';
 execute 'set local role authenticated'; state:=public.read_auto_apply_state(); execute 'reset role';
 if state->>'enabled'<>'false' or state->>'status'<>'PAUSED_PROFILE_CHANGED' then raise exception 'AUTO_APPLY_TEST_PROFILE_INVALIDATION'; end if;
 insert into auto_apply_checks values('changed_search_preferences_pause_standing_consent',true);
end; $test$;
select * from auto_apply_checks order by check_name;
`;
let migrations="";
if(process.argv.includes("--include-pending-migrations")) {
 const names=await readdir("supabase/migrations");
 for(const suffix of ["_ats_delivery_capability_gate.sql","_account_auto_apply.sql","_auto_apply_content_hash_binding.sql"]) {
  const file=names.find(name=>name.endsWith(suffix)); if(!file) throw new Error("AUTO_APPLY_MIGRATION_MISSING");
  migrations+=await readFile(`supabase/migrations/${file}`,"utf8");
 }
}
const path=process.argv.find(value=>value.startsWith("--output="))?.slice(9) ?? "/tmp/roledawn-auto-apply-acceptance.sql";
await writeFile(path,`begin;\n${migrations}\n${body}\nrollback;\nselect not exists(select 1 from auth.users where id='${s.userId}') and not exists(select 1 from public.workspaces where id='${s.workspaceId}') and not exists(select 1 from public.jobs where id in ('${s.jobId}','${newJob}')) as rollback_complete;\n`,{mode:0o600});
console.log(path);
