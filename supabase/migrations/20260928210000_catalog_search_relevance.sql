-- RoleDawn / HireWire: catalog search ranked by relevance.
-- search_catalog_jobs matches any posting containing every word anywhere and
-- orders by recency, so "Staff Forward Deployed Engineer" surfaced unrelated
-- roles whose descriptions mention those words. The ranked variant orders by
-- a small match tier (exact title, title phrase or employer, all words in the
-- title, anywhere) and then recency, with a keyset cursor over all three.
-- The original function is unchanged for already-deployed callers.

create or replace function public.search_catalog_jobs_ranked(
  p_query text default '',
  p_limit integer default 24,
  p_saved_only boolean default false,
  p_work_mode text default null,
  p_employment_type text default null,
  p_location text default null,
  p_cursor_tier integer default null,
  p_cursor_observed_at timestamptz default null,
  p_cursor_job_id uuid default null
)
returns table (
  job_id uuid,
  job_version_id uuid,
  canonical_url text,
  employer_name text,
  title text,
  location_text text,
  work_mode text,
  employment_type text,
  description_text text,
  apply_url text,
  published_at timestamptz,
  observed_at timestamptz,
  source_provider text,
  saved boolean,
  queued_application_id uuid,
  match_tier integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_candidate uuid;
  v_candidate_count integer;
  v_query text := btrim(coalesce(p_query, ''));
  v_needle text := lower(btrim(coalesce(p_query, '')));
  v_work_mode text := upper(btrim(coalesce(p_work_mode, '')));
  v_employment_type text := upper(btrim(coalesce(p_employment_type, '')));
  v_location text := btrim(coalesce(p_location, ''));
  v_tsquery tsquery;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100
     or char_length(v_query) > 120
     or char_length(v_location) > 120
     or (v_work_mode <> '' and v_work_mode not in ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'))
     or (p_cursor_observed_at is null) <> (p_cursor_job_id is null)
     or (p_cursor_observed_at is null) <> (p_cursor_tier is null)
     or (p_cursor_tier is not null and p_cursor_tier not between 0 and 4) then
    raise exception 'CATALOG_SEARCH_INPUT_INVALID' using errcode = '22023';
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
  if v_candidate_count = 0 then
    raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501';
  end if;
  if v_candidate_count > 1 then
    raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000';
  end if;

  select candidate.id into strict v_candidate
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

  if v_query <> '' then
    v_tsquery := websearch_to_tsquery('simple'::regconfig, v_query);
  end if;

  return query
  with matched as (
    select
      job.id as job_id,
      version.id as job_version_id,
      job.canonical_url,
      version.employer_name,
      version.title,
      version.location_text,
      version.work_mode,
      version.employment_type,
      left(version.description_text, 900) as description_text,
      version.apply_url,
      version.published_at,
      version.observed_at,
      source.provider as source_provider,
      case
        when v_query = '' then 0
        when lower(version.title) = v_needle then 4
        when strpos(lower(version.title), v_needle) > 0 or strpos(lower(version.employer_name), v_needle) > 0 then 3
        when to_tsvector('simple'::regconfig, coalesce(version.title, '')) @@ v_tsquery then 2
        else 1
      end as match_tier
    from public.jobs as job
    join public.job_versions as version
      on version.job_id = job.id and version.id = job.current_version_id
    join public.source_job_listings as listing
      on listing.id = job.source_listing_id
    join public.job_sources as source
      on source.id = listing.source_id
    where source.policy_status = 'ALLOWLISTED'
      and job.state = 'OPEN'
      and listing.state = 'OPEN'
      and (v_query = '' or version.search_document @@ v_tsquery)
      and (v_work_mode = '' or version.work_mode = v_work_mode)
      and (v_employment_type = '' or upper(coalesce(version.employment_type, '')) = v_employment_type)
      and (v_location = '' or version.location_text ilike '%' || v_location || '%')
  )
  select
    matched.job_id,
    matched.job_version_id,
    matched.canonical_url,
    matched.employer_name,
    matched.title,
    matched.location_text,
    matched.work_mode,
    matched.employment_type,
    matched.description_text,
    matched.apply_url,
    matched.published_at,
    matched.observed_at,
    matched.source_provider,
    coalesce(decision.decision = 'SAVED', false),
    queued.id,
    matched.match_tier
  from matched
  left join lateral (
    select candidate_decision.decision
    from public.candidate_job_decisions as candidate_decision
    where candidate_decision.candidate_id = v_candidate
      and candidate_decision.job_id = matched.job_id
      and candidate_decision.undone_at is null
    limit 1
  ) as decision on true
  left join lateral (
    select application.id
    from public.applications as application
    where application.candidate_id = v_candidate
      and application.job_id = matched.job_id
    order by application.queued_at desc, application.id desc
    limit 1
  ) as queued on true
  where (not coalesce(p_saved_only, false) or decision.decision = 'SAVED')
    and (
      p_cursor_observed_at is null
      or (matched.match_tier, matched.observed_at, matched.job_id)
        < (p_cursor_tier, p_cursor_observed_at, p_cursor_job_id)
    )
  order by matched.match_tier desc, matched.observed_at desc, matched.job_id desc
  limit p_limit;
end;
$$;

revoke all on function public.search_catalog_jobs_ranked(text, integer, boolean, text, text, text, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.search_catalog_jobs_ranked(text, integer, boolean, text, text, text, integer, timestamptz, uuid)
  to authenticated, service_role;
