-- Record why a send request could not start (D-149).
--
-- delegate_ready_send_intents leaves an intent open when delegation raises
-- (most often APPLICATION_AUTOPILOT_REVISION_INVALID after a profile edit, or
-- APPLICATION_AUTOPILOT_REVIEW_STALE when the application already has an
-- attempt). The exception was swallowed, so Home showed "Queued to apply"
-- with no recorded cause. The function is unchanged except that the handler
-- now appends one private worker event per application and code per hour.
-- Nothing is sent, closed or retried differently.

create or replace function public.delegate_ready_send_intents(p_application_id uuid default null, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.application_send_intents%rowtype;
  v_application public.applications%rowtype;
  v_revision public.application_revisions%rowtype;
  v_delegated integer := 0;
  v_closed integer := 0;
  v_code text;
  v_state text;
begin
  if (select auth.role()) is distinct from 'service_role' and current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  for v_intent in
    select intent.* from public.application_send_intents as intent
    where intent.closed_at is null and (p_application_id is null or intent.application_id = p_application_id)
    order by intent.created_at, intent.application_id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  loop
    select app.* into v_application from public.applications as app where app.id = v_intent.application_id for update;
    if not found or v_application.status in ('CONFIRMED', 'CANCELED', 'SKIPPED') then
      update public.application_send_intents set closed_at = statement_timestamp(), close_reason = 'APPLICATION_CLOSED'
      where application_id = v_intent.application_id;
      v_closed := v_closed + 1;
      continue;
    end if;
    if exists (select 1 from public.application_autopilots where application_id = v_application.id) then
      update public.application_send_intents set closed_at = statement_timestamp(), close_reason = 'DELEGATED'
      where application_id = v_intent.application_id;
      v_closed := v_closed + 1;
      continue;
    end if;
    continue when v_application.status <> 'READY' or v_application.current_revision_id is null;
    if not private.is_supported_autopilot_destination((select version.apply_url from public.job_versions as version where version.id = v_application.job_version_id)) then
      update public.application_send_intents set closed_at = statement_timestamp(), close_reason = 'NOT_DELIVERABLE'
      where application_id = v_intent.application_id;
      v_closed := v_closed + 1;
      continue;
    end if;
    select revision.* into strict v_revision from public.application_revisions as revision
    where revision.id = v_application.current_revision_id and revision.application_id = v_application.id;
    begin
      perform private.delegate_auto_apply_as_candidate(v_intent.delegate_command_id, v_application.id,
        v_application.aggregate_version, v_revision.id, v_revision.packet_hash, v_intent.requested_by);
      update public.application_send_intents set closed_at = statement_timestamp(), close_reason = 'DELEGATED'
      where application_id = v_intent.application_id;
      v_delegated := v_delegated + 1;
    exception when others then
      -- Leave the intent open; the next sweep retries. Nothing was sent.
      -- Record why, at most hourly per application and code, so a send that
      -- never starts is visible instead of a silent "Queued to apply" (D-149).
      v_code := case when sqlerrm ~ '^[A-Z][A-Z0-9_]{2,119}$' then sqlerrm else 'SEND_INTENT_DELEGATION_FAILED' end;
      v_state := sqlstate;
      begin
        if not exists (select 1 from private.worker_events as event
            where event.application_id = v_intent.application_id and event.stage = 'send-intent'
              and event.code = v_code and event.occurred_at > statement_timestamp() - interval '1 hour') then
          insert into private.worker_events(lane, stage, outcome, code, detail, application_id)
            values ('cleanup', 'send-intent', 'FAILED', v_code, jsonb_build_object('sqlstate', v_state), v_intent.application_id);
        end if;
      exception when others then
        null; -- Observability never stops the sweep.
      end;
    end;
  end loop;
  return jsonb_build_object('delegated', v_delegated, 'closed', v_closed);
end;
$$;
revoke all on function public.delegate_ready_send_intents(uuid, integer) from public, anon, authenticated;
grant execute on function public.delegate_ready_send_intents(uuid, integer) to service_role;
