-- Worker events: why and how long, for every lane failure and every send (D-116).
--
-- Lane results kept only a summary code (HOSTED_WORKER_ITEMS_FAILED), outbox
-- errors were cleared on the next success, and unknown send errors collapsed to
-- APPLICATION_DELIVERY_FAILED, so the cause of a stop was often lost. Workers now
-- append one row per notable event: the stage, the outcome, a stable code, a short
-- sanitized detail (error class and message, never form values or candidate
-- data), and the duration. Rows older than 30 days are pruned as new ones arrive.
-- Autopilot domain events also carry the send's failure code.

create table private.worker_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  lane text not null check (lane ~ '^[a-z][a-z-]{1,39}$'),
  stage text not null check (char_length(stage) between 1 and 80),
  outcome text not null check (outcome in ('OK', 'FAILED', 'SKIPPED', 'INFO')),
  code text check (code is null or code ~ '^[A-Z][A-Z0-9_]{2,119}$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  application_id uuid,
  autopilot_id uuid
);
create index worker_events_recent on private.worker_events (occurred_at desc);
create index worker_events_application on private.worker_events (application_id, occurred_at) where application_id is not null;
alter table private.worker_events enable row level security;
revoke all on table private.worker_events from public, anon, authenticated, service_role;

create or replace function public.record_worker_event(
  p_lane text, p_stage text, p_outcome text, p_code text default null, p_detail jsonb default '{}'::jsonb,
  p_duration_ms integer default null, p_application_id uuid default null, p_autopilot_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.worker_events(lane, stage, outcome, code, detail, duration_ms, application_id, autopilot_id)
    values (p_lane, p_stage, p_outcome, p_code, coalesce(p_detail, '{}'::jsonb), p_duration_ms, p_application_id, p_autopilot_id);
  -- Bounded, cheap retention: about one prune per hundred events.
  if random() < 0.01 then
    delete from private.worker_events where occurred_at < now() - interval '30 days';
  end if;
end; $$;
revoke all on function public.record_worker_event(text, text, text, text, jsonb, integer, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_worker_event(text, text, text, text, jsonb, integer, uuid, uuid) to service_role;

-- Autopilot domain events now say why a send stopped.
create or replace function private.autopilot_event(p_id uuid,p_event text,p_application_status text)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_version bigint;
begin
  select * into strict v_row from public.application_autopilots where id=p_id;
  update public.applications a set status=p_application_status,aggregate_version=a.aggregate_version+1,updated_at=statement_timestamp()
    where a.id=v_row.application_id returning a.aggregate_version into v_version;
  insert into public.domain_events(id,workspace_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,actor_kind,correlation_id)
    values(extensions.gen_random_uuid(),v_row.workspace_id,'APPLICATION',v_row.application_id,v_version,p_event,
      jsonb_build_object('autopilot_id',p_id,'revision_id',v_row.revision_id,'status',v_row.status,'failure_code',v_row.failure_code),'SYSTEM',p_id);
end; $$;
