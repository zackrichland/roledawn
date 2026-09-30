-- Local PGlite check for 20260928100000_candidate_story_bank_and_profile.sql.
-- Run: node scripts/migration-harness.mjs supabase/checks/candidate_story_bank_and_profile.sql
insert into auth.users(id, email) values
  ('11111111-1111-4111-8111-111111111111', 'candidate-one@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'candidate-two@example.test');

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end $$;

set role authenticated;
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select * from public.bootstrap_personal_workspace('Candidate One');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select * from public.bootstrap_personal_workspace('Candidate Two');

-- 1. Reusable answers: explicit decline is stored as a protected, verified answer.
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select * from public.save_candidate_answer_fact('a0000000-0000-4000-8000-000000000001', 'self_id.gender', '"Decline to self-identify"', 'Decline to self-identify');
select * from public.save_candidate_answer_fact('a0000000-0000-4000-8000-000000000001', 'self_id.gender', '"Decline to self-identify"', 'Decline to self-identify');
select * from public.save_candidate_answer_fact('a0000000-0000-4000-8000-000000000002', 'compensation.expected_salary', '"$150,000–$170,000 base"', '$150,000–$170,000 base');
select * from public.save_candidate_answer_fact('a0000000-0000-4000-8000-000000000003', 'preferences.willing_to_relocate', '"Open to discussing"', 'Open to discussing');
do $$ begin
  begin
    perform public.save_candidate_answer_fact('a0000000-0000-4000-8000-000000000004', 'self_id.shoe_size', '"10"', '10');
    raise exception 'EXPECTED_KEY_REJECTION';
  exception when others then
    if sqlerrm <> 'CANDIDATE_FACT_KEY_NOT_ALLOWED' then raise; end if;
  end;
  begin
    perform public.save_candidate_answer_fact('a0000000-0000-4000-8000-000000000005', 'preferences.willing_to_relocate', '"Maybe"', 'Maybe');
    raise exception 'EXPECTED_VALUE_REJECTION';
  exception when others then
    if sqlerrm <> 'CANDIDATE_FACT_VALUE_INVALID' then raise; end if;
  end;
end $$;
reset role;
do $$ declare v record; begin
  select fact.sensitivity, fact.verification_status, fact.usage_policy, version.normalized_text into strict v
  from public.candidate_facts fact join public.candidate_fact_versions version on version.fact_id = fact.id
  where fact.fact_key = 'self_id.gender';
  assert v.sensitivity = 'PROTECTED' and v.verification_status = 'VERIFIED' and v.usage_policy = 'EXACT_FIELDS', 'self-id fact shape';
  assert v.normalized_text = 'Decline to self-identify', 'explicit decline stored';
  assert (select count(*) from public.candidate_fact_versions version join public.candidate_facts fact on fact.id = version.fact_id where fact.fact_key = 'self_id.gender') = 1, 'replay did not append';
  assert (select sensitivity from public.candidate_facts where fact_key = 'compensation.expected_salary') = 'SENSITIVE', 'salary sensitivity';
end $$;

-- Disclosure predicate now admits candidate-approved self-identification and salary answers.
do $$ begin
  assert (select count(*) from pg_proc where prokind = 'f' and pg_get_functiondef(oid) like '%fact.fact_key like ''self_id.%''%') >= 1, 'disclosure patched';
  assert pg_get_functiondef('public.hosted_worker_due_lanes()'::regprocedure) like '%candidate.career_profile_requested%', 'lane wakes for extraction';
end $$;

-- 2. Profile documents: create, version with optimistic concurrency, reject stale.
set role authenticated;
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select * from public.save_candidate_profile_document('b0000000-0000-4000-8000-000000000001', 'VOICE_PROFILE',
  '{"schemaVersion":1,"toneNotes":"Direct. Short sentences.","avoidPhrases":["synergy"]}', repeat('a', 64));
select * from public.save_candidate_profile_document('b0000000-0000-4000-8000-000000000002', 'VOICE_PROFILE',
  '{"schemaVersion":1,"toneNotes":"Direct.","avoidPhrases":[]}', repeat('b', 64), 2);
do $$ begin
  begin
    perform public.save_candidate_profile_document('b0000000-0000-4000-8000-000000000003', 'VOICE_PROFILE',
      '{"schemaVersion":1}', repeat('c', 64), 2);
    raise exception 'EXPECTED_STALE_REJECTION';
  exception when others then
    if sqlerrm <> 'CANDIDATE_PROFILE_DOCUMENT_VERSION_MISMATCH' then raise; end if;
  end;
  begin
    perform public.request_candidate_career_profile('b0000000-0000-4000-8000-000000000004');
    raise exception 'EXPECTED_RESUME_REQUIRED';
  exception when others then
    if sqlerrm <> 'RESUME_REVIEW_REQUIRED' then raise; end if;
  end;
end $$;

-- 3. Stories: propose, approve (new version), reject stale, archive.
select * from public.start_candidate_interview('c0000000-0000-4000-8000-000000000001', 'roledawn-interviewer/1',
  'Let''s start with your most recent role.', '{"focus":"p-1"}');
do $$ declare v_session uuid; v_story record; v_turns record; begin
  select id into strict v_session from public.candidate_interview_sessions where status = 'ACTIVE';
  select * into strict v_turns from public.append_candidate_interview_exchange('c0000000-0000-4000-8000-000000000002',
    v_session, 1, 'I rebuilt the synthetic intake workflow and reduced scheduling from 10 steps to 8.', 'What was the number before and after?', '{"focus":"p-1"}');
  assert v_turns.turn_count = 3 and v_turns.status = 'ACTIVE', 'exchange appended';
  select * into strict v_story from public.save_candidate_story('c0000000-0000-4000-8000-000000000003', null, null,
    jsonb_build_object('title','Rebuilt scheduling intake','positionKey','p-1','organization','Example Logistics',
      'roleTitle','Operations Lead','situation','Scheduling lived in group texts.',
      'task','Own the staffing workflow.','action','Mapped the workflow and shipped an app.',
      'result','Reduced the synthetic scheduling workflow from 10 steps to 8.','metrics', jsonb_build_array(jsonb_build_object('value','2','label','steps removed','confidence','ESTIMATED')),
      'themes', jsonb_build_array('process design','zero-to-one'), 'storyText','Rebuilt scheduling intake: ...'),
    'PROPOSED', 'RESUME_AND_COVER_LETTER', 'INTERVIEW', v_session);
  assert v_story.version_number = 1 and not v_story.replayed, 'story proposed';
  perform public.save_candidate_story('c0000000-0000-4000-8000-000000000004', v_story.story_id, 1,
    jsonb_build_object('title','Rebuilt scheduling intake','positionKey','p-1','situation','Scheduling lived in group texts.',
      'task','Own the staffing workflow.','action','Mapped the workflow and shipped an app.',
      'result','Reduced the synthetic scheduling workflow from 10 steps to 8.','storyText','Rebuilt scheduling intake: approved.'),
    'APPROVED', 'RESUME_AND_COVER_LETTER', 'INTERVIEW', v_session);
  begin
    perform public.save_candidate_story('c0000000-0000-4000-8000-000000000005', v_story.story_id, 1,
      jsonb_build_object('title','x','situation','x','task','x','action','x','result','x','storyText','x'),
      'APPROVED', 'RESUME_AND_COVER_LETTER');
    raise exception 'EXPECTED_STORY_STALE';
  exception when others then
    if sqlerrm <> 'CANDIDATE_STORY_VERSION_MISMATCH' then raise; end if;
  end;
  begin
    perform public.save_candidate_story('c0000000-0000-4000-8000-000000000006', null, null,
      jsonb_build_object('title','x','situation','x','task','x','action','x','result','x','storyText','x'),
      'REJECTED', 'RESUME_AND_COVER_LETTER');
    raise exception 'EXPECTED_REJECTED_POLICY';
  exception when others then
    if sqlerrm <> 'CANDIDATE_STORY_INPUT_INVALID' then raise; end if;
  end;
  perform public.archive_candidate_story('c0000000-0000-4000-8000-000000000007', v_story.story_id, 2);
  perform public.append_candidate_interview_exchange('c0000000-0000-4000-8000-000000000008',
    v_session, 3, 'That is all for now.', 'Thanks. Your stories are saved.', '{}', true);
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.candidate_story_versions) = 2, 'two story versions';
  assert (select status from public.candidate_stories) = 'ARCHIVED', 'story archived';
  assert (select candidate_disposition from public.candidate_story_versions where version_number = 2) = 'APPROVED', 'approved version';
  assert (select reviewed_at is not null from public.candidate_story_versions where version_number = 2), 'approval timestamp';
  assert (select status from public.candidate_interview_sessions) = 'COMPLETED', 'interview completed';
  assert (select count(*) from public.candidate_interview_turns) = 5, 'five turns';
end $$;

-- Immutability of versions and turns.
do $$ begin
  begin
    update public.candidate_story_versions set title = 'changed';
    raise exception 'EXPECTED_IMMUTABLE';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

-- 4. Tenant isolation: candidate two sees none of candidate one's rows.
set role authenticated;
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
do $$ begin
  assert (select count(*) from public.candidate_stories) = 0, 'stories isolated';
  assert (select count(*) from public.candidate_story_versions) = 0, 'story versions isolated';
  assert (select count(*) from public.candidate_profile_document_versions) = 0, 'profile versions isolated';
  assert (select count(*) from public.candidate_interview_turns) = 0, 'turns isolated';
  begin
    insert into public.candidate_stories (workspace_id, candidate_id) select workspace_id, id from public.candidates limit 1;
    raise exception 'EXPECTED_DIRECT_WRITE_DENIED';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
do $$ begin
  assert (select count(*) from public.candidate_story_versions) = 2, 'owner reads own story versions';
end $$;
reset role;

-- 5. Résumé attestation: seed one reviewed résumé with two passages, approve once.
do $$ declare
  v_ws uuid; v_candidate uuid; v_doc uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid();
  v_ext uuid := gen_random_uuid(); v_review uuid := gen_random_uuid();
  v_text text := E'Jane Doe\nEXPERIENCE\nAcme | Analyst | 2020-2023\n• Built the weekly revenue model.';
begin
  select workspace_id, id into strict v_ws, v_candidate from public.candidates where display_name = 'Candidate One';
  insert into public.source_documents (id, workspace_id, candidate_id, document_kind, display_name, status, current_version_number)
    values (v_doc, v_ws, v_candidate, 'RESUME', 'resume.pdf', 'READY', 1);
  insert into public.source_document_versions (id, workspace_id, candidate_id, document_id, version_number, storage_bucket, storage_object_path, mime_type, byte_size, sha256, scan_status, parser_release, created_by)
    values (v_ver, v_ws, v_candidate, v_doc, 1, 'career-vault', v_ws::text || '/' || v_candidate::text || '/r.pdf', 'application/pdf', 10, repeat('d', 64), 'CLEAN', 'test', '11111111-1111-4111-8111-111111111111');
  insert into public.source_document_extractions (id, workspace_id, candidate_id, document_id, document_version_id, attempt_number, status, extractor_kind, extractor_release, output_schema_version, source_sha256, extracted_text, text_sha256, page_count, resulting_document_status, document_aggregate_version, started_at)
    values (v_ext, v_ws, v_candidate, v_doc, v_ver, 1, 'SUCCEEDED', 'LOCAL_DETERMINISTIC', 'test', 'test', repeat('d', 64), v_text, encode(sha256(convert_to(v_text,'UTF8')),'hex'), 1, 'READY', 1, now());
  insert into public.source_document_text_reviews (id, workspace_id, candidate_id, document_id, document_version_id, extraction_id, document_aggregate_version, review_version_number, reviewed_text, text_sha256, created_by)
    values (v_review, v_ws, v_candidate, v_doc, v_ver, v_ext, 1, 1, v_text, encode(sha256(convert_to(v_text,'UTF8')),'hex'), '11111111-1111-4111-8111-111111111111');
  perform set_config('check.review_id', v_review::text, false);
  perform set_config('check.review_text', v_text, false);
end $$;
set role authenticated;
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
do $$ declare
  v_review uuid := current_setting('check.review_id')::uuid;
  v_text text := current_setting('check.review_text');
  v_passages jsonb := '[]'::jsonb; v_ord integer := 0; v_line text; v_start integer; v_sha text;
  v_result record;
begin
  foreach v_line in array array['Acme | Analyst | 2020-2023', '• Built the weekly revenue model.'] loop
    v_start := strpos(v_text, v_line) - 1;
    v_sha := encode(sha256(convert_to(v_line,'UTF8')),'hex');
    v_passages := v_passages || jsonb_build_array(jsonb_build_object('ordinal', v_ord, 'category', 'EXPERIENCE',
      'start_offset', v_start, 'end_offset', v_start + char_length(v_line), 'excerpt', v_line, 'excerpt_sha256', v_sha,
      'stable_key', encode(sha256(convert_to(v_review::text || E'\n' || v_start::text || E'\n' || (v_start + char_length(v_line))::text || E'\n' || v_sha,'UTF8')),'hex')));
    v_ord := v_ord + 1;
  end loop;
  perform public.ingest_resume_evidence_proposals('d0000000-0000-4000-8000-000000000001', v_review, 'resume-passages/2', v_passages);
  select * into strict v_result from public.approve_reviewed_resume_evidence('d0000000-0000-4000-8000-000000000002', v_review);
  assert v_result.approved_count = 2 and v_result.carried_count = 0 and not v_result.replayed, 'two passages approved';
  select * into strict v_result from public.approve_reviewed_resume_evidence('d0000000-0000-4000-8000-000000000002', v_review);
  assert v_result.replayed, 'approval replay';
  assert (select count(*) from public.candidate_evidence_items where review_status = 'VERIFIED') = 2, 'items verified';
  assert (select count(*) from public.candidate_evidence_versions where candidate_disposition = 'APPROVED' and review_kind = 'EXACT_PASSAGE') = 2, 'exact approvals';
  perform public.request_candidate_career_profile('d0000000-0000-4000-8000-000000000003');
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.outbox where topic = 'candidate.career_profile_requested') = 1, 'extraction queued';
  assert (select extraction_status from public.candidate_profile_documents where kind = 'CAREER_PROFILE') = 'REQUESTED', 'extraction requested';
end $$;

-- 6. Worker result is recorded only for the latest review and by the service role.
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
do $$ declare v_ws uuid; v_candidate uuid; v_result record; begin
  select workspace_id, id into strict v_ws, v_candidate from public.candidates where display_name = 'Candidate One';
  select * into strict v_result from public.record_candidate_career_profile_extraction(v_ws, v_candidate,
    gen_random_uuid(), '{"schemaVersion":1,"positions":[]}', repeat('e', 64), 'career-profile-extractor/1', gen_random_uuid());
  assert not v_result.recorded, 'stale review ignored';
  select * into strict v_result from public.record_candidate_career_profile_extraction(v_ws, v_candidate,
    current_setting('check.review_id')::uuid, '{"schemaVersion":1,"positions":[]}', repeat('e', 64), 'career-profile-extractor/1', gen_random_uuid());
  assert v_result.recorded, 'current review recorded';
  assert (select extraction_status from public.candidate_profile_documents where kind = 'CAREER_PROFILE') = 'IDLE', 'extraction settled';
end $$;
reset role;
select 'candidate story bank and profile checks passed' as result;
