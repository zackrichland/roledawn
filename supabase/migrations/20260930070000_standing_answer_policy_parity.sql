-- Keep the database's standing-answer policy in step with the worker (D-119).
-- The worker already rejects candidate-only and optional questions; the prior
-- RPC only checked a sensitive answer's basis, so a valid standing-answer id
-- could authorize a demographic or consent answer at the database boundary.
-- No candidate data is added here. Public RPC signatures are unchanged.

create function private.autopilot_standing_candidate_only(p_label text)
returns boolean language sql immutable set search_path = '' as $$
  -- Match the two non-ASCII letters that ECMAScript /iu folds into ASCII.
  select translate(coalesce(p_label, ''), 'ſK', 'sk') ~* '(^|[^a-z0-9_])(gender|sex|sexual|race|racial|ethnic[a-z0-9_]*|hispanic|latin[aeox]|veteran[a-z0-9_]*|disabilit[a-z0-9_]*|pronouns?|transgender|religio[a-z0-9_]*|marital|pregnan[a-z0-9_]*|citizen[a-z0-9_]*|nationality|passport|social security|ssn|criminal|convict[a-z0-9_]*|felon[a-z0-9_]*|misdemeanor[a-z0-9_]*|arrest[a-z0-9_]*|background check|drug|medical|health|signature|sign|consent|agree[a-z0-9_]*|acknowledg[a-z0-9_]*|certify|attest[a-z0-9_]*|terms|privacy|eeo|arbitrat[a-z0-9_]*|non[\s-]*compet[a-z0-9_]*|(person|people) of colou?r|(confirm|declare)(?=$|[^a-z0-9_]).*(?<![a-z0-9_])(information|statements?)(?=$|[^a-z0-9_]).*(?<![a-z0-9_])(true|accurate|complete))($|[^a-z0-9_])'
$$;

create function private.autopilot_question_candidate_only(p_descriptor jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select private.autopilot_standing_candidate_only(p_descriptor->>'label')
    or exists (
      select 1 from jsonb_array_elements(p_descriptor->'options') o
      where private.autopilot_standing_candidate_only(o->>'label')
        and translate(o->>'label', 'ſK', 'sk') ~* '(^|[^a-z0-9_])(decline|prefer not)($|[^a-z0-9_])'
    )
$$;

create function private.autopilot_standing_answer_eligible(p_descriptor jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_descriptor->'required' = 'true'::jsonb, false)
    and not private.autopilot_question_candidate_only(p_descriptor)
$$;

create function private.autopilot_standing_fact_allowed(p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_key, '') ~ '^(work_authorization\.(us|ca)\.(authorized|sponsorship_required)|education\.highest_degree|application\.heard_about|preferences\.willing_to_relocate|availability\.start_date|compensation\.expected_salary|location\.(city|region|country_code))$'
$$;

revoke all on function private.autopilot_standing_candidate_only(text) from public, anon, authenticated, service_role;
revoke all on function private.autopilot_question_candidate_only(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.autopilot_standing_answer_eligible(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.autopilot_standing_fact_allowed(text) from public, anon, authenticated, service_role;

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
      or not coalesce(private.autopilot_standing_answer_eligible(v_descriptor), false)
      or not coalesce(private.autopilot_value_valid(v_descriptor, v_item->'value'), false)
      or (v_descriptor->>'kind' in ('TEXT', 'LONG_TEXT') and char_length(v_item->>'value') > 1000)
      or jsonb_typeof(v_item->'basis') is distinct from 'array' or jsonb_array_length(v_item->'basis') not between 1 and 6
      or exists (select 1 from jsonb_array_elements(v_item->'basis') b
        where jsonb_typeof(b) is distinct from 'string' or not (
          (b#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and exists (select 1 from public.candidate_standing_answers s where s.id = (b#>>'{}')::uuid and s.candidate_id = v_row.candidate_id))
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


-- Cross-application recall must not bypass the same candidate-only policy.
create or replace function private.autopilot_remembered_value(p_candidate_id uuid, p_workspace_id uuid, p_autopilot_id uuid, p_descriptor jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_prior record; v_value jsonb;
begin
  -- Consent, legal, signature and demographic responses are application-specific.
  -- An exact response in this send is still usable; never copy it from another.
  if private.autopilot_question_candidate_only(p_descriptor) then return null; end if;
  for v_prior in
    select q.descriptor as descriptor, a.value_json as value
      from public.application_autopilot_questions q
      join public.application_autopilot_answers a on a.question_id=q.id
      join public.application_autopilots p on p.id=q.autopilot_id
      where p.candidate_id=p_candidate_id and p.workspace_id=p_workspace_id and q.autopilot_id<>p_autopilot_id and q.status='ANSWERED'
        and a.source<>'STANDING'
        and q.descriptor->>'kind'=p_descriptor->>'kind'
        and private.autopilot_question_key(q.descriptor->>'label')=private.autopilot_question_key(p_descriptor->>'label')
      order by a.created_at desc limit 5
  loop
    v_value:=null;
    case p_descriptor->>'kind'
      when 'TEXT','LONG_TEXT' then
        if jsonb_typeof(v_prior.value)='string' and char_length(v_prior.value#>>'{}')<=8000
          and (not (p_descriptor->>'required')::boolean or btrim(v_prior.value#>>'{}')<>'') then v_value:=v_prior.value; end if;
      when 'BOOLEAN' then
        if jsonb_typeof(v_prior.value)='boolean' then v_value:=v_prior.value; end if;
      when 'SINGLE_SELECT' then
        if jsonb_typeof(v_prior.value)='string' then
          select o->'value' into v_value from jsonb_array_elements(p_descriptor->'options') o
            where private.autopilot_option_key(o->>'label')=(select private.autopilot_option_key(po->>'label')
              from jsonb_array_elements(v_prior.descriptor->'options') po where po->'value'=v_prior.value limit 1)
            limit 1;
        end if;
      when 'MULTI_SELECT' then
        if jsonb_typeof(v_prior.value)='array' and jsonb_array_length(v_prior.value)>0 then
          select jsonb_agg(o->'value') into v_value from jsonb_array_elements(p_descriptor->'options') o
            where private.autopilot_option_key(o->>'label') in (select private.autopilot_option_key(po->>'label')
              from jsonb_array_elements(v_prior.descriptor->'options') po join jsonb_array_elements(v_prior.value) c(choice) on po->'value'=c.choice);
          if v_value is null or jsonb_array_length(v_value)<>jsonb_array_length(v_prior.value) then v_value:=null; end if;
        end if;
      else v_value:=null;
    end case;
    if v_value is not null then return v_value; end if;
  end loop;
  return null;
end; $$;
