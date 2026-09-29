-- Qualify the application version to distinguish it from the identically named
-- RETURNS TABLE output variable. Preserve every existing resume authority check.
create or replace function public.request_application_fill_resume(
  p_command_id uuid,
  p_application_id uuid,
  p_expected_aggregate_version bigint,
  p_fill_attempt_id uuid,
  p_computer_session_id uuid,
  p_candidate_completed_required_fields boolean
)
returns table (
  application_id uuid,
  fill_attempt_id uuid,
  computer_session_id uuid,
  resume_attempt_id uuid,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_application public.applications%rowtype;
  v_fill public.application_fill_attempts%rowtype;
  v_session public.computer_sessions%rowtype;
  v_existing public.command_dedup%rowtype;
  v_resume_id uuid := extensions.gen_random_uuid();
  v_event_id uuid := extensions.gen_random_uuid();
  v_request_hash text;
  v_new_aggregate bigint;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_application_id is null
     or p_fill_attempt_id is null or p_computer_session_id is null
     or p_expected_aggregate_version is null
     or p_expected_aggregate_version <= 0
     or p_candidate_completed_required_fields is distinct from true then
    raise exception 'APPLICATION_FILL_RESUME_INPUT_INVALID' using errcode = '22023';
  end if;

  select application.* into strict v_application
  from public.applications as application
  join public.candidates as candidate
    on candidate.workspace_id = application.workspace_id
   and candidate.id = application.candidate_id
   and candidate.auth_user_id = v_actor
   and candidate.status in ('ONBOARDING', 'ACTIVE')
  join public.workspace_memberships as membership
    on membership.workspace_id = application.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = application.workspace_id
   and workspace.status = 'ACTIVE'
  where application.id = p_application_id
  for update of application
  for share of candidate, membership, workspace;

  v_request_hash := encode(extensions.digest(convert_to(
    p_application_id::text || E'\n' || p_expected_aggregate_version::text || E'\n'
      || p_fill_attempt_id::text || E'\n' || p_computer_session_id::text
      || E'\ntrue',
    'utf8'
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(v_application.workspace_id::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_application.workspace_id
    and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'REQUEST_APPLICATION_FILL_RESUME'
       or v_existing.request_hash <> v_request_hash
       or v_existing.actor_id <> v_actor then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select v_application.id,
      (v_existing.result ->> 'fill_attempt_id')::uuid,
      (v_existing.result ->> 'computer_session_id')::uuid,
      (v_existing.result ->> 'resume_attempt_id')::uuid,
      (v_existing.result ->> 'aggregate_version')::bigint,
      true;
    return;
  end if;

  if v_application.status <> 'TAKEOVER'
     or v_application.aggregate_version <> p_expected_aggregate_version then
    raise exception 'APPLICATION_FILL_RESUME_REVIEW_STALE' using errcode = 'PT409';
  end if;

  select attempt.* into strict v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = p_fill_attempt_id
    and attempt.workspace_id = v_application.workspace_id
    and attempt.candidate_id = v_application.candidate_id
    and attempt.application_id = v_application.id
  for update;
  select session.* into strict v_session
  from public.computer_sessions as session
  where session.id = p_computer_session_id
    and session.fill_attempt_id = v_fill.id
    and session.workspace_id = v_fill.workspace_id
    and session.candidate_id = v_fill.candidate_id
    and session.application_id = v_fill.application_id
    and session.revision_id = v_fill.revision_id
  for update;

  if v_fill.status <> 'TAKEOVER'
     or v_fill.authority_scope <> 'FILL_ONLY_NO_SUBMIT'
     or v_fill.approval_action <> 'FILL_APPLICATION_ONCE'
     or v_application.current_revision_id is distinct from v_fill.revision_id
     or v_session.state <> 'PAUSED_FOR_REVIEW'
     or v_session.expires_at <= statement_timestamp()
     or exists (
       select 1 from public.application_fill_resume_attempts as resume
       where resume.fill_attempt_id = v_fill.id and resume.status = 'QUEUED'
     ) then
    raise exception 'APPLICATION_FILL_RESUME_STATE_INVALID' using errcode = '55000';
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

  insert into public.command_dedup (
    workspace_id, command_id, actor_id, command_type, request_hash, status
  ) values (
    v_application.workspace_id, p_command_id, v_actor,
    'REQUEST_APPLICATION_FILL_RESUME', v_request_hash, 'STARTED'
  );
  insert into public.application_fill_resume_attempts (
    id, workspace_id, candidate_id, application_id, revision_id,
    fill_attempt_id, computer_session_id, command_id,
    candidate_confirmed_required_fields
  ) values (
    v_resume_id, v_fill.workspace_id, v_fill.candidate_id,
    v_fill.application_id, v_fill.revision_id, v_fill.id, v_session.id,
    p_command_id, true
  );

  update public.applications as application
  set aggregate_version = application.aggregate_version + 1,
      updated_at = statement_timestamp()
  where application.id = v_application.id
  returning application.aggregate_version into v_new_aggregate;

  insert into public.domain_events (
    id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_kind, actor_id, correlation_id
  ) values (
    v_event_id, v_fill.workspace_id, 'APPLICATION', v_fill.application_id,
    v_new_aggregate, 'application.fill_resume_requested',
    jsonb_build_object(
      'revision_id', v_fill.revision_id,
      'fill_attempt_id', v_fill.id,
      'computer_session_id', v_session.id,
      'resume_attempt_id', v_resume_id,
      'candidate_confirmed_required_fields', true,
      'authority_scope', 'FILL_ONLY_NO_SUBMIT',
      'application_submitted', false
    ),
    'CANDIDATE', v_actor, p_command_id
  );
  insert into public.outbox (workspace_id, event_id, topic, payload)
  values (
    v_fill.workspace_id, v_event_id,
    'application.browser_fill_resume_requested',
    jsonb_build_object(
      'application_id', v_fill.application_id,
      'revision_id', v_fill.revision_id,
      'fill_attempt_id', v_fill.id,
      'computer_session_id', v_session.id,
      'resume_attempt_id', v_resume_id,
      'authority_hash', v_fill.authority_hash,
      'disclosure_manifest_hash', v_fill.disclosure_manifest_hash,
      'authority_scope', 'FILL_ONLY_NO_SUBMIT'
    )
  );

  update public.command_dedup
  set aggregate_type = 'APPLICATION', aggregate_id = v_fill.application_id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object(
        'application_id', v_fill.application_id,
        'fill_attempt_id', v_fill.id,
        'computer_session_id', v_session.id,
        'resume_attempt_id', v_resume_id,
        'aggregate_version', v_new_aggregate
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_fill.workspace_id and command_id = p_command_id;

  return query select v_fill.application_id, v_fill.id, v_session.id,
    v_resume_id, v_new_aggregate, false;
end;
$$;

