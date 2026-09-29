-- Synthetic fixtures only. Execute the whole file together; every row rolls back.
begin;
do $$
declare
  v_actor uuid:=extensions.gen_random_uuid(); v_other uuid:=extensions.gen_random_uuid();
  v_workspace uuid:=extensions.gen_random_uuid(); v_candidate uuid:=extensions.gen_random_uuid();
  v_command uuid:=extensions.gen_random_uuid(); v_result jsonb; v_replay jsonb;
  v_version uuid; v_second uuid; v_path text; v_final record; v_found boolean;
begin
  insert into auth.users(id) values(v_actor),(v_other);
  insert into public.workspaces(id,name,kind,personal_owner_auth_user_id)
    values(v_workspace,'Synthetic Direct Upload Acceptance','PERSONAL',v_actor);
  insert into public.candidates(id,workspace_id,auth_user_id,display_name)
    values(v_candidate,v_workspace,v_actor,'Synthetic Upload Candidate');
  insert into public.workspace_memberships(workspace_id,auth_user_id,role)
    values(v_workspace,v_actor,'OWNER');
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  set local role authenticated;
  v_result:=public.reserve_direct_resume_upload(v_command,'synthetic.pdf','application/pdf',7000000,repeat('a',64));
  v_replay:=public.reserve_direct_resume_upload(v_command,'synthetic.pdf','application/pdf',7000000,repeat('a',64));
  if v_result<>v_replay then raise exception 'DIRECT_RESERVATION_REPLAY_CHANGED'; end if;
  v_version:=(v_result->>'document_version_id')::uuid; v_path:=v_result->>'storage_object_path';
  if (select expected_sha256 from public.source_document_upload_reservations where document_version_id=v_version)<>repeat('a',64) then
    raise exception 'DIRECT_RESERVATION_HASH_NOT_BOUND'; end if;
  begin
    perform public.reserve_direct_resume_upload(v_command,'synthetic.pdf','application/pdf',7000000,repeat('b',64));
    raise exception 'DIRECT_RESERVATION_HASH_REPLAY_ALLOWED';
  exception when unique_violation then null; end;
  begin
    perform public.reserve_direct_resume_upload(extensions.gen_random_uuid(),'large.pdf','application/pdf',10485761,repeat('a',64));
    raise exception 'DIRECT_OVERSIZED_RESERVATION_ALLOWED';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub',v_other::text,true);
  if exists(select 1 from public.source_document_upload_reservations where document_version_id=v_version) then
    raise exception 'DIRECT_CROSS_TENANT_RESERVATION_VISIBLE'; end if;
  begin
    insert into storage.objects(bucket_id,name,owner_id,metadata)
      values('career-vault',v_path,v_other::text,'{"size":7000000,"mimetype":"application/pdf"}');
    raise exception 'DIRECT_CROSS_TENANT_INSERT_ALLOWED';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  insert into storage.objects(bucket_id,name,owner_id,metadata)
    values('career-vault',v_path,v_actor::text,'{"size":7000000,"mimetype":"application/pdf"}');
  -- Candidate writes can insert this path once, but cannot overwrite the bytes.
  update storage.objects set metadata='{"size":1}' where bucket_id='career-vault' and name=v_path;
  if found then raise exception 'DIRECT_CANDIDATE_OVERWRITE_ALLOWED'; end if;
  set local role service_role;
  begin
    update public.source_document_upload_reservations set expected_sha256=repeat('b',64) where document_version_id=v_version;
    raise exception 'DIRECT_BOUND_HASH_MUTATED';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.finalize_resume_upload(v_actor,v_version,v_version,repeat('b',64),7000000);
    raise exception 'DIRECT_WRONG_HASH_FINALIZED';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.finalize_resume_upload(v_other,v_version,v_version,repeat('a',64),7000000);
    raise exception 'DIRECT_WRONG_ACTOR_FINALIZED';
  exception when no_data_found then null; end;
  select * into strict v_final from public.finalize_resume_upload(v_actor,v_version,v_version,repeat('a',64),7000000);
  if v_final.replayed then raise exception 'DIRECT_FIRST_FINALIZATION_REPLAYED'; end if;
  select * into strict v_final from public.finalize_resume_upload(v_actor,v_version,v_version,repeat('a',64),7000000);
  if not v_final.replayed then raise exception 'DIRECT_FINALIZATION_REPLAY_NOT_IDEMPOTENT'; end if;
  if public.reject_direct_resume_upload(v_actor,v_version,repeat('a',64)) then raise exception 'DIRECT_FINALIZED_BYTES_MARKED_FOR_DELETION'; end if;
  set local role authenticated;
  v_result:=public.reserve_direct_resume_upload(extensions.gen_random_uuid(),'second.pdf','application/pdf',8,repeat('c',64));
  v_second:=(v_result->>'document_version_id')::uuid; v_path:=v_result->>'storage_object_path';
  set local role service_role;
  begin
    perform public.finalize_resume_upload(v_actor,v_second,v_second,repeat('c',64),8);
    raise exception 'DIRECT_MISSING_OBJECT_FINALIZED';
  exception when object_not_in_prerequisite_state then null; end;
  set local role authenticated;
  insert into storage.objects(bucket_id,name,owner_id,metadata)
    values('career-vault',v_path,v_actor::text,'{"size":8,"mimetype":"application/pdf"}');
  set local role service_role;
  if not public.reject_direct_resume_upload(v_actor,v_second,repeat('c',64)) then raise exception 'DIRECT_REJECTION_NOT_CANCELLED'; end if;
  if (select status from public.source_document_upload_reservations where document_version_id=v_second)<>'CANCELLED' then
    raise exception 'DIRECT_REJECTION_NOT_DURABLE'; end if;
  select exists(select 1 from public.list_expired_resume_upload_reservations(500) where document_version_id=v_second) into v_found;
  if not v_found then raise exception 'DIRECT_FAILED_DELETION_NOT_DISCOVERABLE'; end if;
  begin
    perform public.finalize_resume_upload(v_actor,v_second,v_second,repeat('c',64),8);
    raise exception 'DIRECT_CANCELLED_UPLOAD_FINALIZED';
  exception when object_not_in_prerequisite_state then null; end;
  -- Supabase forbids SQL object deletion. Move only this synthetic metadata row
  -- inside the rollback transaction to exercise absence without touching bytes.
  update storage.objects set name=v_path||'.rollback-fixture' where bucket_id='career-vault' and name=v_path;
  perform public.cancel_resume_upload_reservation(v_second);
  set local role authenticated;
  begin
    insert into storage.objects(bucket_id,name,owner_id,metadata)
      values('career-vault',v_path,v_actor::text,'{"size":8,"mimetype":"application/pdf"}');
    raise exception 'DIRECT_CANCELLED_PATH_RECREATED';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.reserve_direct_resume_upload(uuid,text,text,bigint,text)','EXECUTE')
    or has_function_privilege('authenticated','public.reject_direct_resume_upload(uuid,uuid,text)','EXECUTE') then
    raise exception 'DIRECT_UPLOAD_PRIVILEGES_UNSAFE'; end if;
  reset role;
  raise notice 'Direct upload SQL acceptance passed: bound hash/replay, size, tenant RLS, insert-only object, hash immutability, finalize hash/actor/missing/replay, cancellation before deletion, recovery, cancelled-path denial, grants';
end; $$;
rollback;
