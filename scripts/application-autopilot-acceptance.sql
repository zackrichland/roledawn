-- Run in one explicit BEGIN ... ROLLBACK after the autopilot migration.
-- No provider calls or real application submission. The nested rollback also
-- restores the selected existing application before returning boolean checks.
create temporary table application_autopilot_acceptance(check_name text primary key,passed boolean not null) on commit drop;
create function pg_temp.insert_autopilot_fixture_row(p_table regclass,p_source jsonb,p_overrides jsonb)
returns void language plpgsql as $$
declare v_columns text;
begin
  select string_agg(format('%I',attname),',' order by attnum) into v_columns from pg_attribute
    where attrelid=p_table and attnum>0 and not attisdropped and attgenerated='' and attidentity='';
  execute format('insert into %s(%s) select %s from jsonb_populate_record(null::%s,$1)',p_table,v_columns,v_columns,p_table)
    using p_source||p_overrides;
end; $$;
do $acceptance$
declare
  v_context record; v_before jsonb; v_after jsonb; v_source_application uuid;
  v_fixture_job uuid:=extensions.gen_random_uuid(); v_fixture_job_version uuid:=extensions.gen_random_uuid();
  v_fixture_application uuid:=extensions.gen_random_uuid(); v_fixture_run uuid:=extensions.gen_random_uuid();
  v_fixture_snapshot uuid:=extensions.gen_random_uuid(); v_fixture_research uuid:=extensions.gen_random_uuid();
  v_fixture_revision uuid:=extensions.gen_random_uuid();
  v_id uuid; v_command uuid:=extensions.gen_random_uuid(); v_answer_command uuid:=extensions.gen_random_uuid();
  v_other_actor uuid:=extensions.gen_random_uuid(); v_pause uuid:=extensions.gen_random_uuid(); v_resume uuid:=extensions.gen_random_uuid();
  v_result jsonb; v_claim jsonb; v_lease uuid; v_question uuid; v_version bigint; v_seal text; v_attempt uuid;
  v_questions jsonb:=jsonb_build_array(jsonb_build_object('fieldId','field_'||repeat('b',64),'fingerprint',repeat('b',64),
    'label','Synthetic: are you willing to relocate?','kind','BOOLEAN','required',true,'options','[]'::jsonb,'reasonCode','SENSITIVE_REQUIRES_CANDIDATE'));
  v_answers jsonb; v_receipt jsonb; v_checks text[]:='{}';
begin
  if has_function_privilege('authenticated','public.claim_application_autopilot(text,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.begin_application_autopilot_submit(uuid,uuid,text,text,text)','EXECUTE')
    or has_table_privilege('authenticated','public.application_autopilots','INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','public.application_autopilot_answers','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','private.application_autopilot_runtime','SELECT') then
    raise exception 'AUTOPILOT_ACCEPTANCE_PRIVILEGE_FAILURE'; end if;
  v_checks:=array_append(v_checks,'candidate_and_service_privilege_boundaries');
  select a.id application_id,a.workspace_id,a.candidate_id,a.current_revision_id,a.aggregate_version,
    c.auth_user_id,r.packet_hash,r.input_snapshot_id,r.research_bundle_id,a.job_id,a.job_version_id,to_jsonb(a) before_state into v_context
  from public.applications a
  join public.candidates c on c.id=a.candidate_id and c.workspace_id=a.workspace_id and c.status in ('ACTIVE','ONBOARDING')
  join public.workspaces w on w.id=a.workspace_id and w.status='ACTIVE'
  join public.application_revisions r on r.id=a.current_revision_id and r.application_id=a.id and r.validation_status='PASSED'
  join public.application_input_snapshots s on s.id=r.input_snapshot_id and s.candidate_input_version=c.application_input_version
  where exists(select 1 from public.workspace_memberships m where m.workspace_id=a.workspace_id and m.auth_user_id=c.auth_user_id and m.status='ACTIVE')
    and not exists(select 1 from public.application_attempts x where x.application_id=a.id)
    and not exists(select 1 from public.application_autopilots x where x.application_id=a.id)
    and not exists(select 1 from public.application_fill_attempts x where x.application_id=a.id and x.status in ('QUEUED','STARTED'))
    and not exists(select 1 from public.application_runs x where x.application_id=a.id and x.status in ('QUEUED','RUNNING','WAITING'))
    and (select count(*) from public.artifact_versions f where f.application_revision_id=r.id and f.qa_status='PASSED'
      and f.variant in ('RESUME_PDF','RESUME_DOCX','COVER_LETTER_PDF','COVER_LETTER_DOCX'))=4
  order by a.created_at desc limit 1;
  if not found then raise exception 'AUTOPILOT_ACCEPTANCE_INACTIVE_CURRENT_PACKET_REQUIRED'; end if;
  v_before:=v_context.before_state; v_source_application:=v_context.application_id;
  begin
    -- Clone a packet solely as transaction-local test data. Existing applications,
    -- retained fills and browser sessions are neither changed nor deleted.
    insert into public.jobs(id,canonical_url,state) values(v_fixture_job,'https://jobs.example.com/synthetic/'||v_fixture_job,'OPEN');
    perform pg_temp.insert_autopilot_fixture_row('public.job_versions',to_jsonb(source),jsonb_build_object(
      'id',v_fixture_job_version,'job_id',v_fixture_job,'version_number',1,'apply_url','https://jobs.example.com/synthetic/'||v_fixture_job))
      from public.job_versions source where source.id=v_context.job_version_id;
    perform pg_temp.insert_autopilot_fixture_row('public.applications',to_jsonb(source),jsonb_build_object(
      'id',v_fixture_application,'job_intake_id',null,'job_id',v_fixture_job,'job_version_id',v_fixture_job_version,
      'current_revision_id',null,'status','READY','aggregate_version',1))
      from public.applications source where source.id=v_source_application;
    insert into public.application_runs(id,workspace_id,application_id,run_kind,status,preparation_stage,started_at,finished_at)
      values(v_fixture_run,v_context.workspace_id,v_fixture_application,'PREPARATION','SUCCEEDED','COMPLETE',statement_timestamp(),statement_timestamp());
    perform pg_temp.insert_autopilot_fixture_row('public.application_input_snapshots',to_jsonb(source),jsonb_build_object(
      'id',v_fixture_snapshot,'application_id',v_fixture_application,'preparation_run_id',v_fixture_run,'job_id',v_fixture_job,'job_version_id',v_fixture_job_version))
      from public.application_input_snapshots source where source.id=v_context.input_snapshot_id;
    perform pg_temp.insert_autopilot_fixture_row('public.application_research_bundles',to_jsonb(source),jsonb_build_object(
      'id',v_fixture_research,'application_id',v_fixture_application,'input_snapshot_id',v_fixture_snapshot,
      'freshness_expires_at',statement_timestamp()+interval '1 hour'))
      from public.application_research_bundles source where source.id=v_context.research_bundle_id;
    perform pg_temp.insert_autopilot_fixture_row('public.application_revisions',to_jsonb(source),jsonb_build_object(
      'id',v_fixture_revision,'application_id',v_fixture_application,'job_version_id',v_fixture_job_version,
      'input_snapshot_id',v_fixture_snapshot,'research_bundle_id',v_fixture_research))
      from public.application_revisions source where source.id=v_context.current_revision_id;
    perform pg_temp.insert_autopilot_fixture_row('public.artifact_versions',to_jsonb(source),jsonb_build_object(
      'id',extensions.gen_random_uuid(),'application_revision_id',v_fixture_revision,
      'storage_object_path','synthetic-rollback/'||v_fixture_revision||'/'||source.id))
      from public.artifact_versions source where source.application_revision_id=v_context.current_revision_id;
    perform pg_temp.insert_autopilot_fixture_row('public.application_snapshot_fact_refs',to_jsonb(source),jsonb_build_object(
      'application_id',v_fixture_application,'input_snapshot_id',v_fixture_snapshot))
      from public.application_snapshot_fact_refs source where source.input_snapshot_id=v_context.input_snapshot_id;
    update public.applications set current_revision_id=v_fixture_revision where id=v_fixture_application;
    v_context.application_id:=v_fixture_application; v_context.current_revision_id:=v_fixture_revision; v_context.aggregate_version:=1;
    perform set_config('request.jwt.claim.sub',v_context.auth_user_id::text,true);
    execute 'set local role authenticated';
    v_result:=public.delegate_application_autopilot(v_command,v_context.application_id,v_context.aggregate_version,v_context.current_revision_id,v_context.packet_hash);
    v_id:=(v_result->>'id')::uuid;
    v_result:=public.delegate_application_autopilot(v_command,v_context.application_id,v_context.aggregate_version,v_context.current_revision_id,v_context.packet_hash);
    if v_result->>'replayed'<>'true' then raise exception 'AUTOPILOT_ACCEPTANCE_REPLAY_FAILED'; end if;
    execute 'reset role';
    v_checks:=array_append(v_checks,'candidate_delegation_binds_packet_and_replays');
    perform set_config('request.jwt.claim.sub',v_other_actor::text,true);
    execute 'set local role authenticated';
    if exists(select 1 from public.application_autopilots where id=v_id) then raise exception 'AUTOPILOT_ACCEPTANCE_OTHER_ACTOR_READ'; end if;
    execute 'reset role';
    begin
      execute 'set local role authenticated';
      perform public.control_application_autopilot(v_pause,v_id,1,'PAUSE');
      raise exception 'AUTOPILOT_ACCEPTANCE_OTHER_ACTOR_CONTROL';
    exception when no_data_found then null; end;
    v_checks:=array_append(v_checks,'other_actor_cannot_read_or_control');
    perform set_config('request.jwt.claim.sub',v_context.auth_user_id::text,true);
    -- Isolate this synthetic row without affecting any existing queued job.
    -- Directly construct the service lease on this fixture; claim behavior is
    -- separately exercised in the isolated PostgreSQL fixture harness.
    v_lease:=extensions.gen_random_uuid();
    update public.application_autopilots set status='RUNNING',lease_token=v_lease,lease_owner='synthetic-acceptance',lease_expires_at=now()+interval '5 minutes',version=version+1 where id=v_id;
    perform public.assert_application_autopilot_lease(v_id,v_lease,true);
    perform public.checkpoint_application_autopilot(v_id,v_lease,'PROVISIONING','{"runtimeProvisionKey":"synthetic","runtimeState":"INTENT"}');
    perform public.bind_application_autopilot_resource(v_id,v_lease,'BROWSER','synthetic_browser');
    perform public.bind_application_autopilot_resource(v_id,v_lease,'AGENT','synthetic_agent');
    v_result:=public.begin_application_autopilot_tool(v_id,v_lease,'synthetic_agent','turn1','call1','inspect_form',repeat('a',64));
    if v_result->>'status'<>'new' then raise exception 'AUTOPILOT_ACCEPTANCE_NEW_CALL_FAILED'; end if;
    v_result:=public.begin_application_autopilot_tool(v_id,v_lease,'synthetic_agent','turn1','call1','inspect_form',repeat('a',64));
    if v_result->>'status'<>'uncertain' then raise exception 'AUTOPILOT_ACCEPTANCE_TOOL_REEXECUTION'; end if;
    perform public.complete_application_autopilot_tool(v_id,v_lease,'synthetic_agent','turn1','call1','inspect_form',repeat('a',64),
      '{"type":"agent.session.input.tool_result","turn_id":"turn1","call_id":"call1","success":true,"output":"{}"}');
    v_checks:=array_append(v_checks,'tool_ledger_records_intent_before_effect_and_blocks_reexecution');
    perform public.request_application_autopilot_questions(v_id,v_lease,v_questions);
    select id into strict v_question from public.application_autopilot_questions where autopilot_id=v_id;
    select version into v_version from public.application_autopilots where id=v_id;
    v_answers:=jsonb_build_array(jsonb_build_object('questionId',v_question,'fingerprint',repeat('b',64),'value',false));
    execute 'set local role authenticated';
    v_result:=public.save_application_autopilot_answers(v_answer_command,v_id,v_version,v_answers);
    v_result:=public.save_application_autopilot_answers(v_answer_command,v_id,v_version,v_answers);
    if v_result->>'replayed'<>'true' then raise exception 'AUTOPILOT_ACCEPTANCE_ANSWER_REPLAY'; end if;
    execute 'reset role';
    if not exists(select 1 from public.application_autopilot_answers where question_id=v_question and value_json='false') then
      raise exception 'AUTOPILOT_ACCEPTANCE_EXPLICIT_FALSE_LOST'; end if;
    v_checks:=array_append(v_checks,'candidate_answers_are_exact_immutable_and_requeue_once');
    update public.application_autopilots set status='RUNNING',lease_token=v_lease,lease_owner='synthetic-acceptance',lease_expires_at=now()+interval '5 minutes',version=version+1 where id=v_id;
    select version into v_version from public.application_autopilots where id=v_id;
    execute 'set local role authenticated';
    perform public.control_application_autopilot(v_pause,v_id,v_version,'PAUSE');
    execute 'reset role';
    begin
      perform public.assert_application_autopilot_lease(v_id,v_lease,true);
      raise exception 'AUTOPILOT_ACCEPTANCE_PAUSE_DID_NOT_REVOKE';
    exception when sqlstate '55000' then if sqlerrm<>'APPLICATION_AUTOPILOT_LEASE_INACTIVE' then raise; end if; end;
    select version into v_version from public.application_autopilots where id=v_id;
    execute 'set local role authenticated';
    perform public.control_application_autopilot(v_resume,v_id,v_version,'RESUME');
    execute 'reset role';
    v_lease:=extensions.gen_random_uuid();
    update public.application_autopilots set status='RUNNING',lease_token=v_lease,lease_owner='synthetic-acceptance',lease_expires_at=now()+interval '5 minutes',version=version+1 where id=v_id;
    perform public.bind_application_autopilot_resource(v_id,v_lease,'BROWSER','synthetic_browser_resumed');
    perform public.bind_application_autopilot_resource(v_id,v_lease,'AGENT','synthetic_agent_resumed');
    v_checks:=array_append(v_checks,'candidate_pause_revokes_the_worker_lease');
    v_seal:=public.seal_application_autopilot(v_id,v_lease,'{"synthetic":true}',repeat('c',64),repeat('d',64),
      (select destination_url from public.application_autopilots where id=v_id));
    v_result:=public.begin_application_autopilot_submit(v_id,v_lease,v_seal,repeat('d',64),'synthetic-acceptance/1');
    v_attempt:=(v_result->>'attempt_id')::uuid;
    if not exists(select 1 from public.application_attempts where id=v_attempt and status='STARTED' and approval_action='SUBMIT_APPLICATION_ONCE') then
      raise exception 'AUTOPILOT_ACCEPTANCE_ATTEMPT_NOT_DURABLE'; end if;
    begin
      perform public.begin_application_autopilot_submit(v_id,v_lease,v_seal,repeat('d',64),'synthetic-acceptance/1');
      raise exception 'AUTOPILOT_ACCEPTANCE_SECOND_SUBMIT_PERMITTED';
    exception when sqlstate '55000' then if sqlerrm<>'APPLICATION_AUTOPILOT_MUTATION_DENIED' then raise; end if; end;
    perform public.assert_application_autopilot_lease(v_id,v_lease,false);
    perform public.checkpoint_application_autopilot(v_id,v_lease,'RECEIPT_OBSERVED',jsonb_build_object('observedReceipt',jsonb_build_object('attemptId',v_attempt)));
    perform public.finish_application_autopilot(v_id,v_lease,'FAILED_SAFE','SYNTHETIC_LOST_RESPONSE',null);
    if not exists(select 1 from public.application_autopilots where id=v_id and status='UNCERTAIN') then
      raise exception 'AUTOPILOT_ACCEPTANCE_UNKNOWN_SEND_RETRYABLE'; end if;
    v_checks:=array_append(v_checks,'sealed_single_use_submit_and_uncertain_response_are_durable');
    update public.application_autopilots set status='RECONCILING',lease_token=v_lease,lease_owner='synthetic-acceptance',lease_expires_at=now()+interval '5 minutes',version=version+1 where id=v_id;
    v_receipt:=jsonb_build_object('confirmationKind','PORTAL','confirmationReference','https://jobs.example.com/synthetic/confirmation',
      'evidenceManifest',jsonb_build_object('autopilotId',v_id,'revisionId',v_context.current_revision_id,'packetHash',v_context.packet_hash,
        'attemptId',v_attempt,'requestFingerprint',repeat('d',64),'synthetic',true),
      'receiptHash',encode(extensions.digest(convert_to(v_attempt::text,'utf8'),'sha256'),'hex'),'confirmedAt',statement_timestamp());
    perform public.finish_application_autopilot(v_id,v_lease,'CONFIRMED',null,v_receipt);
    if not exists(select 1 from public.receipts where attempt_id=v_attempt) or not exists(select 1 from public.applications where id=v_context.application_id and status='CONFIRMED') then
      raise exception 'AUTOPILOT_ACCEPTANCE_RECEIPT_NOT_COMMITTED'; end if;
    perform public.bind_application_autopilot_resource(v_id,v_lease,'BROWSER',null);
    perform public.bind_application_autopilot_resource(v_id,v_lease,'AGENT',null);
    if not exists(select 1 from private.application_autopilot_runtime where autopilot_id=v_id and runtime_reference is null and checkpoint->>'runtimeState'='RELEASED') then
      raise exception 'AUTOPILOT_ACCEPTANCE_TERMINAL_CLEANUP_NOT_RECORDED'; end if;
    v_checks:=array_append(v_checks,'confirmed_receipt_and_terminal_resource_cleanup');
    raise exception 'rollback_all_autopilot_acceptance' using errcode='PZ001';
  exception when sqlstate 'PZ001' then null; end;
  select to_jsonb(a) into v_after from public.applications a where a.id=v_source_application;
  if v_before is distinct from v_after or exists(select 1 from public.application_autopilots where id=v_id)
    or exists(select 1 from public.application_attempts where id=v_attempt)
    or exists(select 1 from public.receipts where attempt_id=v_attempt)
    or exists(select 1 from public.command_dedup where command_id in (v_command,v_answer_command,v_pause,v_resume))
    or exists(select 1 from public.applications where id=v_fixture_application)
    or exists(select 1 from public.jobs where id=v_fixture_job)
    or exists(select 1 from public.application_revisions where id=v_fixture_revision) then
    raise exception 'AUTOPILOT_ACCEPTANCE_ROLLBACK_FAILED'; end if;
  v_checks:=array_append(v_checks,'fixtures_removed_and_original_application_byte_equal');
  insert into application_autopilot_acceptance select unnest(v_checks),true;
end;
$acceptance$;
select check_name,passed from application_autopilot_acceptance order by check_name;
