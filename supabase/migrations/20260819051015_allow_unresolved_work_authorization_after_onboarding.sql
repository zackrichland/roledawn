-- Completing account setup requires the reusable, ordinary facts that every
-- supported application needs. Country-scoped work authorization is not a
-- global activation prerequisite: a missing or explicitly unresolved answer
-- remains stored as unknown and is evaluated for each job/application.

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

  if not exists (
    select 1
    from public.candidate_search_profiles as profile
    where profile.workspace_id = p_workspace_id
      and profile.candidate_id = p_candidate_id
  ) then v_missing := array_append(v_missing, 'SEARCH_RULES'); end if;

  return v_missing;
end;
$$;

revoke all on function private.candidate_onboarding_missing_items(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.candidate_onboarding_missing_items(uuid, uuid)
  to service_role;

comment on function private.candidate_onboarding_missing_items(uuid, uuid) is
  'Returns global account-activation gaps only. Work authorization remains an application-specific unknown or candidate decision.';
