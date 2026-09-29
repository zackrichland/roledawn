-- Cover the foreign-key access paths introduced by the candidate evidence,
-- reviewed fact, and durable resume-intake slices. Tenant-leading composite
-- indexes also cover each table's workspace_id foreign key through the leftmost
-- prefix, so no separate workspace-only index is needed.

create index candidate_evidence_citations_evidence_version_fk_idx
  on public.candidate_evidence_citations
  (workspace_id, candidate_id, document_id, evidence_version_id);

create index candidate_evidence_citations_passage_fk_idx
  on public.candidate_evidence_citations
  (workspace_id, candidate_id, document_id, passage_id);

create index candidate_evidence_items_current_version_fk_idx
  on public.candidate_evidence_items (id, current_version_number)
  where current_version_number is not null;

create index candidate_evidence_items_primary_passage_fk_idx
  on public.candidate_evidence_items
  (workspace_id, candidate_id, document_id, primary_source_passage_id);

create index candidate_evidence_versions_item_context_fk_idx
  on public.candidate_evidence_versions
  (workspace_id, candidate_id, document_id, evidence_item_id);

create index candidate_fact_versions_reviewer_fk_idx
  on public.candidate_fact_versions (reviewed_by)
  where reviewed_by is not null;

create index candidate_facts_current_version_fk_idx
  on public.candidate_facts (id, current_version_number)
  where current_version_number is not null;

create index source_document_upload_reservations_document_fk_idx
  on public.source_document_upload_reservations
  (workspace_id, candidate_id, document_id);

create index source_evidence_passages_review_context_fk_idx
  on public.source_evidence_passages
  (workspace_id, candidate_id, document_id, document_version_id, text_review_id);
