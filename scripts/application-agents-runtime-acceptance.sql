-- Run after the new migrations in one explicit BEGIN ... ROLLBACK transaction.
-- No network/provider calls. The fixture also rolls itself back using a caught
-- exception, so existing application/candidate state is restored before returning.
-- This needs one current, inactive application packet; it creates only temporary
-- synthetic authority/run/session/tool rows and never submits an application.
create temporary table application_agents_runtime_acceptance (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $acceptance$
declare
  v_signature text;
  v_role text;
  v_table text;
  v_oid oid;
  v_context record;
  v_before jsonb;
  v_after jsonb;
  v_approval uuid := extensions.gen_random_uuid();
  v_consumption uuid := extensions.gen_random_uuid();
  v_browser_run uuid := extensions.gen_random_uuid();
  v_fill uuid := extensions.gen_random_uuid();
  v_session uuid := extensions.gen_random_uuid();
  v_agent_run uuid;
  v_second_agent_run uuid;
  v_result jsonb;
  v_reply jsonb;
  v_checks text[] := '{}';
begin
  foreach v_signature in array array[
    'public.start_application_agent_run(uuid,uuid,uuid,uuid,uuid,uuid,text,text)',
    'public.bind_application_agent_session(uuid,text)',
    'public.begin_application_agent_tool_call(uuid,text,text,text,text,text)',
    'public.complete_application_agent_tool_call(uuid,text,text,text,text,text,jsonb)',
    'public.finish_application_agent_run(uuid,text,text,boolean)',
    'public.expire_application_agent_runs(integer)',
    'public.claim_application_agent_cleanup(integer)'
  ] loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null or not has_function_privilege('service_role',v_oid,'EXECUTE') then
      raise exception 'AGENTS_ACCEPTANCE_SERVICE_FUNCTION_GRANT_MISSING'; end if;
    foreach v_role in array array['anon','authenticated'] loop
      if has_function_privilege(v_role,v_oid,'EXECUTE') then
        raise exception 'AGENTS_ACCEPTANCE_PUBLIC_FUNCTION_ACCESS'; end if;
    end loop;
    if not exists (select 1 from pg_proc where oid=v_oid and prosecdef
      and array_to_string(proconfig,',') like '%search_path=%') then
      raise exception 'AGENTS_ACCEPTANCE_FUNCTION_SECURITY_INVALID'; end if;
  end loop;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(v_role,'private.assert_application_agent_binding(uuid)','EXECUTE') then
      raise exception 'AGENTS_ACCEPTANCE_PRIVATE_GATE_EXPOSED'; end if;
  end loop;
  foreach v_table in array array['public.application_agent_runs','public.application_agent_tool_calls'] loop
    if not exists(select 1 from pg_class where oid=v_table::regclass and relrowsecurity) then
      raise exception 'AGENTS_ACCEPTANCE_RLS_MISSING'; end if;
    foreach v_role in array array['anon','authenticated'] loop
      if has_table_privilege(v_role,v_table,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'AGENTS_ACCEPTANCE_PUBLIC_TABLE_ACCESS'; end if;
    end loop;
    if has_table_privilege('service_role',v_table,'INSERT,UPDATE,DELETE')
      or not has_table_privilege('service_role',v_table,'SELECT') then
      raise exception 'AGENTS_ACCEPTANCE_SERVICE_DIRECT_WRITES'; end if;
  end loop;
  v_checks := array_append(v_checks,'service_only_acl_and_rls');

  -- Confirm real role execution is denied, not just an ACL inspection.
  begin
    execute 'set local role authenticated';
    perform public.bind_application_agent_session(v_approval,'synthetic_session');
    raise exception 'AGENTS_ACCEPTANCE_AUTHENTICATED_EXECUTION_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  v_checks := array_append(v_checks,'authenticated_rpc_execution_denied');

  -- Avoid running global cleanup assertions while a worker is active.
  if exists(select 1 from public.application_agent_runs where status in ('STARTING','RUNNING')) then
    raise exception 'AGENTS_ACCEPTANCE_ACTIVE_AGENT_RUNS_PRESENT'; end if;
  if exists(select 1 from public.application_agent_runs where provider_session_id is not null and provider_deleted_at is null) then
    raise exception 'AGENTS_ACCEPTANCE_PENDING_CLEANUP_PRESENT'; end if;

  select a.id as application_id,a.workspace_id,a.candidate_id,a.current_revision_id,
    c.auth_user_id,to_jsonb(a) as before_state
  into v_context
  from public.applications a
  join public.candidates c on c.id=a.candidate_id and c.workspace_id=a.workspace_id
  join public.workspaces w on w.id=a.workspace_id and w.status='ACTIVE'
  join public.application_revisions r on r.id=a.current_revision_id and r.application_id=a.id
  join public.application_input_snapshots snapshot on snapshot.id=r.input_snapshot_id
    and snapshot.application_id=a.id and snapshot.candidate_input_version=c.application_input_version
  where c.status in ('ONBOARDING','ACTIVE') and r.validation_status='PASSED'
    and exists(select 1 from public.workspace_memberships m where m.workspace_id=c.workspace_id
      and m.auth_user_id=c.auth_user_id and m.status='ACTIVE')
    and not exists(select 1 from public.application_attempts x where x.application_id=a.id)
    and not exists(select 1 from public.application_fill_attempts f where f.application_id=a.id and f.status in ('QUEUED','STARTED'))
    and not exists(select 1 from public.application_runs run where run.application_id=a.id
      and run.run_kind='BROWSER_FILL' and run.status in ('QUEUED','RUNNING','WAITING'))
  order by a.created_at desc limit 1 for update of a;
  if not found then raise exception 'AGENTS_ACCEPTANCE_CURRENT_PACKET_FIXTURE_REQUIRED'; end if;
  v_before := v_context.before_state;

  begin
    update public.applications set status='EXECUTING' where id=v_context.application_id;
    insert into public.approval_challenges(id,workspace_id,candidate_id,application_id,revision_id,
      permitted_action,diff_hash,nonce_hash,issued_at,expires_at,authority_manifest,authority_hash)
    values(v_approval,v_context.workspace_id,v_context.candidate_id,v_context.application_id,v_context.current_revision_id,
      'FILL_APPLICATION_ONCE',repeat('b',64),encode(extensions.digest(v_approval::text,'sha256'),'hex'),
      now()-interval '1 minute',now()+interval '20 minutes',
      '{"permitted_action":"FILL_APPLICATION_ONCE","submission_authority":false}',repeat('a',64));
    insert into public.approval_consumptions(id,workspace_id,approval_id,application_id,revision_id,
      consumed_by,command_id,permitted_action)
    values(v_consumption,v_context.workspace_id,v_approval,v_context.application_id,v_context.current_revision_id,
      v_context.auth_user_id,extensions.gen_random_uuid(),'FILL_APPLICATION_ONCE');
    insert into public.application_runs(id,workspace_id,application_id,run_kind,status,input_revision_id,started_at)
    values(v_browser_run,v_context.workspace_id,v_context.application_id,'BROWSER_FILL','RUNNING',v_context.current_revision_id,now());
    insert into public.application_fill_attempts(id,workspace_id,candidate_id,application_id,revision_id,
      approval_consumption_id,approval_action,browser_run_id,authority_hash,destination_url,destination_url_hash,
      packet_hash,diff_hash,artifact_manifest,artifact_manifest_hash,disclosure_manifest,disclosure_manifest_hash,
      executor_policy_release,destination_policy_release,status,started_at)
    values(v_fill,v_context.workspace_id,v_context.candidate_id,v_context.application_id,v_context.current_revision_id,
      v_consumption,'FILL_APPLICATION_ONCE',v_browser_run,repeat('a',64),'https://boards.greenhouse.io/synthetic/jobs/123',repeat('c',64),
      repeat('d',64),repeat('b',64),'[]',repeat('e',64),'{}',repeat('f',64),
      'synthetic-acceptance/1','synthetic-acceptance/1','STARTED',now());
    insert into public.computer_sessions(id,workspace_id,candidate_id,application_id,revision_id,fill_attempt_id,
      execution_mode,state,start_url,allowed_domain_policy,allowed_domain_policy_hash,mounted_artifact_manifest,
      broker_release,created_at,expires_at)
    values(v_session,v_context.workspace_id,v_context.candidate_id,v_context.application_id,v_context.current_revision_id,v_fill,
      'EPHEMERAL_CLEAN','ACTIVE','https://boards.greenhouse.io/synthetic/jobs/123','{}',repeat('1',64),'[]',
      'synthetic-acceptance/1',now()-interval '20 minutes',now()-interval '10 minutes');
    begin
      perform public.start_application_agent_run(v_context.workspace_id,v_context.candidate_id,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,'synthetic-model','synthetic-driver');
      raise exception 'AGENTS_ACCEPTANCE_EXPIRED_SESSION_ACCEPTED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_BINDING_INACTIVE' then raise; end if;
    end;
    v_checks := array_append(v_checks,'expired_session_denied');
    delete from public.computer_sessions where id=v_session;
    insert into public.computer_sessions(id,workspace_id,candidate_id,application_id,revision_id,fill_attempt_id,
      execution_mode,state,start_url,allowed_domain_policy,allowed_domain_policy_hash,mounted_artifact_manifest,
      broker_release,expires_at)
    values(v_session,v_context.workspace_id,v_context.candidate_id,v_context.application_id,v_context.current_revision_id,v_fill,
      'EPHEMERAL_CLEAN','ACTIVE','https://boards.greenhouse.io/synthetic/jobs/123','{}',repeat('1',64),'[]',
      'synthetic-acceptance/1',now()+interval '10 minutes');
    v_agent_run := public.start_application_agent_run(v_context.workspace_id,v_context.candidate_id,v_context.application_id,
      v_context.current_revision_id,v_fill,v_session,'synthetic-model','synthetic-driver');
    begin
      perform public.start_application_agent_run(v_context.workspace_id,v_context.candidate_id,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,'synthetic-model','synthetic-driver');
      raise exception 'AGENTS_ACCEPTANCE_DUPLICATE_ACTIVE_RUN_ACCEPTED';
    exception when unique_violation then null; end;
    v_checks := array_append(v_checks,'one_active_run');
    begin
      perform public.bind_application_agent_session(v_agent_run,null);
      raise exception 'AGENTS_ACCEPTANCE_NULL_SESSION_ACCEPTED';
    exception when invalid_parameter_value then null; end;
    perform public.bind_application_agent_session(v_agent_run,'synthetic_session');
    perform public.bind_application_agent_session(v_agent_run,'synthetic_session');
    begin
      perform public.bind_application_agent_session(v_agent_run,'different_session');
      raise exception 'AGENTS_ACCEPTANCE_SESSION_REBIND_ACCEPTED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_SESSION_REBIND_DENIED' then raise; end if;
    end;
    v_checks := array_append(v_checks,'session_binding_replay_and_rebind_guard');

    v_reply := public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('a',64));
    if v_reply <> '{"status":"new"}'::jsonb then raise exception 'AGENTS_ACCEPTANCE_FIRST_CALL_NOT_NEW'; end if;
    v_reply := public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('a',64));
    if v_reply <> '{"status":"uncertain"}'::jsonb then raise exception 'AGENTS_ACCEPTANCE_UNFINISHED_CALL_REEXECUTABLE'; end if;
    begin
      perform public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('b',64));
      raise exception 'AGENTS_ACCEPTANCE_CHANGED_ARGUMENTS_ACCEPTED';
    exception when unique_violation then null; end;
    v_checks := array_append(v_checks,'new_uncertain_and_arguments_replay_guard');
    v_result := '{"type":"agent.session.input.tool_result","turn_id":"turn_1","call_id":"call_1","success":true,"output":"{}"}';
    begin
      perform public.complete_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('a',64),v_result-'output');
      raise exception 'AGENTS_ACCEPTANCE_MALFORMED_RESULT_ACCEPTED';
    exception when unique_violation then null; end;
    perform public.complete_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('a',64),v_result);
    perform public.complete_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('a',64),v_result);
    v_reply := public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('a',64));
    if v_reply <> jsonb_build_object('status','completed','result',v_result) then raise exception 'AGENTS_ACCEPTANCE_RESULT_REPLAY_FAILED'; end if;
    begin
      perform public.complete_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_1','inspect_form',repeat('a',64),jsonb_set(v_result,'{output}','"changed"'));
      raise exception 'AGENTS_ACCEPTANCE_RESULT_MUTATION_ACCEPTED';
    exception when unique_violation then null; end;
    v_checks := array_append(v_checks,'completed_result_shape_and_immutable_replay');

    begin
      update public.approval_challenges set revoked_at=now() where id=v_approval;
      perform public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_revoked','inspect_form',repeat('a',64));
      raise exception 'AGENTS_ACCEPTANCE_REVOKED_AUTHORITY_ACCEPTED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_BINDING_INACTIVE' then raise; end if;
    end;
    v_checks := array_append(v_checks,'revoked_authority_denied');
    begin
      update public.applications set current_revision_id=null where id=v_context.application_id;
      perform public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_stale','inspect_form',repeat('a',64));
      raise exception 'AGENTS_ACCEPTANCE_STALE_REVISION_ACCEPTED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_BINDING_INACTIVE' then raise; end if;
    end;
    v_checks := array_append(v_checks,'stale_revision_denied');
    begin
      update public.candidates set status='PAUSED' where id=v_context.candidate_id;
      perform public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_paused','inspect_form',repeat('a',64));
      raise exception 'AGENTS_ACCEPTANCE_PAUSED_CANDIDATE_ACCEPTED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_BINDING_INACTIVE' then raise; end if;
    end;
    v_checks := array_append(v_checks,'paused_candidate_denied');
    begin
      update public.workspace_memberships set status='REVOKED'
        where workspace_id=v_context.workspace_id and auth_user_id=v_context.auth_user_id;
      perform public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_membership','inspect_form',repeat('a',64));
      raise exception 'AGENTS_ACCEPTANCE_REVOKED_MEMBERSHIP_ACCEPTED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_BINDING_INACTIVE' then raise; end if;
    end;
    v_checks := array_append(v_checks,'revoked_membership_denied');

    perform public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_2','inspect_form',repeat('a',64));
    begin
      perform public.finish_application_agent_run(v_agent_run,'COMPLETED',null,false);
      raise exception 'AGENTS_ACCEPTANCE_UNFINISHED_RUN_COMPLETED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_RUN_HAS_PENDING_TOOLS' then raise; end if;
    end;
    -- Already-executed effects must still be recordable after a candidate pause.
    begin
      update public.candidates set status='PAUSED' where id=v_context.candidate_id;
      perform public.complete_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_2','inspect_form',repeat('a',64),jsonb_set(v_result,'{call_id}','"call_2"'));
      raise exception 'rollback_completed_after_pause' using errcode='PZ002';
    exception when sqlstate 'PZ002' then null; end;
    perform public.complete_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_2','inspect_form',repeat('a',64),jsonb_set(v_result,'{call_id}','"call_2"'));
    v_checks := array_append(v_checks,'pending_tools_and_post_effect_recording');

    -- Old run age alone must never expire a still-active browser.
    if public.expire_application_agent_runs(20) <> 0 then
      raise exception 'AGENTS_ACCEPTANCE_ACTIVE_BROWSER_EXPIRED'; end if;
    begin
      update public.computer_sessions set state='CLOSED' where id=v_session;
      if public.expire_application_agent_runs(20) <> 1 then
        raise exception 'AGENTS_ACCEPTANCE_CLOSED_BROWSER_NOT_EXPIRED'; end if;
      if not exists(select 1 from public.application_agent_runs where id=v_agent_run
          and status='FAILED' and failure_code='APPLICATION_AGENT_RUNTIME_EXPIRED') then
        raise exception 'AGENTS_ACCEPTANCE_EXPIRED_RUN_NOT_TERMINAL'; end if;
      if public.expire_application_agent_runs(20) <> 0 then
        raise exception 'AGENTS_ACCEPTANCE_EXPIRY_NOT_IDEMPOTENT'; end if;
      raise exception 'rollback_expiry_test' using errcode='PZ003';
    exception when sqlstate 'PZ003' then null; end;
    v_checks := array_append(v_checks,'crash_expiry_uses_browser_state_and_is_idempotent');

    perform public.finish_application_agent_run(v_agent_run,'FAILED','SYNTHETIC_STOP',false);
    select to_jsonb(claim) into v_reply from public.claim_application_agent_cleanup(20) claim;
    if v_reply->>'id' is distinct from v_agent_run::text
      or v_reply->>'provider_session_id' is distinct from 'synthetic_session' then
      raise exception 'AGENTS_ACCEPTANCE_CLEANUP_CLAIM_MISSING'; end if;
    if exists(select 1 from public.claim_application_agent_cleanup(20)) then
      raise exception 'AGENTS_ACCEPTANCE_CLEANUP_BACKOFF_IGNORED'; end if;
    v_checks := array_append(v_checks,'cleanup_claim_backoff_prevents_immediate_replay');
    v_second_agent_run := public.start_application_agent_run(v_context.workspace_id,v_context.candidate_id,
      v_context.application_id,v_context.current_revision_id,v_fill,v_session,'synthetic-model','synthetic-driver');
    perform public.bind_application_agent_session(v_second_agent_run,'synthetic_session_second');
    perform public.finish_application_agent_run(v_second_agent_run,'FAILED','SYNTHETIC_STOP',false);
    select to_jsonb(claim) into v_reply from public.claim_application_agent_cleanup(20) claim;
    if v_reply->>'id' is distinct from v_second_agent_run::text then
      raise exception 'AGENTS_ACCEPTANCE_OLDER_FAILURE_STARVED_NEW_CLEANUP'; end if;
    if not exists(select 1 from public.application_agent_runs where id=v_agent_run and provider_deleted_at is null) then
      raise exception 'AGENTS_ACCEPTANCE_PENDING_CLEANUP_FALSELY_COMPLETE'; end if;
    v_checks := array_append(v_checks,'failed_older_cleanup_yields_to_newer_terminal_run');
    perform public.finish_application_agent_run(v_agent_run,'FAILED','SYNTHETIC_STOP',true);
    begin
      perform public.finish_application_agent_run(v_agent_run,'FAILED','CHANGED_FAILURE',true);
      raise exception 'AGENTS_ACCEPTANCE_TERMINAL_FAILURE_MUTATED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_RUN_STATE_CONFLICT' then raise; end if;
    end;
    if not exists(select 1 from public.application_agent_runs where id=v_agent_run and provider_deleted_at is not null) then
      raise exception 'AGENTS_ACCEPTANCE_CLEANUP_NOT_RECORDED'; end if;
    begin
      perform public.begin_application_agent_tool_call(v_agent_run,'synthetic_session','turn_1','call_terminal','inspect_form',repeat('a',64));
      raise exception 'AGENTS_ACCEPTANCE_TERMINAL_RUN_TOOL_ACCEPTED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_AGENT_BINDING_INACTIVE' then raise; end if;
    end;
    v_checks := array_append(v_checks,'terminal_replay_cleanup_and_new_tool_denial');
    raise exception 'rollback_all_agent_acceptance_fixtures' using errcode='PZ001';
  exception when sqlstate 'PZ001' then null;
  end;

  select to_jsonb(a) into v_after from public.applications a where id=v_context.application_id;
  if v_before is distinct from v_after or exists(select 1 from public.application_agent_runs where id=v_agent_run)
    or exists(select 1 from public.application_fill_attempts where id=v_fill)
    or exists(select 1 from public.approval_challenges where id=v_approval) then
    raise exception 'AGENTS_ACCEPTANCE_FIXTURE_ROLLBACK_FAILED'; end if;
  v_checks := array_append(v_checks,'fixtures_rolled_back_application_unchanged');
  insert into application_agents_runtime_acceptance select unnest(v_checks),true;
end;
$acceptance$;

select check_name,passed from application_agents_runtime_acceptance order by check_name;
