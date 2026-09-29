-- Finish covering the composite parent lookup paths on the immutable evidence
-- and exact-fact reference tables introduced by the Bucket 3 snapshot schema.

create index application_snapshot_evidence_refs_snapshot_fk_idx
  on public.application_snapshot_evidence_refs (
    workspace_id,
    application_id,
    input_snapshot_id
  );

create index application_snapshot_evidence_refs_application_fk_idx
  on public.application_snapshot_evidence_refs (
    workspace_id,
    candidate_id,
    application_id
  );

create index application_snapshot_evidence_refs_evidence_fk_idx
  on public.application_snapshot_evidence_refs (
    workspace_id,
    candidate_id,
    document_id,
    evidence_version_id
  );

create index application_snapshot_fact_refs_snapshot_fk_idx
  on public.application_snapshot_fact_refs (
    workspace_id,
    application_id,
    input_snapshot_id
  );

create index application_snapshot_fact_refs_application_fk_idx
  on public.application_snapshot_fact_refs (
    workspace_id,
    candidate_id,
    application_id
  );

create index application_snapshot_fact_refs_fact_fk_idx
  on public.application_snapshot_fact_refs (
    workspace_id,
    candidate_id,
    fact_version_id
  );
