-- Cover the composite foreign-key lookup paths introduced by the Bucket 3
-- application-input snapshot boundary. These indexes support parent updates
-- and deletes without changing any candidate-visible behavior.

create index application_input_snapshots_job_version_fk_idx
  on public.application_input_snapshots (job_id, job_version_id);

create index application_input_snapshots_preparation_run_fk_idx
  on public.application_input_snapshots (
    workspace_id,
    application_id,
    preparation_run_id
  );

create index application_input_snapshots_application_fk_idx
  on public.application_input_snapshots (
    workspace_id,
    candidate_id,
    application_id
  );

create index application_input_snapshots_source_review_fk_idx
  on public.application_input_snapshots (
    workspace_id,
    candidate_id,
    source_document_id,
    source_document_version_id,
    source_text_review_id
  )
  where source_document_id is not null;

create index application_runs_input_snapshot_fk_idx
  on public.application_runs (
    workspace_id,
    application_id,
    input_snapshot_id
  )
  where input_snapshot_id is not null;
