-- RoleDawn / HireWire: extend the existing candidate-requested source-document
-- purge so the Candidate Intelligence evidence added later follows the same
-- exact-document deletion lifecycle. Direct evidence mutation remains blocked.

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

  -- Break the deferred current-version reference before removing its immutable
  -- history. Every delete below is scoped to the locked source document and is
  -- authorized by the transaction-local purge context above.
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

revoke all on function public.complete_source_document_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_source_document_deletion(uuid)
  to service_role;

comment on function public.complete_source_document_deletion(uuid) is
  'Service-only exact-document purge after candidate request and Storage removal; includes candidate facts and narrative evidence.';
