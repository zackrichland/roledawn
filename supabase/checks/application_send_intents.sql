-- Local PGlite check for 20260928130000_application_send_intents.sql.
begin;
create function pg_temp.check_candidate(p_user uuid) returns uuid language plpgsql as $$
declare v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(p_user,'send-intent-'||p_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Send intent check','PERSONAL','ACTIVE',p_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,p_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,p_user,'Send intent check','ACTIVE');
  return v_candidate;
end $$;
create function pg_temp.check_application(p_candidate uuid, p_status text, p_apply_url text) returns uuid language plpgsql as $$
declare v_job uuid:=gen_random_uuid(); v_version uuid:=gen_random_uuid(); v_application uuid:=gen_random_uuid(); c public.candidates%rowtype;
begin
  select * into strict c from public.candidates where id=p_candidate;
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://synthetic-check.invalid/jobs/'||v_job,'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),'Synthetic role','Synthetic employer','Synthetic only.',p_apply_url,now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(v_application,c.workspace_id,c.id,v_job,v_version,p_status);
  return v_application;
end $$;

do $$ declare
  v_one uuid := '31111111-1111-4111-8111-111111111111';
  v_two uuid := '32222222-2222-4222-8222-222222222222';
  c1 uuid; c2 uuid; a1 uuid; a2 uuid; a3 uuid; r record; v_revision uuid := gen_random_uuid(); v_result jsonb;
begin
  c1 := pg_temp.check_candidate(v_one);
  c2 := pg_temp.check_candidate(v_two);
  a1 := pg_temp.check_application(c1, 'DRAFTING', 'https://synthetic-check.invalid/jobs/x');
  a2 := pg_temp.check_application(c1, 'CONFIRMED', 'https://synthetic-check.invalid/jobs/y');
  a3 := pg_temp.check_application(c1, 'DRAFTING', 'https://synthetic-check.invalid/jobs/z');
  perform set_config('check.a1', a1::text, true);
  perform set_config('check.a3', a3::text, true);

  -- Candidate requests, replays, cancels, and requests again.
  perform set_config('request.jwt.claim.sub', v_one::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select * into strict r from public.request_application_send('e0000000-0000-4000-8000-000000000001', a1);
  assert r.intent_open and not r.replayed, 'intent opened';
  select * into strict r from public.request_application_send('e0000000-0000-4000-8000-000000000001', a1);
  assert r.replayed, 'replay';
  assert public.cancel_application_send(a1), 'cancel';
  select * into strict r from public.request_application_send('e0000000-0000-4000-8000-000000000002', a1);
  assert (select closed_at is null from public.application_send_intents where application_id = a1), 'reopened after cancel';
  perform public.request_application_send('e0000000-0000-4000-8000-000000000003', a3);
  begin
    perform public.request_application_send('e0000000-0000-4000-8000-000000000004', a2);
    raise exception 'EXPECTED_NOT_AVAILABLE';
  exception when others then if sqlerrm <> 'APPLICATION_SEND_NOT_AVAILABLE' then raise; end if; end;
  execute 'reset role';

  -- Another candidate cannot target it.
  perform set_config('request.jwt.claim.sub', v_two::text, true);
  execute 'set local role authenticated';
  begin
    perform public.request_application_send('e0000000-0000-4000-8000-000000000005', a1);
    raise exception 'EXPECTED_NOT_FOUND';
  exception when others then if sqlerrm <> 'APPLICATION_NOT_FOUND' then raise; end if; end;
  assert (select count(*) from public.application_send_intents) = 0, 'intents isolated';
  execute 'reset role';

  -- Worker: DRAFTING waits; READY with an unsupported destination closes; confirmed closes.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
  v_result := public.delegate_ready_send_intents(null, 10);
  assert (v_result->>'delegated')::int = 0 and (v_result->>'closed')::int = 0, 'drafting waits';
  execute 'reset role';
  set local session_replication_role = replica;
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    select v_revision, workspace_id, id, 1, job_version_id, '{}', '{}', repeat('c',64), 'PASSED', gen_random_uuid(), repeat('d',64), gen_random_uuid(), repeat('e',64) from public.applications where id = a1;
  set local session_replication_role = origin;
  update public.applications set status = 'READY', current_revision_id = v_revision where id = a1;
  update public.applications set status = 'CANCELED' where id = a3;
  execute 'set local role service_role';
  v_result := public.delegate_ready_send_intents(null, 10);
  execute 'reset role';
  assert (select close_reason from public.application_send_intents where application_id = a1) = 'NOT_DELIVERABLE', 'unsupported destination closes';
  assert (select close_reason from public.application_send_intents where application_id = a3) = 'APPLICATION_CLOSED', 'closed application closes';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    perform public.delegate_ready_send_intents(null, 10);
    raise exception 'EXPECTED_SERVICE_ONLY';
  exception when insufficient_privilege then null; when others then if sqlerrm not like '%permission denied%' and sqlerrm <> 'SERVICE_ROLE_REQUIRED' then raise; end if; end;
  execute 'reset role';
end $$;
rollback;
select 'application send intent checks passed' as result;
