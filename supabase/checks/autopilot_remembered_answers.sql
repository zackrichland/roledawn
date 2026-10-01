-- Local PGlite checks for remembered answers and D-122 job-context restrictions.
--   node scripts/migration-harness.mjs supabase/checks/autopilot_remembered_answers.sql
-- Synthetic rows only; everything is rolled back. Worker calls run as service_role.
begin;
create temporary table remembered_answer_checks(check_name text primary key, passed boolean not null) on commit drop;

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

-- A fresh send for the exact same immutable packet/job context. The former
-- send is terminal; only its original candidate answers can be recalled.
create function pg_temp.retrying(p_fixture jsonb) returns jsonb
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_lease uuid := gen_random_uuid();
begin
  update public.application_autopilots set status = 'CANCELED', lease_token = null, lease_owner = null, lease_expires_at = null
    where application_id = (p_fixture->>'application')::uuid and status not in ('CANCELED','FAILED_SAFE');
  insert into public.application_autopilots(id, workspace_id, candidate_id, application_id, revision_id, delegated_by,
    command_id, packet_hash, destination_url, artifact_manifest, disclosure_manifest, status, lease_token, lease_owner, lease_expires_at)
  select v_id, workspace_id, candidate_id, application_id, revision_id, delegated_by, gen_random_uuid(), packet_hash,
    destination_url, artifact_manifest, disclosure_manifest, 'RUNNING', v_lease, 'remembered-retry', now()+interval '5 minutes'
  from public.application_autopilots where id = (p_fixture->>'autopilot')::uuid;
  insert into private.application_autopilot_runtime(autopilot_id) values(v_id);
  return p_fixture || jsonb_build_object('autopilot',v_id,'lease',v_lease);
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
create function pg_temp.answer_earlier(p_fixture jsonb, p_descriptor jsonb, p_value jsonb, p_source text default 'CANDIDATE') returns void
language plpgsql as $$
declare v_question uuid:=gen_random_uuid();
begin
  insert into public.application_autopilot_questions(id,autopilot_id,fingerprint,descriptor,status) values(v_question,(p_fixture->>'autopilot')::uuid,p_descriptor->>'fingerprint',p_descriptor,'ANSWERED');
  insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id,source) values(v_question,p_value,(p_fixture->>'user')::uuid,gen_random_uuid(),p_source);
end $$;

do $check$
declare who jsonb:=pg_temp.candidate(); earlier jsonb; now_a jsonb; now_b jsonb; other jsonb;
  sponsor_old jsonb:=pg_temp.question('Will you now or in the future require visa sponsorship?*','SINGLE_SELECT','[{"label":"Yes","value":"old-0"},{"label":"No","value":"old-1"}]');
  heard_old jsonb:=pg_temp.question('How did you hear about this job?','TEXT','[]');
  gpa_old jsonb:=pg_temp.question('What were your undergrad GPAs? *','MULTI_SELECT','[{"label":"3.4 - 3.59","value":"g-0"},{"label":"3.6 - 3.79","value":"g-1"}]');
  sponsor_new jsonb:=pg_temp.question('Will you now or in the future require visa sponsorship? (required)','SINGLE_SELECT','[{"label":"Yes","value":"new-0"},{"label":"No","value":"new-1"}]');
  heard_new jsonb:=pg_temp.question('How did you hear about this job? How did you hear about this job?','TEXT','[]');
  gpa_new jsonb:=pg_temp.question('What were your undergrad GPAs?','MULTI_SELECT','[{"label":"3.6 - 3.79","value":"h-1"},{"label":"3.4 - 3.59","value":"h-0"}]');
  unseen jsonb:=pg_temp.question('Are you open to working weekends?','SINGLE_SELECT','[{"label":"Yes","value":"w-0"},{"label":"No","value":"w-1"}]');
  v_row public.application_autopilots%rowtype;
begin
  earlier:=pg_temp.running(who);
  perform pg_temp.answer_earlier(earlier,sponsor_old,'"old-1"');
  perform pg_temp.answer_earlier(earlier,heard_old,'"Example careers website"');
  perform pg_temp.answer_earlier(earlier,gpa_old,'["g-0"]');

  -- A remembered question is answered by option label; a new one still waits for the candidate.
  now_a:=pg_temp.retrying(earlier);
  perform pg_temp.as_worker_request(now_a,jsonb_build_array(sponsor_new,unseen));
  if (select a.value_json from public.application_autopilot_questions q join public.application_autopilot_answers a on a.question_id=q.id
      where q.autopilot_id=(now_a->>'autopilot')::uuid and q.fingerprint=sponsor_new->>'fingerprint')<>'"new-1"' then raise exception 'CHECK_SELECT_NOT_REMEMBERED'; end if;
  if (select status from public.application_autopilot_questions where autopilot_id=(now_a->>'autopilot')::uuid and fingerprint=unseen->>'fingerprint')<>'OPEN' then raise exception 'CHECK_UNSEEN_ANSWERED'; end if;
  if (select status from public.application_autopilots where id=(now_a->>'autopilot')::uuid)<>'WAITING_ANSWERS' then raise exception 'CHECK_NOT_WAITING'; end if;
  insert into remembered_answer_checks values('remembered_answer_maps_by_option_label_and_new_questions_wait',true);

  -- When every question is remembered, the send continues without the candidate.
  now_b:=pg_temp.retrying(earlier);
  perform pg_temp.as_worker_request(now_b,jsonb_build_array(heard_new,gpa_new));
  select * into v_row from public.application_autopilots where id=(now_b->>'autopilot')::uuid;
  if v_row.status<>'QUEUED' or v_row.lease_token is not null or v_row.available_at<=now() then raise exception 'CHECK_NOT_CONTINUED %',v_row.status; end if;
  if (select a.value_json from public.application_autopilot_questions q join public.application_autopilot_answers a on a.question_id=q.id
      where q.autopilot_id=(now_b->>'autopilot')::uuid and q.fingerprint=heard_new->>'fingerprint')<>'"Example careers website"' then raise exception 'CHECK_TEXT_NOT_REMEMBERED'; end if;
  if (select a.value_json from public.application_autopilot_questions q join public.application_autopilot_answers a on a.question_id=q.id
      where q.autopilot_id=(now_b->>'autopilot')::uuid and q.fingerprint=gpa_new->>'fingerprint')<>'["h-0"]' then raise exception 'CHECK_MULTI_NOT_REMEMBERED'; end if;
  if (select status from public.applications where id=(now_b->>'application')::uuid)<>'EXECUTING' then raise exception 'CHECK_APPLICATION_NOT_EXECUTING'; end if;
  insert into remembered_answer_checks values('all_remembered_questions_continue_the_send',true);

  -- Another candidate's answers are never used.
  other:=pg_temp.running(pg_temp.candidate());
  perform pg_temp.as_worker_request(other,jsonb_build_array(pg_temp.question('Will you now or in the future require visa sponsorship?*','SINGLE_SELECT','[{"label":"Yes","value":"o-0"},{"label":"No","value":"o-1"}]')));
  if (select status from public.application_autopilots where id=(other->>'autopilot')::uuid)<>'WAITING_ANSWERS'
    or exists(select 1 from public.application_autopilot_answers a join public.application_autopilot_questions q on q.id=a.question_id where q.autopilot_id=(other->>'autopilot')::uuid) then
    raise exception 'CHECK_CROSS_CANDIDATE_ANSWER'; end if;
  insert into remembered_answer_checks values('other_candidates_answers_are_never_used',true);

  -- A choice that no longer exists on the new form is asked again.
  now_a:=pg_temp.retrying(earlier);
  perform pg_temp.as_worker_request(now_a,jsonb_build_array(pg_temp.question('Will you now or in the future require visa sponsorship?','SINGLE_SELECT','[{"label":"Yes, now","value":"x-0"},{"label":"Not now","value":"x-1"}]')));
  if (select status from public.application_autopilots where id=(now_a->>'autopilot')::uuid)<>'WAITING_ANSWERS' then raise exception 'CHECK_MISSING_OPTION_GUESSED'; end if;
  insert into remembered_answer_checks values('missing_choice_is_asked_again',true);
end $check$;

create function pg_temp.as_worker_prefill(p_fixture jsonb, p_questions jsonb) returns jsonb
language plpgsql as $$
declare v_result jsonb;
begin
  execute 'set local role service_role';
  v_result:=public.prefill_application_autopilot_answers((p_fixture->>'autopilot')::uuid,(p_fixture->>'lease')::uuid,p_questions);
  execute 'reset role';
  return v_result;
end $$;

do $prefill$
declare who jsonb:=pg_temp.candidate(); earlier jsonb; now_c jsonb; v_result jsonb; v_again jsonb;
  sponsor_old jsonb:=pg_temp.question('Will you now or in the future require visa sponsorship?*','SINGLE_SELECT','[{"label":"Yes","value":"old-0"},{"label":"No","value":"old-1"}]');
  sponsor_new jsonb:=pg_temp.question('Will you now or in the future require visa sponsorship?','SINGLE_SELECT','[{"label":"Yes","value":"p-0"},{"label":"No","value":"p-1"}]');
  unseen jsonb:=pg_temp.question('Do you have a driver''s license?','SINGLE_SELECT','[{"label":"Yes","value":"d-0"},{"label":"No","value":"d-1"}]');
begin
  earlier:=pg_temp.running(who);
  perform pg_temp.answer_earlier(earlier,sponsor_old,'"old-1"');
  now_c:=pg_temp.retrying(earlier);
  -- The first read of a form returns remembered answers as this send's own answers, without changing its status.
  v_result:=pg_temp.as_worker_prefill(now_c,jsonb_build_array(sponsor_new,unseen));
  if jsonb_array_length(v_result)<>1 or v_result->0->>'value'<>'p-1' or v_result->0->>'fingerprint'<>sponsor_new->>'fingerprint' then raise exception 'CHECK_PREFILL_RESULT %',v_result; end if;
  if (select status from public.application_autopilots where id=(now_c->>'autopilot')::uuid)<>'RUNNING' then raise exception 'CHECK_PREFILL_CHANGED_STATUS'; end if;
  if exists(select 1 from public.application_autopilot_questions where autopilot_id=(now_c->>'autopilot')::uuid and fingerprint=unseen->>'fingerprint') then raise exception 'CHECK_PREFILL_RECORDED_UNSEEN'; end if;
  if (select a.answered_by from public.application_autopilot_answers a join public.application_autopilot_questions q on q.id=a.question_id
      where q.autopilot_id=(now_c->>'autopilot')::uuid)<>(who->>'user')::uuid then raise exception 'CHECK_PREFILL_NOT_CANDIDATE_ANSWER'; end if;
  insert into remembered_answer_checks values('first_read_prefills_remembered_answers_without_changing_status',true);
  -- A second read never duplicates the answer.
  v_again:=pg_temp.as_worker_prefill(now_c,jsonb_build_array(sponsor_new));
  if jsonb_array_length(v_again)<>0 or (select count(*) from public.application_autopilot_answers a join public.application_autopilot_questions q on q.id=a.question_id where q.autopilot_id=(now_c->>'autopilot')::uuid)<>1 then
    raise exception 'CHECK_PREFILL_DUPLICATED'; end if;
  insert into remembered_answer_checks values('prefill_is_idempotent',true);
end $prefill$;

do $same_send$
declare run jsonb := pg_temp.running(pg_temp.candidate()); v_result jsonb;
  old_question jsonb := pg_temp.question('Will you now or in the future require visa sponsorship?', 'SINGLE_SELECT', '[{"label":"Yes","value":"old-yes"},{"label":"No","value":"old-no"}]');
  fresh_question jsonb := pg_temp.question('Will you now or in the future require visa sponsorship?', 'SINGLE_SELECT', '[{"label":"Yes","value":"fresh-yes"},{"label":"No","value":"fresh-no"}]');
  consent jsonb := pg_temp.question('I agree to the terms', 'BOOLEAN', '[]');
  inherited jsonb := pg_temp.question('Which city will you work from?', 'TEXT', '[]');
begin
  perform pg_temp.answer_earlier(run, old_question, '"old-no"');
  perform pg_temp.answer_earlier(run, consent, 'true');
  perform pg_temp.answer_earlier(run, inherited, '"Synthetic city"', 'STANDING');
  v_result := pg_temp.as_worker_prefill(run,jsonb_build_array(fresh_question,
    pg_temp.question('I agree to the terms', 'BOOLEAN', '[]'),
    pg_temp.question('Which city will you work from?', 'TEXT', '[]')));
  if jsonb_array_length(v_result) <> 1 or v_result->0->>'value' <> 'fresh-no'
    or v_result->0->>'fingerprint' <> fresh_question->>'fingerprint' then
    raise exception 'CHECK_SAME_SEND_FRESH_FORM_RECALL %',v_result;
  end if;
  if (select status from public.application_autopilots where id=(run->>'autopilot')::uuid)<>'RUNNING'
    or exists(select 1 from public.application_attempts where application_id=(run->>'application')::uuid) then
    raise exception 'CHECK_SAME_SEND_AUTHORITY_CHANGED';
  end if;
  insert into remembered_answer_checks values('fresh_form_in_same_send_reuses_original_answer_not_consent_or_derived_copies',true);
end $same_send$;

do $punctuation$
declare who jsonb:=pg_temp.candidate(); newest jsonb; older jsonb; now_d jsonb; v_result jsonb;
  employed_old jsonb:=pg_temp.question('Have you ever worked here?','SINGLE_SELECT','[{"label":"Yes, I did.","value":"e-0"},{"label":"No, I have never worked for Carvana or ADESA.","value":"e-1"}]');
  employed_newest jsonb:=pg_temp.question('Have you ever worked here?','SINGLE_SELECT','[{"label":"Current employee","value":"f-0"},{"label":"Never","value":"f-1"}]');
  employed_now jsonb:=pg_temp.question('Have you ever worked here?','SINGLE_SELECT','[{"label":"Yes, I did","value":"g-0"},{"label":"No, I have never worked for Carvana or ADESA","value":"g-1"}]');
begin
  older:=pg_temp.running(who);
  perform pg_temp.answer_earlier(older,employed_old,'"e-1"');
  newest:=pg_temp.retrying(older);
  perform pg_temp.answer_earlier(newest,employed_newest,'"f-1"');
  now_d:=pg_temp.retrying(older);
  -- The newest answer's choice ("Never") isn't offered; the older answer matches despite the trailing period.
  v_result:=pg_temp.as_worker_prefill(now_d,jsonb_build_array(employed_now));
  if jsonb_array_length(v_result)<>1 or v_result->0->>'value'<>'g-1' then raise exception 'CHECK_PUNCTUATION_OR_FALLBACK %',v_result; end if;
  insert into remembered_answer_checks values('choices_match_despite_punctuation_and_older_answers_are_tried',true);
end $punctuation$;

do $context$
declare who jsonb := pg_temp.candidate(); earlier jsonb; another_employer jsonb; another_role jsonb; retry jsonb; after_edit jsonb; current_other jsonb; v_result jsonb;
  employment jsonb := pg_temp.question('Have you previously worked for this company?', 'BOOLEAN', '[]');
  why_role jsonb := pg_temp.question('Why do you want this role?', 'LONG_TEXT', '[]');
  inherited jsonb := pg_temp.question('What interests you about this team?', 'LONG_TEXT', '[]');
  gpa jsonb := pg_temp.question('Undergraduate GPA', 'TEXT', '[]');
  degree jsonb := pg_temp.question('What is your highest degree?', 'SINGLE_SELECT', '[{"label":"Bachelor degree","value":"b"},{"label":"Master degree","value":"m"}]');
begin
  earlier := pg_temp.running(who || '{"employer":"Example A","role_title":"Synthetic engineer"}');
  perform pg_temp.answer_earlier(earlier, employment, 'true');
  perform pg_temp.answer_earlier(earlier, why_role, '"I want the synthetic engineer role at Example A."');
  perform pg_temp.answer_earlier(earlier, inherited, '"An earlier unverified copy from a different employer."', 'REMEMBERED');
  perform pg_temp.answer_earlier(earlier, gpa, '"3.5"');
  perform pg_temp.answer_earlier(earlier, degree, '"b"');

  another_employer := pg_temp.running(who || '{"employer":"Example B","role_title":"Synthetic engineer"}');
  v_result := pg_temp.as_worker_prefill(another_employer,jsonb_build_array(employment,why_role));
  if jsonb_array_length(v_result) <> 0 then raise exception 'CHECK_EMPLOYER_CONTEXT_IGNORED %',v_result; end if;
  insert into remembered_answer_checks values('prior_employment_true_and_narrative_do_not_cross_employers',true);

  another_role := pg_temp.running(who || '{"employer":"Example A","role_title":"Synthetic architect"}');
  v_result := pg_temp.as_worker_prefill(another_role,jsonb_build_array(why_role));
  if jsonb_array_length(v_result) <> 0 then raise exception 'CHECK_ROLE_CONTEXT_IGNORED %',v_result; end if;
  insert into remembered_answer_checks values('same_employer_different_role_does_not_reuse_narrative',true);

  v_result := pg_temp.as_worker_prefill(another_employer,jsonb_build_array(gpa,degree));
  if jsonb_array_length(v_result) <> 2 then raise exception 'CHECK_ROUTINE_RECALL_LOST %',v_result; end if;
  insert into remembered_answer_checks values('explicit_context_independent_gpa_and_degree_cross_jobs',true);

  retry := pg_temp.retrying(earlier);
  v_result := pg_temp.as_worker_prefill(retry,jsonb_build_array(employment,why_role,inherited));
  if jsonb_array_length(v_result) <> 2
    or not exists(select 1 from jsonb_array_elements(v_result) r where r->>'field_id'=employment->>'fieldId' and r->'value'='true')
    or exists(select 1 from jsonb_array_elements(v_result) r where r->>'field_id'=inherited->>'fieldId') then
    raise exception 'CHECK_EXACT_CONTEXT_OR_ORIGIN_LOST %',v_result; end if;
  insert into remembered_answer_checks values('same_frozen_context_reuses_original_answers_but_not_unproven_copies',true);

  -- GPA/degree wording permits another job, never an older candidate snapshot.
  -- A profile correction changes the input epoch before the next packet freezes.
  update public.candidates set application_input_version = application_input_version + 1 where id = (who->>'candidate')::uuid;
  after_edit := pg_temp.running(who || '{"employer":"Example C","role_title":"Synthetic consultant"}');
  v_result := pg_temp.as_worker_prefill(after_edit,jsonb_build_array(gpa,degree));
  if jsonb_array_length(v_result) <> 0 then raise exception 'CHECK_STALE_EDUCATION_RECALLED %',v_result; end if;
  insert into remembered_answer_checks values('education_and_gpa_do_not_cross_candidate_input_versions',true);

  -- The candidate's corrected originals can again be reused across jobs in the
  -- same current input version; the older originals must not win the lookup.
  perform pg_temp.answer_earlier(after_edit,gpa,'"3.6"');
  perform pg_temp.answer_earlier(after_edit,degree,'"m"');
  current_other := pg_temp.running(who || '{"employer":"Example D","role_title":"Synthetic designer"}');
  v_result := pg_temp.as_worker_prefill(current_other,jsonb_build_array(gpa,degree));
  if jsonb_array_length(v_result) <> 2
    or not exists(select 1 from jsonb_array_elements(v_result) r where r->>'field_id'=gpa->>'fieldId' and r->'value'='"3.6"')
    or not exists(select 1 from jsonb_array_elements(v_result) r where r->>'field_id'=degree->>'fieldId' and r->'value'='"m"') then
    raise exception 'CHECK_CURRENT_EDUCATION_RECALL_LOST %',v_result; end if;
  insert into remembered_answer_checks values('corrected_current_input_education_and_gpa_still_cross_jobs',true);
end $context$;

do $obsolete$
declare run jsonb := pg_temp.running(pg_temp.candidate()); old_id uuid := gen_random_uuid();
  old_question jsonb := pg_temp.question('Current company', 'TEXT', '[]', false);
  kept_question jsonb := pg_temp.question('An answered factual question', 'TEXT', '[]');
begin
  insert into public.application_autopilot_questions(id,autopilot_id,fingerprint,descriptor,status)
    values(old_id,(run->>'autopilot')::uuid,old_question->>'fingerprint',old_question,'OPEN');
  perform pg_temp.answer_earlier(run,kept_question,'"An explicit candidate answer"');
  perform pg_temp.as_worker_request(run,'[]');
  if (select status from public.application_autopilot_questions where id=old_id)<>'SUPERSEDED'
    or (select status from public.application_autopilot_questions where autopilot_id=(run->>'autopilot')::uuid and fingerprint=kept_question->>'fingerprint')<>'ANSWERED'
    or not exists(select 1 from public.application_autopilots where id=(run->>'autopilot')::uuid and status='RUNNING' and lease_token=(run->>'lease')::uuid)
    or exists(select 1 from public.application_attempts where application_id=(run->>'application')::uuid) then
    raise exception 'CHECK_OBSOLETE_QUESTION_OR_AUTHORITY_CHANGED';
  end if;
  execute 'set local role service_role';
  perform public.seal_application_autopilot((run->>'autopilot')::uuid,(run->>'lease')::uuid,'{"current_readback":"complete"}',repeat('a',64),repeat('b',64),'https://job-boards.greenhouse.io/roledawncheck/jobs/1');
  execute 'reset role';
  insert into remembered_answer_checks values('completed_readback_supersedes_obsolete_questions_preserving_answers_and_lease',true);
end $obsolete$;

select check_name, passed from remembered_answer_checks order by check_name;
rollback;
