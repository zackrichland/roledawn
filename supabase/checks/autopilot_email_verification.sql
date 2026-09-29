-- Local PGlite check for 20260928230000_autopilot_email_verification.sql.
--   node scripts/migration-harness.mjs supabase/checks/autopilot_email_verification.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table autopilot_verification_checks(check_name text primary key, passed boolean not null) on commit drop;

-- A candidate with one application whose autopilot already holds a submit attempt.
create function pg_temp.check_submitting(p_label text) returns jsonb
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
  v_job uuid:=gen_random_uuid(); v_version uuid:=gen_random_uuid(); v_application uuid:=gen_random_uuid(); v_revision uuid:=gen_random_uuid();
  v_attempt uuid:=gen_random_uuid(); v_autopilot uuid:=gen_random_uuid(); v_lease uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_user,'verification-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Verification check '||p_label,'PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Verification check '||p_label,'ACTIVE');
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://job-boards.greenhouse.io/roledawncheck/jobs/'||abs(hashtext(v_job::text)),'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),'Synthetic role','Synthetic employer','Synthetic only.','https://job-boards.greenhouse.io/roledawncheck/jobs/1',now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(v_application,v_workspace,v_candidate,v_job,v_version,'RECONCILING');
  -- Fixture rows only bypass the packet/attempt guards (replica mode); the functions under test run normally.
  set local session_replication_role=replica;
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    values(v_revision,v_workspace,v_application,1,v_version,'{}','{}',repeat('c',64),'PASSED',gen_random_uuid(),repeat('d',64),gen_random_uuid(),repeat('e',64));
  insert into public.application_attempts(id,workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
    values(v_attempt,v_workspace,v_application,v_revision,gen_random_uuid(),'SUBMIT_APPLICATION_ONCE','autopilot:'||v_autopilot,'application-delivery/1','STARTED','{}');
  insert into public.application_autopilots(id,workspace_id,candidate_id,application_id,revision_id,delegated_by,command_id,packet_hash,destination_url,artifact_manifest,disclosure_manifest,
      status,sealed_diff,sealed_diff_hash,readback_hash,request_fingerprint,attempt_id,lease_token,lease_owner,lease_expires_at)
    values(v_autopilot,v_workspace,v_candidate,v_application,v_revision,v_user,gen_random_uuid(),repeat('c',64),'https://job-boards.greenhouse.io/roledawncheck/jobs/1','[]','{}',
      'SUBMITTING','{}',repeat('1',64),repeat('2',64),repeat('3',64),v_attempt,v_lease,'verification-check',now()+interval '2 minutes');
  insert into private.application_autopilot_runtime(autopilot_id) values(v_autopilot);
  set local session_replication_role=origin;
  update public.applications set current_revision_id=v_revision where id=v_application;
  return jsonb_build_object('user',v_user,'autopilot',v_autopilot,'lease',v_lease,'application',v_application,'attempt',v_attempt);
end $$;

create function pg_temp.as_worker_request(p_fixture jsonb, p_retry text default null) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  execute 'set local role service_role';
  v_id:=public.request_application_autopilot_verification((p_fixture->>'autopilot')::uuid,(p_fixture->>'lease')::uuid,'z***@example.test',p_retry);
  execute 'reset role';
  return v_id;
end $$;

create function pg_temp.as_worker_read(p_fixture jsonb) returns jsonb
language plpgsql as $$
declare v_result jsonb;
begin
  execute 'set local role service_role';
  v_result:=public.read_application_autopilot_verification((p_fixture->>'autopilot')::uuid,(p_fixture->>'lease')::uuid);
  execute 'reset role';
  return v_result;
end $$;

create function pg_temp.as_candidate_provide(p_user uuid, p_fixture jsonb, p_verification uuid, p_code text, p_command uuid default gen_random_uuid()) returns jsonb
language plpgsql as $$
declare v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  v_result:=public.provide_application_autopilot_verification_code(p_command,(p_fixture->>'autopilot')::uuid,p_verification,p_code);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return v_result;
end $$;

do $check$
declare f jsonb:=pg_temp.check_submitting('main'); other jsonb:=pg_temp.check_submitting('other'); v_request uuid; v_second uuid; v_read jsonb; v_result jsonb;
  v_command uuid:=gen_random_uuid(); v_visible integer; v_expires timestamptz; v_before timestamptz;
begin
  -- The worker records the employer's request; the application needs the candidate.
  v_request:=pg_temp.as_worker_request(f);
  if (select status from public.applications where id=(f->>'application')::uuid)<>'TAKEOVER' then raise exception 'CHECK_REQUEST_NOT_TAKEOVER'; end if;
  v_read:=pg_temp.as_worker_read(f);
  if v_read->>'status'<>'REQUESTED' or v_read ? 'code' and v_read->'code'<>'null'::jsonb then raise exception 'CHECK_REQUEST_READ %',v_read; end if;
  insert into autopilot_verification_checks values('worker_request_marks_application_needs_you',true);

  -- The candidate sees the request (not a code column) under RLS; another account sees nothing.
  perform set_config('request.jwt.claim.sub', f->>'user', true); execute 'set local role authenticated';
  select count(*) into v_visible from public.application_autopilot_verifications where autopilot_id=(f->>'autopilot')::uuid and status='REQUESTED';
  begin perform code from public.application_autopilot_verifications limit 1; raise exception 'CHECK_CODE_COLUMN_READABLE';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', other->>'user', true); execute 'set local role authenticated';
  if exists(select 1 from public.application_autopilot_verifications where autopilot_id=(f->>'autopilot')::uuid) then raise exception 'CHECK_FOREIGN_ROW_VISIBLE'; end if;
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
  if v_visible<>1 then raise exception 'CHECK_OWNER_ROW_NOT_VISIBLE'; end if;
  insert into autopilot_verification_checks values('owner_sees_request_without_code_and_others_see_nothing',true);

  -- Only the owning candidate can answer, with a well-formed code.
  begin perform pg_temp.as_candidate_provide((other->>'user')::uuid,f,v_request,'ABCD1234'); raise exception 'CHECK_FOREIGN_PROVIDE_ACCEPTED';
  exception when others then if sqlerrm like 'CHECK_%' then raise; end if; execute 'reset role'; end;
  begin perform pg_temp.as_candidate_provide((f->>'user')::uuid,f,v_request,'AB CD-12'); raise exception 'CHECK_MALFORMED_CODE_ACCEPTED';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_VERIFICATION_CODE_INVALID' then raise; end if; execute 'reset role'; end;
  insert into autopilot_verification_checks values('only_owner_with_well_formed_code',true);

  -- The answer is stored once; a replay returns the same result; a changed payload is refused.
  v_result:=pg_temp.as_candidate_provide((f->>'user')::uuid,f,v_request,' ABCD1234 ',v_command);
  if (v_result->>'replayed')::boolean then raise exception 'CHECK_FIRST_PROVIDE_REPLAYED'; end if;
  if (select status from public.applications where id=(f->>'application')::uuid)<>'RECONCILING' then raise exception 'CHECK_PROVIDE_STATUS'; end if;
  v_result:=pg_temp.as_candidate_provide((f->>'user')::uuid,f,v_request,'ABCD1234',v_command);
  if not (v_result->>'replayed')::boolean then raise exception 'CHECK_REPLAY_NOT_REPLAYED'; end if;
  begin perform pg_temp.as_candidate_provide((f->>'user')::uuid,f,v_request,'ZZZZ9999',v_command); raise exception 'CHECK_CHANGED_PAYLOAD_ACCEPTED';
  exception when others then if sqlerrm<>'COMMAND_ID_PAYLOAD_MISMATCH' then raise; end if; execute 'reset role'; end;
  begin perform pg_temp.as_candidate_provide((f->>'user')::uuid,f,v_request,'ZZZZ9999'); raise exception 'CHECK_SECOND_ANSWER_ACCEPTED';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_VERIFICATION_STALE' then raise; end if; execute 'reset role'; end;
  insert into autopilot_verification_checks values('answer_once_replay_safe_and_immutable',true);

  -- The worker reads the trimmed code once, and using it clears it.
  v_read:=pg_temp.as_worker_read(f);
  if v_read->>'status'<>'PROVIDED' or v_read->>'code'<>'ABCD1234' then raise exception 'CHECK_PROVIDED_READ %',v_read; end if;
  execute 'set local role service_role';
  perform public.settle_application_autopilot_verification((f->>'autopilot')::uuid,(f->>'lease')::uuid,v_request,'USED');
  begin perform public.settle_application_autopilot_verification((f->>'autopilot')::uuid,(f->>'lease')::uuid,v_request,'USED'); raise exception 'CHECK_DOUBLE_SETTLE';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_VERIFICATION_SETTLE_INVALID' then raise; end if; end;
  execute 'reset role';
  if (select code from public.application_autopilot_verifications where id=v_request) is not null then raise exception 'CHECK_CODE_NOT_CLEARED'; end if;
  insert into autopilot_verification_checks values('worker_reads_trimmed_code_once_and_clears_it',true);

  -- A rejected code opens one fresh request; the limit stops endless retries.
  v_second:=pg_temp.as_worker_request(f,'CODE_REJECTED');
  if v_second=v_request or (select retry_reason from public.application_autopilot_verifications where id=v_second)<>'CODE_REJECTED' then raise exception 'CHECK_RETRY_REQUEST'; end if;
  perform pg_temp.as_worker_request(f); perform pg_temp.as_worker_request(f);
  if (select count(*) from public.application_autopilot_verifications where autopilot_id=(f->>'autopilot')::uuid and status in ('REQUESTED','PROVIDED'))<>1 then raise exception 'CHECK_MORE_THAN_ONE_OPEN'; end if;
  begin perform pg_temp.as_worker_request(f); raise exception 'CHECK_LIMIT_NOT_ENFORCED';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_VERIFICATION_LIMIT' then raise; end if; execute 'reset role'; end;
  insert into autopilot_verification_checks values('rejected_code_retries_are_bounded_with_one_open_request',true);

  -- An expired request cannot be answered; the worker sees it as expired.
  v_request:=pg_temp.as_worker_request(other);
  update public.application_autopilot_verifications set expires_at=now()-interval '1 second' where id=v_request;
  if pg_temp.as_worker_read(other)->>'status'<>'EXPIRED' then raise exception 'CHECK_EXPIRED_READ'; end if;
  begin perform pg_temp.as_candidate_provide((other->>'user')::uuid,other,v_request,'ABCD1234'); raise exception 'CHECK_EXPIRED_ANSWERED';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_VERIFICATION_STALE' then raise; end if; execute 'reset role'; end;
  insert into autopilot_verification_checks values('expired_requests_cannot_be_answered',true);

  -- The lease can be extended by its holder only, and never shortened.
  select lease_expires_at into v_before from public.application_autopilots where id=(f->>'autopilot')::uuid;
  execute 'set local role service_role';
  v_expires:=public.extend_application_autopilot_lease((f->>'autopilot')::uuid,(f->>'lease')::uuid,600);
  if v_expires<=v_before then raise exception 'CHECK_LEASE_NOT_EXTENDED'; end if;
  if public.extend_application_autopilot_lease((f->>'autopilot')::uuid,(f->>'lease')::uuid,30)<>v_expires then raise exception 'CHECK_LEASE_SHORTENED'; end if;
  begin perform public.extend_application_autopilot_lease((f->>'autopilot')::uuid,gen_random_uuid(),600); raise exception 'CHECK_FOREIGN_LEASE_EXTENDED';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_LEASE_INACTIVE' then raise; end if; end;
  begin perform public.request_application_autopilot_verification((f->>'autopilot')::uuid,gen_random_uuid(),'x',null); raise exception 'CHECK_FOREIGN_REQUEST';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_LEASE_INACTIVE' then raise; end if; end;
  execute 'reset role';
  insert into autopilot_verification_checks values('lease_extension_is_holder_only_and_monotonic',true);

  -- Candidates cannot call worker functions.
  perform set_config('request.jwt.claim.sub', f->>'user', true); execute 'set local role authenticated';
  begin perform public.read_application_autopilot_verification((f->>'autopilot')::uuid,(f->>'lease')::uuid); raise exception 'CHECK_CANDIDATE_READ_CODE';
  exception when insufficient_privilege then null; end;
  execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true);
  insert into autopilot_verification_checks values('candidates_cannot_call_worker_functions',true);
end $check$;

select check_name, passed from autopilot_verification_checks order by check_name;
rollback;
