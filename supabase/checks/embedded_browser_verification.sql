-- Local PGlite checks for remembered answers and D-122 job-context restrictions.
--   node scripts/migration-harness.mjs supabase/checks/autopilot_remembered_answers.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table browser_verification_checks(check_name text primary key, passed boolean not null) on commit drop;

create function pg_temp.candidate() returns jsonb
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_user,'remembered-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Remembered check','PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Remembered check','ACTIVE');
  return jsonb_build_object('user',v_user,'workspace',v_workspace,'candidate',v_candidate);
end $$;

-- One application with a running autopilot that holds a fresh lease.
create function pg_temp.running(p_who jsonb) returns jsonb
language plpgsql as $$
declare v_job uuid:=gen_random_uuid(); v_version uuid:=gen_random_uuid(); v_application uuid:=gen_random_uuid(); v_revision uuid:=gen_random_uuid();
  v_snapshot uuid:=gen_random_uuid(); v_autopilot uuid:=gen_random_uuid(); v_lease uuid:=gen_random_uuid();
  v_workspace uuid:=(p_who->>'workspace')::uuid; v_candidate uuid:=(p_who->>'candidate')::uuid; v_user uuid:=(p_who->>'user')::uuid;
begin
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://job-boards.greenhouse.io/roledawncheck/jobs/'||abs(hashtext(v_job::text)),'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),coalesce(p_who->>'role_title','Synthetic role'),coalesce(p_who->>'employer','Synthetic employer'),'Synthetic only.','https://job-boards.greenhouse.io/roledawncheck/jobs/1',now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(v_application,v_workspace,v_candidate,v_job,v_version,'EXECUTING');
  set local session_replication_role=replica;
  insert into public.application_input_snapshots(id,workspace_id,candidate_id,application_id,preparation_run_id,job_id,job_version_id,tailoring_mode,submission_mode,readiness,snapshot_manifest,snapshot_hash,candidate_input_version,policy_release,assembler_release,blockers)
    values(v_snapshot,v_workspace,v_candidate,v_application,gen_random_uuid(),v_job,v_version,'AS_UPLOADED','PER_APPLICATION_APPROVAL','BLOCKED','{}',repeat('a',64),
      (select application_input_version from public.candidates where id=v_candidate),'check/1','check/1','["fixture"]');
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    values(v_revision,v_workspace,v_application,1,v_version,'{}','{}',repeat('c',64),'PASSED',v_snapshot,repeat('a',64),gen_random_uuid(),repeat('e',64));
  insert into public.application_autopilots(id,workspace_id,candidate_id,application_id,revision_id,delegated_by,command_id,packet_hash,destination_url,artifact_manifest,disclosure_manifest,
      status,lease_token,lease_owner,lease_expires_at)
    values(v_autopilot,v_workspace,v_candidate,v_application,v_revision,v_user,gen_random_uuid(),repeat('c',64),'https://job-boards.greenhouse.io/roledawncheck/jobs/1','[]','{}',
      'RUNNING',v_lease,'remembered-check',now()+interval '5 minutes');
  insert into private.application_autopilot_runtime(autopilot_id) values(v_autopilot);
  set local session_replication_role=origin;
  update public.applications set current_revision_id=v_revision where id=v_application;
  return p_who||jsonb_build_object('autopilot',v_autopilot,'lease',v_lease,'application',v_application);
end $$;


do $check$
declare who jsonb:=pg_temp.candidate(); other jsonb:=pg_temp.candidate(); run jsonb; n integer;
begin
 run:=pg_temp.running(who);
 update private.application_autopilot_runtime set runtime_reference='synthetic-provider-reference',runtime_lease=(run->>'lease')::uuid,
  checkpoint=jsonb_build_object('browserVerificationExpiresAt',now()+interval '3 minutes','browserExpiresAt',now()+interval '5 minutes') where autopilot_id=(run->>'autopilot')::uuid;
 perform set_config('request.jwt.claim.sub',who->>'user',true);
 execute 'set local role authenticated';
 select count(*) into n from public.read_application_browser_checks((run->>'application')::uuid);
 if n<>1 then raise exception 'CHECK_OWNER_MISSING'; end if;
 begin
  perform public.get_application_browser_check_binding((run->>'application')::uuid,(who->>'user')::uuid);
  raise exception 'CHECK_PROVIDER_VISIBLE';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',other->>'user',true);
 execute 'set local role authenticated';
 select count(*) into n from public.read_application_browser_checks(null);
 if n<>0 then raise exception 'CHECK_CROSS_CANDIDATE'; end if;
 execute 'reset role';
 execute 'set local role service_role';
 select count(*) into n from public.get_application_browser_check_binding((run->>'application')::uuid,(who->>'user')::uuid);
 if n<>1 then raise exception 'CHECK_WORKER_BINDING_MISSING'; end if;
 select count(*) into n from public.get_application_browser_check_binding((run->>'application')::uuid,(other->>'user')::uuid);
 if n<>0 then raise exception 'CHECK_WRONG_ACTOR'; end if;
 execute 'reset role';
 update public.application_autopilots set stop_requested='PAUSE' where id=(run->>'autopilot')::uuid;
 select count(*) into n from public.get_application_browser_check_binding((run->>'application')::uuid,(who->>'user')::uuid);
 if n<>0 then raise exception 'CHECK_PAUSE_EXPOSES_BROWSER'; end if;
 update public.application_autopilots set stop_requested=null where id=(run->>'autopilot')::uuid;
 update private.application_autopilot_runtime set checkpoint=checkpoint||jsonb_build_object('browserVerificationExpiresAt',now()-interval '1 second') where autopilot_id=(run->>'autopilot')::uuid;
 select count(*) into n from public.get_application_browser_check_binding((run->>'application')::uuid,(who->>'user')::uuid);
 if n<>0 then raise exception 'CHECK_EXPIRED_EXPOSES_BROWSER'; end if;
 update private.application_autopilot_runtime set checkpoint=checkpoint||jsonb_build_object('browserVerificationExpiresAt',now()+interval '3 minutes'),runtime_lease=gen_random_uuid() where autopilot_id=(run->>'autopilot')::uuid;
 select count(*) into n from public.get_application_browser_check_binding((run->>'application')::uuid,(who->>'user')::uuid);
 if n<>0 then raise exception 'CHECK_STALE_LEASE_EXPOSES_BROWSER'; end if;
 if (select count(*) from public.application_attempts where application_id=(run->>'application')::uuid)<>0 then raise exception 'CHECK_CREATED_ATTEMPT'; end if;
 insert into browser_verification_checks values('owned_live_check_private_binding_pause_expiry_stale_lease_and_no_attempt',true);
end $check$;
select * from browser_verification_checks;
rollback;
