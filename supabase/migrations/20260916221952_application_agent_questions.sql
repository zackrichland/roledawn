-- Exact, application-scoped questions and candidate replies. A reply authorizes
-- only this field on this fill/session/revision; it is never a reusable fact.
create table public.application_agent_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  revision_id uuid not null,
  fill_attempt_id uuid not null,
  computer_session_id uuid not null,
  field_id text not null check (char_length(field_id) between 1 and 160),
  field_fingerprint text not null check (field_fingerprint ~ '^[0-9a-f]{64}$'),
  label text not null check (char_length(btrim(label)) between 1 and 1000),
  control_type text not null check (control_type in ('TEXT','LONG_TEXT','SINGLE_SELECT','MULTI_SELECT','BOOLEAN')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 80),
  required boolean not null,
  reason_code text not null check (reason_code in ('MISSING_EXACT_ANSWER','SENSITIVE_REQUIRES_CANDIDATE','AMBIGUOUS_ANSWER')),
  status text not null default 'OPEN' check (status in ('OPEN','ANSWERED','SUPERSEDED')),
  created_at timestamptz not null default now(),
  unique (computer_session_id, field_fingerprint),
  foreign key (workspace_id,candidate_id,application_id,fill_attempt_id)
    references public.application_fill_attempts(workspace_id,candidate_id,application_id,id) on delete cascade,
  foreign key (workspace_id,application_id,revision_id,fill_attempt_id)
    references public.application_fill_attempts(workspace_id,application_id,revision_id,id) on delete cascade,
  foreign key (computer_session_id,fill_attempt_id)
    references public.computer_sessions(id,fill_attempt_id) on delete cascade
);
create index application_agent_questions_fill_idx on public.application_agent_questions(workspace_id,candidate_id,application_id,fill_attempt_id);
create index application_agent_questions_revision_idx on public.application_agent_questions(workspace_id,application_id,revision_id,fill_attempt_id);
create index application_agent_questions_session_idx on public.application_agent_questions(computer_session_id,fill_attempt_id);

create table public.application_agent_answers (
  id uuid primary key default extensions.gen_random_uuid(),
  question_id uuid not null unique references public.application_agent_questions(id) on delete cascade,
  value_json jsonb not null check (jsonb_typeof(value_json) in ('string','boolean','array') and octet_length(value_json::text) <= 40000),
  answered_by uuid not null,
  command_id uuid not null,
  approved_for_fill boolean not null default true check (approved_for_fill),
  created_at timestamptz not null default now()
);

create function private.guard_application_agent_question_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
     or (old.status = 'ANSWERED' and new.status <> 'ANSWERED') then
    raise exception 'APPLICATION_AGENT_QUESTION_IMMUTABLE' using errcode = '55000';
  end if;
  if new.status = 'ANSWERED' and not exists (
    select 1 from public.application_agent_answers as answer where answer.question_id = new.id
  ) then
    raise exception 'APPLICATION_AGENT_ANSWER_REQUIRED' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger application_agent_questions_guard before update on public.application_agent_questions
  for each row execute function private.guard_application_agent_question_update();
create trigger application_agent_answers_immutable before update on public.application_agent_answers
  for each row execute function private.reject_row_mutation();

alter table public.application_agent_questions enable row level security;
alter table public.application_agent_answers enable row level security;
create policy application_agent_questions_candidate_select on public.application_agent_questions
for select to authenticated using (exists (
  select 1 from public.candidates as candidate
  where candidate.workspace_id = application_agent_questions.workspace_id
    and candidate.id = application_agent_questions.candidate_id
    and candidate.auth_user_id = (select auth.uid())
    and candidate.status in ('ONBOARDING','ACTIVE','PAUSED')
));
create policy application_agent_answers_candidate_select on public.application_agent_answers
for select to authenticated using (exists (
  select 1 from public.application_agent_questions as question
  where question.id = application_agent_answers.question_id
));
revoke all on public.application_agent_questions, public.application_agent_answers from public, anon, authenticated;
revoke all on public.application_agent_answers from service_role;
grant select on public.application_agent_questions, public.application_agent_answers to authenticated;
grant select, insert, update, delete on public.application_agent_questions to service_role;
-- Workers can read answers but cannot manufacture candidate replies.
grant select on public.application_agent_answers to service_role;

create function public.request_application_agent_questions(
  p_workspace_id uuid, p_candidate_id uuid, p_application_id uuid,
  p_revision_id uuid, p_fill_attempt_id uuid, p_computer_session_id uuid,
  p_questions jsonb
)
returns setof public.application_agent_questions
language plpgsql security invoker set search_path = '' as $$
declare
  v_question jsonb;
  v_option jsonb;
  v_fill public.application_fill_attempts%rowtype;
  v_session public.computer_sessions%rowtype;
  v_application public.applications%rowtype;
  v_existing public.application_agent_questions%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_candidate_id is null or p_application_id is null
     or p_revision_id is null or p_fill_attempt_id is null or p_computer_session_id is null
     or jsonb_typeof(p_questions) is distinct from 'array'
     or jsonb_array_length(p_questions) not between 0 and 24 then
    raise exception 'APPLICATION_AGENT_QUESTION_INPUT_INVALID' using errcode = '22023';
  end if;
  select * into strict v_application from public.applications
    where id = p_application_id and workspace_id = p_workspace_id and candidate_id = p_candidate_id for update;
  select * into strict v_fill from public.application_fill_attempts
    where id = p_fill_attempt_id and workspace_id = p_workspace_id and candidate_id = p_candidate_id
      and application_id = p_application_id and revision_id = p_revision_id for update;
  select * into strict v_session from public.computer_sessions
    where id = p_computer_session_id and fill_attempt_id = p_fill_attempt_id
      and workspace_id = p_workspace_id and candidate_id = p_candidate_id
      and application_id = p_application_id and revision_id = p_revision_id for update;
  if v_application.current_revision_id is distinct from p_revision_id
     or v_application.status not in ('EXECUTING','TAKEOVER')
     or v_fill.status not in ('STARTED','TAKEOVER')
     or v_fill.authority_scope <> 'FILL_ONLY_NO_SUBMIT'
     or v_fill.approval_action <> 'FILL_APPLICATION_ONCE'
     or v_session.state not in ('ACTIVE','PAUSED_FOR_REVIEW')
     or v_session.expires_at <= statement_timestamp()
     or exists (select 1 from public.application_attempts where application_id = p_application_id)
     or exists (select 1 from public.receipts where application_id = p_application_id) then
    raise exception 'APPLICATION_AGENT_QUESTION_STATE_INVALID' using errcode = '55000';
  end if;
  if (select count(distinct item ->> 'fingerprint') from jsonb_array_elements(p_questions) as item) <> jsonb_array_length(p_questions)
     or (select count(distinct item ->> 'fieldId') from jsonb_array_elements(p_questions) as item) <> jsonb_array_length(p_questions) then
    raise exception 'APPLICATION_AGENT_QUESTION_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_question in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_question) is distinct from 'object'
       or jsonb_typeof(v_question -> 'fieldId') is distinct from 'string'
       or char_length(btrim(v_question ->> 'fieldId')) not between 1 and 160
       or coalesce(v_question ->> 'fingerprint','') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_question -> 'label') is distinct from 'string'
       or char_length(btrim(v_question ->> 'label')) not between 1 and 1000
       or coalesce(v_question ->> 'kind','') not in ('TEXT','LONG_TEXT','SINGLE_SELECT','MULTI_SELECT','BOOLEAN')
       or jsonb_typeof(v_question -> 'required') is distinct from 'boolean'
       or coalesce(v_question ->> 'reasonCode','') not in ('MISSING_EXACT_ANSWER','SENSITIVE_REQUIRES_CANDIDATE','AMBIGUOUS_ANSWER')
       or jsonb_typeof(v_question -> 'options') is distinct from 'array' then
      raise exception 'APPLICATION_AGENT_QUESTION_INPUT_INVALID' using errcode = '22023';
    end if;
    if jsonb_array_length(v_question -> 'options') > 80
       or ((v_question ->> 'kind' in ('SINGLE_SELECT','MULTI_SELECT'))
           is distinct from (jsonb_array_length(v_question -> 'options') > 0)) then
      raise exception 'APPLICATION_AGENT_QUESTION_OPTIONS_INVALID' using errcode = '22023';
    end if;
    for v_option in select value from jsonb_array_elements(v_question -> 'options') loop
      if jsonb_typeof(v_option) is distinct from 'object'
         or jsonb_typeof(v_option -> 'value') is distinct from 'string'
         or jsonb_typeof(v_option -> 'label') is distinct from 'string'
         or char_length(btrim(v_option ->> 'value')) not between 1 and 500
         or char_length(btrim(v_option ->> 'label')) not between 1 and 500 then
        raise exception 'APPLICATION_AGENT_QUESTION_OPTIONS_INVALID' using errcode = '22023';
      end if;
    end loop;
    if (select count(distinct item ->> 'value') from jsonb_array_elements(v_question -> 'options') as item)
       <> jsonb_array_length(v_question -> 'options') then
      raise exception 'APPLICATION_AGENT_QUESTION_OPTIONS_INVALID' using errcode = '22023';
    end if;
    select * into v_existing from public.application_agent_questions
      where computer_session_id = p_computer_session_id and field_fingerprint = v_question ->> 'fingerprint' for update;
    if found then
      if v_existing.field_id <> v_question ->> 'fieldId' or v_existing.label <> v_question ->> 'label'
         or v_existing.control_type <> v_question ->> 'kind' or v_existing.options <> v_question -> 'options'
         or v_existing.required <> (v_question ->> 'required')::boolean
         or v_existing.reason_code <> v_question ->> 'reasonCode' then
        raise exception 'APPLICATION_AGENT_QUESTION_FINGERPRINT_CONFLICT' using errcode = 'PT409';
      end if;
      if v_existing.status = 'SUPERSEDED' then
        update public.application_agent_questions set status = 'OPEN' where id = v_existing.id;
      end if;
    else
      if (select count(*) from public.application_agent_questions where computer_session_id = p_computer_session_id) >= 96 then
        raise exception 'APPLICATION_AGENT_QUESTION_LIMIT_EXCEEDED' using errcode = '55000';
      end if;
      insert into public.application_agent_questions (
        workspace_id,candidate_id,application_id,revision_id,fill_attempt_id,computer_session_id,
        field_id,field_fingerprint,label,control_type,options,required,reason_code
      ) values (
        p_workspace_id,p_candidate_id,p_application_id,p_revision_id,p_fill_attempt_id,p_computer_session_id,
        v_question ->> 'fieldId',v_question ->> 'fingerprint',v_question ->> 'label',v_question ->> 'kind',
        v_question -> 'options',(v_question ->> 'required')::boolean,v_question ->> 'reasonCode'
      );
    end if;
  end loop;
  update public.application_agent_questions as question set status = 'SUPERSEDED'
    where question.computer_session_id = p_computer_session_id and question.status = 'OPEN'
      and not exists (select 1 from jsonb_array_elements(p_questions) as item where item ->> 'fingerprint' = question.field_fingerprint);
  return query select question.* from public.application_agent_questions as question
    where question.computer_session_id = p_computer_session_id
      and exists (select 1 from jsonb_array_elements(p_questions) as item where item ->> 'fingerprint' = question.field_fingerprint)
    order by question.created_at,question.id;
end;
$$;

create function private.save_application_agent_answers_and_resume(
  p_command_id uuid,p_application_id uuid,p_revision_id uuid,p_fill_attempt_id uuid,
  p_computer_session_id uuid,p_expected_aggregate_version bigint,p_answers jsonb
)
returns table (application_id uuid,resume_attempt_id uuid,aggregate_version bigint,replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_application public.applications%rowtype;
  v_existing public.command_dedup%rowtype;
  v_question public.application_agent_questions%rowtype;
  v_answer jsonb;
  v_value jsonb;
  v_hash text;
  v_canonical_answers jsonb;
  v_resume record;
  v_resume_command_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_command_id is null or p_application_id is null or p_revision_id is null or p_fill_attempt_id is null
     or p_computer_session_id is null or p_expected_aggregate_version is null or p_expected_aggregate_version <= 0
     or jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) not between 1 and 24 then
    raise exception 'APPLICATION_AGENT_ANSWER_INPUT_INVALID' using errcode = '22023';
  end if;
  select application.* into strict v_application from public.applications as application
    join public.candidates as candidate on candidate.id = application.candidate_id
      and candidate.workspace_id = application.workspace_id and candidate.auth_user_id = v_actor
      and candidate.status in ('ONBOARDING','ACTIVE')
    join public.workspace_memberships as membership on membership.workspace_id = application.workspace_id
      and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
    join public.workspaces as workspace on workspace.id = application.workspace_id and workspace.status = 'ACTIVE'
    where application.id = p_application_id
    for update of application for share of candidate,membership,workspace;
  select jsonb_agg(item order by item ->> 'questionId') into v_canonical_answers from jsonb_array_elements(p_answers) as item;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'application_id',p_application_id,'revision_id',p_revision_id,'fill_attempt_id',p_fill_attempt_id,
    'computer_session_id',p_computer_session_id,'expected_version',p_expected_aggregate_version,'answers',v_canonical_answers
  )::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_application.workspace_id::text || ':' || p_command_id::text,0));
  select * into v_existing from public.command_dedup
    where workspace_id = v_application.workspace_id and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'SAVE_APPLICATION_AGENT_ANSWERS'
       or v_existing.request_hash <> v_hash or v_existing.actor_id <> v_actor then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409'; end if;
    return query select v_application.id,(v_existing.result ->> 'resume_attempt_id')::uuid,
      (v_existing.result ->> 'aggregate_version')::bigint,true;
    return;
  end if;
  if v_application.status <> 'TAKEOVER' or v_application.current_revision_id is distinct from p_revision_id
     or v_application.aggregate_version <> p_expected_aggregate_version then
    raise exception 'APPLICATION_AGENT_ANSWERS_STALE' using errcode = 'PT409';
  end if;
  -- Lock the exact fill/session before answers. The existing resume command
  -- rechecks expiry, original fill authority, no submit records, and no queued resume.
  perform 1 from public.application_fill_attempts as fill where fill.id = p_fill_attempt_id
    and fill.application_id = p_application_id and fill.revision_id = p_revision_id
    and fill.workspace_id = v_application.workspace_id and fill.candidate_id = v_application.candidate_id for update;
  if not found then raise exception 'APPLICATION_AGENT_ANSWERS_STALE' using errcode = 'PT409'; end if;
  perform 1 from public.computer_sessions as session where session.id = p_computer_session_id and session.fill_attempt_id = p_fill_attempt_id
    and session.application_id = p_application_id and session.revision_id = p_revision_id for update;
  if not found then raise exception 'APPLICATION_AGENT_ANSWERS_STALE' using errcode = 'PT409'; end if;
  if (select count(*) from public.application_agent_questions as question
      where question.application_id = p_application_id and question.revision_id = p_revision_id
        and question.fill_attempt_id = p_fill_attempt_id and question.computer_session_id = p_computer_session_id
        and question.status = 'OPEN') <> jsonb_array_length(p_answers)
     or (select count(distinct item ->> 'questionId') from jsonb_array_elements(p_answers) as item) <> jsonb_array_length(p_answers) then
    raise exception 'APPLICATION_AGENT_ANSWERS_STALE' using errcode = 'PT409';
  end if;
  for v_answer in select value from jsonb_array_elements(v_canonical_answers) loop
    if jsonb_typeof(v_answer) is distinct from 'object'
       or coalesce(v_answer ->> 'questionId','') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(v_answer ->> 'fingerprint','') !~ '^[0-9a-f]{64}$'
       or coalesce(jsonb_typeof(v_answer -> 'value'),'') not in ('string','boolean','array') then
      raise exception 'APPLICATION_AGENT_ANSWER_INPUT_INVALID' using errcode = '22023';
    end if;
    select question.* into strict v_question from public.application_agent_questions as question
      where question.id = (v_answer ->> 'questionId')::uuid and question.workspace_id = v_application.workspace_id
        and question.candidate_id = v_application.candidate_id and question.application_id = p_application_id
        and question.revision_id = p_revision_id and question.fill_attempt_id = p_fill_attempt_id
        and question.computer_session_id = p_computer_session_id and question.status = 'OPEN'
        and question.field_fingerprint = v_answer ->> 'fingerprint' for update;
    v_value := v_answer -> 'value';
    if v_value is null or octet_length(v_value::text) > 40000 then
      raise exception 'APPLICATION_AGENT_ANSWER_INVALID' using errcode = '22023';
    end if;
    case v_question.control_type
      when 'TEXT','LONG_TEXT' then
        if jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') > 8000
           or (v_question.required and char_length(btrim(v_value #>> '{}')) = 0) then
          raise exception 'APPLICATION_AGENT_ANSWER_INVALID' using errcode = '22023';
        end if;
      when 'BOOLEAN' then
        if jsonb_typeof(v_value) <> 'boolean' then raise exception 'APPLICATION_AGENT_ANSWER_INVALID' using errcode = '22023'; end if;
      when 'SINGLE_SELECT' then
        if jsonb_typeof(v_value) <> 'string' or not exists (
          select 1 from jsonb_array_elements(v_question.options) as option where option -> 'value' = v_value
        ) then raise exception 'APPLICATION_AGENT_ANSWER_INVALID' using errcode = '22023'; end if;
      when 'MULTI_SELECT' then
        if jsonb_typeof(v_value) <> 'array' then raise exception 'APPLICATION_AGENT_ANSWER_INVALID' using errcode = '22023'; end if;
        if jsonb_array_length(v_value) > jsonb_array_length(v_question.options)
           or (v_question.required and jsonb_array_length(v_value) = 0)
           or (select count(distinct value) from jsonb_array_elements(v_value)) <> jsonb_array_length(v_value)
           or exists (select 1 from jsonb_array_elements(v_value) as selected
             where jsonb_typeof(selected) <> 'string' or not exists (
               select 1 from jsonb_array_elements(v_question.options) as option where option -> 'value' = selected
             )) then raise exception 'APPLICATION_AGENT_ANSWER_INVALID' using errcode = '22023'; end if;
      else raise exception 'APPLICATION_AGENT_ANSWER_INVALID' using errcode = '22023';
    end case;
    insert into public.application_agent_answers(question_id,value_json,answered_by,command_id)
      values (v_question.id,v_value,v_actor,p_command_id);
    update public.application_agent_questions set status = 'ANSWERED' where id = v_question.id;
  end loop;
  -- Same transaction: any stale/expired/unsafe continuation rolls back replies.
  select * into strict v_resume from public.request_application_fill_resume(
    v_resume_command_id,p_application_id,p_expected_aggregate_version,p_fill_attempt_id,p_computer_session_id,true
  );
  insert into public.command_dedup(workspace_id,command_id,actor_id,command_type,request_hash,status,
    aggregate_type,aggregate_id,result,completed_at)
  values (v_application.workspace_id,p_command_id,v_actor,'SAVE_APPLICATION_AGENT_ANSWERS',v_hash,'COMMITTED',
    'APPLICATION',p_application_id,jsonb_build_object('resume_attempt_id',v_resume.resume_attempt_id,
      'aggregate_version',v_resume.aggregate_version,'answer_count',jsonb_array_length(p_answers)),statement_timestamp());
  return query select p_application_id,v_resume.resume_attempt_id,v_resume.aggregate_version,false;
end;
$$;

create function public.save_application_agent_answers_and_resume(
  p_command_id uuid,p_application_id uuid,p_revision_id uuid,p_fill_attempt_id uuid,
  p_computer_session_id uuid,p_expected_aggregate_version bigint,p_answers jsonb
)
returns table (application_id uuid,resume_attempt_id uuid,aggregate_version bigint,replayed boolean)
language sql security invoker set search_path = '' as $$
  select * from private.save_application_agent_answers_and_resume(
    p_command_id,p_application_id,p_revision_id,p_fill_attempt_id,p_computer_session_id,p_expected_aggregate_version,p_answers
  );
$$;
revoke all on function public.request_application_agent_questions(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.request_application_agent_questions(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
revoke all on function private.save_application_agent_answers_and_resume(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,service_role;
revoke all on function public.save_application_agent_answers_and_resume(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function private.save_application_agent_answers_and_resume(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to authenticated;
grant execute on function public.save_application_agent_answers_and_resume(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to authenticated;
