-- RoleDawn / HireWire: service-role worker command boundary.
--
-- These functions are deliberately unavailable to browser roles. They keep
-- outbox claiming, acknowledgement, retry scheduling, and pasted-link catalog
-- resolution transactional while workers use app-owned IDs and versions.

alter table public.outbox
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists dead_letter_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.outbox'::regclass
      and conname = 'outbox_lease_pair_check'
  ) then
    alter table public.outbox
      add constraint outbox_lease_pair_check
      check (
        (lease_owner is null and lease_expires_at is null)
        or (lease_owner is not null and lease_expires_at is not null)
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.outbox'::regclass
      and conname = 'outbox_dead_letter_pair_check'
  ) then
    alter table public.outbox
      add constraint outbox_dead_letter_pair_check
      check (
        (dead_lettered_at is null and dead_letter_reason is null)
        or (dead_lettered_at is not null and dead_letter_reason is not null)
      );
  end if;
end;
$$;

create or replace function public.claim_outbox_batch(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 60,
  p_topics text[] default null
)
returns table (
  outbox_id uuid,
  workspace_id uuid,
  event_id uuid,
  topic text,
  payload jsonb,
  attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_now timestamptz := statement_timestamp();
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_worker_id) not between 1 and 120 then
    raise exception 'WORKER_ID_INVALID' using errcode = '22023';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'CLAIM_LIMIT_INVALID' using errcode = '22023';
  end if;
  if p_lease_seconds not between 15 and 900 then
    raise exception 'LEASE_SECONDS_INVALID' using errcode = '22023';
  end if;

  return query
  with claimable as (
    select candidate.id
    from public.outbox as candidate
    where candidate.published_at is null
      and candidate.dead_lettered_at is null
      and candidate.available_at <= v_now
      and (
        candidate.lease_expires_at is null
        or candidate.lease_expires_at <= v_now
      )
      and (p_topics is null or candidate.topic = any(p_topics))
    order by candidate.available_at, candidate.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.outbox as target
    set lease_owner = v_worker_id,
        lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
        attempt_count = target.attempt_count + 1
    from claimable
    where target.id = claimable.id
    returning target.id, target.workspace_id, target.event_id, target.topic,
      target.payload, target.attempt_count, target.lease_expires_at
  )
  select claimed.id, claimed.workspace_id, claimed.event_id, claimed.topic,
    claimed.payload, claimed.attempt_count, claimed.lease_expires_at
  from claimed
  order by claimed.lease_expires_at, claimed.id;
end;
$$;

create or replace function public.ack_outbox_message(
  p_worker_id text,
  p_outbox_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_outbox_id is null or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120 then
    raise exception 'ACK_INPUT_INVALID' using errcode = '22023';
  end if;

  update public.outbox
  set published_at = statement_timestamp(),
      lease_owner = null,
      lease_expires_at = null,
      last_error = null
  where id = p_outbox_id
    and published_at is null
    and dead_lettered_at is null
    and lease_owner = btrim(p_worker_id)
    and lease_expires_at > statement_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.fail_outbox_message(
  p_worker_id text,
  p_outbox_id uuid,
  p_error_code text,
  p_retry_after_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := btrim(coalesce(p_error_code, ''));
  v_updated integer;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_outbox_id is null
     or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
     or char_length(v_error_code) not between 1 and 120
     or p_retry_after_seconds not between 1 and 86400 then
    raise exception 'FAIL_INPUT_INVALID' using errcode = '22023';
  end if;

  update public.outbox
  set available_at = statement_timestamp() + make_interval(secs => p_retry_after_seconds),
      lease_owner = null,
      lease_expires_at = null,
      last_error = v_error_code
  where id = p_outbox_id
    and published_at is null
    and dead_lettered_at is null
    and lease_owner = btrim(p_worker_id)
    and lease_expires_at > statement_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.dead_letter_outbox_message(
  p_worker_id text,
  p_outbox_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_error_code text := btrim(coalesce(p_error_code, ''));
  v_updated integer;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_outbox_id is null
     or char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
     or char_length(v_error_code) not between 1 and 120 then
    raise exception 'DEAD_LETTER_INPUT_INVALID' using errcode = '22023';
  end if;

  update public.outbox
  set dead_lettered_at = statement_timestamp(),
      dead_letter_reason = v_error_code,
      lease_owner = null,
      lease_expires_at = null,
      last_error = v_error_code
  where id = p_outbox_id
    and published_at is null
    and dead_lettered_at is null
    and lease_owner = btrim(p_worker_id)
    and lease_expires_at > statement_timestamp();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.resolve_pasted_link_intake(
  p_job_intake_id uuid,
  p_expected_application_id uuid,
  p_job_id uuid,
  p_job_version_id uuid,
  p_expected_intake_updated_at timestamptz
)
returns table (application_id uuid, aggregate_version bigint, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_intake public.job_intakes%rowtype;
  v_application public.applications%rowtype;
  v_event_id uuid := extensions.gen_random_uuid();
  v_new_version bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_job_intake_id is null or p_expected_application_id is null
     or p_job_id is null or p_job_version_id is null
     or p_expected_intake_updated_at is null then
    raise exception 'RESOLUTION_INPUT_INVALID' using errcode = '22023';
  end if;

  select intake.* into strict v_intake
  from public.job_intakes as intake
  where intake.id = p_job_intake_id
  for update;

  select app.* into strict v_application
  from public.applications as app
  where app.workspace_id = v_intake.workspace_id
    and app.id = p_expected_application_id
    and app.job_intake_id = v_intake.id
  for update;

  if v_intake.status = 'RESOLVED' then
    if v_intake.resolved_job_id <> p_job_id
       or v_intake.resolved_job_version_id <> p_job_version_id then
      raise exception 'INTAKE_ALREADY_RESOLVED_DIFFERENTLY' using errcode = '23505';
    end if;
    return query select v_application.id, v_application.aggregate_version, true;
    return;
  end if;

  if v_intake.status not in ('PENDING', 'RESOLVING') then
    raise exception 'INTAKE_NOT_RESOLVABLE' using errcode = '55000';
  end if;
  if v_application.status <> 'DRAFTING' then
    raise exception 'APPLICATION_NOT_RESOLVABLE' using errcode = '55000';
  end if;
  if v_intake.updated_at <> p_expected_intake_updated_at then
    raise exception 'INTAKE_VERSION_MISMATCH' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.job_versions as version
    join public.jobs as job on job.id = version.job_id
    where version.id = p_job_version_id
      and version.job_id = p_job_id
      and job.state = 'OPEN'
      and job.source_listing_id is not null
  ) then
    raise exception 'RESOLVED_JOB_SNAPSHOT_INVALID' using errcode = '23503';
  end if;

  update public.job_intakes
  set status = 'RESOLVED',
      resolved_job_id = p_job_id,
      resolved_job_version_id = p_job_version_id,
      failure_code = null,
      updated_at = statement_timestamp()
  where id = v_intake.id;

  v_new_version := v_application.aggregate_version + 1;
  update public.applications
  set job_id = p_job_id,
      job_version_id = p_job_version_id,
      aggregate_version = v_new_version,
      updated_at = statement_timestamp()
  where workspace_id = v_application.workspace_id
    and id = v_application.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, correlation_id)
  values
    (v_event_id, v_application.workspace_id, 'APPLICATION', v_application.id,
     v_new_version, 'application.job_resolved',
     jsonb_build_object(
       'job_intake_id', v_intake.id,
       'job_id', p_job_id,
       'job_version_id', p_job_version_id
     ),
     'WORKER', v_intake.command_id);

  insert into public.outbox (workspace_id, event_id, topic, payload)
  values
    (v_application.workspace_id, v_event_id, 'application.job_resolved',
     jsonb_build_object(
       'application_id', v_application.id,
       'job_id', p_job_id,
       'job_version_id', p_job_version_id,
       'preparation_run_id', (
         select run.id
         from public.application_runs as run
         where run.workspace_id = v_application.workspace_id
           and run.application_id = v_application.id
           and run.run_kind = 'PREPARATION'
         order by run.created_at, run.id
         limit 1
       )
     ));

  return query select v_application.id, v_new_version, false;
end;
$$;

create or replace function public.ack_terminal_pasted_link_intake(
  p_job_intake_id uuid,
  p_expected_application_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_terminal boolean;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_job_intake_id is null or p_expected_application_id is null then
    raise exception 'TERMINAL_ACK_INPUT_INVALID' using errcode = '22023';
  end if;

  select true into v_terminal
  from public.job_intakes as intake
  join public.applications as app
    on app.workspace_id = intake.workspace_id
   and app.job_intake_id = intake.id
  where intake.id = p_job_intake_id
    and app.id = p_expected_application_id
    and (
      (intake.status = 'RESOLVED' and app.job_id = intake.resolved_job_id
        and app.job_version_id = intake.resolved_job_version_id)
      or (intake.status = 'FAILED' and app.status = 'FAILED_SAFE')
    );

  return coalesce(v_terminal, false);
end;
$$;

create or replace function public.fail_pasted_link_intake(
  p_job_intake_id uuid,
  p_expected_application_id uuid,
  p_failure_code text,
  p_expected_intake_updated_at timestamptz
)
returns table (application_id uuid, aggregate_version bigint, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_intake public.job_intakes%rowtype;
  v_application public.applications%rowtype;
  v_event_id uuid := extensions.gen_random_uuid();
  v_failure_code text := btrim(coalesce(p_failure_code, ''));
  v_new_version bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_job_intake_id is null
     or p_expected_application_id is null
     or p_expected_intake_updated_at is null
     or char_length(v_failure_code) not between 1 and 120 then
    raise exception 'FAILURE_INPUT_INVALID' using errcode = '22023';
  end if;

  select intake.* into strict v_intake
  from public.job_intakes as intake
  where intake.id = p_job_intake_id
  for update;
  select app.* into strict v_application
  from public.applications as app
  where app.workspace_id = v_intake.workspace_id
    and app.id = p_expected_application_id
    and app.job_intake_id = v_intake.id
  for update;

  if v_intake.status = 'FAILED' then
    if v_intake.failure_code <> v_failure_code then
      raise exception 'INTAKE_ALREADY_FAILED_DIFFERENTLY' using errcode = '23505';
    end if;
    return query select v_application.id, v_application.aggregate_version, true;
    return;
  end if;
  if v_intake.status not in ('PENDING', 'RESOLVING') then
    raise exception 'INTAKE_NOT_FAILABLE' using errcode = '55000';
  end if;
  if v_application.status <> 'DRAFTING' then
    raise exception 'APPLICATION_NOT_FAILABLE' using errcode = '55000';
  end if;
  if v_intake.updated_at <> p_expected_intake_updated_at then
    raise exception 'INTAKE_VERSION_MISMATCH' using errcode = '40001';
  end if;

  update public.job_intakes
  set status = 'FAILED', failure_code = v_failure_code,
      updated_at = statement_timestamp()
  where id = v_intake.id;

  v_new_version := v_application.aggregate_version + 1;
  update public.applications
  set status = 'FAILED_SAFE', aggregate_version = v_new_version,
      updated_at = statement_timestamp()
  where workspace_id = v_application.workspace_id
    and id = v_application.id;

  update public.application_runs
  set status = 'FAILED', error_code = v_failure_code,
      finished_at = statement_timestamp()
  where workspace_id = v_application.workspace_id
    and application_id = v_application.id
    and run_kind = 'PREPARATION'
    and status = 'QUEUED';

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, correlation_id)
  values
    (v_event_id, v_application.workspace_id, 'APPLICATION', v_application.id,
     v_new_version, 'application.intake_failed',
     jsonb_build_object('job_intake_id', v_intake.id, 'failure_code', v_failure_code),
     'WORKER', v_intake.command_id);

  return query select v_application.id, v_new_version, false;
end;
$$;

revoke all on function public.claim_outbox_batch(text, integer, integer, text[])
  from public, anon, authenticated;
revoke all on function public.ack_terminal_pasted_link_intake(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ack_outbox_message(text, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_outbox_message(text, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.dead_letter_outbox_message(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.resolve_pasted_link_intake(uuid, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_pasted_link_intake(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_outbox_batch(text, integer, integer, text[])
  to service_role;
grant execute on function public.ack_terminal_pasted_link_intake(uuid, uuid)
  to service_role;
grant execute on function public.ack_outbox_message(text, uuid)
  to service_role;
grant execute on function public.fail_outbox_message(text, uuid, text, integer)
  to service_role;
grant execute on function public.dead_letter_outbox_message(text, uuid, text)
  to service_role;
grant execute on function public.resolve_pasted_link_intake(uuid, uuid, uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.fail_pasted_link_intake(uuid, uuid, text, timestamptz)
  to service_role;

comment on function public.claim_outbox_batch(text, integer, integer, text[]) is
  'Service-only SKIP LOCKED outbox lease. Claiming does not acknowledge delivery.';
comment on function public.dead_letter_outbox_message(text, uuid, text) is
  'Service-only terminal transition for an unsuccessfully processed leased outbox message.';
comment on function public.resolve_pasted_link_intake(uuid, uuid, uuid, uuid, timestamptz) is
  'Service-only idempotent transition from pasted URL to one immutable open job snapshot.';
