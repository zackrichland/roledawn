-- RoleDawn / HireWire: qualify the PREPARATION run transition in the
-- service-role failure command. The function returns an `application_id`
-- column, so unqualified table columns are ambiguous to PL/pgSQL.

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

  update public.job_intakes as intake
  set status = 'FAILED', failure_code = v_failure_code,
      updated_at = statement_timestamp()
  where intake.id = v_intake.id;

  v_new_version := v_application.aggregate_version + 1;
  update public.applications as application
  set status = 'FAILED_SAFE', aggregate_version = v_new_version,
      updated_at = statement_timestamp()
  where application.workspace_id = v_application.workspace_id
    and application.id = v_application.id;

  update public.application_runs as run
  set status = 'FAILED', error_code = v_failure_code,
      finished_at = statement_timestamp()
  where run.workspace_id = v_application.workspace_id
    and run.application_id = v_application.id
    and run.run_kind = 'PREPARATION'
    and run.status = 'QUEUED';

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

revoke all on function public.fail_pasted_link_intake(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fail_pasted_link_intake(uuid, uuid, text, timestamptz)
  to service_role;

comment on function public.fail_pasted_link_intake(uuid, uuid, text, timestamptz) is
  'Service-only idempotent failure transition for one unresolved pasted-link intake.';
