-- Bind browser-to-Storage uploads to exact selected bytes. The existing private
-- bucket, authenticated insert policy and one-hour reservation remain in force.
alter table public.source_document_upload_reservations
  add column expected_sha256 text check(expected_sha256 ~ '^[0-9a-f]{64}$');

create function public.reserve_direct_resume_upload(p_command_id uuid,p_display_name text,p_mime_type text,p_byte_size bigint,p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result record; v_reservation public.source_document_upload_reservations%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'RESUME_UPLOAD_HASH_INVALID' using errcode='22023'; end if;
  select * into strict v_result from public.reserve_resume_upload(p_command_id,p_display_name,p_mime_type,p_byte_size);
  select * into strict v_reservation from public.source_document_upload_reservations r
  where r.document_version_id=v_result.document_version_id and r.reserved_by=auth.uid() for update;
  if v_reservation.expected_sha256 is not null and v_reservation.expected_sha256<>p_sha256 then
    raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode='23505'; end if;
  if v_reservation.status not in ('RESERVED','FINALIZED') or (v_reservation.status='RESERVED' and v_reservation.expires_at<=statement_timestamp()) then
    raise exception 'RESUME_UPLOAD_NOT_FINALIZABLE' using errcode='55000'; end if;
  if v_reservation.expected_sha256 is null then
    if v_reservation.status<>'RESERVED' then raise exception 'RESUME_UPLOAD_NOT_FINALIZABLE' using errcode='55000'; end if;
    update public.source_document_upload_reservations set expected_sha256=p_sha256 where id=v_reservation.id;
  end if;
  return jsonb_build_object('document_version_id',v_reservation.document_version_id,'storage_bucket',v_reservation.storage_bucket,
    'storage_object_path',v_reservation.storage_object_path,'mime_type',v_reservation.mime_type,'status',v_reservation.status);
end; $$;
revoke all on function public.reserve_direct_resume_upload(uuid,text,text,bigint,text) from public,anon;
grant execute on function public.reserve_direct_resume_upload(uuid,text,text,bigint,text) to authenticated;

create function private.preserve_resume_upload_hash() returns trigger language plpgsql set search_path='' as $$
begin
  if old.expected_sha256 is not null and new.expected_sha256 is distinct from old.expected_sha256 then
    raise exception 'RESUME_UPLOAD_HASH_IMMUTABLE' using errcode='55000'; end if;
  return new;
end; $$;
create trigger resume_upload_hash_immutable before update on public.source_document_upload_reservations
for each row execute function private.preserve_resume_upload_hash();

do $$
declare v_definition text:=pg_get_functiondef('public.finalize_resume_upload(uuid,uuid,uuid,text,bigint)'::regprocedure);
  v_old text:='or v_reservation.expected_byte_size <> p_byte_size';
begin
  if position(v_old in v_definition)=0 then raise exception 'EXPECTED_RESUME_FINALIZATION_GUARD_MISSING'; end if;
  execute replace(v_definition,v_old,v_old||E'\n     or (v_reservation.expected_sha256 is not null and v_reservation.expected_sha256 is distinct from p_sha256)');
end; $$;

-- Cancel before Storage removal, closing the cleanup/finalization race.
create function public.reject_direct_resume_upload(p_actor_id uuid,p_document_version_id uuid,p_expected_sha256 text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_reservation public.source_document_upload_reservations%rowtype;
begin
  if current_user<>'service_role' or p_actor_id is null then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  select r.* into strict v_reservation from public.source_document_upload_reservations r
  join public.candidates c on c.id=r.candidate_id and c.workspace_id=r.workspace_id and c.auth_user_id=p_actor_id
  where r.document_version_id=p_document_version_id and r.reserved_by=p_actor_id for update of r;
  if v_reservation.expected_sha256 is null or v_reservation.expected_sha256 is distinct from p_expected_sha256 then
    raise exception 'RESUME_UPLOAD_HASH_MISMATCH' using errcode='55000'; end if;
  if v_reservation.status='FINALIZED' then return false; end if;
  if v_reservation.status='RESERVED' then
    update public.source_document_upload_reservations set status='CANCELLED',cancelled_at=statement_timestamp() where id=v_reservation.id;
  end if;
  return true;
end; $$;
revoke all on function public.reject_direct_resume_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reject_direct_resume_upload(uuid,uuid,text) to service_role;

-- Failed provider deletion must not strand cancelled private files forever.
do $$
declare v_definition text:=pg_get_functiondef('public.list_expired_resume_upload_reservations(integer)'::regprocedure);
  v_old text:='reservation.status = ''EXPIRED''';
begin
  if position(v_old in v_definition)=0 then raise exception 'EXPECTED_RESUME_CLEANUP_GUARD_MISSING'; end if;
  execute replace(v_definition,v_old,'reservation.status in (''EXPIRED'', ''CANCELLED'')');
end; $$;
