-- RoleDawn / HireWire: cover foreign-key prefixes that are not already the
-- leading columns of a primary key, unique constraint, or purpose-built index.
--
-- PostgreSQL does not create indexes on referencing columns automatically.
-- These indexes keep parent updates/deletes, tenant cleanup, and worker joins
-- bounded as the catalog and application history grow.

create index if not exists workspaces_personal_owner_fk_idx
  on public.workspaces (personal_owner_auth_user_id)
  where personal_owner_auth_user_id is not null;

create index if not exists job_intakes_resolved_version_fk_idx
  on public.job_intakes (resolved_job_id, resolved_job_version_id)
  where resolved_job_id is not null;

create index if not exists candidate_job_decisions_job_version_fk_idx
  on public.candidate_job_decisions (job_id, job_version_id);

create index if not exists applications_job_version_fk_idx
  on public.applications (job_id, job_version_id)
  where job_id is not null;

-- The first two columns are constant per row, but the linter correctly asks
-- for the exact FK prefix because the existing PK is ordered (id) instead.
create index if not exists applications_current_revision_fk_idx
  on public.applications (workspace_id, id, current_revision_id)
  where current_revision_id is not null;

create index if not exists application_runs_application_fk_idx
  on public.application_runs (workspace_id, application_id);

create index if not exists application_runs_input_revision_fk_idx
  on public.application_runs (workspace_id, application_id, input_revision_id)
  where input_revision_id is not null;

create index if not exists outbox_workspace_event_fk_idx
  on public.outbox (workspace_id, event_id);

create index if not exists command_dedup_actor_fk_idx
  on public.command_dedup (actor_id);

create index if not exists command_dedup_result_event_fk_idx
  on public.command_dedup (workspace_id, result_event_id)
  where result_event_id is not null;

create index if not exists source_document_versions_creator_fk_idx
  on public.source_document_versions (created_by);

create index if not exists candidate_fact_versions_creator_fk_idx
  on public.candidate_fact_versions (created_by);

create index if not exists candidate_fact_versions_candidate_fact_fk_idx
  on public.candidate_fact_versions (workspace_id, candidate_id, fact_id);

create index if not exists source_document_versions_candidate_document_fk_idx
  on public.source_document_versions (workspace_id, candidate_id, document_id);

create index if not exists fact_sources_fact_version_fk_idx
  on public.fact_sources (workspace_id, candidate_id, fact_version_id);

create index if not exists fact_sources_document_version_fk_idx
  on public.fact_sources (workspace_id, candidate_id, document_version_id);

create index if not exists application_revisions_job_version_fk_idx
  on public.application_revisions (workspace_id, application_id, job_version_id)
  where job_version_id is not null;

create index if not exists application_revision_refs_revision_fk_idx
  on public.application_revision_fact_refs
    (workspace_id, application_id, application_revision_id);

create index if not exists application_revision_refs_application_fk_idx
  on public.application_revision_fact_refs (workspace_id, candidate_id, application_id);

create index if not exists application_revision_refs_fact_fk_idx
  on public.application_revision_fact_refs (workspace_id, candidate_id, fact_version_id);

create index if not exists artifact_versions_workspace_revision_fk_idx
  on public.artifact_versions (workspace_id, application_revision_id);

create index if not exists approval_challenges_candidate_application_fk_idx
  on public.approval_challenges (workspace_id, candidate_id, application_id);

create index if not exists approval_challenges_application_revision_fk_idx
  on public.approval_challenges (workspace_id, application_id, revision_id);

create index if not exists approval_consumptions_consumer_fk_idx
  on public.approval_consumptions (consumed_by);

create index if not exists approval_consumptions_challenge_fk_idx
  on public.approval_consumptions
    (workspace_id, approval_id, application_id, revision_id);

create index if not exists application_attempts_application_revision_fk_idx
  on public.application_attempts (workspace_id, application_id, revision_id);

create index if not exists application_attempts_approval_fk_idx
  on public.application_attempts
    (workspace_id, approval_consumption_id, application_id, revision_id);

create index if not exists receipts_attempt_application_fk_idx
  on public.receipts (workspace_id, attempt_id, application_id);

-- This must remain a forward-only migration. The four deployed foundation
-- migrations are immutable and must never be edited after recording.
