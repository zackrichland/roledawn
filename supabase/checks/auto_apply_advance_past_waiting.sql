-- Local PGlite check for 20260928200000_auto_apply_advance_past_waiting.sql.
--   node scripts/migration-harness.mjs supabase/checks/auto_apply_advance_past_waiting.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table auto_apply_advance_checks(check_name text primary key, passed boolean not null) on commit drop;

create function pg_temp.check_candidate(p_label text, p_next_submission timestamptz default null) returns uuid
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_user,'auto-apply-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Auto-apply check '||p_label,'PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Auto-apply check '||p_label,'ACTIVE');
  insert into public.candidate_search_profiles(workspace_id,candidate_id,target_roles,desired_country_codes,work_modes,employment_types)
    values(v_workspace,v_candidate,array['Synthetic tester'],array['US'],array['REMOTE'],array['FULL_TIME']);
  -- Standing consent exactly as set_auto_apply_enabled records it.
  insert into public.candidate_auto_apply_settings(candidate_id,workspace_id,enabled,status,version,consent_actor,consented_at,candidate_input_version,search_profile_version,next_submission_at)
    select v_candidate,v_workspace,true,'ACTIVE',1,v_user,now(),c.application_input_version,p.aggregate_version,p_next_submission
    from public.candidates c join public.candidate_search_profiles p on p.candidate_id=c.id where c.id=v_candidate;
  insert into private.auto_apply_runtime(candidate_id) values(v_candidate);
  return v_candidate;
end $$;

-- One job, application and enrollment. The destination is deliberately not a
-- supported ATS so an attempted delegation fails instead of doing anything.
create function pg_temp.check_enroll(p_candidate uuid,p_status text,p_age interval,p_order integer) returns uuid
language plpgsql as $$
declare v_job uuid:=gen_random_uuid(); v_version uuid:=gen_random_uuid(); v_application uuid:=gen_random_uuid();
  c public.candidates%rowtype; s public.candidate_auto_apply_settings%rowtype;
begin
  select * into strict c from public.candidates where id=p_candidate;
  select * into strict s from public.candidate_auto_apply_settings where candidate_id=p_candidate;
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://synthetic-check.invalid/jobs/'||v_job,'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),'Synthetic check role','Synthetic employer','Synthetic only.','https://synthetic-check.invalid/jobs/'||v_job,now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status,created_at,updated_at)
    values(v_application,c.workspace_id,c.id,v_job,v_version,p_status,now()-p_age,now()-p_age);
  insert into public.auto_apply_enrollments(application_id,workspace_id,candidate_id,job_id,job_version_id,consent_version,candidate_input_version,search_profile_version,profile_hash,matching_policy,matching_decision,created_at)
    values(v_application,c.workspace_id,c.id,v_job,v_version,s.version,s.candidate_input_version,s.search_profile_version,repeat('a',64),'synthetic-check/1','{}'::jsonb,now()-interval '1 day'+make_interval(mins=>p_order));
  return v_application;
end $$;

-- A current packet revision, and optionally a delegated autopilot row. Only
-- these fixtures bypass the revision/packet insert guards (replica mode); the
-- functions under test run normally.
create function pg_temp.check_revision(p_application uuid) returns uuid
language plpgsql as $$
declare a public.applications%rowtype; v_revision uuid:=gen_random_uuid();
begin
  select * into strict a from public.applications where id=p_application;
  set local session_replication_role=replica;
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    values(v_revision,a.workspace_id,a.id,1,a.job_version_id,'{}','{}',repeat('c',64),'PASSED',gen_random_uuid(),repeat('d',64),gen_random_uuid(),repeat('e',64));
  set local session_replication_role=origin;
  -- Keep the fixture's age: the revision itself is not application progress.
  update public.applications set current_revision_id=v_revision,updated_at=a.updated_at where id=a.id;
  return v_revision;
end $$;

create function pg_temp.check_autopilot(p_application uuid,p_status text default 'QUEUED') returns void
language plpgsql as $$
declare a public.applications%rowtype; v_revision uuid:=pg_temp.check_revision(p_application); v_user uuid;
begin
  select * into strict a from public.applications where id=p_application;
  select auth_user_id into strict v_user from public.candidates where id=a.candidate_id;
  set local session_replication_role=replica;
  insert into public.application_autopilots(workspace_id,candidate_id,application_id,revision_id,delegated_by,command_id,packet_hash,destination_url,artifact_manifest,disclosure_manifest,status)
    values(a.workspace_id,a.candidate_id,a.id,v_revision,v_user,gen_random_uuid(),repeat('c',64),'https://job-boards.greenhouse.io/roledawncheck/jobs/1','[]','{}',p_status);
  set local session_replication_role=origin;
end $$;

-- Claim the due candidate as the worker would, returning the lease token.
create function pg_temp.check_claim(p_candidate uuid) returns uuid
language plpgsql as $$
declare v_claim jsonb;
begin
  update public.candidate_auto_apply_settings set next_check_at=now() where candidate_id=p_candidate;
  update private.auto_apply_runtime set lease_token=null,lease_expires_at=null,lease_owner=null where candidate_id=p_candidate;
  execute 'set local role service_role';
  v_claim:=public.claim_auto_apply_candidate('auto-apply-check',p_candidate);
  execute 'reset role';
  if v_claim is null then raise exception 'CHECK_CLAIM_MISSING'; end if;
  return (v_claim->>'lease_token')::uuid;
end $$;

create function pg_temp.check_advance(p_candidate uuid) returns text
language plpgsql as $$
declare v_token uuid:=pg_temp.check_claim(p_candidate); v_result jsonb;
begin
  execute 'set local role service_role';
  v_result:=public.advance_auto_apply_candidate(p_candidate,v_token,1);
  if not public.finish_auto_apply_check(p_candidate,v_token,case when v_result->>'outcome'='SELECT_MATCH' then 'NO_MATCHES' else v_result->>'outcome' end) then
    raise exception 'CHECK_FINISH_REJECTED';
  end if;
  execute 'reset role';
  return v_result->>'outcome';
end $$;

create function pg_temp.check_reason(p_application uuid) returns text
language sql as $$ select coalesce(close_reason,'OPEN') from public.auto_apply_enrollments where application_id=p_application $$;

do $check$
declare c uuid; a1 uuid; a2 uuid; a3 uuid; v_status text; v_outcome text; v_token uuid; v_version uuid:=gen_random_uuid();
  v_decision jsonb:=jsonb_build_object('autoApplyEligible',true,'band','STRONG','jobVersionId',v_version,'profileHash',repeat('a',64),'policyVersion','synthetic-check/1','jobContentHash',repeat('b',64));
begin
  -- In-progress work under automation still holds the account.
  foreach v_status in array array['DRAFTING','AUTHORIZED','EXECUTING'] loop
    c:=pg_temp.check_candidate('recent '||v_status); a1:=pg_temp.check_enroll(c,v_status,interval '10 minutes',1);
    v_outcome:=pg_temp.check_advance(c);
    if v_outcome<>'WAITING_APPLICATION' or pg_temp.check_reason(a1)<>'OPEN' then raise exception 'CHECK_IN_PROGRESS_% -> % / %',v_status,v_outcome,pg_temp.check_reason(a1); end if;
  end loop;
  c:=pg_temp.check_candidate('ready delegated'); a1:=pg_temp.check_enroll(c,'READY',interval '10 minutes',1); perform pg_temp.check_autopilot(a1);
  v_outcome:=pg_temp.check_advance(c);
  if v_outcome<>'WAITING_APPLICATION' or pg_temp.check_reason(a1)<>'OPEN' then raise exception 'CHECK_READY_DELEGATED -> %',v_outcome; end if;
  insert into auto_apply_advance_checks values('in_progress_drafting_ready_authorized_executing_still_wait',true);

  -- The account's own send interval is not a stall, even for an older READY packet.
  c:=pg_temp.check_candidate('ready rate limited',now()+interval '30 minutes'); a1:=pg_temp.check_enroll(c,'READY',interval '3 hours',1);
  v_outcome:=pg_temp.check_advance(c);
  if v_outcome<>'RATE_LIMITED' or pg_temp.check_reason(a1)<>'OPEN' then raise exception 'CHECK_READY_RATE_LIMITED -> %',v_outcome; end if;
  -- A recent delegation failure is still surfaced and retried by the next check.
  c:=pg_temp.check_candidate('ready recent failure'); a1:=pg_temp.check_enroll(c,'READY',interval '10 minutes',1); perform pg_temp.check_revision(a1);
  begin
    v_outcome:=pg_temp.check_advance(c);
    raise exception 'CHECK_RECENT_DELEGATION_FAILURE_SWALLOWED';
  exception when others then if sqlerrm<>'AUTO_APPLY_DESTINATION_UNSUPPORTED' then raise; end if; end;
  execute 'reset role';
  if pg_temp.check_reason(a1)<>'OPEN' or exists(select 1 from public.application_autopilots where application_id=a1) then raise exception 'CHECK_RECENT_DELEGATION_FAILURE_CLOSED'; end if;
  insert into auto_apply_advance_checks values('own_rate_limit_and_recent_delegation_failure_do_not_close',true);

  -- Waiting on the candidate, uncertain submissions and terminal outcomes stop blocking.
  foreach v_status in array array['NEEDS_USER','TAKEOVER','RECONCILING','PRE_SUBMIT_REVIEW','CONFIRMED','FAILED_SAFE','SKIPPED','CANCELED'] loop
    c:=pg_temp.check_candidate('closing '||v_status); a1:=pg_temp.check_enroll(c,v_status,interval '5 minutes',1);
    v_outcome:=pg_temp.check_advance(c);
    if v_outcome<>'SELECT_MATCH' or pg_temp.check_reason(a1)<>v_status
      or not exists(select 1 from public.auto_apply_enrollments where application_id=a1 and closed_at is not null) then
      raise exception 'CHECK_CLOSING_% -> % / %',v_status,v_outcome,pg_temp.check_reason(a1);
    end if;
    if (select status from public.applications where id=a1)<>v_status then raise exception 'CHECK_APPLICATION_STATUS_CHANGED_%',v_status; end if;
  end loop;
  insert into auto_apply_advance_checks values('candidate_wait_uncertain_and_terminal_statuses_close_with_reason',true);

  -- Two hours without application progress stops blocking (for example DRAFTING
  -- after a dead-lettered message, or a delegated run that never advanced).
  foreach v_status in array array['DRAFTING','AUTHORIZED','EXECUTING'] loop
    c:=pg_temp.check_candidate('stale '||v_status); a1:=pg_temp.check_enroll(c,v_status,interval '2 hours 1 minute',1);
    v_outcome:=pg_temp.check_advance(c);
    if v_outcome<>'SELECT_MATCH' or pg_temp.check_reason(a1)<>'NO_PROGRESS' then raise exception 'CHECK_STALE_% -> % / %',v_status,v_outcome,pg_temp.check_reason(a1); end if;
  end loop;
  c:=pg_temp.check_candidate('stale ready delegated'); a1:=pg_temp.check_enroll(c,'READY',interval '3 hours',1); perform pg_temp.check_autopilot(a1,'FAILED_SAFE');
  if pg_temp.check_advance(c)<>'SELECT_MATCH' or pg_temp.check_reason(a1)<>'NO_PROGRESS' then raise exception 'CHECK_STALE_READY_DELEGATED'; end if;
  c:=pg_temp.check_candidate('stale ready undeliverable'); a1:=pg_temp.check_enroll(c,'READY',interval '3 hours',1); perform pg_temp.check_revision(a1);
  if pg_temp.check_advance(c)<>'SELECT_MATCH' or pg_temp.check_reason(a1)<>'NO_PROGRESS' or exists(select 1 from public.application_autopilots where application_id=a1) then
    raise exception 'CHECK_STALE_READY_UNDELIVERABLE';
  end if;
  insert into auto_apply_advance_checks values('two_hours_without_progress_closes_as_no_progress',true);

  -- Oldest first: non-blocking enrollments close, then the moving one is awaited.
  c:=pg_temp.check_candidate('mixed');
  a1:=pg_temp.check_enroll(c,'NEEDS_USER',interval '5 minutes',1);
  a2:=pg_temp.check_enroll(c,'DRAFTING',interval '3 hours',2);
  a3:=pg_temp.check_enroll(c,'EXECUTING',interval '10 minutes',3);
  v_outcome:=pg_temp.check_advance(c);
  if v_outcome<>'WAITING_APPLICATION' or pg_temp.check_reason(a1)<>'NEEDS_USER' or pg_temp.check_reason(a2)<>'NO_PROGRESS' or pg_temp.check_reason(a3)<>'OPEN' then
    raise exception 'CHECK_MIXED -> % / % / % / %',v_outcome,pg_temp.check_reason(a1),pg_temp.check_reason(a2),pg_temp.check_reason(a3);
  end if;
  -- A new match is still refused while one enrollment is moving.
  v_token:=pg_temp.check_claim(c);
  execute 'set local role service_role';
  begin
    perform public.enqueue_auto_apply_match(c,v_token,1,gen_random_uuid(),v_version,repeat('a',64),'synthetic-check/1',v_decision);
    raise exception 'CHECK_ENQUEUE_ACTIVE_ACCEPTED';
  exception when others then if sqlerrm<>'AUTO_APPLY_APPLICATION_ACTIVE' then raise; end if; end;
  execute 'reset role';
  insert into auto_apply_advance_checks values('oldest_first_closes_then_waits_on_moving_enrollment',true);

  -- Closing is permanent: the answered application moving again never re-blocks.
  update public.applications set status='DRAFTING',updated_at=now() where id=a1;
  update public.applications set status='CONFIRMED',updated_at=now() where id=a3;
  v_outcome:=pg_temp.check_advance(c);
  if v_outcome<>'SELECT_MATCH' or pg_temp.check_reason(a1)<>'NEEDS_USER' or pg_temp.check_reason(a3)<>'CONFIRMED' then
    raise exception 'CHECK_CLOSE_PERMANENT -> % / % / %',v_outcome,pg_temp.check_reason(a1),pg_temp.check_reason(a3);
  end if;
  -- With nothing open, the enqueue guard passes and job availability is checked next.
  v_token:=pg_temp.check_claim(c);
  execute 'set local role service_role';
  begin
    perform public.enqueue_auto_apply_match(c,v_token,1,gen_random_uuid(),v_version,repeat('a',64),'synthetic-check/1',v_decision);
    raise exception 'CHECK_ENQUEUE_REACHED_UNKNOWN_JOB';
  exception when others then if sqlerrm<>'AUTO_APPLY_JOB_UNAVAILABLE' then raise; end if; end;
  execute 'reset role';
  insert into auto_apply_advance_checks values('closed_enrollments_never_reopen_and_admit_next_match',true);

  -- Enrollment identity, consent and matching evidence stay immutable; the close is written once.
  begin update public.auto_apply_enrollments set consent_version=consent_version+1 where application_id=a3; raise exception 'CHECK_ENROLLMENT_MUTATED';
  exception when sqlstate '55000' then null; end;
  begin update public.auto_apply_enrollments set close_reason='TAKEOVER' where application_id=a1; raise exception 'CHECK_CLOSE_REWRITTEN';
  exception when sqlstate '55000' then null; end;
  c:=pg_temp.check_candidate('immutable'); a1:=pg_temp.check_enroll(c,'DRAFTING',interval '10 minutes',1);
  begin update public.auto_apply_enrollments set closed_at=now(),close_reason='NO_PROGRESS',matching_policy='rewritten/1' where application_id=a1; raise exception 'CHECK_CLOSE_WITH_EDIT';
  exception when sqlstate '55000' then null; end;
  begin update public.auto_apply_enrollments set closed_at=now() where application_id=a1; raise exception 'CHECK_CLOSE_WITHOUT_REASON';
  exception when sqlstate '55000' then null; end;
  begin update public.auto_apply_enrollments set closed_at=now(),close_reason='GUESSED' where application_id=a1; raise exception 'CHECK_UNKNOWN_REASON';
  exception when check_violation then null; end;
  insert into auto_apply_advance_checks values('enrollment_evidence_immutable_and_close_written_once',true);

  -- Lease and standing-consent checks are unchanged.
  v_token:=pg_temp.check_claim(c);
  execute 'set local role service_role';
  begin perform public.advance_auto_apply_candidate(c,gen_random_uuid(),1); raise exception 'CHECK_BAD_LEASE_ACCEPTED';
  exception when sqlstate '55000' then if sqlerrm<>'AUTO_APPLY_LEASE_INACTIVE' then raise; end if; end;
  begin perform public.advance_auto_apply_candidate(c,v_token,2); raise exception 'CHECK_STALE_CONSENT_ACCEPTED';
  exception when sqlstate '55000' then if sqlerrm<>'AUTO_APPLY_CONSENT_INACTIVE' then raise; end if; end;
  execute 'reset role';
  update public.candidate_auto_apply_settings set enabled=false,status='OFF' where candidate_id=c;
  execute 'set local role service_role';
  begin perform public.advance_auto_apply_candidate(c,v_token,1); raise exception 'CHECK_WITHDRAWN_CONSENT_ACCEPTED';
  exception when sqlstate '55000' then if sqlerrm<>'AUTO_APPLY_CONSENT_INACTIVE' then raise; end if; end;
  execute 'reset role';
  insert into auto_apply_advance_checks values('lease_and_consent_checks_unchanged',true);

  -- Security properties and the actual-submission rate gate are preserved.
  if not (select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.advance_auto_apply_candidate(uuid,uuid,bigint)'::regprocedure)
    or not (select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb)'::regprocedure)
    or (select prosecdef or proconfig<>array['search_path=""'] from pg_proc where oid='private.guard_auto_apply_enrollment_update()'::regprocedure) then
    raise exception 'CHECK_FUNCTION_SECURITY_CHANGED';
  end if;
  if has_function_privilege('anon','public.advance_auto_apply_candidate(uuid,uuid,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.advance_auto_apply_candidate(uuid,uuid,bigint)','EXECUTE')
    or not has_function_privilege('service_role','public.advance_auto_apply_candidate(uuid,uuid,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb)','EXECUTE')
    or has_function_privilege('service_role','private.guard_auto_apply_enrollment_update()','EXECUTE')
    or has_function_privilege('authenticated','private.guard_auto_apply_enrollment_update()','EXECUTE')
    or has_table_privilege('authenticated','public.auto_apply_enrollments','UPDATE')
    or has_table_privilege('service_role','public.auto_apply_enrollments','UPDATE') then
    raise exception 'CHECK_GRANTS_CHANGED';
  end if;
  if not exists(select 1 from pg_trigger where tgname='auto_apply_actual_submission_rate' and tgrelid='public.application_attempts'::regclass
      and tgfoid='private.enforce_auto_apply_submission_rate()'::regprocedure and not tgisinternal)
    or position('used>=plan.daily_cap' in pg_get_functiondef('private.enforce_auto_apply_submission_rate()'::regprocedure))=0 then
    raise exception 'CHECK_RATE_TRIGGER_CHANGED';
  end if;
  if position('p_decision->>''jobContentHash''=v.content_hash' in pg_get_functiondef('public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb)'::regprocedure))=0 then
    raise exception 'CHECK_CONTENT_HASH_BINDING_LOST';
  end if;
  insert into auto_apply_advance_checks values('security_definer_grants_rate_trigger_and_content_binding_preserved',true);
end $check$;

select check_name, passed from auto_apply_advance_checks order by check_name;
rollback;
