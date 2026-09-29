-- Run after the catalog expansion migration. Every fixture and change rolls back.
begin;
set local role service_role;
do $$
declare
  v_source uuid; v_employer uuid; v_claim record; v_snapshot jsonb; v_before bigint;
  v_run uuid; v_count integer; v_result jsonb; v_token text := 'catalog_acceptance_'||replace(extensions.gen_random_uuid()::text,'-','');
  v_hash text:=repeat('a',64); v_endpoint text; v_jobs jsonb; v_registry jsonb;
begin
  v_endpoint:='https://boards-api.greenhouse.io/v1/boards/'||v_token||'/jobs?content=true';
  v_registry:=jsonb_build_array(jsonb_build_object('provider','GREENHOUSE','tenantKey',v_token,'employerName','Synthetic Catalog Acceptance',
    'publicBoardUrl','https://job-boards.greenhouse.io/'||v_token,'verifiedAt',statement_timestamp(),
    'evidenceUrls',jsonb_build_array(v_endpoint),'category','Synthetic'));
  v_result:=public.register_reviewed_job_sources('job-source-registry/2026-09-16',v_registry);
  if (v_result->>'created')::integer<>1 then raise exception 'REGISTRY_INSERT_FAILED'; end if;
  v_result:=public.register_reviewed_job_sources('job-source-registry/2026-09-16',v_registry);
  if (v_result->>'existing')::integer<>1 then raise exception 'REGISTRY_REPLAY_FAILED'; end if;
  select id,employer_id into strict v_source,v_employer from public.job_sources where provider='GREENHOUSE' and tenant_key=v_token;
  update public.job_sources set polling_enabled=false where id=v_source;
  perform public.register_reviewed_job_sources('job-source-registry/2026-09-16',v_registry);
  if (select polling_enabled from public.job_sources where id=v_source) then raise exception 'REGISTRY_REENABLED_PAUSED_SOURCE'; end if;
  update public.job_sources set polling_enabled=true,next_poll_at='0001-01-01' where id=v_source;
  select * into strict v_claim from public.claim_due_job_source('catalog-acceptance',120);
  if v_claim.source_id<>v_source then raise exception 'FIXTURE_SOURCE_NOT_CLAIMED'; end if;
  v_run:=v_claim.ingestion_run_id;
  begin
    if exists(select 1 from public.claim_due_job_source('other-worker',120) where source_id=v_source) then raise exception 'LEASE_EXCLUSION_FAILED'; end if;
    -- If another real source was due, undo that temporary claim immediately.
    raise exception 'ROLLBACK_SECOND_CLAIM' using errcode='P0002';
  exception when no_data_found then null; end;
  update public.job_sources set poll_lease_expires_at=statement_timestamp()-interval '1 second' where id=v_source;
  -- An abandoned lease is closed and backed off, never re-claimed at once.
  begin
    perform public.claim_due_job_source('catalog-acceptance',120);
    if (select status||':'||error_code from public.ingestion_runs where id=v_run)<>'FAILED:JOB_SOURCE_LEASE_EXPIRED'
      or (select consecutive_failures from public.job_sources where id=v_source)<>1
      or (select next_poll_at from public.job_sources where id=v_source)<statement_timestamp()+interval '14 minutes'
      or (select poll_lease_owner from public.job_sources where id=v_source) is not null then
      raise exception 'EXPIRED_RUN_NOT_RECONCILED';
    end if;
    -- If another real source was claimed instead, undo that claim immediately.
    raise exception 'ROLLBACK_RECONCILING_CLAIM' using errcode='P0002';
  exception when no_data_found then null; end;
  update public.ingestion_runs set status='FAILED',error_code='JOB_SOURCE_LEASE_EXPIRED',finished_at=statement_timestamp() where id=v_run;
  update public.job_sources set poll_lease_owner=null,poll_lease_expires_at=null,next_poll_at='0001-01-01' where id=v_source;
  select * into strict v_claim from public.claim_due_job_source('catalog-acceptance',120);
  if v_claim.source_id<>v_source then raise exception 'FIXTURE_SOURCE_NOT_RECLAIMED'; end if;
  select jsonb_agg(jsonb_build_object('external_job_id',i::text,'title','Synthetic role '||i,
    'canonical_job_url','https://job-boards.greenhouse.io/'||v_token||'/jobs/'||i,
    'apply_url','https://job-boards.greenhouse.io/'||v_token||'/jobs/'||i,
    'description_text','Synthetic description','locations','[]'::jsonb,'work_mode','UNKNOWN','employment_type','UNSPECIFIED',
    'observed_at',statement_timestamp(),'listed',true,'content_hash',v_hash,'normalized_data','{}'::jsonb)) into v_jobs from generate_series(1,10) i;
  v_snapshot:=jsonb_build_object('schema_version',1,'complete',true,'observed_at',statement_timestamp(),'jobs',v_jobs,'issues','[]'::jsonb);
  -- Establish old first-seen timestamps without bypassing preservation triggers.
  insert into public.source_job_listings(source_id,external_job_id,source_url,apply_url,first_seen_at,last_seen_at)
  select v_source,entry->>'external_job_id',entry->>'canonical_job_url',entry->>'apply_url',statement_timestamp()-interval '9 days',statement_timestamp()-interval '8 days'
    from jsonb_array_elements(v_jobs) entry;
  insert into public.jobs(employer_id,source_listing_id,canonical_url,state,first_seen_at,last_seen_at)
  select v_employer,id,source_url,'OPEN',first_seen_at,last_seen_at from public.source_job_listings where source_id=v_source;
  perform public.commit_job_source_snapshot('catalog-acceptance',v_source,v_claim.ingestion_run_id,v_snapshot,v_endpoint,'etag1',v_hash,1000,200);
  select count(*) into v_before from public.job_versions where job_id in(select id from public.jobs where employer_id=v_employer);
  if v_before<>10 then raise exception 'SNAPSHOT_COUNT_FAILED'; end if;
  update public.job_sources set next_poll_at='0001-01-01' where id=v_source;
  select * into strict v_claim from public.claim_due_job_source('catalog-acceptance',120);
  perform public.commit_job_source_snapshot('catalog-acceptance',v_source,v_claim.ingestion_run_id,v_snapshot,v_endpoint,'etag1',v_hash,1000,200);
  if (select count(*) from public.job_versions where job_id in(select id from public.jobs where employer_id=v_employer))<>v_before then raise exception 'VERSION_DEDUP_FAILED'; end if;
  -- Stale is reversible uncertainty. A valid 304 refresh restores the unchanged set.
  update public.source_job_listings set last_seen_at=statement_timestamp()-interval '8 days' where source_id=v_source;
  update public.jobs set last_seen_at=statement_timestamp()-interval '8 days' where employer_id=v_employer;
  perform public.mark_stale_catalog_jobs();
  if (select count(*) from public.jobs where employer_id=v_employer and state='STALE')<>10 then raise exception 'STALE_MARK_FAILED'; end if;
  update public.job_sources set next_poll_at='0001-01-01' where id=v_source;
  select * into strict v_claim from public.claim_due_job_source('catalog-acceptance',120);
  perform public.commit_job_source_snapshot('catalog-acceptance',v_source,v_claim.ingestion_run_id,null,v_endpoint,'etag1',null,0,304);
  if (select count(*) from public.jobs where employer_id=v_employer and state='OPEN' and last_seen_at>=statement_timestamp()-interval '1 minute')<>10 then raise exception 'NOT_MODIFIED_FRESHNESS_FAILED'; end if;
  -- One empty/full feed is held as stale; repeated emptiness after six hours closes.
  v_snapshot:=jsonb_set(v_snapshot,'{jobs}','[]'::jsonb);
  update public.job_sources set next_poll_at='0001-01-01' where id=v_source;
  select * into strict v_claim from public.claim_due_job_source('catalog-acceptance',120);
  perform public.commit_job_source_snapshot('catalog-acceptance',v_source,v_claim.ingestion_run_id,v_snapshot,v_endpoint,'empty-etag',v_hash,10,200);
  if exists(select 1 from public.jobs where employer_id=v_employer and state<>'STALE') then raise exception 'SINGLE_DROP_CLOSED_OR_RETAINED_CURRENT'; end if;
  if (select last_etag from public.job_sources where id=v_source) is not null then raise exception 'SUSPICIOUS_DROP_CACHED'; end if;
  update public.job_sources set next_poll_at='0001-01-01',pending_closure_observed_at=statement_timestamp()-interval '7 hours' where id=v_source;
  select * into strict v_claim from public.claim_due_job_source('catalog-acceptance',120);
  perform public.commit_job_source_snapshot('catalog-acceptance',v_source,v_claim.ingestion_run_id,v_snapshot,v_endpoint,'empty-etag',v_hash,10,200);
  if (select count(*) from public.jobs where employer_id=v_employer and state='CLOSED')<>10 then raise exception 'CORROBORATED_CLOSURE_FAILED'; end if;
  -- Transient errors back off and never infer closure; malformed snapshots fail.
  update public.job_sources set next_poll_at='0001-01-01' where id=v_source;
  select * into strict v_claim from public.claim_due_job_source('catalog-acceptance',120);
  begin
    perform public.commit_job_source_snapshot('catalog-acceptance',v_source,v_claim.ingestion_run_id,jsonb_set(v_snapshot,'{complete}','false'),v_endpoint,null,v_hash,10,200);
    raise exception 'INCOMPLETE_SNAPSHOT_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  perform public.fail_job_source_poll('catalog-acceptance',v_source,v_claim.ingestion_run_id,'JOB_SOURCE_HTTP_ERROR',true,503,v_endpoint);
  if (select consecutive_failures from public.job_sources where id=v_source)<>1 then raise exception 'FAILURE_COUNT_FAILED'; end if;
  if (select next_poll_at from public.job_sources where id=v_source)<statement_timestamp()+interval '14 minutes' then raise exception 'FAILURE_BACKOFF_FAILED'; end if;
  if has_function_privilege('anon','public.catalog_refresh_stats()','execute')
    or has_function_privilege('authenticated','public.register_reviewed_job_sources(text,jsonb)','execute')
    or has_function_privilege('authenticated','public.claim_due_job_source(text,integer)','execute') then raise exception 'CATALOG_PRIVILEGES_UNSAFE'; end if;
  raise notice 'Catalog acceptance: registry/replay/pause, lease/recovery, dedup, stale/304, corroborated closure, rejection/backoff and grants passed';
end; $$;
rollback;
