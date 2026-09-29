-- RoleDawn / HireWire: candidate-reviewed profile facts and reusable
-- application answers. The browser never writes the evidence tables directly;
-- this command derives the candidate and workspace from auth.uid(), appends one
-- immutable version, and records the candidate decision atomically.

alter table public.candidate_fact_versions
  add column if not exists review_kind text
    check (review_kind in ('CANDIDATE_ENTRY', 'RESUME_EVIDENCE')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete restrict;

alter table public.candidate_fact_versions
  add constraint candidate_fact_versions_review_fields_check
  check (
    (review_kind is null and reviewed_at is null and reviewed_by is null)
    or (review_kind is not null and candidate_disposition = 'APPROVED'
      and reviewed_at is not null and reviewed_by is not null)
  );

alter table public.candidate_facts
  add constraint candidate_facts_current_version_fkey
  foreign key (id, current_version_number)
  references public.candidate_fact_versions(fact_id, version_number)
  deferrable initially deferred;

drop policy if exists candidate_facts_member_select on public.candidate_facts;
create policy candidate_facts_candidate_select
  on public.candidate_facts for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_facts.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

drop policy if exists candidate_fact_versions_member_select on public.candidate_fact_versions;
create policy candidate_fact_versions_candidate_select
  on public.candidate_fact_versions for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_fact_versions.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

drop policy if exists fact_sources_member_select on public.fact_sources;
create policy fact_sources_candidate_select
  on public.fact_sources for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = fact_sources.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create or replace function public.save_candidate_fact(
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
  v_candidate_count integer;
  v_key text := lower(btrim(coalesce(p_fact_key, '')));
  v_text text := btrim(coalesce(p_normalized_text, ''));
  v_fact public.candidate_facts%rowtype;
  v_fact_version uuid := extensions.gen_random_uuid();
  v_version_number bigint;
  v_new_aggregate_version bigint;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_review_kind text;
  v_sensitivity text;
  v_usage_policy text;
  v_verification_status text;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null
     or v_key !~ '^[a-z][a-z0-9_.]{1,79}$'
     or char_length(v_text) not between 1 and 4000
     or p_value_json is null
     or (p_expected_aggregate_version is not null and p_expected_aggregate_version < 1) then
    raise exception 'CANDIDATE_FACT_INPUT_INVALID' using errcode = '22023';
  end if;

  if v_key not in (
    'identity.legal_name',
    'contact.application_email',
    'contact.phone',
    'contact.linkedin_url',
    'contact.website_url',
    'location.city',
    'location.region',
    'location.country_code',
    'work_authorization.us.authorized',
    'work_authorization.us.sponsorship_required',
    'work_authorization.ca.authorized',
    'work_authorization.ca.sponsorship_required'
  ) then
    raise exception 'CANDIDATE_FACT_KEY_NOT_ALLOWED' using errcode = '22023';
  end if;

  v_usage_policy := 'EXACT_FIELDS';
  if v_key in (
    'work_authorization.us.authorized',
    'work_authorization.us.sponsorship_required',
    'work_authorization.ca.authorized',
    'work_authorization.ca.sponsorship_required'
  ) then
    v_sensitivity := 'SENSITIVE';
    if not (
      jsonb_typeof(p_value_json) = 'boolean'
      or p_value_json = '"unsure"'::jsonb
    ) then
      raise exception 'CANDIDATE_FACT_VALUE_TYPE_INVALID' using errcode = '22023';
    end if;
    if (p_value_json = 'true'::jsonb and v_text <> 'Yes')
       or (p_value_json = 'false'::jsonb and v_text <> 'No')
       or (p_value_json = '"unsure"'::jsonb and v_text <> 'I''m not sure') then
      raise exception 'CANDIDATE_FACT_NORMALIZATION_INVALID' using errcode = '22023';
    end if;
    v_verification_status := case
      when p_value_json = '"unsure"'::jsonb then 'NEEDS_REVIEW'
      else 'VERIFIED'
    end;
  else
    v_sensitivity := 'STANDARD';
    v_verification_status := 'VERIFIED';
    if jsonb_typeof(p_value_json) <> 'string'
       or p_value_json #>> '{}' <> v_text then
      raise exception 'CANDIDATE_FACT_VALUE_TYPE_INVALID' using errcode = '22023';
    end if;
    if v_key = 'location.country_code' and v_text not in ('US', 'CA') then
      raise exception 'CANDIDATE_FACT_COUNTRY_INVALID' using errcode = '22023';
    end if;
    if v_key = 'identity.legal_name'
       and (char_length(v_text) > 160 or v_text <> regexp_replace(v_text, '[[:space:]]+', ' ', 'g')) then
      raise exception 'CANDIDATE_FACT_NAME_INVALID' using errcode = '22023';
    end if;
    if v_key = 'contact.application_email'
       and (char_length(v_text) > 254 or v_text <> lower(v_text)
         or v_text !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
      raise exception 'CANDIDATE_FACT_EMAIL_INVALID' using errcode = '22023';
    end if;
    if v_key = 'contact.phone'
       and v_text !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'CANDIDATE_FACT_PHONE_INVALID' using errcode = '22023';
    end if;
    if v_key = 'contact.linkedin_url'
       and (char_length(v_text) > 2048
         or v_text !~ '^https://([A-Za-z0-9-]+[.])*linkedin[.]com/in/[^?#[:space:]]+/?$') then
      raise exception 'CANDIDATE_FACT_LINKEDIN_INVALID' using errcode = '22023';
    end if;
    if v_key = 'contact.website_url'
       and (char_length(v_text) > 2048
         or v_text !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^#[:space:]]*)?([?][^#[:space:]]*)?$'
         or lower(v_text) ~ '^https://localhost([/:]|$)'
         or lower(v_text) ~ '^https://[^/]+\.local([/:]|$)'
         or v_text ~ '^https://([0-9]{1,3}[.]){3}[0-9]{1,3}([/:]|$)') then
      raise exception 'CANDIDATE_FACT_URL_INVALID' using errcode = '22023';
    end if;
    if v_key in ('location.city', 'location.region')
       and (char_length(v_text) > 120 or v_text <> regexp_replace(v_text, '[[:space:]]+', ' ', 'g')) then
      raise exception 'CANDIDATE_FACT_LOCATION_INVALID' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_candidate_count
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.status = 'ACTIVE'
   and workspace.kind = 'PERSONAL'
   and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED');

  if v_candidate_count = 0 then
    raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501';
  end if;
  if v_candidate_count > 1 then
    raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000';
  end if;

  select candidate.workspace_id, candidate.id
    into strict v_workspace, v_candidate
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.status = 'ACTIVE'
   and workspace.kind = 'PERSONAL'
   and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  limit 1;

  v_review_kind := 'CANDIDATE_ENTRY';
  v_request_hash := encode(extensions.digest(convert_to(
    v_key || E'\n' || p_value_json::text || E'\n' || v_text || E'\n' ||
    v_sensitivity || E'\n' || v_usage_policy || E'\n' ||
    coalesce(p_expected_aggregate_version::text, ''),
    'utf8'
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':fact:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;

  if found then
    if v_existing.command_type <> 'SAVE_CANDIDATE_FACT'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED'
       or v_existing.result ->> 'fact_version_id' is null then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
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
      raise exception 'CANDIDATE_FACT_VERSION_MISMATCH' using errcode = '40001';
    end if;
    insert into public.candidate_facts
      (workspace_id, candidate_id, fact_key, sensitivity, usage_policy,
       verification_status, current_version_number, aggregate_version)
    values
      (v_workspace, v_candidate, v_key, v_sensitivity, v_usage_policy,
       'NEEDS_REVIEW', null, 1)
    returning * into v_fact;
  elsif p_expected_aggregate_version is null
     or v_fact.aggregate_version <> p_expected_aggregate_version then
    raise exception 'CANDIDATE_FACT_VERSION_MISMATCH' using errcode = '40001';
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
     p_value_json, v_text, 'APPROVED', v_actor, v_review_kind,
     statement_timestamp(), v_actor);

  update public.candidate_facts as fact
  set sensitivity = v_sensitivity,
      usage_policy = v_usage_policy,
      verification_status = v_verification_status,
      current_version_number = v_version_number,
      aggregate_version = v_new_aggregate_version,
      updated_at = statement_timestamp()
  where fact.workspace_id = v_workspace and fact.id = v_fact.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'CANDIDATE_FACT', v_fact.id,
     v_new_aggregate_version,
     case when v_verification_status = 'VERIFIED'
       then 'candidate_fact.reviewed'
       else 'candidate_fact.unresolved'
     end,
     jsonb_build_object(
       'fact_key', v_key,
       'fact_version_id', v_fact_version,
       'fact_version_number', v_version_number,
       'sensitivity', v_sensitivity,
       'usage_policy', v_usage_policy,
       'verification_status', v_verification_status,
       'review_kind', v_review_kind
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

  return query
  select v_fact.id, v_fact_version, v_version_number,
    v_new_aggregate_version, false;
end;
$$;

revoke all on function public.save_candidate_fact(
  uuid, text, jsonb, text, bigint
) from public, anon;
grant execute on function public.save_candidate_fact(
  uuid, text, jsonb, text, bigint
) to authenticated, service_role;

comment on function public.save_candidate_fact(
  uuid, text, jsonb, text, bigint
) is
  'Appends one candidate-reviewed fact version with identity-derived tenancy, canonical server-owned policy, optimistic locking, provenance, and command replay protection.';
