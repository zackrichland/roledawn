-- Local PGlite check for 20260929230000_autopilot_not_accepted_retry.sql.
--   node scripts/migration-harness.mjs supabase/checks/autopilot_not_accepted_retry.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table autopilot_not_accepted_checks(check_name text primary key, passed boolean not null) on commit drop;

-- A candidate with one application whose autopilot holds a started submit attempt.
create function pg_temp.submitting(p_label text, p_stop text default null) returns jsonb
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
  v_job uuid:=gen_random_uuid(); v_version uuid:=gen_random_uuid(); v_application uuid:=gen_random_uuid(); v_revision uuid:=gen_random_uuid();
  v_attempt uuid:=gen_random_uuid(); v_autopilot uuid:=gen_random_uuid(); v_lease uuid:=gen_random_uuid(); v_consumption uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_user,'not-accepted-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Not accepted check '||p_label,'PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Not accepted check '||p_label,'ACTIVE');
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://job-boards.greenhouse.io/roledawncheck/jobs/'||abs(hashtext(v_job::text)),'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),'Synthetic role','Synthetic employer','Synthetic only.','https://job-boards.greenhouse.io/roledawncheck/jobs/1',now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(v_application,v_workspace,v_candidate,v_job,v_version,'RECONCILING');
  -- Fixture rows only bypass the packet/attempt guards (replica mode); the functions under test run normally.
  set local session_replication_role=replica;
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    values(v_revision,v_workspace,v_application,1,v_version,'{}','{}',repeat('c',64),'PASSED',gen_random_uuid(),repeat('d',64),gen_random_uuid(),repeat('e',64));
  insert into public.approval_consumptions(id,workspace_id,approval_id,application_id,revision_id,consumed_by,command_id,permitted_action)
    values(v_consumption,v_workspace,gen_random_uuid(),v_application,v_revision,v_user,v_autopilot,'SUBMIT_APPLICATION_ONCE');
  insert into public.application_attempts(id,workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
    values(v_attempt,v_workspace,v_application,v_revision,v_consumption,'SUBMIT_APPLICATION_ONCE','autopilot:'||v_autopilot,'application-delivery/1','STARTED','{}');
  insert into public.application_autopilots(id,workspace_id,candidate_id,application_id,revision_id,delegated_by,command_id,packet_hash,destination_url,artifact_manifest,disclosure_manifest,
      status,sealed_diff,sealed_diff_hash,readback_hash,request_fingerprint,attempt_id,lease_token,lease_owner,lease_expires_at,stop_requested)
    values(v_autopilot,v_workspace,v_candidate,v_application,v_revision,v_user,gen_random_uuid(),repeat('c',64),'https://job-boards.greenhouse.io/roledawncheck/jobs/1','[]','{}',
      'SUBMITTING','{}',repeat('1',64),repeat('2',64),repeat('3',64),v_attempt,v_lease,'not-accepted-check',now()+interval '2 minutes',p_stop);
  insert into private.application_autopilot_runtime(autopilot_id) values(v_autopilot);
  set local session_replication_role=origin;
  update public.applications set current_revision_id=v_revision where id=v_application;
  return jsonb_build_object('user',v_user,'workspace',v_workspace,'autopilot',v_autopilot,'lease',v_lease,'application',v_application,'attempt',v_attempt,'revision',v_revision);
end $$;

-- Puts a second started attempt on the same autopilot, as a retry's submit would.
create function pg_temp.resubmitting(p_fixture jsonb) returns jsonb
language plpgsql as $$
declare v_attempt uuid:=gen_random_uuid(); v_lease uuid:=gen_random_uuid(); v_consumption uuid:=gen_random_uuid();
begin
  set local session_replication_role=replica;
  insert into public.approval_consumptions(id,workspace_id,approval_id,application_id,revision_id,consumed_by,command_id,permitted_action)
    values(v_consumption,(p_fixture->>'workspace')::uuid,gen_random_uuid(),(p_fixture->>'application')::uuid,(p_fixture->>'revision')::uuid,(p_fixture->>'user')::uuid,gen_random_uuid(),'SUBMIT_APPLICATION_ONCE');
  insert into public.application_attempts(id,workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
    values(v_attempt,(p_fixture->>'workspace')::uuid,(p_fixture->>'application')::uuid,(p_fixture->>'revision')::uuid,v_consumption,'SUBMIT_APPLICATION_ONCE',
      'autopilot:'||(p_fixture->>'autopilot')||':1','application-delivery/1','STARTED','{}');
  set local session_replication_role=origin;
  update public.application_autopilots set status='SUBMITTING',attempt_id=v_attempt,lease_token=v_lease,lease_owner='not-accepted-check',
    lease_expires_at=now()+interval '2 minutes',sealed_diff='{}',sealed_diff_hash=repeat('1',64),readback_hash=repeat('2',64),request_fingerprint=repeat('3',64)
    where id=(p_fixture->>'autopilot')::uuid;
  return p_fixture||jsonb_build_object('attempt',v_attempt,'lease',v_lease);
end $$;

create function pg_temp.as_worker_finish(p_fixture jsonb, p_outcome text, p_code text) returns void
language plpgsql as $$
begin
  execute 'set local role service_role';
  perform public.finish_application_autopilot((p_fixture->>'autopilot')::uuid,(p_fixture->>'lease')::uuid,p_outcome,p_code,null);
  execute 'reset role';
end $$;

do $check$
declare f jsonb:=pg_temp.submitting('main'); unknown jsonb:=pg_temp.submitting('unknown'); stopped jsonb:=pg_temp.submitting('stopped','CANCEL');
  guard jsonb:=pg_temp.submitting('guard'); v_row public.application_autopilots%rowtype; v_attempt public.application_attempts%rowtype;
begin
  -- The employer's unmet code challenge closes the attempt and queues one automatic retry.
  perform pg_temp.as_worker_finish(f,'NOT_ACCEPTED','DELIVERY_EMAIL_VERIFICATION_TIMEOUT');
  select * into v_attempt from public.application_attempts where id=(f->>'attempt')::uuid;
  select * into v_row from public.application_autopilots where id=(f->>'autopilot')::uuid;
  if v_attempt.status<>'NOT_ACCEPTED' or v_attempt.completed_at is null or v_attempt.result_summary->>'not_accepted_reason'<>'DELIVERY_EMAIL_VERIFICATION_TIMEOUT' then raise exception 'CHECK_ATTEMPT_NOT_CLOSED %',row_to_json(v_attempt); end if;
  if v_row.status<>'QUEUED' or v_row.attempt_id is not null or v_row.sealed_diff_hash is not null or v_row.request_fingerprint is not null
    or v_row.failure_code is not null or v_row.lease_token is not null or v_row.available_at<=now() then raise exception 'CHECK_NOT_REQUEUED %',row_to_json(v_row); end if;
  if (select status from public.applications where id=(f->>'application')::uuid)<>'EXECUTING' then raise exception 'CHECK_APPLICATION_NOT_EXECUTING'; end if;
  insert into autopilot_not_accepted_checks values('first_refusal_closes_attempt_and_retries_once',true);

  -- A second refusal stops for the candidate, with the reason kept for the page.
  f:=pg_temp.resubmitting(f);
  perform pg_temp.as_worker_finish(f,'NOT_ACCEPTED','DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED');
  select * into v_row from public.application_autopilots where id=(f->>'autopilot')::uuid;
  if v_row.status<>'FAILED_SAFE' or v_row.failure_code<>'DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED' or v_row.attempt_id is not null then raise exception 'CHECK_SECOND_REFUSAL %',row_to_json(v_row); end if;
  if (select status from public.applications where id=(f->>'application')::uuid)<>'FAILED_SAFE' then raise exception 'CHECK_APPLICATION_NOT_STOPPED'; end if;
  if (select count(*) from public.application_attempts where application_id=(f->>'application')::uuid and status='NOT_ACCEPTED')<>2 then raise exception 'CHECK_ATTEMPTS_NOT_KEPT'; end if;
  insert into autopilot_not_accepted_checks values('second_refusal_stops_for_the_candidate',true);

  -- A requested stop wins over the automatic retry.
  perform pg_temp.as_worker_finish(stopped,'NOT_ACCEPTED','DELIVERY_EMAIL_VERIFICATION_TIMEOUT');
  if (select status from public.application_autopilots where id=(stopped->>'autopilot')::uuid)<>'CANCELED' then raise exception 'CHECK_STOP_IGNORED'; end if;
  insert into autopilot_not_accepted_checks values('requested_stop_wins_over_retry',true);

  -- Only the two explicit code outcomes can close an attempt this way.
  begin perform pg_temp.as_worker_finish(guard,'NOT_ACCEPTED','DELIVERY_RECEIPT_UNVERIFIED'); raise exception 'CHECK_OTHER_CODE_ACCEPTED';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_COMPLETION_INVALID' then raise; end if; end;
  begin perform pg_temp.as_worker_finish(guard,'NOT_ACCEPTED',null); raise exception 'CHECK_NULL_CODE_ACCEPTED';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_COMPLETION_INVALID' then raise; end if; end;
  if (select status from public.application_attempts where id=(guard->>'attempt')::uuid)<>'STARTED' then raise exception 'CHECK_GUARD_CHANGED_ATTEMPT'; end if;
  insert into autopilot_not_accepted_checks values('only_explicit_code_outcomes_close_attempts',true);

  -- An unknown outcome still leaves the attempt for reconciliation, exactly as before.
  perform pg_temp.as_worker_finish(unknown,'UNCERTAIN','DELIVERY_RECEIPT_UNVERIFIED');
  if (select status from public.application_attempts where id=(unknown->>'attempt')::uuid)<>'UNCERTAIN'
    or (select status from public.application_autopilots where id=(unknown->>'autopilot')::uuid)<>'UNCERTAIN'
    or (select status from public.applications where id=(unknown->>'application')::uuid)<>'RECONCILING' then raise exception 'CHECK_UNCERTAIN_CHANGED'; end if;
  insert into autopilot_not_accepted_checks values('unknown_outcomes_still_reconcile',true);

  -- Archiving hides an application without touching its history.
  update public.applications set archived_at=now() where id=(unknown->>'application')::uuid;
  if (select count(*) from public.application_attempts where application_id=(unknown->>'application')::uuid)<>1 then raise exception 'CHECK_ARCHIVE_LOST_HISTORY'; end if;
  insert into autopilot_not_accepted_checks values('archive_keeps_history',true);
end $check$;

select check_name, passed from autopilot_not_accepted_checks order by check_name;
rollback;
