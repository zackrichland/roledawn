-- RoleDawn: lease and recover browser-fill work after the originating outbox
-- message has already been published.
--
-- Recovery is deliberately asymmetric:
--   * PROVISIONING may be recovered with the same computer-session UUID as the
--     provider idempotency key. The provider adapter must recover that exact
--     runtime or fail; it may not create an unrelated second runtime.
--   * ACTIVE may have disclosed candidate fields or files. It is never driven
--     again automatically. Once its lease expires it is failed safe.
--
-- Final submission remains structurally unavailable to this workflow.

alter table public.application_fill_attempts
  add column execution_lease_owner text,
  add column execution_lease_expires_at timestamptz,
  add column last_lease_heartbeat_at timestamptz,
  add column recovery_count integer not null default 0
    check (recovery_count >= 0),
  add constraint application_fill_attempts_execution_lease_pair_check
    check (
      (execution_lease_owner is null and execution_lease_expires_at is null)
      or (
        char_length(btrim(execution_lease_owner)) between 1 and 120
        and execution_lease_expires_at is not null
      )
    ),
  add constraint application_fill_attempts_lease_heartbeat_check
    check (
      last_lease_heartbeat_at is null
      or last_lease_heartbeat_at >= coalesce(started_at, created_at)
    );

-- Rows started by the immediately preceding release did not yet carry a
-- worker lease. Make them claimable without pretending the old worker still
-- owns them. ACTIVE rows will be failed safe by the recovery worker.
update public.application_fill_attempts
set execution_lease_owner = 'pre-lease-migration',
    execution_lease_expires_at = statement_timestamp(),
    last_lease_heartbeat_at = greatest(
      coalesce(started_at, created_at),
      statement_timestamp()
    )
where status = 'STARTED';

create index application_fill_attempts_stale_execution_idx
  on public.application_fill_attempts (execution_lease_expires_at, id)
  where status = 'STARTED';

create index outbox_application_fill_attempt_idx
  on public.outbox ((payload ->> 'fill_attempt_id'), created_at desc, id)
  where topic = 'application.browser_fill_requested';

alter table public.application_fill_checkpoints
  drop constraint application_fill_checkpoints_checkpoint_kind_check;

alter table public.application_fill_checkpoints
  add constraint application_fill_checkpoints_checkpoint_kind_check
  check (checkpoint_kind in (
    'SESSION_RESERVED', 'SESSION_ACTIVE', 'RECOVERY_CLAIMED',
    'FILLED_READ_BACK', 'BLOCKED_FOR_TAKEOVER', 'FAILED_SAFE',
    'SESSION_CLOSED', 'SESSION_DESTROYED'
  ));

-- Preserve the already-hosted implementation as an internal primitive. The
-- public wrapper below adds the worker fence without rewriting prior history.
alter function public.start_application_fill_attempt(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) rename to start_application_fill_attempt_unleased_v1;

alter function public.start_application_fill_attempt_unleased_v1(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) set schema private;

revoke all on function private.start_application_fill_attempt_unleased_v1(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) from public, anon, authenticated;
grant execute on function private.start_application_fill_attempt_unleased_v1(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) to service_role;

create function public.start_application_fill_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_fill_attempt_id uuid,
  p_execution_mode text,
  p_broker_release text,
  p_allowed_domain_policy jsonb,
  p_browser_profile_ref uuid default null,
  p_ttl_seconds integer default 900
)
returns table (
  computer_session_id uuid,
  application_id uuid,
  revision_id uuid,
  replayed boolean,
  execution_mode text,
  browser_profile_ref uuid,
  session_ttl_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_session_id uuid;
  v_application_id uuid;
  v_revision_id uuid;
  v_replayed boolean;
  v_session public.computer_sessions%rowtype;
  v_fill public.application_fill_attempts%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_worker_id) not between 1 and 120 then
    raise exception 'APPLICATION_FILL_WORKER_ID_INVALID' using errcode = '22023';
  end if;

  select started.computer_session_id, started.application_id,
    started.revision_id, started.replayed
  into strict v_session_id, v_application_id, v_revision_id, v_replayed
  from private.start_application_fill_attempt_unleased_v1(
    p_outbox_id, v_worker_id, p_fill_attempt_id, p_execution_mode,
    p_broker_release, p_allowed_domain_policy, p_browser_profile_ref,
    p_ttl_seconds
  ) as started;

  select attempt.* into strict v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = p_fill_attempt_id
  for update;
  select session.* into strict v_session
  from public.computer_sessions as session
  where session.id = v_session_id
  for update;

  if v_replayed then
    if v_fill.status <> 'STARTED'
       or v_session.state <> 'PROVISIONING'
       or v_fill.execution_lease_owner is distinct from v_worker_id
       or v_fill.execution_lease_expires_at is null
       or v_fill.execution_lease_expires_at <= statement_timestamp()
       or v_session.expires_at <= statement_timestamp() then
      raise exception 'APPLICATION_FILL_RECOVERY_FENCE_INVALID'
        using errcode = '40001';
    end if;
  else
    update public.application_fill_attempts
    set execution_lease_owner = v_worker_id,
        execution_lease_expires_at = least(
          statement_timestamp() + interval '2 minutes',
          v_session.expires_at
        ),
        last_lease_heartbeat_at = statement_timestamp()
    where id = v_fill.id;
  end if;

  update public.application_runs
  set last_heartbeat_at = statement_timestamp()
  where id = v_fill.browser_run_id;

  return query select v_session.id, v_application_id, v_revision_id,
    v_replayed, v_session.execution_mode, v_session.browser_profile_ref,
    greatest(
      60,
      extract(epoch from (v_session.expires_at - v_session.created_at))::integer
    );
end;
$$;

alter function public.activate_computer_session(
  uuid, text, text, text, text
) rename to activate_computer_session_unleased_v1;

alter function public.activate_computer_session_unleased_v1(
  uuid, text, text, text, text
) set schema private;

revoke all on function private.activate_computer_session_unleased_v1(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.activate_computer_session_unleased_v1(
  uuid, text, text, text, text
) to service_role;

create function public.activate_leased_computer_session(
  p_worker_id text,
  p_computer_session_id uuid,
  p_provider_adapter text,
  p_provider_session_ref text,
  p_provider_context_ref text,
  p_adapter_release text
)
returns table (computer_session_id uuid, fill_attempt_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_session public.computer_sessions%rowtype;
  v_fill public.application_fill_attempts%rowtype;
  v_returned_session_id uuid;
  v_returned_fill_id uuid;
  v_replayed boolean;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_worker_id) not between 1 and 120 then
    raise exception 'APPLICATION_FILL_WORKER_ID_INVALID' using errcode = '22023';
  end if;

  select session.* into strict v_session
  from public.computer_sessions as session
  where session.id = p_computer_session_id
  for update;
  select attempt.* into strict v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = v_session.fill_attempt_id
  for update;

  if v_fill.status <> 'STARTED'
     or v_session.state not in ('PROVISIONING', 'ACTIVE')
     or v_fill.execution_lease_owner is distinct from v_worker_id
     or v_fill.execution_lease_expires_at is null
     or v_fill.execution_lease_expires_at <= statement_timestamp()
     or v_session.expires_at <= statement_timestamp() then
    raise exception 'APPLICATION_FILL_ACTIVATION_LEASE_INVALID'
      using errcode = '40001';
  end if;

  select activated.computer_session_id, activated.fill_attempt_id,
    activated.replayed
  into strict v_returned_session_id, v_returned_fill_id, v_replayed
  from private.activate_computer_session_unleased_v1(
    p_computer_session_id, p_provider_adapter, p_provider_session_ref,
    p_provider_context_ref, p_adapter_release
  ) as activated;

  -- After activation, candidate facts or files may be disclosed. Hold the
  -- fence through the runtime's own expiry; recovery may then only fail safe.
  update public.application_fill_attempts
  set execution_lease_expires_at = v_session.expires_at,
      last_lease_heartbeat_at = statement_timestamp()
  where id = v_fill.id
    and execution_lease_owner = v_worker_id;
  update public.application_runs
  set last_heartbeat_at = statement_timestamp()
  where id = v_fill.browser_run_id;

  return query select v_returned_session_id, v_returned_fill_id, v_replayed;
end;
$$;

alter function public.complete_application_fill_attempt(
  uuid, text, text, jsonb, boolean, jsonb
) rename to complete_application_fill_attempt_unleased_v1;

alter function public.complete_application_fill_attempt_unleased_v1(
  uuid, text, text, jsonb, boolean, jsonb
) set schema private;

revoke all on function private.complete_application_fill_attempt_unleased_v1(
  uuid, text, text, jsonb, boolean, jsonb
) from public, anon, authenticated;
grant execute on function private.complete_application_fill_attempt_unleased_v1(
  uuid, text, text, jsonb, boolean, jsonb
) to service_role;

create function public.complete_leased_application_fill_attempt(
  p_worker_id text,
  p_fill_attempt_id uuid,
  p_terminal_status text,
  p_checkpoint_hash text,
  p_redacted_summary jsonb,
  p_runtime_destroyed boolean,
  p_usage_summary jsonb
)
returns table (
  application_id uuid,
  application_status text,
  computer_session_id uuid,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_fill public.application_fill_attempts%rowtype;
  v_application_id uuid;
  v_application_status text;
  v_computer_session_id uuid;
  v_replayed boolean;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_worker_id) not between 1 and 120 then
    raise exception 'APPLICATION_FILL_WORKER_ID_INVALID' using errcode = '22023';
  end if;

  select attempt.* into strict v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = p_fill_attempt_id
  for update;

  -- A response-loss replay of the exact terminal checkpoint remains safe even
  -- though the terminal transition cleared the lease.
  if v_fill.status = 'STARTED' and (
    v_fill.execution_lease_owner is distinct from v_worker_id
    or v_fill.execution_lease_expires_at is null
    or v_fill.execution_lease_expires_at <= statement_timestamp()
  ) then
    raise exception 'APPLICATION_FILL_COMPLETION_LEASE_INVALID'
      using errcode = '40001';
  end if;

  select completed.application_id, completed.application_status,
    completed.computer_session_id, completed.replayed
  into strict v_application_id, v_application_status,
    v_computer_session_id, v_replayed
  from private.complete_application_fill_attempt_unleased_v1(
    p_fill_attempt_id, p_terminal_status, p_checkpoint_hash,
    p_redacted_summary, p_runtime_destroyed, p_usage_summary
  ) as completed;

  if not v_replayed then
    update public.application_fill_attempts
    set execution_lease_owner = null,
        execution_lease_expires_at = null,
        last_lease_heartbeat_at = statement_timestamp()
    where id = p_fill_attempt_id;
  end if;

  return query select v_application_id, v_application_status,
    v_computer_session_id, v_replayed;
end;
$$;

create function public.claim_stale_application_fill_attempt(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  fill_attempt_id uuid,
  computer_session_id uuid,
  recovery_mode text,
  outbox_id uuid,
  outbox_topic text,
  outbox_payload jsonb,
  outbox_attempt_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_fill public.application_fill_attempts%rowtype;
  v_session public.computer_sessions%rowtype;
  v_recovery_mode text;
  v_outbox public.outbox%rowtype;
  v_lease_expires_at timestamptz;
  v_summary jsonb;
  v_hash text;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_worker_id) not between 1 and 120
     or p_lease_seconds not between 30 and 300 then
    raise exception 'APPLICATION_FILL_RECOVERY_CLAIM_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select attempt.* into v_fill
  from public.application_fill_attempts as attempt
  join public.computer_sessions as session
    on session.fill_attempt_id = attempt.id
  where attempt.status = 'STARTED'
    and (
      attempt.execution_lease_expires_at is null
      or attempt.execution_lease_expires_at <= statement_timestamp()
    )
    and session.state in ('PROVISIONING', 'ACTIVE')
  order by attempt.execution_lease_expires_at nulls first, attempt.id
  for update of attempt skip locked
  limit 1;

  if not found then
    return;
  end if;

  select session.* into strict v_session
  from public.computer_sessions as session
  where session.fill_attempt_id = v_fill.id
  for update;

  if v_session.state = 'PROVISIONING'
     and v_session.expires_at > statement_timestamp() then
    v_recovery_mode := 'RESUME_IDEMPOTENT_PROVISION';
    v_lease_expires_at := least(
      statement_timestamp() + make_interval(secs => p_lease_seconds),
      v_session.expires_at
    );
  else
    v_recovery_mode := case
      when v_session.expires_at <= statement_timestamp()
        then 'FAIL_SAFE_SESSION_EXPIRED'
      else 'FAIL_SAFE_DISCLOSURE_POSSIBLE'
    end;
    v_lease_expires_at := statement_timestamp()
      + make_interval(secs => p_lease_seconds);
  end if;

  update public.application_fill_attempts
  set execution_lease_owner = v_worker_id,
      execution_lease_expires_at = v_lease_expires_at,
      last_lease_heartbeat_at = statement_timestamp(),
      recovery_count = recovery_count + 1
  where id = v_fill.id;
  update public.application_runs
  set last_heartbeat_at = statement_timestamp()
  where id = v_fill.browser_run_id;

  select message.* into v_outbox
  from public.outbox as message
  where message.topic = 'application.browser_fill_requested'
    and message.payload ->> 'fill_attempt_id' = v_fill.id::text
    and message.published_at is not null
  order by message.created_at desc, message.id desc
  limit 1;

  if v_recovery_mode = 'RESUME_IDEMPOTENT_PROVISION'
     and v_outbox.id is null then
    v_recovery_mode := 'FAIL_SAFE_RECOVERY_BINDING_MISSING';
  end if;

  v_summary := jsonb_build_object(
    'state', 'RECOVERY_CLAIMED',
    'recovery_mode', v_recovery_mode,
    'recovery_sequence', v_fill.recovery_count + 1,
    'authority_scope', 'FILL_ONLY_NO_SUBMIT',
    'computer_session_id', v_session.id,
    'application_submitted', false
  );
  v_hash := encode(
    extensions.digest(convert_to(v_summary::text, 'utf8'), 'sha256'),
    'hex'
  );
  insert into public.application_fill_checkpoints (
    workspace_id, candidate_id, application_id, fill_attempt_id,
    computer_session_id, checkpoint_kind, checkpoint_hash, redacted_summary
  ) values (
    v_fill.workspace_id, v_fill.candidate_id, v_fill.application_id,
    v_fill.id, v_session.id, 'RECOVERY_CLAIMED', v_hash, v_summary
  );

  return query select v_fill.id, v_session.id, v_recovery_mode,
    v_outbox.id, v_outbox.topic, v_outbox.payload, v_outbox.attempt_count;
end;
$$;

revoke all on function public.start_application_fill_attempt(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) from public, anon, authenticated;
grant execute on function public.start_application_fill_attempt(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) to service_role;

revoke all on function public.activate_leased_computer_session(
  text, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.activate_leased_computer_session(
  text, uuid, text, text, text, text
) to service_role;

revoke all on function public.complete_leased_application_fill_attempt(
  text, uuid, text, text, jsonb, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_leased_application_fill_attempt(
  text, uuid, text, text, jsonb, boolean, jsonb
) to service_role;

revoke all on function public.claim_stale_application_fill_attempt(
  text, integer
) from public, anon, authenticated;
grant execute on function public.claim_stale_application_fill_attempt(
  text, integer
) to service_role;

comment on function public.claim_stale_application_fill_attempt(text, integer) is
  'Claims one stale STARTED browser fill. Only PROVISIONING may resume via the original computer-session idempotency key; ACTIVE or expired work must fail safe.';
