-- RoleDawn / HireWire: close the remaining Milestone 0 database recovery gaps.
--
-- 1. One candidate may create at most one intake/application aggregate for one
--    server-normalized canonical URL, even when separate command IDs race.
-- 2. Dead-lettered outbox messages are inspectable and requeueable only by an
--    explicitly assigned active SUPPORT member. Requeue is optimistic,
--    append-only audited, and never acknowledges the original event.

create unique index job_intakes_candidate_canonical_url_unique_idx
  on public.job_intakes (candidate_id, canonical_url);

create index outbox_claimable_idx
  on public.outbox (available_at, id)
  where published_at is null and dead_lettered_at is null;

create index outbox_dead_lettered_time_idx
  on public.outbox (dead_lettered_at desc, id)
  where published_at is null and dead_lettered_at is not null;

alter table public.outbox
  add constraint outbox_workspace_id_id_key unique (workspace_id, id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.outbox'::regclass
      and conname = 'outbox_terminal_state_check'
  ) then
    alter table public.outbox
      add constraint outbox_terminal_state_check
      check (not (published_at is not null and dead_lettered_at is not null));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.outbox'::regclass
      and conname = 'outbox_dead_letter_unleased_check'
  ) then
    alter table public.outbox
      add constraint outbox_dead_letter_unleased_check
      check (
        dead_lettered_at is null
        or (lease_owner is null and lease_expires_at is null)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.outbox'::regclass
      and conname = 'outbox_dead_letter_reason_length_check'
  ) then
    alter table public.outbox
      add constraint outbox_dead_letter_reason_length_check
      check (
        dead_letter_reason is null
        or char_length(btrim(dead_letter_reason)) between 1 and 120
      );
  end if;
end;
$$;

create table public.outbox_recovery_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  outbox_id uuid not null references public.outbox(id) on delete restrict,
  operator_auth_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('REQUEUED')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  previous_attempt_count integer not null check (previous_attempt_count >= 0),
  previous_dead_lettered_at timestamptz not null,
  previous_dead_letter_reason text not null
    check (char_length(btrim(previous_dead_letter_reason)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, outbox_id)
    references public.outbox(workspace_id, id) on delete restrict
);

create index outbox_recovery_actions_message_time_idx
  on public.outbox_recovery_actions (outbox_id, created_at desc, id);
create index outbox_recovery_actions_operator_time_idx
  on public.outbox_recovery_actions (operator_auth_user_id, created_at desc, id);

create trigger outbox_recovery_actions_immutable
  before update or delete on public.outbox_recovery_actions
  for each row execute function private.reject_row_mutation();

alter table public.outbox_recovery_actions enable row level security;
revoke all on public.outbox_recovery_actions from public, anon, authenticated;
grant all on public.outbox_recovery_actions to service_role;

-- Replaces the original command with URL-level idempotency in addition to the
-- existing command-level idempotency. The advisory locks serialize both keys,
-- while the unique index is the final database invariant.
create or replace function public.enqueue_pasted_link_application(
  p_command_id uuid,
  p_canonical_url text
)
returns table (application_id uuid, job_intake_id uuid, aggregate_version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_intake uuid;
  v_application uuid;
  v_event uuid := extensions.gen_random_uuid();
  v_request_hash text;
  v_existing record;
  v_existing_url record;
  v_candidate_count integer;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_command_id is null then raise exception 'COMMAND_ID_REQUIRED' using errcode = '22023'; end if;
  if p_canonical_url is null or not private.is_public_https_job_url(p_canonical_url) then
    raise exception 'PUBLIC_HTTPS_JOB_URL_REQUIRED' using errcode = '22023';
  end if;

  select count(*) into v_candidate_count
  from public.candidates c
  join public.workspace_memberships m
    on m.workspace_id = c.workspace_id and m.auth_user_id = v_actor and m.status = 'ACTIVE'
  join public.workspaces w on w.id = c.workspace_id and w.status = 'ACTIVE'
    and w.kind = 'PERSONAL' and w.personal_owner_auth_user_id = v_actor
  where c.auth_user_id = v_actor and c.status in ('ONBOARDING', 'ACTIVE');
  if v_candidate_count = 0 then raise exception 'ACTIVE_CANDIDATE_NOT_FOUND' using errcode = '42501'; end if;
  if v_candidate_count > 1 then raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000'; end if;

  select c.workspace_id, c.id into strict v_workspace, v_candidate
  from public.candidates c
  join public.workspace_memberships m
    on m.workspace_id = c.workspace_id and m.auth_user_id = v_actor and m.status = 'ACTIVE'
  join public.workspaces w on w.id = c.workspace_id and w.status = 'ACTIVE'
    and w.kind = 'PERSONAL' and w.personal_owner_auth_user_id = v_actor
  where c.auth_user_id = v_actor and c.status in ('ONBOARDING', 'ACTIVE')
  order by c.created_at
  limit 1;

  v_request_hash := encode(extensions.digest(p_canonical_url, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));

  select * into v_existing from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'ENQUEUE_PASTED_LINK_APPLICATION'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' or v_existing.aggregate_id is null then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query
      select a.id, a.job_intake_id, a.aggregate_version, true
      from public.applications a
      where a.workspace_id = v_workspace and a.id = v_existing.aggregate_id;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_candidate::text || ':' || p_canonical_url, 0)
  );

  select application.id, application.job_intake_id, application.aggregate_version,
    application.status
    into v_existing_url
  from public.job_intakes as intake
  join public.applications as application
    on application.workspace_id = intake.workspace_id
   and application.job_intake_id = intake.id
  where intake.candidate_id = v_candidate
    and intake.canonical_url = p_canonical_url;

  if found then
    -- Terminal applications remain historical truth. A repeated URL is not a
    -- request to mutate, revive, or silently replace that aggregate.
    insert into public.command_dedup
      (workspace_id, command_id, actor_id, command_type, request_hash,
       aggregate_type, aggregate_id, status, result, completed_at)
    values
      (v_workspace, p_command_id, v_actor, 'ENQUEUE_PASTED_LINK_APPLICATION',
       v_request_hash, 'APPLICATION', v_existing_url.id, 'COMMITTED',
       jsonb_build_object(
         'application_id', v_existing_url.id,
         'job_intake_id', v_existing_url.job_intake_id
       ),
       statement_timestamp());

    return query
      select v_existing_url.id::uuid, v_existing_url.job_intake_id::uuid,
        v_existing_url.aggregate_version::bigint, true;
    return;
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_workspace, p_command_id, v_actor, 'ENQUEUE_PASTED_LINK_APPLICATION', v_request_hash, 'STARTED');

  insert into public.job_intakes (workspace_id, candidate_id, canonical_url, command_id)
  values (v_workspace, v_candidate, p_canonical_url, p_command_id)
  returning id into v_intake;

  insert into public.applications (workspace_id, candidate_id, job_intake_id)
  values (v_workspace, v_candidate, v_intake)
  returning id into v_application;

  insert into public.application_runs (workspace_id, application_id, run_kind, status)
  values (v_workspace, v_application, 'PREPARATION', 'QUEUED');

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version, event_type,
     payload, actor_kind, actor_id, correlation_id)
  values
    (v_event, v_workspace, 'APPLICATION', v_application, 1, 'application.queued',
     jsonb_build_object('job_intake_id', v_intake), 'CANDIDATE', v_actor, p_command_id);

  insert into public.outbox (workspace_id, event_id, topic, payload)
  values (v_workspace, v_event, 'application.queued',
    jsonb_build_object('application_id', v_application, 'job_intake_id', v_intake));

  update public.command_dedup
  set aggregate_type = 'APPLICATION', aggregate_id = v_application, status = 'COMMITTED',
      result_event_id = v_event,
      result = jsonb_build_object('application_id', v_application, 'job_intake_id', v_intake),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select v_application, v_intake, 1::bigint, false;
end;
$$;

-- A SUPPORT member sees dead letters only for an active workspace in which
-- that exact auth user has an active SUPPORT membership. Candidate/owner
-- membership alone is intentionally insufficient.
create or replace function public.list_dead_lettered_outbox(
  p_limit integer default 50,
  p_before timestamptz default null
)
returns table (
  outbox_id uuid,
  workspace_id uuid,
  event_id uuid,
  topic text,
  payload jsonb,
  attempt_count integer,
  last_error text,
  dead_lettered_at timestamptz,
  dead_letter_reason text,
  available_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'LIST_LIMIT_INVALID' using errcode = '22023';
  end if;

  return query
  select message.id, message.workspace_id, message.event_id, message.topic,
    message.payload, message.attempt_count, message.last_error,
    message.dead_lettered_at, message.dead_letter_reason,
    message.available_at, message.created_at
  from public.outbox as message
  join public.workspace_memberships as membership
    on membership.workspace_id = message.workspace_id
   and membership.auth_user_id = v_actor
   and membership.role = 'SUPPORT'
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = message.workspace_id
   and workspace.status = 'ACTIVE'
  where message.published_at is null
    and message.dead_lettered_at is not null
    and (p_before is null or message.dead_lettered_at < p_before)
  order by message.dead_lettered_at desc, message.id
  limit p_limit;
end;
$$;

-- Requeue requires the exact dead-letter timestamp observed by the operator.
-- This prevents two operators from silently acting on the same stale state.
create or replace function public.requeue_dead_lettered_outbox(
  p_outbox_id uuid,
  p_expected_dead_lettered_at timestamptz,
  p_reason text
)
returns table (recovery_action_id uuid, outbox_id uuid, requeued_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_message public.outbox%rowtype;
  v_action_id uuid := extensions.gen_random_uuid();
  v_requeued_at timestamptz := statement_timestamp();
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_outbox_id is null or p_expected_dead_lettered_at is null
     or char_length(v_reason) not between 3 and 500 then
    raise exception 'REQUEUE_INPUT_INVALID' using errcode = '22023';
  end if;

  select message.* into v_message
  from public.outbox as message
  join public.workspace_memberships as membership
    on membership.workspace_id = message.workspace_id
   and membership.auth_user_id = v_actor
   and membership.role = 'SUPPORT'
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = message.workspace_id
   and workspace.status = 'ACTIVE'
  where message.id = p_outbox_id
  for update;

  if not found then
    raise exception 'OUTBOX_NOT_FOUND_OR_NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if v_message.published_at is not null then
    raise exception 'OUTBOX_ALREADY_PUBLISHED' using errcode = '55000';
  end if;
  if v_message.dead_lettered_at is null then
    raise exception 'OUTBOX_NOT_DEAD_LETTERED' using errcode = '55000';
  end if;
  if v_message.dead_lettered_at <> p_expected_dead_lettered_at then
    raise exception 'DEAD_LETTER_VERSION_MISMATCH' using errcode = '40001';
  end if;
  if v_message.topic not in ('application.queued', 'application.job_resolved') then
    raise exception 'OUTBOX_TOPIC_NOT_REQUEUEABLE' using errcode = '55000';
  end if;

  insert into public.outbox_recovery_actions
    (id, workspace_id, outbox_id, operator_auth_user_id, action, reason,
     previous_attempt_count, previous_dead_lettered_at, previous_dead_letter_reason)
  values
    (v_action_id, v_message.workspace_id, v_message.id, v_actor, 'REQUEUED', v_reason,
     v_message.attempt_count, v_message.dead_lettered_at, v_message.dead_letter_reason);

  update public.outbox
  set available_at = v_requeued_at,
      attempt_count = 0,
      last_error = null,
      dead_lettered_at = null,
      dead_letter_reason = null,
      lease_owner = null,
      lease_expires_at = null
  where id = v_message.id;

  return query select v_action_id, v_message.id, v_requeued_at;
end;
$$;

revoke all on function public.enqueue_pasted_link_application(uuid, text)
  from public, anon;
grant execute on function public.enqueue_pasted_link_application(uuid, text)
  to authenticated;
grant execute on function public.enqueue_pasted_link_application(uuid, text)
  to service_role;

revoke all on function public.list_dead_lettered_outbox(integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.requeue_dead_lettered_outbox(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.list_dead_lettered_outbox(integer, timestamptz)
  to authenticated;
grant execute on function public.requeue_dead_lettered_outbox(uuid, timestamptz, text)
  to authenticated;

comment on function public.enqueue_pasted_link_application(uuid, text) is
  'Authenticated atomic pasted-link intake with command and candidate-canonical-URL idempotency; preparation authority only.';
comment on function public.list_dead_lettered_outbox(integer, timestamptz) is
  'Active SUPPORT members may inspect only dead letters in their explicitly assigned active workspaces.';
comment on function public.requeue_dead_lettered_outbox(uuid, timestamptz, text) is
  'Active SUPPORT members may optimistically requeue one dead letter; every action is append-only audited.';
