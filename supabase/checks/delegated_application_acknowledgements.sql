-- Synthetic integration checks: explicit, owned, revocable delegation; exact recorded wording.
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
declare who jsonb:=pg_temp.candidate(); stranger jsonb:=pg_temp.candidate(); run jsonb; saved uuid; other_saved uuid; result jsonb; q jsonb; bad jsonb;
  topic text:='Delegated application acknowledgements';
  authority text:='Authorize RoleDawn to accept application terms, privacy notices, processing and screening consents, certify the supplied application information, and enter my approved legal name as my signature.';
  fact uuid:=gen_random_uuid(); identity_version uuid:=gen_random_uuid(); input_epoch bigint;
begin
  run:=pg_temp.running(who);
  select application_input_version into input_epoch from public.candidates where id=(who->>'candidate')::uuid;
  perform pg_temp.as_candidate(who); saved:=public.save_candidate_standing_answer(topic,authority); execute 'reset role';
  perform pg_temp.as_candidate(stranger); other_saved:=public.save_candidate_standing_answer(topic,authority); execute 'reset role';
  if input_epoch<>(select application_input_version from public.candidates where id=(who->>'candidate')::uuid) then raise exception 'CHECK_DELEGATION_BUMPED_INPUT_EPOCH'; end if;
  q:=pg_temp.question('I agree to the privacy policy','BOOLEAN','[]')||'{"reasonCode":"SENSITIVE_REQUIRES_CANDIDATE"}';
  execute 'set local role service_role';
  result:=public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
    jsonb_build_array(jsonb_build_object('descriptor',q,'value',true,'basis',jsonb_build_array(saved))));
  if jsonb_array_length(result)<>1 or result->0->'descriptor'<>q then raise exception 'CHECK_DELEGATION_NOT_BOUND_TO_WORDING'; end if;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('descriptor',q,'value',false,'basis',jsonb_build_array(saved)),
    jsonb_build_object('descriptor',q,'value',true,'basis',jsonb_build_array(other_saved)),
    jsonb_build_object('descriptor',q,'value',true,'basis',jsonb_build_array(saved,'fact:location.city')),
    jsonb_build_object('descriptor',q||'{"label":"I certify that I am licensed"}','value',true,'basis',jsonb_build_array(saved)),
    jsonb_build_object('descriptor',q||'{"label":"Can you work on-site?"}','value',true,'basis',jsonb_build_array(saved)),
    jsonb_build_object('descriptor',q||'{"label":"Gender"}','value',true,'basis',jsonb_build_array(saved))
  )) loop
    begin
      perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,jsonb_build_array(bad));
      raise exception 'CHECK_DELEGATION_SCOPE_BYPASS';
    exception when invalid_parameter_value then null; end;
  end loop;
  execute 'reset role';
  insert into standing_answer_checks values('explicit_delegation_owned_wording_bound_not_factual_inference',true);
  -- The signature takes only the identity fact explicitly disclosed for this sealed revision.
  set local session_replication_role=replica;
  insert into public.candidate_facts(id,workspace_id,candidate_id,fact_key,sensitivity,usage_policy,verification_status)
    values(fact,(who->>'workspace')::uuid,(who->>'candidate')::uuid,'identity.legal_name','STANDARD','EXACT_FIELDS','VERIFIED');
  insert into public.candidate_fact_versions(id,workspace_id,candidate_id,fact_id,version_number,value_json,candidate_disposition,created_by,reviewed_at,review_kind,reviewed_by)
    values(identity_version,(who->>'workspace')::uuid,(who->>'candidate')::uuid,fact,1,'"Synthetic Candidate"','APPROVED',(who->>'user')::uuid,now(),'CANDIDATE_ENTRY',(who->>'user')::uuid);
  update public.application_autopilots set disclosure_manifest=jsonb_build_object('allowed_fact_versions',jsonb_build_array(jsonb_build_object('fact_version_id',identity_version,'fact_key','identity.legal_name'))) where id=(run->>'autopilot')::uuid;
  set local session_replication_role=origin;
  q:=pg_temp.question('Electronic signature','TEXT','[]');
  execute 'set local role service_role';
  result:=public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
    jsonb_build_array(jsonb_build_object('descriptor',q,'value','Synthetic Candidate','basis',jsonb_build_array(saved))));
  if result->0->>'value'<>'Synthetic Candidate' then raise exception 'CHECK_SIGNATURE_NOT_APPROVED_IDENTITY'; end if;
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',q,'value','Different Person','basis',jsonb_build_array(saved))));
    raise exception 'CHECK_SIGNATURE_IDENTITY_BYPASS';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  insert into standing_answer_checks values('signature_uses_exact_disclosed_identity',true);
  perform pg_temp.as_candidate(who); perform public.delete_candidate_standing_answer(saved); execute 'reset role';
  execute 'set local role service_role';
  begin
    perform public.record_application_autopilot_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid,
      jsonb_build_array(jsonb_build_object('descriptor',q,'value','Synthetic Candidate','basis',jsonb_build_array(saved))));
    raise exception 'CHECK_REVOKED_DELEGATION_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  insert into standing_answer_checks values('revoked_delegation_cannot_authorize_new_answers',true);
end $check$;
select * from standing_answer_checks order by check_name;
rollback;
