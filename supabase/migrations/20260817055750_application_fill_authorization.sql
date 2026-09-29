-- RoleDawn: candidate-authorized, revision-bound browser filling.
--
-- This migration deliberately stops before final submission. A candidate can
-- authorize release of one immutable Application Kit into one named employer
-- form. That authority is consumed once and creates a separate browser-fill
-- run. Existing application_attempts and SUBMIT_APPLICATION_ONCE approvals stay
-- reserved for a later, independently approved submission transaction.

alter table public.applications
  drop constraint applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status in (
    'DRAFTING', 'NEEDS_USER', 'READY', 'AUTHORIZED', 'EXECUTING',
    'TAKEOVER', 'PRE_SUBMIT_REVIEW', 'RECONCILING', 'CONFIRMED',
    'SKIPPED', 'FAILED_SAFE', 'CANCELED'
  ));

drop index if exists public.applications_attention_idx;
create index applications_attention_idx
  on public.applications (candidate_id, status, queued_at desc, id)
  where status in (
    'NEEDS_USER', 'READY', 'TAKEOVER', 'PRE_SUBMIT_REVIEW', 'RECONCILING'
  );

alter table public.approval_challenges
  drop constraint approval_challenges_permitted_action_check;

alter table public.approval_challenges
  add column authority_manifest jsonb,
  add column authority_hash text;

alter table public.approval_challenges
  add constraint approval_challenges_permitted_action_check
    check (permitted_action in ('FILL_APPLICATION_ONCE', 'SUBMIT_APPLICATION_ONCE')),
  add constraint approval_challenges_authority_hash_check
    check (authority_hash is null or authority_hash ~ '^[0-9a-f]{64}$'),
  add constraint approval_challenges_fill_authority_check
    check (
      permitted_action <> 'FILL_APPLICATION_ONCE'
      or (
        jsonb_typeof(authority_manifest) = 'object'
        and authority_hash ~ '^[0-9a-f]{64}$'
        and authority_manifest ->> 'permitted_action' = 'FILL_APPLICATION_ONCE'
        and authority_manifest ->> 'submission_authority' = 'false'
      )
    );

-- Carry the permitted action through consumption and attempt foreign keys.
-- Without this discriminator a service insert could accidentally attach a
-- fill-only consumption to the later submission-attempt table.
alter table public.approval_challenges
  add constraint approval_challenges_action_reference_key
  unique (workspace_id, id, application_id, revision_id, permitted_action);

alter table public.approval_consumptions
  add column permitted_action text not null default 'SUBMIT_APPLICATION_ONCE'
    check (permitted_action in ('FILL_APPLICATION_ONCE', 'SUBMIT_APPLICATION_ONCE')),
  add constraint approval_consumptions_action_reference_key
    unique (workspace_id, id, application_id, revision_id, permitted_action),
  add constraint approval_consumptions_action_fkey
    foreign key (
      workspace_id, approval_id, application_id, revision_id, permitted_action
    ) references public.approval_challenges(
      workspace_id, id, application_id, revision_id, permitted_action
    ) on delete restrict;

alter table public.application_attempts
  add column approval_action text not null default 'SUBMIT_APPLICATION_ONCE'
    check (approval_action = 'SUBMIT_APPLICATION_ONCE'),
  add constraint application_attempts_submit_authority_fkey
    foreign key (
      workspace_id, approval_consumption_id, application_id, revision_id,
      approval_action
    ) references public.approval_consumptions(
      workspace_id, id, application_id, revision_id, permitted_action
    ) on delete restrict;

alter table public.approval_consumptions
  alter column permitted_action drop default;
alter table public.application_attempts
  alter column approval_action drop default;

create table public.application_fill_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  revision_id uuid not null,
  approval_consumption_id uuid not null,
  approval_action text not null
    check (approval_action = 'FILL_APPLICATION_ONCE'),
  browser_run_id uuid not null,
  authority_hash text not null check (authority_hash ~ '^[0-9a-f]{64}$'),
  authority_scope text not null default 'FILL_ONLY_NO_SUBMIT'
    check (authority_scope = 'FILL_ONLY_NO_SUBMIT'),
  destination_url text not null check (private.is_public_https_job_url(destination_url)),
  destination_url_hash text not null check (destination_url_hash ~ '^[0-9a-f]{64}$'),
  packet_hash text not null check (packet_hash ~ '^[0-9a-f]{64}$'),
  diff_hash text not null check (diff_hash ~ '^[0-9a-f]{64}$'),
  artifact_manifest jsonb not null check (jsonb_typeof(artifact_manifest) = 'array'),
  artifact_manifest_hash text not null check (artifact_manifest_hash ~ '^[0-9a-f]{64}$'),
  disclosure_manifest jsonb not null check (jsonb_typeof(disclosure_manifest) = 'object'),
  disclosure_manifest_hash text not null check (disclosure_manifest_hash ~ '^[0-9a-f]{64}$'),
  executor_policy_release text not null
    check (char_length(btrim(executor_policy_release)) between 1 and 120),
  destination_policy_release text not null
    check (char_length(btrim(destination_policy_release)) between 1 and 120),
  adapter_release text check (
    adapter_release is null
    or char_length(btrim(adapter_release)) between 1 and 120
  ),
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'STARTED', 'FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE', 'CANCELED')),
  result_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_summary) = 'object'),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, application_id, id),
  unique (workspace_id, application_id, revision_id, id),
  unique (approval_consumption_id),
  unique (browser_run_id),
  foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade,
  foreign key (workspace_id, application_id, revision_id)
    references public.application_revisions(workspace_id, application_id, id) on delete restrict,
  foreign key (
    workspace_id, approval_consumption_id, application_id, revision_id,
    approval_action
  ) references public.approval_consumptions(
    workspace_id, id, application_id, revision_id, permitted_action
  ) on delete restrict,
  foreign key (workspace_id, application_id, browser_run_id)
    references public.application_runs(workspace_id, application_id, id) on delete restrict,
  check (started_at is null or started_at >= created_at),
  check (completed_at is null or completed_at >= coalesce(started_at, created_at)),
  check (
    (status = 'QUEUED' and started_at is null and completed_at is null)
    or (status = 'STARTED' and started_at is not null and completed_at is null)
    or (status in ('FILLED_TO_REVIEW', 'TAKEOVER', 'FAILED_SAFE', 'CANCELED') and completed_at is not null)
  )
);

create unique index application_fill_attempts_one_active_idx
  on public.application_fill_attempts (application_id)
  where status in ('QUEUED', 'STARTED');
create unique index application_runs_one_active_browser_fill_idx
  on public.application_runs (application_id)
  where run_kind = 'BROWSER_FILL' and status in ('QUEUED', 'RUNNING', 'WAITING');
create index application_fill_attempts_candidate_time_idx
  on public.application_fill_attempts (candidate_id, created_at desc, id);
create index application_fill_attempts_revision_idx
  on public.application_fill_attempts (revision_id, created_at desc, id);

create table public.computer_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  revision_id uuid not null,
  fill_attempt_id uuid not null,
  execution_mode text not null
    check (execution_mode in ('EPHEMERAL_CLEAN', 'EPHEMERAL_WITH_PERSISTENT_CONTEXT')),
  state text not null default 'PROVISIONING'
    check (state in ('PROVISIONING', 'ACTIVE', 'PAUSED_FOR_REVIEW', 'CLOSED', 'DESTROYED', 'FAILED_SAFE')),
  start_url text not null check (private.is_public_https_job_url(start_url)),
  allowed_domain_policy jsonb not null check (jsonb_typeof(allowed_domain_policy) = 'object'),
  allowed_domain_policy_hash text not null check (allowed_domain_policy_hash ~ '^[0-9a-f]{64}$'),
  mounted_artifact_manifest jsonb not null check (jsonb_typeof(mounted_artifact_manifest) = 'array'),
  browser_profile_ref uuid,
  broker_release text not null check (char_length(btrim(broker_release)) between 1 and 120),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  paused_at timestamptz,
  closed_at timestamptz,
  destroyed_at timestamptz,
  usage_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_summary) = 'object'),
  unique (workspace_id, id),
  unique (fill_attempt_id),
  foreign key (workspace_id, candidate_id, application_id, fill_attempt_id)
    references public.application_fill_attempts(workspace_id, candidate_id, application_id, id) on delete cascade,
  foreign key (workspace_id, application_id, revision_id, fill_attempt_id)
    references public.application_fill_attempts(workspace_id, application_id, revision_id, id) on delete restrict,
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes'),
  check (activated_at is null or activated_at >= created_at),
  check (paused_at is null or paused_at >= coalesce(activated_at, created_at)),
  check (closed_at is null or closed_at >= coalesce(activated_at, created_at)),
  check (destroyed_at is null or destroyed_at >= coalesce(closed_at, paused_at, activated_at, created_at))
);

create index computer_sessions_candidate_time_idx
  on public.computer_sessions (candidate_id, created_at desc, id);
create index computer_sessions_expiry_idx
  on public.computer_sessions (expires_at, id)
  where state in ('PROVISIONING', 'ACTIVE', 'PAUSED_FOR_REVIEW');

-- Provider-specific identifiers stay behind the broker adapter and are never
-- selectable through the Data API. They are operational handles, not product
-- identity or durable candidate memory.
create table private.computer_session_provider_refs (
  computer_session_id uuid primary key references public.computer_sessions(id) on delete cascade,
  provider_adapter text not null check (char_length(btrim(provider_adapter)) between 1 and 120),
  provider_session_ref text not null check (char_length(btrim(provider_session_ref)) between 1 and 512),
  provider_context_ref text check (
    provider_context_ref is null
    or char_length(btrim(provider_context_ref)) between 1 and 512
  ),
  created_at timestamptz not null default now(),
  unique (provider_adapter, provider_session_ref)
);

create table public.application_fill_checkpoints (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  fill_attempt_id uuid not null,
  computer_session_id uuid,
  checkpoint_kind text not null check (checkpoint_kind in (
    'SESSION_RESERVED', 'SESSION_ACTIVE', 'FILLED_READ_BACK',
    'BLOCKED_FOR_TAKEOVER', 'FAILED_SAFE', 'SESSION_CLOSED', 'SESSION_DESTROYED'
  )),
  checkpoint_hash text not null check (checkpoint_hash ~ '^[0-9a-f]{64}$'),
  redacted_summary jsonb not null check (jsonb_typeof(redacted_summary) = 'object'),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (fill_attempt_id, checkpoint_hash),
  foreign key (workspace_id, candidate_id, application_id, fill_attempt_id)
    references public.application_fill_attempts(workspace_id, candidate_id, application_id, id) on delete cascade,
  foreign key (workspace_id, computer_session_id)
    references public.computer_sessions(workspace_id, id) on delete restrict
);

create index application_fill_checkpoints_attempt_time_idx
  on public.application_fill_checkpoints (fill_attempt_id, created_at, id);
create index application_fill_checkpoints_session_idx
  on public.application_fill_checkpoints (computer_session_id, created_at, id)
  where computer_session_id is not null;

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
  ) then
    raise exception 'APPLICATION_FILL_TRANSITION_INVALID' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger application_fill_attempts_guard
  before update on public.application_fill_attempts
  for each row execute function private.guard_application_fill_attempt_update();

create or replace function private.guard_computer_session_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.id, new.workspace_id, new.candidate_id, new.application_id,
    new.revision_id, new.fill_attempt_id, new.execution_mode,
    new.start_url, new.allowed_domain_policy,
    new.allowed_domain_policy_hash, new.mounted_artifact_manifest,
    new.browser_profile_ref, new.broker_release, new.expires_at, new.created_at
  ) is distinct from row(
    old.id, old.workspace_id, old.candidate_id, old.application_id,
    old.revision_id, old.fill_attempt_id, old.execution_mode,
    old.start_url, old.allowed_domain_policy,
    old.allowed_domain_policy_hash, old.mounted_artifact_manifest,
    old.browser_profile_ref, old.broker_release, old.expires_at, old.created_at
  ) then
    raise exception 'COMPUTER_SESSION_BINDING_IMMUTABLE' using errcode = '55000';
  end if;

  if new.state <> old.state and not (
    (old.state = 'PROVISIONING' and new.state in ('ACTIVE', 'FAILED_SAFE', 'DESTROYED'))
    or (old.state = 'ACTIVE' and new.state in ('PAUSED_FOR_REVIEW', 'CLOSED', 'DESTROYED', 'FAILED_SAFE'))
    or (old.state = 'PAUSED_FOR_REVIEW' and new.state in ('CLOSED', 'DESTROYED', 'FAILED_SAFE'))
    or (old.state = 'CLOSED' and new.state = 'DESTROYED')
  ) then
    raise exception 'COMPUTER_SESSION_TRANSITION_INVALID' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger computer_sessions_guard
  before update on public.computer_sessions
  for each row execute function private.guard_computer_session_update();

create trigger application_fill_checkpoints_immutable
  before update or delete on public.application_fill_checkpoints
  for each row execute function private.reject_row_mutation();

create or replace function private.guard_submission_receipt_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_action text;
  v_attempt_action text;
begin
  select attempt.status, challenge.permitted_action, attempt.approval_action
  into strict v_status, v_action, v_attempt_action
  from public.application_attempts as attempt
  join public.approval_consumptions as consumption
    on consumption.workspace_id = attempt.workspace_id
   and consumption.id = attempt.approval_consumption_id
  join public.approval_challenges as challenge
    on challenge.workspace_id = consumption.workspace_id
   and challenge.id = consumption.approval_id
  where attempt.workspace_id = new.workspace_id
    and attempt.application_id = new.application_id
    and attempt.id = new.attempt_id;

  if v_status <> 'CONFIRMED'
     or v_action <> 'SUBMIT_APPLICATION_ONCE'
     or v_attempt_action <> 'SUBMIT_APPLICATION_ONCE' then
    raise exception 'CONFIRMED_SUBMISSION_AUTHORITY_REQUIRED' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- A source document frozen into a fill-ready or filled application remains
-- available until that application leaves the active lifecycle. This replaces
-- the earlier guard so PRE_SUBMIT_REVIEW cannot strand a browser read-back.
create or replace function private.guard_active_application_source_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'DELETION_PENDING'
     and old.status is distinct from 'DELETION_PENDING' then
    perform application.id
    from public.applications as application
    where application.workspace_id = old.workspace_id
      and application.id in (
        select snapshot.application_id
        from public.application_input_snapshots as snapshot
        where snapshot.workspace_id = old.workspace_id
          and snapshot.candidate_id = old.candidate_id
          and snapshot.source_document_id = old.id
      )
    order by application.id
    for update;

    if exists (
      select 1
      from public.application_input_snapshots as snapshot
      join public.applications as application
        on application.workspace_id = snapshot.workspace_id
       and application.id = snapshot.application_id
      where snapshot.workspace_id = old.workspace_id
        and snapshot.candidate_id = old.candidate_id
        and snapshot.source_document_id = old.id
        and application.status in (
          'READY', 'AUTHORIZED', 'EXECUTING', 'TAKEOVER',
          'PRE_SUBMIT_REVIEW', 'RECONCILING'
        )
    ) then
      raise exception 'SOURCE_DOCUMENT_USED_BY_ACTIVE_APPLICATION' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists receipts_confirmed_submission_guard on public.receipts;
create trigger receipts_confirmed_submission_guard
  before insert on public.receipts
  for each row execute function private.guard_submission_receipt_insert();

alter table public.application_fill_attempts enable row level security;
alter table public.computer_sessions enable row level security;
alter table public.application_fill_checkpoints enable row level security;

create policy application_fill_attempts_candidate_select
  on public.application_fill_attempts for select to authenticated
  using (
    exists (
      select 1 from public.candidates as candidate
      where candidate.workspace_id = application_fill_attempts.workspace_id
        and candidate.id = application_fill_attempts.candidate_id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create policy computer_sessions_candidate_select
  on public.computer_sessions for select to authenticated
  using (
    exists (
      select 1 from public.candidates as candidate
      where candidate.workspace_id = computer_sessions.workspace_id
        and candidate.id = computer_sessions.candidate_id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create policy application_fill_checkpoints_candidate_select
  on public.application_fill_checkpoints for select to authenticated
  using (
    exists (
      select 1 from public.candidates as candidate
      where candidate.workspace_id = application_fill_checkpoints.workspace_id
        and candidate.id = application_fill_checkpoints.candidate_id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

revoke all on public.application_fill_attempts, public.computer_sessions,
  public.application_fill_checkpoints from public, anon, authenticated;
grant select on public.application_fill_attempts, public.computer_sessions,
  public.application_fill_checkpoints to authenticated;
grant all on public.application_fill_attempts, public.computer_sessions,
  public.application_fill_checkpoints to service_role;

revoke all on private.computer_session_provider_refs from public, anon, authenticated;
grant all on private.computer_session_provider_refs to service_role;

create or replace function public.authorize_application_fill_once(
  p_command_id uuid,
  p_application_id uuid,
  p_expected_aggregate_version bigint,
  p_expected_revision_id uuid,
  p_expected_packet_hash text
)
returns table (
  application_id uuid,
  revision_id uuid,
  fill_attempt_id uuid,
  browser_run_id uuid,
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
  v_revision public.application_revisions%rowtype;
  v_existing public.command_dedup%rowtype;
  v_challenge_id uuid := extensions.gen_random_uuid();
  v_consumption_id uuid := extensions.gen_random_uuid();
  v_fill_id uuid := extensions.gen_random_uuid();
  v_run_id uuid := extensions.gen_random_uuid();
  v_event_id uuid := extensions.gen_random_uuid();
  v_request_hash text;
  v_diff_hash text;
  v_destination_url text;
  v_destination_url_hash text;
  v_artifact_manifest jsonb;
  v_artifact_manifest_hash text;
  v_fact_disclosure_manifest jsonb;
  v_disclosure_manifest jsonb;
  v_disclosure_manifest_hash text;
  v_authority_manifest jsonb;
  v_authority_hash text;
  v_nonce_hash text;
  v_new_aggregate bigint;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_application_id is null
     or p_expected_revision_id is null
     or p_expected_aggregate_version is null or p_expected_aggregate_version <= 0
     or p_expected_packet_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'APPLICATION_FILL_AUTHORIZATION_INPUT_INVALID' using errcode = '22023';
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
      || p_expected_revision_id::text || E'\n' || p_expected_packet_hash,
    'utf8'
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(v_application.workspace_id::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_application.workspace_id and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'AUTHORIZE_APPLICATION_FILL_ONCE'
       or v_existing.request_hash <> v_request_hash
       or v_existing.actor_id <> v_actor then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select v_application.id,
      (v_existing.result ->> 'revision_id')::uuid,
      (v_existing.result ->> 'fill_attempt_id')::uuid,
      (v_existing.result ->> 'browser_run_id')::uuid,
      (v_existing.result ->> 'aggregate_version')::bigint,
      true;
    return;
  end if;

  if v_application.status <> 'READY'
     or v_application.aggregate_version <> p_expected_aggregate_version
     or v_application.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'APPLICATION_FILL_REVIEW_STALE' using errcode = 'PT409';
  end if;
  if v_application.job_version_id is null then
    raise exception 'APPLICATION_FILL_JOB_UNRESOLVED' using errcode = '55000';
  end if;

  select revision.* into strict v_revision
  from public.application_revisions as revision
  where revision.workspace_id = v_application.workspace_id
    and revision.application_id = v_application.id
    and revision.id = p_expected_revision_id
  for key share;

  if v_revision.validation_status <> 'PASSED'
     or v_revision.packet_hash <> p_expected_packet_hash
     or v_revision.job_version_id is distinct from v_application.job_version_id
     or v_revision.packet_manifest #>> '{authority,state}' <> 'CANDIDATE_REVIEW_REQUIRED'
     or v_revision.packet_manifest #>> '{authority,application_submitted}' <> 'false' then
    raise exception 'APPLICATION_FILL_REVISION_INVALID' using errcode = '55000';
  end if;

  select version.apply_url into strict v_destination_url
  from public.job_versions as version
  where version.job_id = v_application.job_id
    and version.id = v_application.job_version_id;
  if v_destination_url is null or not private.is_public_https_job_url(v_destination_url) then
    raise exception 'APPLICATION_FILL_DESTINATION_INVALID' using errcode = '55000';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'artifact_version_id', artifact.id,
      'variant', artifact.variant,
      'display_name', artifact.display_name,
      'mime_type', artifact.mime_type,
      'byte_size', artifact.byte_size,
      'sha256', artifact.sha256,
      'qa_status', artifact.qa_status
    ) order by artifact.variant
  ) into v_artifact_manifest
  from public.artifact_versions as artifact
  where artifact.workspace_id = v_application.workspace_id
    and artifact.application_revision_id = v_revision.id
    and artifact.variant in (
      'RESUME_PDF', 'RESUME_DOCX', 'COVER_LETTER_PDF', 'COVER_LETTER_DOCX'
    );

  if jsonb_array_length(coalesce(v_artifact_manifest, '[]'::jsonb)) <> 4
     or exists (
       select 1 from jsonb_array_elements(v_artifact_manifest) as item
       where item ->> 'qa_status' <> 'PASSED'
          or item ->> 'sha256' !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'APPLICATION_FILL_ARTIFACT_SET_INVALID' using errcode = '55000';
  end if;

  v_diff_hash := encode(extensions.digest(convert_to(v_revision.material_diff::text, 'utf8'), 'sha256'), 'hex');
  v_destination_url_hash := encode(extensions.digest(convert_to(v_destination_url, 'utf8'), 'sha256'), 'hex');
  v_artifact_manifest_hash := encode(extensions.digest(convert_to(v_artifact_manifest::text, 'utf8'), 'sha256'), 'hex');

  -- Only verified standard EXACT_FIELDS facts that the candidate approved and
  -- that were frozen into this revision may be typed. Sensitive, protected,
  -- narrative-only, and never-autofill facts are excluded even when approved.
  -- Values remain outside the authorization manifest and are represented by a
  -- deterministic hash.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'fact_version_id', version.id,
      'fact_key', fact.fact_key,
      'value_hash', encode(extensions.digest(convert_to(version.value_json::text, 'utf8'), 'sha256'), 'hex'),
      'candidate_disposition', version.candidate_disposition
    ) order by fact.fact_key, version.id
  ), '[]'::jsonb) into v_fact_disclosure_manifest
  from public.application_snapshot_fact_refs as snapshot_ref
  join public.candidate_fact_versions as version
    on version.workspace_id = snapshot_ref.workspace_id
   and version.candidate_id = snapshot_ref.candidate_id
   and version.id = snapshot_ref.fact_version_id
  join public.candidate_facts as fact
    on fact.workspace_id = version.workspace_id
   and fact.candidate_id = version.candidate_id
   and fact.id = version.fact_id
  where snapshot_ref.workspace_id = v_application.workspace_id
    and snapshot_ref.candidate_id = v_application.candidate_id
    and snapshot_ref.application_id = v_application.id
    and snapshot_ref.input_snapshot_id = v_revision.input_snapshot_id
    and version.candidate_disposition = 'APPROVED'
    and fact.sensitivity = 'STANDARD'
    and fact.usage_policy = 'EXACT_FIELDS'
    and fact.verification_status = 'VERIFIED';

  v_disclosure_manifest := jsonb_build_object(
    'destination_origin', regexp_replace(v_destination_url, '^((https://[^/]+)).*$', '\1'),
    'destination_url_hash', v_destination_url_hash,
    'allowed_fact_versions', v_fact_disclosure_manifest,
    'artifacts', v_artifact_manifest,
    'policy', jsonb_build_object(
      'unknown_field', 'TAKEOVER',
      'sensitive_field_without_exact_fact', 'TAKEOVER',
      'captcha_or_otp', 'TAKEOVER',
      'submit_authorized', false
    ),
    'policy_release', 'fill-disclosure-policy/1'
  );
  v_disclosure_manifest_hash := encode(extensions.digest(
    convert_to(v_disclosure_manifest::text, 'utf8'), 'sha256'
  ), 'hex');
  v_authority_manifest := jsonb_build_object(
    'permitted_action', 'FILL_APPLICATION_ONCE',
    'submission_authority', false,
    'authority_scope', 'FILL_ONLY_NO_SUBMIT',
    'candidate_id', v_application.candidate_id,
    'application_id', v_application.id,
    'revision_id', v_revision.id,
    'input_snapshot_id', v_revision.input_snapshot_id,
    'input_snapshot_hash', v_revision.input_snapshot_hash,
    'job_version_id', v_application.job_version_id,
    'destination_url', v_destination_url,
    'destination_url_hash', v_destination_url_hash,
    'packet_hash', v_revision.packet_hash,
    'material_diff', v_revision.material_diff,
    'diff_hash', v_diff_hash,
    'artifact_manifest', v_artifact_manifest,
    'artifact_manifest_hash', v_artifact_manifest_hash,
    'disclosure_manifest', v_disclosure_manifest,
    'disclosure_manifest_hash', v_disclosure_manifest_hash,
    'executor_policy_release', 'fill-only-no-submit/1',
    'destination_policy_release', 'ats-destination-policy/1'
  );
  v_authority_hash := encode(extensions.digest(convert_to(v_authority_manifest::text, 'utf8'), 'sha256'), 'hex');
  v_nonce_hash := encode(extensions.digest(convert_to(
    extensions.gen_random_uuid()::text || E'\n' || p_command_id::text || E'\n' || v_authority_hash,
    'utf8'
  ), 'sha256'), 'hex');

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (
    v_application.workspace_id, p_command_id, v_actor,
    'AUTHORIZE_APPLICATION_FILL_ONCE', v_request_hash, 'STARTED'
  );

  insert into public.approval_challenges (
    id, workspace_id, candidate_id, application_id, revision_id,
    permitted_action, diff_hash, nonce_hash, authority_manifest,
    authority_hash, expires_at
  ) values (
    v_challenge_id, v_application.workspace_id, v_application.candidate_id,
    v_application.id, v_revision.id, 'FILL_APPLICATION_ONCE', v_diff_hash,
    v_nonce_hash, v_authority_manifest, v_authority_hash,
    statement_timestamp() + interval '15 minutes'
  );

  insert into public.approval_consumptions (
    id, workspace_id, approval_id, application_id, revision_id,
    consumed_by, command_id, permitted_action
  ) values (
    v_consumption_id, v_application.workspace_id, v_challenge_id,
    v_application.id, v_revision.id, v_actor, p_command_id,
    'FILL_APPLICATION_ONCE'
  );

  insert into public.application_runs (
    id, workspace_id, application_id, run_kind, status, input_revision_id
  ) values (
    v_run_id, v_application.workspace_id, v_application.id,
    'BROWSER_FILL', 'QUEUED', v_revision.id
  );

  insert into public.application_fill_attempts (
    id, workspace_id, candidate_id, application_id, revision_id,
    approval_consumption_id, approval_action, browser_run_id,
    authority_hash, destination_url,
    destination_url_hash, packet_hash, diff_hash, artifact_manifest,
    artifact_manifest_hash, disclosure_manifest, disclosure_manifest_hash,
    executor_policy_release,
    destination_policy_release
  ) values (
    v_fill_id, v_application.workspace_id, v_application.candidate_id,
    v_application.id, v_revision.id, v_consumption_id,
    'FILL_APPLICATION_ONCE', v_run_id,
    v_authority_hash,
    v_destination_url, v_destination_url_hash, v_revision.packet_hash,
    v_diff_hash, v_artifact_manifest, v_artifact_manifest_hash,
    v_disclosure_manifest, v_disclosure_manifest_hash,
    'fill-only-no-submit/1', 'ats-destination-policy/1'
  );

  v_new_aggregate := v_application.aggregate_version + 1;
  update public.applications
  set status = 'AUTHORIZED', aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where id = v_application.id;

  insert into public.domain_events (
    id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_kind, actor_id, correlation_id
  ) values (
    v_event_id, v_application.workspace_id, 'APPLICATION', v_application.id,
    v_new_aggregate, 'application.fill_authorized',
    jsonb_build_object(
      'revision_id', v_revision.id,
      'fill_attempt_id', v_fill_id,
      'browser_run_id', v_run_id,
      'authority_hash', v_authority_hash,
      'disclosure_manifest_hash', v_disclosure_manifest_hash,
      'authority_scope', 'FILL_ONLY_NO_SUBMIT',
      'application_submitted', false
    ),
    'CANDIDATE', v_actor, p_command_id
  );

  insert into public.outbox (workspace_id, event_id, topic, payload)
  values (
    v_application.workspace_id, v_event_id, 'application.browser_fill_requested',
    jsonb_build_object(
      'application_id', v_application.id,
      'revision_id', v_revision.id,
      'fill_attempt_id', v_fill_id,
      'browser_run_id', v_run_id,
      'authority_hash', v_authority_hash,
      'disclosure_manifest_hash', v_disclosure_manifest_hash,
      'authority_scope', 'FILL_ONLY_NO_SUBMIT'
    )
  );

  update public.command_dedup
  set aggregate_type = 'APPLICATION', aggregate_id = v_application.id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object(
        'application_id', v_application.id,
        'revision_id', v_revision.id,
        'fill_attempt_id', v_fill_id,
        'browser_run_id', v_run_id,
        'aggregate_version', v_new_aggregate
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_application.workspace_id and command_id = p_command_id;

  return query select v_application.id, v_revision.id, v_fill_id,
    v_run_id, v_new_aggregate, false;
end;
$$;

create or replace function public.start_application_fill_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_fill_attempt_id uuid,
  p_execution_mode text,
  p_broker_release text,
  p_allowed_domain_policy jsonb,
  p_browser_profile_ref uuid,
  p_ttl_seconds integer
)
returns table (
  computer_session_id uuid,
  application_id uuid,
  revision_id uuid,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_outbox public.outbox%rowtype;
  v_fill public.application_fill_attempts%rowtype;
  v_application public.applications%rowtype;
  v_approval public.approval_challenges%rowtype;
  v_session_id uuid := extensions.gen_random_uuid();
  v_destination_origin text;
  v_policy_hash text;
  v_checkpoint_summary jsonb;
  v_checkpoint_hash text;
  v_event_id uuid := extensions.gen_random_uuid();
  v_started_aggregate bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_outbox_id is null or p_fill_attempt_id is null
     or char_length(v_worker_id) not between 1 and 120
     or p_execution_mode not in ('EPHEMERAL_CLEAN', 'EPHEMERAL_WITH_PERSISTENT_CONTEXT')
     or char_length(btrim(coalesce(p_broker_release, ''))) not between 1 and 120
     or jsonb_typeof(p_allowed_domain_policy) <> 'object'
     or p_allowed_domain_policy ->> 'policy_release' is distinct from 'ats-destination-policy/1'
     or p_allowed_domain_policy ->> 'submit_authorized' is distinct from 'false'
     or p_allowed_domain_policy ->> 'navigation_scope' is distinct from 'EXACT_ORIGIN'
     or jsonb_typeof(p_allowed_domain_policy -> 'allowed_origins') <> 'array'
     or (p_execution_mode = 'EPHEMERAL_CLEAN' and p_browser_profile_ref is not null)
     or (p_execution_mode = 'EPHEMERAL_WITH_PERSISTENT_CONTEXT' and p_browser_profile_ref is null)
     or p_ttl_seconds not between 60 and 1800 then
    raise exception 'APPLICATION_FILL_START_INPUT_INVALID' using errcode = '22023';
  end if;

  select message.* into strict v_outbox
  from public.outbox as message where message.id = p_outbox_id for update;
  select attempt.* into strict v_fill
  from public.application_fill_attempts as attempt
  where attempt.id = p_fill_attempt_id and attempt.workspace_id = v_outbox.workspace_id
  for update;
  select application.* into strict v_application
  from public.applications as application
  where application.workspace_id = v_fill.workspace_id
    and application.id = v_fill.application_id
  for update;

  v_destination_origin := regexp_replace(
    v_fill.destination_url, '^((https://[^/]+)).*$', '\1'
  );
  if p_allowed_domain_policy -> 'allowed_origins'
       <> jsonb_build_array(v_destination_origin) then
    raise exception 'APPLICATION_FILL_DOMAIN_POLICY_INVALID' using errcode = '22023';
  end if;

  select challenge.* into strict v_approval
  from public.approval_consumptions as consumption
  join public.approval_challenges as challenge
    on challenge.workspace_id = consumption.workspace_id
   and challenge.id = consumption.approval_id
   and challenge.application_id = consumption.application_id
   and challenge.revision_id = consumption.revision_id
   and challenge.permitted_action = consumption.permitted_action
  where consumption.workspace_id = v_fill.workspace_id
    and consumption.id = v_fill.approval_consumption_id
    and consumption.permitted_action = 'FILL_APPLICATION_ONCE';

  if v_fill.status = 'STARTED' then
    return query select session.id, v_fill.application_id, v_fill.revision_id, true
    from public.computer_sessions as session
    where session.fill_attempt_id = v_fill.id;
    return;
  end if;
  if v_outbox.topic <> 'application.browser_fill_requested'
     or v_outbox.published_at is not null or v_outbox.dead_lettered_at is not null
     or v_outbox.lease_owner is distinct from v_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= statement_timestamp()
     or v_outbox.payload ->> 'fill_attempt_id' <> v_fill.id::text
     or v_outbox.payload ->> 'revision_id' <> v_fill.revision_id::text
     or v_outbox.payload ->> 'authority_hash' <> v_fill.authority_hash
     or v_outbox.payload ->> 'disclosure_manifest_hash' <> v_fill.disclosure_manifest_hash
     or v_outbox.payload ->> 'authority_scope' <> 'FILL_ONLY_NO_SUBMIT'
     or v_fill.status <> 'QUEUED'
     or v_application.status <> 'AUTHORIZED'
     or v_application.current_revision_id is distinct from v_fill.revision_id
     or v_approval.revoked_at is not null
     or v_approval.expires_at <= statement_timestamp()
     or v_approval.authority_hash is distinct from v_fill.authority_hash then
    raise exception 'APPLICATION_FILL_START_STATE_INVALID' using errcode = '40001';
  end if;

  v_policy_hash := encode(extensions.digest(convert_to(p_allowed_domain_policy::text, 'utf8'), 'sha256'), 'hex');
  insert into public.computer_sessions (
    id, workspace_id, candidate_id, application_id, revision_id,
    fill_attempt_id, execution_mode, start_url, allowed_domain_policy,
    allowed_domain_policy_hash, mounted_artifact_manifest,
    browser_profile_ref, broker_release, expires_at
  ) values (
    v_session_id, v_fill.workspace_id, v_fill.candidate_id,
    v_fill.application_id, v_fill.revision_id, v_fill.id,
    p_execution_mode, v_fill.destination_url, p_allowed_domain_policy,
    v_policy_hash, v_fill.artifact_manifest, p_browser_profile_ref,
    btrim(p_broker_release), statement_timestamp() + make_interval(secs => p_ttl_seconds)
  );

  update public.application_fill_attempts
  set status = 'STARTED', started_at = statement_timestamp()
  where id = v_fill.id;
  update public.application_runs
  set status = 'RUNNING', started_at = coalesce(started_at, statement_timestamp()),
      last_heartbeat_at = statement_timestamp(), workflow_provider = 'COMPUTER_SESSION_BROKER'
  where id = v_fill.browser_run_id;
  update public.applications
  set status = 'EXECUTING', aggregate_version = aggregate_version + 1,
      updated_at = statement_timestamp()
  where id = v_application.id
  returning aggregate_version into v_started_aggregate;

  insert into public.domain_events (
    id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
    event_type, payload, actor_kind, correlation_id
  ) values (
    v_event_id, v_fill.workspace_id, 'APPLICATION', v_fill.application_id,
    v_started_aggregate, 'application.fill_started',
    jsonb_build_object(
      'revision_id', v_fill.revision_id,
      'fill_attempt_id', v_fill.id,
      'computer_session_id', v_session_id,
      'authority_hash', v_fill.authority_hash,
      'authority_scope', 'FILL_ONLY_NO_SUBMIT',
      'application_submitted', false
    ),
    'WORKER', v_fill.browser_run_id
  );

  v_checkpoint_summary := jsonb_build_object(
    'state', 'PROVISIONING', 'authority_scope', 'FILL_ONLY_NO_SUBMIT',
    'revision_id', v_fill.revision_id, 'application_submitted', false
  );
  v_checkpoint_hash := encode(extensions.digest(convert_to(v_checkpoint_summary::text, 'utf8'), 'sha256'), 'hex');
  insert into public.application_fill_checkpoints (
    workspace_id, candidate_id, application_id, fill_attempt_id,
    computer_session_id, checkpoint_kind, checkpoint_hash, redacted_summary
  ) values (
    v_fill.workspace_id, v_fill.candidate_id, v_fill.application_id,
    v_fill.id, v_session_id, 'SESSION_RESERVED', v_checkpoint_hash,
    v_checkpoint_summary
  );

  update public.outbox
  set published_at = statement_timestamp(), lease_owner = null,
      lease_expires_at = null, last_error = null
  where id = v_outbox.id;

  return query select v_session_id, v_fill.application_id, v_fill.revision_id, false;
end;
$$;

create or replace function public.activate_computer_session(
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
  v_session public.computer_sessions%rowtype;
  v_provider private.computer_session_provider_refs%rowtype;
  v_current_adapter_release text;
  v_summary jsonb;
  v_hash text;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_computer_session_id is null
     or char_length(btrim(coalesce(p_provider_adapter, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_provider_session_ref, ''))) not between 1 and 512
     or (p_provider_context_ref is not null and char_length(btrim(p_provider_context_ref)) not between 1 and 512)
     or char_length(btrim(coalesce(p_adapter_release, ''))) not between 1 and 120 then
    raise exception 'COMPUTER_SESSION_ACTIVATION_INPUT_INVALID' using errcode = '22023';
  end if;

  select session.* into strict v_session
  from public.computer_sessions as session
  where session.id = p_computer_session_id for update;
  if v_session.state = 'ACTIVE' then
    select provider.* into strict v_provider
    from private.computer_session_provider_refs as provider
    where provider.computer_session_id = v_session.id;
    select attempt.adapter_release into strict v_current_adapter_release
    from public.application_fill_attempts as attempt
    where attempt.id = v_session.fill_attempt_id;
    if v_provider.provider_adapter <> btrim(p_provider_adapter)
       or v_provider.provider_session_ref <> btrim(p_provider_session_ref)
       or v_provider.provider_context_ref is distinct from nullif(btrim(coalesce(p_provider_context_ref, '')), '')
       or v_current_adapter_release <> btrim(p_adapter_release) then
      raise exception 'COMPUTER_SESSION_ACTIVATION_REPLAY_MISMATCH' using errcode = 'PT409';
    end if;
    return query select v_session.id, v_session.fill_attempt_id, true;
    return;
  end if;
  if v_session.state <> 'PROVISIONING' or v_session.expires_at <= statement_timestamp() then
    raise exception 'COMPUTER_SESSION_NOT_ACTIVATABLE' using errcode = '55000';
  end if;

  insert into private.computer_session_provider_refs (
    computer_session_id, provider_adapter, provider_session_ref, provider_context_ref
  ) values (
    v_session.id, btrim(p_provider_adapter), btrim(p_provider_session_ref),
    nullif(btrim(coalesce(p_provider_context_ref, '')), '')
  );
  update public.computer_sessions
  set state = 'ACTIVE', activated_at = statement_timestamp()
  where id = v_session.id;
  update public.application_fill_attempts
  set adapter_release = btrim(p_adapter_release)
  where id = v_session.fill_attempt_id;

  v_summary := jsonb_build_object(
    'state', 'ACTIVE', 'authority_scope', 'FILL_ONLY_NO_SUBMIT',
    'application_submitted', false
  );
  v_hash := encode(extensions.digest(convert_to(v_summary::text, 'utf8'), 'sha256'), 'hex');
  insert into public.application_fill_checkpoints (
    workspace_id, candidate_id, application_id, fill_attempt_id,
    computer_session_id, checkpoint_kind, checkpoint_hash, redacted_summary
  ) values (
    v_session.workspace_id, v_session.candidate_id, v_session.application_id,
    v_session.fill_attempt_id, v_session.id, 'SESSION_ACTIVE', v_hash, v_summary
  );

  return query select v_session.id, v_session.fill_attempt_id, false;
end;
$$;

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
    'WORKER', v_fill.browser_run_id, v_fill.browser_run_id
  );

  return query select v_fill.application_id, v_application_status,
    v_session.id, false;
end;
$$;

revoke all on function public.authorize_application_fill_once(
  uuid, uuid, bigint, uuid, text
) from public, anon;
grant execute on function public.authorize_application_fill_once(
  uuid, uuid, bigint, uuid, text
) to authenticated;
grant execute on function public.authorize_application_fill_once(
  uuid, uuid, bigint, uuid, text
) to service_role;

revoke all on function public.start_application_fill_attempt(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) from public, anon, authenticated;
grant execute on function public.start_application_fill_attempt(
  uuid, text, uuid, text, text, jsonb, uuid, integer
) to service_role;

revoke all on function public.activate_computer_session(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.activate_computer_session(
  uuid, text, text, text, text
) to service_role;

revoke all on function public.complete_application_fill_attempt(
  uuid, text, text, jsonb, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_application_fill_attempt(
  uuid, text, text, jsonb, boolean, jsonb
) to service_role;

comment on function public.authorize_application_fill_once(uuid, uuid, bigint, uuid, text) is
  'Candidate-owned, replay-safe one-time authorization to release one exact reviewed packet into one named application form; never submission authority.';
comment on table public.application_fill_attempts is
  'No-submit form-fill aggregate. Final employer submission remains a separate approval and application_attempt.';
comment on table public.computer_sessions is
  'Candidate-visible provider-neutral session metadata; provider identifiers remain in the private schema.';
comment on table public.application_fill_checkpoints is
  'Append-only redacted checkpoints for form read-back, blockers, and runtime teardown; never raw sensitive field values.';
