-- RoleDawn / HireWire: the candidate knowledge that makes applications worth
-- reading. Adds (1) reusable application answers that employer forms ask for
-- (address, salary expectation, start date, relocation, voluntary
-- self-identification with an explicit "decline" answer), (2) a structured
-- career profile and a voice profile as immutable versions, (3) a STAR story
-- bank built from an interview, (4) interview transcripts, (5) a background
-- request topic for career-profile extraction, and (6) one attested approval
-- for the passages of the candidate's own reviewed résumé.
--
-- None of these tables bumps the application input epoch, so adding a story or
-- editing voice never pauses auto-apply or invalidates prepared packets.
-- Models may propose stories and profiles; only the candidate may approve them.

-- ---------------------------------------------------------------------------
-- Shared helper: resolve the caller's single personal candidate.
-- ---------------------------------------------------------------------------
create or replace function private.actor_personal_candidate(p_actor uuid)
returns table (workspace_id uuid, candidate_id uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  select count(*) into v_count
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = p_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = p_actor
  where candidate.auth_user_id = p_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED');
  if v_count = 0 then raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501'; end if;
  if v_count > 1 then raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000'; end if;
  return query
  select candidate.workspace_id, candidate.id
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = p_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = p_actor
  where candidate.auth_user_id = p_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  limit 1;
end;
$$;
revoke all on function private.actor_personal_candidate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Reusable application answers.
-- ---------------------------------------------------------------------------
create or replace function private.candidate_answer_fact_sensitivity(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_key in (
      'contact.address_line1', 'contact.address_line2', 'location.postal_code',
      'identity.preferred_name', 'identity.pronouns', 'availability.start_date',
      'preferences.willing_to_relocate', 'application.heard_about',
      'education.highest_degree'
    ) then 'STANDARD'
    when p_key = 'compensation.expected_salary' then 'SENSITIVE'
    when p_key in (
      'self_id.gender', 'self_id.hispanic_latino', 'self_id.race_ethnicity',
      'self_id.veteran_status', 'self_id.disability_status'
    ) then 'PROTECTED'
    else null
  end
$$;
revoke all on function private.candidate_answer_fact_sensitivity(text) from public, anon, authenticated;

create or replace function public.save_candidate_answer_fact(
  p_command_id uuid,
  p_fact_key text,
  p_value_json jsonb,
  p_normalized_text text,
  p_expected_aggregate_version bigint default null
)
returns table (
  fact_id uuid,
  fact_version_id uuid,
  fact_version_number bigint,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_key text := lower(btrim(coalesce(p_fact_key, '')));
  v_text text := btrim(coalesce(p_normalized_text, ''));
  v_sensitivity text := private.candidate_answer_fact_sensitivity(lower(btrim(coalesce(p_fact_key, ''))));
  v_fact public.candidate_facts%rowtype;
  v_fact_version uuid := extensions.gen_random_uuid();
  v_version_number bigint;
  v_new_aggregate_version bigint;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or v_sensitivity is null then
    raise exception 'CANDIDATE_FACT_KEY_NOT_ALLOWED' using errcode = '22023';
  end if;
  if char_length(v_text) not between 1 and 200
     or v_text <> regexp_replace(v_text, '[[:space:]]+', ' ', 'g')
     or p_value_json is null
     or jsonb_typeof(p_value_json) <> 'string'
     or p_value_json #>> '{}' <> v_text
     or (p_expected_aggregate_version is not null and p_expected_aggregate_version < 1) then
    raise exception 'CANDIDATE_FACT_INPUT_INVALID' using errcode = '22023';
  end if;
  if (v_key = 'location.postal_code' and v_text !~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$')
     or (v_key in ('contact.address_line1', 'contact.address_line2') and char_length(v_text) > 160)
     or (v_key in ('identity.preferred_name') and char_length(v_text) > 80)
     or (v_key in ('identity.pronouns') and char_length(v_text) > 40)
     or (v_key = 'preferences.willing_to_relocate' and v_text not in ('Yes', 'No', 'Open to discussing'))
     or (v_key in ('compensation.expected_salary', 'availability.start_date',
                   'application.heard_about', 'education.highest_degree') and char_length(v_text) > 120)
     or (v_key like 'self_id.%' and char_length(v_text) > 160) then
    raise exception 'CANDIDATE_FACT_VALUE_INVALID' using errcode = '22023';
  end if;

  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;

  v_request_hash := encode(extensions.digest(convert_to(
    v_key || E'\n' || p_value_json::text || E'\n' || v_text || E'\n' ||
    v_sensitivity || E'\n' || 'EXACT_FIELDS' || E'\n' ||
    coalesce(p_expected_aggregate_version::text, ''),
    'utf8'
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':fact:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));

  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'SAVE_CANDIDATE_FACT'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED'
       or v_existing.result ->> 'fact_version_id' is null then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query
    select fact.id, version.id, version.version_number, fact.aggregate_version, true
    from public.candidate_facts as fact
    join public.candidate_fact_versions as version
      on version.workspace_id = fact.workspace_id
     and version.candidate_id = fact.candidate_id
     and version.fact_id = fact.id
    where fact.workspace_id = v_workspace
      and fact.id = (v_existing.result ->> 'fact_id')::uuid
      and version.id = (v_existing.result ->> 'fact_version_id')::uuid;
    return;
  end if;

  select fact.* into v_fact
  from public.candidate_facts as fact
  where fact.workspace_id = v_workspace
    and fact.candidate_id = v_candidate
    and fact.fact_key = v_key
  for update;

  if not found then
    if p_expected_aggregate_version is not null then
      raise exception 'CANDIDATE_FACT_VERSION_MISMATCH' using errcode = 'PT409';
    end if;
    insert into public.candidate_facts
      (workspace_id, candidate_id, fact_key, sensitivity, usage_policy,
       verification_status, current_version_number, aggregate_version)
    values
      (v_workspace, v_candidate, v_key, v_sensitivity, 'EXACT_FIELDS',
       'NEEDS_REVIEW', null, 1)
    returning * into v_fact;
  elsif p_expected_aggregate_version is null
     or v_fact.aggregate_version <> p_expected_aggregate_version then
    raise exception 'CANDIDATE_FACT_VERSION_MISMATCH' using errcode = 'PT409';
  end if;

  v_version_number := coalesce(v_fact.current_version_number, 0) + 1;
  v_new_aggregate_version := v_fact.aggregate_version + 1;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_workspace, p_command_id, v_actor, 'SAVE_CANDIDATE_FACT', v_request_hash, 'STARTED');

  insert into public.candidate_fact_versions
    (id, workspace_id, candidate_id, fact_id, version_number, value_json,
     normalized_text, candidate_disposition, created_by, review_kind,
     reviewed_at, reviewed_by)
  values
    (v_fact_version, v_workspace, v_candidate, v_fact.id, v_version_number,
     p_value_json, v_text, 'APPROVED', v_actor, 'CANDIDATE_ENTRY',
     statement_timestamp(), v_actor);

  update public.candidate_facts as fact
  set sensitivity = v_sensitivity,
      usage_policy = 'EXACT_FIELDS',
      verification_status = 'VERIFIED',
      current_version_number = v_version_number,
      aggregate_version = v_new_aggregate_version,
      updated_at = statement_timestamp()
  where fact.workspace_id = v_workspace and fact.id = v_fact.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'CANDIDATE_FACT', v_fact.id,
     v_new_aggregate_version, 'candidate_fact.reviewed',
     jsonb_build_object(
       'fact_key', v_key,
       'fact_version_id', v_fact_version,
       'fact_version_number', v_version_number,
       'sensitivity', v_sensitivity,
       'usage_policy', 'EXACT_FIELDS',
       'verification_status', 'VERIFIED',
       'review_kind', 'CANDIDATE_ENTRY'
     ), 'CANDIDATE', v_actor, p_command_id);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_FACT', aggregate_id = v_fact.id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object(
        'fact_id', v_fact.id,
        'fact_version_id', v_fact_version,
        'fact_version_number', v_version_number,
        'aggregate_version', v_new_aggregate_version
      ), completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select v_fact.id, v_fact_version, v_version_number, v_new_aggregate_version, false;
end;
$$;

revoke all on function public.save_candidate_answer_fact(uuid, text, jsonb, text, bigint) from public, anon;
grant execute on function public.save_candidate_answer_fact(uuid, text, jsonb, text, bigint) to authenticated, service_role;
comment on function public.save_candidate_answer_fact(uuid, text, jsonb, text, bigint) is
  'Appends a candidate-entered reusable application answer. Self-identification answers are explicit candidate choices, including an explicit decline; they are never inferred.';

-- Employer-form fills may disclose these answers only when a frozen revision
-- carries the candidate-approved version. Extend the existing disclosure
-- predicate in every command that builds a fill manifest.
do $patch$
declare
  v_old text := 'fact.sensitivity = ''SENSITIVE'' and fact.fact_key in (';
  v_new text := 'fact.sensitivity in (''SENSITIVE'', ''PROTECTED'') and (fact.fact_key like ''self_id.%'' or fact.fact_key = ''compensation.expected_salary'') or fact.sensitivity = ''SENSITIVE'' and fact.fact_key in (';
  v_function record;
  v_definition text;
  v_patched integer := 0;
begin
  for v_function in
    select procedure.oid::regprocedure as signature
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.prokind = 'f'
      and pg_get_functiondef(procedure.oid) like '%' || v_old || '%'
  loop
    v_definition := pg_get_functiondef(v_function.signature);
    execute replace(v_definition, v_old, v_new);
    v_patched := v_patched + 1;
  end loop;
  if v_patched = 0 then
    raise exception 'CANDIDATE_ANSWER_DISCLOSURE_PATCH_DRIFT';
  end if;
end;
$patch$;

-- ---------------------------------------------------------------------------
-- 2. Career profile and voice profile (immutable versions + aggregate).
-- ---------------------------------------------------------------------------
create table public.candidate_profile_documents (
  id uuid not null default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  kind text not null check (kind in ('CAREER_PROFILE', 'VOICE_PROFILE')),
  current_version_id uuid,
  current_version_number bigint not null default 0 check (current_version_number >= 0),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  extraction_status text not null default 'IDLE'
    check (extraction_status in ('IDLE', 'REQUESTED', 'FAILED')),
  extraction_error text check (extraction_error is null or char_length(extraction_error) between 1 and 120),
  extraction_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, candidate_id, kind),
  unique (id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);

create table public.candidate_profile_document_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  kind text not null check (kind in ('CAREER_PROFILE', 'VOICE_PROFILE')),
  version_number bigint not null check (version_number > 0),
  content jsonb not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_kind text not null check (source_kind in ('RESUME_EXTRACTION', 'INTERVIEW', 'CANDIDATE_EDIT')),
  source_text_review_id uuid,
  producer_release text check (producer_release is null or char_length(producer_release) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id, kind, version_number),
  unique (workspace_id, id),
  check (jsonb_typeof(content) = 'object' and (content ->> 'schemaVersion') = '1'),
  check (pg_column_size(content) <= 262144),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);
create index candidate_profile_document_versions_candidate_idx
  on public.candidate_profile_document_versions (workspace_id, candidate_id, kind, version_number desc);
create index candidate_profile_document_versions_review_idx
  on public.candidate_profile_document_versions (source_text_review_id)
  where source_text_review_id is not null;
create index candidate_profile_documents_candidate_idx
  on public.candidate_profile_documents (workspace_id, candidate_id);
create trigger candidate_profile_document_versions_immutable
  before update or delete on public.candidate_profile_document_versions
  for each row execute function private.reject_row_mutation();

-- ---------------------------------------------------------------------------
-- 3. Story bank.
-- ---------------------------------------------------------------------------
create table public.candidate_stories (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  current_version_number bigint not null default 1 check (current_version_number > 0),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);
create index candidate_stories_candidate_idx
  on public.candidate_stories (workspace_id, candidate_id, status, updated_at desc);

create table public.candidate_story_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  story_id uuid not null,
  version_number bigint not null check (version_number > 0),
  title text not null check (char_length(title) between 1 and 140),
  position_key text check (position_key is null or position_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  organization text check (organization is null or char_length(organization) between 1 and 160),
  role_title text check (role_title is null or char_length(role_title) between 1 and 160),
  period_label text check (period_label is null or char_length(period_label) between 1 and 60),
  situation text not null check (char_length(situation) between 1 and 1500),
  task text not null check (char_length(task) between 1 and 1000),
  action text not null check (char_length(action) between 1 and 2500),
  result text not null check (char_length(result) between 1 and 1500),
  metrics jsonb not null default '[]'::jsonb check (jsonb_typeof(metrics) = 'array' and jsonb_array_length(metrics) <= 12),
  themes text[] not null default '{}'::text[] check (cardinality(themes) <= 12),
  guardrails text check (guardrails is null or char_length(guardrails) between 1 and 800),
  story_text text not null check (char_length(story_text) between 1 and 6000),
  story_sha256 text not null check (story_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_disposition text not null check (candidate_disposition in ('PROPOSED', 'APPROVED', 'REJECTED')),
  usage_policy text not null check (usage_policy in ('RESUME_AND_COVER_LETTER', 'COVER_LETTER_ONLY', 'DO_NOT_USE')),
  source_kind text not null check (source_kind in ('INTERVIEW', 'CANDIDATE_ENTRY')),
  interview_session_id uuid,
  reviewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (story_id, version_number),
  unique (workspace_id, id),
  check (candidate_disposition <> 'APPROVED' or reviewed_at is not null),
  check (candidate_disposition <> 'REJECTED' or usage_policy = 'DO_NOT_USE'),
  foreign key (workspace_id, story_id)
    references public.candidate_stories(workspace_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);
create index candidate_story_versions_story_idx
  on public.candidate_story_versions (workspace_id, story_id, version_number desc);
create index candidate_story_versions_candidate_idx
  on public.candidate_story_versions (workspace_id, candidate_id);
create index candidate_story_versions_session_idx
  on public.candidate_story_versions (interview_session_id)
  where interview_session_id is not null;
create trigger candidate_story_versions_immutable
  before update or delete on public.candidate_story_versions
  for each row execute function private.reject_row_mutation();

-- ---------------------------------------------------------------------------
-- 4. Interview sessions and turns.
-- ---------------------------------------------------------------------------
create table public.candidate_interview_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'ABANDONED')),
  interviewer_release text not null check (char_length(interviewer_release) between 1 and 120),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 65536),
  turn_count integer not null default 0 check (turn_count between 0 and 400),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);
create index candidate_interview_sessions_candidate_idx
  on public.candidate_interview_sessions (workspace_id, candidate_id, created_at desc);
create unique index candidate_interview_sessions_one_active_idx
  on public.candidate_interview_sessions (workspace_id, candidate_id) where status = 'ACTIVE';

create table public.candidate_interview_turns (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  session_id uuid not null,
  sequence_number integer not null check (sequence_number > 0),
  speaker text not null check (speaker in ('INTERVIEWER', 'CANDIDATE')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now(),
  unique (session_id, sequence_number),
  foreign key (workspace_id, session_id)
    references public.candidate_interview_sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);
create index candidate_interview_turns_session_idx
  on public.candidate_interview_turns (workspace_id, session_id, sequence_number);
create index candidate_interview_turns_candidate_idx
  on public.candidate_interview_turns (workspace_id, candidate_id);
create trigger candidate_interview_turns_immutable
  before update or delete on public.candidate_interview_turns
  for each row execute function private.reject_row_mutation();

alter table public.candidate_story_versions
  add constraint candidate_story_versions_session_fk
  foreign key (workspace_id, interview_session_id)
  references public.candidate_interview_sessions(workspace_id, id) on delete set null (interview_session_id);

-- ---------------------------------------------------------------------------
-- Row-level security: candidates read their own rows; every write is an RPC.
-- ---------------------------------------------------------------------------
do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'candidate_profile_documents', 'candidate_profile_document_versions',
    'candidate_stories', 'candidate_story_versions',
    'candidate_interview_sessions', 'candidate_interview_turns'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format($policy$
      create policy %I on public.%I for select to authenticated
      using (
        workspace_id in (select private.authorized_workspace_ids())
        and candidate_id in (
          select candidate.id from public.candidates as candidate
          where candidate.auth_user_id = (select auth.uid())
            and candidate.workspace_id = %I.workspace_id
            and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
        )
      )$policy$, v_table || '_candidate_select', v_table, v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
  end loop;
end;
$rls$;

-- ---------------------------------------------------------------------------
-- Profile document commands.
-- ---------------------------------------------------------------------------
create or replace function private.append_candidate_profile_document(
  p_workspace uuid,
  p_candidate uuid,
  p_actor uuid,
  p_actor_kind text,
  p_command_id uuid,
  p_kind text,
  p_content jsonb,
  p_content_sha256 text,
  p_source_kind text,
  p_source_text_review_id uuid,
  p_producer_release text,
  p_expected_aggregate_version bigint
)
returns table (profile_version_id uuid, version_number bigint, aggregate_version bigint)
language plpgsql
set search_path = ''
as $$
declare
  v_document public.candidate_profile_documents%rowtype;
  v_version_id uuid := extensions.gen_random_uuid();
  v_version_number bigint;
  v_aggregate bigint;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if p_kind not in ('CAREER_PROFILE', 'VOICE_PROFILE')
     or p_source_kind not in ('RESUME_EXTRACTION', 'INTERVIEW', 'CANDIDATE_EDIT')
     or p_content is null or jsonb_typeof(p_content) <> 'object'
     or (p_content ->> 'schemaVersion') is distinct from '1'
     or p_content_sha256 !~ '^[0-9a-f]{64}$'
     or (p_producer_release is not null and char_length(p_producer_release) not between 1 and 120) then
    raise exception 'CANDIDATE_PROFILE_DOCUMENT_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.candidate_profile_documents (workspace_id, candidate_id, kind)
  values (p_workspace, p_candidate, p_kind)
  on conflict (workspace_id, candidate_id, kind) do nothing;

  select document.* into strict v_document
  from public.candidate_profile_documents as document
  where document.workspace_id = p_workspace and document.candidate_id = p_candidate
    and document.kind = p_kind
  for update;

  if p_expected_aggregate_version is not null
     and p_expected_aggregate_version <> v_document.aggregate_version then
    raise exception 'CANDIDATE_PROFILE_DOCUMENT_VERSION_MISMATCH' using errcode = 'PT409';
  end if;

  v_version_number := v_document.current_version_number + 1;
  v_aggregate := v_document.aggregate_version + 1;

  insert into public.candidate_profile_document_versions
    (id, workspace_id, candidate_id, kind, version_number, content, content_sha256,
     source_kind, source_text_review_id, producer_release, created_by)
  values
    (v_version_id, p_workspace, p_candidate, p_kind, v_version_number, p_content,
     p_content_sha256, p_source_kind, p_source_text_review_id, p_producer_release, p_actor);

  update public.candidate_profile_documents as document
  set current_version_id = v_version_id,
      current_version_number = v_version_number,
      aggregate_version = v_aggregate,
      extraction_status = case when p_source_kind = 'RESUME_EXTRACTION' then 'IDLE' else document.extraction_status end,
      extraction_error = case when p_source_kind = 'RESUME_EXTRACTION' then null else document.extraction_error end,
      updated_at = statement_timestamp()
  where document.workspace_id = p_workspace and document.candidate_id = p_candidate
    and document.kind = p_kind;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, p_workspace, 'CANDIDATE_PROFILE_DOCUMENT', v_document.id, v_aggregate,
     'candidate_profile_document.versioned',
     jsonb_build_object('kind', p_kind, 'version_id', v_version_id,
       'version_number', v_version_number, 'source_kind', p_source_kind),
     p_actor_kind, p_actor, p_command_id);

  return query select v_version_id, v_version_number, v_aggregate;
end;
$$;
revoke all on function private.append_candidate_profile_document(uuid, uuid, uuid, text, uuid, text, jsonb, text, text, uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function private.append_candidate_profile_document(uuid, uuid, uuid, text, uuid, text, jsonb, text, text, uuid, text, bigint)
  to service_role;

create or replace function public.save_candidate_profile_document(
  p_command_id uuid,
  p_kind text,
  p_content jsonb,
  p_content_sha256 text,
  p_expected_aggregate_version bigint default null
)
returns table (profile_version_id uuid, version_number bigint, aggregate_version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_result record;
begin
  if p_command_id is null then
    raise exception 'CANDIDATE_PROFILE_DOCUMENT_INPUT_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;

  v_request_hash := encode(extensions.digest(convert_to(
    coalesce(p_kind, '') || E'\n' || coalesce(p_content_sha256, '') || E'\n' ||
    coalesce(p_expected_aggregate_version::text, ''), 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':profile-document:' || coalesce(p_kind, ''), 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));

  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'SAVE_CANDIDATE_PROFILE_DOCUMENT'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select (v_existing.result ->> 'profile_version_id')::uuid,
      (v_existing.result ->> 'version_number')::bigint,
      (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'SAVE_CANDIDATE_PROFILE_DOCUMENT', v_request_hash, 'STARTED');

  select * into strict v_result from private.append_candidate_profile_document(
    v_workspace, v_candidate, v_actor, 'CANDIDATE', p_command_id, p_kind, p_content,
    p_content_sha256, 'CANDIDATE_EDIT', null, null, p_expected_aggregate_version);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_PROFILE_DOCUMENT', status = 'COMMITTED',
      result = jsonb_build_object('profile_version_id', v_result.profile_version_id,
        'version_number', v_result.version_number, 'aggregate_version', v_result.aggregate_version),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select v_result.profile_version_id, v_result.version_number, v_result.aggregate_version, false;
end;
$$;
revoke all on function public.save_candidate_profile_document(uuid, text, jsonb, text, bigint) from public, anon;
grant execute on function public.save_candidate_profile_document(uuid, text, jsonb, text, bigint) to authenticated, service_role;

-- The candidate asks for their reviewed résumé to be organized into a career
-- profile. A worker performs the model call and records the result below.
create or replace function public.request_candidate_career_profile(p_command_id uuid)
returns table (requested boolean, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_document public.candidate_profile_documents%rowtype;
  v_review uuid;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if p_command_id is null then
    raise exception 'CANDIDATE_PROFILE_REQUEST_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;

  select review.id into v_review
  from public.source_documents as document
  join public.source_document_text_reviews as review
    on review.workspace_id = document.workspace_id
   and review.document_id = document.id
  where document.workspace_id = v_workspace and document.candidate_id = v_candidate
    and document.document_kind = 'RESUME' and document.status = 'READY'
  order by review.review_version_number desc
  limit 1;
  if v_review is null then
    raise exception 'RESUME_REVIEW_REQUIRED' using errcode = '55000';
  end if;

  v_request_hash := encode(extensions.digest(convert_to(v_review::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':profile-document:CAREER_PROFILE', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'REQUEST_CANDIDATE_CAREER_PROFILE'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query select true, true;
    return;
  end if;

  insert into public.candidate_profile_documents (workspace_id, candidate_id, kind)
  values (v_workspace, v_candidate, 'CAREER_PROFILE')
  on conflict (workspace_id, candidate_id, kind) do nothing;
  select document.* into strict v_document
  from public.candidate_profile_documents as document
  where document.workspace_id = v_workspace and document.candidate_id = v_candidate
    and document.kind = 'CAREER_PROFILE'
  for update;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'REQUEST_CANDIDATE_CAREER_PROFILE', v_request_hash, 'STARTED');

  update public.candidate_profile_documents as document
  set extraction_status = 'REQUESTED', extraction_error = null,
      extraction_requested_at = statement_timestamp(),
      aggregate_version = document.aggregate_version + 1,
      updated_at = statement_timestamp()
  where document.id = v_document.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'CANDIDATE_PROFILE_DOCUMENT', v_document.id,
     v_document.aggregate_version + 1, 'candidate.career_profile_requested',
     jsonb_build_object('text_review_id', v_review), 'CANDIDATE', v_actor, p_command_id);
  insert into public.outbox (workspace_id, event_id, topic, payload)
  values (v_workspace, v_event_id, 'candidate.career_profile_requested',
    jsonb_build_object('workspace_id', v_workspace, 'candidate_id', v_candidate,
      'text_review_id', v_review, 'requested_by', v_actor));

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_PROFILE_DOCUMENT', aggregate_id = v_document.id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('requested', true), completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select true, false;
end;
$$;
revoke all on function public.request_candidate_career_profile(uuid) from public, anon;
grant execute on function public.request_candidate_career_profile(uuid) to authenticated, service_role;

-- Worker result: records the extracted profile only if the résumé review it
-- used is still the candidate's latest one. Never overwrites a candidate edit
-- made after the request.
create or replace function public.record_candidate_career_profile_extraction(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_text_review_id uuid,
  p_content jsonb,
  p_content_sha256 text,
  p_producer_release text,
  p_correlation_id uuid
)
returns table (profile_version_id uuid, recorded boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_latest uuid;
  v_document public.candidate_profile_documents%rowtype;
  v_result record;
begin
  if current_user <> 'service_role' and (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select review.id into v_latest
  from public.source_documents as document
  join public.source_document_text_reviews as review
    on review.workspace_id = document.workspace_id and review.document_id = document.id
  where document.workspace_id = p_workspace_id and document.candidate_id = p_candidate_id
    and document.document_kind = 'RESUME' and document.status = 'READY'
  order by review.review_version_number desc
  limit 1;
  select document.* into v_document
  from public.candidate_profile_documents as document
  where document.workspace_id = p_workspace_id and document.candidate_id = p_candidate_id
    and document.kind = 'CAREER_PROFILE'
  for update;
  if v_latest is distinct from p_text_review_id then
    return query select null::uuid, false;
    return;
  end if;
  if found and v_document.current_version_id is not null and exists (
    select 1 from public.candidate_profile_document_versions as version
    where version.id = v_document.current_version_id
      and version.source_kind = 'CANDIDATE_EDIT'
      and version.created_at > coalesce(v_document.extraction_requested_at, '-infinity'::timestamptz)
  ) then
    update public.candidate_profile_documents as document
    set extraction_status = 'IDLE', updated_at = statement_timestamp()
    where document.id = v_document.id;
    return query select null::uuid, false;
    return;
  end if;
  select * into strict v_result from private.append_candidate_profile_document(
    p_workspace_id, p_candidate_id, null, 'WORKER', p_correlation_id, 'CAREER_PROFILE',
    p_content, p_content_sha256, 'RESUME_EXTRACTION', p_text_review_id, p_producer_release, null);
  return query select v_result.profile_version_id, true;
end;
$$;
revoke all on function public.record_candidate_career_profile_extraction(uuid, uuid, uuid, jsonb, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_candidate_career_profile_extraction(uuid, uuid, uuid, jsonb, text, text, uuid)
  to service_role;

create or replace function public.fail_candidate_career_profile_extraction(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' and (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  update public.candidate_profile_documents as document
  set extraction_status = 'FAILED',
      extraction_error = left(coalesce(nullif(btrim(p_error_code), ''), 'EXTRACTION_FAILED'), 120),
      updated_at = statement_timestamp()
  where document.workspace_id = p_workspace_id and document.candidate_id = p_candidate_id
    and document.kind = 'CAREER_PROFILE';
  return found;
end;
$$;
revoke all on function public.fail_candidate_career_profile_extraction(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_candidate_career_profile_extraction(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Story commands.
-- ---------------------------------------------------------------------------
create or replace function public.save_candidate_story(
  p_command_id uuid,
  p_story_id uuid,
  p_expected_aggregate_version bigint,
  p_story jsonb,
  p_disposition text,
  p_usage_policy text,
  p_source_kind text default 'CANDIDATE_ENTRY',
  p_interview_session_id uuid default null
)
returns table (story_id uuid, story_version_id uuid, version_number bigint, aggregate_version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_story public.candidate_stories%rowtype;
  v_story_id uuid := coalesce(p_story_id, extensions.gen_random_uuid());
  v_version_id uuid := extensions.gen_random_uuid();
  v_version_number bigint;
  v_aggregate bigint;
  v_disposition text := upper(btrim(coalesce(p_disposition, '')));
  v_usage text := upper(btrim(coalesce(p_usage_policy, '')));
  v_source text := upper(btrim(coalesce(p_source_kind, '')));
  v_title text := btrim(coalesce(p_story ->> 'title', ''));
  v_situation text := btrim(coalesce(p_story ->> 'situation', ''));
  v_task text := btrim(coalesce(p_story ->> 'task', ''));
  v_action text := btrim(coalesce(p_story ->> 'action', ''));
  v_result_text text := btrim(coalesce(p_story ->> 'result', ''));
  v_story_text text := btrim(coalesce(p_story ->> 'storyText', ''));
  v_metrics jsonb := coalesce(p_story -> 'metrics', '[]'::jsonb);
  v_themes text[];
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if p_command_id is null or p_story is null or jsonb_typeof(p_story) <> 'object'
     or v_disposition not in ('PROPOSED', 'APPROVED', 'REJECTED')
     or v_usage not in ('RESUME_AND_COVER_LETTER', 'COVER_LETTER_ONLY', 'DO_NOT_USE')
     or v_source not in ('INTERVIEW', 'CANDIDATE_ENTRY')
     or (v_disposition = 'REJECTED' and v_usage <> 'DO_NOT_USE')
     or (p_story_id is null) <> (p_expected_aggregate_version is null)
     or jsonb_typeof(v_metrics) <> 'array'
     or (p_story ? 'themes' and jsonb_typeof(p_story -> 'themes') <> 'array') then
    raise exception 'CANDIDATE_STORY_INPUT_INVALID' using errcode = '22023';
  end if;
  select coalesce(array_agg(btrim(theme) order by ordinality), '{}'::text[]) into v_themes
  from jsonb_array_elements_text(coalesce(p_story -> 'themes', '[]'::jsonb)) with ordinality as themes(theme, ordinality)
  where btrim(theme) <> '';
  if exists (select 1 from unnest(v_themes) as theme where char_length(theme) > 40) then
    raise exception 'CANDIDATE_STORY_INPUT_INVALID' using errcode = '22023';
  end if;

  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;

  v_request_hash := encode(extensions.digest(convert_to(
    v_story_id::text || E'\n' || coalesce(p_expected_aggregate_version::text, '') || E'\n' ||
    p_story::text || E'\n' || v_disposition || E'\n' || v_usage || E'\n' || v_source || E'\n' ||
    coalesce(p_interview_session_id::text, ''), 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'SAVE_CANDIDATE_STORY'
       or (p_story_id is not null and v_existing.request_hash <> v_request_hash) then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select (v_existing.result ->> 'story_id')::uuid,
      (v_existing.result ->> 'story_version_id')::uuid,
      (v_existing.result ->> 'version_number')::bigint,
      (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;

  if p_interview_session_id is not null and not exists (
    select 1 from public.candidate_interview_sessions as session
    where session.workspace_id = v_workspace and session.candidate_id = v_candidate
      and session.id = p_interview_session_id
  ) then
    raise exception 'CANDIDATE_INTERVIEW_NOT_FOUND' using errcode = '23503';
  end if;

  if p_story_id is null then
    insert into public.candidate_stories (id, workspace_id, candidate_id)
    values (v_story_id, v_workspace, v_candidate)
    returning * into v_story;
    v_version_number := 1;
    v_aggregate := 1;
  else
    select story.* into v_story from public.candidate_stories as story
    where story.workspace_id = v_workspace and story.candidate_id = v_candidate
      and story.id = p_story_id
    for update;
    if not found then
      raise exception 'CANDIDATE_STORY_NOT_FOUND' using errcode = '23503';
    end if;
    if v_story.aggregate_version <> p_expected_aggregate_version then
      raise exception 'CANDIDATE_STORY_VERSION_MISMATCH' using errcode = 'PT409';
    end if;
    v_version_number := v_story.current_version_number + 1;
    v_aggregate := v_story.aggregate_version + 1;
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'SAVE_CANDIDATE_STORY', v_request_hash, 'STARTED');

  insert into public.candidate_story_versions
    (id, workspace_id, candidate_id, story_id, version_number, title, position_key,
     organization, role_title, period_label, situation, task, action, result, metrics,
     themes, guardrails, story_text, story_sha256, candidate_disposition, usage_policy,
     source_kind, interview_session_id, reviewed_at, created_by)
  values
    (v_version_id, v_workspace, v_candidate, v_story.id, v_version_number, v_title,
     nullif(btrim(coalesce(p_story ->> 'positionKey', '')), ''),
     nullif(btrim(coalesce(p_story ->> 'organization', '')), ''),
     nullif(btrim(coalesce(p_story ->> 'roleTitle', '')), ''),
     nullif(btrim(coalesce(p_story ->> 'periodLabel', '')), ''),
     v_situation, v_task, v_action, v_result_text, v_metrics, v_themes,
     nullif(btrim(coalesce(p_story ->> 'guardrails', '')), ''),
     v_story_text, encode(extensions.digest(convert_to(v_story_text, 'utf8'), 'sha256'), 'hex'),
     v_disposition, v_usage, v_source, p_interview_session_id,
     case when v_disposition = 'PROPOSED' then null else statement_timestamp() end, v_actor);

  update public.candidate_stories as story
  set current_version_number = v_version_number,
      aggregate_version = v_aggregate,
      status = 'ACTIVE',
      updated_at = statement_timestamp()
  where story.id = v_story.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'CANDIDATE_STORY', v_story.id, v_aggregate,
     'candidate_story.versioned',
     jsonb_build_object('story_version_id', v_version_id, 'version_number', v_version_number,
       'disposition', v_disposition, 'usage_policy', v_usage, 'source_kind', v_source),
     'CANDIDATE', v_actor, p_command_id);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_STORY', aggregate_id = v_story.id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('story_id', v_story.id, 'story_version_id', v_version_id,
        'version_number', v_version_number, 'aggregate_version', v_aggregate),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select v_story.id, v_version_id, v_version_number, v_aggregate, false;
end;
$$;
revoke all on function public.save_candidate_story(uuid, uuid, bigint, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.save_candidate_story(uuid, uuid, bigint, jsonb, text, text, text, uuid) to authenticated, service_role;

create or replace function public.archive_candidate_story(
  p_command_id uuid,
  p_story_id uuid,
  p_expected_aggregate_version bigint
)
returns table (aggregate_version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_story public.candidate_stories%rowtype;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if p_command_id is null or p_story_id is null or p_expected_aggregate_version is null then
    raise exception 'CANDIDATE_STORY_INPUT_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;
  v_request_hash := encode(extensions.digest(convert_to(
    p_story_id::text || E'\n' || p_expected_aggregate_version::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'ARCHIVE_CANDIDATE_STORY' or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query select (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;
  select story.* into v_story from public.candidate_stories as story
  where story.workspace_id = v_workspace and story.candidate_id = v_candidate and story.id = p_story_id
  for update;
  if not found then raise exception 'CANDIDATE_STORY_NOT_FOUND' using errcode = '23503'; end if;
  if v_story.aggregate_version <> p_expected_aggregate_version then
    raise exception 'CANDIDATE_STORY_VERSION_MISMATCH' using errcode = 'PT409';
  end if;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'ARCHIVE_CANDIDATE_STORY', v_request_hash, 'STARTED');
  update public.candidate_stories as story
  set status = 'ARCHIVED', aggregate_version = story.aggregate_version + 1, updated_at = statement_timestamp()
  where story.id = v_story.id;
  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values (v_event_id, v_workspace, 'CANDIDATE_STORY', v_story.id, v_story.aggregate_version + 1,
    'candidate_story.archived', '{}'::jsonb, 'CANDIDATE', v_actor, p_command_id);
  update public.command_dedup
  set aggregate_type = 'CANDIDATE_STORY', aggregate_id = v_story.id, status = 'COMMITTED',
      result_event_id = v_event_id,
      result = jsonb_build_object('aggregate_version', v_story.aggregate_version + 1),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;
  return query select v_story.aggregate_version + 1, false;
end;
$$;
revoke all on function public.archive_candidate_story(uuid, uuid, bigint) from public, anon;
grant execute on function public.archive_candidate_story(uuid, uuid, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Interview commands. The server supplies the interviewer's reply; the
-- candidate's own words are appended verbatim in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function public.start_candidate_interview(
  p_command_id uuid,
  p_interviewer_release text,
  p_opening text,
  p_state jsonb default '{}'::jsonb
)
returns table (session_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_session uuid := extensions.gen_random_uuid();
  v_existing public.command_dedup%rowtype;
  v_request_hash text;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if p_command_id is null or char_length(btrim(coalesce(p_interviewer_release, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_opening, ''))) not between 1 and 8000
     or p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'CANDIDATE_INTERVIEW_INPUT_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;
  v_request_hash := encode(extensions.digest(convert_to(
    btrim(p_interviewer_release) || E'\n' || btrim(p_opening), 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':interview', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'START_CANDIDATE_INTERVIEW' then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query select (v_existing.result ->> 'session_id')::uuid, true;
    return;
  end if;
  update public.candidate_interview_sessions as session
  set status = 'ABANDONED', aggregate_version = session.aggregate_version + 1, updated_at = statement_timestamp()
  where session.workspace_id = v_workspace and session.candidate_id = v_candidate and session.status = 'ACTIVE';

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'START_CANDIDATE_INTERVIEW', v_request_hash, 'STARTED');
  insert into public.candidate_interview_sessions
    (id, workspace_id, candidate_id, interviewer_release, state, turn_count)
  values (v_session, v_workspace, v_candidate, btrim(p_interviewer_release), p_state, 1);
  insert into public.candidate_interview_turns
    (workspace_id, candidate_id, session_id, sequence_number, speaker, content)
  values (v_workspace, v_candidate, v_session, 1, 'INTERVIEWER', btrim(p_opening));
  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values (v_event_id, v_workspace, 'CANDIDATE_INTERVIEW', v_session, 1,
    'candidate_interview.started', jsonb_build_object('interviewer_release', btrim(p_interviewer_release)),
    'CANDIDATE', v_actor, p_command_id);
  update public.command_dedup
  set aggregate_type = 'CANDIDATE_INTERVIEW', aggregate_id = v_session, status = 'COMMITTED',
      result_event_id = v_event_id, result = jsonb_build_object('session_id', v_session),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;
  return query select v_session, false;
end;
$$;
revoke all on function public.start_candidate_interview(uuid, text, text, jsonb) from public, anon;
grant execute on function public.start_candidate_interview(uuid, text, text, jsonb) to authenticated, service_role;

create or replace function public.append_candidate_interview_exchange(
  p_command_id uuid,
  p_session_id uuid,
  p_expected_turn_count integer,
  p_candidate_message text,
  p_interviewer_reply text,
  p_state jsonb,
  p_complete boolean default false
)
returns table (turn_count integer, status text, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_session public.candidate_interview_sessions%rowtype;
  v_existing public.command_dedup%rowtype;
  v_request_hash text;
  v_message text := btrim(coalesce(p_candidate_message, ''));
  v_reply text := btrim(coalesce(p_interviewer_reply, ''));
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if p_command_id is null or p_session_id is null or p_expected_turn_count is null
     or char_length(v_message) not between 1 and 8000
     or char_length(v_reply) not between 1 and 8000
     or p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'CANDIDATE_INTERVIEW_INPUT_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;
  v_request_hash := encode(extensions.digest(convert_to(
    p_session_id::text || E'\n' || p_expected_turn_count::text || E'\n' || v_message, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'APPEND_CANDIDATE_INTERVIEW_EXCHANGE' or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query select (v_existing.result ->> 'turn_count')::integer, v_existing.result ->> 'status', true;
    return;
  end if;
  select session.* into v_session from public.candidate_interview_sessions as session
  where session.workspace_id = v_workspace and session.candidate_id = v_candidate and session.id = p_session_id
  for update;
  if not found then raise exception 'CANDIDATE_INTERVIEW_NOT_FOUND' using errcode = '23503'; end if;
  if v_session.status <> 'ACTIVE' then raise exception 'CANDIDATE_INTERVIEW_CLOSED' using errcode = '55000'; end if;
  if v_session.turn_count <> p_expected_turn_count then
    raise exception 'CANDIDATE_INTERVIEW_VERSION_MISMATCH' using errcode = 'PT409';
  end if;
  if v_session.turn_count + 2 > 400 then
    raise exception 'CANDIDATE_INTERVIEW_TOO_LONG' using errcode = '54000';
  end if;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'APPEND_CANDIDATE_INTERVIEW_EXCHANGE', v_request_hash, 'STARTED');
  insert into public.candidate_interview_turns
    (workspace_id, candidate_id, session_id, sequence_number, speaker, content)
  values
    (v_workspace, v_candidate, v_session.id, v_session.turn_count + 1, 'CANDIDATE', v_message),
    (v_workspace, v_candidate, v_session.id, v_session.turn_count + 2, 'INTERVIEWER', v_reply);
  update public.candidate_interview_sessions as session
  set turn_count = v_session.turn_count + 2,
      state = p_state,
      status = case when coalesce(p_complete, false) then 'COMPLETED' else 'ACTIVE' end,
      completed_at = case when coalesce(p_complete, false) then statement_timestamp() else null end,
      aggregate_version = session.aggregate_version + 1,
      updated_at = statement_timestamp()
  where session.id = v_session.id;
  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values (v_event_id, v_workspace, 'CANDIDATE_INTERVIEW', v_session.id, v_session.aggregate_version + 1,
    case when coalesce(p_complete, false) then 'candidate_interview.completed' else 'candidate_interview.advanced' end,
    jsonb_build_object('turn_count', v_session.turn_count + 2), 'CANDIDATE', v_actor, p_command_id);
  update public.command_dedup
  set aggregate_type = 'CANDIDATE_INTERVIEW', aggregate_id = v_session.id, status = 'COMMITTED',
      result_event_id = v_event_id,
      result = jsonb_build_object('turn_count', v_session.turn_count + 2,
        'status', case when coalesce(p_complete, false) then 'COMPLETED' else 'ACTIVE' end),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;
  return query select v_session.turn_count + 2,
    case when coalesce(p_complete, false) then 'COMPLETED' else 'ACTIVE' end, false;
end;
$$;
revoke all on function public.append_candidate_interview_exchange(uuid, uuid, integer, text, text, jsonb, boolean) from public, anon;
grant execute on function public.append_candidate_interview_exchange(uuid, uuid, integer, text, text, jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. One attestation for the candidate's own reviewed résumé. Approves every
-- still-proposed passage of the latest review as an exact passage, while
-- carrying forward earlier candidate decisions for identical passages.
-- ---------------------------------------------------------------------------
create or replace function public.approve_reviewed_resume_evidence(
  p_command_id uuid,
  p_text_review_id uuid
)
returns table (approved_count integer, carried_count integer, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_review public.source_document_text_reviews%rowtype;
  v_item record;
  v_prior record;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_version_id uuid;
  v_event_id uuid;
  v_claim text;
  v_usage text;
  v_disposition text;
  v_kind text;
  v_attested boolean;
  v_approved integer := 0;
  v_carried integer := 0;
begin
  if p_command_id is null or p_text_review_id is null then
    raise exception 'EVIDENCE_REVIEW_INPUT_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;

  select review.* into v_review
  from public.source_document_text_reviews as review
  join public.source_documents as document
    on document.workspace_id = review.workspace_id and document.id = review.document_id
   and document.status = 'READY' and document.document_kind = 'RESUME'
  where review.workspace_id = v_workspace and review.candidate_id = v_candidate
    and review.id = p_text_review_id
    and not exists (
      select 1 from public.source_document_text_reviews as newer
      where newer.document_id = review.document_id
        and newer.review_version_number > review.review_version_number
    );
  if not found then
    raise exception 'EVIDENCE_REVIEW_STALE' using errcode = 'PT409';
  end if;

  v_request_hash := encode(extensions.digest(convert_to(p_text_review_id::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'APPROVE_REVIEWED_RESUME_EVIDENCE' or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query select (v_existing.result ->> 'approved_count')::integer,
      (v_existing.result ->> 'carried_count')::integer, true;
    return;
  end if;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'APPROVE_REVIEWED_RESUME_EVIDENCE', v_request_hash, 'STARTED');

  for v_item in
    select item.*, passage.excerpt, passage.id as passage_id
    from public.candidate_evidence_items as item
    join public.source_evidence_passages as passage on passage.id = item.primary_source_passage_id
    where item.workspace_id = v_workspace and item.candidate_id = v_candidate
      and item.text_review_id = p_text_review_id
      and item.review_status = 'NEEDS_REVIEW'
    order by item.created_at, item.id
    for update of item
  loop
    -- Carry forward the candidate's latest decision on an identical passage
    -- from an older review of the same résumé.
    select version.claim_text, version.usage_policy, version.candidate_disposition,
           version.review_kind, version.candidate_attested
      into v_prior
    from public.candidate_evidence_items as older
    join public.source_evidence_passages as older_passage on older_passage.id = older.primary_source_passage_id
    join public.candidate_evidence_versions as version
      on version.evidence_item_id = older.id and version.version_number = older.current_version_number
    where older.workspace_id = v_workspace and older.candidate_id = v_candidate
      and older.document_id = v_item.document_id
      and older.id <> v_item.id
      and older.text_review_id <> p_text_review_id
      and older.review_status in ('VERIFIED', 'REJECTED')
      and older_passage.excerpt = v_item.excerpt
      and version.candidate_disposition in ('APPROVED', 'REJECTED')
    order by version.created_at desc
    limit 1;

    if found then
      v_claim := v_prior.claim_text;
      v_usage := v_prior.usage_policy;
      v_disposition := v_prior.candidate_disposition;
      v_kind := case when v_prior.claim_text = v_item.excerpt then 'EXACT_PASSAGE' else 'CANDIDATE_EDIT' end;
      v_attested := v_kind = 'CANDIDATE_EDIT' and coalesce(v_prior.candidate_attested, false);
      if v_kind = 'CANDIDATE_EDIT' and not v_attested then
        v_claim := v_item.excerpt; v_kind := 'EXACT_PASSAGE';
      end if;
      v_carried := v_carried + 1;
    else
      v_claim := v_item.excerpt;
      v_usage := 'RESUME_AND_COVER_LETTER';
      v_disposition := 'APPROVED';
      v_kind := 'EXACT_PASSAGE';
      v_attested := false;
    end if;

    v_version_id := extensions.gen_random_uuid();
    v_event_id := extensions.gen_random_uuid();
    insert into public.candidate_evidence_versions
      (id, workspace_id, candidate_id, document_id, evidence_item_id,
       version_number, claim_text, claim_sha256, usage_policy,
       candidate_disposition, review_kind, candidate_attested,
       reviewed_at, reviewed_by, created_by)
    values
      (v_version_id, v_workspace, v_candidate, v_item.document_id, v_item.id,
       coalesce(v_item.current_version_number, 0) + 1, v_claim,
       encode(extensions.digest(convert_to(v_claim, 'utf8'), 'sha256'), 'hex'),
       v_usage, v_disposition, v_kind, v_attested,
       statement_timestamp(), v_actor, v_actor);
    insert into public.candidate_evidence_citations
      (workspace_id, candidate_id, document_id, evidence_version_id, passage_id)
    values (v_workspace, v_candidate, v_item.document_id, v_version_id, v_item.passage_id);
    update public.candidate_evidence_items as item
    set review_status = case when v_disposition = 'APPROVED' then 'VERIFIED' else 'REJECTED' end,
        current_version_number = coalesce(v_item.current_version_number, 0) + 1,
        aggregate_version = v_item.aggregate_version + 1,
        updated_at = statement_timestamp()
    where item.id = v_item.id;
    insert into public.domain_events
      (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
       event_type, payload, actor_kind, actor_id, correlation_id)
    values
      (v_event_id, v_workspace, 'CANDIDATE_EVIDENCE', v_item.id, v_item.aggregate_version + 1,
       case when v_disposition = 'APPROVED' then 'candidate_evidence.verified' else 'candidate_evidence.rejected' end,
       jsonb_build_object('evidence_version_id', v_version_id, 'usage_policy', v_usage,
         'review_kind', v_kind, 'bulk_resume_attestation', true),
       'CANDIDATE', v_actor, p_command_id);
    if v_disposition = 'APPROVED' then v_approved := v_approved + 1; end if;
  end loop;

  update public.command_dedup
  set aggregate_type = 'SOURCE_DOCUMENT_TEXT_REVIEW', aggregate_id = p_text_review_id,
      status = 'COMMITTED',
      result = jsonb_build_object('approved_count', v_approved, 'carried_count', v_carried),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;
  return query select v_approved, v_carried, false;
end;
$$;
revoke all on function public.approve_reviewed_resume_evidence(uuid, uuid) from public, anon;
grant execute on function public.approve_reviewed_resume_evidence(uuid, uuid) to authenticated, service_role;
comment on function public.approve_reviewed_resume_evidence(uuid, uuid) is
  'One candidate attestation that the passages of their own latest reviewed résumé may be used, carrying forward earlier decisions on identical passages.';

-- ---------------------------------------------------------------------------
-- 5. Wake the preparation lane for career-profile extraction requests.
-- ---------------------------------------------------------------------------
do $lanes$
declare
  v_signature regprocedure := 'public.hosted_worker_due_lanes()'::regprocedure;
  v_definition text := pg_get_functiondef(v_signature);
  v_old text := 'o.topic in (''application.queued'',''application.job_resolved'',''application.preparation_requested'')';
  v_new text := 'o.topic in (''application.queued'',''application.job_resolved'',''application.preparation_requested'',''candidate.career_profile_requested'')';
begin
  if position(v_old in v_definition) = 0 then
    raise exception 'HOSTED_WORKER_DUE_LANES_PATCH_DRIFT';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$lanes$;
