-- RoleDawn / HireWire: matching that scales past 25k jobs. Candidates scan a
-- compact index (no descriptions) of the whole fresh catalog, then fetch full
-- postings only for a shortlist. Shared job content only; no candidate data.

create or replace function private.assert_matching_caller()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then return; end if;
  if not exists (
    select 1 from public.candidates c
    join public.workspace_memberships m on m.workspace_id = c.workspace_id
      and m.auth_user_id = auth.uid() and m.status = 'ACTIVE'
    join public.workspaces w on w.id = c.workspace_id and w.kind = 'PERSONAL'
      and w.status = 'ACTIVE' and w.personal_owner_auth_user_id = auth.uid()
    where c.auth_user_id = auth.uid() and c.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  ) then
    raise exception 'ACTIVE_CANDIDATE_REQUIRED' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_matching_caller() from public, anon;
grant execute on function private.assert_matching_caller() to authenticated, service_role;

create or replace function public.matching_catalog_index_page(p_after_job_id uuid default null, p_limit integer default 2000)
returns table (
  job_id uuid, job_version_id uuid, canonical_url text, employer_name text, title text,
  location_text text, work_mode text, employment_type text, apply_url text,
  published_at timestamptz, observed_at timestamptz, source_provider text,
  content_hash text, version_number bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_matching_caller();
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'MATCHING_PAGE_LIMIT_INVALID' using errcode = '22023';
  end if;
  return query select j.id, v.id, j.canonical_url, v.employer_name, v.title,
    v.location_text, v.work_mode, v.employment_type, v.apply_url,
    v.published_at, v.observed_at, s.provider, v.content_hash, v.version_number
  from public.jobs j
  join public.job_versions v on v.id = j.current_version_id and v.job_id = j.id
  join public.source_job_listings l on l.id = j.source_listing_id
  join public.job_sources s on s.id = l.source_id
  where j.state = 'OPEN' and l.state = 'OPEN' and s.policy_status = 'ALLOWLISTED'
    and s.polling_enabled and j.last_seen_at >= now() - interval '7 days'
    and l.last_seen_at >= now() - interval '7 days'
    and (p_after_job_id is null or j.id > p_after_job_id)
  order by j.id limit p_limit;
end; $$;
revoke all on function public.matching_catalog_index_page(uuid, integer) from public, anon;
grant execute on function public.matching_catalog_index_page(uuid, integer) to authenticated, service_role;

create or replace function public.matching_catalog_jobs(p_job_ids uuid[])
returns table (
  job_id uuid, job_version_id uuid, canonical_url text, employer_name text, title text,
  location_text text, work_mode text, employment_type text, description_text text,
  apply_url text, published_at timestamptz, observed_at timestamptz, source_provider text,
  saved boolean, queued_application_id uuid, content_hash text, version_number bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_matching_caller();
  if p_job_ids is null or cardinality(p_job_ids) > 500 then
    raise exception 'MATCHING_JOB_BATCH_INVALID' using errcode = '22023';
  end if;
  return query select j.id, v.id, j.canonical_url, v.employer_name, v.title,
    v.location_text, v.work_mode, v.employment_type, v.description_text, v.apply_url,
    v.published_at, v.observed_at, s.provider, false, null::uuid, v.content_hash, v.version_number
  from public.jobs j
  join public.job_versions v on v.id = j.current_version_id and v.job_id = j.id
  join public.source_job_listings l on l.id = j.source_listing_id
  join public.job_sources s on s.id = l.source_id
  where j.id = any(p_job_ids)
    and j.state = 'OPEN' and l.state = 'OPEN' and s.policy_status = 'ALLOWLISTED'
    and s.polling_enabled and j.last_seen_at >= now() - interval '7 days'
    and l.last_seen_at >= now() - interval '7 days'
  order by j.id;
end; $$;
revoke all on function public.matching_catalog_jobs(uuid[]) from public, anon;
grant execute on function public.matching_catalog_jobs(uuid[]) to authenticated, service_role;

-- Most boards omit employment type (Greenhouse always does). An explicit
-- filter keeps jobs whose type is unknown instead of hiding them.
do $search$
declare
  v_function record;
  v_old text := 'and (v_employment_type = '''' or upper(coalesce(version.employment_type, '''')) = v_employment_type)';
  v_new text := 'and (v_employment_type = '''' or upper(coalesce(version.employment_type, '''')) = v_employment_type or upper(coalesce(version.employment_type, '''')) in ('''', ''UNKNOWN'', ''UNSPECIFIED'', ''OTHER''))';
  v_patched integer := 0;
begin
  for v_function in
    select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_catalog_jobs' and p.prokind = 'f'
  loop
    if position(v_old in pg_get_functiondef(v_function.signature)) > 0 then
      execute replace(pg_get_functiondef(v_function.signature), v_old, v_new);
      v_patched := v_patched + 1;
    end if;
  end loop;
  if v_patched = 0 then raise exception 'SEARCH_EMPLOYMENT_FILTER_PATCH_DRIFT'; end if;
end;
$search$;
