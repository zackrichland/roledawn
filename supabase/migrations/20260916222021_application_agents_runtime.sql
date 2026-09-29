-- Managed Agents API runs are execution records, never candidate authority.
-- Provider IDs and tool results are service-only. A claimed but unfinished
-- tool call is uncertain and must not be executed a second time.
create table public.application_agent_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  application_id uuid not null,
  revision_id uuid not null,
  fill_attempt_id uuid not null,
  computer_session_id uuid not null,
  provider_session_id text unique check (provider_session_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  model text not null check (char_length(model) between 1 and 120),
  driver_release text not null check (char_length(driver_release) between 1 and 120),
  status text not null default 'STARTING' check (status in ('STARTING','RUNNING','COMPLETED','FAILED')),
  failure_code text check (failure_code ~ '^[A-Z][A-Z0-9_]{2,119}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  provider_deleted_at timestamptz,
  foreign key (workspace_id,computer_session_id)
    references public.computer_sessions(workspace_id,id) on delete cascade,
  foreign key (workspace_id,candidate_id,application_id,fill_attempt_id)
    references public.application_fill_attempts(workspace_id,candidate_id,application_id,id) on delete cascade,
  foreign key (workspace_id,application_id,revision_id,fill_attempt_id)
    references public.application_fill_attempts(workspace_id,application_id,revision_id,id) on delete restrict,
  check ((status in ('STARTING','RUNNING') and completed_at is null)
    or (status in ('COMPLETED','FAILED') and completed_at is not null)),
  check (status <> 'RUNNING' or provider_session_id is not null),
  check (status <> 'COMPLETED' or failure_code is null),
  check (provider_deleted_at is null or (provider_session_id is not null and completed_at is not null))
);
create unique index application_agent_runs_one_active_idx on public.application_agent_runs(computer_session_id)
  where status in ('STARTING','RUNNING');
create index application_agent_runs_fill_binding_idx on public.application_agent_runs(workspace_id,candidate_id,application_id,fill_attempt_id);
create index application_agent_runs_revision_binding_idx on public.application_agent_runs(workspace_id,application_id,revision_id,fill_attempt_id);
create index application_agent_runs_computer_idx on public.application_agent_runs(workspace_id,computer_session_id);
create index application_agent_runs_cleanup_idx on public.application_agent_runs(completed_at,id)
  where provider_session_id is not null and provider_deleted_at is null;

create table public.application_agent_tool_calls (
  run_id uuid not null references public.application_agent_runs(id) on delete cascade,
  turn_id text not null check (turn_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  call_id text not null check (call_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  tool_name text not null check (tool_name ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  arguments_hash text not null check (arguments_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'STARTED' check (status in ('STARTED','COMPLETED')),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 262144)),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (run_id,turn_id,call_id),
  check ((status = 'STARTED' and result is null and completed_at is null)
    or (status = 'COMPLETED' and result is not null and completed_at is not null))
);
alter table public.application_agent_runs enable row level security;
alter table public.application_agent_tool_calls enable row level security;
revoke all on public.application_agent_runs, public.application_agent_tool_calls from public, anon, authenticated, service_role;
grant select on public.application_agent_runs, public.application_agent_tool_calls to service_role;

create function private.assert_application_agent_binding(p_run_id uuid)
returns public.application_agent_runs language plpgsql security definer set search_path = '' as $$
declare v_run public.application_agent_runs%rowtype;
begin
  select * into strict v_run from public.application_agent_runs where id = p_run_id for update;
  if v_run.status not in ('STARTING','RUNNING') or not exists (
    select 1 from public.computer_sessions s
    join public.application_fill_attempts f on f.id = s.fill_attempt_id
    join public.applications a on a.id = f.application_id
    join public.candidates c on c.id = a.candidate_id and c.workspace_id = a.workspace_id
    join public.workspaces w on w.id = a.workspace_id
    join public.approval_consumptions ac on ac.id = f.approval_consumption_id
      and ac.workspace_id = f.workspace_id and ac.application_id = f.application_id
      and ac.revision_id = f.revision_id and ac.permitted_action = 'FILL_APPLICATION_ONCE'
    join public.approval_challenges approval on approval.id = ac.approval_id
      and approval.workspace_id = ac.workspace_id and approval.application_id = ac.application_id
      and approval.revision_id = ac.revision_id and approval.candidate_id = f.candidate_id
    where s.id = v_run.computer_session_id and s.workspace_id = v_run.workspace_id
      and s.candidate_id = v_run.candidate_id and s.application_id = v_run.application_id
      and s.revision_id = v_run.revision_id and s.fill_attempt_id = v_run.fill_attempt_id
      and s.state in ('ACTIVE','PAUSED_FOR_REVIEW') and s.expires_at > statement_timestamp()
      and f.status in ('STARTED','TAKEOVER') and f.authority_scope = 'FILL_ONLY_NO_SUBMIT'
      and f.approval_action = 'FILL_APPLICATION_ONCE'
      and approval.permitted_action = 'FILL_APPLICATION_ONCE' and approval.revoked_at is null
      and approval.authority_hash = f.authority_hash and approval.diff_hash = f.diff_hash
      and ac.consumed_at >= approval.issued_at and ac.consumed_at < approval.expires_at
      and a.current_revision_id = v_run.revision_id and a.status in ('EXECUTING','TAKEOVER')
      and c.status in ('ONBOARDING','ACTIVE') and w.status = 'ACTIVE'
      and exists (select 1 from public.workspace_memberships membership
        where membership.workspace_id = c.workspace_id and membership.auth_user_id = c.auth_user_id
          and membership.status = 'ACTIVE')
      and not exists (select 1 from public.application_attempts x where x.application_id = a.id)
  ) then raise exception 'APPLICATION_AGENT_BINDING_INACTIVE' using errcode = '55000'; end if;
  return v_run;
end; $$;
revoke all on function private.assert_application_agent_binding(uuid) from public,anon,authenticated,service_role;

create function public.start_application_agent_run(
  p_workspace_id uuid,p_candidate_id uuid,p_application_id uuid,p_revision_id uuid,
  p_fill_attempt_id uuid,p_computer_session_id uuid,p_model text,p_driver_release text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.application_agent_runs(workspace_id,candidate_id,application_id,revision_id,
    fill_attempt_id,computer_session_id,model,driver_release)
  values(p_workspace_id,p_candidate_id,p_application_id,p_revision_id,p_fill_attempt_id,
    p_computer_session_id,p_model,p_driver_release) returning id into v_id;
  perform private.assert_application_agent_binding(v_id);
  return v_id;
end; $$;

create function public.bind_application_agent_session(p_run_id uuid,p_provider_session_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_run public.application_agent_runs%rowtype;
begin
  if p_provider_session_id is null or p_provider_session_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'APPLICATION_AGENT_SESSION_ID_INVALID' using errcode = '22023'; end if;
  v_run := private.assert_application_agent_binding(p_run_id);
  if v_run.provider_session_id is not null and v_run.provider_session_id <> p_provider_session_id then
    raise exception 'APPLICATION_AGENT_SESSION_REBIND_DENIED' using errcode = '55000'; end if;
  update public.application_agent_runs set provider_session_id = p_provider_session_id,status = 'RUNNING'
    where id = p_run_id;
end; $$;

create function public.begin_application_agent_tool_call(
  p_run_id uuid,p_session_id text,p_turn_id text,p_call_id text,p_tool_name text,p_arguments_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run public.application_agent_runs%rowtype; v_call public.application_agent_tool_calls%rowtype;
begin
  v_run := private.assert_application_agent_binding(p_run_id);
  if v_run.status <> 'RUNNING' or v_run.provider_session_id is distinct from p_session_id then
    raise exception 'APPLICATION_AGENT_SESSION_MISMATCH' using errcode = '55000'; end if;
  select * into v_call from public.application_agent_tool_calls
    where run_id=p_run_id and turn_id=p_turn_id and call_id=p_call_id;
  if found then
    if v_call.tool_name is distinct from p_tool_name or v_call.arguments_hash is distinct from p_arguments_hash then
      raise exception 'APPLICATION_AGENT_CALL_PAYLOAD_MISMATCH' using errcode = '23505'; end if;
    if v_call.status = 'COMPLETED' then
      return jsonb_build_object('status','completed','result',v_call.result);
    end if;
    return jsonb_build_object('status','uncertain');
  end if;
  insert into public.application_agent_tool_calls(run_id,turn_id,call_id,tool_name,arguments_hash)
    values(p_run_id,p_turn_id,p_call_id,p_tool_name,p_arguments_hash);
  return jsonb_build_object('status','new');
end; $$;

create function public.complete_application_agent_tool_call(
  p_run_id uuid,p_session_id text,p_turn_id text,p_call_id text,p_tool_name text,p_arguments_hash text,p_result jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_run public.application_agent_runs%rowtype; v_call public.application_agent_tool_calls%rowtype;
begin
  select * into strict v_run from public.application_agent_runs where id=p_run_id for update;
  if v_run.status <> 'RUNNING' or v_run.provider_session_id is distinct from p_session_id then
    raise exception 'APPLICATION_AGENT_SESSION_MISMATCH' using errcode = '55000'; end if;
  select * into strict v_call from public.application_agent_tool_calls
    where run_id=p_run_id and turn_id=p_turn_id and call_id=p_call_id for update;
  if v_call.tool_name is distinct from p_tool_name or v_call.arguments_hash is distinct from p_arguments_hash
    or (v_call.status='COMPLETED' and v_call.result is distinct from p_result)
    or p_result->>'turn_id' is distinct from p_turn_id or p_result->>'call_id' is distinct from p_call_id
    or jsonb_typeof(p_result) is distinct from 'object'
    or p_result->>'type' is distinct from 'agent.session.input.tool_result'
    or jsonb_typeof(p_result->'success') is distinct from 'boolean'
    or octet_length(p_result::text) > 262144
    or p_result - array['type','turn_id','call_id','success','output','error'] <> '{}'::jsonb
    or (p_result->>'success' = 'true' and (
      jsonb_typeof(p_result->'output') is distinct from 'string'
      or length(p_result->>'output') = 0 or p_result ? 'error'))
    or (p_result->>'success' = 'false' and (
      jsonb_typeof(p_result->'error') is distinct from 'string'
      or length(p_result->>'error') = 0 or p_result ? 'output')) then
    raise exception 'APPLICATION_AGENT_CALL_PAYLOAD_MISMATCH' using errcode = '23505'; end if;
  update public.application_agent_tool_calls set status='COMPLETED',result=p_result,completed_at=now()
    where run_id=p_run_id and turn_id=p_turn_id and call_id=p_call_id and status='STARTED';
end; $$;

create function public.finish_application_agent_run(p_run_id uuid,p_status text,p_failure_code text,p_provider_deleted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_run public.application_agent_runs%rowtype;
begin
  if p_status is null or p_status not in ('COMPLETED','FAILED') or p_provider_deleted is null
    or (p_status = 'COMPLETED' and p_failure_code is not null) then
    raise exception 'APPLICATION_AGENT_COMPLETION_INVALID' using errcode = '22023'; end if;
  select * into strict v_run from public.application_agent_runs where id=p_run_id for update;
  if v_run.status in ('COMPLETED','FAILED') and (
    v_run.status <> p_status or v_run.failure_code is distinct from p_failure_code
  ) then raise exception 'APPLICATION_AGENT_RUN_STATE_CONFLICT' using errcode='55000'; end if;
  if p_status = 'COMPLETED' and exists (
    select 1 from public.application_agent_tool_calls where run_id=p_run_id and status='STARTED'
  ) then raise exception 'APPLICATION_AGENT_RUN_HAS_PENDING_TOOLS' using errcode='55000'; end if;
  update public.application_agent_runs set status=p_status,failure_code=p_failure_code,
    completed_at=coalesce(completed_at,now()),
    provider_deleted_at=case when p_provider_deleted and provider_session_id is not null
      then coalesce(provider_deleted_at,now()) else provider_deleted_at end
    where id=p_run_id and (status in ('STARTING','RUNNING') or status=p_status);
  if not found then raise exception 'APPLICATION_AGENT_RUN_STATE_CONFLICT' using errcode='55000'; end if;
end; $$;

-- A crashed worker may leave a run active. Only the bound browser's measured
-- terminal/expiry state can release that fence; elapsed run age is not evidence.
create function public.expire_application_agent_runs(p_limit integer default 20)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'APPLICATION_AGENT_CLEANUP_LIMIT_INVALID' using errcode='22023'; end if;
  with expired as (
    select agent_run.id from public.application_agent_runs agent_run
    join public.computer_sessions session on session.id=agent_run.computer_session_id
      and session.workspace_id=agent_run.workspace_id
    where agent_run.status in ('STARTING','RUNNING')
      and (session.expires_at <= statement_timestamp() or session.state in ('CLOSED','DESTROYED','FAILED_SAFE'))
    order by agent_run.created_at,agent_run.id
    limit p_limit for update of agent_run skip locked
  ), updated as (
    update public.application_agent_runs agent_run
      set status='FAILED',failure_code='APPLICATION_AGENT_RUNTIME_EXPIRED',completed_at=now()
    from expired where agent_run.id=expired.id
    returning agent_run.id
  ) select count(*)::integer into v_count from updated;
  return v_count;
end; $$;

revoke all on function public.start_application_agent_run(uuid,uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.bind_application_agent_session(uuid,text) from public,anon,authenticated;
revoke all on function public.begin_application_agent_tool_call(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_application_agent_tool_call(uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_application_agent_run(uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.expire_application_agent_runs(integer) from public,anon,authenticated;
grant execute on function public.start_application_agent_run(uuid,uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.bind_application_agent_session(uuid,text) to service_role;
grant execute on function public.begin_application_agent_tool_call(uuid,text,text,text,text,text) to service_role;
grant execute on function public.complete_application_agent_tool_call(uuid,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.finish_application_agent_run(uuid,text,text,boolean) to service_role;
grant execute on function public.expire_application_agent_runs(integer) to service_role;
