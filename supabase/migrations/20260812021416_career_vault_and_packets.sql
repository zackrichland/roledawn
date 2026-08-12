-- RoleDawn / HireWire: Career Vault, immutable application packets, approval and proof.
-- File bytes live in private Storage buckets. Database rows hold paths, hashes, policy, and provenance.

create table public.source_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_kind text not null
    check (document_kind in ('RESUME', 'COVER_LETTER', 'PORTFOLIO', 'TRANSCRIPT', 'OTHER')),
  display_name text not null check (btrim(display_name) <> ''),
  status text not null default 'UPLOADING'
    check (status in ('UPLOADING', 'SCANNING', 'PARSING', 'NEEDS_REVIEW', 'READY', 'REJECTED', 'DELETION_PENDING')),
  current_version_number bigint check (current_version_number is null or current_version_number > 0),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);

create table public.source_document_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  version_number bigint not null check (version_number > 0),
  storage_bucket text not null check (storage_bucket = 'career-vault'),
  storage_object_path text not null check (btrim(storage_object_path) <> ''),
  mime_type text not null
    check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text not null check (scan_status in ('CLEAN', 'REJECTED')),
  parser_release text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  unique (document_id, version_number),
  unique (storage_bucket, storage_object_path),
  foreign key (workspace_id, candidate_id, document_id)
    references public.source_documents(workspace_id, candidate_id, id) on delete cascade
);

create table public.candidate_facts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  fact_key text not null check (btrim(fact_key) <> ''),
  sensitivity text not null check (sensitivity in ('STANDARD', 'SENSITIVE', 'PROTECTED')),
  usage_policy text not null
    check (usage_policy in ('EXACT_FIELDS', 'RESUME_AND_ANSWERS', 'NARRATIVE_ONLY', 'NEVER_AUTOFILL')),
  verification_status text not null default 'NEEDS_REVIEW'
    check (verification_status in ('NEEDS_REVIEW', 'VERIFIED', 'REJECTED')),
  current_version_number bigint check (current_version_number is null or current_version_number > 0),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  unique (candidate_id, fact_key),
  foreign key (workspace_id, candidate_id)
    references public.candidates(workspace_id, id) on delete cascade
);

create table public.candidate_fact_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  fact_id uuid not null,
  version_number bigint not null check (version_number > 0),
  value_json jsonb not null,
  normalized_text text,
  candidate_disposition text not null check (candidate_disposition in ('PROPOSED', 'APPROVED', 'REJECTED')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  unique (fact_id, version_number),
  foreign key (workspace_id, candidate_id, fact_id)
    references public.candidate_facts(workspace_id, candidate_id, id) on delete cascade
);

create table public.fact_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  fact_version_id uuid not null,
  document_version_id uuid not null,
  source_locator jsonb not null,
  supporting_excerpt text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, candidate_id, fact_version_id)
    references public.candidate_fact_versions(workspace_id, candidate_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id, document_version_id)
    references public.source_document_versions(workspace_id, candidate_id, id) on delete cascade,
  unique (fact_version_id, document_version_id, source_locator)
);

create table public.application_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null,
  version_number bigint not null check (version_number > 0),
  job_version_id uuid,
  packet_manifest jsonb not null,
  material_diff jsonb not null,
  packet_hash text not null check (packet_hash ~ '^[0-9a-f]{64}$'),
  validation_status text not null check (validation_status in ('PENDING', 'PASSED', 'BLOCKED')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, application_id, id),
  unique (application_id, version_number),
  unique (application_id, packet_hash),
  foreign key (workspace_id, application_id)
    references public.applications(workspace_id, id) on delete cascade,
  foreign key (workspace_id, application_id, job_version_id)
    references public.applications(workspace_id, id, job_version_id) on delete restrict,
  check (validation_status <> 'PASSED' or job_version_id is not null)
);

create table public.application_revision_fact_refs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  application_revision_id uuid not null,
  fact_version_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, application_revision_id, fact_version_id),
  foreign key (workspace_id, application_id, application_revision_id)
    references public.application_revisions(workspace_id, application_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade,
  foreign key (workspace_id, candidate_id, fact_version_id)
    references public.candidate_fact_versions(workspace_id, candidate_id, id) on delete restrict
);

alter table public.applications add column current_revision_id uuid;
alter table public.applications add constraint applications_current_revision_fkey
  foreign key (workspace_id, id, current_revision_id)
  references public.application_revisions(workspace_id, application_id, id)
  deferrable initially deferred;

alter table public.application_runs add constraint application_runs_input_revision_fkey
  foreign key (workspace_id, application_id, input_revision_id)
  references public.application_revisions(workspace_id, application_id, id) on delete restrict;

create table public.artifact_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_revision_id uuid not null,
  kind text not null check (kind in ('RESUME', 'COVER_LETTER', 'ANSWER_SET', 'FORM_SNAPSHOT', 'OTHER')),
  storage_bucket text not null check (storage_bucket = 'application-artifacts'),
  storage_object_path text not null check (btrim(storage_object_path) <> ''),
  mime_type text not null
    check (mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/json',
      'image/png'
    )),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  renderer_release text,
  qa_status text not null check (qa_status in ('PENDING', 'PASSED', 'FAILED')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, application_revision_id)
    references public.application_revisions(workspace_id, id) on delete cascade,
  unique (storage_bucket, storage_object_path),
  unique (application_revision_id, kind, sha256)
);

create table public.approval_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  revision_id uuid not null,
  permitted_action text not null check (permitted_action = 'SUBMIT_APPLICATION_ONCE'),
  diff_hash text not null check (diff_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique (nonce_hash),
  unique (workspace_id, id),
  unique (workspace_id, id, application_id, revision_id),
  foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade,
  foreign key (workspace_id, application_id, revision_id)
    references public.application_revisions(workspace_id, application_id, id) on delete restrict,
  check (expires_at > issued_at),
  check (revoked_at is null or revoked_at >= issued_at)
);

create table public.approval_consumptions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  approval_id uuid not null,
  application_id uuid not null,
  revision_id uuid not null,
  consumed_by uuid not null references auth.users(id) on delete restrict,
  consumed_at timestamptz not null default now(),
  command_id uuid not null,
  unique (workspace_id, id),
  unique (approval_id),
  unique (workspace_id, command_id),
  unique (workspace_id, id, application_id, revision_id),
  foreign key (workspace_id, approval_id, application_id, revision_id)
    references public.approval_challenges(workspace_id, id, application_id, revision_id) on delete restrict
);

create table public.application_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null,
  revision_id uuid not null,
  approval_consumption_id uuid not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  adapter_release text not null check (btrim(adapter_release) <> ''),
  status text not null check (status in ('STARTED', 'UNCERTAIN', 'CONFIRMED', 'FAILED_SAFE', 'TAKEOVER')),
  browser_session_ref text,
  external_reference text,
  result_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, id, application_id),
  unique (idempotency_key),
  unique (approval_consumption_id),
  foreign key (workspace_id, application_id, revision_id)
    references public.application_revisions(workspace_id, application_id, id) on delete restrict,
  foreign key (workspace_id, approval_consumption_id, application_id, revision_id)
    references public.approval_consumptions(workspace_id, id, application_id, revision_id) on delete restrict,
  check (completed_at is null or completed_at >= started_at)
);

create table public.receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  application_id uuid not null,
  attempt_id uuid not null,
  confirmation_kind text not null check (confirmation_kind in ('PORTAL', 'EMAIL', 'EXTERNAL_RECEIPT')),
  confirmation_reference text not null check (btrim(confirmation_reference) <> ''),
  evidence_manifest jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (attempt_id),
  unique (receipt_hash),
  foreign key (workspace_id, attempt_id, application_id)
    references public.application_attempts(workspace_id, id, application_id) on delete restrict
);

create index source_documents_candidate_time_idx on public.source_documents (candidate_id, created_at desc, id);
create index document_versions_document_idx on public.source_document_versions (document_id, version_number);
create index candidate_facts_candidate_idx on public.candidate_facts (candidate_id, verification_status, fact_key);
create index fact_versions_fact_idx on public.candidate_fact_versions (fact_id, version_number);
create index fact_sources_document_idx on public.fact_sources (document_version_id);
create index application_revisions_application_idx on public.application_revisions (application_id, version_number desc);
create index application_revision_fact_refs_fact_idx
  on public.application_revision_fact_refs (fact_version_id, application_revision_id);
create index artifact_versions_revision_idx on public.artifact_versions (application_revision_id, kind);
create index approvals_application_time_idx on public.approval_challenges (application_id, issued_at desc, id);
create index attempts_application_time_idx on public.application_attempts (application_id, started_at desc, id);
create index receipts_application_time_idx on public.receipts (application_id, confirmed_at desc, id);

-- Generic immutable-row guard for released evidence, packets, approvals, attempts, and proof.
create or replace function private.reject_row_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name using errcode = '55000'; end;
$$;
revoke all on function private.reject_row_mutation() from public, anon, authenticated;

create trigger source_document_versions_immutable before update or delete on public.source_document_versions
  for each row execute function private.reject_row_mutation();
create trigger candidate_fact_versions_immutable before update or delete on public.candidate_fact_versions
  for each row execute function private.reject_row_mutation();
create trigger fact_sources_immutable before update or delete on public.fact_sources
  for each row execute function private.reject_row_mutation();
create trigger application_revisions_immutable before update or delete on public.application_revisions
  for each row execute function private.reject_row_mutation();
create trigger application_revision_fact_refs_immutable before update or delete on public.application_revision_fact_refs
  for each row execute function private.reject_row_mutation();
create trigger artifact_versions_immutable before update or delete on public.artifact_versions
  for each row execute function private.reject_row_mutation();
create trigger approval_consumptions_immutable before update or delete on public.approval_consumptions
  for each row execute function private.reject_row_mutation();
create trigger receipts_immutable before update or delete on public.receipts
  for each row execute function private.reject_row_mutation();
create trigger domain_events_immutable before update or delete on public.domain_events
  for each row execute function private.reject_row_mutation();
create trigger source_job_observations_immutable before update or delete on public.source_job_observations
  for each row execute function private.reject_row_mutation();
create trigger job_versions_immutable before update or delete on public.job_versions
  for each row execute function private.reject_row_mutation();

alter table public.source_documents enable row level security;
alter table public.source_document_versions enable row level security;
alter table public.candidate_facts enable row level security;
alter table public.candidate_fact_versions enable row level security;
alter table public.fact_sources enable row level security;
alter table public.application_revisions enable row level security;
alter table public.application_revision_fact_refs enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.approval_challenges enable row level security;
alter table public.approval_consumptions enable row level security;
alter table public.application_attempts enable row level security;
alter table public.receipts enable row level security;

create policy source_documents_member_select on public.source_documents for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy document_versions_member_select on public.source_document_versions for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy candidate_facts_member_select on public.candidate_facts for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy candidate_fact_versions_member_select on public.candidate_fact_versions for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy fact_sources_member_select on public.fact_sources for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy revisions_member_select on public.application_revisions for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy revision_fact_refs_member_select on public.application_revision_fact_refs for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy artifacts_member_select on public.artifact_versions for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy approvals_member_select on public.approval_challenges for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy consumptions_member_select on public.approval_consumptions for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy attempts_member_select on public.application_attempts for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));
create policy receipts_member_select on public.receipts for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));

revoke all on public.source_documents, public.source_document_versions, public.candidate_facts,
  public.candidate_fact_versions, public.fact_sources, public.application_revisions,
  public.application_revision_fact_refs, public.artifact_versions, public.approval_challenges, public.approval_consumptions,
  public.application_attempts, public.receipts from anon, authenticated;
grant select on public.source_documents, public.source_document_versions, public.candidate_facts,
  public.candidate_fact_versions, public.fact_sources, public.application_revisions,
  public.application_revision_fact_refs, public.artifact_versions, public.approval_challenges, public.approval_consumptions,
  public.application_attempts, public.receipts to authenticated;
grant all on public.source_documents, public.source_document_versions, public.candidate_facts,
  public.candidate_fact_versions, public.fact_sources, public.application_revisions,
  public.application_revision_fact_refs, public.artifact_versions, public.approval_challenges, public.approval_consumptions,
  public.application_attempts, public.receipts to service_role;

-- Buckets remain private. There are intentionally no broad storage.objects policies:
-- authenticated server handlers must authorize the workspace then mint short-lived capabilities.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('career-vault', 'career-vault', false, 10485760,
    array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('application-artifacts', 'application-artifacts', false, 10485760,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/json',
      'image/png'
    ])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.application_revisions is
  'Immutable pre-submit packet. Any material change creates a new revision and invalidates prior approval.';
