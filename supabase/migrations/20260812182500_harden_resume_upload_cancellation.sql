-- Keep an upload reservation recoverable until its exact Storage object is
-- gone. The application removes the object through the Storage API first;
-- this database check closes false-success and race windows.

create or replace function public.cancel_resume_upload_reservation(
  p_document_version_id uuid
)
returns table (
  document_id uuid,
  document_version_id uuid,
  storage_bucket text,
  storage_object_path text,
  cancelled boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reservation public.source_document_upload_reservations%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select reservation.* into strict v_reservation
  from public.source_document_upload_reservations as reservation
  where reservation.document_version_id = p_document_version_id
  for update;

  if v_reservation.status = 'FINALIZED' then
    raise exception 'FINALIZED_RESERVATION_CANNOT_BE_CANCELLED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from storage.objects as storage_object
    where storage_object.bucket_id = v_reservation.storage_bucket
      and storage_object.name = v_reservation.storage_object_path
  ) then
    raise exception 'RESUME_UPLOAD_STORAGE_OBJECT_REMAINS'
      using errcode = '55000';
  end if;

  if v_reservation.status = 'RESERVED' then
    update public.source_document_upload_reservations as reservation
    set status = case
          when reservation.expires_at <= statement_timestamp() then 'EXPIRED'
          else 'CANCELLED'
        end,
        cancelled_at = statement_timestamp()
    where reservation.id = v_reservation.id;
  end if;

  -- An empty first-upload shell is safe to remove after the exact object check.
  if not exists (
    select 1 from public.source_document_versions as version
    where version.document_id = v_reservation.document_id
  ) then
    delete from public.source_documents as document
    where document.id = v_reservation.document_id
      and document.current_version_number is null;
  end if;

  return query
  select v_reservation.document_id, v_reservation.document_version_id,
    v_reservation.storage_bucket, v_reservation.storage_object_path, true;
end;
$$;

revoke all on function public.cancel_resume_upload_reservation(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_resume_upload_reservation(uuid)
  to service_role;

comment on function public.cancel_resume_upload_reservation(uuid) is
  'Cancels an uncommitted resume upload only after its exact Storage object is absent.';
