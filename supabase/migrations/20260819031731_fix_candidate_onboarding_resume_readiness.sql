-- Correct the reviewed-resume readiness check to use the source document's
-- version-number pointer. The initial onboarding migration referenced a
-- non-existent id column and therefore failed closed for every candidate.

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
