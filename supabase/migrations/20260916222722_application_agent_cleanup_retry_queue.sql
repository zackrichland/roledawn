-- Claimed cleanup work yields to other runs while a provider failure backs off.
-- Five minutes exceeds one bounded batch (20 deletions, ten seconds each).
alter table public.application_agent_runs add column provider_cleanup_next_attempt_at
  timestamptz not null default now();

create index application_agent_runs_cleanup_due_idx
  on public.application_agent_runs(provider_cleanup_next_attempt_at,completed_at,id)
  where status in ('COMPLETED','FAILED') and provider_session_id is not null
    and provider_deleted_at is null;

create function public.claim_application_agent_cleanup(p_limit integer default 20)
returns table(id uuid,provider_session_id text,status text,failure_code text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'APPLICATION_AGENT_CLEANUP_LIMIT_INVALID' using errcode='22023'; end if;
  return query
  with due as (
    select agent_run.id from public.application_agent_runs agent_run
    where agent_run.status in ('COMPLETED','FAILED')
      and agent_run.provider_session_id is not null and agent_run.provider_deleted_at is null
      and agent_run.provider_cleanup_next_attempt_at <= statement_timestamp()
    order by agent_run.provider_cleanup_next_attempt_at,agent_run.completed_at,agent_run.id
    limit p_limit for update of agent_run skip locked
  )
  update public.application_agent_runs agent_run
    set provider_cleanup_next_attempt_at=statement_timestamp()+interval '5 minutes'
  from due where agent_run.id=due.id
  returning agent_run.id,agent_run.provider_session_id,agent_run.status,agent_run.failure_code;
end; $$;

revoke all on function public.claim_application_agent_cleanup(integer) from public,anon,authenticated;
grant execute on function public.claim_application_agent_cleanup(integer) to service_role;
