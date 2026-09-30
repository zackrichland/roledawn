-- Remembered answers fill the first pass (D-115).
--
-- D-112 answered repeat questions only after a pass stopped to ask them, so a
-- send still released its browser and ran a second pass. The worker now asks,
-- when it first reads a form, for the candidate's remembered answers to the
-- askable fields. Each remembered answer is stored as the candidate's own answer
-- on this send's question (provenance kept), and the send fills it in the same
-- pass. The send's status is not changed; only questions new to the candidate
-- are asked.

create or replace function private.autopilot_remembered_value(p_candidate_id uuid, p_workspace_id uuid, p_autopilot_id uuid, p_descriptor jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_prior_descriptor jsonb; v_prior_value jsonb; v_value jsonb;
begin
  select q.descriptor,a.value_json into v_prior_descriptor,v_prior_value
    from public.application_autopilot_questions q
    join public.application_autopilot_answers a on a.question_id=q.id
    join public.application_autopilots p on p.id=q.autopilot_id
    where p.candidate_id=p_candidate_id and p.workspace_id=p_workspace_id and q.autopilot_id<>p_autopilot_id and q.status='ANSWERED'
      and q.descriptor->>'kind'=p_descriptor->>'kind'
      and private.autopilot_question_key(q.descriptor->>'label')=private.autopilot_question_key(p_descriptor->>'label')
    order by a.created_at desc limit 1;
  if not found then return null; end if;
  case p_descriptor->>'kind'
    when 'TEXT','LONG_TEXT' then
      if jsonb_typeof(v_prior_value)='string' and char_length(v_prior_value#>>'{}')<=8000
        and (not (p_descriptor->>'required')::boolean or btrim(v_prior_value#>>'{}')<>'') then v_value:=v_prior_value; end if;
    when 'BOOLEAN' then
      if jsonb_typeof(v_prior_value)='boolean' then v_value:=v_prior_value; end if;
    when 'SINGLE_SELECT' then
      if jsonb_typeof(v_prior_value)='string' then
        select o->'value' into v_value from jsonb_array_elements(p_descriptor->'options') o
          where lower(btrim(o->>'label'))=(select lower(btrim(po->>'label')) from jsonb_array_elements(v_prior_descriptor->'options') po where po->'value'=v_prior_value limit 1)
          limit 1;
      end if;
    when 'MULTI_SELECT' then
      if jsonb_typeof(v_prior_value)='array' and jsonb_array_length(v_prior_value)>0 then
        select jsonb_agg(o->'value') into v_value from jsonb_array_elements(p_descriptor->'options') o
          where lower(btrim(o->>'label')) in (select lower(btrim(po->>'label')) from jsonb_array_elements(v_prior_descriptor->'options') po
            join jsonb_array_elements(v_prior_value) c(choice) on po->'value'=c.choice);
        if v_value is null or jsonb_array_length(v_value)<>jsonb_array_length(v_prior_value) then v_value:=null; end if;
      end if;
    else v_value:=null;
  end case;
  return v_value;
end; $$;
revoke all on function private.autopilot_remembered_value(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

-- D-112's post-question pass now shares the same lookup.
create or replace function private.remember_autopilot_answers(p_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_question public.application_autopilot_questions%rowtype;
  v_value jsonb; v_count integer:=0; v_command uuid:=extensions.gen_random_uuid();
begin
  select * into strict v_row from public.application_autopilots where id=p_id;
  for v_question in select * from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN' order by created_at,id for update loop
    v_value:=private.autopilot_remembered_value(v_row.candidate_id,v_row.workspace_id,p_id,v_question.descriptor);
    if v_value is null then continue; end if;
    insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id) values(v_question.id,v_value,v_row.delegated_by,v_command);
    update public.application_autopilot_questions set status='ANSWERED' where id=v_question.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;

create or replace function public.prefill_application_autopilot_answers(p_id uuid,p_lease_token uuid,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_item jsonb; v_value jsonb; v_question uuid; v_answer uuid;
  v_result jsonb:='[]'::jsonb; v_command uuid:=extensions.gen_random_uuid();
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,true);
  if v_row.sealed_diff_hash is not null or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>24 then
    raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    -- The same descriptor rules as request_application_autopilot_questions.
    if jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item->>'fingerprint','') !~ '^[0-9a-f]{64}$'
      or coalesce(char_length(btrim(v_item->>'fieldId')),0) not between 1 and 160
      or coalesce(char_length(btrim(v_item->>'label')),0) not between 1 and 1000
      or coalesce(v_item->>'kind','') not in ('TEXT','LONG_TEXT','BOOLEAN','SINGLE_SELECT','MULTI_SELECT')
      or jsonb_typeof(v_item->'required') is distinct from 'boolean'
      or coalesce(v_item->>'reasonCode','') not in ('MISSING_EXACT_ANSWER','SENSITIVE_REQUIRES_CANDIDATE','AMBIGUOUS_ANSWER')
      or jsonb_typeof(v_item->'options') is distinct from 'array' or jsonb_array_length(v_item->'options')>80
      or ((v_item->>'kind' in ('SINGLE_SELECT','MULTI_SELECT')) is distinct from (jsonb_array_length(v_item->'options')>0))
      or exists(select 1 from jsonb_array_elements(v_item->'options') o where jsonb_typeof(o->'value') is distinct from 'string' or jsonb_typeof(o->'label') is distinct from 'string'
        or char_length(btrim(o->>'value')) not between 1 and 500 or char_length(btrim(o->>'label')) not between 1 and 500)
      or (select count(distinct o->>'value') from jsonb_array_elements(v_item->'options') o)<>jsonb_array_length(v_item->'options') then
      raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
    -- A field this send already asked about or answered keeps its own record.
    if exists(select 1 from public.application_autopilot_questions where autopilot_id=p_id and fingerprint=v_item->>'fingerprint') then continue; end if;
    v_value:=private.autopilot_remembered_value(v_row.candidate_id,v_row.workspace_id,p_id,v_item);
    if v_value is null then continue; end if;
    if (select count(*) from public.application_autopilot_questions where autopilot_id=p_id)>=96 then exit; end if;
    insert into public.application_autopilot_questions(autopilot_id,fingerprint,descriptor,status) values(p_id,v_item->>'fingerprint',v_item,'ANSWERED') returning id into v_question;
    insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id) values(v_question,v_value,v_row.delegated_by,v_command) returning id into v_answer;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('answer_id',v_answer,'field_id',v_item->>'fieldId','fingerprint',v_item->>'fingerprint','value',v_value,'descriptor',v_item));
  end loop;
  return v_result;
end; $$;
revoke all on function public.prefill_application_autopilot_answers(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prefill_application_autopilot_answers(uuid,uuid,jsonb) to service_role;
