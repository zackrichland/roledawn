-- RoleDawn / HireWire: candidate-safe catalog search, replay-safe saved/queue
-- commands, and one service-owned polling lane for allowlisted ATS sources.

alter table public.job_sources
  add column if not exists source_options jsonb not null default '{}'::jsonb,
  add column if not exists next_poll_at timestamptz not null default now(),
  add column if not exists last_successful_poll_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_etag text,
  add column if not exists poll_lease_owner text,
  add column if not exists poll_lease_expires_at timestamptz;

alter table public.job_sources
  add constraint job_sources_source_options_object_check
    check (jsonb_typeof(source_options) = 'object'),
  add constraint job_sources_poll_lease_check
    check (
      (poll_lease_owner is null and poll_lease_expires_at is null)
      or (btrim(poll_lease_owner) <> '' and poll_lease_expires_at is not null)
    );

create index job_sources_due_poll_idx
  on public.job_sources (next_poll_at, id)
  where polling_enabled and policy_status = 'ALLOWLISTED';

create or replace function private.preserve_catalog_first_seen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.first_seen_at := old.first_seen_at;
  return new;
end;
$$;

create trigger source_job_listings_preserve_first_seen
  before update on public.source_job_listings
  for each row execute function private.preserve_catalog_first_seen();
create trigger jobs_preserve_first_seen
  before update on public.jobs
  for each row execute function private.preserve_catalog_first_seen();

alter table public.job_versions
  add column search_document tsvector generated always as (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(employer_name, '') || ' ' ||
      coalesce(location_text, '') || ' ' || coalesce(description_text, '')
    )
  ) stored;

create index job_versions_search_document_idx
  on public.job_versions using gin (search_document);

-- Authenticated users may read only candidate-facing columns, and only when a
-- job is allowlisted or already belongs to their own application. The search
-- RPC below applies the stricter open/current/allowlisted catalog contract.
drop policy if exists jobs_authenticated_select on public.jobs;
drop policy if exists job_versions_authenticated_select on public.job_versions;

create policy jobs_candidate_visible_select
  on public.jobs for select to authenticated
  using (
    exists (
      select 1
      from public.source_job_listings as listing
      join public.job_sources as source on source.id = listing.source_id
      where listing.id = jobs.source_listing_id
        and source.policy_status = 'ALLOWLISTED'
    )
    or exists (
      select 1
      from public.applications as application
      join public.candidates as candidate
        on candidate.workspace_id = application.workspace_id
       and candidate.id = application.candidate_id
      where application.job_id = jobs.id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create policy job_versions_candidate_visible_select
  on public.job_versions for select to authenticated
  using (
    exists (
      select 1
      from public.jobs as job
      join public.source_job_listings as listing on listing.id = job.source_listing_id
      join public.job_sources as source on source.id = listing.source_id
      where job.id = job_versions.job_id
        and source.policy_status = 'ALLOWLISTED'
    )
    or exists (
      select 1
      from public.applications as application
      join public.candidates as candidate
        on candidate.workspace_id = application.workspace_id
       and candidate.id = application.candidate_id
      where application.job_id = job_versions.job_id
        and application.job_version_id = job_versions.id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

drop policy if exists candidate_decisions_member_select on public.candidate_job_decisions;
create policy candidate_job_decisions_candidate_select
  on public.candidate_job_decisions for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_job_decisions.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

revoke all on public.jobs, public.job_versions from authenticated;
grant select (
  id, canonical_url, state, current_version_id, first_seen_at, last_seen_at,
  closed_at, created_at, updated_at
) on public.jobs to authenticated;
grant select (
  id, job_id, version_number, title, employer_name, description_text,
  location_text, work_mode, employment_type, apply_url, published_at,
  observed_at, created_at
) on public.job_versions to authenticated;

create or replace function public.search_catalog_jobs(
  p_query text default '',
  p_limit integer default 24,
  p_saved_only boolean default false,
  p_work_mode text default null,
  p_employment_type text default null,
  p_location text default null,
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
  queued_application_id uuid
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
  v_work_mode text := upper(btrim(coalesce(p_work_mode, '')));
  v_employment_type text := upper(btrim(coalesce(p_employment_type, '')));
  v_location text := btrim(coalesce(p_location, ''));
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100
     or char_length(v_query) > 120
     or char_length(v_location) > 120
     or (v_work_mode <> '' and v_work_mode not in ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'))
     or (p_cursor_observed_at is null) <> (p_cursor_job_id is null) then
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

  return query
  select
    job.id,
    version.id,
    job.canonical_url,
    version.employer_name,
    version.title,
    version.location_text,
    version.work_mode,
    version.employment_type,
    left(version.description_text, 900),
    version.apply_url,
    version.published_at,
    version.observed_at,
    source.provider,
    coalesce(decision.decision = 'SAVED', false),
    queued.id
  from public.jobs as job
  join public.job_versions as version
    on version.job_id = job.id and version.id = job.current_version_id
  join public.source_job_listings as listing
    on listing.id = job.source_listing_id
  join public.job_sources as source
    on source.id = listing.source_id
  left join lateral (
    select candidate_decision.decision
    from public.candidate_job_decisions as candidate_decision
    where candidate_decision.candidate_id = v_candidate
      and candidate_decision.job_id = job.id
      and candidate_decision.undone_at is null
    limit 1
  ) as decision on true
  left join lateral (
    select application.id
    from public.applications as application
    where application.candidate_id = v_candidate
      and application.job_id = job.id
    order by application.queued_at desc, application.id desc
    limit 1
  ) as queued on true
  where source.policy_status = 'ALLOWLISTED'
    and job.state = 'OPEN'
    and listing.state = 'OPEN'
    and (v_query = '' or version.search_document @@ websearch_to_tsquery('simple'::regconfig, v_query))
    and (v_work_mode = '' or version.work_mode = v_work_mode)
    and (v_employment_type = '' or upper(coalesce(version.employment_type, '')) = v_employment_type)
    and (v_location = '' or version.location_text ilike '%' || v_location || '%')
    and (not coalesce(p_saved_only, false) or decision.decision = 'SAVED')
    and (
      p_cursor_observed_at is null
      or (version.observed_at, job.id) < (p_cursor_observed_at, p_cursor_job_id)
    )
  order by version.observed_at desc, job.id desc
  limit p_limit;
end;
$$;

create or replace function public.set_catalog_job_saved(
  p_command_id uuid,
  p_job_id uuid,
  p_job_version_id uuid,
  p_saved boolean
)
returns table (replayed boolean, saved boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_candidate_count integer;
  v_existing_command public.command_dedup%rowtype;
  v_active public.candidate_job_decisions%rowtype;
  v_request_hash text;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_command_id is null or p_job_id is null or p_job_version_id is null or p_saved is null then
    raise exception 'CATALOG_SAVE_INPUT_INVALID' using errcode = '22023';
  end if;

  select count(*) into v_candidate_count
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE' and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED');
  if v_candidate_count = 0 then raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501'; end if;
  if v_candidate_count > 1 then raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000'; end if;

  select candidate.workspace_id, candidate.id into strict v_workspace, v_candidate
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE' and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  limit 1;

  if not exists (
    select 1 from public.jobs as job
    join public.source_job_listings as listing on listing.id = job.source_listing_id
    join public.job_sources as source on source.id = listing.source_id
    where job.id = p_job_id and job.current_version_id = p_job_version_id
      and job.state = 'OPEN' and listing.state = 'OPEN'
      and source.policy_status = 'ALLOWLISTED'
  ) then
    raise exception 'CATALOG_JOB_NOT_AVAILABLE' using errcode = '55000';
  end if;

  v_request_hash := encode(extensions.digest(convert_to(
    p_job_id::text || E'\n' || p_job_version_id::text || E'\n' || p_saved::text,
    'utf8'
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':job:' || p_job_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));

  select * into v_existing_command from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing_command.command_type <> 'SET_CATALOG_JOB_SAVED'
       or v_existing_command.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing_command.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query select true, coalesce((v_existing_command.result ->> 'saved')::boolean, false);
    return;
  end if;

  select decision.* into v_active
  from public.candidate_job_decisions as decision
  where decision.candidate_id = v_candidate and decision.job_id = p_job_id
    and decision.undone_at is null
  for update;
  if found and v_active.decision = 'QUEUED' then
    raise exception 'CATALOG_JOB_ALREADY_QUEUED' using errcode = '55000';
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor, 'SET_CATALOG_JOB_SAVED', v_request_hash, 'STARTED');

  if v_active.id is not null then
    update public.candidate_job_decisions
    set undone_at = statement_timestamp()
    where id = v_active.id;
  end if;
  if p_saved then
    insert into public.candidate_job_decisions
      (workspace_id, candidate_id, job_id, job_version_id, decision, command_id)
    values (v_workspace, v_candidate, p_job_id, p_job_version_id, 'SAVED', p_command_id);
  end if;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'CANDIDATE_JOB_COMMAND', p_command_id, 1,
     case when p_saved then 'candidate_job.saved' else 'candidate_job.unsaved' end,
     jsonb_build_object('job_id', p_job_id, 'job_version_id', p_job_version_id,
       'saved', p_saved), 'CANDIDATE', v_actor, p_command_id);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_JOB_COMMAND', aggregate_id = p_command_id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('job_id', p_job_id, 'saved', p_saved),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select false, p_saved;
end;
$$;

create or replace function public.enqueue_catalog_job_application(
  p_command_id uuid,
  p_job_id uuid,
  p_job_version_id uuid
)
returns table (
  replayed boolean,
  application_id uuid,
  aggregate_version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_candidate_count integer;
  v_existing_command public.command_dedup%rowtype;
  v_existing_application public.applications%rowtype;
  v_application_id uuid;
  v_event_id uuid := extensions.gen_random_uuid();
  v_request_hash text;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_command_id is null or p_job_id is null or p_job_version_id is null then
    raise exception 'CATALOG_QUEUE_INPUT_INVALID' using errcode = '22023';
  end if;

  select count(*) into v_candidate_count
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE' and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor and candidate.status in ('ONBOARDING', 'ACTIVE');
  if v_candidate_count = 0 then raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501'; end if;
  if v_candidate_count > 1 then raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000'; end if;

  select candidate.workspace_id, candidate.id into strict v_workspace, v_candidate
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE' and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor and candidate.status in ('ONBOARDING', 'ACTIVE')
  limit 1;

  if not exists (
    select 1 from public.jobs as job
    join public.source_job_listings as listing on listing.id = job.source_listing_id
    join public.job_sources as source on source.id = listing.source_id
    where job.id = p_job_id and job.current_version_id = p_job_version_id
      and job.state = 'OPEN' and listing.state = 'OPEN'
      and source.policy_status = 'ALLOWLISTED'
  ) then
    raise exception 'CATALOG_JOB_NOT_AVAILABLE' using errcode = '55000';
  end if;

  v_request_hash := encode(extensions.digest(convert_to(
    p_job_id::text || E'\n' || p_job_version_id::text, 'utf8'
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':job:' || p_job_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));

  select * into v_existing_command from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing_command.command_type <> 'ENQUEUE_CATALOG_JOB_APPLICATION'
       or v_existing_command.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing_command.status <> 'COMMITTED'
       or v_existing_command.aggregate_id is null then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query select true, v_existing_command.aggregate_id,
      coalesce((v_existing_command.result ->> 'aggregate_version')::bigint, 1);
    return;
  end if;

  select application.* into v_existing_application
  from public.applications as application
  where application.candidate_id = v_candidate and application.job_id = p_job_id
  for update;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_workspace, p_command_id, v_actor,
    'ENQUEUE_CATALOG_JOB_APPLICATION', v_request_hash, 'STARTED');

  if v_existing_application.id is not null then
    update public.command_dedup
    set aggregate_type = 'APPLICATION', aggregate_id = v_existing_application.id,
        status = 'COMMITTED',
        result = jsonb_build_object('application_id', v_existing_application.id,
          'aggregate_version', v_existing_application.aggregate_version,
          'already_queued', true), completed_at = statement_timestamp()
    where workspace_id = v_workspace and command_id = p_command_id;
    return query select true, v_existing_application.id, v_existing_application.aggregate_version;
    return;
  end if;

  insert into public.applications
    (workspace_id, candidate_id, job_id, job_version_id, status)
  values (v_workspace, v_candidate, p_job_id, p_job_version_id, 'DRAFTING')
  returning id into v_application_id;

  insert into public.application_runs
    (workspace_id, application_id, run_kind, status)
  values (v_workspace, v_application_id, 'PREPARATION', 'QUEUED');

  update public.candidate_job_decisions
  set undone_at = statement_timestamp()
  where candidate_id = v_candidate and job_id = p_job_id and undone_at is null;
  insert into public.candidate_job_decisions
    (workspace_id, candidate_id, job_id, job_version_id, decision, command_id)
  values (v_workspace, v_candidate, p_job_id, p_job_version_id, 'QUEUED', p_command_id);

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_workspace, 'APPLICATION', v_application_id, 1,
     'application.preparation_queued',
     jsonb_build_object('job_id', p_job_id, 'job_version_id', p_job_version_id),
     'CANDIDATE', v_actor, p_command_id);
  insert into public.outbox (workspace_id, event_id, topic, payload)
  values
    (v_workspace, v_event_id, 'application.preparation_requested',
     jsonb_build_object('application_id', v_application_id,
       'job_id', p_job_id, 'job_version_id', p_job_version_id));

  update public.command_dedup
  set aggregate_type = 'APPLICATION', aggregate_id = v_application_id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('application_id', v_application_id,
        'aggregate_version', 1, 'already_queued', false),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select false, v_application_id, 1::bigint;
end;
$$;

revoke all on function public.search_catalog_jobs(text, integer, boolean, text, text, text, timestamptz, uuid)
  from public, anon;
grant execute on function public.search_catalog_jobs(text, integer, boolean, text, text, text, timestamptz, uuid)
  to authenticated, service_role;
revoke all on function public.set_catalog_job_saved(uuid, uuid, uuid, boolean)
  from public, anon;
grant execute on function public.set_catalog_job_saved(uuid, uuid, uuid, boolean)
  to authenticated, service_role;
revoke all on function public.enqueue_catalog_job_application(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.enqueue_catalog_job_application(uuid, uuid, uuid)
  to authenticated, service_role;

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
     or v_run.status <> 'RUNNING' then
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
    if p_snapshot is not null then
      raise exception 'SOURCE_NOT_MODIFIED_PAYLOAD_INVALID' using errcode = '22023';
    end if;
    update public.ingestion_runs
    set status = 'SUCCEEDED', response_status = 304, snapshot_complete = true,
        checkpoint = checkpoint || jsonb_build_object('endpoint', p_endpoint,
          'etag', p_etag, 'not_modified', true), finished_at = statement_timestamp()
    where id = p_ingestion_run_id;
    update public.job_sources
    set last_successful_poll_at = statement_timestamp(), last_error_code = null,
        last_etag = coalesce(p_etag, last_etag),
        next_poll_at = statement_timestamp() + make_interval(mins => v_interval_minutes),
        poll_lease_owner = null, poll_lease_expires_at = null,
        updated_at = statement_timestamp()
    where id = p_source_id;
    return true;
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
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
  from public.source_job_listings where source_id = p_source_id and state = 'OPEN';
  v_observed_count := jsonb_array_length(p_snapshot -> 'jobs');
  v_issue_count := jsonb_array_length(p_snapshot -> 'issues');
  v_can_close := v_snapshot_complete and v_issue_count = 0
    and (v_prior_open_count = 0 or v_observed_count >= greatest(1, ceil(v_prior_open_count * 0.5)::integer));

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
    where source_id = p_source_id and state = 'OPEN'
      and not (external_job_id = any(v_seen_ids));
    update public.jobs as job
    set state = 'CLOSED', closed_at = coalesce(job.closed_at, v_observed_at),
        updated_at = v_observed_at
    from public.source_job_listings as listing
    where listing.id = job.source_listing_id and listing.source_id = p_source_id
      and listing.state = 'CLOSED' and job.state = 'OPEN';
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
  set last_successful_poll_at = statement_timestamp(), last_error_code = null,
      last_etag = coalesce(p_etag, last_etag),
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
      next_poll_at = statement_timestamp() + case when p_retryable
        then interval '15 minutes' else interval '24 hours' end,
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

comment on function public.search_catalog_jobs(text, integer, boolean, text, text, text, timestamptz, uuid) is
  'Candidate-safe search over open current versions from explicitly allowlisted sources.';
comment on function public.enqueue_catalog_job_application(uuid, uuid, uuid) is
  'Queues preparation for one visible current catalog job; it grants no submission authority.';
comment on function public.commit_job_source_snapshot(text, uuid, uuid, jsonb, text, text, text, bigint, integer) is
  'Atomically commits one bounded normalized allowlisted source snapshot and applies guarded closure.';
