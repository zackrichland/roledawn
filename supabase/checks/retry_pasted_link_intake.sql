-- Local PGlite check for 20260928220000_retry_pasted_link_intake.sql.
begin;
create function pg_temp.retry_candidate(p_user uuid) returns uuid language plpgsql as $$
declare v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(p_user,'retry-intake-'||p_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Retry check','PERSONAL','ACTIVE',p_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,p_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,p_user,'Retry check','ACTIVE');
  return v_candidate;
end $$;

do $$ declare
  v_one uuid := '41111111-1111-4111-8111-111111111111';
  v_two uuid := '42222222-2222-4222-8222-222222222222';
  c1 uuid; c2 uuid; w1 uuid; v_intake uuid := gen_random_uuid(); v_app uuid := gen_random_uuid(); r record;
begin
  c1 := pg_temp.retry_candidate(v_one);
  c2 := pg_temp.retry_candidate(v_two);
  select workspace_id into strict w1 from public.candidates where id = c1;
  insert into public.job_intakes(id,workspace_id,candidate_id,canonical_url,status,failure_code,command_id)
    values(v_intake,w1,c1,'https://job-boards.greenhouse.io/synthetic/jobs/1','FAILED','PAYLOAD_INVALID',gen_random_uuid());
  insert into public.applications(id,workspace_id,candidate_id,job_intake_id,status,aggregate_version)
    values(v_app,w1,c1,v_intake,'FAILED_SAFE',2);

  -- Another candidate cannot retry it.
  perform set_config('request.jwt.claim.sub', v_two::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    perform public.retry_pasted_link_intake('f0000000-0000-4000-8000-000000000001', v_app);
    raise exception 'EXPECTED_NOT_FOUND';
  exception when others then if sqlerrm <> 'APPLICATION_NOT_FOUND' then raise; end if; end;
  execute 'reset role';

  -- The owner retries; the same command replays; the intake is reused.
  perform set_config('request.jwt.claim.sub', v_one::text, true);
  execute 'set local role authenticated';
  select * into strict r from public.retry_pasted_link_intake('f0000000-0000-4000-8000-000000000002', v_app);
  assert not r.replayed and r.aggregate_version = 3, 'retry committed';
  select * into strict r from public.retry_pasted_link_intake('f0000000-0000-4000-8000-000000000002', v_app);
  assert r.replayed and r.aggregate_version = 3, 'retry replays';
  begin
    perform public.retry_pasted_link_intake('f0000000-0000-4000-8000-000000000003', v_app);
    raise exception 'EXPECTED_NOT_RETRYABLE';
  exception when others then if sqlerrm <> 'INTAKE_NOT_RETRYABLE' then raise; end if; end;
  execute 'reset role';

  assert (select status from public.job_intakes where id = v_intake) = 'PENDING', 'intake pending again';
  assert (select failure_code is null from public.job_intakes where id = v_intake), 'failure cleared';
  assert (select status from public.applications where id = v_app) = 'DRAFTING', 'application drafting again';
  assert (select count(*) from public.outbox where topic = 'application.queued' and payload->>'application_id' = v_app::text) = 1, 'one queued message';
  assert (select count(*) from public.application_runs where application_id = v_app and run_kind = 'PREPARATION' and status = 'QUEUED') = 1, 'preparation queued';
  assert (select count(*) from public.domain_events where aggregate_id = v_app and event_type = 'application.intake_retry_requested') = 1, 'event recorded';
end $$;

select 'retry pasted link intake checks passed' as result;
rollback;
