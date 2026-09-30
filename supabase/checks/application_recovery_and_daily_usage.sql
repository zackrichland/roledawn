-- Synthetic integration checks. Fixtures bypass unrelated packet guards; functions and constraints under test are active.
begin;
create temporary table recovery_checks(check_name text, passed boolean) on commit drop;
create function pg_temp.fixture() returns jsonb language plpgsql as $$
declare u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); v uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); snap uuid:=gen_random_uuid(); rev uuid:=gen_random_uuid(); ev uuid:=gen_random_uuid(); ob uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(w,'Synthetic','PERSONAL','ACTIVE',u);
 insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(w,u,'OWNER','ACTIVE');
 insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(c,w,u,'Synthetic','ACTIVE');
 insert into public.jobs(id,canonical_url,state) values(j,'https://job-boards.greenhouse.io/synthetic/jobs/'||abs(hashtext(j::text)),'OPEN');
 insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
 values(v,j,1,repeat('a',64),'Synthetic','Synthetic','Synthetic only','https://job-boards.greenhouse.io/synthetic/jobs/1',now());
 insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(a,w,c,j,v,'DRAFTING');
 set local session_replication_role=replica;
 insert into public.application_runs(id,workspace_id,application_id,run_kind,status,preparation_stage,input_snapshot_id) values(r,w,a,'PREPARATION','WAITING','INPUTS_READY',snap);
 insert into public.application_input_snapshots(id,workspace_id,candidate_id,application_id,preparation_run_id,job_id,job_version_id,tailoring_mode,submission_mode,readiness,snapshot_manifest,snapshot_hash,candidate_input_version,policy_release,assembler_release,blockers)
 values(snap,w,c,a,r,j,v,'AS_UPLOADED','PER_APPLICATION_APPROVAL','BLOCKED','{}',repeat('a',64),1,'check/1','check/1','["fixture"]');
 insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
 values(rev,w,a,1,v,'{}','{}',repeat('c',64),'PASSED',snap,repeat('a',64),gen_random_uuid(),repeat('e',64));
 insert into public.domain_events(id,workspace_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,actor_kind,correlation_id) values(ev,w,'APPLICATION',a,1,'application.drafting_requested','{}','WORKER',r);
 insert into public.outbox(id,workspace_id,event_id,topic,payload,lease_owner,lease_expires_at)
 values(ob,w,ev,'application.drafting_requested',jsonb_build_object('application_id',a,'preparation_run_id',r,'input_snapshot_id',snap,'snapshot_hash',repeat('a',64)),'check',now()+interval '5 minutes');
 set local session_replication_role=origin;
 return jsonb_build_object('candidate',c,'workspace',w,'app',a,'run',r,'snapshot',snap,'revision',rev,'outbox',ob);
end $$;
do $check$
declare f jsonb:=pg_temp.fixture(); history jsonb:='{"release":"application-drafting-repair/2","attempts":[],"failure":"MODEL_CREDITS_EXHAUSTED"}'; ok boolean;
begin
 execute 'set local role service_role';
 ok:=public.fail_application_drafting_terminal((f->>'outbox')::uuid,'check',(f->>'app')::uuid,(f->>'run')::uuid,(f->>'snapshot')::uuid,'MODEL_CREDITS_EXHAUSTED',history);
 if not ok then raise exception 'CHECK_TERMINAL_NOT_RELEASED'; end if;
 ok:=public.fail_application_drafting_terminal((f->>'outbox')::uuid,'check',(f->>'app')::uuid,(f->>'run')::uuid,(f->>'snapshot')::uuid,'MODEL_CREDITS_EXHAUSTED',history);
 execute 'reset role';
 if not ok or not exists(select 1 from public.outbox where id=(f->>'outbox')::uuid and dead_lettered_at is not null and dead_letter_reason='MODEL_CREDITS_EXHAUSTED' and lease_owner is null)
 or (select status from public.applications where id=(f->>'app')::uuid)<>'FAILED_SAFE' then raise exception 'CHECK_TERMINAL_STATE_NOT_ATOMIC'; end if;
 insert into recovery_checks values('terminal_failure_dead_letters_atomically_and_replays',true);
end $check$;
-- Run the actual rate trigger in replica fixture mode; unrelated submission authorization is outside this check.
alter table public.application_attempts enable always trigger auto_apply_actual_submission_rate;
do $check$
declare f jsonb:=pg_temp.fixture(); other jsonb:=pg_temp.fixture(); state jsonb; i integer;
begin
 set local session_replication_role=replica;
 for i in 1..24 loop
  insert into public.application_attempts(workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
  values((f->>'workspace')::uuid,(f->>'app')::uuid,(f->>'revision')::uuid,gen_random_uuid(),'SUBMIT_APPLICATION_ONCE','synthetic:'||gen_random_uuid(),'synthetic/1',case when i=1 then 'CONFIRMED' else 'UNCERTAIN' end,'{}');
 end loop;
 state:=private.auto_apply_state((f->>'candidate')::uuid);
 if state->>'attempted_today'<>'24' or state->>'confirmed_today'<>'1' then raise exception 'CHECK_MANUAL_USAGE_NOT_COUNTED %',state; end if;
 begin
  insert into public.application_attempts(workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
  values((f->>'workspace')::uuid,(f->>'app')::uuid,(f->>'revision')::uuid,gen_random_uuid(),'SUBMIT_APPLICATION_ONCE','synthetic:'||gen_random_uuid(),'synthetic/1','STARTED','{}');
  raise exception 'CHECK_DAILY_CAP_BYPASS';
 exception when object_not_in_prerequisite_state then
  if sqlerrm<>'APPLICATION_DAILY_LIMIT_REACHED' then raise; end if;
 end;
 state:=private.auto_apply_state((other->>'candidate')::uuid);
 if state->>'attempted_today'<>'0' or state->>'confirmed_today'<>'0' then raise exception 'CHECK_OTHER_CANDIDATE_USAGE_LEAK'; end if;
 set local session_replication_role=origin;
 insert into recovery_checks values('manual_usage_unknown_capacity_daily_cap_and_candidate_isolation',true);
end $check$;
select * from recovery_checks order by check_name;
rollback;
