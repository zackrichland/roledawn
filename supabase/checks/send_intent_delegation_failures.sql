-- Local PGlite check for 20261001040000_record_send_intent_delegation_failures.sql.
--   node scripts/migration-harness.mjs supabase/checks/send_intent_delegation_failures.sql
begin;
create function pg_temp.check_candidate(p_user uuid) returns uuid language plpgsql as $$
declare v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(p_user,'send-intent-failure-'||p_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Send intent failure check','PERSONAL','ACTIVE',p_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,p_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,p_user,'Send intent failure check','ACTIVE');
  return v_candidate;
end $$;

do $$ declare
  v_user uuid := '33333333-3333-4333-8333-333333333333';
  c uuid; a uuid; v_job uuid := gen_random_uuid(); v_version uuid := gen_random_uuid(); v_revision uuid := gen_random_uuid(); v_result jsonb; v_events integer; v_code text;
begin
  c := pg_temp.check_candidate(v_user);
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://job-boards.greenhouse.io/synthetic/jobs/'||floor(random()*1e9)::bigint,'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,repeat('a',64),'Synthetic role','Synthetic employer','Synthetic only.','https://job-boards.greenhouse.io/synthetic/jobs/123',now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status)
    select gen_random_uuid(), workspace_id, id, v_job, v_version, 'DRAFTING' from public.candidates where id = c returning id into a;

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.request_application_send('e1000000-0000-4000-8000-000000000001', a);
  execute 'reset role';

  -- A READY application whose packet cannot be delegated (no artifacts or review in this fixture).
  set local session_replication_role = replica;
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    select v_revision, workspace_id, id, 1, job_version_id, '{}', '{}', repeat('c',64), 'PASSED', gen_random_uuid(), repeat('d',64), gen_random_uuid(), repeat('e',64) from public.applications where id = a;
  set local session_replication_role = origin;
  update public.applications set status = 'READY', current_revision_id = v_revision where id = a;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
  v_result := public.delegate_ready_send_intents(a, 10);
  execute 'reset role';
  assert (v_result->>'delegated')::int = 0, 'nothing delegated';
  assert (select closed_at is null from public.application_send_intents where application_id = a), 'intent stays open for the next sweep';
  select count(*), max(code) into v_events, v_code from private.worker_events where application_id = a and stage = 'send-intent' and outcome = 'FAILED';
  assert v_events = 1, 'the swallowed delegation failure is recorded';
  assert v_code ~ '^[A-Z][A-Z0-9_]{2,119}$', 'with a stable code';
  assert (select detail ? 'sqlstate' from private.worker_events where application_id = a and stage = 'send-intent'), 'and its SQLSTATE';

  -- The next sweep within the hour does not add a duplicate row.
  execute 'set local role service_role';
  perform public.delegate_ready_send_intents(a, 10);
  execute 'reset role';
  assert (select count(*) from private.worker_events where application_id = a and stage = 'send-intent') = 1, 'recorded at most hourly';

  -- Candidates still cannot read worker events or run the sweep.
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    perform 1 from private.worker_events;
    raise exception 'CHECK_CANDIDATE_READ_EVENTS';
  exception when insufficient_privilege then null; end;
  begin
    perform public.delegate_ready_send_intents(null, 10);
    raise exception 'EXPECTED_SERVICE_ONLY';
  exception when insufficient_privilege then null; when others then if sqlerrm not like '%permission denied%' and sqlerrm <> 'SERVICE_ROLE_REQUIRED' then raise; end if; end;
  execute 'reset role';
end $$;
rollback;
select 'send intent delegation failure checks passed' as result;
