-- Greenhouse and other ATS forms commonly require separate given/family name
-- controls. These values must be entered and reviewed by the candidate; the
-- application driver must never split or infer them from a full legal name.

create or replace function public.save_candidate_identity_name_fact(
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
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null
     or v_key not in ('identity.given_name', 'identity.family_name')
     or char_length(v_text) not between 1 and 80
     or v_text <> regexp_replace(v_text, '[[:space:]]+', ' ', 'g')
     or p_value_json is null
     or jsonb_typeof(p_value_json) <> 'string'
     or p_value_json #>> '{}' <> v_text
     or (p_expected_aggregate_version is not null and p_expected_aggregate_version < 1) then
    raise exception 'CANDIDATE_FACT_INPUT_INVALID' using errcode = '22023';
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

  v_request_hash := encode(extensions.digest(convert_to(
    v_key || E'\n' || p_value_json::text || E'\n' || v_text || E'\n' ||
    'STANDARD' || E'\n' || 'EXACT_FIELDS' || E'\n' ||
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
      (v_workspace, v_candidate, v_key, 'STANDARD', 'EXACT_FIELDS',
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
     p_value_json, v_text, 'APPROVED', v_actor, 'CANDIDATE_ENTRY',
     statement_timestamp(), v_actor);

  update public.candidate_facts as fact
  set sensitivity = 'STANDARD',
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
       'sensitivity', 'STANDARD',
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

  return query
  select v_fact.id, v_fact_version, v_version_number,
    v_new_aggregate_version, false;
end;
$$;

revoke all on function public.save_candidate_identity_name_fact(
  uuid, text, jsonb, text, bigint
) from public, anon;
grant execute on function public.save_candidate_identity_name_fact(
  uuid, text, jsonb, text, bigint
) to authenticated, service_role;

comment on function public.save_candidate_identity_name_fact(
  uuid, text, jsonb, text, bigint
) is
  'Appends a candidate-entered given or family name without deriving either value from a full legal name.';

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
      and document.current_version_number is not null
  ) then v_missing := array_append(v_missing, 'RESUME'); end if;

  if not exists (
    select 1 from public.candidate_facts as fact
    where fact.workspace_id = p_workspace_id
      and fact.candidate_id = p_candidate_id
      and fact.fact_key = 'identity.given_name'
      and fact.verification_status = 'VERIFIED'
      and fact.current_version_number is not null
  ) then v_missing := array_append(v_missing, 'GIVEN_NAME'); end if;

  if not exists (
    select 1 from public.candidate_facts as fact
    where fact.workspace_id = p_workspace_id
      and fact.candidate_id = p_candidate_id
      and fact.fact_key = 'identity.family_name'
      and fact.verification_status = 'VERIFIED'
      and fact.current_version_number is not null
  ) then v_missing := array_append(v_missing, 'FAMILY_NAME'); end if;

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
  ) < 3 then v_missing := array_append(v_missing, 'LOCATION'); end if;

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
    ) < 2 then v_missing := array_append(v_missing, 'US_WORK_ELIGIBILITY'); end if;
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
    ) < 2 then v_missing := array_append(v_missing, 'CA_WORK_ELIGIBILITY'); end if;
  end if;

  return v_missing;
end;
$$;

revoke all on function private.candidate_onboarding_missing_items(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.candidate_onboarding_missing_items(uuid, uuid)
  to service_role;

-- The fill authorization manifest may also disclose the four candidate-
-- attested work-authorization booleans. All other sensitive facts remain
-- excluded. Keep this as a fail-closed transformation of the already deployed
-- function so the migration aborts if its audited predicate has drifted.
do $migration$
declare
  v_signature regprocedure :=
    'public.authorize_application_fill_once(uuid,uuid,bigint,uuid,text)'::regprocedure;
  v_definition text;
  v_updated text;
  v_old_predicate text :=
    '    and fact.sensitivity = ''STANDARD''' || E'\n' ||
    '    and fact.usage_policy = ''EXACT_FIELDS''' || E'\n' ||
    '    and fact.verification_status = ''VERIFIED'';';
  v_new_predicate text :=
    '    and (' || E'\n' ||
    '      fact.sensitivity = ''STANDARD''' || E'\n' ||
    '      or (' || E'\n' ||
    '        fact.sensitivity = ''SENSITIVE''' || E'\n' ||
    '        and fact.fact_key in (' || E'\n' ||
    '          ''work_authorization.us.authorized'',' || E'\n' ||
    '          ''work_authorization.us.sponsorship_required'',' || E'\n' ||
    '          ''work_authorization.ca.authorized'',' || E'\n' ||
    '          ''work_authorization.ca.sponsorship_required''' || E'\n' ||
    '        )' || E'\n' ||
    '      )' || E'\n' ||
    '    )' || E'\n' ||
    '    and fact.usage_policy = ''EXACT_FIELDS''' || E'\n' ||
    '    and fact.verification_status = ''VERIFIED'';';
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  v_updated := replace(v_definition, v_old_predicate, v_new_predicate);
  if v_updated = v_definition then
    raise exception 'APPLICATION_FILL_DISCLOSURE_PREDICATE_DRIFT';
  end if;
  execute v_updated;
end;
$migration$;

comment on function public.authorize_application_fill_once(
  uuid, uuid, bigint, uuid, text
) is
  'Creates one fill-only/no-submit authorization. Disclosure is limited to candidate-approved exact standard facts plus the four exact work-authorization booleans; all other sensitive facts remain excluded.';
