-- RoleDawn / HireWire: catalog commits that scale to the largest reviewed boards.
--
-- Evidence (2026-09-28, hosted): PostgREST runs service-role RPCs under the
-- authenticator role's 8 s statement_timeout. The per-job PL/pgSQL loop needed
-- roughly 8-9 ms per new job, so boards above ~900 new jobs (carvana 1,813,
-- databricks 882) were cancelled on every attempt. The worker saw only an
-- uncertain commit, the run stayed RUNNING until its lease expired, and the
-- source was immediately due again at the head of the claim queue.
--
-- This migration keeps every contract of the prior functions (service role
-- only, lease fencing, idempotent upserts, version dedup, corroborated closure)
-- and changes three things:
--   1. The commit is set-based: one statement per table instead of ~9 per job.
--   2. The commit declares statement_timeout = 60s. PostgREST hoists that
--      function setting into the request transaction (db-hoisted-tx-settings
--      includes statement_timeout by default), so only this RPC gets the
--      larger budget. Direct SQL callers keep their own session timeout.
--   3. A claim that finds an expired lease closes the abandoned run and backs
--      the source off like a retryable failure instead of re-claiming it.

create or replace function public.claim_due_job_source(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  source_id uuid,
  ingestion_run_id uuid,
  provider text,
  tenant_key text,
  adapter_release text,
  etag text,
  source_options jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.job_sources%rowtype;
  v_run_id uuid;
  v_worker text := btrim(coalesce(p_worker_id, ''));
  v_reconciled integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_worker) not between 1 and 120 or p_lease_seconds not between 30 and 900 then
    raise exception 'SOURCE_CLAIM_INPUT_INVALID' using errcode = '22023';
  end if;

  loop
    select source.* into v_source
    from public.job_sources as source
    where source.policy_status = 'ALLOWLISTED'
      and source.polling_enabled
      and source.employer_id is not null
      and source.next_poll_at <= statement_timestamp()
      and (source.poll_lease_expires_at is null or source.poll_lease_expires_at <= statement_timestamp())
    order by source.next_poll_at, source.id
    for update skip locked
    limit 1;
    if not found then return; end if;

    exit when v_source.poll_lease_owner is null
      and not exists (
        select 1 from public.ingestion_runs as open_run
        where open_run.source_id = v_source.id and open_run.status = 'RUNNING'
      );

    -- The previous attempt ended without a recorded outcome: a crash, a lost
    -- response, or a commit that rolled back. That is uncertainty, never
    -- catalog evidence. Close the run and back off with the same schedule as
    -- a retryable failure so one bad board cannot monopolize the queue.
    update public.ingestion_runs as expired_run
    set status = 'FAILED', error_code = 'JOB_SOURCE_LEASE_EXPIRED', finished_at = statement_timestamp()
    where expired_run.source_id = v_source.id and expired_run.status = 'RUNNING';

    update public.job_sources
    set poll_lease_owner = null,
        poll_lease_expires_at = null,
        last_error_code = 'JOB_SOURCE_LEASE_EXPIRED',
        consecutive_failures = least(consecutive_failures + 1, 100),
        next_poll_at = statement_timestamp()
          + make_interval(mins => least(360, 15 * (2 ^ least(consecutive_failures, 5))::integer)),
        updated_at = statement_timestamp()
    where id = v_source.id;

    v_reconciled := v_reconciled + 1;
    -- Bounded work per claim; the next call continues reconciliation.
    if v_reconciled >= 50 then return; end if;
  end loop;

  update public.job_sources
  set poll_lease_owner = v_worker,
      poll_lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = statement_timestamp()
  where id = v_source.id;

  insert into public.ingestion_runs
    (source_id, status, checkpoint, started_at)
  values
    (v_source.id, 'RUNNING', jsonb_build_object('worker_id', v_worker), statement_timestamp())
  returning id into v_run_id;

  return query select v_source.id, v_run_id, v_source.provider,
    v_source.tenant_key, v_source.adapter_release, v_source.last_etag,
    v_source.source_options;
end;
$$;

create or replace function public.commit_job_source_snapshot(
  p_worker_id text,
  p_source_id uuid,
  p_ingestion_run_id uuid,
  p_snapshot jsonb,
  p_endpoint text,
  p_etag text,
  p_raw_sha256 text,
  p_raw_bytes bigint,
  p_response_status integer default 200
)
returns boolean
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  v_source public.job_sources%rowtype;
  v_run public.ingestion_runs%rowtype;
  v_jobs jsonb;
  v_employer_name text;
  v_observed_at timestamptz;
  v_snapshot_complete boolean;
  v_issue_count integer;
  v_observed_count integer;
  v_prior_open_count integer;
  v_interval_minutes integer;
  v_large_drop boolean;
  v_can_close boolean;
  v_fingerprint text;
  v_headers jsonb;
  v_identity_conflicts integer;
  -- Parsed snapshot columns. All arrays come from one aggregate pass, so
  -- position i describes the same job in every array.
  v_external_ids text[];
  v_titles text[];
  v_canonical_urls text[];
  v_apply_urls text[];
  v_descriptions text[];
  v_locations text[];
  v_work_modes text[];
  v_employment_types text[];
  v_content_hashes text[];
  v_normalized jsonb[];
  v_listed_text text[];
  v_published_text text[];
  v_listed boolean[];
  v_published_at timestamptz[];
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  -- 64 MiB is the database bound; the worker applies its own smaller cap.
  if p_source_id is null or p_ingestion_run_id is null
     or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
     or p_response_status not between 100 and 599
     or char_length(coalesce(p_endpoint, '')) > 2048
     or (p_raw_sha256 is not null and p_raw_sha256 !~ '^[0-9a-f]{64}$')
     or p_raw_bytes is null or p_raw_bytes < 0 or p_raw_bytes > 67108864 then
    raise exception 'SOURCE_COMMIT_INPUT_INVALID' using errcode = '22023';
  end if;

  select source.* into strict v_source
  from public.job_sources as source
  where source.id = p_source_id
  for update;
  select run.* into strict v_run
  from public.ingestion_runs as run
  where run.id = p_ingestion_run_id and run.source_id = p_source_id
  for update;
  if v_source.poll_lease_owner <> btrim(p_worker_id)
     or v_source.poll_lease_expires_at is null
     or v_source.poll_lease_expires_at <= statement_timestamp()
     or v_run.status <> 'RUNNING'
     or v_source.policy_status <> 'ALLOWLISTED' or not v_source.polling_enabled then
    raise exception 'SOURCE_POLL_LEASE_INVALID' using errcode = '55000';
  end if;

  if v_source.employer_id is null then
    raise exception 'SOURCE_EMPLOYER_REQUIRED' using errcode = '23502';
  end if;

  begin
    v_interval_minutes := coalesce((v_source.source_options ->> 'poll_interval_minutes')::integer, 360);
  exception when others then
    v_interval_minutes := 360;
  end;
  v_interval_minutes := greatest(15, least(v_interval_minutes, 1440));

  if p_response_status = 304 then
    if p_snapshot is not null or v_source.last_etag is null or v_source.last_successful_poll_at is null then
      raise exception 'SOURCE_NOT_MODIFIED_PAYLOAD_INVALID' using errcode = '22023';
    end if;
    -- A verified not-modified response is a fresh observation of this listing set.
    update public.source_job_listings
    set state = 'OPEN', last_seen_at = greatest(last_seen_at, statement_timestamp()), updated_at = statement_timestamp()
    where source_id = p_source_id and state in ('OPEN', 'STALE');
    update public.jobs j
    set state = 'OPEN', last_seen_at = greatest(j.last_seen_at, statement_timestamp()), updated_at = statement_timestamp()
    from public.source_job_listings l where j.source_listing_id = l.id and l.source_id = p_source_id and l.state = 'OPEN';
    update public.ingestion_runs
    set observed_count = (select count(*) from public.source_job_listings where source_id = p_source_id and state = 'OPEN'),
        status = 'SUCCEEDED', response_status = 304, snapshot_complete = true,
        checkpoint = checkpoint || jsonb_build_object('endpoint', p_endpoint,
          'etag', p_etag, 'not_modified', true), finished_at = statement_timestamp()
    where id = p_ingestion_run_id;
    update public.job_sources
    set last_successful_poll_at = statement_timestamp(), last_error_code = null, consecutive_failures = 0,
        last_etag = coalesce(p_etag, last_etag),
        next_poll_at = statement_timestamp() + make_interval(mins => v_interval_minutes),
        poll_lease_owner = null, poll_lease_expires_at = null,
        updated_at = statement_timestamp()
    where id = p_source_id;
    return true;
  end if;

  if p_response_status <> 200 or p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or coalesce((p_snapshot ->> 'schema_version')::integer, 0) <> 1
     or jsonb_typeof(p_snapshot -> 'jobs') <> 'array'
     or jsonb_typeof(p_snapshot -> 'issues') <> 'array'
     or jsonb_array_length(p_snapshot -> 'jobs') > 5000
     or p_snapshot ->> 'observed_at' is null
     or p_snapshot ->> 'complete' is null then
    raise exception 'SOURCE_SNAPSHOT_INVALID' using errcode = '22023';
  end if;
  begin
    v_observed_at := (p_snapshot ->> 'observed_at')::timestamptz;
    v_snapshot_complete := (p_snapshot ->> 'complete')::boolean;
  exception when others then
    raise exception 'SOURCE_SNAPSHOT_INVALID' using errcode = '22023';
  end;
  if v_observed_at > statement_timestamp() + interval '5 minutes'
     or v_observed_at < statement_timestamp() - interval '7 days' then
    raise exception 'SOURCE_SNAPSHOT_TIME_INVALID' using errcode = '22023';
  end if;

  v_jobs := p_snapshot -> 'jobs';
  select count(*)::integer into v_prior_open_count
  from public.source_job_listings where source_id = p_source_id and state in ('OPEN', 'STALE');
  v_observed_count := jsonb_array_length(v_jobs);
  v_issue_count := jsonb_array_length(p_snapshot -> 'issues');
  if not v_snapshot_complete or v_issue_count <> 0
     or (select count(distinct entry ->> 'external_job_id') from jsonb_array_elements(v_jobs) entry) <> v_observed_count then
    raise exception 'SOURCE_SNAPSHOT_INCOMPLETE_OR_DUPLICATE' using errcode = '22023';
  end if;

  -- Parse each job once, trimming exactly as the per-row implementation did.
  select
    coalesce(array_agg(parsed.external_job_id), '{}'),
    coalesce(array_agg(parsed.title), '{}'),
    coalesce(array_agg(parsed.canonical_job_url), '{}'),
    coalesce(array_agg(parsed.apply_url), '{}'),
    coalesce(array_agg(parsed.description_text), '{}'),
    coalesce(array_agg(parsed.location_text), '{}'),
    coalesce(array_agg(parsed.work_mode), '{}'),
    coalesce(array_agg(parsed.employment_type), '{}'),
    coalesce(array_agg(parsed.content_hash), '{}'),
    coalesce(array_agg(parsed.normalized_data), '{}'),
    coalesce(array_agg(parsed.listed_text), '{}'),
    coalesce(array_agg(parsed.published_text), '{}')
  into v_external_ids, v_titles, v_canonical_urls, v_apply_urls, v_descriptions,
    v_locations, v_work_modes, v_employment_types, v_content_hashes, v_normalized,
    v_listed_text, v_published_text
  from (
    select
      btrim(coalesce(entry.value ->> 'external_job_id', '')) as external_job_id,
      btrim(coalesce(entry.value ->> 'title', '')) as title,
      btrim(coalesce(entry.value ->> 'canonical_job_url', '')) as canonical_job_url,
      btrim(coalesce(entry.value ->> 'apply_url', '')) as apply_url,
      coalesce(nullif(btrim(coalesce(entry.value ->> 'description_text', '')), ''),
        'Description unavailable from the official feed.') as description_text,
      (select string_agg(btrim(location.value ->> 'label'), ' · ' order by location.ordinality)
       from jsonb_array_elements(coalesce(entry.value -> 'locations', '[]'::jsonb))
         with ordinality as location(value, ordinality)
       where btrim(coalesce(location.value ->> 'label', '')) <> '') as location_text,
      upper(btrim(coalesce(entry.value ->> 'work_mode', 'UNKNOWN'))) as work_mode,
      upper(btrim(coalesce(entry.value ->> 'employment_type', 'UNSPECIFIED'))) as employment_type,
      lower(coalesce(entry.value ->> 'content_hash', '')) as content_hash,
      coalesce(entry.value -> 'normalized_data', '{}'::jsonb) as normalized_data,
      entry.value ->> 'listed' as listed_text,
      entry.value ->> 'published_at' as published_text
    from jsonb_array_elements(v_jobs) as entry(value)
  ) as parsed;

  begin
    v_listed := v_listed_text::boolean[];
    v_published_at := v_published_text::timestamptz[];
  exception when others then
    raise exception 'SOURCE_JOB_TIME_INVALID' using errcode = '22023';
  end;

  if exists (
    select 1
    from unnest(v_external_ids, v_titles, v_canonical_urls, v_apply_urls, v_work_modes, v_content_hashes, v_normalized)
      as job(external_job_id, title, canonical_job_url, apply_url, work_mode, content_hash, normalized_data)
    where char_length(job.external_job_id) not between 1 and 400
       or char_length(job.title) not between 1 and 500
       or job.canonical_job_url !~ '^https://'
       or job.apply_url !~ '^https://'
       or job.work_mode not in ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN')
       or job.content_hash !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(job.normalized_data) <> 'object'
  ) then
    raise exception 'SOURCE_JOB_INVALID' using errcode = '22023';
  end if;
  -- Identities must stay unique after trimming, or two entries would upsert
  -- the same listing.
  if (select count(distinct external_job_id) from unnest(v_external_ids) as job(external_job_id)) <> v_observed_count then
    raise exception 'SOURCE_SNAPSHOT_INCOMPLETE_OR_DUPLICATE' using errcode = '22023';
  end if;

  v_large_drop := v_prior_open_count > 0 and v_observed_count < greatest(1, ceil(v_prior_open_count * 0.5)::integer);
  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(entry->>'external_job_id' order by entry->>'external_job_id'), '[]'::jsonb)::text, 'utf8'), 'sha256'), 'hex')
    into v_fingerprint from jsonb_array_elements(v_jobs) entry;
  v_can_close := not v_large_drop or (v_source.pending_closure_fingerprint = v_fingerprint
    and v_source.pending_closure_observed_at <= statement_timestamp() - interval '6 hours');
  v_can_close := coalesce(v_can_close, false);
  update public.job_sources
  set pending_closure_fingerprint = case when v_can_close then null else v_fingerprint end,
      pending_closure_observed_at = case when v_can_close then null
        when pending_closure_fingerprint = v_fingerprint then pending_closure_observed_at else statement_timestamp() end
  where id = p_source_id;

  select employer.canonical_name into v_employer_name
  from public.employers as employer where employer.id = v_source.employer_id;
  v_headers := jsonb_build_object('endpoint', p_endpoint, 'etag', p_etag,
    'raw_sha256', p_raw_sha256, 'raw_bytes', p_raw_bytes);

  -- 1. Listings: one upsert for the whole snapshot.
  insert into public.source_job_listings as listing
    (source_id, external_job_id, source_url, apply_url, state,
     first_seen_at, last_seen_at, closed_at, created_at, updated_at)
  select p_source_id, job.external_job_id, job.canonical_job_url, job.apply_url,
    case when coalesce(job.listed, true) then 'OPEN' else 'CLOSED' end,
    v_observed_at, v_observed_at,
    case when coalesce(job.listed, true) then null else v_observed_at end,
    v_observed_at, v_observed_at
  from unnest(v_external_ids, v_canonical_urls, v_apply_urls, v_listed)
    as job(external_job_id, canonical_job_url, apply_url, listed)
  on conflict (source_id, external_job_id) do update
  set source_url = excluded.source_url,
      apply_url = excluded.apply_url,
      state = excluded.state,
      last_seen_at = greatest(listing.last_seen_at, excluded.last_seen_at),
      closed_at = case when excluded.state = 'OPEN' then null
        else coalesce(listing.closed_at, excluded.closed_at) end,
      updated_at = excluded.updated_at;

  -- 2. Jobs: lock the existing rows (as the per-row version did) in a stable
  -- order, refuse identity drift, then create the missing ones.
  perform 1
  from unnest(v_external_ids) as job_key(external_job_id)
  join public.source_job_listings as listing
    on listing.source_id = p_source_id and listing.external_job_id = job_key.external_job_id
  join public.jobs as job on job.source_listing_id = listing.id
  order by job.id
  for update of job;

  -- A counted aggregate, not EXISTS: EXISTS gets a fast-start plan that
  -- rescans the unnested array for every listing (quadratic) when, as usual,
  -- no conflict exists.
  select count(*) filter (where job.canonical_url <> job_key.canonical_job_url)
    into v_identity_conflicts
  from unnest(v_external_ids, v_canonical_urls) as job_key(external_job_id, canonical_job_url)
  join public.source_job_listings as listing
    on listing.source_id = p_source_id and listing.external_job_id = job_key.external_job_id
  join public.jobs as job on job.source_listing_id = listing.id;
  if v_identity_conflicts > 0 then
    raise exception 'SOURCE_JOB_IDENTITY_CONFLICT' using errcode = '23505';
  end if;

  insert into public.jobs
    (employer_id, source_listing_id, canonical_url, state,
     first_seen_at, last_seen_at, closed_at, created_at, updated_at)
  select v_source.employer_id, listing.id, job_key.canonical_job_url,
    case when coalesce(job_key.listed, true) then 'OPEN' else 'CLOSED' end,
    v_observed_at, v_observed_at,
    case when coalesce(job_key.listed, true) then null else v_observed_at end,
    v_observed_at, v_observed_at
  from unnest(v_external_ids, v_canonical_urls, v_listed)
    as job_key(external_job_id, canonical_job_url, listed)
  join public.source_job_listings as listing
    on listing.source_id = p_source_id and listing.external_job_id = job_key.external_job_id
  where not exists (select 1 from public.jobs as job where job.source_listing_id = listing.id);

  -- 3. Versions: only content hashes this job has never had. Each job occurs
  -- once per snapshot, so max + 1 cannot collide inside the statement.
  insert into public.job_versions
    (job_id, version_number, content_hash, title, employer_name,
     description_text, location_text, work_mode, employment_type,
     apply_url, published_at, observed_at, normalized_data, created_at)
  select job.id,
    coalesce((select max(prior.version_number) from public.job_versions as prior where prior.job_id = job.id), 0) + 1,
    entry.content_hash, entry.title, v_employer_name,
    entry.description_text, entry.location_text, entry.work_mode, entry.employment_type,
    entry.apply_url, entry.published_at, v_observed_at, entry.normalized_data, v_observed_at
  from unnest(v_external_ids, v_content_hashes, v_titles, v_descriptions, v_locations,
      v_work_modes, v_employment_types, v_apply_urls, v_published_at, v_normalized)
    as entry(external_job_id, content_hash, title, description_text, location_text,
      work_mode, employment_type, apply_url, published_at, normalized_data)
  join public.source_job_listings as listing
    on listing.source_id = p_source_id and listing.external_job_id = entry.external_job_id
  join public.jobs as job on job.source_listing_id = listing.id
  where not exists (
    select 1 from public.job_versions as existing
    where existing.job_id = job.id and existing.content_hash = entry.content_hash
  );

  -- 4. Point every observed job at its current version and refresh state.
  update public.jobs as job
  set current_version_id = version.id,
      state = case when coalesce(entry.listed, true) then 'OPEN' else 'CLOSED' end,
      last_seen_at = greatest(job.last_seen_at, v_observed_at),
      closed_at = case when coalesce(entry.listed, true) then null
        else coalesce(job.closed_at, v_observed_at) end,
      updated_at = v_observed_at
  from unnest(v_external_ids, v_content_hashes, v_listed) as entry(external_job_id, content_hash, listed)
  join public.source_job_listings as listing
    on listing.source_id = p_source_id and listing.external_job_id = entry.external_job_id
  join public.job_versions as version on version.content_hash = entry.content_hash
  where job.source_listing_id = listing.id and version.job_id = job.id;

  -- 5. Observation metadata, immutable and deduplicated by content.
  insert into public.source_job_observations
    (source_id, ingestion_run_id, external_job_id, payload_hash,
     raw_payload_ref, response_headers, parser_release, observed_at)
  select p_source_id, p_ingestion_run_id, entry.external_job_id, entry.content_hash,
    null, v_headers, v_source.adapter_release, v_observed_at
  from unnest(v_external_ids, v_content_hashes) as entry(external_job_id, content_hash)
  on conflict (source_id, external_job_id, payload_hash) do nothing;

  -- 6. Absence. EXCEPT keeps this linear for thousands of listings.
  if v_can_close then
    update public.source_job_listings as listing
    set state = 'CLOSED', closed_at = coalesce(listing.closed_at, v_observed_at),
        updated_at = v_observed_at
    where listing.id in (
      select current_listing.id from public.source_job_listings as current_listing
      where current_listing.source_id = p_source_id and current_listing.state in ('OPEN', 'STALE')
      except
      select seen.id
      from unnest(v_external_ids) as entry(external_job_id)
      join public.source_job_listings as seen
        on seen.source_id = p_source_id and seen.external_job_id = entry.external_job_id
    );
    update public.jobs as job
    set state = 'CLOSED', closed_at = coalesce(job.closed_at, v_observed_at),
        updated_at = v_observed_at
    from public.source_job_listings as listing
    where listing.id = job.source_listing_id and listing.source_id = p_source_id
      and listing.state = 'CLOSED' and job.state in ('OPEN', 'STALE');
  else
    -- A suspicious drop is unavailable, not proven closed. Never show missing
    -- rows as current while waiting for a corroborating complete observation.
    update public.source_job_listings as listing
    set state = 'STALE', updated_at = statement_timestamp()
    where listing.id in (
      select current_listing.id from public.source_job_listings as current_listing
      where current_listing.source_id = p_source_id and current_listing.state = 'OPEN'
      except
      select seen.id
      from unnest(v_external_ids) as entry(external_job_id)
      join public.source_job_listings as seen
        on seen.source_id = p_source_id and seen.external_job_id = entry.external_job_id
    );
    update public.jobs j set state = 'STALE', updated_at = statement_timestamp()
    from public.source_job_listings l where j.source_listing_id = l.id and l.source_id = p_source_id and l.state = 'STALE' and j.state = 'OPEN';
  end if;

  update public.ingestion_runs
  set status = case when v_snapshot_complete and v_issue_count = 0 and v_can_close
      then 'SUCCEEDED' else 'PARTIAL' end,
      checkpoint = checkpoint || jsonb_build_object('endpoint', p_endpoint,
        'etag', p_etag, 'raw_sha256', p_raw_sha256, 'raw_bytes', p_raw_bytes,
        'issue_count', v_issue_count, 'closure_applied', v_can_close),
      response_status = p_response_status,
      snapshot_complete = v_snapshot_complete,
      observed_count = v_observed_count,
      finished_at = statement_timestamp()
  where id = p_ingestion_run_id;

  update public.job_sources
  set last_successful_poll_at = statement_timestamp(), last_error_code = null, consecutive_failures = 0,
      last_etag = case when v_can_close then p_etag else null end,
      next_poll_at = statement_timestamp() + make_interval(mins => v_interval_minutes),
      poll_lease_owner = null, poll_lease_expires_at = null,
      updated_at = statement_timestamp()
  where id = p_source_id and poll_lease_owner = btrim(p_worker_id);

  return true;
end;
$$;

comment on function public.commit_job_source_snapshot(text, uuid, uuid, jsonb, text, text, text, bigint, integer) is
  'Atomically commits one complete normalized source snapshot with set-based upserts. statement_timeout=60s is hoisted by PostgREST for this RPC only.';

revoke all on function public.claim_due_job_source(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_job_source(text, integer) to service_role;
revoke all on function public.commit_job_source_snapshot(text, uuid, uuid, jsonb, text, text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.commit_job_source_snapshot(text, uuid, uuid, jsonb, text, text, text, bigint, integer)
  to service_role;

-- PostgREST caches function settings with the schema; reload so the hoisted
-- statement_timeout applies to the next RPC.
notify pgrst, 'reload schema';
