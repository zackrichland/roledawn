-- Run inside one explicit BEGIN ... ROLLBACK transaction after the three agents migrations.
-- This does not call a provider or submit an application. A nested rollback restores
-- the selected inactive application and removes all synthetic authority/questions/replies.
-- Only check names and booleans are returned; candidate IDs and answers are never output.
create temporary table application_agent_questions_acceptance (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $acceptance$
declare
  v_context record;
  v_before jsonb;
  v_after jsonb;
  v_approval uuid := extensions.gen_random_uuid();
  v_consumption uuid := extensions.gen_random_uuid();
  v_browser_run uuid := extensions.gen_random_uuid();
  v_fill uuid := extensions.gen_random_uuid();
  v_session uuid := extensions.gen_random_uuid();
  v_question uuid;
  v_command uuid := extensions.gen_random_uuid();
  v_other_actor uuid := extensions.gen_random_uuid();
  v_resume uuid;
  v_question_json jsonb := jsonb_build_object('fieldId','field_'||repeat('a',64),'fingerprint',repeat('a',64),
    'label','Synthetic: do you wish to relocate?','kind','BOOLEAN','required',true,
    'options','[]'::jsonb,'reasonCode','SENSITIVE_REQUIRES_CANDIDATE');
  v_answers jsonb;
  v_saved record;
  v_checks text[] := '{}';
  v_role text;
  v_table text;
begin
  foreach v_table in array array['public.application_agent_questions','public.application_agent_answers'] loop
    if not exists(select 1 from pg_class where oid=v_table::regclass and relrowsecurity) then
      raise exception 'QUESTIONS_ACCEPTANCE_RLS_MISSING'; end if;
    if not has_table_privilege('authenticated',v_table,'SELECT')
       or has_table_privilege('authenticated',v_table,'INSERT,UPDATE,DELETE')
       or has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'QUESTIONS_ACCEPTANCE_CLIENT_GRANTS_INVALID'; end if;
  end loop;
  if has_table_privilege('service_role','public.application_agent_answers','INSERT,UPDATE,DELETE') then
    raise exception 'QUESTIONS_ACCEPTANCE_SERVICE_REPLY_WRITE'; end if;
  if not has_function_privilege('service_role','public.request_application_agent_questions(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.request_application_agent_questions(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'QUESTIONS_ACCEPTANCE_QUESTION_CREATION_GRANTS_INVALID'; end if;
  if not has_function_privilege('authenticated','public.save_application_agent_answers_and_resume(uuid,uuid,uuid,uuid,uuid,bigint,jsonb)','EXECUTE')
    or has_function_privilege('service_role','public.save_application_agent_answers_and_resume(uuid,uuid,uuid,uuid,uuid,bigint,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.save_application_agent_answers_and_resume(uuid,uuid,uuid,uuid,uuid,bigint,jsonb)','EXECUTE') then
    raise exception 'QUESTIONS_ACCEPTANCE_REPLY_GRANTS_INVALID'; end if;
  v_checks := array_append(v_checks,'candidate_select_only_service_cannot_create_replies');

  select a.id as application_id,a.workspace_id,a.candidate_id,a.current_revision_id,
    c.auth_user_id,a.aggregate_version,to_jsonb(a) as before_state
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
  if not found then raise exception 'QUESTIONS_ACCEPTANCE_CURRENT_PACKET_FIXTURE_REQUIRED'; end if;
  v_before := v_context.before_state;

  begin
    update public.applications set status='TAKEOVER' where id=v_context.application_id;
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
      executor_policy_release,destination_policy_release,status,started_at,completed_at)
    values(v_fill,v_context.workspace_id,v_context.candidate_id,v_context.application_id,v_context.current_revision_id,
      v_consumption,'FILL_APPLICATION_ONCE',v_browser_run,repeat('a',64),'https://boards.greenhouse.io/synthetic/jobs/123',repeat('c',64),
      repeat('d',64),repeat('b',64),'[]',repeat('e',64),'{}',repeat('f',64),
      'synthetic-acceptance/1','synthetic-acceptance/1','TAKEOVER',now(),now());
    insert into public.computer_sessions(id,workspace_id,candidate_id,application_id,revision_id,fill_attempt_id,
      execution_mode,state,start_url,allowed_domain_policy,allowed_domain_policy_hash,mounted_artifact_manifest,
      broker_release,expires_at)
    values(v_session,v_context.workspace_id,v_context.candidate_id,v_context.application_id,v_context.current_revision_id,v_fill,
      'EPHEMERAL_CLEAN','PAUSED_FOR_REVIEW','https://boards.greenhouse.io/synthetic/jobs/123','{}',repeat('1',64),'[]',
      'synthetic-acceptance/1',now()+interval '10 minutes');
    execute 'set local role service_role';
    select id into strict v_question from public.request_application_agent_questions(
      v_context.workspace_id,v_context.candidate_id,v_context.application_id,v_context.current_revision_id,v_fill,v_session,
      jsonb_build_array(v_question_json));
    perform public.request_application_agent_questions(v_context.workspace_id,v_context.candidate_id,
      v_context.application_id,v_context.current_revision_id,v_fill,v_session,'[]');
    if not exists(select 1 from public.application_agent_questions where id=v_question and status='SUPERSEDED') then
      raise exception 'QUESTIONS_ACCEPTANCE_EMPTY_SET_NOT_SUPERSEDED'; end if;
    perform public.request_application_agent_questions(v_context.workspace_id,v_context.candidate_id,
      v_context.application_id,v_context.current_revision_id,v_fill,v_session,jsonb_build_array(v_question_json));
    if not exists(select 1 from public.application_agent_questions where id=v_question and status='OPEN') then
      raise exception 'QUESTIONS_ACCEPTANCE_REOPEN_FAILED'; end if;
    execute 'reset role';
    v_checks := array_append(v_checks,'empty_set_supersedes_and_same_schema_reopens');
    v_answers := jsonb_build_array(jsonb_build_object('questionId',v_question,'fingerprint',repeat('a',64),'value',false));

    perform set_config('request.jwt.claim.sub',v_context.auth_user_id::text,true);
    execute 'set local role authenticated';
    if (select count(*) from public.application_agent_questions where computer_session_id=v_session) <> 1 then
      raise exception 'QUESTIONS_ACCEPTANCE_OWNER_CANNOT_READ'; end if;
    execute 'reset role';
    v_checks := array_append(v_checks,'owner_can_read_questions');
    begin
      execute 'set local role authenticated';
      perform public.request_application_agent_questions(v_context.workspace_id,v_context.candidate_id,
        v_context.application_id,v_context.current_revision_id,v_fill,v_session,jsonb_build_array(v_question_json));
      raise exception 'QUESTIONS_ACCEPTANCE_CANDIDATE_CREATED_QUESTION';
    exception when insufficient_privilege then null; end;
    foreach v_role in array array['authenticated','service_role'] loop
      begin
        execute format('set local role %I',v_role);
        insert into public.application_agent_answers(question_id,value_json,answered_by,command_id)
          values(v_question,'false',v_context.auth_user_id,v_command);
        raise exception 'QUESTIONS_ACCEPTANCE_DIRECT_REPLY_INSERT';
      exception when insufficient_privilege then null; end;
    end loop;
    v_checks := array_append(v_checks,'actual_role_direct_writes_and_candidate_question_creation_denied');

    perform set_config('request.jwt.claim.sub',v_other_actor::text,true);
    execute 'set local role authenticated';
    if exists(select 1 from public.application_agent_questions where computer_session_id=v_session) then
      raise exception 'QUESTIONS_ACCEPTANCE_OTHER_ACTOR_CAN_READ'; end if;
    execute 'reset role';
    begin
      execute 'set local role authenticated';
      perform public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version,v_answers);
      raise exception 'QUESTIONS_ACCEPTANCE_OTHER_ACTOR_SAVED';
    exception when no_data_found then null; end;
    v_checks := array_append(v_checks,'other_actor_cannot_read_or_answer');
    perform set_config('request.jwt.claim.sub',v_context.auth_user_id::text,true);

    begin
      execute 'set local role authenticated';
      perform public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version+1,v_answers);
      raise exception 'QUESTIONS_ACCEPTANCE_STALE_VERSION_ACCEPTED';
    exception when sqlstate 'PT409' then
      if sqlerrm <> 'APPLICATION_AGENT_ANSWERS_STALE' then raise; end if; end;
    begin
      execute 'set local role authenticated';
      perform public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version,
        jsonb_set(v_answers,'{0,fingerprint}',to_jsonb(repeat('b',64))));
      raise exception 'QUESTIONS_ACCEPTANCE_STALE_FINGERPRINT_ACCEPTED';
    exception when no_data_found then null; end;
    begin
      execute 'set local role authenticated';
      perform public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version,jsonb_set(v_answers,'{0,value}','"No"'));
      raise exception 'QUESTIONS_ACCEPTANCE_UNTYPED_BOOLEAN_ACCEPTED';
    exception when invalid_parameter_value then
      if sqlerrm <> 'APPLICATION_AGENT_ANSWER_INVALID' then raise; end if; end;
    v_checks := array_append(v_checks,'stale_version_fingerprint_and_invalid_choice_denied');

    begin
      update public.computer_sessions set state='CLOSED' where id=v_session;
      execute 'set local role authenticated';
      perform public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version,v_answers);
      raise exception 'QUESTIONS_ACCEPTANCE_CLOSED_BROWSER_RESUMED';
    exception when sqlstate '55000' then
      if sqlerrm <> 'APPLICATION_FILL_RESUME_STATE_INVALID' then raise; end if; end;
    if exists(select 1 from public.application_agent_answers where question_id=v_question)
      or not exists(select 1 from public.application_agent_questions where id=v_question and status='OPEN')
      or exists(select 1 from public.application_fill_resume_attempts where computer_session_id=v_session) then
      raise exception 'QUESTIONS_ACCEPTANCE_REPLIES_NOT_ATOMIC'; end if;
    v_checks := array_append(v_checks,'unsafe_continuation_rolls_back_replies_and_status');

    execute 'set local role authenticated';
    select * into strict v_saved from public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
      v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version,v_answers);
    if v_saved.replayed or v_saved.aggregate_version <> v_context.aggregate_version+1 then
      raise exception 'QUESTIONS_ACCEPTANCE_FIRST_SAVE_INVALID'; end if;
    v_resume := v_saved.resume_attempt_id;
    if not exists(select 1 from public.application_agent_answers where question_id=v_question and value_json='false') then
      raise exception 'QUESTIONS_ACCEPTANCE_EXPLICIT_NO_NOT_SAVED'; end if;
    select * into strict v_saved from public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
      v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version,v_answers);
    if not v_saved.replayed or v_saved.resume_attempt_id <> v_resume then
      raise exception 'QUESTIONS_ACCEPTANCE_REPLAY_CHANGED'; end if;
    execute 'reset role';
    if (select count(*) from public.application_fill_resume_attempts where computer_session_id=v_session) <> 1
      or (select count(*) from public.outbox where topic='application.browser_fill_resume_requested'
        and payload->>'resume_attempt_id'=v_resume::text) <> 1
      or (select aggregate_version from public.applications where id=v_context.application_id) <> v_context.aggregate_version+1 then
      raise exception 'QUESTIONS_ACCEPTANCE_RESUME_OR_OUTBOX_DUPLICATED'; end if;
    v_checks := array_append(v_checks,'explicit_no_saved_with_one_resume_one_outbox_and_replay');
    begin
      execute 'set local role authenticated';
      perform public.save_application_agent_answers_and_resume(v_command,v_context.application_id,
        v_context.current_revision_id,v_fill,v_session,v_context.aggregate_version,jsonb_set(v_answers,'{0,value}','true'));
      raise exception 'QUESTIONS_ACCEPTANCE_REPLAY_PAYLOAD_MUTATED';
    exception when unique_violation then
      if sqlerrm <> 'COMMAND_ID_PAYLOAD_MISMATCH' then raise; end if; end;
    begin
      update public.application_agent_answers set value_json='true' where question_id=v_question;
      raise exception 'QUESTIONS_ACCEPTANCE_REPLY_MUTATED';
    exception when sqlstate '55000' then null; end;
    execute 'set local role service_role';
    perform public.request_application_agent_questions(v_context.workspace_id,v_context.candidate_id,
      v_context.application_id,v_context.current_revision_id,v_fill,v_session,'[]');
    execute 'reset role';
    if not exists(select 1 from public.application_agent_questions where id=v_question and status='ANSWERED') then
      raise exception 'QUESTIONS_ACCEPTANCE_EMPTY_SET_CHANGED_REPLY'; end if;
    v_checks := array_append(v_checks,'immutable_reply_payload_and_answered_status');
    perform set_config('request.jwt.claim.sub',v_other_actor::text,true);
    execute 'set local role authenticated';
    if exists(select 1 from public.application_agent_answers where question_id=v_question) then
      raise exception 'QUESTIONS_ACCEPTANCE_OTHER_ACTOR_READ_REPLY'; end if;
    execute 'reset role';
    v_checks := array_append(v_checks,'other_actor_cannot_read_candidate_reply');
    raise exception 'rollback_all_question_acceptance_fixtures' using errcode='PZ001';
  exception when sqlstate 'PZ001' then null;
  end;

  select to_jsonb(a) into v_after from public.applications a where id=v_context.application_id;
  if v_before is distinct from v_after
    or exists(select 1 from public.application_agent_questions where id=v_question)
    or exists(select 1 from public.application_agent_answers where question_id=v_question)
    or exists(select 1 from public.application_fill_resume_attempts where id=v_resume)
    or exists(select 1 from public.application_fill_attempts where id=v_fill)
    or exists(select 1 from public.approval_challenges where id=v_approval)
    or exists(select 1 from public.command_dedup where command_id=v_command)
    or exists(select 1 from public.outbox where payload->>'resume_attempt_id'=v_resume::text) then
    raise exception 'QUESTIONS_ACCEPTANCE_FIXTURE_ROLLBACK_FAILED'; end if;
  v_checks := array_append(v_checks,'all_fixtures_rolled_back_application_byte_equal');
  insert into application_agent_questions_acceptance select unnest(v_checks),true;
end;
$acceptance$;

select check_name,passed from application_agent_questions_acceptance order by check_name;
