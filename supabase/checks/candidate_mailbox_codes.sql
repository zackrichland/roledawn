-- Local PGlite check for 20260929010000_candidate_mailbox_codes.sql.
--   node scripts/migration-harness.mjs supabase/checks/candidate_mailbox_codes.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table candidate_mailbox_checks(check_name text primary key, passed boolean not null) on commit drop;

-- A candidate whose application's autopilot holds a submit attempt and an open code request.
create function pg_temp.mailbox_fixture(p_label text) returns jsonb
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
  v_job uuid:=gen_random_uuid(); v_version uuid:=gen_random_uuid(); v_application uuid:=gen_random_uuid(); v_revision uuid:=gen_random_uuid();
  v_attempt uuid:=gen_random_uuid(); v_autopilot uuid:=gen_random_uuid(); v_lease uuid:=gen_random_uuid(); v_request uuid;
begin
  insert into auth.users(id,email) values(v_user,'mailbox-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Mailbox check '||p_label,'PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Mailbox check '||p_label,'ACTIVE');
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://job-boards.greenhouse.io/roledawncheck/jobs/'||abs(hashtext(v_job::text)),'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),'Synthetic role','Synthetic employer','Synthetic only.','https://job-boards.greenhouse.io/roledawncheck/jobs/1',now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(v_application,v_workspace,v_candidate,v_job,v_version,'TAKEOVER');
  set local session_replication_role=replica;
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    values(v_revision,v_workspace,v_application,1,v_version,'{}','{}',repeat('c',64),'PASSED',gen_random_uuid(),repeat('d',64),gen_random_uuid(),repeat('e',64));
  insert into public.application_attempts(id,workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
    values(v_attempt,v_workspace,v_application,v_revision,gen_random_uuid(),'SUBMIT_APPLICATION_ONCE','autopilot:'||v_autopilot,'application-delivery/1','STARTED','{}');
  insert into public.application_autopilots(id,workspace_id,candidate_id,application_id,revision_id,delegated_by,command_id,packet_hash,destination_url,artifact_manifest,disclosure_manifest,
      status,sealed_diff,sealed_diff_hash,readback_hash,request_fingerprint,attempt_id,lease_token,lease_owner,lease_expires_at)
    values(v_autopilot,v_workspace,v_candidate,v_application,v_revision,v_user,gen_random_uuid(),repeat('c',64),'https://job-boards.greenhouse.io/roledawncheck/jobs/1','[]','{}',
      'SUBMITTING','{}',repeat('1',64),repeat('2',64),repeat('3',64),v_attempt,v_lease,'mailbox-check',now()+interval '5 minutes');
  insert into private.application_autopilot_runtime(autopilot_id) values(v_autopilot);
  set local session_replication_role=origin;
  update public.applications set current_revision_id=v_revision where id=v_application;
  execute 'set local role service_role';
  v_request:=public.request_application_autopilot_verification(v_autopilot,v_lease,'z***@example.test',null);
  execute 'reset role';
  return jsonb_build_object('user',v_user,'candidate',v_candidate,'autopilot',v_autopilot,'lease',v_lease,'request',v_request);
end $$;

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_user::text, true); execute 'set local role authenticated'; end $$;
create function pg_temp.as_nobody() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;

do $check$
declare f jsonb:=pg_temp.mailbox_fixture('main'); other jsonb:=pg_temp.mailbox_fixture('other'); v_result jsonb; v_row record;
begin
  -- The candidate connects their own mailbox and sees it without the token.
  perform pg_temp.as_user((f->>'user')::uuid);
  v_result:=public.save_candidate_mailbox_connection((f->>'candidate')::uuid,'GOOGLE',' Zack@Example.Test ','v1.'||repeat('a',40),'v1',array['https://www.googleapis.com/auth/gmail.readonly']);
  v_result:=public.get_candidate_mailbox_connection((f->>'candidate')::uuid);
  perform pg_temp.as_nobody();
  if v_result->>'emailAddress'<>'zack@example.test' or v_result ? 'encryptedToken' then raise exception 'CHECK_GET %',v_result; end if;
  insert into candidate_mailbox_checks values('candidate_connects_and_sees_no_token',true);

  -- Another account can neither read, replace nor remove it.
  perform pg_temp.as_user((other->>'user')::uuid);
  begin perform public.get_candidate_mailbox_connection((f->>'candidate')::uuid); raise exception 'CHECK_FOREIGN_GET';
  exception when others then if sqlerrm<>'CANDIDATE_MAILBOX_NOT_FOUND' then raise; end if; end;
  begin perform public.save_candidate_mailbox_connection((f->>'candidate')::uuid,'GOOGLE','x@example.test','v1.'||repeat('b',40),'v1',array['s']); raise exception 'CHECK_FOREIGN_SAVE';
  exception when others then if sqlerrm<>'CANDIDATE_MAILBOX_NOT_FOUND' then raise; end if; end;
  begin perform public.delete_candidate_mailbox_connection((f->>'candidate')::uuid); raise exception 'CHECK_FOREIGN_DELETE';
  exception when others then if sqlerrm<>'CANDIDATE_MAILBOX_NOT_FOUND' then raise; end if; end;
  -- Candidates cannot call worker functions or read the private table.
  begin perform public.read_autopilot_mailbox_connection((f->>'autopilot')::uuid,(f->>'lease')::uuid); raise exception 'CHECK_CANDIDATE_WORKER_READ';
  exception when insufficient_privilege then null; end;
  begin perform 1 from private.candidate_mailbox_connections; raise exception 'CHECK_PRIVATE_TABLE_READABLE';
  exception when insufficient_privilege then null; end;
  perform pg_temp.as_nobody();
  insert into candidate_mailbox_checks values('other_accounts_and_candidates_are_refused',true);

  -- The worker reads the sealed token only with its active lease while sending.
  execute 'set local role service_role';
  v_result:=public.read_autopilot_mailbox_connection((f->>'autopilot')::uuid,(f->>'lease')::uuid);
  if v_result->>'encryptedToken'<>'v1.'||repeat('a',40) or v_result->>'candidateId'<>f->>'candidate' then raise exception 'CHECK_WORKER_READ %',v_result; end if;
  begin perform public.read_autopilot_mailbox_connection((f->>'autopilot')::uuid,gen_random_uuid()); raise exception 'CHECK_FOREIGN_LEASE_READ';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_LEASE_INACTIVE' then raise; end if; end;
  if public.read_autopilot_mailbox_connection((other->>'autopilot')::uuid,(other->>'lease')::uuid) is not null then raise exception 'CHECK_UNCONNECTED_READ'; end if;
  execute 'reset role';
  update public.application_autopilots set status='RUNNING',attempt_id=null,sealed_diff=null,sealed_diff_hash=null,readback_hash=null,request_fingerprint=null where id=(other->>'autopilot')::uuid;
  execute 'set local role service_role';
  begin perform public.read_autopilot_mailbox_connection((other->>'autopilot')::uuid,(other->>'lease')::uuid); raise exception 'CHECK_READ_WHILE_FILLING';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_MAILBOX_NOT_ALLOWED' then raise; end if; end;
  execute 'reset role';
  insert into candidate_mailbox_checks values('worker_reads_token_only_while_sending_with_its_lease',true);

  -- A code read from the connected mailbox answers the open request, marked as such.
  execute 'set local role service_role';
  begin perform public.provide_application_autopilot_verification_from_mailbox((f->>'autopilot')::uuid,(f->>'lease')::uuid,(f->>'request')::uuid,'AB CD'); raise exception 'CHECK_BAD_CODE';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_VERIFICATION_CODE_INVALID' then raise; end if; end;
  perform public.provide_application_autopilot_verification_from_mailbox((f->>'autopilot')::uuid,(f->>'lease')::uuid,(f->>'request')::uuid,'MAIL1234');
  v_result:=public.read_application_autopilot_verification((f->>'autopilot')::uuid,(f->>'lease')::uuid);
  begin perform public.provide_application_autopilot_verification_from_mailbox((f->>'autopilot')::uuid,(f->>'lease')::uuid,(f->>'request')::uuid,'MAIL9999'); raise exception 'CHECK_SECOND_MAILBOX_CODE';
  exception when others then if sqlerrm<>'APPLICATION_AUTOPILOT_VERIFICATION_STALE' then raise; end if; end;
  perform public.record_autopilot_mailbox_use((f->>'autopilot')::uuid,(f->>'lease')::uuid,null);
  execute 'reset role';
  select * into v_row from public.application_autopilot_verifications where id=(f->>'request')::uuid;
  if v_result->>'code'<>'MAIL1234' or v_row.source<>'MAILBOX' or v_row.provided_by<>(f->>'user')::uuid then raise exception 'CHECK_MAILBOX_PROVIDE %',v_result; end if;
  if (select last_used_at from private.candidate_mailbox_connections where candidate_id=(f->>'candidate')::uuid) is null then raise exception 'CHECK_USE_NOT_RECORDED'; end if;
  insert into candidate_mailbox_checks values('mailbox_code_answers_open_request_once_and_is_marked',true);

  -- Without a connection the worker cannot claim a code came from a mailbox.
  execute 'set local role service_role';
  begin perform public.provide_application_autopilot_verification_from_mailbox((other->>'autopilot')::uuid,(other->>'lease')::uuid,(other->>'request')::uuid,'MAIL1234'); raise exception 'CHECK_UNCONNECTED_PROVIDE';
  exception when others then if sqlerrm not in ('APPLICATION_AUTOPILOT_MAILBOX_NOT_ALLOWED','APPLICATION_AUTOPILOT_LEASE_INACTIVE') then raise; end if; end;
  execute 'reset role';
  insert into candidate_mailbox_checks values('no_connection_no_mailbox_code',true);

  -- Disconnecting hands back the sealed token once (for provider revocation) and removes it.
  perform pg_temp.as_user((f->>'user')::uuid);
  v_result:=public.delete_candidate_mailbox_connection((f->>'candidate')::uuid);
  if v_result->>'encryptedToken'<>'v1.'||repeat('a',40) or public.get_candidate_mailbox_connection((f->>'candidate')::uuid) is not null
    or public.delete_candidate_mailbox_connection((f->>'candidate')::uuid) is not null then raise exception 'CHECK_DELETE %',v_result; end if;
  perform pg_temp.as_nobody();
  insert into candidate_mailbox_checks values('disconnect_returns_token_once_and_removes_it',true);
end $check$;

select check_name, passed from candidate_mailbox_checks order by check_name;
rollback;
