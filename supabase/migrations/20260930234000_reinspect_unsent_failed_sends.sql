-- D-145: reinspect every unsent failed form under the existing candidate/input/retry guards.
create or replace function private.control_application_autopilot(p_command_id uuid,p_id uuid,p_expected_version bigint,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_existing public.command_dedup%rowtype; v_hash text; v_result jsonb; v_status text;
begin
  v_row:=private.assert_autopilot_candidate(p_id);
  if p_command_id is null or p_expected_version is null or p_action is null or p_action not in ('PAUSE','RESUME','CANCEL') then
    raise exception 'APPLICATION_AUTOPILOT_CONTROL_INVALID' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_id,p_expected_version,p_action)::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_row.workspace_id::text||':'||p_command_id::text,0));
  select * into v_existing from public.command_dedup where workspace_id=v_row.workspace_id and command_id=p_command_id;
  if found then
    if v_existing.command_type<>'CONTROL_APPLICATION_AUTOPILOT' or v_existing.actor_id<>auth.uid() or v_existing.request_hash<>v_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode='23505'; end if;
    return v_existing.result||'{"replayed":true}'::jsonb;
  end if;
  if v_row.version<>p_expected_version or v_row.status in ('CONFIRMED','CANCELED') or (v_row.status='FAILED_SAFE' and p_action<>'RESUME') then raise exception 'APPLICATION_AUTOPILOT_CONTROL_STALE' using errcode='PT409'; end if;
  if p_action='RESUME' then
    if v_row.attempt_id is not null or v_row.status not in ('PAUSED','FAILED_SAFE') or v_row.expires_at<=statement_timestamp()
      or not exists(select 1 from public.applications a
        join public.application_revisions r on r.id=a.current_revision_id and r.application_id=a.id and r.packet_hash=v_row.packet_hash and r.validation_status='PASSED'
        join public.application_input_snapshots s on s.id=r.input_snapshot_id
        join public.candidates c on c.id=a.candidate_id and c.application_input_version=s.candidate_input_version
        where a.id=v_row.application_id and r.id=v_row.revision_id)
      or exists(select 1 from public.application_attempts where application_id=v_row.application_id and status<>'NOT_ACCEPTED') then
      raise exception 'APPLICATION_AUTOPILOT_RESUME_DENIED' using errcode='55000'; end if;
    -- A failed send needs a fresh inspection: prior OPEN descriptors can be
    -- obsolete or already resolved on that form. They never supply answers
    -- or submit authority. Ordinary missing-answer pauses keep their questions.
    v_status:=case when
      v_row.status='FAILED_SAFE'
      or (v_row.status='PAUSED' and exists(select 1 from private.application_autopilot_runtime where autopilot_id=p_id
        and checkpoint->>'stage' in ('BROWSER_VERIFICATION','BROWSER_VERIFICATION_CLOSED')))
      then 'QUEUED'
      when exists(select 1 from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN') then 'WAITING_ANSWERS' else 'QUEUED' end;
  else v_status:=case when v_row.attempt_id is not null then 'UNCERTAIN' when p_action='CANCEL' then 'CANCELED' else 'PAUSED' end; end if;
  update public.application_autopilots set status=v_status,stop_requested=case when p_action='RESUME' then null else p_action end,
    sealed_diff=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else sealed_diff end,
    sealed_diff_hash=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else sealed_diff_hash end,
    readback_hash=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else readback_hash end,
    request_fingerprint=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else request_fingerprint end,
    failure_code=case when p_action='RESUME' then null else failure_code end,
    lease_token=null,lease_owner=null,lease_expires_at=null,version=version+1,available_at=statement_timestamp(),updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_controlled',case when v_status='UNCERTAIN' then 'RECONCILING' when v_status='CANCELED' then 'CANCELED' when v_status='QUEUED' then 'EXECUTING' else 'TAKEOVER' end);
  v_result:=jsonb_build_object('id',p_id,'version',v_row.version+1,'status',v_status,'replayed',false);
  insert into public.command_dedup(workspace_id,command_id,actor_id,command_type,request_hash,status,aggregate_type,aggregate_id,result,completed_at)
    values(v_row.workspace_id,p_command_id,auth.uid(),'CONTROL_APPLICATION_AUTOPILOT',v_hash,'COMMITTED','APPLICATION',v_row.application_id,v_result,statement_timestamp());
  return v_result;
end; $$;
