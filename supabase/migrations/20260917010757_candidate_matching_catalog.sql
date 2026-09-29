-- Shared sanitized inventory only. Candidate facts never enter this RPC or its cache.
create function public.matching_catalog_page(p_after_job_id uuid default null, p_limit integer default 500)
returns table (
  job_id uuid, job_version_id uuid, canonical_url text, employer_name text, title text,
  location_text text, work_mode text, employment_type text, description_text text,
  apply_url text, published_at timestamptz, observed_at timestamptz, source_provider text,
  saved boolean, queued_application_id uuid, content_hash text, version_number bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare v_service boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
begin
  if not v_service and not exists (
    select 1 from public.candidates c
    join public.workspace_memberships m on m.workspace_id=c.workspace_id
      and m.auth_user_id=auth.uid() and m.status='ACTIVE'
    join public.workspaces w on w.id=c.workspace_id and w.kind='PERSONAL'
      and w.status='ACTIVE' and w.personal_owner_auth_user_id=auth.uid()
    where c.auth_user_id=auth.uid() and c.status in ('ONBOARDING','ACTIVE','PAUSED')
  ) then raise exception 'ACTIVE_CANDIDATE_REQUIRED' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'MATCHING_PAGE_LIMIT_INVALID' using errcode='22023';
  end if;
  return query select j.id, v.id, j.canonical_url, v.employer_name, v.title,
    v.location_text, v.work_mode, v.employment_type, v.description_text, v.apply_url,
    v.published_at, v.observed_at, s.provider, false, null::uuid, v.content_hash, v.version_number
  from public.jobs j
  join public.job_versions v on v.id=j.current_version_id and v.job_id=j.id
  join public.source_job_listings l on l.id=j.source_listing_id
  join public.job_sources s on s.id=l.source_id
  where j.state='OPEN' and l.state='OPEN' and s.policy_status='ALLOWLISTED'
    and s.polling_enabled and j.last_seen_at >= now()-interval '7 days'
    and l.last_seen_at >= now()-interval '7 days'
    and (p_after_job_id is null or j.id>p_after_job_id)
  order by j.id limit p_limit;
end; $$;
revoke all on function public.matching_catalog_page(uuid,integer) from public,anon;
grant execute on function public.matching_catalog_page(uuid,integer) to authenticated,service_role;
