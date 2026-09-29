-- Exact-target wakeups and isolated acceptance must not claim unrelated work.
create function private.claim_application_autopilot_scoped(p_worker_id text,p_lease_seconds integer,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_runtime private.application_autopilot_runtime%rowtype;
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 120 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    raise exception 'APPLICATION_AUTOPILOT_CLAIM_INVALID' using errcode='22023'; end if;
  select a.* into v_row from public.application_autopilots a where (p_target_id is null or a.id=p_target_id) and a.available_at<=statement_timestamp()
    and (a.lease_expires_at is null or a.lease_expires_at<=statement_timestamp())
    and ((a.status in ('QUEUED','RUNNING') and a.attempt_id is null and a.stop_requested is null and a.expires_at>statement_timestamp())
      or (a.status in ('SUBMITTING','UNCERTAIN','RECONCILING') and a.attempt_id is not null and a.reconcile_count<3))
    order by a.available_at,a.created_at,a.id for update skip locked limit 1;
  if not found then return null; end if;
  update public.application_autopilots set status=case when attempt_id is null then 'RUNNING' else 'RECONCILING' end,
    lease_token=extensions.gen_random_uuid(),lease_owner=p_worker_id,lease_expires_at=statement_timestamp()+make_interval(secs=>p_lease_seconds),
    reconcile_count=reconcile_count+case when attempt_id is null then 0 else 1 end,version=version+1,updated_at=statement_timestamp()
    where id=v_row.id returning * into v_row;
  -- Never reopen the submit permission on recovery. A prior attempt only permits observation.
  select * into strict v_runtime from private.application_autopilot_runtime where autopilot_id=v_row.id;
  return jsonb_build_object('id',v_row.id,'workspace_id',v_row.workspace_id,'candidate_id',v_row.candidate_id,'application_id',v_row.application_id,
    'revision_id',v_row.revision_id,'packet_hash',v_row.packet_hash,'destination_url',v_row.destination_url,'artifact_manifest',v_row.artifact_manifest,
    'disclosure_manifest',v_row.disclosure_manifest,'status',v_row.status,'mode',case when v_row.attempt_id is null then 'FILL' else 'RECONCILE' end,
    'lease_token',v_row.lease_token,'lease_expires_at',v_row.lease_expires_at,'checkpoint',v_runtime.checkpoint,
    'runtime_reference',v_runtime.runtime_reference,'attempt_id',v_row.attempt_id,'sealed_diff_hash',v_row.sealed_diff_hash);
end; $$;

-- Existing two-argument callers retain the global queue. The explicit overload
-- requires one target and applies the same availability, lease and recovery rules.
create or replace function public.claim_application_autopilot(p_worker_id text,p_lease_seconds integer default 300)
returns jsonb language sql security definer set search_path='' as $$
  select private.claim_application_autopilot_scoped(p_worker_id,p_lease_seconds,null);
$$;
create function public.claim_application_autopilot(p_worker_id text,p_lease_seconds integer,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_target_id is null then raise exception 'APPLICATION_AUTOPILOT_TARGET_REQUIRED' using errcode='22023'; end if;
  return private.claim_application_autopilot_scoped(p_worker_id,p_lease_seconds,p_target_id);
end; $$;
revoke all on function private.claim_application_autopilot_scoped(text,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_application_autopilot(text,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_application_autopilot(text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_application_autopilot(text,integer) to service_role;
grant execute on function public.claim_application_autopilot(text,integer,uuid) to service_role;
