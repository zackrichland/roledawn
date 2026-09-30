-- Standing answers (D-117).
--
-- The candidate's own answers to routine application questions ("GPA: 3.5",
-- "Able to work on-site: Yes"). When a required question has no profile fact
-- and no remembered answer, the worker maps it to these answers, records the
-- choice with the answers it relied on, and fills it in the same pass. Only
-- questions they do not cover still reach the candidate.
--
-- Every automatic answer is labeled: application_autopilot_answers.source says
-- whether the candidate typed it (CANDIDATE), it repeated an earlier answer to
-- the same question (REMEMBERED), or it came from standing answers (STANDING,
-- with the standing answers and profile facts it relied on in basis).

create table public.candidate_standing_answers (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  topic text not null check (char_length(btrim(topic)) between 1 and 200 and topic = btrim(topic)),
  answer text not null check (char_length(btrim(answer)) between 1 and 1000 and answer = btrim(answer)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, candidate_id) references public.candidates(workspace_id, id) on delete cascade
);
create unique index candidate_standing_answers_topic on public.candidate_standing_answers(candidate_id, lower(topic));
alter table public.candidate_standing_answers enable row level security;
create policy candidate_standing_answers_candidate_select on public.candidate_standing_answers for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_standing_answers.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
revoke all on public.candidate_standing_answers from public, anon, authenticated;
grant select on public.candidate_standing_answers to authenticated;
grant all on public.candidate_standing_answers to service_role;

-- Saves (or replaces, by topic) one standing answer for the signed-in candidate.
create function public.save_candidate_standing_answer(p_topic text, p_answer text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_workspace uuid; v_candidate uuid; v_id uuid;
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
  return v_id;
end; $$;
create function public.delete_candidate_standing_answer(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_candidate uuid;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select resolved.candidate_id into strict v_candidate from private.actor_personal_candidate(v_actor) as resolved;
  delete from public.candidate_standing_answers where id = p_id and candidate_id = v_candidate;
  return found;
end; $$;
revoke all on function public.save_candidate_standing_answer(text, text) from public, anon, service_role;
revoke all on function public.delete_candidate_standing_answer(uuid) from public, anon, service_role;
grant execute on function public.save_candidate_standing_answer(text, text) to authenticated;
grant execute on function public.delete_candidate_standing_answer(uuid) to authenticated;

alter table public.application_autopilot_answers
  add column source text not null default 'CANDIDATE' check (source in ('CANDIDATE', 'REMEMBERED', 'STANDING')),
  add column basis jsonb check (basis is null or (jsonb_typeof(basis) = 'array' and jsonb_array_length(basis) between 1 and 6 and octet_length(basis::text) <= 2048));

-- The shared descriptor and value rules, as request_application_autopilot_questions
-- and save_application_autopilot_answers apply them.
create function private.autopilot_descriptor_valid(p_item jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_item) = 'object' and coalesce(p_item->>'fingerprint', '') ~ '^[0-9a-f]{64}$'
    and coalesce(char_length(btrim(p_item->>'fieldId')), 0) between 1 and 160
    and coalesce(char_length(btrim(p_item->>'label')), 0) between 1 and 1000
    and coalesce(p_item->>'kind', '') in ('TEXT', 'LONG_TEXT', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT')
    and jsonb_typeof(p_item->'required') = 'boolean'
    and coalesce(p_item->>'reasonCode', '') in ('MISSING_EXACT_ANSWER', 'SENSITIVE_REQUIRES_CANDIDATE', 'AMBIGUOUS_ANSWER')
    and jsonb_typeof(p_item->'options') = 'array' and jsonb_array_length(p_item->'options') <= 80
    and (p_item->>'kind' in ('SINGLE_SELECT', 'MULTI_SELECT')) = (jsonb_array_length(p_item->'options') > 0)
    and not exists (select 1 from jsonb_array_elements(p_item->'options') o
      where jsonb_typeof(o->'value') is distinct from 'string' or jsonb_typeof(o->'label') is distinct from 'string'
        or char_length(btrim(o->>'value')) not between 1 and 500 or char_length(btrim(o->>'label')) not between 1 and 500)
    and (select count(distinct o->>'value') from jsonb_array_elements(p_item->'options') o) = jsonb_array_length(p_item->'options')
$$;
create function private.autopilot_value_valid(p_descriptor jsonb, p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_value is not null and octet_length(p_value::text) <= 40000 and case p_descriptor->>'kind'
    when 'TEXT' then jsonb_typeof(p_value) = 'string' and char_length(p_value#>>'{}') <= 8000
      and (not (p_descriptor->>'required')::boolean or btrim(p_value#>>'{}') <> '')
    when 'LONG_TEXT' then jsonb_typeof(p_value) = 'string' and char_length(p_value#>>'{}') <= 8000
      and (not (p_descriptor->>'required')::boolean or btrim(p_value#>>'{}') <> '')
    when 'BOOLEAN' then jsonb_typeof(p_value) = 'boolean'
    when 'SINGLE_SELECT' then jsonb_typeof(p_value) = 'string'
      and exists (select 1 from jsonb_array_elements(p_descriptor->'options') o where o->'value' = p_value)
    when 'MULTI_SELECT' then jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) between 1 and 80
      and (select count(distinct value) from jsonb_array_elements(p_value)) = jsonb_array_length(p_value)
      and not exists (select 1 from jsonb_array_elements(p_value) choice
        where not exists (select 1 from jsonb_array_elements(p_descriptor->'options') o where o->'value' = choice))
    else false end
$$;
revoke all on function private.autopilot_descriptor_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.autopilot_value_valid(jsonb, jsonb) from public, anon, authenticated, service_role;

-- The candidate's standing answers and the job they apply to, for the worker
-- holding this send's lease.
create function public.read_candidate_standing_answers(p_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.application_autopilots%rowtype; v_answers jsonb; v_job jsonb;
begin
  v_row := private.assert_autopilot_lease(p_id, p_lease_token, true);
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'topic', s.topic, 'answer', s.answer) order by s.topic), '[]')
    into v_answers from public.candidate_standing_answers s
    where s.candidate_id = v_row.candidate_id and s.workspace_id = v_row.workspace_id;
  select jsonb_build_object('title', left(v.title, 200), 'employer', left(v.employer_name, 200),
      'location', left(v.location_text, 200), 'work_mode', left(v.work_mode, 40))
    into v_job from public.applications a join public.job_versions v on v.id = a.job_version_id where a.id = v_row.application_id;
  return jsonb_build_object('answers', v_answers, 'job', v_job);
end; $$;

-- Records answers the worker derived from standing answers or profile facts.
-- Each item: {descriptor, value, basis}; basis cites the candidate's standing
-- answer ids or profile fact keys the answer rests on. Returns the recorded
-- answers in read_application_autopilot_answers' shape.
create function public.record_application_autopilot_standing_answers(p_id uuid, p_lease_token uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.application_autopilots%rowtype; v_item jsonb; v_descriptor jsonb; v_question uuid; v_answer uuid;
  v_result jsonb := '[]'::jsonb; v_command uuid := extensions.gen_random_uuid();
begin
  v_row := private.assert_autopilot_lease(p_id, p_lease_token, true);
  if v_row.sealed_diff_hash is not null or jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) > 24 then
    raise exception 'APPLICATION_AUTOPILOT_STANDING_ANSWERS_INVALID' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_answers) loop
    v_descriptor := v_item->'descriptor';
    if jsonb_typeof(v_item) is distinct from 'object' or not coalesce(private.autopilot_descriptor_valid(v_descriptor), false)
      or v_descriptor->>'reasonCode' = 'SENSITIVE_REQUIRES_CANDIDATE'
      or not coalesce(private.autopilot_value_valid(v_descriptor, v_item->'value'), false)
      or jsonb_typeof(v_item->'basis') is distinct from 'array' or jsonb_array_length(v_item->'basis') not between 1 and 6
      or exists (select 1 from jsonb_array_elements(v_item->'basis') b
        where jsonb_typeof(b) is distinct from 'string' or not (
          (b#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and exists (select 1 from public.candidate_standing_answers s where s.id = (b#>>'{}')::uuid and s.candidate_id = v_row.candidate_id))
          or b#>>'{}' ~ '^fact:[a-z_]+(\.[a-z_]+){1,3}$')) then
      raise exception 'APPLICATION_AUTOPILOT_STANDING_ANSWERS_INVALID' using errcode = '22023'; end if;
    -- A field this send already asked about or answered keeps its own record.
    if exists (select 1 from public.application_autopilot_questions where autopilot_id = p_id and fingerprint = v_descriptor->>'fingerprint') then continue; end if;
    if (select count(*) from public.application_autopilot_questions where autopilot_id = p_id) >= 96 then exit; end if;
    insert into public.application_autopilot_questions(autopilot_id, fingerprint, descriptor, status)
      values (p_id, v_descriptor->>'fingerprint', v_descriptor, 'ANSWERED') returning id into v_question;
    insert into public.application_autopilot_answers(question_id, value_json, answered_by, command_id, source, basis)
      values (v_question, v_item->'value', v_row.delegated_by, v_command, 'STANDING', v_item->'basis') returning id into v_answer;
    v_result := v_result || jsonb_build_array(jsonb_build_object('answer_id', v_answer, 'field_id', v_descriptor->>'fieldId',
      'fingerprint', v_descriptor->>'fingerprint', 'value', v_item->'value', 'descriptor', v_descriptor));
  end loop;
  return v_result;
end; $$;
revoke all on function public.read_candidate_standing_answers(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_application_autopilot_standing_answers(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.read_candidate_standing_answers(uuid, uuid) to service_role;
grant execute on function public.record_application_autopilot_standing_answers(uuid, uuid, jsonb) to service_role;

-- Remembered answers are labeled as such.
create or replace function private.remember_autopilot_answers(p_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_question public.application_autopilot_questions%rowtype;
  v_value jsonb; v_count integer:=0; v_command uuid:=extensions.gen_random_uuid();
begin
  select * into strict v_row from public.application_autopilots where id=p_id;
  for v_question in select * from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN' order by created_at,id for update loop
    v_value:=private.autopilot_remembered_value(v_row.candidate_id,v_row.workspace_id,p_id,v_question.descriptor);
    if v_value is null then continue; end if;
    insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id,source) values(v_question.id,v_value,v_row.delegated_by,v_command,'REMEMBERED');
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
    if not coalesce(private.autopilot_descriptor_valid(v_item), false) then
      raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
    -- A field this send already asked about or answered keeps its own record.
    if exists(select 1 from public.application_autopilot_questions where autopilot_id=p_id and fingerprint=v_item->>'fingerprint') then continue; end if;
    v_value:=private.autopilot_remembered_value(v_row.candidate_id,v_row.workspace_id,p_id,v_item);
    if v_value is null then continue; end if;
    if (select count(*) from public.application_autopilot_questions where autopilot_id=p_id)>=96 then exit; end if;
    insert into public.application_autopilot_questions(autopilot_id,fingerprint,descriptor,status) values(p_id,v_item->>'fingerprint',v_item,'ANSWERED') returning id into v_question;
    insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id,source) values(v_question,v_value,v_row.delegated_by,v_command,'REMEMBERED') returning id into v_answer;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('answer_id',v_answer,'field_id',v_item->>'fieldId','fingerprint',v_item->>'fingerprint','value',v_value,'descriptor',v_item));
  end loop;
  return v_result;
end; $$;

-- Only answers the candidate gave are remembered. Standing-answer choices are
-- derived again each time, so an edited standing answer takes effect at once.
create or replace function private.autopilot_remembered_value(p_candidate_id uuid, p_workspace_id uuid, p_autopilot_id uuid, p_descriptor jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_prior record; v_value jsonb;
begin
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
