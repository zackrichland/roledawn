-- RoleDawn / HireWire: close resume lifecycle gaps found during hosted
-- acceptance and independent code review.
--
-- Invariants strengthened here:
--   * One logical RESUME row remains unique throughout deletion recovery.
--   * Expired reservations with surviving objects remain service-discoverable.
--   * Source-document purge may remove its exact fact citations, but direct
--     fact-source mutation remains forbidden.
--   * Extraction-attempt replay must match the complete immutable payload.

do $migration$
begin
  if exists (
    select 1
    from public.source_documents
    where document_kind = 'RESUME'
    group by workspace_id, candidate_id
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_LOGICAL_RESUMES_REQUIRE_OPERATOR_REPAIR'
      using errcode = '55000';
  end if;
end
$migration$;

drop index if exists public.source_documents_one_active_resume_per_candidate_idx;

create unique index source_documents_one_active_resume_per_candidate_idx
  on public.source_documents (workspace_id, candidate_id)
  where document_kind = 'RESUME';

-- The reservation command must bind the already existing logical resume in
-- every state. A pending deletion is a recoverable document, not permission to
-- create a second aggregate.
do $migration$
declare
  v_function regprocedure :=
    'public.reserve_resume_upload(uuid,text,text,bigint)'::regprocedure;
  v_definition text;
  v_old constant text := $old$
    and document.document_kind = 'RESUME'
    and document.status <> 'DELETION_PENDING'
  for update;$old$;
  v_new constant text := $new$
    and document.document_kind = 'RESUME'
  for update;$new$;
begin
  v_definition := pg_get_functiondef(v_function);
  if position(v_old in v_definition) = 0 then
    raise exception 'EXPECTED_RESUME_DOCUMENT_LOOKUP_NOT_FOUND'
      using errcode = '55000';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

do $migration$
declare
  v_function regprocedure :=
    'public.reserve_resume_upload(uuid,text,text,bigint)'::regprocedure;
  v_definition text;
  v_old constant text := $old$
  if not found then
    insert into public.source_documents
      (workspace_id, candidate_id, document_kind, display_name, status,
       current_version_number)
    values
      (v_workspace, v_candidate, 'RESUME', v_display_name, 'UPLOADING', null)
    returning * into v_document;
  end if;$old$;
  v_new constant text := $new$
  if not found then
    insert into public.source_documents
      (workspace_id, candidate_id, document_kind, display_name, status,
       current_version_number)
    values
      (v_workspace, v_candidate, 'RESUME', v_display_name, 'UPLOADING', null)
    returning * into v_document;
  elsif v_document.status = 'DELETION_PENDING' then
    raise exception 'DOCUMENT_ALREADY_DELETION_PENDING' using errcode = '55000';
  end if;$new$;
begin
  v_definition := pg_get_functiondef(v_function);
  if position(v_old in v_definition) = 0 then
    raise exception 'EXPECTED_RESUME_DOCUMENT_INSERT_BRANCH_NOT_FOUND'
      using errcode = '55000';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

create or replace function public.list_expired_resume_upload_reservations(
  p_limit integer default 100
)
returns table (
  document_version_id uuid,
  storage_bucket text,
  storage_object_path text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    raise exception 'RESERVATION_CLEANUP_LIMIT_INVALID' using errcode = '22023';
  end if;

  return query
  select reservation.document_version_id, reservation.storage_bucket,
    reservation.storage_object_path
  from public.source_document_upload_reservations as reservation
  where (
      reservation.status = 'RESERVED'
      and reservation.expires_at <= statement_timestamp()
    ) or (
      reservation.status = 'EXPIRED'
      and exists (
        select 1
        from storage.objects as storage_object
        where storage_object.bucket_id = reservation.storage_bucket
          and storage_object.name = reservation.storage_object_path
      )
    )
  order by reservation.expires_at, reservation.id
  limit p_limit;
end;
$$;

revoke all on function public.list_expired_resume_upload_reservations(integer)
  from public, anon, authenticated;
grant execute on function public.list_expired_resume_upload_reservations(integer)
  to service_role;

create or replace function private.reject_fact_source_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_user = 'service_role'
     and exists (
       select 1
       from private.source_document_purge_context as context
       join public.source_document_versions as version
         on version.document_id = context.document_id
       where context.backend_pid = pg_catalog.pg_backend_pid()
         and context.transaction_id = pg_catalog.txid_current()
         and version.workspace_id = old.workspace_id
         and version.candidate_id = old.candidate_id
         and version.id = old.document_version_id
     ) then
    return old;
  end if;

  -- Whole-workspace cascades remain available to the existing service-owned
  -- tenant deletion path. Direct deletes execute at trigger depth one.
  if tg_op = 'DELETE'
     and current_user = 'service_role'
     and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

revoke all on function private.reject_fact_source_mutation()
  from public, anon, authenticated;

drop trigger if exists fact_sources_immutable on public.fact_sources;
create trigger fact_sources_immutable
  before update or delete on public.fact_sources
  for each row execute function private.reject_fact_source_mutation();

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

do $migration$
declare
  v_function regprocedure :=
    'public.record_resume_extraction(uuid,bigint,text,text,text,text,text,text,text,integer,text,jsonb,text,timestamptz)'::regprocedure;
  v_definition text;
  v_old constant text :=
    '       or v_existing.failure_code is distinct from p_failure_code then';
  v_new constant text := $replacement$
       or v_existing.extracted_text is distinct from p_extracted_text
       or v_existing.page_count is distinct from p_page_count
       or v_existing.language_code is distinct from p_language_code
       or v_existing.warnings is distinct from coalesce(p_warnings, '[]'::jsonb)
       or v_existing.failure_code is distinct from p_failure_code
       or v_existing.started_at is distinct from p_started_at then
$replacement$;
begin
  v_definition := pg_get_functiondef(v_function);
  if position(v_old in v_definition) = 0 then
    raise exception 'EXPECTED_EXTRACTION_REPLAY_BRANCH_NOT_FOUND'
      using errcode = '55000';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

comment on function private.reject_fact_source_mutation() is
  'Keeps fact citations append-only except inside an exact service-owned source or tenant purge.';
