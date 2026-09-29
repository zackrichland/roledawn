-- Daily source expansion: exact full snapshots, durable crash recovery,
-- corroborated closure, bounded retries and candidate-safe freshness.
alter table public.job_sources
  add column consecutive_failures integer not null default 0 check (consecutive_failures between 0 and 100),
  add column pending_closure_fingerprint text check (pending_closure_fingerprint ~ '^[0-9a-f]{64}$'),
  add column pending_closure_observed_at timestamptz,
  add constraint job_sources_pending_closure_pair check ((pending_closure_fingerprint is null) = (pending_closure_observed_at is null));

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
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_worker) not between 1 and 120 or p_lease_seconds not between 30 and 900 then
    raise exception 'SOURCE_CLAIM_INPUT_INVALID' using errcode = '22023';
  end if;

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

  -- A crashed worker must not leave an eternal RUNNING ingestion record.
  update public.ingestion_runs as expired_run
  set status = 'FAILED', error_code = 'JOB_SOURCE_LEASE_EXPIRED', finished_at = statement_timestamp()
  where expired_run.source_id = v_source.id and expired_run.status = 'RUNNING';

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
as $$
declare
  v_source public.job_sources%rowtype;
  v_run public.ingestion_runs%rowtype;
  v_entry jsonb;
  v_listing public.source_job_listings%rowtype;
  v_job public.jobs%rowtype;
  v_version_id uuid;
  v_existing_version bigint;
  v_external_id text;
  v_title text;
  v_canonical_url text;
  v_apply_url text;
  v_description text;
  v_location text;
  v_work_mode text;
  v_employment_type text;
  v_content_hash text;
  v_observed_at timestamptz;
  v_published_at timestamptz;
  v_listed boolean;
  v_issue_count integer;
  v_observed_count integer;
  v_prior_open_count integer;
  v_can_close boolean;
  v_snapshot_complete boolean;
  v_seen_ids text[] := array[]::text[];
  v_interval_minutes integer;
  v_large_drop boolean;
  v_fingerprint text;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_source_id is null or p_ingestion_run_id is null
     or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
     or p_response_status not between 100 and 599
     or char_length(coalesce(p_endpoint, '')) > 2048
     or (p_raw_sha256 is not null and p_raw_sha256 !~ '^[0-9a-f]{64}$')
     or p_raw_bytes is null or p_raw_bytes < 0 or p_raw_bytes > 20971520 then
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

  select count(*)::integer into v_prior_open_count
  from public.source_job_listings where source_id = p_source_id and state in ('OPEN', 'STALE');
  v_observed_count := jsonb_array_length(p_snapshot -> 'jobs');
  v_issue_count := jsonb_array_length(p_snapshot -> 'issues');
  if not v_snapshot_complete or v_issue_count <> 0
     or (select count(distinct entry->>'external_job_id') from jsonb_array_elements(p_snapshot->'jobs') entry) <> v_observed_count then
    raise exception 'SOURCE_SNAPSHOT_INCOMPLETE_OR_DUPLICATE' using errcode = '22023';
  end if;
  v_large_drop := v_prior_open_count > 0 and v_observed_count < greatest(1, ceil(v_prior_open_count * 0.5)::integer);
  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(entry->>'external_job_id' order by entry->>'external_job_id'), '[]'::jsonb)::text, 'utf8'), 'sha256'), 'hex')
    into v_fingerprint from jsonb_array_elements(p_snapshot->'jobs') entry;
  v_can_close := not v_large_drop or (v_source.pending_closure_fingerprint = v_fingerprint
    and v_source.pending_closure_observed_at <= statement_timestamp() - interval '6 hours');
  v_can_close := coalesce(v_can_close, false);
  update public.job_sources
  set pending_closure_fingerprint = case when v_can_close then null else v_fingerprint end,
      pending_closure_observed_at = case when v_can_close then null
        when pending_closure_fingerprint = v_fingerprint then pending_closure_observed_at else statement_timestamp() end
  where id = p_source_id;

  for v_entry in select value from jsonb_array_elements(p_snapshot -> 'jobs')
  loop
    v_external_id := btrim(coalesce(v_entry ->> 'external_job_id', ''));
    v_title := btrim(coalesce(v_entry ->> 'title', ''));
    v_canonical_url := btrim(coalesce(v_entry ->> 'canonical_job_url', ''));
    v_apply_url := btrim(coalesce(v_entry ->> 'apply_url', ''));
    v_description := btrim(coalesce(v_entry ->> 'description_text', ''));
    v_work_mode := upper(btrim(coalesce(v_entry ->> 'work_mode', 'UNKNOWN')));
    v_employment_type := upper(btrim(coalesce(v_entry ->> 'employment_type', 'UNSPECIFIED')));
    v_content_hash := lower(coalesce(v_entry ->> 'content_hash', ''));
    begin
      v_listed := coalesce((v_entry ->> 'listed')::boolean, true);
      v_published_at := case when v_entry ->> 'published_at' is null then null
        else (v_entry ->> 'published_at')::timestamptz end;
    exception when others then
      raise exception 'SOURCE_JOB_TIME_INVALID' using errcode = '22023';
    end;
    select string_agg(btrim(location.value ->> 'label'), ' · ' order by location.ordinality)
      into v_location
    from jsonb_array_elements(coalesce(v_entry -> 'locations', '[]'::jsonb))
      with ordinality as location(value, ordinality)
    where btrim(coalesce(location.value ->> 'label', '')) <> '';

    if char_length(v_external_id) not between 1 and 400
       or char_length(v_title) not between 1 and 500
       or v_canonical_url !~ '^https://'
       or v_apply_url !~ '^https://'
       or v_work_mode not in ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN')
       or v_content_hash !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(coalesce(v_entry -> 'normalized_data', '{}'::jsonb)) <> 'object' then
      raise exception 'SOURCE_JOB_INVALID' using errcode = '22023';
    end if;
    if v_description = '' then
      v_description := 'Description unavailable from the official feed.';
    end if;
    v_seen_ids := array_append(v_seen_ids, v_external_id);

    insert into public.source_job_listings
      (source_id, external_job_id, source_url, apply_url, state,
       first_seen_at, last_seen_at, closed_at, created_at, updated_at)
    values
      (p_source_id, v_external_id, v_canonical_url, v_apply_url,
       case when v_listed then 'OPEN' else 'CLOSED' end,
       v_observed_at, v_observed_at,
       case when v_listed then null else v_observed_at end,
       v_observed_at, v_observed_at)
    on conflict (source_id, external_job_id) do update
    set source_url = excluded.source_url,
        apply_url = excluded.apply_url,
        state = excluded.state,
        last_seen_at = greatest(public.source_job_listings.last_seen_at, excluded.last_seen_at),
        closed_at = case when excluded.state = 'OPEN' then null
          else coalesce(public.source_job_listings.closed_at, excluded.closed_at) end,
        updated_at = excluded.updated_at
    returning * into v_listing;

    select job.* into v_job
    from public.jobs as job where job.source_listing_id = v_listing.id
    for update;
    if not found then
      insert into public.jobs
        (employer_id, source_listing_id, canonical_url, state,
         first_seen_at, last_seen_at, closed_at, created_at, updated_at)
      values
        (v_source.employer_id, v_listing.id, v_canonical_url,
         case when v_listed then 'OPEN' else 'CLOSED' end,
         v_observed_at, v_observed_at,
         case when v_listed then null else v_observed_at end,
         v_observed_at, v_observed_at)
      returning * into v_job;
    elsif v_job.canonical_url <> v_canonical_url then
      raise exception 'SOURCE_JOB_IDENTITY_CONFLICT' using errcode = '23505';
    end if;

    select version.id, version.version_number into v_version_id, v_existing_version
    from public.job_versions as version
    where version.job_id = v_job.id and version.content_hash = v_content_hash;
    if v_version_id is null then
      select coalesce(max(version.version_number), 0) + 1 into v_existing_version
      from public.job_versions as version where version.job_id = v_job.id;
      insert into public.job_versions
        (job_id, version_number, content_hash, title, employer_name,
         description_text, location_text, work_mode, employment_type,
         apply_url, published_at, observed_at, normalized_data, created_at)
      values
        (v_job.id, v_existing_version, v_content_hash, v_title,
         (select employer.canonical_name from public.employers as employer where employer.id = v_source.employer_id),
         v_description, v_location, v_work_mode, v_employment_type,
         v_apply_url, v_published_at, v_observed_at,
         coalesce(v_entry -> 'normalized_data', '{}'::jsonb), v_observed_at)
      returning id into v_version_id;
    end if;

    update public.jobs
    set current_version_id = v_version_id,
        state = case when v_listed then 'OPEN' else 'CLOSED' end,
        last_seen_at = greatest(last_seen_at, v_observed_at),
        closed_at = case when v_listed then null else coalesce(closed_at, v_observed_at) end,
        updated_at = v_observed_at
    where id = v_job.id;

    insert into public.source_job_observations
      (source_id, ingestion_run_id, external_job_id, payload_hash,
       raw_payload_ref, response_headers, parser_release, observed_at)
    values
      (p_source_id, p_ingestion_run_id, v_external_id, v_content_hash,
       null, jsonb_build_object('endpoint', p_endpoint, 'etag', p_etag,
         'raw_sha256', p_raw_sha256, 'raw_bytes', p_raw_bytes),
       v_source.adapter_release, v_observed_at)
    on conflict (source_id, external_job_id, payload_hash) do nothing;
  end loop;

  if v_can_close then
    update public.source_job_listings
    set state = 'CLOSED', closed_at = coalesce(closed_at, v_observed_at),
        updated_at = v_observed_at
    where source_id = p_source_id and state in ('OPEN', 'STALE')
      and not (external_job_id = any(v_seen_ids));
    update public.jobs as job
    set state = 'CLOSED', closed_at = coalesce(job.closed_at, v_observed_at),
        updated_at = v_observed_at
    from public.source_job_listings as listing
    where listing.id = job.source_listing_id and listing.source_id = p_source_id
      and listing.state = 'CLOSED' and job.state in ('OPEN', 'STALE');
  else
    -- A suspicious drop is unavailable, not proven closed. Never show missing
    -- rows as current while waiting for a corroborating complete observation.
    update public.source_job_listings
    set state = 'STALE', updated_at = statement_timestamp()
    where source_id = p_source_id and state = 'OPEN' and not (external_job_id = any(v_seen_ids));
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

create or replace function public.fail_job_source_poll(
  p_worker_id text,
  p_source_id uuid,
  p_ingestion_run_id uuid,
  p_error_code text,
  p_retryable boolean,
  p_response_status integer default null,
  p_endpoint text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error text := upper(btrim(coalesce(p_error_code, '')));
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
     or p_source_id is null or p_ingestion_run_id is null
     or char_length(v_error) not between 1 and 120
     or p_retryable is null
     or (p_response_status is not null and p_response_status not between 100 and 599) then
    raise exception 'SOURCE_FAILURE_INPUT_INVALID' using errcode = '22023';
  end if;

  update public.ingestion_runs as run
  set status = 'FAILED', response_status = p_response_status,
      error_code = v_error,
      checkpoint = run.checkpoint || jsonb_build_object('endpoint', p_endpoint),
      finished_at = statement_timestamp()
  from public.job_sources as source
  where run.id = p_ingestion_run_id and run.source_id = p_source_id
    and run.status = 'RUNNING' and source.id = run.source_id
    and source.poll_lease_owner = btrim(p_worker_id)
    and source.poll_lease_expires_at > statement_timestamp();
  if not found then
    raise exception 'SOURCE_POLL_LEASE_INVALID' using errcode = '55000';
  end if;

  update public.job_sources
  set last_error_code = v_error,
      consecutive_failures = least(consecutive_failures + 1, 100),
      next_poll_at = statement_timestamp() + case when p_retryable
        then make_interval(mins => least(360, 15 * (2 ^ least(consecutive_failures, 5))::integer)) else interval '24 hours' end,
      poll_lease_owner = null, poll_lease_expires_at = null,
      updated_at = statement_timestamp()
  where id = p_source_id and poll_lease_owner = btrim(p_worker_id);
  return true;
end;
$$;

revoke all on function public.claim_due_job_source(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_job_source(text, integer) to service_role;
revoke all on function public.commit_job_source_snapshot(text, uuid, uuid, jsonb, text, text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.commit_job_source_snapshot(text, uuid, uuid, jsonb, text, text, text, bigint, integer)
  to service_role;
revoke all on function public.fail_job_source_poll(text, uuid, uuid, text, boolean, integer, text)
  from public, anon, authenticated;
grant execute on function public.fail_job_source_poll(text, uuid, uuid, text, boolean, integer, text)
  to service_role;


-- Register only reviewed public boards. Replaying this import preserves existing
-- policy and pause controls; it cannot silently re-enable a blocked source.
create function public.register_reviewed_job_sources(p_registry_release text, p_sources jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_entry jsonb; v_provider text; v_tenant text; v_name text; v_url text;
  v_employer uuid; v_source public.job_sources%rowtype; v_options jsonb;
  v_created integer := 0; v_existing integer := 0;
begin
  if current_user <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_registry_release !~ '^job-source-registry/[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_sources is null or jsonb_typeof(p_sources)<>'array' or jsonb_array_length(p_sources) not between 1 and 100 then
    raise exception 'SOURCE_REGISTRY_INVALID' using errcode='22023'; end if;
  for v_entry in select value from jsonb_array_elements(p_sources) loop
    v_provider := v_entry->>'provider'; v_tenant := v_entry->>'tenantKey'; v_name := btrim(v_entry->>'employerName'); v_url := v_entry->>'publicBoardUrl';
    if v_provider is null or v_provider not in ('GREENHOUSE','LEVER','ASHBY')
      or v_tenant is null or v_tenant !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      or v_name is null or char_length(v_name) not between 1 and 200
      or v_url is distinct from (case v_provider when 'GREENHOUSE' then 'https://job-boards.greenhouse.io/' when 'LEVER' then 'https://jobs.lever.co/' else 'https://jobs.ashbyhq.com/' end || v_tenant)
      or jsonb_typeof(v_entry->'evidenceUrls') is distinct from 'array'
      or jsonb_array_length(v_entry->'evidenceUrls') not between 1 and 5
      or (v_entry->>'verifiedAt')::timestamptz < statement_timestamp()-interval '30 days'
      or (v_entry->>'verifiedAt')::timestamptz > statement_timestamp()+interval '5 minutes'
      or v_entry->>'verifiedAt' is null then
      raise exception 'SOURCE_REGISTRY_ENTRY_INVALID' using errcode='22023'; end if;
    -- Serialize concurrent seed attempts without relying on employer name uniqueness.
    perform pg_advisory_xact_lock(hashtextextended(v_provider || ':' || v_tenant, 0));
    select * into v_source from public.job_sources where provider=v_provider and tenant_key=v_tenant for update;
    if found then v_existing := v_existing+1; continue; end if;
    select id into v_employer from public.employers where canonical_name=v_name order by id limit 1;
    if v_employer is null then insert into public.employers(canonical_name) values(v_name) returning id into v_employer; end if;
    v_options := jsonb_build_object('poll_interval_minutes',1440,'registry_release',p_registry_release,
      'verified_at',v_entry->>'verifiedAt','evidence_urls',v_entry->'evidenceUrls','category',v_entry->>'category');
    if v_provider='GREENHOUSE' then v_options:=v_options||'{"include_content":true}'::jsonb; end if;
    if v_provider='ASHBY' then v_options:=v_options||'{"include_compensation":true}'::jsonb; end if;
    insert into public.job_sources(employer_id,provider,tenant_key,list_url,application_domain,policy_status,polling_enabled,adapter_release,source_options)
    values(v_employer,v_provider,v_tenant,v_url,
      case v_provider when 'GREENHOUSE' then 'job-boards.greenhouse.io' when 'LEVER' then 'jobs.lever.co' else 'jobs.ashbyhq.com' end,
      'ALLOWLISTED',true,lower(v_provider)||'/0.1',v_options);
    v_created:=v_created+1;
  end loop;
  return jsonb_build_object('created',v_created,'existing',v_existing,'registry_release',p_registry_release);
end; $$;
revoke all on function public.register_reviewed_job_sources(text,jsonb) from public,anon,authenticated;
grant execute on function public.register_reviewed_job_sources(text,jsonb) to service_role;

-- An outage is uncertainty, never evidence that an employer closed a job.
create function public.mark_stale_catalog_jobs() returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if current_user <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  update public.source_job_listings l set state='STALE',updated_at=statement_timestamp()
  from public.job_sources s where s.id=l.source_id and s.policy_status='ALLOWLISTED'
    and l.state='OPEN' and l.last_seen_at<statement_timestamp()-interval '7 days';
  update public.jobs j set state='STALE',updated_at=statement_timestamp()
  from public.source_job_listings l where j.source_listing_id=l.id and l.state='STALE' and j.state='OPEN';
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.mark_stale_catalog_jobs() from public,anon,authenticated;
grant execute on function public.mark_stale_catalog_jobs() to service_role;

create function private.catalog_refresh_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_candidates integer; v_result jsonb;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select count(*) into v_candidates from public.candidates c
  join public.workspace_memberships m on m.workspace_id=c.workspace_id and m.auth_user_id=v_actor and m.status='ACTIVE'
  join public.workspaces w on w.id=c.workspace_id and w.kind='PERSONAL' and w.status='ACTIVE' and w.personal_owner_auth_user_id=v_actor
  where c.auth_user_id=v_actor and c.status in ('ONBOARDING','ACTIVE','PAUSED');
  if v_candidates<>1 then raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode='42501'; end if;
  with active as (select * from public.job_sources where policy_status='ALLOWLISTED' and polling_enabled),
  visible as (select j.id,j.employer_id from public.jobs j join public.source_job_listings l on l.id=j.source_listing_id
    join active s on s.id=l.source_id join public.job_versions v on v.job_id=j.id and v.id=j.current_version_id
    where j.state='OPEN' and l.state='OPEN' and j.last_seen_at>=statement_timestamp()-interval '7 days')
  select jsonb_build_object('open_job_count',(select count(*) from visible),
    'employer_count',(select count(distinct employer_id) from visible),
    'active_source_count',count(*),'last_completed_refresh_at',max(last_successful_poll_at),
    'oldest_source_refresh_at',min(last_successful_poll_at),
    'overdue_source_count',count(*) filter(where next_poll_at<statement_timestamp()),
    'failing_source_count',count(*) filter(where last_error_code is not null),
    'stale_source_count',count(*) filter(where last_successful_poll_at is null or last_successful_poll_at<statement_timestamp()-interval '2 days'))
    into v_result from active;
  return v_result;
end; $$;
revoke all on function private.catalog_refresh_stats() from public,anon;
grant execute on function private.catalog_refresh_stats() to authenticated;
create function public.catalog_refresh_stats() returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.catalog_refresh_stats(); $$;
revoke all on function public.catalog_refresh_stats() from public,anon;
grant execute on function public.catalog_refresh_stats() to authenticated;
