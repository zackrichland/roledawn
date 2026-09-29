-- Local PGlite check for 20260928224500_scalable_catalog_commit.sql.
--   node scripts/migration-harness.mjs supabase/checks/scalable_catalog_commit.sql
-- Synthetic rows only; everything is rolled back. RPCs run as service_role.
begin;
create temporary table scalable_catalog_checks(check_name text primary key, passed boolean not null) on commit drop;

-- A complete snapshot for synthetic job numbers. p_tag changes content hashes
-- (a new version); p_unlisted marks entries listed=false.
create function pg_temp.catalog_snapshot(p_tenant text, p_ids integer[], p_tag text default 'v1', p_unlisted integer[] default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('schema_version', 1, 'complete', true, 'observed_at', statement_timestamp(), 'issues', '[]'::jsonb,
    'jobs', coalesce(jsonb_agg(jsonb_build_object(
      'external_job_id', id::text,
      'title', 'Synthetic role ' || id || ' ' || p_tag,
      'canonical_job_url', 'https://job-boards.greenhouse.io/' || p_tenant || '/jobs/' || id,
      'apply_url', 'https://job-boards.greenhouse.io/' || p_tenant || '/jobs/' || id,
      'description_text', case when id % 97 = 0 then '' else 'Synthetic description ' || id || ' ' || p_tag end,
      'locations', jsonb_build_array(jsonb_build_object('label', ' Remote ', 'country_code', null), jsonb_build_object('label', 'New York, NY', 'country_code', 'US'), jsonb_build_object('label', '  ')),
      'work_mode', 'remote', 'employment_type', 'full_time', 'published_at', '2026-09-01T00:00:00.000Z',
      'observed_at', statement_timestamp(), 'listed', not (id = any(p_unlisted)),
      'content_hash', encode(sha256(convert_to(id || ':' || p_tag, 'UTF8')), 'hex'),
      'normalized_data', jsonb_build_object('schema_version', 1, 'provider', 'GREENHOUSE', 'tenant_key', p_tenant, 'external_job_id', id::text)
    ) order by id::text), '[]'::jsonb))
  from unnest(p_ids) as id
$$;

create function pg_temp.catalog_claim(p_source uuid, p_worker text default 'scalable-catalog-check') returns uuid
language plpgsql as $$
declare v_claim record;
begin
  update public.job_sources set next_poll_at = '0001-01-01' where id = p_source;
  execute 'set local role service_role';
  select * into v_claim from public.claim_due_job_source(p_worker, 120);
  execute 'reset role';
  if v_claim.source_id is distinct from p_source then raise exception 'CHECK_CLAIM_WRONG_SOURCE %', v_claim.source_id; end if;
  return v_claim.ingestion_run_id;
end $$;

create function pg_temp.catalog_commit(p_source uuid, p_run uuid, p_snapshot jsonb, p_status integer default 200,
  p_etag text default 'etag', p_worker text default 'scalable-catalog-check', p_raw_bytes bigint default 1000)
returns boolean language plpgsql as $$
declare v_ok boolean;
begin
  execute 'set local role service_role';
  v_ok := public.commit_job_source_snapshot(p_worker, p_source, p_run, p_snapshot,
    'https://boards-api.greenhouse.io/v1/boards/check/jobs?content=true', p_etag,
    case when p_status = 304 then null else repeat('a', 64) end, p_raw_bytes, p_status);
  execute 'reset role';
  return v_ok;
end $$;

-- Expect one SQLSTATE and message; the failed commit rolls back entirely.
create function pg_temp.catalog_expect_error(p_source uuid, p_run uuid, p_snapshot jsonb, p_state text, p_message text,
  p_worker text default 'scalable-catalog-check', p_raw_bytes bigint default 1000) returns void
language plpgsql as $$
begin
  begin
    perform pg_temp.catalog_commit(p_source, p_run, p_snapshot, 200, 'etag', p_worker, p_raw_bytes);
  exception when others then
    if sqlstate <> p_state or sqlerrm <> p_message then
      raise exception 'CHECK_WRONG_ERROR expected %/% got %/%', p_state, p_message, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'CHECK_ERROR_NOT_RAISED %', p_message;
end $$;

do $check$
declare
  v_tenant text := 'scalable_catalog_check_' || replace(gen_random_uuid()::text, '-', '');
  v_employer uuid; v_source uuid; v_run uuid; v_snapshot jsonb; v_all integer[]; v_seen timestamptz;
  v_count integer; v_row record;
begin
  insert into public.employers(canonical_name) values ('Scalable Catalog Check') returning id into v_employer;
  insert into public.job_sources(employer_id, provider, tenant_key, list_url, application_domain, policy_status,
    polling_enabled, adapter_release, source_options, next_poll_at)
  values (v_employer, 'GREENHOUSE', v_tenant, 'https://job-boards.greenhouse.io/' || v_tenant, 'job-boards.greenhouse.io',
    'ALLOWLISTED', true, 'greenhouse/0.1', '{"poll_interval_minutes":1440}', '0001-01-01')
  returning id into v_source;
  select array_agg(i) into v_all from generate_series(1, 1500) as i;

  -- 1. A 1,500-job first snapshot commits in one call with exact effects.
  v_run := pg_temp.catalog_claim(v_source);
  if not pg_temp.catalog_commit(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, v_all), 200, 'etag-1') then
    raise exception 'CHECK_FIRST_COMMIT_REJECTED';
  end if;
  select count(*) into v_count from public.source_job_listings l where l.source_id = v_source and l.state = 'OPEN';
  if v_count <> 1500 or (select count(*) from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id
      where l.source_id = v_source and j.state = 'OPEN' and j.current_version_id is not null) <> 1500
    or (select count(*) from public.job_versions v join public.jobs j on j.id = v.job_id join public.source_job_listings l on l.id = j.source_listing_id
      where l.source_id = v_source and v.version_number = 1) <> 1500
    or (select count(*) from public.source_job_observations where source_id = v_source) <> 1500 then
    raise exception 'CHECK_FIRST_COMMIT_COUNTS';
  end if;
  select * into v_row from public.ingestion_runs where id = v_run;
  if v_row.status <> 'SUCCEEDED' or v_row.observed_count <> 1500 or not v_row.snapshot_complete
    or (v_row.checkpoint ->> 'closure_applied')::boolean is not true then
    raise exception 'CHECK_FIRST_RUN_STATE %', row_to_json(v_row);
  end if;
  select * into v_row from public.job_sources where id = v_source;
  if v_row.poll_lease_owner is not null or v_row.last_etag <> 'etag-1' or v_row.consecutive_failures <> 0
    or v_row.next_poll_at < statement_timestamp() + interval '1439 minutes' then
    raise exception 'CHECK_FIRST_SOURCE_STATE';
  end if;
  select v.* into v_row from public.job_versions v join public.jobs j on j.id = v.job_id
    join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source and l.external_job_id = '97';
  if v_row.location_text <> 'Remote · New York, NY' or v_row.employer_name <> 'Scalable Catalog Check'
    or v_row.description_text <> 'Description unavailable from the official feed.'
    or v_row.work_mode <> 'REMOTE' or v_row.employment_type <> 'FULL_TIME'
    or v_row.published_at <> '2026-09-01T00:00:00Z'::timestamptz or v_row.normalized_data ->> 'external_job_id' <> '97' then
    raise exception 'CHECK_VERSION_FIELDS %', row_to_json(v_row);
  end if;
  insert into scalable_catalog_checks values ('bulk_first_snapshot_exact', true);

  -- 2. Replaying unchanged content adds no versions or observations.
  select max(j.last_seen_at) into v_seen from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source;
  v_run := pg_temp.catalog_claim(v_source);
  perform pg_temp.catalog_commit(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, v_all), 200, 'etag-1');
  if (select count(*) from public.job_versions v join public.jobs j on j.id = v.job_id join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source) <> 1500
    or (select count(*) from public.source_job_observations where source_id = v_source) <> 1500
    or (select min(j.last_seen_at) from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source) < v_seen then
    raise exception 'CHECK_REPLAY_NOT_IDEMPOTENT';
  end if;
  insert into scalable_catalog_checks values ('replay_is_idempotent', true);

  -- 3. Changed content versions exactly the changed jobs; listed=false closes.
  v_run := pg_temp.catalog_claim(v_source);
  v_snapshot := pg_temp.catalog_snapshot(v_tenant, (select array_agg(i) from generate_series(1, 150) i), 'v2', array[1, 2, 3]);
  v_snapshot := jsonb_set(v_snapshot, '{jobs}', (v_snapshot -> 'jobs') || (pg_temp.catalog_snapshot(v_tenant, (select array_agg(i) from generate_series(151, 1500) i)) -> 'jobs'));
  perform pg_temp.catalog_commit(v_source, v_run, v_snapshot, 200, 'etag-2');
  if (select count(*) from public.job_versions v join public.jobs j on j.id = v.job_id join public.source_job_listings l on l.id = j.source_listing_id
      where l.source_id = v_source and v.version_number = 2 and v.id = j.current_version_id) <> 150
    or (select count(*) from public.source_job_observations where source_id = v_source) <> 1650
    or (select count(*) from public.source_job_listings where source_id = v_source and state = 'CLOSED' and closed_at is not null) <> 3
    or (select count(*) from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id
      where l.source_id = v_source and j.state = 'CLOSED' and j.closed_at is not null) <> 3 then
    raise exception 'CHECK_VERSIONING_OR_UNLISTED';
  end if;
  -- Reverting to earlier content reuses the earlier version instead of numbering a new one.
  v_run := pg_temp.catalog_claim(v_source);
  perform pg_temp.catalog_commit(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, v_all), 200, 'etag-3');
  if (select count(*) from public.job_versions v join public.jobs j on j.id = v.job_id join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source) <> 1650
    or (select count(*) from public.jobs j join public.job_versions v on v.id = j.current_version_id join public.source_job_listings l on l.id = j.source_listing_id
      where l.source_id = v_source and v.version_number = 1 and j.state = 'OPEN') <> 1500
    or (select count(*) from public.source_job_listings where source_id = v_source and state = 'OPEN' and closed_at is null) <> 1500 then
    raise exception 'CHECK_REVERT_OR_RELIST';
  end if;
  insert into scalable_catalog_checks values ('versions_unlisted_and_relisted', true);

  -- 4. An ordinary absence (not a large drop) closes exactly the missing listings.
  v_run := pg_temp.catalog_claim(v_source);
  perform pg_temp.catalog_commit(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, (select array_agg(i) from generate_series(101, 1500) i)), 200, 'etag-4');
  if (select count(*) from public.source_job_listings where source_id = v_source and state = 'CLOSED') <> 100
    or (select count(*) from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source and j.state = 'CLOSED') <> 100
    or exists (select 1 from public.source_job_listings where source_id = v_source and state = 'CLOSED' and external_job_id::integer > 100)
    or (select status from public.ingestion_runs where id = v_run) <> 'SUCCEEDED' then
    raise exception 'CHECK_ORDINARY_CLOSURE';
  end if;
  insert into scalable_catalog_checks values ('ordinary_absence_closes_only_missing', true);

  -- 5. A large drop is held STALE, uncached and pending; it never closes.
  v_run := pg_temp.catalog_claim(v_source);
  v_snapshot := pg_temp.catalog_snapshot(v_tenant, (select array_agg(i) from generate_series(101, 500) i));
  perform pg_temp.catalog_commit(v_source, v_run, v_snapshot, 200, 'etag-5');
  if (select count(*) from public.source_job_listings where source_id = v_source and state = 'STALE') <> 1000
    or (select count(*) from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source and j.state = 'STALE') <> 1000
    or (select count(*) from public.source_job_listings where source_id = v_source and state = 'CLOSED') <> 100
    or (select status from public.ingestion_runs where id = v_run) <> 'PARTIAL'
    or (select last_etag from public.job_sources where id = v_source) is not null
    or (select pending_closure_fingerprint from public.job_sources where id = v_source) is null then
    raise exception 'CHECK_LARGE_DROP_HELD';
  end if;
  -- The same drop observed again six hours later is corroborated and closes.
  update public.job_sources set pending_closure_observed_at = statement_timestamp() - interval '7 hours' where id = v_source;
  v_run := pg_temp.catalog_claim(v_source);
  perform pg_temp.catalog_commit(v_source, v_run, v_snapshot, 200, 'etag-6');
  if (select count(*) from public.source_job_listings where source_id = v_source and state = 'CLOSED') <> 1100
    or (select count(*) from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id where l.source_id = v_source and j.state = 'CLOSED') <> 1100
    or (select count(*) from public.source_job_listings where source_id = v_source and state = 'OPEN') <> 400
    or (select status from public.ingestion_runs where id = v_run) <> 'SUCCEEDED'
    or (select pending_closure_fingerprint from public.job_sources where id = v_source) is not null
    or (select last_etag from public.job_sources where id = v_source) <> 'etag-6' then
    raise exception 'CHECK_CORROBORATED_CLOSURE';
  end if;
  insert into scalable_catalog_checks values ('large_drop_stale_then_corroborated_closure', true);

  -- 6. A verified 304 restores stale-but-unchanged rows without a payload.
  update public.source_job_listings set state = 'STALE' where source_id = v_source and state = 'OPEN' and external_job_id::integer <= 110;
  update public.jobs j set state = 'STALE' from public.source_job_listings l
    where l.id = j.source_listing_id and l.source_id = v_source and l.state = 'STALE';
  v_run := pg_temp.catalog_claim(v_source);
  perform pg_temp.catalog_commit(v_source, v_run, null, 304, 'etag-6');
  select * into v_row from public.ingestion_runs where id = v_run;
  if (select count(*) from public.jobs j join public.source_job_listings l on l.id = j.source_listing_id
      where l.source_id = v_source and j.state = 'OPEN' and l.state = 'OPEN') <> 400
    or v_row.status <> 'SUCCEEDED' or v_row.response_status <> 304 or v_row.observed_count <> 400 then
    raise exception 'CHECK_NOT_MODIFIED %', row_to_json(v_row);
  end if;
  insert into scalable_catalog_checks values ('not_modified_restores_unchanged_rows', true);

  -- 7. Invalid snapshots fail closed with the same codes and change nothing.
  v_run := pg_temp.catalog_claim(v_source);
  v_snapshot := pg_temp.catalog_snapshot(v_tenant, array[101, 102]);
  perform pg_temp.catalog_expect_error(v_source, v_run, jsonb_set(v_snapshot, '{jobs,0,content_hash}', '"not-a-hash"'), '22023', 'SOURCE_JOB_INVALID');
  perform pg_temp.catalog_expect_error(v_source, v_run, jsonb_set(v_snapshot, '{jobs,0,published_at}', '"not a time"'), '22023', 'SOURCE_JOB_TIME_INVALID');
  perform pg_temp.catalog_expect_error(v_source, v_run, jsonb_set(v_snapshot, '{jobs,1,external_job_id}', '"101"'), '22023', 'SOURCE_SNAPSHOT_INCOMPLETE_OR_DUPLICATE');
  perform pg_temp.catalog_expect_error(v_source, v_run, jsonb_set(v_snapshot, '{jobs,1,external_job_id}', '" 101 "'), '22023', 'SOURCE_SNAPSHOT_INCOMPLETE_OR_DUPLICATE');
  perform pg_temp.catalog_expect_error(v_source, v_run, jsonb_set(v_snapshot, '{jobs,0,canonical_job_url}', '"https://job-boards.greenhouse.io/moved/jobs/101"'), '23505', 'SOURCE_JOB_IDENTITY_CONFLICT');
  perform pg_temp.catalog_expect_error(v_source, v_run, jsonb_set(v_snapshot, '{complete}', 'false'), '22023', 'SOURCE_SNAPSHOT_INCOMPLETE_OR_DUPLICATE');
  perform pg_temp.catalog_expect_error(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, (select array_agg(i) from generate_series(1, 5001) i)), '22023', 'SOURCE_SNAPSHOT_INVALID');
  perform pg_temp.catalog_expect_error(v_source, v_run, v_snapshot, '22023', 'SOURCE_COMMIT_INPUT_INVALID', 'scalable-catalog-check', 67108865);
  perform pg_temp.catalog_expect_error(v_source, v_run, v_snapshot, '55000', 'SOURCE_POLL_LEASE_INVALID', 'another-worker');
  if (select status from public.ingestion_runs where id = v_run) <> 'RUNNING'
    or (select count(*) from public.source_job_listings where source_id = v_source and state = 'OPEN') <> 400 then
    raise exception 'CHECK_REJECTION_CHANGED_STATE';
  end if;
  -- The 64 MiB database bound itself is accepted; the lease still holds.
  perform pg_temp.catalog_commit(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, (select array_agg(i) from generate_series(101, 500) i)), 200, 'etag-7', 'scalable-catalog-check', 67108864);
  insert into scalable_catalog_checks values ('rejections_fail_closed_with_stable_codes', true);

  -- 8. An expired lease is reconciled and backed off, not re-claimed at once.
  v_run := pg_temp.catalog_claim(v_source);
  update public.job_sources set poll_lease_expires_at = statement_timestamp() - interval '1 second', next_poll_at = '0001-01-01' where id = v_source;
  execute 'set local role service_role';
  select count(*) into v_count from public.claim_due_job_source('scalable-catalog-other', 120) as claim where claim.source_id = v_source;
  execute 'reset role';
  select * into v_row from public.job_sources where id = v_source;
  if v_count <> 0 or v_row.poll_lease_owner is not null or v_row.last_error_code <> 'JOB_SOURCE_LEASE_EXPIRED'
    or v_row.consecutive_failures <> 1 or v_row.next_poll_at < statement_timestamp() + interval '14 minutes'
    or (select status || ':' || error_code from public.ingestion_runs where id = v_run) <> 'FAILED:JOB_SOURCE_LEASE_EXPIRED' then
    raise exception 'CHECK_EXPIRED_LEASE_RECONCILIATION %', row_to_json(v_row);
  end if;
  -- The fenced worker's late commit is refused, and a later claim starts cleanly.
  perform pg_temp.catalog_expect_error(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, array[101]), '55000', 'SOURCE_POLL_LEASE_INVALID');
  v_run := pg_temp.catalog_claim(v_source);
  perform pg_temp.catalog_commit(v_source, v_run, pg_temp.catalog_snapshot(v_tenant, (select array_agg(i) from generate_series(101, 500) i)), 200, 'etag-8');
  if (select consecutive_failures from public.job_sources where id = v_source) <> 0
    or (select last_error_code from public.job_sources where id = v_source) is not null then
    raise exception 'CHECK_RECOVERY_AFTER_RECONCILIATION';
  end if;
  insert into scalable_catalog_checks values ('expired_lease_backs_off_and_fences_late_commit', true);

  -- 9. Only the commit RPC carries the hoisted statement budget; grants stay service-only.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'commit_job_source_snapshot' and 'statement_timeout=60s' = any(p.proconfig))
    or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'claim_due_job_source' and exists (select 1 from unnest(p.proconfig) c where c like 'statement_timeout=%'))
    or has_function_privilege('anon', 'public.commit_job_source_snapshot(text,uuid,uuid,jsonb,text,text,text,bigint,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.commit_job_source_snapshot(text,uuid,uuid,jsonb,text,text,text,bigint,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_due_job_source(text,integer)', 'execute')
    or not has_function_privilege('service_role', 'public.commit_job_source_snapshot(text,uuid,uuid,jsonb,text,text,text,bigint,integer)', 'execute') then
    raise exception 'CHECK_FUNCTION_CONFIG_OR_GRANTS';
  end if;
  insert into scalable_catalog_checks values ('hoisted_timeout_and_service_only_grants', true);
end;
$check$;

select check_name, passed from scalable_catalog_checks order by check_name;
rollback;
