-- Local PGlite check for 20260930050000_standing_answers.sql and 20260930060000_standing_answers_recheck.sql.
--   node scripts/migration-harness.mjs supabase/checks/standing_answers.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table standing_answer_checks(check_name text primary key, passed boolean not null) on commit drop;

create function pg_temp.candidate() returns jsonb
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_user,'standing-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Standing check','PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Standing check','ACTIVE');
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
    values(v_version,v_job,1,encode(sha256(convert_to(v_version::text,'UTF8')),'hex'),'Synthetic role','Synthetic employer','Synthetic only.','https://job-boards.greenhouse.io/roledawncheck/jobs/1',now());
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
      'RUNNING',v_lease,'standing-check',now()+interval '5 minutes');
  insert into private.application_autopilot_runtime(autopilot_id) values(v_autopilot);
  set local session_replication_role=origin;
  update public.applications set current_revision_id=v_revision where id=v_application;
  return p_who||jsonb_build_object('autopilot',v_autopilot,'lease',v_lease,'application',v_application);
end $$;

create function pg_temp.question(p_label text, p_kind text, p_options jsonb, p_required boolean default true) returns jsonb
language sql as $$
  select jsonb_build_object('fieldId','field_'||md5(p_label||p_options::text),'fingerprint',encode(sha256(convert_to(p_label||p_options::text||random()::text,'UTF8')),'hex'),
    'label',p_label,'kind',p_kind,'required',p_required,'reasonCode','MISSING_EXACT_ANSWER','options',p_options);
$$;

create function pg_temp.as_worker_request(p_fixture jsonb, p_questions jsonb) returns void
language plpgsql as $$
begin
  execute 'set local role service_role';
  perform public.request_application_autopilot_questions((p_fixture->>'autopilot')::uuid,(p_fixture->>'lease')::uuid,p_questions);
  execute 'reset role';
end $$;

-- The candidate's earlier answer on another application.
create function pg_temp.answer_earlier(p_fixture jsonb, p_descriptor jsonb, p_value jsonb) returns void
language plpgsql as $$
declare v_question uuid:=gen_random_uuid();
begin
  insert into public.application_autopilot_questions(id,autopilot_id,fingerprint,descriptor,status) values(v_question,(p_fixture->>'autopilot')::uuid,p_descriptor->>'fingerprint',p_descriptor,'ANSWERED');
  insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id) values(v_question,p_value,(p_fixture->>'user')::uuid,gen_random_uuid());
end $$;

create function pg_temp.as_candidate(p_who jsonb) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_who->>'user', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_who->>'user', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $check$
declare who jsonb:=pg_temp.candidate(); stranger jsonb:=pg_temp.candidate(); run jsonb; later jsonb; other jsonb; v_gpa uuid; v_onsite uuid; v_other uuid; v_result jsonb; v_count integer;
  gpa jsonb:=pg_temp.question('What were your undergrad and grad school (if applicable) GPAs?','MULTI_SELECT','[{"label":"3.4 - 3.59","value":"g-0"},{"label":"3.6 - 3.79","value":"g-1"}]');
  onsite jsonb:=pg_temp.question('Are you able to work 5 days on-site in Tempe, Arizona?','SINGLE_SELECT','[{"label":"Yes","value":"o-0"},{"label":"No","value":"o-1"}]');
  sensitive jsonb:=pg_temp.question('Gender','SINGLE_SELECT','[{"label":"Man","value":"s-0"},{"label":"Decline","value":"s-1"}]')||'{"reasonCode":"SENSITIVE_REQUIRES_CANDIDATE"}';
begin
  -- Candidates save standing answers for themselves; saving a topic again replaces it.
  perform pg_temp.as_candidate(who);
  v_gpa:=public.save_candidate_standing_answer('Undergraduate GPA', '3.4');
  if public.save_candidate_standing_answer('undergraduate  gpa', '3.5') <> v_gpa then raise exception 'CHECK_TOPIC_NOT_REPLACED'; end if;
  v_onsite:=public.save_candidate_standing_answer('Able to work on-site or commute', 'Yes');
  if (select answer from public.candidate_standing_answers where id=v_gpa) <> '3.5' then raise exception 'CHECK_ANSWER_NOT_UPDATED'; end if;
  begin
    perform public.save_candidate_standing_answer('', 'Yes');
    raise exception 'CHECK_EMPTY_TOPIC_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  perform pg_temp.as_candidate(stranger);
  v_other:=public.save_candidate_standing_answer('Undergraduate GPA', '2.1');
  if exists(select 1 from public.candidate_standing_answers where id=v_gpa) then raise exception 'CHECK_STRANGER_READS_ANSWERS'; end if;
  if public.delete_candidate_standing_answer(v_gpa) then raise exception 'CHECK_STRANGER_DELETED'; end if;
  execute 'reset role';
  insert into standing_answer_checks values('candidates_save_replace_and_own_their_standing_answers', true);

  -- The worker holding the lease reads them and records derived answers with their basis.
  run:=pg_temp.running(who);
  execute 'set local role service_role';
  v_result:=public.read_candidate_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid);
  if jsonb_array_length(v_result->'answers')<>2 or v_result::text like '%2.1%' or v_result->'job'->>'employer'<>'Synthetic employer' then raise exception 'CHECK_READ_WRONG_ANSWERS %', v_result; end if;
  v_result:=public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid, jsonb_build_array(
    jsonb_build_object('descriptor',gpa,'value','["g-0"]'::jsonb,'basis',jsonb_build_array(v_gpa)),
    jsonb_build_object('descriptor',onsite,'value','"o-0"'::jsonb,'basis',jsonb_build_array(v_onsite,'fact:location.city'))));
  execute 'reset role';
  if jsonb_array_length(v_result)<>2 or (v_result->0->>'field_id')<>(gpa->>'fieldId') then raise exception 'CHECK_RECORD_RESULT %', v_result; end if;
  select count(*) into v_count from public.application_autopilot_questions q join public.application_autopilot_answers a on a.question_id=q.id
    where q.autopilot_id=(run->>'autopilot')::uuid and q.status='ANSWERED' and a.source='STANDING' and a.basis is not null;
  if v_count<>2 then raise exception 'CHECK_STANDING_NOT_LABELED'; end if;
  if (select status from public.application_autopilots where id=(run->>'autopilot')::uuid)<>'RUNNING' then raise exception 'CHECK_STATUS_CHANGED'; end if;
  insert into standing_answer_checks values('worker_records_labeled_answers_without_changing_status', true);

  -- Refused: a sensitive question resting on a non-authorization fact, an option not on the form,
  -- another candidate's answer as basis, no basis.
  execute 'set local role service_role';
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',sensitive,'value','"s-1"'::jsonb,'basis',jsonb_build_array('fact:location.city'))));
    raise exception 'CHECK_SENSITIVE_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',pg_temp.question('Weekends?','SINGLE_SELECT','[{"label":"Yes","value":"w-0"}]'),'value','"w-9"'::jsonb,'basis',jsonb_build_array(v_onsite))));
    raise exception 'CHECK_UNKNOWN_OPTION_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',pg_temp.question('GPA','TEXT','[]'),'value','"2.1"'::jsonb,'basis',jsonb_build_array(v_other))));
    raise exception 'CHECK_FOREIGN_BASIS_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',pg_temp.question('GPA','TEXT','[]'),'value','"3.5"'::jsonb,'basis','[]'::jsonb)));
    raise exception 'CHECK_EMPTY_BASIS_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,gen_random_uuid(),'[]'::jsonb);
    raise exception 'CHECK_STALE_LEASE_ACCEPTED';
  exception when others then
    if sqlerrm like 'CHECK_%' then raise; end if;
  end;
  execute 'reset role';
  insert into standing_answer_checks values('sensitive_unknown_foreign_or_unsupported_answers_are_refused', true);

  -- The SQL boundary must enforce the worker's candidate-only and required
  -- rules, even when the basis is a valid answer owned by this candidate.
  execute 'set local role service_role';
  for v_result in select value from jsonb_array_elements(jsonb_build_array(
    sensitive,
    pg_temp.question('I agree to the privacy policy', 'BOOLEAN', '[]'),
    pg_temp.question('Do you accept binding arbitration?', 'BOOLEAN', '[]'),
    pg_temp.question('Please confirm that all information provided is true', 'BOOLEAN', '[]'),
    pg_temp.question('Are you bound by a non-compete?', 'BOOLEAN', '[]'),
    pg_temp.question('Do you identify as a person of color?', 'BOOLEAN', '[]'),
    pg_temp.question('We would love to hear this in your own words, without using AI.', 'LONG_TEXT', '[]'),
    pg_temp.question('Do not use artificial intelligence.', 'LONG_TEXT', '[]'),
    pg_temp.question('Please don''t use AI.', 'LONG_TEXT', '[]'),
    pg_temp.question('Please don’t use AI.', 'LONG_TEXT', '[]'),
    pg_temp.question('No AI in this response.', 'LONG_TEXT', '[]'),
    pg_temp.question('Optional on-site question', 'BOOLEAN', '[]', false),
    pg_temp.question('Select an answer', 'SINGLE_SELECT', '[{"label":"Man","value":"s-0"},{"label":"Prefer not to disclose gender","value":"s-1"}]')
  )) loop
    begin
      perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
        jsonb_build_array(jsonb_build_object('descriptor',v_result,
          'value',case when v_result->>'kind' = 'BOOLEAN' then 'true'::jsonb else '"s-0"'::jsonb end,
          'basis',jsonb_build_array(v_onsite))));
      raise exception 'CHECK_CANDIDATE_ONLY_OR_OPTIONAL_ACCEPTED %', v_result->>'label';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',pg_temp.question('GPA', 'TEXT', '[]'),
        'value','"3.5"'::jsonb,'basis',jsonb_build_array('fact:identity.legal_name'))));
    raise exception 'CHECK_DISALLOWED_FACT_BASIS_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',pg_temp.question('GPA', 'TEXT', '[]'),
        'value',to_jsonb(repeat('x',1001)),'basis',jsonb_build_array(v_gpa))));
    raise exception 'CHECK_OVERSIZED_STANDING_TEXT_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  insert into standing_answer_checks values('database_enforces_worker_eligibility_and_fact_allowlist', true);

  -- Standing-derived answers are never remembered: an edited standing answer takes effect next time.
  later:=pg_temp.running(who);
  execute 'set local role service_role';
  v_result:=public.prefill_application_autopilot_answers((later->>'autopilot')::uuid,(later->>'lease')::uuid,jsonb_build_array(gpa||jsonb_build_object('fingerprint',encode(sha256(convert_to('later-gpa','UTF8')),'hex'))));
  execute 'reset role';
  if jsonb_array_length(v_result)<>0 then raise exception 'CHECK_STANDING_ANSWER_REMEMBERED %', v_result; end if;
  insert into standing_answer_checks values('standing_answers_are_not_remembered', true);

  -- A candidate's exact legal/consent/demographic answer belongs to the send
  -- where it was given. Cross-application recall must not bypass that boundary.
  for v_result in select value from jsonb_array_elements(jsonb_build_array(
    sensitive,
    pg_temp.question('I agree to the privacy policy', 'BOOLEAN', '[]'),
    pg_temp.question('Do you accept binding arbitration?', 'BOOLEAN', '[]'),
    pg_temp.question('Please confirm that all information provided is true', 'BOOLEAN', '[]'),
    pg_temp.question('Are you bound by a non-compete?', 'BOOLEAN', '[]'),
    pg_temp.question('Do you identify as a person of color?', 'BOOLEAN', '[]'),
    pg_temp.question('We would love to hear this in your own words, without using AI.', 'LONG_TEXT', '[]')
  )) loop
    perform pg_temp.answer_earlier(run,v_result,case when v_result->>'kind' = 'BOOLEAN' then 'true'::jsonb else '"s-0"'::jsonb end);
    execute 'set local role service_role';
    if jsonb_array_length(public.prefill_application_autopilot_answers((later->>'autopilot')::uuid,(later->>'lease')::uuid,jsonb_build_array(v_result))) <> 0 then
      raise exception 'CHECK_CANDIDATE_ONLY_ANSWER_REMEMBERED %', v_result->>'label'; end if;
    execute 'reset role';
  end loop;
  insert into standing_answer_checks values('candidate_only_answers_are_not_reused_across_applications', true);

  -- A sensitive work-authorization question may rest on the work-authorization fact or the candidate's own standing answer.
  later:=pg_temp.running(who);
  execute 'set local role service_role';
  v_result:=public.record_application_autopilot_standing_answers((later->>'autopilot')::uuid,(later->>'lease')::uuid, jsonb_build_array(
    jsonb_build_object('descriptor',pg_temp.question('Will you require sponsorship?','SINGLE_SELECT','[{"label":"Yes","value":"y"},{"label":"No","value":"n"}]')||'{"reasonCode":"SENSITIVE_REQUIRES_CANDIDATE"}',
      'value','"n"'::jsonb,'basis',jsonb_build_array('fact:work_authorization.us.sponsorship_required')),
    jsonb_build_object('descriptor',pg_temp.question('Are you at least 18 years of age?','SINGLE_SELECT','[{"label":"Yes","value":"y"},{"label":"No","value":"n"}]')||'{"reasonCode":"SENSITIVE_REQUIRES_CANDIDATE"}',
      'value','"y"'::jsonb,'basis',jsonb_build_array(v_onsite))));
  execute 'reset role';
  if jsonb_array_length(v_result)<>2 then raise exception 'CHECK_SENSITIVE_WITH_BASIS_REFUSED %', v_result; end if;
  insert into standing_answer_checks values('sensitive_questions_accept_authorization_facts_and_own_standing_answers', true);

  -- A question this send already asked, still open, is answered when a standing answer now covers it.
  execute 'set local role service_role';
  perform public.request_application_autopilot_questions((later->>'autopilot')::uuid,(later->>'lease')::uuid,jsonb_build_array(onsite));
  execute 'reset role';
  if (select status from public.application_autopilots where id=(later->>'autopilot')::uuid)<>'WAITING_ANSWERS' then raise exception 'CHECK_NOT_WAITING'; end if;
  update public.application_autopilots set status='RUNNING',lease_token=(later->>'lease')::uuid,lease_owner='standing-check',lease_expires_at=now()+interval '5 minutes' where id=(later->>'autopilot')::uuid;
  execute 'set local role service_role';
  v_result:=public.record_application_autopilot_standing_answers((later->>'autopilot')::uuid,(later->>'lease')::uuid,
    jsonb_build_array(jsonb_build_object('descriptor',onsite,'value','"o-0"'::jsonb,'basis',jsonb_build_array(v_onsite))));
  execute 'reset role';
  if jsonb_array_length(v_result)<>1 or (select status from public.application_autopilot_questions where autopilot_id=(later->>'autopilot')::uuid and fingerprint=onsite->>'fingerprint')<>'ANSWERED' then
    raise exception 'CHECK_OPEN_QUESTION_NOT_ANSWERED %', v_result; end if;
  insert into standing_answer_checks values('open_questions_are_answered_when_covered', true);

  -- Saving a standing answer puts sends that wait on questions back in the queue; other candidates' sends are untouched.
  run:=pg_temp.running(who);
  execute 'set local role service_role';
  perform public.request_application_autopilot_questions((run->>'autopilot')::uuid,(run->>'lease')::uuid,
    jsonb_build_array(pg_temp.question('Do you have a valid driver''s license?','SINGLE_SELECT','[{"label":"Yes","value":"d-0"},{"label":"No","value":"d-1"}]')));
  execute 'reset role';
  other:=pg_temp.running(stranger);
  execute 'set local role service_role';
  perform public.request_application_autopilot_questions((other->>'autopilot')::uuid,(other->>'lease')::uuid,
    jsonb_build_array(pg_temp.question('Do you have a valid driver''s license?','SINGLE_SELECT','[{"label":"Yes","value":"d-0"},{"label":"No","value":"d-1"}]')));
  execute 'reset role';
  perform pg_temp.as_candidate(who);
  perform public.save_candidate_standing_answer('Valid driver''s license', 'Yes');
  execute 'reset role';
  if (select status from public.application_autopilots where id=(run->>'autopilot')::uuid)<>'QUEUED' then raise exception 'CHECK_WAITING_SEND_NOT_REQUEUED'; end if;
  if (select status from public.application_autopilots where id=(other->>'autopilot')::uuid)<>'WAITING_ANSWERS' then raise exception 'CHECK_OTHER_CANDIDATE_REQUEUED'; end if;
  insert into standing_answer_checks values('saving_an_answer_requeues_only_the_candidates_waiting_sends', true);

  -- Candidates cannot call the worker functions.
  perform pg_temp.as_candidate(who);
  begin
    perform public.read_candidate_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid);
    raise exception 'CHECK_CANDIDATE_CALLED_WORKER_READ';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  insert into standing_answer_checks values('candidates_cannot_call_worker_functions', true);
end $check$;

do $check$
declare who jsonb:=pg_temp.candidate(); run jsonb; q jsonb; result jsonb;
begin
  run:=pg_temp.running(who);
  q:=pg_temp.question('Tell us in your own words, without using AI.', 'LONG_TEXT', '[]');
  perform pg_temp.answer_earlier(run,q,'"Candidate-authored answer"'::jsonb);
  execute 'set local role service_role';
  result:=public.read_application_autopilot_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid);
  execute 'reset role';
  if jsonb_array_length(result)<>1 or result->0->>'value'<>'Candidate-authored answer' then
    raise exception 'CHECK_OWN_NO_AI_ANSWER_NOT_READ'; end if;
  insert into standing_answer_checks values('same_application_candidate_no_ai_answer_remains_usable',true);
end $check$;

select check_name, passed from standing_answer_checks order by check_name;
rollback;
