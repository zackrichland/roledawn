-- Standing answers, first live fixes (D-117).
--
-- 1. A sensitive question (reasonCode SENSITIVE_REQUIRES_CANDIDATE, such as
--    "Will you require sponsorship?") may be answered when every basis is one of
--    the candidate's own standing answers or a work-authorization fact. The
--    worker already applied this rule; the database refused every sensitive
--    question, and because answers are recorded in one call, that refusal
--    dropped the other answers too (Flexport, 2026-09-30).
-- 2. A question this send already asked and that is still open is answered
--    when a standing answer now covers it, instead of being skipped.
-- 3. Saving a standing answer puts the candidate's sends that wait on
--    questions back in the queue, so the new answer is tried on each of them.

create or replace function public.record_application_autopilot_standing_answers(p_id uuid, p_lease_token uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.application_autopilots%rowtype; v_item jsonb; v_descriptor jsonb; v_existing public.application_autopilot_questions%rowtype;
  v_question uuid; v_answer uuid; v_result jsonb := '[]'::jsonb; v_command uuid := extensions.gen_random_uuid();
begin
  v_row := private.assert_autopilot_lease(p_id, p_lease_token, true);
  if v_row.sealed_diff_hash is not null or jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 24 then
    raise exception 'APPLICATION_AUTOPILOT_STANDING_ANSWERS_INVALID' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_answers) loop
    v_descriptor := v_item->'descriptor';
    if jsonb_typeof(v_item) is distinct from 'object' or not coalesce(private.autopilot_descriptor_valid(v_descriptor), false)
      or not coalesce(private.autopilot_value_valid(v_descriptor, v_item->'value'), false)
      or jsonb_typeof(v_item->'basis') is distinct from 'array' or jsonb_array_length(v_item->'basis') not between 1 and 6
      or exists (select 1 from jsonb_array_elements(v_item->'basis') b
        where jsonb_typeof(b) is distinct from 'string' or not (
          (b#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and exists (select 1 from public.candidate_standing_answers s where s.id = (b#>>'{}')::uuid and s.candidate_id = v_row.candidate_id))
          or (b#>>'{}' ~ '^fact:[a-z_]+(\.[a-z_]+){1,3}$'
            and (v_descriptor->>'reasonCode' is distinct from 'SENSITIVE_REQUIRES_CANDIDATE' or b#>>'{}' like 'fact:work\_authorization.%')))) then
      raise exception 'APPLICATION_AUTOPILOT_STANDING_ANSWERS_INVALID' using errcode = '22023'; end if;
    select * into v_existing from public.application_autopilot_questions
      where autopilot_id = p_id and fingerprint = v_descriptor->>'fingerprint' for update;
    if found then
      -- Only a still-open question with the same descriptor takes this answer.
      if v_existing.status <> 'OPEN' or v_existing.descriptor <> v_descriptor then continue; end if;
      v_question := v_existing.id;
      update public.application_autopilot_questions set status = 'ANSWERED' where id = v_question;
    else
      if (select count(*) from public.application_autopilot_questions where autopilot_id = p_id) >= 96 then exit; end if;
      insert into public.application_autopilot_questions(autopilot_id, fingerprint, descriptor, status)
        values (p_id, v_descriptor->>'fingerprint', v_descriptor, 'ANSWERED') returning id into v_question;
    end if;
    insert into public.application_autopilot_answers(question_id, value_json, answered_by, command_id, source, basis)
      values (v_question, v_item->'value', v_row.delegated_by, v_command, 'STANDING', v_item->'basis') returning id into v_answer;
    v_result := v_result || jsonb_build_array(jsonb_build_object('answer_id', v_answer, 'field_id', v_descriptor->>'fieldId',
      'fingerprint', v_descriptor->>'fingerprint', 'value', v_item->'value', 'descriptor', v_descriptor));
  end loop;
  return v_result;
end; $$;

create or replace function public.save_candidate_standing_answer(p_topic text, p_answer text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_workspace uuid; v_candidate uuid; v_id uuid; v_waiting uuid;
  v_topic text := regexp_replace(btrim(coalesce(p_topic, '')), '\s+', ' ', 'g');
  v_answer text := btrim(coalesce(p_answer, ''));
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if char_length(v_topic) not between 1 and 200 or char_length(v_answer) not between 1 and 1000 then
    raise exception 'CANDIDATE_STANDING_ANSWER_INVALID' using errcode = '22023'; end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
    from private.actor_personal_candidate(v_actor) as resolved;
  if (select count(*) from public.candidate_standing_answers where candidate_id = v_candidate) >= 100
    and not exists (select 1 from public.candidate_standing_answers where candidate_id = v_candidate and lower(topic) = lower(v_topic)) then
    raise exception 'CANDIDATE_STANDING_ANSWER_LIMIT' using errcode = '55000'; end if;
  insert into public.candidate_standing_answers(workspace_id, candidate_id, topic, answer)
    values (v_workspace, v_candidate, v_topic, v_answer)
    on conflict (candidate_id, lower(topic)) do update set topic = excluded.topic, answer = excluded.answer, updated_at = statement_timestamp()
    returning id into v_id;
  -- Sends waiting on questions try again: the new answer may cover them.
  for v_waiting in
    select p.id from public.application_autopilots p
      where p.candidate_id = v_candidate and p.workspace_id = v_workspace and p.status = 'WAITING_ANSWERS'
        and p.stop_requested is null and p.attempt_id is null and p.expires_at > statement_timestamp()
        and exists (select 1 from public.applications a where a.id = p.application_id and a.current_revision_id = p.revision_id)
      for update of p
  loop
    update public.application_autopilots set status = 'QUEUED', available_at = statement_timestamp(), version = version + 1,
      updated_at = statement_timestamp() where id = v_waiting;
    perform private.autopilot_event(v_waiting, 'application.autopilot_standing_answers_changed', 'EXECUTING');
  end loop;
  return v_id;
end; $$;
