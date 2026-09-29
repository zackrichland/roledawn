-- RoleDawn / HireWire: PostgREST caps set-returning RPCs at max_rows (1000),
-- which silently truncated the matching index. One JSON value per page is not
-- row-capped, so a 40k-job catalog is four calls instead of forty.

create or replace function public.matching_catalog_index_json(p_after_job_id uuid default null, p_limit integer default 10000)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  perform private.assert_matching_caller();
  if p_limit is null or p_limit not between 1 and 20000 then
    raise exception 'MATCHING_PAGE_LIMIT_INVALID' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'job_id', page.job_id, 'title', page.title, 'employer_name', page.employer_name,
      'location_text', page.location_text, 'work_mode', page.work_mode,
      'employment_type', page.employment_type, 'observed_at', page.observed_at
    ) order by page.job_id), '[]'::jsonb)
  into v_rows
  from (
    select j.id as job_id, v.title, v.employer_name, v.location_text, v.work_mode, v.employment_type, v.observed_at
    from public.jobs j
    join public.job_versions v on v.id = j.current_version_id and v.job_id = j.id
    join public.source_job_listings l on l.id = j.source_listing_id
    join public.job_sources s on s.id = l.source_id
    where j.state = 'OPEN' and l.state = 'OPEN' and s.policy_status = 'ALLOWLISTED'
      and s.polling_enabled and j.last_seen_at >= now() - interval '7 days'
      and l.last_seen_at >= now() - interval '7 days'
      and (p_after_job_id is null or j.id > p_after_job_id)
    order by j.id
    limit p_limit
  ) as page;
  return v_rows;
end; $$;
revoke all on function public.matching_catalog_index_json(uuid, integer) from public, anon;
grant execute on function public.matching_catalog_index_json(uuid, integer) to authenticated, service_role;
