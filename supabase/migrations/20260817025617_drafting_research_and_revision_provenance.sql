-- RoleDawn / HireWire: persist the smallest durable handoff from preparation
-- into research and drafting. Research and revision provenance are append-only.
-- Exact source deletion removes source-backed rows but leaves UUID/hash
-- tombstones here; derived-artifact deletion needs its own later policy.

create table public.application_research_bundles (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  input_snapshot_id uuid not null,
  input_snapshot_hash text not null check (input_snapshot_hash ~ '^[0-9a-f]{64}$'),
  objective text not null default 'APPLICATION_MATERIALS'
    check (objective = 'APPLICATION_MATERIALS'),
  bundle_manifest jsonb not null check (jsonb_typeof(bundle_manifest) = 'object'),
  bundle_hash text not null check (bundle_hash ~ '^[0-9a-f]{64}$'),
  researcher_release text not null
    check (char_length(btrim(researcher_release)) between 1 and 120),
  freshness_policy_release text not null
    check (char_length(btrim(freshness_policy_release)) between 1 and 120),
  freshness_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, application_id, id),
  unique (workspace_id, application_id, input_snapshot_id, id),
  unique (input_snapshot_id, bundle_hash),
  constraint application_research_bundles_application_fkey
    foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade,
  check (freshness_expires_at > created_at)
);

-- No released revision exists before this migration. Fail closed in any
-- environment that does contain one rather than silently accepting a legacy
-- row with unverifiable drafting inputs.
do $contract$
begin
  if exists (select 1 from public.application_revisions) then
    raise exception 'APPLICATION_REVISION_PROVENANCE_BACKFILL_REQUIRED'
      using errcode = '55000';
  end if;
end;
$contract$;

alter table public.application_revisions
  add column input_snapshot_id uuid not null,
  add column input_snapshot_hash text not null
    check (input_snapshot_hash ~ '^[0-9a-f]{64}$'),
  add column research_bundle_id uuid not null,
  add column research_bundle_hash text not null
    check (research_bundle_hash ~ '^[0-9a-f]{64}$'),
  add constraint application_revisions_drafting_provenance_key
    unique (workspace_id, application_id, input_snapshot_id, id),
  add constraint application_revisions_research_bundle_fkey
    foreign key (
      workspace_id, application_id, input_snapshot_id, research_bundle_id
    ) references public.application_research_bundles(
      workspace_id, application_id, input_snapshot_id, id
    ) on delete no action deferrable initially deferred;

create table public.application_revision_evidence_refs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  application_id uuid not null,
  input_snapshot_id uuid not null,
  application_revision_id uuid not null,
  evidence_version_id uuid not null,
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, application_revision_id, evidence_version_id),
  constraint application_revision_evidence_refs_revision_fkey
    foreign key (
      workspace_id, application_id, input_snapshot_id, application_revision_id
    ) references public.application_revisions(
      workspace_id, application_id, input_snapshot_id, id
    )
    on delete cascade,
  constraint application_revision_evidence_refs_application_fkey
    foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id)
    on delete cascade
);

create index application_research_bundles_application_time_idx
  on public.application_research_bundles (application_id, created_at desc, id);
create index application_research_bundles_snapshot_time_idx
  on public.application_research_bundles (input_snapshot_id, created_at desc, id);
create index application_research_bundles_freshness_idx
  on public.application_research_bundles (freshness_expires_at, id);
create index application_research_bundles_application_fk_idx
  on public.application_research_bundles (workspace_id, candidate_id, application_id);
create index application_revisions_drafting_inputs_fk_idx
  on public.application_revisions (
    workspace_id, application_id, input_snapshot_id, research_bundle_id
  ) where input_snapshot_id is not null and research_bundle_id is not null;
create index application_revision_evidence_refs_revision_fk_idx
  on public.application_revision_evidence_refs (
    workspace_id, application_id, input_snapshot_id, application_revision_id
  );
create index application_revision_evidence_refs_snapshot_evidence_idx
  on public.application_revision_evidence_refs (
    workspace_id, input_snapshot_id, evidence_version_id
  );
create index application_revision_evidence_refs_application_fk_idx
  on public.application_revision_evidence_refs (
    workspace_id, candidate_id, application_id
  );
create index application_revision_evidence_refs_evidence_lookup_idx
  on public.application_revision_evidence_refs (
    workspace_id, candidate_id, document_id, evidence_version_id
  );

create or replace function private.guard_application_research_bundle_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot_hash text;
  v_snapshot_readiness text;
begin
  select snapshot.snapshot_hash, snapshot.readiness
    into v_snapshot_hash, v_snapshot_readiness
  from public.application_input_snapshots as snapshot
  where snapshot.workspace_id = new.workspace_id
    and snapshot.candidate_id = new.candidate_id
    and snapshot.application_id = new.application_id
    and snapshot.id = new.input_snapshot_id
  for key share;

  if not found then
    raise exception 'RESEARCH_INPUT_SNAPSHOT_NOT_FOUND' using errcode = '55000';
  end if;
  if v_snapshot_readiness <> 'READY_FOR_DRAFTING' then
    raise exception 'RESEARCH_INPUT_SNAPSHOT_NOT_READY' using errcode = '55000';
  end if;
  if new.input_snapshot_hash is distinct from v_snapshot_hash then
    raise exception 'RESEARCH_INPUT_SNAPSHOT_HASH_MISMATCH' using errcode = '55000';
  end if;
  if new.freshness_expires_at <= statement_timestamp() then
    raise exception 'RESEARCH_BUNDLE_ALREADY_EXPIRED' using errcode = '55000';
  end if;

  return new;
end;
$$;

create or replace function private.guard_application_revision_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot_hash text;
  v_snapshot_readiness text;
  v_snapshot_job_version_id uuid;
  v_bundle_snapshot_hash text;
  v_bundle_hash text;
  v_bundle_expires_at timestamptz;
begin
  if new.input_snapshot_id is null
    or new.input_snapshot_hash is null
    or new.research_bundle_id is null
    or new.research_bundle_hash is null
  then
    raise exception 'APPLICATION_REVISION_PROVENANCE_REQUIRED' using errcode = '55000';
  end if;

  select snapshot.snapshot_hash, snapshot.readiness, snapshot.job_version_id
    into v_snapshot_hash, v_snapshot_readiness, v_snapshot_job_version_id
  from public.application_input_snapshots as snapshot
  where snapshot.workspace_id = new.workspace_id
    and snapshot.application_id = new.application_id
    and snapshot.id = new.input_snapshot_id
  for key share;

  if not found then
    raise exception 'APPLICATION_REVISION_INPUT_SNAPSHOT_NOT_FOUND' using errcode = '55000';
  end if;
  if v_snapshot_readiness <> 'READY_FOR_DRAFTING' then
    raise exception 'APPLICATION_REVISION_INPUT_SNAPSHOT_NOT_READY' using errcode = '55000';
  end if;
  if new.input_snapshot_hash is distinct from v_snapshot_hash then
    raise exception 'APPLICATION_REVISION_INPUT_SNAPSHOT_HASH_MISMATCH' using errcode = '55000';
  end if;
  if new.job_version_id is distinct from v_snapshot_job_version_id then
    raise exception 'APPLICATION_REVISION_JOB_VERSION_MISMATCH' using errcode = '55000';
  end if;

  select bundle.input_snapshot_hash, bundle.bundle_hash, bundle.freshness_expires_at
    into v_bundle_snapshot_hash, v_bundle_hash, v_bundle_expires_at
  from public.application_research_bundles as bundle
  where bundle.workspace_id = new.workspace_id
    and bundle.application_id = new.application_id
    and bundle.input_snapshot_id = new.input_snapshot_id
    and bundle.id = new.research_bundle_id
  for key share;

  if not found then
    raise exception 'APPLICATION_REVISION_RESEARCH_BUNDLE_NOT_FOUND' using errcode = '55000';
  end if;
  if v_bundle_snapshot_hash is distinct from v_snapshot_hash then
    raise exception 'APPLICATION_REVISION_RESEARCH_SNAPSHOT_MISMATCH' using errcode = '55000';
  end if;
  if new.research_bundle_hash is distinct from v_bundle_hash then
    raise exception 'APPLICATION_REVISION_RESEARCH_BUNDLE_HASH_MISMATCH' using errcode = '55000';
  end if;
  if v_bundle_expires_at <= statement_timestamp() then
    raise exception 'APPLICATION_REVISION_RESEARCH_BUNDLE_EXPIRED' using errcode = '55000';
  end if;

  return new;
end;
$$;

create or replace function private.guard_application_revision_evidence_ref_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_evidence_hash text;
begin
  perform revision.id
  from public.application_revisions as revision
  where revision.workspace_id = new.workspace_id
    and revision.application_id = new.application_id
    and revision.input_snapshot_id = new.input_snapshot_id
    and revision.id = new.application_revision_id
  for key share;

  if not found then
    raise exception 'APPLICATION_REVISION_EVIDENCE_REVISION_NOT_FOUND' using errcode = '55000';
  end if;

  perform snapshot_ref.evidence_version_id
  from public.application_snapshot_evidence_refs as snapshot_ref
  where snapshot_ref.workspace_id = new.workspace_id
    and snapshot_ref.candidate_id = new.candidate_id
    and snapshot_ref.document_id = new.document_id
    and snapshot_ref.application_id = new.application_id
    and snapshot_ref.input_snapshot_id = new.input_snapshot_id
    and snapshot_ref.evidence_version_id = new.evidence_version_id
  for key share;

  if not found then
    raise exception 'APPLICATION_REVISION_EVIDENCE_NOT_IN_SNAPSHOT' using errcode = '55000';
  end if;

  select evidence.claim_sha256 into v_evidence_hash
  from public.candidate_evidence_versions as evidence
  where evidence.workspace_id = new.workspace_id
    and evidence.candidate_id = new.candidate_id
    and evidence.document_id = new.document_id
    and evidence.id = new.evidence_version_id
  for key share;

  if not found then
    raise exception 'APPLICATION_REVISION_EVIDENCE_VERSION_NOT_FOUND' using errcode = '55000';
  end if;
  if new.evidence_hash is distinct from v_evidence_hash then
    raise exception 'APPLICATION_REVISION_EVIDENCE_HASH_MISMATCH' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_application_research_bundle_insert()
  from public, anon, authenticated;
revoke all on function private.guard_application_revision_insert()
  from public, anon, authenticated;
revoke all on function private.guard_application_revision_evidence_ref_insert()
  from public, anon, authenticated;

create trigger application_research_bundles_validate_insert
  before insert on public.application_research_bundles
  for each row execute function private.guard_application_research_bundle_insert();
create trigger application_revisions_validate_drafting_insert
  before insert on public.application_revisions
  for each row execute function private.guard_application_revision_insert();
create trigger application_revision_evidence_refs_validate_insert
  before insert on public.application_revision_evidence_refs
  for each row execute function private.guard_application_revision_evidence_ref_insert();

create trigger application_research_bundles_immutable
  before update or delete on public.application_research_bundles
  for each row execute function private.reject_row_mutation();
create trigger application_revision_evidence_refs_immutable
  before update or delete on public.application_revision_evidence_refs
  for each row execute function private.reject_row_mutation();

-- This assertion protects the existing exact-document purge from accidental
-- retention FKs while the insert guards above still fail closed on creation.
do $contract$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.contype = 'f'
      and (
        (
          constraint_row.conrelid = 'public.application_research_bundles'::regclass
          and constraint_row.confrelid = 'public.application_input_snapshots'::regclass
        )
        or (
          constraint_row.conrelid = 'public.application_revisions'::regclass
          and constraint_row.confrelid = 'public.application_input_snapshots'::regclass
        )
        or (
          constraint_row.conrelid = 'public.application_revision_evidence_refs'::regclass
          and constraint_row.confrelid in (
            'public.application_snapshot_evidence_refs'::regclass,
            'public.candidate_evidence_versions'::regclass
          )
        )
      )
  ) then
    raise exception 'DRAFTING_PROVENANCE_RETENTION_FK_PRESENT' using errcode = '55000';
  end if;
end;
$contract$;

alter table public.application_research_bundles enable row level security;
alter table public.application_revision_evidence_refs enable row level security;

create policy application_research_bundles_candidate_select
  on public.application_research_bundles for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = application_research_bundles.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create policy application_revision_evidence_refs_candidate_select
  on public.application_revision_evidence_refs for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = application_revision_evidence_refs.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

revoke all on public.application_research_bundles,
  public.application_revision_evidence_refs
  from public, anon, authenticated;
grant select on public.application_research_bundles,
  public.application_revision_evidence_refs
  to authenticated;
grant select, insert on public.application_research_bundles,
  public.application_revision_evidence_refs
  to service_role;

comment on table public.application_research_bundles is
  'Immutable, cited company-and-role research manifest for one application input snapshot.';
comment on column public.application_research_bundles.bundle_manifest is
  'Typed research claims, source references, conflict state, and freshness metadata; never candidate evidence.';
comment on column public.application_research_bundles.bundle_hash is
  'Lowercase SHA-256 digest of the canonical research bundle manifest.';
comment on column public.application_research_bundles.input_snapshot_hash is
  'Snapshot digest copied at insert and retained with input_snapshot_id after an authorized source purge.';
comment on column public.application_research_bundles.freshness_expires_at is
  'Time after which this bundle must be refreshed before creating a new application revision.';
comment on column public.application_revisions.input_snapshot_id is
  'Required immutable input snapshot UUID used to produce this revision; validated at insert and retained after authorized source deletion.';
comment on column public.application_revisions.input_snapshot_hash is
  'Snapshot digest validated at revision insert and retained after authorized source deletion.';
comment on column public.application_revisions.research_bundle_id is
  'Required immutable research bundle used to produce this revision; validated at insert and retained as durable provenance.';
comment on column public.application_revisions.research_bundle_hash is
  'Research-bundle digest validated at revision insert and retained as durable provenance.';
comment on table public.application_revision_evidence_refs is
  'Append-only UUID/hash provenance to evidence frozen in the exact revision snapshot; source rows may later be purged.';
comment on column public.application_revision_evidence_refs.evidence_hash is
  'Candidate-evidence claim digest validated at insert and retained after authorized source deletion.';
comment on function private.guard_application_research_bundle_insert() is
  'Service-owned insert guard that validates a ready same-tenant input snapshot without retaining it by FK.';
comment on function private.guard_application_revision_insert() is
  'Service-owned insert guard requiring a ready snapshot and same-application unexpired research bundle for every future revision.';
comment on function private.guard_application_revision_evidence_ref_insert() is
  'Service-owned insert guard proving evidence was frozen into the exact revision snapshot without retaining source rows by FK.';
