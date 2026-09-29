-- Reserve deletion and detach reusable references in the same transaction.
-- A reclaimed worker must never reconnect to a provider session being deleted.
create or replace function public.claim_application_autopilot_cleanup(p_limit integer default 20)
returns setof private.application_autopilot_resources language plpgsql security definer set search_path='' as $$
declare v_resource private.application_autopilot_resources%rowtype;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'APPLICATION_AUTOPILOT_CLEANUP_INVALID' using errcode='22023'; end if;
  for v_resource in
    select r.* from private.application_autopilot_resources r join public.application_autopilots a on a.id=r.autopilot_id
    where r.deleted_at is null and r.cleanup_after<=statement_timestamp()
      and (a.lease_expires_at is null or a.lease_expires_at<=statement_timestamp()
        or a.status in ('WAITING_ANSWERS','PAUSED','CANCELED','CONFIRMED','FAILED_SAFE'))
    order by r.cleanup_after,r.id for update of a,r skip locked limit p_limit
  loop
    update private.application_autopilot_resources set cleanup_after=statement_timestamp()+interval '5 minutes' where id=v_resource.id;
    if v_resource.kind='BROWSER' then
      update private.application_autopilot_runtime set runtime_reference=null,runtime_lease=null,
        checkpoint=checkpoint||'{"runtimeState":"RELEASED"}'::jsonb
        where autopilot_id=v_resource.autopilot_id and runtime_reference=v_resource.reference;
    else
      update private.application_autopilot_runtime set agent_session_id=null,agent_session_lease=null
        where autopilot_id=v_resource.autopilot_id and agent_session_id=v_resource.reference;
    end if;
    return next v_resource;
  end loop;
end; $$;
revoke all on function public.claim_application_autopilot_cleanup(integer) from public,anon,authenticated;
grant execute on function public.claim_application_autopilot_cleanup(integer) to service_role;
