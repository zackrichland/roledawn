-- D-150: reuse the candidate's exact saved phone-country answer for this slot,
-- including an optional prefilled country. Residence never supplies this answer.
create function private.autopilot_phone_country_standing_value(p_descriptor jsonb, p_topic text, p_answer text)
returns jsonb language sql immutable set search_path = '' as $$
  select case when private.autopilot_descriptor_valid(p_descriptor)
    and lower(regexp_replace(btrim(p_descriptor->>'label'),'\s+',' ','g')) ~ '^phone country\s*\*?$'
    and p_descriptor->>'kind'='TEXT' and jsonb_array_length(p_descriptor->'options')=0
    and lower(regexp_replace(btrim(coalesce(p_topic,'')),'\s+',' ','g'))='phone number country code'
    and nullif(btrim(p_answer),'') is not null and char_length(p_answer)<=1000
    and p_answer !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
    then to_jsonb(p_answer) else null end
$$;
revoke all on function private.autopilot_phone_country_standing_value(jsonb,text,text) from public,anon,authenticated,service_role;

create or replace function public.record_application_autopilot_standing_answers(p_id uuid, p_lease_token uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.application_autopilots%rowtype; v_item jsonb; v_descriptor jsonb; v_existing public.application_autopilot_questions%rowtype;
  v_legal_name text; v_question uuid; v_answer uuid; v_result jsonb := '[]'::jsonb; v_command uuid := extensions.gen_random_uuid();
begin
  v_row := private.assert_autopilot_lease(p_id, p_lease_token, true);
  -- Signature text must be the exact approved identity frozen in this send's disclosure.
  select version.value_json#>>'{}' into v_legal_name
    from public.candidate_fact_versions version join public.candidate_facts fact on fact.id=version.fact_id
    where version.candidate_id=v_row.candidate_id and version.workspace_id=v_row.workspace_id
      and fact.candidate_id=v_row.candidate_id and fact.workspace_id=v_row.workspace_id
      and fact.fact_key='identity.legal_name' and version.candidate_disposition='APPROVED'
      and version.reviewed_at is not null and jsonb_typeof(version.value_json)='string'
      and exists(select 1 from jsonb_array_elements(v_row.disclosure_manifest->'allowed_fact_versions') allowed
        where allowed->>'fact_version_id'=version.id::text and allowed->>'fact_key'='identity.legal_name');
  if v_row.sealed_diff_hash is not null or jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 24 then
    raise exception 'APPLICATION_AUTOPILOT_STANDING_ANSWERS_INVALID' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_answers) loop
    v_descriptor := v_item->'descriptor';
    if jsonb_typeof(v_item) is distinct from 'object' or not coalesce(private.autopilot_descriptor_valid(v_descriptor), false)
      or not coalesce(private.autopilot_standing_answer_eligible(v_descriptor) or (
        jsonb_typeof(v_item->'basis') = 'array' and jsonb_array_length(v_item->'basis') = 1
        and exists(select 1 from public.candidate_standing_answers s
          where s.id::text = v_item->'basis'->>0 and s.candidate_id = v_row.candidate_id and s.workspace_id = v_row.workspace_id
            and coalesce(private.autopilot_exact_standing_value(v_descriptor, s.topic, s.answer),
              private.autopilot_delegated_standing_value(v_descriptor,s.topic,s.answer,v_legal_name),
              private.autopilot_phone_country_standing_value(v_descriptor,s.topic,s.answer)) = v_item->'value')
      ), false)
      or not coalesce(private.autopilot_value_valid(v_descriptor, v_item->'value'), false)
      or (v_descriptor->>'kind' in ('TEXT', 'LONG_TEXT') and char_length(v_item->>'value') > 1000)
      or jsonb_typeof(v_item->'basis') is distinct from 'array' or jsonb_array_length(v_item->'basis') not between 1 and 6
      or exists (select 1 from jsonb_array_elements(v_item->'basis') b
        where jsonb_typeof(b) is distinct from 'string' or not (
          (b#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and exists (select 1 from public.candidate_standing_answers s where s.id = (b#>>'{}')::uuid and s.candidate_id = v_row.candidate_id
              and (lower(regexp_replace(btrim(s.topic), '\s+', ' ', 'g')) not in ('active ts/sci with fsp or ci','delegated application acknowledgements','phone number country code')
                or coalesce((jsonb_array_length(v_item->'basis') = 1
                  and coalesce(private.autopilot_exact_standing_value(v_descriptor, s.topic, s.answer),
              private.autopilot_delegated_standing_value(v_descriptor,s.topic,s.answer,v_legal_name),
              private.autopilot_phone_country_standing_value(v_descriptor,s.topic,s.answer)) = v_item->'value'), false))))
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
