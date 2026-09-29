-- RoleDawn: reconcile a retained no-submit browser after candidate review or
-- takeover time expires, or when the supervising worker stops.
--
-- The fill attempt is already terminal before this RPC runs. This transaction
-- only closes the bound computer-session lifecycle, records measured usage,
-- and emits an audit event. It deliberately preserves the candidate-facing
-- PRE_SUBMIT_REVIEW / TAKEOVER state and contains no submission authority.

alter table public.application_fill_checkpoints
  drop constraint application_fill_checkpoints_checkpoint_kind_check;

alter table public.application_fill_checkpoints
  add constraint application_fill_checkpoints_checkpoint_kind_check
  check (checkpoint_kind in (
    'SESSION_RESERVED', 'SESSION_ACTIVE', 'RECOVERY_CLAIMED',
    'FILLED_READ_BACK', 'BLOCKED_FOR_TAKEOVER', 'FAILED_SAFE',
    'SESSION_CLOSED', 'SESSION_DESTROYED',
    'RUNTIME_RELEASED', 'RUNTIME_RELEASE_UNCERTAIN'
  ));

create unique index application_fill_checkpoints_one_runtime_release_idx
  on public.application_fill_checkpoints (computer_session_id)
  where checkpoint_kind in ('RUNTIME_RELEASED', 'RUNTIME_RELEASE_UNCERTAIN');

create function public.reconcile_application_fill_runtime_release(
  p_fill_attempt_id uuid,
  p_computer_session_id uuid,
  p_release_reason text,
  p_release_outcome text,
  p_usage_summary jsonb,
  p_supervisor_release text,
  p_error_code text
)
returns table (
  application_id uuid,
  application_status text,
  computer_session_state text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fill public.application_fill_attempts%rowtype;
  v_session public.computer_sessions%rowtype;
  v_application public.applications%rowtype;
  v_existing public.application_fill_checkpoints%rowtype;
  v_expected_application_status text;
  v_session_state text;
  v_checkpoint_kind text;
  v_event_type text;
  v_run_status text;
  v_recorded_usage jsonb;
  v_summary jsonb;
  v_checkpoint_hash text;
  v_new_aggregate bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_fill_attempt_id is null
     or p_computer_session_id is null
     or p_release_reason not in ('TTL_EXPIRED', 'WORKER_STOPPED')
     or p_release_outcome not in ('RELEASED', 'RELEASE_UNCERTAIN')
     or jsonb_typeof(p_usage_summary) <> 'object'
     or p_supervisor_release is distinct from
          'application-fill-runtime-supervisor/1'
     or (
       p_release_outcome = 'RELEASED'
       and (
         p_error_code is not null
         or p_usage_summary ->> 'schema_release'
              is distinct from 'computer-runtime-release-usage/1'
         or p_usage_summary ->> 'runtime_destroyed' is distinct from 'true'
         or p_usage_summary ->> 'telemetry_available' is distinct from 'true'
         or p_usage_summary ->> 'submission_request_count' is distinct from '0'
         or p_usage_summary ->> 'application_submitted' is distinct from 'false'
         or jsonb_typeof(p_usage_summary -> 'wall_clock_ms') <> 'number'
         or jsonb_typeof(p_usage_summary -> 'provider_billed_ms') <> 'number'
         or jsonb_typeof(p_usage_summary -> 'uploaded_byte_count') <> 'number'
         or jsonb_typeof(p_usage_summary -> 'blocked_submission_attempt_count') <> 'number'
         or (p_usage_summary ->> 'wall_clock_ms') !~ '^[0-9]+$'
         or (p_usage_summary ->> 'provider_billed_ms') !~ '^[0-9]+$'
         or (p_usage_summary ->> 'uploaded_byte_count') !~ '^[0-9]+$'
         or (p_usage_summary ->> 'blocked_submission_attempt_count') !~ '^[0-9]+$'
       )
     )
     or (
       p_release_outcome = 'RELEASE_UNCERTAIN'
       and (
         p_error_code is null
         or p_error_code !~ '^[A-Z][A-Z0-9_]{2,119}$'
         or p_usage_summary <> '{}'::jsonb
       )
     ) then
    raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_INPUT_INVALID'
      using errcode = '22023';
  end if;
  if p_release_outcome = 'RELEASED' and (
    (p_usage_summary ->> 'wall_clock_ms')::numeric > 1000000000
    or (p_usage_summary ->> 'provider_billed_ms')::numeric > 1000000000
    or (p_usage_summary ->> 'uploaded_byte_count')::numeric > 1000000000
    or (p_usage_summary ->> 'blocked_submission_attempt_count')::numeric
      > 1000000000
  ) then
    raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select attempt.* into v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = p_fill_attempt_id
  for update;
  if not found then
    raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_BINDING_INVALID'
      using errcode = '22023';
  end if;

  select session.* into v_session
  from public.computer_sessions as session
  where session.id = p_computer_session_id
    and session.fill_attempt_id = v_fill.id
    and session.workspace_id = v_fill.workspace_id
    and session.application_id = v_fill.application_id
    and session.revision_id = v_fill.revision_id
  for update;
  if not found then
    raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_BINDING_INVALID'
      using errcode = '22023';
  end if;

  select application.* into strict v_application
  from public.applications as application
  where application.id = v_fill.application_id
    and application.workspace_id = v_fill.workspace_id
    and application.candidate_id = v_fill.candidate_id
  for update;

  if v_fill.status = 'FILLED_TO_REVIEW' then
    v_expected_application_status := 'PRE_SUBMIT_REVIEW';
  elsif v_fill.status = 'TAKEOVER' then
    v_expected_application_status := 'TAKEOVER';
  else
    raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_STATE_INVALID'
      using errcode = '55000';
  end if;
  if v_application.status <> v_expected_application_status then
    raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_STATE_INVALID'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.application_attempts as submit_attempt
    where submit_attempt.application_id = v_fill.application_id
  ) or exists (
    select 1 from public.receipts as receipt
    where receipt.application_id = v_fill.application_id
  ) then
    raise exception 'APPLICATION_FILL_SUBMISSION_STATE_CONFLICT'
      using errcode = '55000';
  end if;

  if p_release_outcome = 'RELEASED' then
    v_session_state := 'DESTROYED';
    v_checkpoint_kind := 'RUNTIME_RELEASED';
    v_event_type := 'application.fill_review_runtime_released';
    v_run_status := 'SUCCEEDED';
    v_recorded_usage := p_usage_summary;
  else
    v_session_state := 'FAILED_SAFE';
    v_checkpoint_kind := 'RUNTIME_RELEASE_UNCERTAIN';
    v_event_type := 'application.fill_review_runtime_release_uncertain';
    v_run_status := 'FAILED';
    v_recorded_usage := jsonb_build_object(
      'schema_release', 'computer-runtime-release-usage/1',
      'runtime_destroyed', null,
      'telemetry_available', false,
      'submission_request_count', null,
      'application_submitted', null,
      'error_code', p_error_code
    );
  end if;

  v_summary := jsonb_build_object(
    'schema_release', 'application-fill-runtime-release/1',
    'fill_attempt_id', v_fill.id,
    'computer_session_id', v_session.id,
    'release_reason', p_release_reason,
    'release_outcome', p_release_outcome,
    'error_code', p_error_code,
    'supervisor_release', p_supervisor_release,
    'authority_scope', 'FILL_ONLY_NO_SUBMIT',
    'runtime_destroyed', case
      when p_release_outcome = 'RELEASED' then to_jsonb(true)
      else 'null'::jsonb
    end,
    'telemetry_available', p_release_outcome = 'RELEASED',
    'usage', case
      when p_release_outcome = 'RELEASED' then p_usage_summary
      else 'null'::jsonb
    end,
    'submission_request_count', case
      when p_release_outcome = 'RELEASED' then to_jsonb(0)
      else 'null'::jsonb
    end,
    'application_submitted', case
      when p_release_outcome = 'RELEASED' then to_jsonb(false)
      else 'null'::jsonb
    end
  );
  v_checkpoint_hash := encode(
    extensions.digest(convert_to(v_summary::text, 'utf8'), 'sha256'),
    'hex'
  );

  select checkpoint.* into v_existing
  from public.application_fill_checkpoints as checkpoint
  where checkpoint.computer_session_id = v_session.id
    and checkpoint.checkpoint_kind in (
      'RUNTIME_RELEASED', 'RUNTIME_RELEASE_UNCERTAIN'
    )
  for update;

  if found then
    if v_existing.checkpoint_kind <> v_checkpoint_kind
       or v_existing.checkpoint_hash <> v_checkpoint_hash
       or v_existing.redacted_summary <> v_summary
       or v_session.state <> v_session_state
       or v_session.usage_summary <> v_recorded_usage then
      raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_REPLAY_MISMATCH'
        using errcode = 'PT409';
    end if;
    return query select v_fill.application_id, v_application.status,
      v_session.state, true;
    return;
  end if;

  if v_session.state <> 'PAUSED_FOR_REVIEW' then
    raise exception 'APPLICATION_FILL_RUNTIME_RELEASE_STATE_INVALID'
      using errcode = '55000';
  end if;

  update public.computer_sessions
  set state = v_session_state,
      destroyed_at = case
        when v_session_state = 'DESTROYED' then statement_timestamp()
        else destroyed_at
      end,
      usage_summary = v_recorded_usage
  where id = v_session.id;

  update public.application_runs
  set status = v_run_status,
      finished_at = coalesce(finished_at, statement_timestamp()),
      last_heartbeat_at = statement_timestamp(),
      error_code = case
        when p_release_outcome = 'RELEASE_UNCERTAIN' then p_error_code
        else error_code
      end
  where id = v_fill.browser_run_id;

  insert into public.application_fill_checkpoints (
    workspace_id, candidate_id, application_id, fill_attempt_id,
    computer_session_id, checkpoint_kind, checkpoint_hash, redacted_summary
  ) values (
    v_fill.workspace_id, v_fill.candidate_id, v_fill.application_id,
    v_fill.id, v_session.id, v_checkpoint_kind, v_checkpoint_hash, v_summary
  );

  v_new_aggregate := v_application.aggregate_version + 1;
  update public.applications
  set aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where id = v_application.id;

  insert into public.domain_events (
    workspace_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_kind, correlation_id
  ) values (
    v_fill.workspace_id, 'APPLICATION', v_fill.application_id,
    v_new_aggregate, v_event_type,
    v_summary || jsonb_build_object(
      'revision_id', v_fill.revision_id,
      'application_status', v_application.status
    ),
    'WORKER', v_fill.browser_run_id
  );

  return query select v_fill.application_id, v_application.status,
    v_session_state, false;
end;
$$;

revoke all on function public.reconcile_application_fill_runtime_release(
  uuid, uuid, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.reconcile_application_fill_runtime_release(
  uuid, uuid, text, text, jsonb, text, text
) to service_role;

comment on function public.reconcile_application_fill_runtime_release(
  uuid, uuid, text, text, jsonb, text, text
) is
  'Service-only, idempotent reconciliation of one retained no-submit browser runtime. Preserves PRE_SUBMIT_REVIEW or TAKEOVER and records unknown submission state when telemetry is uncertain.';
