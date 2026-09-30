-- Remembered answers (D-112).
--
-- A required question the candidate already answered on an earlier application
-- (same wording, same kind, and for choices the same option label) is answered
-- the same way again, so a send only stops for questions that are new to the
-- candidate. Answers stay provenance-linked: each copy is stored as the
-- candidate's own answer on this application's question.

create or replace function private.autopilot_question_key(p_label text)
returns text language plpgsql immutable set search_path='' as $$
declare v_key text; v_half integer;
begin
  v_key:=lower(coalesce(p_label,''));
  v_key:=regexp_replace(v_key,'\(required\)','','g');
  v_key:=regexp_replace(v_key,'[*?:.]+',' ','g');
  v_key:=btrim(regexp_replace(v_key,'\s+',' ','g'));
  -- Some forms repeat the question text after its label ("Question? Question?").
  v_half:=char_length(v_key)/2;
  if char_length(v_key)>=3 and char_length(v_key)%2=1 and substr(v_key,1,v_half)=substr(v_key,v_half+2) then v_key:=substr(v_key,1,v_half); end if;
  return v_key;
end; $$;

create or replace function private.remember_autopilot_answers(p_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_question public.application_autopilot_questions%rowtype;
  v_prior_descriptor jsonb; v_prior_value jsonb; v_value jsonb; v_count integer:=0; v_command uuid:=extensions.gen_random_uuid();
begin
  select * into strict v_row from public.application_autopilots where id=p_id;
  for v_question in select * from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN' order by created_at,id for update loop
    select q.descriptor,a.value_json into v_prior_descriptor,v_prior_value
      from public.application_autopilot_questions q
      join public.application_autopilot_answers a on a.question_id=q.id
      join public.application_autopilots p on p.id=q.autopilot_id
      where p.candidate_id=v_row.candidate_id and p.workspace_id=v_row.workspace_id and q.autopilot_id<>p_id and q.status='ANSWERED'
        and q.descriptor->>'kind'=v_question.descriptor->>'kind'
        and private.autopilot_question_key(q.descriptor->>'label')=private.autopilot_question_key(v_question.descriptor->>'label')
      order by a.created_at desc limit 1;
    if not found then continue; end if;
    v_value:=null;
    case v_question.descriptor->>'kind'
      when 'TEXT','LONG_TEXT' then
        if jsonb_typeof(v_prior_value)='string' and char_length(v_prior_value#>>'{}')<=8000
          and (not (v_question.descriptor->>'required')::boolean or btrim(v_prior_value#>>'{}')<>'') then v_value:=v_prior_value; end if;
      when 'BOOLEAN' then
        if jsonb_typeof(v_prior_value)='boolean' then v_value:=v_prior_value; end if;
      when 'SINGLE_SELECT' then
        if jsonb_typeof(v_prior_value)='string' then
          select o->'value' into v_value from jsonb_array_elements(v_question.descriptor->'options') o
            where lower(btrim(o->>'label'))=(select lower(btrim(po->>'label')) from jsonb_array_elements(v_prior_descriptor->'options') po where po->'value'=v_prior_value limit 1)
            limit 1;
        end if;
      when 'MULTI_SELECT' then
        if jsonb_typeof(v_prior_value)='array' and jsonb_array_length(v_prior_value)>0 then
          select jsonb_agg(o->'value') into v_value from jsonb_array_elements(v_question.descriptor->'options') o
            where lower(btrim(o->>'label')) in (select lower(btrim(po->>'label')) from jsonb_array_elements(v_prior_descriptor->'options') po
              join jsonb_array_elements(v_prior_value) c(choice) on po->'value'=c.choice);
          if v_value is null or jsonb_array_length(v_value)<>jsonb_array_length(v_prior_value) then v_value:=null; end if;
        end if;
      else v_value:=null;
    end case;
    if v_value is null then continue; end if;
    insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id) values(v_question.id,v_value,v_row.delegated_by,v_command);
    update public.application_autopilot_questions set status='ANSWERED' where id=v_question.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;
revoke all on function private.remember_autopilot_answers(uuid) from public,anon,authenticated,service_role;
revoke all on function private.autopilot_question_key(text) from public,anon,authenticated,service_role;

create or replace function public.request_application_autopilot_questions(p_id uuid,p_lease_token uuid,p_questions jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_item jsonb; v_existing public.application_autopilot_questions%rowtype; v_remembered integer;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,true);
  if v_row.sealed_diff_hash is not null or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>24 then
    raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
  if (select count(distinct value->>'fingerprint') from jsonb_array_elements(p_questions))<>jsonb_array_length(p_questions) then
    raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item->>'fingerprint','') !~ '^[0-9a-f]{64}$'
      or coalesce(char_length(btrim(v_item->>'fieldId')),0) not between 1 and 160
      or coalesce(char_length(btrim(v_item->>'label')),0) not between 1 and 1000
      or coalesce(v_item->>'kind','') not in ('TEXT','LONG_TEXT','BOOLEAN','SINGLE_SELECT','MULTI_SELECT')
      or jsonb_typeof(v_item->'required') is distinct from 'boolean'
      or coalesce(v_item->>'reasonCode','') not in ('MISSING_EXACT_ANSWER','SENSITIVE_REQUIRES_CANDIDATE','AMBIGUOUS_ANSWER')
      or jsonb_typeof(v_item->'options') is distinct from 'array' then
      raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
    if jsonb_array_length(v_item->'options')>80 or ((v_item->>'kind' in ('SINGLE_SELECT','MULTI_SELECT')) is distinct from (jsonb_array_length(v_item->'options')>0))
      or exists(select 1 from jsonb_array_elements(v_item->'options') o where jsonb_typeof(o->'value') is distinct from 'string' or jsonb_typeof(o->'label') is distinct from 'string'
        or char_length(btrim(o->>'value')) not between 1 and 500 or char_length(btrim(o->>'label')) not between 1 and 500)
      or (select count(distinct o->>'value') from jsonb_array_elements(v_item->'options') o)<>jsonb_array_length(v_item->'options') then
      raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
    select * into v_existing from public.application_autopilot_questions where autopilot_id=p_id and fingerprint=v_item->>'fingerprint' for update;
    if found then
      if v_existing.descriptor<>v_item then raise exception 'APPLICATION_AUTOPILOT_FIELD_CHANGED' using errcode='PT409'; end if;
      if v_existing.status='SUPERSEDED' then update public.application_autopilot_questions set status='OPEN' where id=v_existing.id; end if;
    else
      if (select count(*) from public.application_autopilot_questions where autopilot_id=p_id)>=96 then
        raise exception 'APPLICATION_AUTOPILOT_QUESTION_LIMIT' using errcode='55000'; end if;
      insert into public.application_autopilot_questions(autopilot_id,fingerprint,descriptor) values(p_id,v_item->>'fingerprint',v_item);
    end if;
  end loop;
  update public.application_autopilot_questions q set status='SUPERSEDED' where q.autopilot_id=p_id and q.status='OPEN'
    and not exists(select 1 from jsonb_array_elements(p_questions) x where x->>'fingerprint'=q.fingerprint);
  -- Questions the candidate already answered on an earlier application are answered the same way again.
  v_remembered:=private.remember_autopilot_answers(p_id);
  if exists(select 1 from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN') then
    update public.application_autopilots set status='WAITING_ANSWERS',lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,updated_at=statement_timestamp() where id=p_id;
    perform private.autopilot_event(p_id,'application.autopilot_questions_requested','TAKEOVER');
  elsif v_remembered>0 then
    -- Every question had a remembered answer: the send continues without the candidate.
    update public.application_autopilots set status='QUEUED',lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,
      available_at=statement_timestamp()+interval '1 minute',updated_at=statement_timestamp() where id=p_id;
    perform private.autopilot_event(p_id,'application.autopilot_answers_remembered','EXECUTING');
  end if;
end; $$;
