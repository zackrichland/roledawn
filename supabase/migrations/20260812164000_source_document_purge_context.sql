-- A transaction-scoped context row makes the authorized deletion cascade
-- explicit. This is more reliable than relying on trigger depth or a custom
-- setting while still rejecting direct evidence deletion.

create table private.source_document_purge_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  document_id uuid not null,
  primary key (backend_pid, transaction_id, document_id)
);

revoke all on table private.source_document_purge_context
  from public, anon, authenticated;
grant select, insert, delete on table private.source_document_purge_context
  to service_role;

create or replace function private.reject_source_document_evidence_mutation()
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
       where context.backend_pid = pg_catalog.pg_backend_pid()
         and context.transaction_id = pg_catalog.txid_current()
         and context.document_id = old.document_id
     ) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

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

comment on table private.source_document_purge_context is
  'Transaction-scoped authorization for service-owned source-document deletion cascades.';
comment on function private.reject_source_document_evidence_mutation() is
  'Blocks direct evidence mutation while permitting an explicit service-owned source-document purge cascade.';
