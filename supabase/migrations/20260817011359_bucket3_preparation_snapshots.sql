-- RoleDawn Bucket 3 foundation: converge every queued job on one fail-closed preparation
-- boundary. This migration freezes references and hashes only; raw resume text,
-- narrative claims, and exact-answer values stay in their authoritative tables.

create or replace function private.job_is_candidate_visible(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs as job
    join public.source_job_listings as listing on listing.id = job.source_listing_id
    join public.job_sources as source on source.id = listing.source_id
    where job.id = p_job_id
      and source.policy_status = 'ALLOWLISTED'
  ) or exists (
    select 1
    from public.applications as application
    join public.candidates as candidate
      on candidate.workspace_id = application.workspace_id
     and candidate.id = application.candidate_id
    join public.workspace_memberships as membership
      on membership.workspace_id = application.workspace_id
     and membership.auth_user_id = (select auth.uid())
     and membership.status = 'ACTIVE'
    join public.workspaces as workspace
      on workspace.id = application.workspace_id
     and workspace.status = 'ACTIVE'
    where application.job_id = p_job_id
      and candidate.auth_user_id = (select auth.uid())
      and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  )
$$;

create or replace function private.job_version_is_candidate_visible(
  p_job_id uuid,
  p_job_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs as job
    join public.source_job_listings as listing on listing.id = job.source_listing_id
    join public.job_sources as source on source.id = listing.source_id
    where job.id = p_job_id
      and source.policy_status = 'ALLOWLISTED'
  ) or exists (
    select 1
    from public.applications as application
    join public.candidates as candidate
      on candidate.workspace_id = application.workspace_id
     and candidate.id = application.candidate_id
    join public.workspace_memberships as membership
      on membership.workspace_id = application.workspace_id
     and membership.auth_user_id = (select auth.uid())
     and membership.status = 'ACTIVE'
    join public.workspaces as workspace
      on workspace.id = application.workspace_id
     and workspace.status = 'ACTIVE'
    where application.job_id = p_job_id
      and application.job_version_id = p_job_version_id
      and candidate.auth_user_id = (select auth.uid())
      and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
  )
$$;

revoke all on function private.job_is_candidate_visible(uuid)
  from public, anon, authenticated;
grant execute on function private.job_is_candidate_visible(uuid)
  to authenticated, service_role;
revoke all on function private.job_version_is_candidate_visible(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.job_version_is_candidate_visible(uuid, uuid)
  to authenticated, service_role;

-- One monotonic token covers every candidate-controlled input used by an
-- application packet. Child-table triggers advance it in the same transaction
-- as résumé, evidence, or exact-answer changes. Preparation holds the candidate
-- row FOR SHARE while validating and inserting a snapshot, so those mutations
-- cannot commit halfway through the freeze.
alter table public.candidates
  add column application_input_version bigint not null default 1
    check (application_input_version > 0);

create or replace function private.bump_candidate_application_input_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_candidate_id uuid;
begin
  if tg_op = 'DELETE' then
    v_workspace_id := old.workspace_id;
    v_candidate_id := old.candidate_id;
  else
    v_workspace_id := new.workspace_id;
    v_candidate_id := new.candidate_id;
  end if;

  update public.candidates as candidate
  set application_input_version = candidate.application_input_version + 1
  where candidate.workspace_id = v_workspace_id
    and candidate.id = v_candidate_id;

  -- The owning candidate can already be disappearing during an authorized FK
  -- cascade. Active candidates cannot be missing because every input table is
  -- protected by a composite candidate foreign key.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.bump_candidate_own_application_input_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tailoring_mode is distinct from old.tailoring_mode
     or new.submission_mode is distinct from old.submission_mode then
    new.application_input_version := old.application_input_version + 1;
  end if;
  return new;
end;
$$;

create trigger candidates_bump_application_input_version
  before update of tailoring_mode, submission_mode on public.candidates
  for each row execute function private.bump_candidate_own_application_input_version();
create trigger source_documents_bump_candidate_input_version
  after insert or update or delete on public.source_documents
  for each row execute function private.bump_candidate_application_input_version();
create trigger source_document_versions_bump_candidate_input_version
  after insert or delete on public.source_document_versions
  for each row execute function private.bump_candidate_application_input_version();
create trigger source_document_text_reviews_bump_candidate_input_version
  after insert or delete on public.source_document_text_reviews
  for each row execute function private.bump_candidate_application_input_version();
create trigger candidate_evidence_items_bump_candidate_input_version
  after insert or update or delete on public.candidate_evidence_items
  for each row execute function private.bump_candidate_application_input_version();
create trigger candidate_evidence_versions_bump_candidate_input_version
  after insert or delete on public.candidate_evidence_versions
  for each row execute function private.bump_candidate_application_input_version();
create trigger candidate_facts_bump_candidate_input_version
  after insert or update or delete on public.candidate_facts
  for each row execute function private.bump_candidate_application_input_version();
create trigger candidate_fact_versions_bump_candidate_input_version
  after insert or delete on public.candidate_fact_versions
  for each row execute function private.bump_candidate_application_input_version();

revoke all on function private.bump_candidate_application_input_version()
  from public, anon, authenticated;
revoke all on function private.bump_candidate_own_application_input_version()
  from public, anon, authenticated;

drop policy if exists jobs_candidate_visible_select on public.jobs;
create policy jobs_candidate_visible_select
  on public.jobs for select to authenticated
  using ((select private.job_is_candidate_visible(id)));

drop policy if exists job_versions_candidate_visible_select on public.job_versions;
create policy job_versions_candidate_visible_select
  on public.job_versions for select to authenticated
  using ((select private.job_version_is_candidate_visible(job_id, id)));

alter table public.application_runs
  add constraint application_runs_workspace_application_id_key
  unique (workspace_id, application_id, id);

create table public.application_input_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  preparation_run_id uuid not null,
  job_id uuid not null,
  job_version_id uuid not null,
  source_document_id uuid,
  source_document_version_id uuid,
  source_text_review_id uuid,
  tailoring_mode text not null
    check (tailoring_mode in ('AS_UPLOADED', 'REORDER_AND_TIGHTEN', 'REWRITE_FROM_VERIFIED_FACTS')),
  submission_mode text not null
    check (submission_mode in ('DRAFT_ONLY', 'PER_APPLICATION_APPROVAL')),
  readiness text not null check (readiness in ('BLOCKED', 'READY_FOR_DRAFTING')),
  blockers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(blockers) = 'array'),
  snapshot_manifest jsonb not null check (jsonb_typeof(snapshot_manifest) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  candidate_input_version bigint not null check (candidate_input_version > 0),
  policy_release text not null check (char_length(btrim(policy_release)) between 1 and 120),
  assembler_release text not null check (char_length(btrim(assembler_release)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, application_id, id),
  unique (preparation_run_id),
  foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade,
  foreign key (workspace_id, application_id, preparation_run_id)
    references public.application_runs(workspace_id, application_id, id) on delete cascade,
  foreign key (job_id, job_version_id)
    references public.job_versions(job_id, id) on delete restrict,
  foreign key (
    workspace_id, candidate_id, source_document_id,
    source_document_version_id, source_text_review_id
  ) references public.source_document_text_reviews(
    workspace_id, candidate_id, document_id, document_version_id, id
  ) on delete cascade,
  check (
    (readiness = 'BLOCKED' and jsonb_array_length(blockers) > 0)
    or (
      readiness = 'READY_FOR_DRAFTING'
      and source_document_id is not null
      and source_document_version_id is not null
      and source_text_review_id is not null
      and jsonb_array_length(blockers) = 0
    )
  )
);

create table public.application_snapshot_evidence_refs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  application_id uuid not null,
  input_snapshot_id uuid not null,
  evidence_version_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, input_snapshot_id, evidence_version_id),
  foreign key (workspace_id, application_id, input_snapshot_id)
    references public.application_input_snapshots(workspace_id, application_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id, document_id, evidence_version_id)
    references public.candidate_evidence_versions(workspace_id, candidate_id, document_id, id)
    on delete cascade
);

create table public.application_snapshot_fact_refs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  input_snapshot_id uuid not null,
  fact_version_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, input_snapshot_id, fact_version_id),
  foreign key (workspace_id, application_id, input_snapshot_id)
    references public.application_input_snapshots(workspace_id, application_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id, fact_version_id)
    references public.candidate_fact_versions(workspace_id, candidate_id, id) on delete cascade
);

alter table public.application_runs
  add column input_snapshot_id uuid,
  add column preparation_stage text
    check (preparation_stage in ('QUEUED', 'FREEZING_INPUTS', 'INPUTS_READY', 'BLOCKED',
      'RESEARCHING', 'DRAFTING', 'VALIDATING', 'RENDERING', 'COMPLETE')),
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column available_at timestamptz not null default now();

alter table public.application_runs
  add constraint application_runs_input_snapshot_fkey
  foreign key (workspace_id, application_id, input_snapshot_id)
  references public.application_input_snapshots(workspace_id, application_id, id)
  on delete set null (input_snapshot_id);

alter table public.application_runs
  add constraint application_runs_preparation_lease_check
  check (
    run_kind <> 'PREPARATION'
    or status <> 'RUNNING'
    or (
      char_length(btrim(coalesce(lease_owner, ''))) between 1 and 120
      and lease_expires_at is not null
    )
  );

update public.application_runs
set preparation_stage = 'QUEUED'
where run_kind = 'PREPARATION' and preparation_stage is null;

create index application_input_snapshots_application_time_idx
  on public.application_input_snapshots (application_id, created_at desc, id);
create index application_input_snapshots_application_hash_idx
  on public.application_input_snapshots (application_id, snapshot_hash);
create index application_input_snapshots_candidate_time_idx
  on public.application_input_snapshots (candidate_id, created_at desc, id);
create index application_input_snapshots_document_idx
  on public.application_input_snapshots (source_document_id, created_at desc)
  where source_document_id is not null;
create index application_snapshot_evidence_refs_version_idx
  on public.application_snapshot_evidence_refs (evidence_version_id, input_snapshot_id);
create index application_snapshot_fact_refs_version_idx
  on public.application_snapshot_fact_refs (fact_version_id, input_snapshot_id);
create index application_runs_preparation_claim_idx
  on public.application_runs (available_at, created_at, id)
  where run_kind = 'PREPARATION' and status = 'QUEUED' and input_snapshot_id is null;
create index applications_job_candidate_visibility_idx
  on public.applications (job_id, candidate_id)
  where job_id is not null;

create or replace function private.reject_row_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is immutable after insert', tg_table_name using errcode = '55000';
end;
$$;

create trigger application_input_snapshots_immutable
  before update on public.application_input_snapshots
  for each row execute function private.reject_row_update();
create trigger application_snapshot_evidence_refs_immutable
  before update on public.application_snapshot_evidence_refs
  for each row execute function private.reject_row_update();
create trigger application_snapshot_fact_refs_immutable
  before update on public.application_snapshot_fact_refs
  for each row execute function private.reject_row_update();

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
           'READY', 'AUTHORIZED', 'EXECUTING', 'TAKEOVER', 'RECONCILING'
         )
     ) then
      raise exception 'SOURCE_DOCUMENT_USED_BY_ACTIVE_APPLICATION' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger source_documents_guard_active_application_deletion
  before update of status on public.source_documents
  for each row execute function private.guard_active_application_source_deletion();

revoke all on function private.guard_active_application_source_deletion()
  from public, anon, authenticated;
alter table public.application_input_snapshots enable row level security;
alter table public.application_snapshot_evidence_refs enable row level security;
alter table public.application_snapshot_fact_refs enable row level security;

create policy application_input_snapshots_candidate_select
  on public.application_input_snapshots for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and
    candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = application_input_snapshots.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
create policy application_snapshot_evidence_refs_candidate_select
  on public.application_snapshot_evidence_refs for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and
    candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = application_snapshot_evidence_refs.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
create policy application_snapshot_fact_refs_candidate_select
  on public.application_snapshot_fact_refs for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and
    candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = application_snapshot_fact_refs.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
revoke all on public.application_input_snapshots,
  public.application_snapshot_evidence_refs, public.application_snapshot_fact_refs
  from public, anon, authenticated;
grant select on public.application_input_snapshots,
  public.application_snapshot_evidence_refs, public.application_snapshot_fact_refs
  to authenticated;
grant all on public.application_input_snapshots,
  public.application_snapshot_evidence_refs, public.application_snapshot_fact_refs
  to service_role;

create or replace function private.attach_preparation_run_to_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_run_id uuid;
begin
  if new.topic <> 'application.preparation_requested' then return new; end if;
  if coalesce(new.payload ->> 'application_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'PREPARATION_OUTBOX_APPLICATION_REQUIRED' using errcode = '22023';
  end if;
  v_application_id := (new.payload ->> 'application_id')::uuid;
  if coalesce(new.payload ->> 'preparation_run_id', '') <> ''
     and (new.payload ->> 'preparation_run_id')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'PREPARATION_OUTBOX_RUN_INVALID' using errcode = '22023';
  end if;
  v_run_id := nullif(new.payload ->> 'preparation_run_id', '')::uuid;
  if v_run_id is null then
    select run.id into v_run_id
    from public.application_runs as run
    where run.workspace_id = new.workspace_id
      and run.application_id = v_application_id
      and run.run_kind = 'PREPARATION'
      and run.status = 'QUEUED'
      and run.input_snapshot_id is null
    order by run.created_at, run.id
    limit 1;
  elsif not exists (
    select 1
    from public.application_runs as run
    where run.id = v_run_id
      and run.workspace_id = new.workspace_id
      and run.application_id = v_application_id
      and run.run_kind = 'PREPARATION'
      and run.status = 'QUEUED'
      and run.input_snapshot_id is null
  ) then
    raise exception 'PREPARATION_OUTBOX_RUN_INVALID' using errcode = '23503';
  end if;
  if v_run_id is null then
    raise exception 'PREPARATION_OUTBOX_RUN_REQUIRED' using errcode = '23503';
  end if;
  new.payload := new.payload || jsonb_build_object('preparation_run_id', v_run_id);
  return new;
end;
$$;

create trigger outbox_attach_preparation_run
  before insert on public.outbox
  for each row execute function private.attach_preparation_run_to_outbox();

do $$
begin
  if exists (
    select 1
    from public.outbox as message
    where message.topic = 'application.preparation_requested'
      and not (message.payload ? 'preparation_run_id')
      and coalesce(message.payload ->> 'application_id', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'PREPARATION_OUTBOX_BACKFILL_INVALID' using errcode = '23503';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.outbox as message
    where message.topic = 'application.preparation_requested'
      and message.payload ? 'preparation_run_id'
      and (
        coalesce(message.payload ->> 'application_id', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(message.payload ->> 'preparation_run_id', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists (
          select 1
          from public.application_runs as run
          where run.id = case
              when coalesce(message.payload ->> 'preparation_run_id', '')
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (message.payload ->> 'preparation_run_id')::uuid
            end
            and run.workspace_id = message.workspace_id
            and run.application_id = case
              when coalesce(message.payload ->> 'application_id', '')
                ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (message.payload ->> 'application_id')::uuid
            end
            and run.run_kind = 'PREPARATION'
        )
      )
  ) then
    raise exception 'PREPARATION_OUTBOX_REFERENCE_INVALID' using errcode = '23503';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.outbox as message
    where message.topic = 'application.preparation_requested'
      and not (message.payload ? 'preparation_run_id')
      and not exists (
        select 1
        from public.application_runs as run
        where run.workspace_id = message.workspace_id
          and run.application_id = (message.payload ->> 'application_id')::uuid
          and run.run_kind = 'PREPARATION'
      )
  ) then
    raise exception 'PREPARATION_OUTBOX_BACKFILL_INVALID' using errcode = '23503';
  end if;
end;
$$;

with backfill as (
  select message.id as outbox_id, (
    select run.id
    from public.application_runs as run
    where run.workspace_id = message.workspace_id
      and run.application_id = (message.payload ->> 'application_id')::uuid
      and run.run_kind = 'PREPARATION'
    order by run.created_at, run.id
    limit 1
  ) as preparation_run_id
  from public.outbox as message
  where message.topic = 'application.preparation_requested'
    and not (message.payload ? 'preparation_run_id')
)
update public.outbox as message
set payload = message.payload || jsonb_build_object(
  'preparation_run_id', backfill.preparation_run_id
)
from backfill
where message.id = backfill.outbox_id
  and backfill.preparation_run_id is not null
  and message.topic = 'application.preparation_requested'
  and not (message.payload ? 'preparation_run_id');

create or replace function public.claim_application_preparation(
  p_application_id uuid,
  p_preparation_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  application_id uuid,
  preparation_run_id uuid,
  workspace_id uuid,
  candidate_id uuid,
  job_id uuid,
  job_version_id uuid,
  aggregate_version bigint,
  candidate_input_version bigint,
  tailoring_mode text,
  submission_mode text,
  input_snapshot_id uuid,
  snapshot_readiness text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_application public.applications%rowtype;
  v_run public.application_runs%rowtype;
  v_candidate public.candidates%rowtype;
  v_workspace public.workspaces%rowtype;
  v_snapshot public.application_input_snapshots%rowtype;
  v_worker text := btrim(coalesce(p_worker_id, ''));
  v_now timestamptz := statement_timestamp();
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_application_id is null or p_preparation_run_id is null
     or char_length(v_worker) not between 1 and 120
     or p_lease_seconds is null
     or p_lease_seconds not between 30 and 900 then
    raise exception 'PREPARATION_CLAIM_INPUT_INVALID' using errcode = '22023';
  end if;

  select application.* into strict v_application
  from public.applications as application
  where application.id = p_application_id
  for update;

  select run.* into strict v_run
  from public.application_runs as run
  where run.workspace_id = v_application.workspace_id
    and run.application_id = v_application.id
    and run.id = p_preparation_run_id
    and run.run_kind = 'PREPARATION'
  for update;

  select candidate.* into strict v_candidate
  from public.candidates as candidate
  where candidate.workspace_id = v_application.workspace_id
    and candidate.id = v_application.candidate_id
  for share;

  select workspace.* into strict v_workspace
  from public.workspaces as workspace
  where workspace.id = v_application.workspace_id
  for share;

  if v_application.job_id is null or v_application.job_version_id is null then
    raise exception 'PREPARATION_JOB_NOT_RESOLVED' using errcode = '55000';
  end if;
  if v_candidate.status not in ('ONBOARDING', 'ACTIVE') then
    raise exception 'PREPARATION_CANDIDATE_NOT_ACTIVE' using errcode = '55000';
  end if;
  if v_workspace.status <> 'ACTIVE' then
    raise exception 'PREPARATION_WORKSPACE_NOT_ACTIVE' using errcode = '55000';
  end if;

  if v_run.input_snapshot_id is not null then
    select snapshot.* into strict v_snapshot
    from public.application_input_snapshots as snapshot
    where snapshot.id = v_run.input_snapshot_id;
    return query select v_application.id, v_run.id, v_application.workspace_id,
      v_application.candidate_id, v_application.job_id, v_application.job_version_id,
      v_application.aggregate_version, v_candidate.application_input_version, v_candidate.tailoring_mode,
      v_candidate.submission_mode, v_snapshot.id, v_snapshot.readiness, true;
    return;
  end if;

  if v_run.status = 'RUNNING'
     and v_run.lease_expires_at > v_now
     and v_run.lease_owner is distinct from v_worker then
    raise exception 'PREPARATION_ALREADY_CLAIMED' using errcode = '55P03';
  end if;
  if v_run.status not in ('QUEUED', 'RUNNING') then
    raise exception 'PREPARATION_NOT_CLAIMABLE' using errcode = '55000';
  end if;
  if v_application.status <> 'DRAFTING' then
    raise exception 'PREPARATION_APPLICATION_NOT_ACTIVE' using errcode = '55000';
  end if;

  update public.application_runs
  set status = 'RUNNING',
      preparation_stage = 'FREEZING_INPUTS',
      lease_owner = v_worker,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, v_now),
      last_heartbeat_at = v_now,
      error_code = null
  where id = v_run.id;

  return query select v_application.id, v_run.id, v_application.workspace_id,
    v_application.candidate_id, v_application.job_id, v_application.job_version_id,
    v_application.aggregate_version, v_candidate.application_input_version, v_candidate.tailoring_mode,
    v_candidate.submission_mode, null::uuid, null::text, false;
end;
$$;

create or replace function public.commit_application_input_snapshot(
  p_application_id uuid,
  p_preparation_run_id uuid,
  p_worker_id text,
  p_expected_aggregate_version bigint,
  p_expected_candidate_input_version bigint,
  p_source_document_id uuid,
  p_source_document_version_id uuid,
  p_source_text_review_id uuid,
  p_readiness text,
  p_blockers jsonb,
  p_snapshot_manifest jsonb,
  p_snapshot_hash text,
  p_policy_release text,
  p_assembler_release text,
  p_evidence_version_ids uuid[] default '{}'::uuid[],
  p_fact_version_ids uuid[] default '{}'::uuid[]
)
returns table (
  input_snapshot_id uuid,
  readiness text,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_application public.applications%rowtype;
  v_run public.application_runs%rowtype;
  v_snapshot public.application_input_snapshots%rowtype;
  v_document public.source_documents%rowtype;
  v_document_version public.source_document_versions%rowtype;
  v_text_review public.source_document_text_reviews%rowtype;
  v_candidate public.candidates%rowtype;
  v_workspace public.workspaces%rowtype;
  v_snapshot_id uuid := extensions.gen_random_uuid();
  v_event_id uuid := extensions.gen_random_uuid();
  v_new_aggregate bigint;
  v_worker text := btrim(coalesce(p_worker_id, ''));
  v_evidence_ids uuid[] := coalesce(p_evidence_version_ids, '{}'::uuid[]);
  v_fact_ids uuid[] := coalesce(p_fact_version_ids, '{}'::uuid[]);
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_application_id is null or p_preparation_run_id is null
     or char_length(v_worker) not between 1 and 120
     or p_expected_aggregate_version is null
     or p_expected_aggregate_version <= 0
     or p_expected_candidate_input_version is null
     or p_expected_candidate_input_version <= 0
     or p_readiness is null
     or p_readiness not in ('BLOCKED', 'READY_FOR_DRAFTING')
     or p_blockers is null
     or jsonb_typeof(p_blockers) <> 'array'
     or p_snapshot_manifest is null
     or jsonb_typeof(p_snapshot_manifest) <> 'object'
     or p_snapshot_hash is null
     or p_snapshot_hash !~ '^[0-9a-f]{64}$'
     or char_length(btrim(coalesce(p_policy_release, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_assembler_release, ''))) not between 1 and 120 then
    raise exception 'PREPARATION_SNAPSHOT_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_readiness = 'READY_FOR_DRAFTING'
     and (p_source_document_id is null or p_source_document_version_id is null
       or p_source_text_review_id is null or jsonb_array_length(p_blockers) <> 0) then
    raise exception 'PREPARATION_READY_INPUTS_INVALID' using errcode = '22023';
  end if;
  if p_readiness = 'BLOCKED' and jsonb_array_length(p_blockers) = 0 then
    raise exception 'PREPARATION_BLOCKERS_REQUIRED' using errcode = '22023';
  end if;

  select application.* into strict v_application
  from public.applications as application
  where application.id = p_application_id
  for update;
  select run.* into strict v_run
  from public.application_runs as run
  where run.workspace_id = v_application.workspace_id
    and run.application_id = v_application.id
    and run.id = p_preparation_run_id
    and run.run_kind = 'PREPARATION'
  for update;
  select candidate.* into strict v_candidate
  from public.candidates as candidate
  where candidate.workspace_id = v_application.workspace_id
    and candidate.id = v_application.candidate_id
  for share;
  select workspace.* into strict v_workspace
  from public.workspaces as workspace
  where workspace.id = v_application.workspace_id
  for share;

  if v_run.input_snapshot_id is not null then
    select snapshot.* into strict v_snapshot
    from public.application_input_snapshots as snapshot
    where snapshot.id = v_run.input_snapshot_id;
    if v_snapshot.snapshot_hash <> p_snapshot_hash then
      raise exception 'PREPARATION_SNAPSHOT_REPLAY_MISMATCH' using errcode = '23505';
    end if;
    return query select v_snapshot.id, v_snapshot.readiness,
      v_application.aggregate_version, true;
    return;
  end if;

  if v_application.aggregate_version <> p_expected_aggregate_version then
    raise exception 'APPLICATION_VERSION_MISMATCH' using errcode = '40001';
  end if;
  if v_application.status <> 'DRAFTING' then
    raise exception 'PREPARATION_APPLICATION_NOT_ACTIVE' using errcode = '55000';
  end if;
  if v_candidate.status not in ('ONBOARDING', 'ACTIVE') then
    raise exception 'PREPARATION_CANDIDATE_NOT_ACTIVE' using errcode = '55000';
  end if;
  if v_workspace.status <> 'ACTIVE' then
    raise exception 'PREPARATION_WORKSPACE_NOT_ACTIVE' using errcode = '55000';
  end if;
  if v_candidate.application_input_version <> p_expected_candidate_input_version then
    raise exception 'CANDIDATE_INPUT_VERSION_MISMATCH' using errcode = '40001';
  end if;
  if v_application.job_id is null or v_application.job_version_id is null then
    raise exception 'PREPARATION_JOB_NOT_RESOLVED' using errcode = '55000';
  end if;
  if v_run.status <> 'RUNNING' or v_run.lease_owner is distinct from v_worker
     or v_run.lease_expires_at <= statement_timestamp() then
    raise exception 'PREPARATION_LEASE_INVALID' using errcode = '55P03';
  end if;

  if p_source_document_id is not null then
    select document.* into strict v_document
    from public.source_documents as document
    where document.workspace_id = v_application.workspace_id
      and document.candidate_id = v_application.candidate_id
      and document.id = p_source_document_id;
    select version.* into strict v_document_version
    from public.source_document_versions as version
    where version.workspace_id = v_application.workspace_id
      and version.candidate_id = v_application.candidate_id
      and version.id = p_source_document_version_id
      and version.document_id = v_document.id
      and version.version_number = v_document.current_version_number;
    select review.* into strict v_text_review
    from public.source_document_text_reviews as review
    where review.workspace_id = v_application.workspace_id
      and review.candidate_id = v_application.candidate_id
      and review.id = p_source_text_review_id
      and review.document_id = v_document.id
      and review.document_version_id = v_document_version.id
      and not exists (
        select 1 from public.source_document_text_reviews as newer
        where newer.document_id = review.document_id
          and newer.review_version_number > review.review_version_number
      );
    if v_document.status <> 'READY' then
      raise exception 'PREPARATION_RESUME_NOT_READY' using errcode = '55000';
    end if;
    if v_document.document_kind <> 'RESUME' then
      raise exception 'PREPARATION_SOURCE_NOT_RESUME' using errcode = '55000';
    end if;
  elsif p_source_document_version_id is not null or p_source_text_review_id is not null then
    raise exception 'PREPARATION_RESUME_REFERENCE_INVALID' using errcode = '22023';
  end if;

  if cardinality(v_evidence_ids) <> (
    select count(distinct evidence_ref.evidence_id)
    from unnest(v_evidence_ids) as evidence_ref(evidence_id)
  ) then
    raise exception 'PREPARATION_EVIDENCE_DUPLICATE' using errcode = '22023';
  end if;
  if cardinality(v_evidence_ids) <> (
    select count(*)
    from public.candidate_evidence_versions as version
    join public.candidate_evidence_items as item
      on item.workspace_id = version.workspace_id
     and item.candidate_id = version.candidate_id
     and item.id = version.evidence_item_id
     and item.current_version_number = version.version_number
     and item.review_status = 'VERIFIED'
     and item.text_review_id = p_source_text_review_id
    where version.id = any(v_evidence_ids)
      and version.workspace_id = v_application.workspace_id
      and version.candidate_id = v_application.candidate_id
      and version.candidate_disposition = 'APPROVED'
      and version.usage_policy <> 'DO_NOT_USE'
      and (p_source_document_id is null or version.document_id = p_source_document_id)
  ) then
    raise exception 'PREPARATION_EVIDENCE_INVALID' using errcode = '23503';
  end if;
  if cardinality(v_evidence_ids) <> (
    select count(*)
    from public.candidate_evidence_versions as version
    join public.candidate_evidence_items as item
      on item.workspace_id = version.workspace_id
     and item.candidate_id = version.candidate_id
     and item.id = version.evidence_item_id
     and item.current_version_number = version.version_number
     and item.review_status = 'VERIFIED'
     and item.text_review_id = p_source_text_review_id
    where version.workspace_id = v_application.workspace_id
      and version.candidate_id = v_application.candidate_id
      and version.candidate_disposition = 'APPROVED'
      and version.usage_policy <> 'DO_NOT_USE'
      and version.document_id = p_source_document_id
  ) then
    raise exception 'PREPARATION_EVIDENCE_SET_CHANGED' using errcode = '40001';
  end if;

  if cardinality(v_fact_ids) <> (
    select count(distinct fact_ref.fact_id)
    from unnest(v_fact_ids) as fact_ref(fact_id)
  ) then
    raise exception 'PREPARATION_FACT_DUPLICATE' using errcode = '22023';
  end if;
  if cardinality(v_fact_ids) <> (
    select count(*)
    from public.candidate_fact_versions as version
    join public.candidate_facts as fact
      on fact.workspace_id = version.workspace_id
     and fact.candidate_id = version.candidate_id
     and fact.id = version.fact_id
     and fact.current_version_number = version.version_number
     and fact.verification_status = 'VERIFIED'
     and fact.usage_policy = 'EXACT_FIELDS'
    where version.id = any(v_fact_ids)
      and version.workspace_id = v_application.workspace_id
      and version.candidate_id = v_application.candidate_id
      and version.candidate_disposition = 'APPROVED'
  ) then
    raise exception 'PREPARATION_FACT_INVALID' using errcode = '23503';
  end if;
  if cardinality(v_fact_ids) <> (
    select count(*)
    from public.candidate_fact_versions as version
    join public.candidate_facts as fact
      on fact.workspace_id = version.workspace_id
     and fact.candidate_id = version.candidate_id
     and fact.id = version.fact_id
     and fact.current_version_number = version.version_number
     and fact.verification_status = 'VERIFIED'
     and fact.usage_policy = 'EXACT_FIELDS'
    where version.workspace_id = v_application.workspace_id
      and version.candidate_id = v_application.candidate_id
      and version.candidate_disposition = 'APPROVED'
  ) then
    raise exception 'PREPARATION_FACT_SET_CHANGED' using errcode = '40001';
  end if;

  insert into public.application_input_snapshots
    (id, workspace_id, candidate_id, application_id, preparation_run_id,
     job_id, job_version_id, source_document_id, source_document_version_id,
     source_text_review_id, tailoring_mode, submission_mode, readiness,
     blockers, snapshot_manifest, snapshot_hash, candidate_input_version,
     policy_release, assembler_release)
  values (v_snapshot_id, v_application.workspace_id, v_application.candidate_id,
    v_application.id, v_run.id, v_application.job_id, v_application.job_version_id,
    p_source_document_id, p_source_document_version_id, p_source_text_review_id,
    v_candidate.tailoring_mode, v_candidate.submission_mode, p_readiness,
    p_blockers, p_snapshot_manifest, p_snapshot_hash,
    p_expected_candidate_input_version,
    btrim(p_policy_release), btrim(p_assembler_release));

  insert into public.application_snapshot_evidence_refs
    (workspace_id, candidate_id, document_id, application_id,
     input_snapshot_id, evidence_version_id)
  select v_application.workspace_id, v_application.candidate_id,
    version.document_id, v_application.id, v_snapshot_id, evidence_ref.evidence_id
  from unnest(v_evidence_ids) as evidence_ref(evidence_id)
  join public.candidate_evidence_versions as version
    on version.id = evidence_ref.evidence_id;

  insert into public.application_snapshot_fact_refs
    (workspace_id, candidate_id, application_id, input_snapshot_id, fact_version_id)
  select v_application.workspace_id, v_application.candidate_id,
    v_application.id, v_snapshot_id, fact_ref.fact_id
  from unnest(v_fact_ids) as fact_ref(fact_id);

  update public.application_runs
  set input_snapshot_id = v_snapshot_id,
      status = 'WAITING',
      preparation_stage = case when p_readiness = 'BLOCKED' then 'BLOCKED' else 'INPUTS_READY' end,
      lease_owner = null,
      lease_expires_at = null,
      last_heartbeat_at = statement_timestamp(),
      error_code = case when p_readiness = 'BLOCKED' then 'PREPARATION_INPUT_REQUIRED' else null end
  where id = v_run.id;

  v_new_aggregate := v_application.aggregate_version + 1;
  update public.applications
  set status = case when p_readiness = 'BLOCKED' then 'NEEDS_USER' else 'DRAFTING' end,
      aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where id = v_application.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, correlation_id)
  values
    (v_event_id, v_application.workspace_id, 'APPLICATION', v_application.id,
     v_new_aggregate,
     case when p_readiness = 'BLOCKED'
       then 'application.preparation_blocked'
       else 'application.inputs_frozen'
     end,
     jsonb_build_object(
       'preparation_run_id', v_run.id,
       'input_snapshot_id', v_snapshot_id,
       'snapshot_hash', p_snapshot_hash,
       'readiness', p_readiness,
       'blocker_count', jsonb_array_length(p_blockers),
       'evidence_reference_count', cardinality(v_evidence_ids),
       'exact_fact_reference_count', cardinality(v_fact_ids)
     ),
     'WORKER', v_run.id);

  if p_readiness = 'READY_FOR_DRAFTING' then
    insert into public.outbox (workspace_id, event_id, topic, payload)
    values (
      v_application.workspace_id, v_event_id, 'application.drafting_requested',
      jsonb_build_object(
        'application_id', v_application.id,
        'preparation_run_id', v_run.id,
        'input_snapshot_id', v_snapshot_id,
        'snapshot_hash', p_snapshot_hash
      )
    );
  end if;

  return query select v_snapshot_id, p_readiness, v_new_aggregate, false;
end;
$$;

create or replace function public.retry_application_preparation(
  p_command_id uuid,
  p_application_id uuid,
  p_expected_aggregate_version bigint
)
returns table (
  application_id uuid,
  preparation_run_id uuid,
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
  v_existing public.command_dedup%rowtype;
  v_run_id uuid := extensions.gen_random_uuid();
  v_event_id uuid := extensions.gen_random_uuid();
  v_request_hash text;
  v_new_aggregate bigint;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_application_id is null
     or p_expected_aggregate_version is null
     or p_expected_aggregate_version <= 0 then
    raise exception 'PREPARATION_RETRY_INPUT_INVALID' using errcode = '22023';
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
  for share of candidate, workspace, membership;

  v_request_hash := encode(extensions.digest(convert_to(
    p_application_id::text || E'\n' || p_expected_aggregate_version::text,
    'utf8'
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(v_application.workspace_id::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_application.workspace_id and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'RETRY_APPLICATION_PREPARATION'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select v_application.id,
      (v_existing.result ->> 'preparation_run_id')::uuid,
      (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;

  if v_application.status not in ('NEEDS_USER', 'FAILED_SAFE') then
    raise exception 'APPLICATION_NOT_WAITING_FOR_INPUT' using errcode = '55000';
  end if;
  if v_application.aggregate_version <> p_expected_aggregate_version then
    raise exception 'APPLICATION_VERSION_MISMATCH' using errcode = 'PT409';
  end if;
  if v_application.job_id is null or v_application.job_version_id is null then
    raise exception 'PREPARATION_JOB_NOT_RESOLVED' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.application_runs as run
    where run.application_id = v_application.id
      and run.run_kind = 'PREPARATION'
      and run.status in ('QUEUED', 'RUNNING')
  ) then
    raise exception 'PREPARATION_ALREADY_ACTIVE' using errcode = '55000';
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (v_application.workspace_id, p_command_id, v_actor,
    'RETRY_APPLICATION_PREPARATION', v_request_hash, 'STARTED');

  insert into public.application_runs
    (id, workspace_id, application_id, run_kind, status, preparation_stage)
  values (v_run_id, v_application.workspace_id, v_application.id,
    'PREPARATION', 'QUEUED', 'QUEUED');

  v_new_aggregate := v_application.aggregate_version + 1;
  update public.applications
  set status = 'DRAFTING', aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where id = v_application.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_application.workspace_id, 'APPLICATION', v_application.id,
     v_new_aggregate, 'application.preparation_queued',
     jsonb_build_object(
       'job_id', v_application.job_id,
       'job_version_id', v_application.job_version_id,
       'preparation_run_id', v_run_id
     ),
     'CANDIDATE', v_actor, p_command_id);

  insert into public.outbox (workspace_id, event_id, topic, payload)
  values (
    v_application.workspace_id, v_event_id, 'application.preparation_requested',
    jsonb_build_object(
      'application_id', v_application.id,
      'job_id', v_application.job_id,
      'job_version_id', v_application.job_version_id,
      'preparation_run_id', v_run_id
    )
  );

  update public.command_dedup
  set aggregate_type = 'APPLICATION', aggregate_id = v_application.id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object(
        'application_id', v_application.id,
        'preparation_run_id', v_run_id,
        'aggregate_version', v_new_aggregate
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_application.workspace_id and command_id = p_command_id;

  return query select v_application.id, v_run_id, v_new_aggregate, false;
end;
$$;

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
  if v_message.topic not in (
    'application.queued',
    'application.job_resolved',
    'application.preparation_requested',
    'application.drafting_requested'
  ) then
    raise exception 'OUTBOX_TOPIC_NOT_REQUEUEABLE' using errcode = '55000';
  end if;
  if v_message.topic = 'application.drafting_requested' then
    if v_message.dead_letter_reason = 'SOURCE_DOCUMENT_DELETED' then
      raise exception 'OUTBOX_PERMANENTLY_INVALID' using errcode = '55000';
    end if;
    if coalesce(v_message.payload ->> 'application_id', '')
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_message.payload ->> 'input_snapshot_id', '')
         !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(v_message.payload ->> 'snapshot_hash', '')
         !~ '^[0-9a-f]{64}$' then
      raise exception 'DRAFTING_OUTBOX_PAYLOAD_INVALID' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.application_input_snapshots as snapshot
      join public.applications as application
        on application.workspace_id = snapshot.workspace_id
       and application.id = snapshot.application_id
      where snapshot.workspace_id = v_message.workspace_id
        and snapshot.id = (v_message.payload ->> 'input_snapshot_id')::uuid
        and snapshot.application_id = (v_message.payload ->> 'application_id')::uuid
        and snapshot.snapshot_hash = v_message.payload ->> 'snapshot_hash'
        and snapshot.readiness = 'READY_FOR_DRAFTING'
        and application.status = 'DRAFTING'
    ) then
      raise exception 'DRAFTING_INPUT_SNAPSHOT_NOT_ACTIVE' using errcode = '55000';
    end if;
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

-- A candidate-requested résumé deletion invalidates every unsubmitted input
-- snapshot derived from that exact source before removing its evidence. The
-- application returns to NEEDS_USER, any unstarted drafting handoff is
-- dead-lettered, and nothing is represented as submitted.
create or replace function public.complete_source_document_deletion(
  p_document_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.source_documents%rowtype;
  v_backend_pid integer := pg_catalog.pg_backend_pid();
  v_transaction_id bigint := pg_catalog.txid_current();
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select document.* into strict v_document
  from public.source_documents as document
  where document.id = p_document_id
  for update;

  if v_document.status <> 'DELETION_PENDING' then
    raise exception 'DOCUMENT_NOT_DELETION_PENDING' using errcode = '55000';
  end if;

  perform application.id
  from public.applications as application
  where application.workspace_id = v_document.workspace_id
    and application.id in (
      select snapshot.application_id
      from public.application_input_snapshots as snapshot
      where snapshot.workspace_id = v_document.workspace_id
        and snapshot.candidate_id = v_document.candidate_id
        and snapshot.source_document_id = v_document.id
    )
  order by application.id
  for update;

  if exists (
    select 1
    from public.application_input_snapshots as snapshot
    join public.applications as application
      on application.workspace_id = snapshot.workspace_id
     and application.id = snapshot.application_id
    where snapshot.workspace_id = v_document.workspace_id
      and snapshot.candidate_id = v_document.candidate_id
      and snapshot.source_document_id = v_document.id
      and application.status in (
        'READY', 'AUTHORIZED', 'EXECUTING', 'TAKEOVER', 'RECONCILING'
      )
  ) then
    raise exception 'SOURCE_DOCUMENT_USED_BY_ACTIVE_APPLICATION' using errcode = '55000';
  end if;

  if exists (
    select 1
    from storage.objects as storage_object
    where storage_object.bucket_id = 'career-vault'
      and (
        exists (
          select 1
          from public.source_document_versions as version
          where version.document_id = v_document.id
            and version.storage_bucket = storage_object.bucket_id
            and version.storage_object_path = storage_object.name
        )
        or exists (
          select 1
          from public.source_document_upload_reservations as reservation
          where reservation.document_id = v_document.id
            and reservation.storage_bucket = storage_object.bucket_id
            and reservation.storage_object_path = storage_object.name
        )
      )
  ) then
    raise exception 'SOURCE_DOCUMENT_STORAGE_OBJECTS_REMAIN' using errcode = '55000';
  end if;

  insert into private.source_document_purge_context
    (backend_pid, transaction_id, document_id)
  values
    (v_backend_pid, v_transaction_id, v_document.id);

  update public.outbox as message
  set dead_lettered_at = statement_timestamp(),
      dead_letter_reason = 'SOURCE_DOCUMENT_DELETED',
      last_error = 'SOURCE_DOCUMENT_DELETED',
      lease_owner = null,
      lease_expires_at = null
  where message.topic = 'application.drafting_requested'
    and message.published_at is null
    and message.dead_lettered_at is null
    and exists (
      select 1
      from public.application_input_snapshots as snapshot
      where snapshot.source_document_id = v_document.id
        and snapshot.id::text = (message.payload ->> 'input_snapshot_id')
    );

  update public.application_runs as run
  set input_snapshot_id = null,
      status = 'CANCELED',
      preparation_stage = 'BLOCKED',
      finished_at = coalesce(run.finished_at, statement_timestamp()),
      last_heartbeat_at = statement_timestamp(),
      lease_owner = null,
      lease_expires_at = null,
      error_code = 'SOURCE_DOCUMENT_DELETED'
  where run.input_snapshot_id in (
    select snapshot.id
    from public.application_input_snapshots as snapshot
    where snapshot.source_document_id = v_document.id
  );

  with affected as (
    select distinct snapshot.application_id
    from public.application_input_snapshots as snapshot
    where snapshot.source_document_id = v_document.id
  ), updated as (
    update public.applications as application
    set status = 'NEEDS_USER',
        aggregate_version = application.aggregate_version + 1,
        updated_at = statement_timestamp()
    from affected
    where application.id = affected.application_id
      and application.workspace_id = v_document.workspace_id
      and application.status in ('DRAFTING', 'NEEDS_USER')
    returning application.id, application.aggregate_version
  )
  insert into public.domain_events
    (workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, correlation_id)
  select v_document.workspace_id, 'APPLICATION', updated.id,
    updated.aggregate_version, 'application.inputs_invalidated',
    jsonb_build_object(
      'source_document_id', v_document.id,
      'reason', 'SOURCE_DOCUMENT_DELETED',
      'nothing_submitted', true
    ),
    'WORKER', v_document.id
  from updated;

  delete from public.application_input_snapshots as snapshot
  where snapshot.workspace_id = v_document.workspace_id
    and snapshot.candidate_id = v_document.candidate_id
    and snapshot.source_document_id = v_document.id;

  update public.candidate_evidence_items as item
  set current_version_number = null
  where item.workspace_id = v_document.workspace_id
    and item.candidate_id = v_document.candidate_id
    and item.document_id = v_document.id;

  delete from public.candidate_evidence_citations as citation
  where citation.workspace_id = v_document.workspace_id
    and citation.candidate_id = v_document.candidate_id
    and citation.document_id = v_document.id;

  delete from public.candidate_evidence_versions as evidence_version
  where evidence_version.workspace_id = v_document.workspace_id
    and evidence_version.candidate_id = v_document.candidate_id
    and evidence_version.document_id = v_document.id;

  delete from public.candidate_evidence_items as item
  where item.workspace_id = v_document.workspace_id
    and item.candidate_id = v_document.candidate_id
    and item.document_id = v_document.id;

  delete from public.source_evidence_passages as passage
  where passage.workspace_id = v_document.workspace_id
    and passage.candidate_id = v_document.candidate_id
    and passage.document_id = v_document.id;

  delete from public.fact_sources as source
  using public.source_document_versions as version
  where version.workspace_id = v_document.workspace_id
    and version.candidate_id = v_document.candidate_id
    and version.document_id = v_document.id
    and source.workspace_id = version.workspace_id
    and source.candidate_id = version.candidate_id
    and source.document_version_id = version.id;

  delete from public.source_document_text_reviews as review
  where review.workspace_id = v_document.workspace_id
    and review.document_id = v_document.id;

  delete from public.source_document_extractions as extraction
  where extraction.workspace_id = v_document.workspace_id
    and extraction.document_id = v_document.id;

  delete from public.source_document_versions as version
  where version.workspace_id = v_document.workspace_id
    and version.document_id = v_document.id;

  delete from public.source_documents as document
  where document.workspace_id = v_document.workspace_id
    and document.id = v_document.id;

  delete from private.source_document_purge_context as context
  where context.backend_pid = v_backend_pid
    and context.transaction_id = v_transaction_id
    and context.document_id = v_document.id;

  return true;
end;
$$;

revoke all on function public.claim_application_preparation(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.commit_application_input_snapshot(
  uuid, uuid, text, bigint, bigint, uuid, uuid, uuid, text, jsonb, jsonb, text, text, text, uuid[], uuid[]
) from public, anon, authenticated;
revoke all on function public.retry_application_preparation(uuid, uuid, bigint)
  from public, anon;
grant execute on function public.claim_application_preparation(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.commit_application_input_snapshot(
  uuid, uuid, text, bigint, bigint, uuid, uuid, uuid, text, jsonb, jsonb, text, text, text, uuid[], uuid[]
) to service_role;
grant execute on function public.retry_application_preparation(uuid, uuid, bigint)
  to authenticated, service_role;
revoke all on function public.complete_source_document_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_source_document_deletion(uuid)
  to service_role;

comment on table public.application_input_snapshots is
  'Immutable reference-and-hash manifest for one preparation run; raw resume and exact-answer values remain in source tables.';
comment on function public.claim_application_preparation(uuid, uuid, text, integer) is
  'Service-only lease for one no-submit preparation run.';
comment on function public.commit_application_input_snapshot(
  uuid, uuid, text, bigint, bigint, uuid, uuid, uuid, text, jsonb, jsonb, text, text, text, uuid[], uuid[]
) is 'Atomically freezes candidate/job inputs and moves the application to NEEDS_USER or the drafting handoff.';
comment on function public.retry_application_preparation(uuid, uuid, bigint) is
  'Candidate command to retry preparation after resolving one or more explicit input blockers; never grants submission authority.';
comment on function public.complete_source_document_deletion(uuid) is
  'Service-only exact-document purge that invalidates unsubmitted preparation snapshots before removing candidate evidence.';
