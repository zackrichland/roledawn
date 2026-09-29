-- RoleDawn / HireWire: let a candidate retry a pasted-link import that failed.
-- A pasted URL is deduplicated per candidate, so pasting the same link again
-- returns the failed application; before this, a transient or since-fixed
-- import failure could never be retried. Only an application that never got
-- past intake (no job, no revision) can be retried, and the same intake is
-- reused so the candidate-URL dedup stays one application per link.

create or replace function public.retry_pasted_link_intake(p_command_id uuid, p_application_id uuid)
returns table (application_id uuid, aggregate_version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_application public.applications%rowtype;
  v_intake public.job_intakes%rowtype;
  v_existing public.command_dedup%rowtype;
  v_hash text;
  v_event uuid := extensions.gen_random_uuid();
  v_version bigint;
begin
  if p_command_id is null or p_application_id is null then
    raise exception 'INTAKE_RETRY_INPUT_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;
  v_hash := encode(extensions.digest(convert_to(p_application_id::text, 'utf8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'RETRY_PASTED_LINK_INTAKE' or v_existing.request_hash <> v_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query select p_application_id, (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;

  select app.* into v_application from public.applications as app
  where app.id = p_application_id and app.workspace_id = v_workspace and app.candidate_id = v_candidate
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = '23503'; end if;
  if v_application.job_intake_id is null then raise exception 'INTAKE_NOT_RETRYABLE' using errcode = '55000'; end if;
  select intake.* into strict v_intake from public.job_intakes as intake
  where intake.workspace_id = v_workspace and intake.id = v_application.job_intake_id
  for update;
  if v_intake.status <> 'FAILED' or v_application.status <> 'FAILED_SAFE'
     or v_application.job_id is not null or v_application.current_revision_id is not null then
    raise exception 'INTAKE_NOT_RETRYABLE' using errcode = '55000';
  end if;

  v_version := v_application.aggregate_version + 1;
  update public.job_intakes as intake
  set status = 'PENDING', failure_code = null, updated_at = statement_timestamp()
  where intake.id = v_intake.id;
  update public.applications as app
  set status = 'DRAFTING', aggregate_version = v_version, updated_at = statement_timestamp()
  where app.id = v_application.id;
  insert into public.application_runs (workspace_id, application_id, run_kind, status)
  values (v_workspace, v_application.id, 'PREPARATION', 'QUEUED');

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version, event_type,
     payload, actor_kind, actor_id, correlation_id)
  values
    (v_event, v_workspace, 'APPLICATION', v_application.id, v_version, 'application.intake_retry_requested',
     jsonb_build_object('job_intake_id', v_intake.id, 'previous_failure_code', v_intake.failure_code),
     'CANDIDATE', v_actor, p_command_id);
  insert into public.outbox (workspace_id, event_id, topic, payload)
  values (v_workspace, v_event, 'application.queued',
    jsonb_build_object('application_id', v_application.id, 'job_intake_id', v_intake.id));
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status, aggregate_type, aggregate_id,
     result_event_id, result, completed_at)
  values (v_workspace, p_command_id, v_actor, 'RETRY_PASTED_LINK_INTAKE', v_hash, 'COMMITTED', 'APPLICATION',
     v_application.id, v_event, jsonb_build_object('application_id', v_application.id, 'aggregate_version', v_version),
     statement_timestamp());

  return query select v_application.id, v_version, false;
end;
$$;

revoke all on function public.retry_pasted_link_intake(uuid, uuid) from public, anon;
grant execute on function public.retry_pasted_link_intake(uuid, uuid) to authenticated, service_role;
