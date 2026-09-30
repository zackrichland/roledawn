-- Local PGlite check for 20260930010000_autopilot_transient_retry.sql.
--   node scripts/migration-harness.mjs supabase/checks/autopilot_transient_retry.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table transient_retry_checks(check_name text primary key, passed boolean not null) on commit drop;

-- One application whose autopilot is running (no submission yet) under a fresh lease.
create function pg_temp.running(p_label text, p_stop text default null) returns jsonb
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
  v_job uuid:=gen_random_uuid(); v_version uuid:=gen_random_uuid(); v_application uuid:=gen_random_uuid(); v_revision uuid:=gen_random_uuid();
  v_autopilot uuid:=gen_random_uuid(); v_lease uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_user,'transient-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Transient check '||p_label,'PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Transient check','ACTIVE');
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://job-boards.greenhouse.io/roledawncheck/jobs/'||abs(hashtext(v_job::text)),'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),'Synthetic role','Synthetic employer','Synthetic only.','https://job-boards.greenhouse.io/roledawncheck/jobs/1',now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(v_application,v_workspace,v_candidate,v_job,v_version,'EXECUTING');
  set local session_replication_role=replica;
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    values(v_revision,v_workspace,v_application,1,v_version,'{}','{}',repeat('c',64),'PASSED',gen_random_uuid(),repeat('d',64),gen_random_uuid(),repeat('e',64));
  insert into public.application_autopilots(id,workspace_id,candidate_id,application_id,revision_id,delegated_by,command_id,packet_hash,destination_url,artifact_manifest,disclosure_manifest,
      status,lease_token,lease_owner,lease_expires_at,stop_requested)
    values(v_autopilot,v_workspace,v_candidate,v_application,v_revision,v_user,gen_random_uuid(),repeat('c',64),'https://job-boards.greenhouse.io/roledawncheck/jobs/1','[]','{}',
      'RUNNING',v_lease,'transient-check',now()+interval '5 minutes',p_stop);
  set local session_replication_role=origin;
  update public.applications set current_revision_id=v_revision where id=v_application;
  return jsonb_build_object('autopilot',v_autopilot,'lease',v_lease,'application',v_application);
end $$;

-- The worker claims the send again: running under a new lease.
create function pg_temp.reclaim(p_fixture jsonb) returns jsonb
language plpgsql as $$
declare v_lease uuid:=gen_random_uuid();
begin
  update public.application_autopilots set status='RUNNING',lease_token=v_lease,lease_owner='transient-check',lease_expires_at=now()+interval '5 minutes'
    where id=(p_fixture->>'autopilot')::uuid;
  return p_fixture||jsonb_build_object('lease',v_lease);
end $$;

create function pg_temp.as_worker_finish(p_fixture jsonb, p_code text) returns void
language plpgsql as $$
begin
  execute 'set local role service_role';
  perform public.finish_application_autopilot((p_fixture->>'autopilot')::uuid,(p_fixture->>'lease')::uuid,'FAILED_SAFE',p_code,null);
  execute 'reset role';
end $$;

do $check$
declare f jsonb:=pg_temp.running('retry'); permanent jsonb:=pg_temp.running('permanent'); stopped jsonb:=pg_temp.running('stopped','PAUSE');
  v_row public.application_autopilots%rowtype;
begin
  -- First provider hiccup: queued again a minute later.
  perform pg_temp.as_worker_finish(f,'OPENAI_AGENTS_ABORTED');
  select * into v_row from public.application_autopilots where id=(f->>'autopilot')::uuid;
  if v_row.status<>'QUEUED' or v_row.transient_retries<>1 or v_row.failure_code is not null or v_row.lease_token is not null
    or v_row.available_at<now()+interval '50 seconds' or v_row.available_at>now()+interval '70 seconds' then raise exception 'CHECK_FIRST_RETRY %',row_to_json(v_row); end if;
  if (select status from public.applications where id=(f->>'application')::uuid)<>'EXECUTING' then raise exception 'CHECK_APPLICATION_NOT_EXECUTING'; end if;
  insert into transient_retry_checks values('first_provider_failure_retries_after_a_minute',true);

  -- Second: five minutes later.
  f:=pg_temp.reclaim(f);
  perform pg_temp.as_worker_finish(f,'APPLICATION_DELIVERY_FAILED');
  select * into v_row from public.application_autopilots where id=(f->>'autopilot')::uuid;
  if v_row.status<>'QUEUED' or v_row.transient_retries<>2 or v_row.available_at<now()+interval '290 seconds' then raise exception 'CHECK_SECOND_RETRY %',row_to_json(v_row); end if;
  insert into transient_retry_checks values('second_provider_failure_retries_after_five_minutes',true);

  -- Third: stops for the candidate with the reason kept.
  f:=pg_temp.reclaim(f);
  perform pg_temp.as_worker_finish(f,'OPENAI_AGENTS_ABORTED');
  select * into v_row from public.application_autopilots where id=(f->>'autopilot')::uuid;
  if v_row.status<>'FAILED_SAFE' or v_row.failure_code<>'OPENAI_AGENTS_ABORTED' then raise exception 'CHECK_THIRD_NOT_STOPPED %',row_to_json(v_row); end if;
  insert into transient_retry_checks values('third_provider_failure_stops_for_the_candidate',true);

  -- A form the worker cannot complete is never retried blindly.
  perform pg_temp.as_worker_finish(permanent,'DELIVERY_REQUIRED_CONTROL_UNSUPPORTED');
  if (select status from public.application_autopilots where id=(permanent->>'autopilot')::uuid)<>'FAILED_SAFE' then raise exception 'CHECK_PERMANENT_RETRIED'; end if;
  insert into transient_retry_checks values('permanent_failures_are_not_retried',true);

  -- A candidate's pause wins over the retry.
  perform pg_temp.as_worker_finish(stopped,'OPENAI_AGENTS_ABORTED');
  if (select status from public.application_autopilots where id=(stopped->>'autopilot')::uuid)='QUEUED' then raise exception 'CHECK_PAUSE_IGNORED'; end if;
  insert into transient_retry_checks values('a_requested_pause_is_not_overridden',true);
end $check$;

select check_name, passed from transient_retry_checks order by check_name;
rollback;
