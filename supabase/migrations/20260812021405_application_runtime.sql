-- RoleDawn / HireWire: candidate decisions, application aggregate, operational runs,
-- semantic events, command deduplication, and transactional outbox.

create table public.job_intakes (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  canonical_url text not null check (private.is_public_https_job_url(canonical_url)),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'RESOLVING', 'RESOLVED', 'FAILED')),
  resolved_job_id uuid,
  resolved_job_version_id uuid,
  failure_code text,
  command_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, command_id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade,
  foreign key (resolved_job_id, resolved_job_version_id)
    references public.job_versions(job_id, id) on delete restrict,
  check (
    (status = 'RESOLVED' and resolved_job_id is not null and resolved_job_version_id is not null)
    or (status <> 'RESOLVED' and resolved_job_id is null and resolved_job_version_id is null)
  )
);

create table public.candidate_job_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  job_id uuid not null,
  job_version_id uuid not null,
  decision text not null check (decision in ('VIEWED', 'SAVED', 'PASSED', 'QUEUED')),
  reason_code text,
  decided_at timestamptz not null default now(),
  undone_at timestamptz,
  command_id uuid not null,
  unique (workspace_id, id),
  unique (workspace_id, command_id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade,
  foreign key (job_id, job_version_id)
    references public.job_versions(job_id, id) on delete restrict,
  check (undone_at is null or undone_at >= decided_at)
);

create unique index candidate_job_decisions_active_idx
  on public.candidate_job_decisions (candidate_id, job_id)
  where undone_at is null;
create index candidate_job_decisions_candidate_time_idx
  on public.candidate_job_decisions (candidate_id, decided_at desc, id);

create table public.applications (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  job_intake_id uuid,
  job_id uuid,
  job_version_id uuid,
  status text not null default 'DRAFTING'
    check (status in ('DRAFTING', 'NEEDS_USER', 'READY', 'AUTHORIZED', 'EXECUTING',
      'TAKEOVER', 'RECONCILING', 'CONFIRMED', 'SKIPPED', 'FAILED_SAFE', 'CANCELED')),
  queued_at timestamptz not null default now(),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  operations_review_status text not null default 'NOT_REQUIRED'
    check (operations_review_status in ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  unique (workspace_id, id, job_version_id),
  unique (workspace_id, job_intake_id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade,
  foreign key (workspace_id, job_intake_id)
    references public.job_intakes(workspace_id, id) on delete restrict,
  foreign key (job_id, job_version_id)
    references public.job_versions(job_id, id) on delete restrict,
  check (job_intake_id is not null or (job_id is not null and job_version_id is not null))
);

create unique index applications_candidate_job_unique_idx
  on public.applications (candidate_id, job_id) where job_id is not null;
create index applications_queue_idx
  on public.applications (candidate_id, queued_at desc, id);
create index applications_attention_idx
  on public.applications (candidate_id, status, queued_at desc, id)
  where status in ('NEEDS_USER', 'READY', 'TAKEOVER', 'RECONCILING');

create table public.application_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null,
  run_kind text not null check (run_kind in ('PREPARATION', 'BROWSER_FILL', 'RECONCILIATION')),
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELED')),
  workflow_provider text,
  external_workflow_ref text,
  input_revision_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  last_heartbeat_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workflow_provider, external_workflow_ref),
  foreign key (workspace_id, application_id)
    references public.applications(workspace_id, id) on delete cascade,
  check (finished_at is null or started_at is null or finished_at >= started_at)
);
create index application_runs_application_time_idx
  on public.application_runs (application_id, created_at desc, id);

create table public.domain_events (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  aggregate_type text not null check (btrim(aggregate_type) <> ''),
  aggregate_id uuid not null,
  aggregate_version bigint not null check (aggregate_version > 0),
  event_type text not null check (btrim(event_type) <> ''),
  payload jsonb not null default '{}'::jsonb,
  actor_kind text not null check (actor_kind in ('CANDIDATE', 'SYSTEM', 'WORKER', 'SUPPORT')),
  actor_id uuid,
  correlation_id uuid not null,
  causation_id uuid,
  occurred_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, aggregate_type, aggregate_id, aggregate_version)
);
create index domain_events_workspace_time_idx
  on public.domain_events (workspace_id, occurred_at, id);
create index domain_events_aggregate_idx
  on public.domain_events (aggregate_type, aggregate_id, aggregate_version);

create table public.command_dedup (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  command_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  command_type text not null check (btrim(command_type) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  aggregate_type text,
  aggregate_id uuid,
  status text not null check (status in ('STARTED', 'COMMITTED', 'REJECTED')),
  result_event_id uuid,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, command_id),
  check (completed_at is null or completed_at >= created_at),
  foreign key (workspace_id, result_event_id)
    references public.domain_events(workspace_id, id) on delete restrict
);

create table public.outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_id uuid not null,
  topic text not null check (btrim(topic) <> ''),
  payload jsonb not null,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  unique (event_id),
  foreign key (workspace_id, event_id)
    references public.domain_events(workspace_id, id) on delete restrict
);
create index outbox_unpublished_idx on public.outbox (available_at, id) where published_at is null;

-- Atomic intake command. This is the only authenticated write surface in this migration.
-- The function derives identity and tenant from auth.uid(), serializes duplicate commands,
-- commits the aggregate/event/outbox together, and returns the existing application on replay.
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
      completed_at = now()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query select v_application, v_intake, 1::bigint, false;
end;
$$;

revoke all on function public.enqueue_pasted_link_application(uuid, text) from public, anon;
grant execute on function public.enqueue_pasted_link_application(uuid, text) to authenticated;
grant execute on function public.enqueue_pasted_link_application(uuid, text) to service_role;

alter table public.job_intakes enable row level security;
alter table public.candidate_job_decisions enable row level security;
alter table public.applications enable row level security;
alter table public.application_runs enable row level security;
alter table public.domain_events enable row level security;
alter table public.command_dedup enable row level security;
alter table public.outbox enable row level security;

create policy job_intakes_member_select on public.job_intakes for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy candidate_decisions_member_select on public.candidate_job_decisions for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy applications_member_select on public.applications for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy application_runs_member_select on public.application_runs for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy domain_events_member_select on public.domain_events for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));

revoke all on public.job_intakes, public.candidate_job_decisions, public.applications,
  public.application_runs, public.domain_events, public.command_dedup, public.outbox
  from anon, authenticated;
grant select on public.job_intakes, public.candidate_job_decisions, public.applications,
  public.application_runs, public.domain_events to authenticated;
grant all on public.job_intakes, public.candidate_job_decisions, public.applications,
  public.application_runs, public.domain_events, public.command_dedup, public.outbox
  to service_role;

comment on function public.enqueue_pasted_link_application(uuid, text) is
  'Authenticated atomic pasted-link intake; preparation authority only, never submission authority.';
