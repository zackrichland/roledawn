-- The minute dispatcher only wakes due candidates; account and submission leases
-- still enforce candidate ownership, consent freshness and the actual send rate.
alter table public.hosted_worker_lanes drop constraint hosted_worker_lanes_lane_check;
alter table public.hosted_worker_lanes add constraint hosted_worker_lanes_lane_check
  check (lane in ('catalog','preparation','kit','auto-apply','autopilot','cleanup'));
insert into public.hosted_worker_lanes(lane) values ('auto-apply') on conflict do nothing;

create or replace function public.hosted_worker_due_lanes() returns jsonb
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
    or (l.lane='auto-apply' and exists (
      select 1 from public.candidate_auto_apply_settings s
      join private.auto_apply_runtime r on r.candidate_id=s.candidate_id
      where s.enabled and s.next_check_at <= now()
        and (r.lease_expires_at is null or r.lease_expires_at <= now())
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
