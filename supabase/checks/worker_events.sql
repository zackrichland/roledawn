-- Local PGlite check for 20260930030000_worker_events.sql.
--   node scripts/migration-harness.mjs supabase/checks/worker_events.sql
begin;
create temporary table worker_event_checks(check_name text primary key, passed boolean not null) on commit drop;

do $check$
declare v_count integer;
begin
  execute 'set local role service_role';
  perform public.record_worker_event('autopilot', 'finish', 'FAILED', 'OPENAI_AGENTS_ABORTED', '{"error":"OpenAIAgentsError"}'::jsonb, 181000, gen_random_uuid(), gen_random_uuid());
  execute 'reset role';
  select count(*) into v_count from private.worker_events where lane = 'autopilot' and code = 'OPENAI_AGENTS_ABORTED' and duration_ms = 181000;
  if v_count <> 1 then raise exception 'CHECK_EVENT_NOT_RECORDED'; end if;
  insert into worker_event_checks values ('workers_can_record_events', true);

  begin
    execute 'set local role service_role';
    perform public.record_worker_event('Autopilot!', 'finish', 'FAILED');
    raise exception 'CHECK_BAD_LANE_ACCEPTED';
  exception when check_violation then execute 'reset role'; end;
  begin
    execute 'set local role service_role';
    perform public.record_worker_event('autopilot', 'finish', 'FAILED', null, jsonb_build_object('detail', repeat('x', 5000)));
    raise exception 'CHECK_OVERSIZED_DETAIL_ACCEPTED';
  exception when check_violation then execute 'reset role'; end;
  insert into worker_event_checks values ('malformed_or_oversized_events_are_refused', true);

  execute 'set local role authenticated';
  begin
    perform public.record_worker_event('autopilot', 'finish', 'OK');
    raise exception 'CHECK_CANDIDATE_RECORDED_EVENT';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from private.worker_events;
    raise exception 'CHECK_CANDIDATE_READ_EVENTS';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  insert into worker_event_checks values ('candidates_cannot_read_or_write_events', true);
end $check$;

select check_name, passed from worker_event_checks order by check_name;
rollback;
