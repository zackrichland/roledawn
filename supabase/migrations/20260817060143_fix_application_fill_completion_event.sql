-- Correct the terminal fill event insert from the initial fill-authorization migration.
-- The original function supplied the correlation ID twice.

create or replace function public.complete_application_fill_attempt(
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
  v_fill public.application_fill_attempts%rowtype;
  v_session public.computer_sessions%rowtype;
  v_application_status text;
  v_checkpoint_kind text;
  v_session_state text;
  v_run_status text;
  v_event_id uuid := extensions.gen_random_uuid();
  v_new_aggregate bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_fill_attempt_id is null
     or p_terminal_status not in ('FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE')
     or p_checkpoint_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_redacted_summary) <> 'object'
     or jsonb_typeof(p_usage_summary) <> 'object'
     or p_redacted_summary ->> 'application_submitted' is distinct from 'false'
     or p_redacted_summary ->> 'submission_request_count' is distinct from '0' then
    raise exception 'APPLICATION_FILL_COMPLETION_INPUT_INVALID' using errcode = '22023';
  end if;

  select attempt.* into strict v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = p_fill_attempt_id for update;
  select session.* into strict v_session
  from public.computer_sessions as session
  where session.fill_attempt_id = v_fill.id for update;

  if v_fill.status = p_terminal_status then
    perform checkpoint.id
    from public.application_fill_checkpoints as checkpoint
    where checkpoint.fill_attempt_id = v_fill.id
      and checkpoint.checkpoint_hash = p_checkpoint_hash
      and checkpoint.redacted_summary = p_redacted_summary;
    if not found then
      raise exception 'APPLICATION_FILL_COMPLETION_REPLAY_MISMATCH' using errcode = 'PT409';
    end if;
    return query select v_fill.application_id,
      case v_fill.status
        when 'FILLED_TO_REVIEW' then 'PRE_SUBMIT_REVIEW'
        when 'TAKEOVER' then 'TAKEOVER'
        else 'FAILED_SAFE'
      end,
      v_session.id, true;
    return;
  end if;
  if v_fill.status <> 'STARTED'
     or (
       p_terminal_status in ('FILLED_TO_REVIEW', 'TAKEOVER')
       and v_session.state <> 'ACTIVE'
     )
     or (
       p_terminal_status = 'FAILED_SAFE'
       and v_session.state not in ('PROVISIONING', 'ACTIVE')
     ) then
    raise exception 'APPLICATION_FILL_COMPLETION_STATE_INVALID' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.application_attempts as submit_attempt
    where submit_attempt.application_id = v_fill.application_id
  ) or exists (
    select 1 from public.receipts as receipt
    where receipt.application_id = v_fill.application_id
  ) then
    raise exception 'APPLICATION_FILL_SUBMISSION_STATE_CONFLICT' using errcode = '55000';
  end if;

  if p_terminal_status = 'FILLED_TO_REVIEW' then
    v_application_status := 'PRE_SUBMIT_REVIEW';
    v_checkpoint_kind := 'FILLED_READ_BACK';
    v_session_state := case when p_runtime_destroyed then 'DESTROYED' else 'PAUSED_FOR_REVIEW' end;
    v_run_status := 'SUCCEEDED';
  elsif p_terminal_status = 'TAKEOVER' then
    v_application_status := 'TAKEOVER';
    v_checkpoint_kind := 'BLOCKED_FOR_TAKEOVER';
    v_session_state := case when p_runtime_destroyed then 'DESTROYED' else 'PAUSED_FOR_REVIEW' end;
    v_run_status := 'WAITING';
  else
    v_application_status := 'FAILED_SAFE';
    v_checkpoint_kind := 'FAILED_SAFE';
    v_session_state := case when p_runtime_destroyed then 'DESTROYED' else 'FAILED_SAFE' end;
    v_run_status := 'FAILED';
  end if;

  update public.application_fill_attempts
  set status = p_terminal_status, result_summary = p_redacted_summary,
      completed_at = statement_timestamp()
  where id = v_fill.id;
  update public.computer_sessions
  set state = v_session_state,
      paused_at = case when v_session_state = 'PAUSED_FOR_REVIEW' then statement_timestamp() else paused_at end,
      destroyed_at = case when v_session_state = 'DESTROYED' then statement_timestamp() else destroyed_at end,
      usage_summary = p_usage_summary
  where id = v_session.id;
  update public.application_runs
  set status = v_run_status,
      finished_at = case when v_run_status = 'WAITING' then null else statement_timestamp() end,
      last_heartbeat_at = statement_timestamp(),
      error_code = case when p_terminal_status = 'FAILED_SAFE' then 'BROWSER_FILL_FAILED_SAFE' else null end
  where id = v_fill.browser_run_id;

  select application.aggregate_version + 1 into strict v_new_aggregate
  from public.applications as application
  where application.id = v_fill.application_id for update;
  update public.applications
  set status = v_application_status, aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where id = v_fill.application_id;

  insert into public.application_fill_checkpoints (
    workspace_id, candidate_id, application_id, fill_attempt_id,
    computer_session_id, checkpoint_kind, checkpoint_hash, redacted_summary
  ) values (
    v_fill.workspace_id, v_fill.candidate_id, v_fill.application_id,
    v_fill.id, v_session.id, v_checkpoint_kind, p_checkpoint_hash,
    p_redacted_summary
  );

  insert into public.domain_events (
    id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_kind, correlation_id
  ) values (
    v_event_id, v_fill.workspace_id, 'APPLICATION', v_fill.application_id,
    v_new_aggregate,
    case p_terminal_status
      when 'FILLED_TO_REVIEW' then 'application.filled_for_review'
      when 'TAKEOVER' then 'application.fill_takeover_required'
      else 'application.fill_failed_safe'
    end,
    jsonb_build_object(
      'revision_id', v_fill.revision_id,
      'fill_attempt_id', v_fill.id,
      'computer_session_id', v_session.id,
      'authority_scope', 'FILL_ONLY_NO_SUBMIT',
      'application_submitted', false,
      'runtime_destroyed', p_runtime_destroyed
    ),
    'WORKER', v_fill.browser_run_id
  );

  return query select v_fill.application_id, v_application_status,
    v_session.id, false;
end;
$$;

