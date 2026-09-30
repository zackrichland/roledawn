-- Local-only synthetic checks for profile/story/voice freshness (D-121).
-- node scripts/migration-harness.mjs supabase/checks/candidate_profile_input_invalidation.sql
begin;
create temporary table profile_invalidation_checks(check_name text primary key, passed boolean not null) on commit drop;

create function pg_temp.candidate() returns jsonb
language plpgsql as $$
declare v_user uuid:=gen_random_uuid(); v_workspace uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_user,'profile-invalidation-check-'||v_user||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(v_workspace,'Profile invalidation check','PERSONAL','ACTIVE',v_user);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(v_workspace,v_user,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(v_candidate,v_workspace,v_user,'Profile invalidation check','ACTIVE');
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
      'RUNNING',v_lease,'profile-invalidation-check',now()+interval '5 minutes');
  insert into private.application_autopilot_runtime(autopilot_id) values(v_autopilot);
  set local session_replication_role=origin;
  update public.applications set current_revision_id=v_revision where id=v_application;
  return p_who||jsonb_build_object('autopilot',v_autopilot,'lease',v_lease,'application',v_application);
end $$;

create function pg_temp.as_candidate(p_who jsonb) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_who->>'user', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_who->>'user', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.enable_auto_apply(p_who jsonb) returns void
language plpgsql as $$
begin
  insert into public.candidate_auto_apply_settings(candidate_id, workspace_id, enabled, status, consent_actor,
    consented_at, candidate_input_version, search_profile_version)
  select id, workspace_id, true, 'ACTIVE', auth_user_id, now(), application_input_version, 1
  from public.candidates where id = (p_who->>'candidate')::uuid
  on conflict(candidate_id) do update set enabled = true, status = 'ACTIVE',
    candidate_input_version = excluded.candidate_input_version;
  insert into private.auto_apply_runtime(candidate_id, lease_token, lease_expires_at, lease_owner)
  values((p_who->>'candidate')::uuid, gen_random_uuid(), now() + interval '5 minutes', 'synthetic')
  on conflict(candidate_id) do update set lease_token = excluded.lease_token,
    lease_expires_at = excluded.lease_expires_at, lease_owner = excluded.lease_owner;
end $$;

create function pg_temp.assert_invalidated(p_run jsonb, p_before bigint, p_check text) returns void
language plpgsql as $$
begin
  if (select application_input_version from public.candidates where id = (p_run->>'candidate')::uuid) <> p_before + 1 then
    raise exception 'CHECK_INPUT_VERSION_NOT_BUMPED %', p_check; end if;
  if not exists(select 1 from public.candidate_auto_apply_settings where candidate_id = (p_run->>'candidate')::uuid
    and not enabled and status = 'PAUSED_PROFILE_CHANGED') then
    raise exception 'CHECK_AUTO_APPLY_NOT_PAUSED %', p_check; end if;
  if exists(select 1 from private.auto_apply_runtime where candidate_id = (p_run->>'candidate')::uuid and lease_token is not null) then
    raise exception 'CHECK_AUTO_APPLY_LEASE_NOT_CLEARED %', p_check; end if;
  execute 'set local role service_role';
  begin
    perform public.read_candidate_standing_answers((p_run->>'autopilot')::uuid,(p_run->>'lease')::uuid);
    raise exception 'CHECK_OLD_AUTOPILOT_ACCEPTED %', p_check;
  exception when others then
    if sqlerrm <> 'APPLICATION_AUTOPILOT_AUTHORITY_STALE' then raise; end if;
  end;
  execute 'reset role';
  insert into profile_invalidation_checks values(p_check, true);
end $$;

create function pg_temp.reviewed_resume(p_who jsonb) returns jsonb
language plpgsql as $$
declare v_document uuid := gen_random_uuid(); v_version uuid := gen_random_uuid(); v_extraction uuid := gen_random_uuid(); v_review uuid := gen_random_uuid();
  v_workspace uuid := (p_who->>'workspace')::uuid; v_candidate uuid := (p_who->>'candidate')::uuid; v_user uuid := (p_who->>'user')::uuid;
  v_text text := 'Synthetic reviewed resume';
begin
  insert into public.source_documents(id,workspace_id,candidate_id,document_kind,display_name,status,current_version_number)
    values(v_document,v_workspace,v_candidate,'RESUME','synthetic.pdf','READY',1);
  insert into public.source_document_versions(id,workspace_id,candidate_id,document_id,version_number,storage_bucket,storage_object_path,mime_type,byte_size,sha256,scan_status,parser_release,created_by)
    values(v_version,v_workspace,v_candidate,v_document,1,'career-vault',v_workspace::text||'/'||v_candidate::text||'/synthetic.pdf','application/pdf',10,repeat('d',64),'CLEAN','check/1',v_user);
  insert into public.source_document_extractions(id,workspace_id,candidate_id,document_id,document_version_id,attempt_number,status,extractor_kind,extractor_release,output_schema_version,source_sha256,extracted_text,text_sha256,page_count,resulting_document_status,document_aggregate_version,started_at)
    values(v_extraction,v_workspace,v_candidate,v_document,v_version,1,'SUCCEEDED','LOCAL_DETERMINISTIC','check/1','check/1',repeat('d',64),v_text,encode(sha256(convert_to(v_text,'UTF8')),'hex'),1,'READY',1,now());
  insert into public.source_document_text_reviews(id,workspace_id,candidate_id,document_id,document_version_id,extraction_id,document_aggregate_version,review_version_number,reviewed_text,text_sha256,created_by)
    values(v_review,v_workspace,v_candidate,v_document,v_version,v_extraction,1,1,v_text,encode(sha256(convert_to(v_text,'UTF8')),'hex'),v_user);
  return jsonb_build_object('document',v_document,'version',v_version,'review',v_review);
end $$;

-- Reproduce preparation's actual order: claim the input epoch, publish a first
-- career extraction inline, then commit with the original claim. An epoch bump
-- here used to pause auto-apply and cancel its own application before commit.
do $check$
declare who jsonb := pg_temp.candidate(); resume jsonb; claim record; extraction record; committed record; run jsonb;
  v_job uuid := gen_random_uuid(); v_version uuid := gen_random_uuid(); v_application uuid := gen_random_uuid(); v_run uuid := gen_random_uuid(); v_before bigint;
begin
  resume := pg_temp.reviewed_resume(who);
  insert into public.jobs(id,canonical_url,state) values(v_job,'https://job-boards.greenhouse.io/roledawncheck/jobs/'||abs(hashtext(v_job::text)),'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v_version,v_job,1,repeat('f',64),'Synthetic role','Synthetic employer','Synthetic only.','https://job-boards.greenhouse.io/roledawncheck/jobs/1',now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status)
    values(v_application,(who->>'workspace')::uuid,(who->>'candidate')::uuid,v_job,v_version,'DRAFTING');
  insert into public.application_runs(id,workspace_id,application_id,run_kind,status)
    values(v_run,(who->>'workspace')::uuid,v_application,'PREPARATION','QUEUED');
  perform pg_temp.enable_auto_apply(who);
  insert into public.auto_apply_enrollments(application_id,workspace_id,candidate_id,job_id,job_version_id,consent_version,candidate_input_version,search_profile_version,profile_hash,matching_policy,matching_decision)
    select v_application,workspace_id,id,v_job,v_version,1,application_input_version,1,repeat('a',64),'check/1','{}'
    from public.candidates where id=(who->>'candidate')::uuid;
  set local role service_role;
  select * into strict claim from public.claim_application_preparation(v_application,v_run,'inline-extraction-check',120);
  select * into strict extraction from public.record_candidate_career_profile_extraction((who->>'workspace')::uuid,(who->>'candidate')::uuid,
    (resume->>'review')::uuid,'{"schemaVersion":1,"positions":[]}',repeat('e',64),'check/1',gen_random_uuid());
  if not extraction.recorded then raise exception 'CHECK_FIRST_EXTRACTION_NOT_RECORDED'; end if;
  if (select application_input_version from public.candidates where id=(who->>'candidate')::uuid) <> claim.candidate_input_version then
    raise exception 'CHECK_FIRST_EXTRACTION_INVALIDATED_OWN_CLAIM'; end if;
  if not exists(select 1 from public.candidate_auto_apply_settings where candidate_id=(who->>'candidate')::uuid and enabled and status='ACTIVE') then
    raise exception 'CHECK_FIRST_EXTRACTION_PAUSED_AUTO_APPLY'; end if;
  if not exists(select 1 from public.application_runs where id=v_run and status='RUNNING' and lease_owner='inline-extraction-check') then
    raise exception 'CHECK_FIRST_EXTRACTION_CANCELED_PREPARATION'; end if;
  select * into strict committed from public.commit_application_input_snapshot(v_application,v_run,'inline-extraction-check',claim.aggregate_version,claim.candidate_input_version,
    (resume->>'document')::uuid,(resume->>'version')::uuid,(resume->>'review')::uuid,'READY_FOR_DRAFTING','[]',
    jsonb_build_object('profileContext',jsonb_build_object('careerProfileVersionId',extraction.profile_version_id)),repeat('b',64),'check/1','check/1');
  if committed.readiness <> 'READY_FOR_DRAFTING' or committed.replayed then raise exception 'CHECK_INLINE_EXTRACTION_COMMIT_FAILED'; end if;
  reset role;
  insert into profile_invalidation_checks values('first_inline_extraction_keeps_auto_apply_and_commits_original_claim',true);

  -- A subsequent extraction is a published content change, even if it uses the
  -- same source review. It must not inherit the first-publication exemption.
  run := pg_temp.running(who);
  select application_input_version into v_before from public.candidates where id=(who->>'candidate')::uuid;
  set local role service_role;
  perform public.record_candidate_career_profile_extraction((who->>'workspace')::uuid,(who->>'candidate')::uuid,
    (resume->>'review')::uuid,'{"schemaVersion":1,"positions":[],"summary":"Re-extracted"}',repeat('f',64),'check/1',gen_random_uuid());
  reset role;
  perform pg_temp.assert_invalidated(run,v_before,'later_extraction_invalidates_existing_packet');
end $check$;

-- Candidate-authored first publications change approved inputs even before any
-- packet exists; only the first derived career extraction gets the exemption.
do $check$
declare who jsonb; v_kind text; v_before bigint;
begin
  foreach v_kind in array array['CAREER_PROFILE','VOICE_PROFILE'] loop
    who := pg_temp.candidate();
    perform pg_temp.enable_auto_apply(who);
    select application_input_version into v_before from public.candidates where id=(who->>'candidate')::uuid;
    perform pg_temp.as_candidate(who);
    perform public.save_candidate_profile_document(gen_random_uuid(),v_kind,'{"schemaVersion":1}',repeat('a',64));
    reset role;
    if (select application_input_version from public.candidates where id=(who->>'candidate')::uuid) <> v_before + 1
      or not exists(select 1 from public.candidate_auto_apply_settings where candidate_id=(who->>'candidate')::uuid and not enabled and status='PAUSED_PROFILE_CHANGED') then
      raise exception 'CHECK_FIRST_CANDIDATE_PROFILE_PUBLICATION_NOT_INVALIDATED %', v_kind; end if;
    insert into profile_invalidation_checks values(lower(v_kind)||'_first_candidate_save_invalidates_without_a_packet',true);
  end loop;
end $check$;

do $check$
declare who jsonb := pg_temp.candidate(); resume jsonb; run jsonb; v_before bigint;
begin
  resume := pg_temp.reviewed_resume(who);
  run := pg_temp.running(who);
  perform pg_temp.enable_auto_apply(who);
  select application_input_version into v_before from public.candidates where id=(who->>'candidate')::uuid;
  set local role service_role;
  perform public.record_candidate_career_profile_extraction((who->>'workspace')::uuid,(who->>'candidate')::uuid,
    (resume->>'review')::uuid,'{"schemaVersion":1,"positions":[]}',repeat('e',64),'check/1',gen_random_uuid());
  reset role;
  perform pg_temp.assert_invalidated(run,v_before,'first_extraction_invalidates_when_a_current_snapshot_already_exists');
end $check$;

do $check$
declare who jsonb := pg_temp.candidate(); stranger jsonb := pg_temp.candidate(); run jsonb; v_before bigint;
  v_kind text; v_story record; v_story_id uuid;
begin
  foreach v_kind in array array['CAREER_PROFILE','VOICE_PROFILE'] loop
    run := pg_temp.running(who);
    perform pg_temp.enable_auto_apply(who);
    select application_input_version into v_before from public.candidates where id = (who->>'candidate')::uuid;
    perform pg_temp.as_candidate(who);
    perform public.save_candidate_profile_document(gen_random_uuid(),v_kind,'{"schemaVersion":1}',repeat('a',64));
    execute 'reset role';
    perform pg_temp.assert_invalidated(run,v_before,lower(v_kind)||'_publish_invalidates_packet_and_pauses_auto_apply');
  end loop;

  -- A new version, not just first creation, invalidates the frozen packet.
  run := pg_temp.running(who);
  perform pg_temp.enable_auto_apply(who);
  select application_input_version into v_before from public.candidates where id = (who->>'candidate')::uuid;
  perform pg_temp.as_candidate(who);
  perform public.save_candidate_profile_document(gen_random_uuid(),'CAREER_PROFILE','{"schemaVersion":1,"summary":"Synthetic edit"}',repeat('b',64),2);
  execute 'reset role';
  perform pg_temp.assert_invalidated(run,v_before,'career_profile_edit_invalidates_packet');

  -- Extraction request/failure metadata does not invalidate content before the
  -- extraction publishes its complete version. No-op head writes also stay put.
  run := pg_temp.running(who);
  perform pg_temp.enable_auto_apply(who);
  select application_input_version into v_before from public.candidates where id = (who->>'candidate')::uuid;
  update public.candidate_profile_documents set extraction_status = 'REQUESTED', extraction_requested_at = now(),
    current_version_id = current_version_id where candidate_id = (who->>'candidate')::uuid and kind = 'CAREER_PROFILE';
  update public.candidate_profile_documents set extraction_status = 'FAILED', extraction_error = 'SYNTHETIC_FAILURE'
    where candidate_id = (who->>'candidate')::uuid and kind = 'CAREER_PROFILE';
  if (select application_input_version from public.candidates where id = (who->>'candidate')::uuid) <> v_before then
    raise exception 'CHECK_EXTRACTION_METADATA_INVALIDATED_INPUT'; end if;
  execute 'set local role service_role';
  perform public.read_candidate_standing_answers((run->>'autopilot')::uuid,(run->>'lease')::uuid);
  execute 'reset role';
  insert into profile_invalidation_checks values('extraction_metadata_and_noop_updates_preserve_active_inputs',true);

  -- First story, edited story, and archive all change the writing input set.
  perform pg_temp.as_candidate(who);
  select * into v_story from public.save_candidate_story(gen_random_uuid(),null,null,
    '{"title":"Synthetic workflow","situation":"Synthetic situation","task":"Synthetic task","action":"Synthetic action","result":"Synthetic result","storyText":"Synthetic story"}',
    'APPROVED','RESUME_AND_COVER_LETTER');
  execute 'reset role';
  v_story_id := v_story.story_id;
  perform pg_temp.assert_invalidated(run,v_before,'new_story_invalidates_packet_and_pauses_auto_apply');

  run := pg_temp.running(who);
  perform pg_temp.enable_auto_apply(who);
  select application_input_version into v_before from public.candidates where id = (who->>'candidate')::uuid;
  perform pg_temp.as_candidate(who);
  perform public.save_candidate_story(gen_random_uuid(),v_story_id,1,
    '{"title":"Synthetic workflow","situation":"Synthetic situation","task":"Synthetic task","action":"Synthetic action","result":"Revised synthetic result","storyText":"Revised synthetic story"}',
    'APPROVED','RESUME_AND_COVER_LETTER');
  execute 'reset role';
  perform pg_temp.assert_invalidated(run,v_before,'story_edit_invalidates_packet_and_pauses_auto_apply');

  run := pg_temp.running(who);
  perform pg_temp.enable_auto_apply(who);
  select application_input_version into v_before from public.candidates where id = (who->>'candidate')::uuid;
  perform pg_temp.as_candidate(who);
  perform public.archive_candidate_story(gen_random_uuid(),v_story_id,2);
  execute 'reset role';
  perform pg_temp.assert_invalidated(run,v_before,'story_archive_invalidates_packet_and_pauses_auto_apply');
  if (select application_input_version from public.candidates where id = (stranger->>'candidate')::uuid) <> 1 then
    raise exception 'CHECK_OTHER_CANDIDATE_INVALIDATED'; end if;
  insert into profile_invalidation_checks values('other_candidate_inputs_are_unchanged',true);
end $check$;

select check_name,passed from profile_invalidation_checks order by check_name;
rollback;
