-- Durable lane leases bound serverless concurrency and expose completion, not HTTP acceptance.
create table public.hosted_worker_lanes (
  lane text primary key check (lane in ('catalog','preparation','kit','autopilot','cleanup')),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  status text not null default 'IDLE' check (status in ('IDLE','RUNNING','SUCCEEDED','FAILED')),
  last_error_code text,
  last_summary jsonb not null default '{}'::jsonb,
  completed_runs bigint not null default 0,
  failed_runs bigint not null default 0
);
alter table public.hosted_worker_lanes enable row level security;
revoke all on public.hosted_worker_lanes from public, anon, authenticated;
grant select on public.hosted_worker_lanes to service_role;
insert into public.hosted_worker_lanes(lane) values ('catalog'),('preparation'),('kit'),('autopilot'),('cleanup');

create function public.claim_hosted_worker_lane(p_lane text, p_lease_seconds integer default 900)
returns uuid language plpgsql security definer set search_path = '' as $$
declare token uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_lease_seconds not between 30 and 900 or p_lane is null then raise exception 'HOSTED_WORKER_LEASE_INVALID'; end if;
  update public.hosted_worker_lanes set lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    status = 'RUNNING', last_started_at = now(), last_error_code = null
  where lane = p_lane and (lease_expires_at is null or lease_expires_at < now())
  returning lease_token into token;
  return token;
end; $$;

create function public.finish_hosted_worker_lane(p_lane text, p_lease_token uuid, p_summary jsonb, p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' or octet_length(p_summary::text) > 2048
    or exists(select 1 from jsonb_each(p_summary) as entry where jsonb_typeof(entry.value) not in ('number','boolean'))
    or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{2,119}$')
    then raise exception 'HOSTED_WORKER_RESULT_INVALID'; end if;
  update public.hosted_worker_lanes set lease_token = null, lease_expires_at = null,
    status = case when p_error_code is null then 'SUCCEEDED' else 'FAILED' end,
    last_finished_at = now(), last_summary = p_summary, last_error_code = p_error_code,
    completed_runs = completed_runs + case when p_error_code is null then 1 else 0 end,
    failed_runs = failed_runs + case when p_error_code is null then 0 else 1 end
  where lane = p_lane and lease_token = p_lease_token and lease_expires_at > now();
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;

revoke all on function public.claim_hosted_worker_lane(text,integer) from public,anon,authenticated;
revoke all on function public.finish_hosted_worker_lane(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_hosted_worker_lane(text,integer) to service_role;
grant execute on function public.finish_hosted_worker_lane(text,uuid,jsonb,text) to service_role;

create function public.hosted_worker_due_lanes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select coalesce(jsonb_agg(l.lane order by l.lane),'[]'::jsonb) into result
  from public.hosted_worker_lanes l
  where (l.lease_expires_at is null or l.lease_expires_at < now()) and (
    (l.lane = 'catalog' and (l.last_started_at is null or l.last_started_at < now() - interval '15 minutes'))
    or (l.lane = 'cleanup' and (l.last_started_at is null or l.last_started_at < now() - interval '5 minutes'))
    or (l.lane in ('preparation','kit') and exists (
      select 1 from public.outbox o where o.published_at is null and o.dead_lettered_at is null
        and o.available_at <= now() and (o.lease_expires_at is null or o.lease_expires_at <= now())
        and ((l.lane='kit' and o.topic='application.drafting_requested')
          or (l.lane='preparation' and o.topic in ('application.queued','application.job_resolved','application.preparation_requested')))
    ))
    or (l.lane='autopilot' and exists (
      select 1 from public.application_autopilots a where a.available_at <= now()
        and (a.lease_expires_at is null or a.lease_expires_at <= now())
        and ((a.status in ('QUEUED','RUNNING') and a.attempt_id is null and a.stop_requested is null and a.expires_at > now())
          or (a.status in ('SUBMITTING','UNCERTAIN','RECONCILING') and a.attempt_id is not null and a.reconcile_count < 3))
    ))
  );
  return result;
end; $$;
revoke all on function public.hosted_worker_due_lanes() from public,anon,authenticated;
grant execute on function public.hosted_worker_due_lanes() to service_role;
