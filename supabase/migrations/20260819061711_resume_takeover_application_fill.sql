-- RoleDawn: candidate-controlled continuation of the exact retained browser
-- after a TAKEOVER pause. This release adds no submission capability. The
-- original one-time FILL_APPLICATION_ONCE authority, immutable revision,
-- disclosure manifest, and no-submit runtime guard remain the only authority.

create table public.application_fill_resume_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  revision_id uuid not null,
  fill_attempt_id uuid not null,
  computer_session_id uuid not null,
  command_id uuid not null,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE')),
  candidate_confirmed_required_fields boolean not null
    check (candidate_confirmed_required_fields),
  result_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_summary) = 'object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, command_id),
  foreign key (workspace_id, candidate_id, application_id, fill_attempt_id)
    references public.application_fill_attempts(
      workspace_id, candidate_id, application_id, id
    ) on delete cascade,
  check (
    (status = 'QUEUED' and completed_at is null)
    or (status in ('FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE') and completed_at is not null)
  )
);

create unique index computer_sessions_resume_binding_key
  on public.computer_sessions (id, fill_attempt_id);

alter table public.application_fill_resume_attempts
  add constraint application_fill_resume_attempts_session_binding_fkey
  foreign key (computer_session_id, fill_attempt_id)
  references public.computer_sessions(id, fill_attempt_id)
  on delete cascade;

create index application_fill_resume_attempts_session_binding_idx
  on public.application_fill_resume_attempts (
    computer_session_id, fill_attempt_id
  );

create unique index application_fill_resume_attempts_one_queued_idx
  on public.application_fill_resume_attempts (fill_attempt_id)
  where status = 'QUEUED';

create index application_fill_resume_attempts_candidate_time_idx
  on public.application_fill_resume_attempts (candidate_id, created_at desc, id);

create index outbox_application_fill_resume_attempt_idx
  on public.outbox ((payload ->> 'resume_attempt_id'), created_at desc, id)
  where topic = 'application.browser_fill_resume_requested';

create function private.guard_application_fill_resume_attempt_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.id, new.workspace_id, new.candidate_id, new.application_id,
    new.revision_id, new.fill_attempt_id, new.computer_session_id,
    new.command_id, new.candidate_confirmed_required_fields, new.created_at
  ) is distinct from row(
    old.id, old.workspace_id, old.candidate_id, old.application_id,
    old.revision_id, old.fill_attempt_id, old.computer_session_id,
    old.command_id, old.candidate_confirmed_required_fields, old.created_at
  ) then
    raise exception 'APPLICATION_FILL_RESUME_BINDING_IMMUTABLE'
      using errcode = '55000';
  end if;
  if new.status <> old.status and not (
    old.status = 'QUEUED'
    and new.status in ('FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE')
  ) then
    raise exception 'APPLICATION_FILL_RESUME_TRANSITION_INVALID'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger application_fill_resume_attempts_guard
  before update on public.application_fill_resume_attempts
  for each row execute function private.guard_application_fill_resume_attempt_update();

-- A successful continuation completes the same immutable fill attempt. It
-- never creates a second fill authorization or a submission attempt.
create or replace function private.guard_application_fill_attempt_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.id, new.workspace_id, new.candidate_id, new.application_id,
    new.revision_id, new.approval_consumption_id, new.approval_action,
    new.browser_run_id, new.authority_hash,
    new.authority_scope, new.destination_url, new.destination_url_hash,
    new.packet_hash, new.diff_hash, new.artifact_manifest,
    new.artifact_manifest_hash, new.disclosure_manifest,
    new.disclosure_manifest_hash, new.executor_policy_release,
    new.destination_policy_release, new.created_at
  ) is distinct from row(
    old.id, old.workspace_id, old.candidate_id, old.application_id,
    old.revision_id, old.approval_consumption_id, old.approval_action,
    old.browser_run_id, old.authority_hash,
    old.authority_scope, old.destination_url, old.destination_url_hash,
    old.packet_hash, old.diff_hash, old.artifact_manifest,
    old.artifact_manifest_hash, old.disclosure_manifest,
    old.disclosure_manifest_hash, old.executor_policy_release,
    old.destination_policy_release, old.created_at
  ) then
    raise exception 'APPLICATION_FILL_BINDING_IMMUTABLE' using errcode = '55000';
  end if;

  if new.status <> old.status and not (
    (old.status = 'QUEUED' and new.status in ('STARTED', 'FAILED_SAFE', 'CANCELED'))
    or (old.status = 'STARTED' and new.status in ('FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE', 'CANCELED'))
    or (old.status = 'TAKEOVER' and new.status = 'FILLED_TO_REVIEW')
  ) then
    raise exception 'APPLICATION_FILL_TRANSITION_INVALID' using errcode = '55000';
  end if;
  return new;
end;
$$;

alter table public.application_fill_resume_attempts enable row level security;

create policy application_fill_resume_attempts_candidate_select
  on public.application_fill_resume_attempts for select to authenticated
  using (
    exists (
      select 1 from public.candidates as candidate
      where candidate.workspace_id = application_fill_resume_attempts.workspace_id
        and candidate.id = application_fill_resume_attempts.candidate_id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

revoke all on public.application_fill_resume_attempts
  from public, anon, authenticated;
grant select on public.application_fill_resume_attempts to authenticated;
grant all on public.application_fill_resume_attempts to service_role;

create function public.request_application_fill_resume(
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

  update public.applications
  set aggregate_version = aggregate_version + 1,
      updated_at = statement_timestamp()
  where id = v_application.id
  returning aggregate_version into v_new_aggregate;

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

create function public.complete_application_fill_resume(
  p_outbox_id uuid,
  p_worker_id text,
  p_resume_attempt_id uuid,
  p_terminal_status text,
  p_checkpoint_hash text,
  p_redacted_summary jsonb
)
returns table (
  application_id uuid,
  application_status text,
  fill_attempt_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_outbox public.outbox%rowtype;
  v_resume public.application_fill_resume_attempts%rowtype;
  v_fill public.application_fill_attempts%rowtype;
  v_session public.computer_sessions%rowtype;
  v_application public.applications%rowtype;
  v_event_id uuid := extensions.gen_random_uuid();
  v_new_aggregate bigint;
  v_application_status text;
  v_fill_status text;
  v_event_type text;
  v_checkpoint_kind text;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_outbox_id is null or p_resume_attempt_id is null
     or char_length(v_worker_id) not between 1 and 120
     or p_terminal_status not in ('FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE')
     or p_checkpoint_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_redacted_summary) <> 'object'
     or p_redacted_summary ->> 'schema_release'
          is distinct from 'application-fill-resume-result/1'
     or p_redacted_summary ->> 'authority_scope'
          is distinct from 'FILL_ONLY_NO_SUBMIT'
     or p_redacted_summary ->> 'application_submitted' is distinct from 'false'
     or p_redacted_summary ->> 'submission_request_count' is distinct from '0' then
    raise exception 'APPLICATION_FILL_RESUME_COMPLETION_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select resume.* into strict v_resume
  from public.application_fill_resume_attempts as resume
  where resume.id = p_resume_attempt_id
  for update;
  select attempt.* into strict v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = v_resume.fill_attempt_id
  for update;
  select session.* into strict v_session
  from public.computer_sessions as session
  where session.id = v_resume.computer_session_id
    and session.fill_attempt_id = v_fill.id
  for update;
  select application.* into strict v_application
  from public.applications as application
  where application.id = v_fill.application_id
  for update;

  if v_resume.status = p_terminal_status then
    perform checkpoint.id
    from public.application_fill_checkpoints as checkpoint
    where checkpoint.fill_attempt_id = v_fill.id
      and checkpoint.computer_session_id = v_session.id
      and checkpoint.checkpoint_hash = p_checkpoint_hash
      and checkpoint.redacted_summary = p_redacted_summary;
    if not found then
      raise exception 'APPLICATION_FILL_RESUME_COMPLETION_REPLAY_MISMATCH'
        using errcode = 'PT409';
    end if;
    return query select v_fill.application_id, v_application.status,
      v_fill.status, true;
    return;
  end if;

  select message.* into strict v_outbox
  from public.outbox as message
  where message.id = p_outbox_id
    and message.workspace_id = v_resume.workspace_id
  for update;
  if v_outbox.topic <> 'application.browser_fill_resume_requested'
     or v_outbox.published_at is not null
     or v_outbox.dead_lettered_at is not null
     or v_outbox.lease_owner is distinct from v_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= statement_timestamp()
     or v_outbox.payload ->> 'resume_attempt_id' <> v_resume.id::text
     or v_outbox.payload ->> 'fill_attempt_id' <> v_fill.id::text
     or v_outbox.payload ->> 'computer_session_id' <> v_session.id::text
     or v_outbox.payload ->> 'revision_id' <> v_fill.revision_id::text
     or v_outbox.payload ->> 'authority_hash' <> v_fill.authority_hash
     or v_outbox.payload ->> 'disclosure_manifest_hash'
          <> v_fill.disclosure_manifest_hash
     or v_outbox.payload ->> 'authority_scope' <> 'FILL_ONLY_NO_SUBMIT'
     or v_resume.status <> 'QUEUED'
     or v_fill.status <> 'TAKEOVER'
     or v_fill.authority_scope <> 'FILL_ONLY_NO_SUBMIT'
     or v_fill.approval_action <> 'FILL_APPLICATION_ONCE'
     or v_session.state <> 'PAUSED_FOR_REVIEW'
     or v_application.status <> 'TAKEOVER'
     or v_application.current_revision_id is distinct from v_fill.revision_id then
    raise exception 'APPLICATION_FILL_RESUME_COMPLETION_STATE_INVALID'
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

  if p_terminal_status = 'FILLED_TO_REVIEW' then
    v_application_status := 'PRE_SUBMIT_REVIEW';
    v_fill_status := 'FILLED_TO_REVIEW';
    v_event_type := 'application.filled_for_review';
    v_checkpoint_kind := 'FILLED_READ_BACK';

    update public.application_fill_attempts
    set status = 'FILLED_TO_REVIEW', result_summary = p_redacted_summary,
        completed_at = statement_timestamp()
    where id = v_fill.id;
    update public.application_runs
    set status = 'SUCCEEDED', finished_at = statement_timestamp(),
        last_heartbeat_at = statement_timestamp(), error_code = null
    where id = v_fill.browser_run_id;
  elsif p_terminal_status = 'TAKEOVER' then
    v_application_status := 'TAKEOVER';
    v_fill_status := 'TAKEOVER';
    v_event_type := 'application.fill_takeover_still_required';
    v_checkpoint_kind := 'BLOCKED_FOR_TAKEOVER';
    update public.application_runs
    set status = 'WAITING', last_heartbeat_at = statement_timestamp(),
        error_code = null
    where id = v_fill.browser_run_id;
  else
    v_application_status := 'TAKEOVER';
    v_fill_status := 'TAKEOVER';
    v_event_type := 'application.fill_resume_failed_safe';
    v_checkpoint_kind := 'FAILED_SAFE';
    update public.application_runs
    set status = 'WAITING', last_heartbeat_at = statement_timestamp(),
        error_code = 'BROWSER_FILL_RESUME_FAILED_SAFE'
    where id = v_fill.browser_run_id;
  end if;

  update public.application_fill_resume_attempts
  set status = p_terminal_status, result_summary = p_redacted_summary,
      completed_at = statement_timestamp()
  where id = v_resume.id;

  update public.applications
  set status = v_application_status, aggregate_version = aggregate_version + 1,
      updated_at = statement_timestamp()
  where id = v_application.id
  returning aggregate_version into v_new_aggregate;

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
    v_new_aggregate, v_event_type,
    p_redacted_summary || jsonb_build_object(
      'revision_id', v_fill.revision_id,
      'fill_attempt_id', v_fill.id,
      'computer_session_id', v_session.id,
      'resume_attempt_id', v_resume.id
    ),
    'WORKER', v_fill.browser_run_id
  );
  update public.outbox
  set published_at = statement_timestamp(), lease_owner = null,
      lease_expires_at = null, last_error = null
  where id = v_outbox.id;

  return query select v_fill.application_id, v_application_status,
    v_fill_status, false;
end;
$$;

revoke all on function public.request_application_fill_resume(
  uuid, uuid, bigint, uuid, uuid, boolean
) from public, anon;
grant execute on function public.request_application_fill_resume(
  uuid, uuid, bigint, uuid, uuid, boolean
) to authenticated, service_role;

revoke all on function public.complete_application_fill_resume(
  uuid, text, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_application_fill_resume(
  uuid, text, uuid, text, text, jsonb
) to service_role;

comment on table public.application_fill_resume_attempts is
  'Candidate-requested continuations of the exact retained no-submit browser after TAKEOVER. Each row preserves the original fill authority and immutable session binding.';
comment on function public.request_application_fill_resume(
  uuid, uuid, bigint, uuid, uuid, boolean
) is
  'Queues a replay-safe continuation only after the owning candidate confirms required browser questions are complete. Does not create or extend submission authority.';
comment on function public.complete_application_fill_resume(
  uuid, text, uuid, text, text, jsonb
) is
  'Service-only completion for one leased resume outbox item. Validates the original fill/session binding and requires zero submission requests.';
