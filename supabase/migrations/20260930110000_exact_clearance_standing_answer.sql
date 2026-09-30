-- Explicit saved yes/no clearance response, deterministic exact scope only.
-- No candidate data is inserted and no application input epoch is changed.
-- Generic standing inference and cross-application recall remain candidate-only.
create function private.autopilot_exact_standing_value(p_descriptor jsonb, p_topic text, p_answer text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_label text := lower(regexp_replace(btrim(p_descriptor->>'label'), '\s+', ' ', 'g')); v_value jsonb;
begin
  if not coalesce(private.autopilot_descriptor_valid(p_descriptor), false)
    or p_descriptor->'required' is distinct from 'true'::jsonb
    or lower(regexp_replace(btrim(coalesce(p_topic, '')), '\s+', ' ', 'g')) <> 'active ts/sci with fsp or ci'
    or v_label !~ '^do you (have an active ts/sci clearance|currently possess an active ts/sci) with fsp or ci\??\s*\*?$'
    or p_answer is null or p_answer not in ('Yes', 'No') then return null; end if;
  if p_descriptor->>'kind' = 'BOOLEAN' and jsonb_array_length(p_descriptor->'options') = 0 then
    return to_jsonb(p_answer = 'Yes');
  elsif p_descriptor->>'kind' = 'SINGLE_SELECT' and jsonb_array_length(p_descriptor->'options') = 2
    and (select count(*) from jsonb_array_elements(p_descriptor->'options') o where lower(btrim(o->>'label')) = 'yes') = 1
    and (select count(*) from jsonb_array_elements(p_descriptor->'options') o where lower(btrim(o->>'label')) = 'no') = 1 then
    select o->'value' into v_value from jsonb_array_elements(p_descriptor->'options') o where lower(btrim(o->>'label')) = lower(p_answer);
    return v_value;
  end if;
  return null;
end; $$;
revoke all on function private.autopilot_exact_standing_value(jsonb, text, text) from public, anon, authenticated, service_role;

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
      or not coalesce(private.autopilot_standing_answer_eligible(v_descriptor) or (
        jsonb_typeof(v_item->'basis') = 'array' and jsonb_array_length(v_item->'basis') = 1
        and exists(select 1 from public.candidate_standing_answers s
          where s.id::text = v_item->'basis'->>0 and s.candidate_id = v_row.candidate_id and s.workspace_id = v_row.workspace_id
            and private.autopilot_exact_standing_value(v_descriptor, s.topic, s.answer) = v_item->'value')
      ), false)
      or not coalesce(private.autopilot_value_valid(v_descriptor, v_item->'value'), false)
      or (v_descriptor->>'kind' in ('TEXT', 'LONG_TEXT') and char_length(v_item->>'value') > 1000)
      or jsonb_typeof(v_item->'basis') is distinct from 'array' or jsonb_array_length(v_item->'basis') not between 1 and 6
      or exists (select 1 from jsonb_array_elements(v_item->'basis') b
        where jsonb_typeof(b) is distinct from 'string' or not (
          (b#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and exists (select 1 from public.candidate_standing_answers s where s.id = (b#>>'{}')::uuid and s.candidate_id = v_row.candidate_id
              and (lower(regexp_replace(btrim(s.topic), '\s+', ' ', 'g')) <> 'active ts/sci with fsp or ci'
                or coalesce((jsonb_array_length(v_item->'basis') = 1
                  and private.autopilot_exact_standing_value(v_descriptor, s.topic, s.answer) = v_item->'value'), false))))
          or (private.autopilot_standing_fact_allowed(substring(b#>>'{}' from 6)) and left(b#>>'{}', 5) = 'fact:'
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
