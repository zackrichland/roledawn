-- RoleDawn / HireWire: candidate-owned search rules and a database-enforced
-- onboarding completion boundary. Search rules are preference data, not exact
-- employer-form answers, and direct mutation remains closed to the client.

create table public.candidate_search_profiles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  target_roles text[] not null,
  preferred_locations text[] not null default '{}'::text[],
  desired_country_codes text[] not null,
  work_modes text[] not null,
  employment_types text[] not null,
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, candidate_id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade,
  check (cardinality(target_roles) between 1 and 8),
  check (cardinality(preferred_locations) between 0 and 12),
  check (cardinality(desired_country_codes) between 1 and 2),
  check (cardinality(work_modes) between 1 and 3),
  check (cardinality(employment_types) between 1 and 5),
  check (char_length(array_to_string(target_roles, E'\n')) between 1 and 800),
  check (char_length(array_to_string(preferred_locations, E'\n')) <= 1200),
  check (desired_country_codes <@ array['US', 'CA']::text[]),
  check (work_modes <@ array['REMOTE', 'HYBRID', 'ONSITE']::text[]),
  check (employment_types <@ array['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY']::text[])
);

alter table public.candidate_search_profiles enable row level security;

create policy candidate_search_profiles_candidate_select
  on public.candidate_search_profiles for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_search_profiles.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

revoke all on public.candidate_search_profiles from public, anon, authenticated;
grant select on public.candidate_search_profiles to authenticated;
grant all on public.candidate_search_profiles to service_role;

create or replace function private.candidate_onboarding_missing_items(
  p_workspace_id uuid,
  p_candidate_id uuid
)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_missing text[] := '{}'::text[];
  v_countries text[];
begin
  if not exists (
    select 1
    from public.source_documents as document
    where document.workspace_id = p_workspace_id
      and document.candidate_id = p_candidate_id
      and document.document_kind = 'RESUME'
      and document.status = 'READY'
      and document.current_version_id is not null
  ) then
    v_missing := array_append(v_missing, 'RESUME');
  end if;

  if not exists (
    select 1 from public.candidate_facts as fact
    where fact.workspace_id = p_workspace_id
      and fact.candidate_id = p_candidate_id
      and fact.fact_key = 'identity.legal_name'
      and fact.verification_status = 'VERIFIED'
      and fact.current_version_number is not null
  ) then v_missing := array_append(v_missing, 'LEGAL_NAME'); end if;

  if not exists (
    select 1 from public.candidate_facts as fact
    where fact.workspace_id = p_workspace_id
      and fact.candidate_id = p_candidate_id
      and fact.fact_key = 'contact.application_email'
      and fact.verification_status = 'VERIFIED'
      and fact.current_version_number is not null
  ) then v_missing := array_append(v_missing, 'APPLICATION_EMAIL'); end if;

  if not exists (
    select 1 from public.candidate_facts as fact
    where fact.workspace_id = p_workspace_id
      and fact.candidate_id = p_candidate_id
      and fact.fact_key = 'contact.phone'
      and fact.verification_status = 'VERIFIED'
      and fact.current_version_number is not null
  ) then v_missing := array_append(v_missing, 'PHONE'); end if;

  if (
    select count(distinct fact.fact_key)
    from public.candidate_facts as fact
    where fact.workspace_id = p_workspace_id
      and fact.candidate_id = p_candidate_id
      and fact.fact_key in ('location.city', 'location.region', 'location.country_code')
      and fact.verification_status = 'VERIFIED'
      and fact.current_version_number is not null
  ) < 3 then
    v_missing := array_append(v_missing, 'LOCATION');
  end if;

  select profile.desired_country_codes into v_countries
  from public.candidate_search_profiles as profile
  where profile.workspace_id = p_workspace_id
    and profile.candidate_id = p_candidate_id;

  if v_countries is null then
    v_missing := array_append(v_missing, 'SEARCH_RULES');
  else
    if 'US' = any(v_countries) and (
      select count(distinct fact.fact_key)
      from public.candidate_facts as fact
      where fact.workspace_id = p_workspace_id
        and fact.candidate_id = p_candidate_id
        and fact.fact_key in (
          'work_authorization.us.authorized',
          'work_authorization.us.sponsorship_required'
        )
        and fact.verification_status = 'VERIFIED'
        and fact.current_version_number is not null
    ) < 2 then
      v_missing := array_append(v_missing, 'US_WORK_ELIGIBILITY');
    end if;
    if 'CA' = any(v_countries) and (
      select count(distinct fact.fact_key)
      from public.candidate_facts as fact
      where fact.workspace_id = p_workspace_id
        and fact.candidate_id = p_candidate_id
        and fact.fact_key in (
          'work_authorization.ca.authorized',
          'work_authorization.ca.sponsorship_required'
        )
        and fact.verification_status = 'VERIFIED'
        and fact.current_version_number is not null
    ) < 2 then
      v_missing := array_append(v_missing, 'CA_WORK_ELIGIBILITY');
    end if;
  end if;

  return v_missing;
end;
$$;

revoke all on function private.candidate_onboarding_missing_items(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.candidate_onboarding_missing_items(uuid, uuid)
  to service_role;

create or replace function public.save_candidate_search_profile(
  p_command_id uuid,
  p_target_roles text[],
  p_preferred_locations text[],
  p_desired_country_codes text[],
  p_work_modes text[],
  p_employment_types text[],
  p_expected_aggregate_version bigint default null
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
  v_candidate_count integer;
  v_existing public.command_dedup%rowtype;
  v_profile public.candidate_search_profiles%rowtype;
  v_request_hash text;
  v_new_version bigint;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_command_id is null
     or cardinality(p_target_roles) not between 1 and 8
     or cardinality(coalesce(p_preferred_locations, '{}'::text[])) not between 0 and 12
     or cardinality(p_desired_country_codes) not between 1 and 2
     or cardinality(p_work_modes) not between 1 and 3
     or cardinality(p_employment_types) not between 1 and 5
     or (p_expected_aggregate_version is not null and p_expected_aggregate_version < 1) then
    raise exception 'CANDIDATE_SEARCH_PROFILE_INPUT_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(
      p_target_roles || coalesce(p_preferred_locations, '{}'::text[])
    ) as value
    where value is null or value <> btrim(value)
      or char_length(value) not between 1 and 120
  ) or exists (
    select 1 from unnest(p_target_roles) as value
    group by lower(value) having count(*) > 1
  ) or exists (
    select 1 from unnest(coalesce(p_preferred_locations, '{}'::text[])) as value
    group by lower(value) having count(*) > 1
  ) or not (p_desired_country_codes <@ array['US', 'CA']::text[])
     or not (p_work_modes <@ array['REMOTE', 'HYBRID', 'ONSITE']::text[])
     or not (p_employment_types <@ array['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY']::text[])
     or cardinality(p_desired_country_codes) <> (
       select count(distinct value) from unnest(p_desired_country_codes) as value
     ) or cardinality(p_work_modes) <> (
       select count(distinct value) from unnest(p_work_modes) as value
     ) or cardinality(p_employment_types) <> (
       select count(distinct value) from unnest(p_employment_types) as value
     ) then
    raise exception 'CANDIDATE_SEARCH_PROFILE_INPUT_INVALID' using errcode = '22023';
  end if;

  select count(*) into v_candidate_count
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.kind = 'PERSONAL' and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED');
  if v_candidate_count = 0 then raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501'; end if;
  if v_candidate_count > 1 then raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000'; end if;

  select candidate.workspace_id, candidate.id into strict v_workspace, v_candidate
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.kind = 'PERSONAL' and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  limit 1;

  v_request_hash := encode(extensions.digest(convert_to(
    array_to_string(p_target_roles, E'\n') || E'\n--locations--\n' ||
    array_to_string(coalesce(p_preferred_locations, '{}'::text[]), E'\n') || E'\n--countries--\n' ||
    array_to_string(p_desired_country_codes, E'\n') || E'\n--modes--\n' ||
    array_to_string(p_work_modes, E'\n') || E'\n--types--\n' ||
    array_to_string(p_employment_types, E'\n') || E'\n--version--\n' ||
    coalesce(p_expected_aggregate_version::text, ''), 'utf8'
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':search-profile', 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));

  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'SAVE_CANDIDATE_SEARCH_PROFILE'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query select (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;

  select * into v_profile from public.candidate_search_profiles
  where workspace_id = v_workspace and candidate_id = v_candidate
  for update;
  if not found then
    if p_expected_aggregate_version is not null then
      raise exception 'CANDIDATE_SEARCH_PROFILE_VERSION_MISMATCH' using errcode = 'PT409';
    end if;
    v_new_version := 1;
  else
    if p_expected_aggregate_version is null
       or p_expected_aggregate_version <> v_profile.aggregate_version then
      raise exception 'CANDIDATE_SEARCH_PROFILE_VERSION_MISMATCH' using errcode = 'PT409';
    end if;
    v_new_version := v_profile.aggregate_version + 1;
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_workspace, p_command_id, v_actor, 'SAVE_CANDIDATE_SEARCH_PROFILE', v_request_hash, 'STARTED');

  insert into public.candidate_search_profiles
    (workspace_id, candidate_id, target_roles, preferred_locations,
     desired_country_codes, work_modes, employment_types, aggregate_version)
  values
    (v_workspace, v_candidate, p_target_roles, coalesce(p_preferred_locations, '{}'::text[]),
     p_desired_country_codes, p_work_modes, p_employment_types, v_new_version)
  on conflict (workspace_id, candidate_id) do update set
    target_roles = excluded.target_roles,
    preferred_locations = excluded.preferred_locations,
    desired_country_codes = excluded.desired_country_codes,
    work_modes = excluded.work_modes,
    employment_types = excluded.employment_types,
    aggregate_version = excluded.aggregate_version,
    updated_at = statement_timestamp();

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'CANDIDATE_SEARCH_PROFILE', v_candidate, v_new_version,
     'candidate_search_profile.saved', jsonb_build_object(
       'target_role_count', cardinality(p_target_roles),
       'preferred_location_count', cardinality(coalesce(p_preferred_locations, '{}'::text[])),
       'desired_country_codes', p_desired_country_codes,
       'work_modes', p_work_modes,
       'employment_types', p_employment_types
     ), 'CANDIDATE', v_actor, p_command_id);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_SEARCH_PROFILE', aggregate_id = v_candidate,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('aggregate_version', v_new_version),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select v_new_version, false;
end;
$$;

revoke all on function public.save_candidate_search_profile(
  uuid, text[], text[], text[], text[], text[], bigint
) from public, anon;
grant execute on function public.save_candidate_search_profile(
  uuid, text[], text[], text[], text[], text[], bigint
) to authenticated;

create or replace function public.get_candidate_onboarding_readiness()
returns table (candidate_status text, missing_items text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_status text;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select candidate.workspace_id, candidate.id, candidate.status
    into strict v_workspace, v_candidate, v_status
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.kind = 'PERSONAL' and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  limit 1;
  return query select v_status,
    private.candidate_onboarding_missing_items(v_workspace, v_candidate);
exception when no_data_found then
  raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501';
end;
$$;

revoke all on function public.get_candidate_onboarding_readiness()
  from public, anon;
grant execute on function public.get_candidate_onboarding_readiness()
  to authenticated;

create or replace function public.complete_candidate_onboarding(
  p_command_id uuid
)
returns table (candidate_status text, aggregate_version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate public.candidates%rowtype;
  v_existing public.command_dedup%rowtype;
  v_missing text[];
  v_request_hash text;
  v_new_version bigint;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_command_id is null then raise exception 'COMMAND_ID_REQUIRED' using errcode = '22023'; end if;

  select candidate.* into strict v_candidate
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.kind = 'PERSONAL' and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE')
  limit 1
  for update of candidate;
  v_workspace := v_candidate.workspace_id;
  v_request_hash := encode(extensions.digest(convert_to(
    v_candidate.id::text || E'\nCOMPLETE_ONBOARDING', 'utf8'
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'COMPLETE_CANDIDATE_ONBOARDING'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query select 'ACTIVE'::text,
      (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;

  if v_candidate.status = 'ACTIVE' then
    return query select 'ACTIVE'::text, v_candidate.aggregate_version, true;
    return;
  end if;

  v_missing := private.candidate_onboarding_missing_items(v_workspace, v_candidate.id);
  if cardinality(v_missing) > 0 then
    raise exception 'CANDIDATE_ONBOARDING_INCOMPLETE'
      using errcode = '55000', detail = array_to_string(v_missing, ',');
  end if;

  v_new_version := v_candidate.aggregate_version + 1;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_workspace, p_command_id, v_actor, 'COMPLETE_CANDIDATE_ONBOARDING', v_request_hash, 'STARTED');

  update public.candidates
  set status = 'ACTIVE', aggregate_version = v_new_version,
      updated_at = statement_timestamp()
  where workspace_id = v_workspace and id = v_candidate.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'CANDIDATE', v_candidate.id, v_new_version,
     'candidate.onboarding_completed', jsonb_build_object('status', 'ACTIVE'),
     'CANDIDATE', v_actor, p_command_id);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE', aggregate_id = v_candidate.id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('aggregate_version', v_new_version, 'status', 'ACTIVE'),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select 'ACTIVE'::text, v_new_version, false;
exception when no_data_found then
  raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501';
end;
$$;

revoke all on function public.complete_candidate_onboarding(uuid)
  from public, anon;
grant execute on function public.complete_candidate_onboarding(uuid)
  to authenticated;
