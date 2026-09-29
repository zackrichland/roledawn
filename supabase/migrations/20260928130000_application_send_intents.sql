-- RoleDawn / HireWire: "Apply" means apply. When a candidate asks RoleDawn to
-- apply to one named job, the request is recorded as a send-when-ready intent.
-- Once that application's packet commits READY, a worker delegates it with the
-- same single-use authority as the candidate pressing "Apply for me" on the
-- ready application. The candidate can cancel until sending begins. The
-- existing seal, one-attempt, and reconciliation rules are unchanged.

create table public.application_send_intents (
  application_id uuid primary key,
  workspace_id uuid not null,
  candidate_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  delegate_command_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text check (close_reason is null or close_reason in ('DELEGATED', 'CANCELED', 'NOT_DELIVERABLE', 'APPLICATION_CLOSED')),
  check ((closed_at is null) = (close_reason is null)),
  foreign key (workspace_id, candidate_id, application_id)
    references public.applications(workspace_id, candidate_id, id) on delete cascade
);
create index application_send_intents_open on public.application_send_intents(created_at, application_id) where closed_at is null;
create index application_send_intents_scope on public.application_send_intents(workspace_id, candidate_id, application_id);
create index application_send_intents_requested_by on public.application_send_intents(requested_by);

alter table public.application_send_intents enable row level security;
create policy application_send_intents_candidate_select on public.application_send_intents for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = application_send_intents.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
revoke all on public.application_send_intents from public, anon, authenticated;
grant select on public.application_send_intents to authenticated;
grant all on public.application_send_intents to service_role;

create or replace function public.request_application_send(p_command_id uuid, p_application_id uuid)
returns table (application_id uuid, intent_open boolean, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_application public.applications%rowtype;
  v_existing public.command_dedup%rowtype;
  v_hash text;
begin
  if p_command_id is null or p_application_id is null then
    raise exception 'APPLICATION_SEND_INPUT_INVALID' using errcode = '22023';
  end if;
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;
  v_hash := encode(extensions.digest(convert_to(p_application_id::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'REQUEST_APPLICATION_SEND' or v_existing.request_hash <> v_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query select p_application_id, true, true;
    return;
  end if;
  select app.* into v_application from public.applications as app
  where app.id = p_application_id and app.workspace_id = v_workspace and app.candidate_id = v_candidate
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = '23503'; end if;
  if v_application.status in ('CONFIRMED', 'CANCELED', 'SKIPPED', 'EXECUTING', 'RECONCILING', 'AUTHORIZED') then
    raise exception 'APPLICATION_SEND_NOT_AVAILABLE' using errcode = '55000';
  end if;
  insert into public.command_dedup (workspace_id, command_id, actor_id, command_type, request_hash, status, aggregate_type, aggregate_id, result, completed_at)
  values (v_workspace, p_command_id, v_actor, 'REQUEST_APPLICATION_SEND', v_hash, 'COMMITTED', 'APPLICATION', p_application_id,
    jsonb_build_object('application_id', p_application_id), statement_timestamp());
  insert into public.application_send_intents (application_id, workspace_id, candidate_id, requested_by)
  values (p_application_id, v_workspace, v_candidate, v_actor)
  on conflict on constraint application_send_intents_pkey do update
    set closed_at = null, close_reason = null, requested_by = excluded.requested_by,
        delegate_command_id = extensions.gen_random_uuid(), created_at = statement_timestamp()
    where public.application_send_intents.closed_at is not null
      and public.application_send_intents.close_reason = 'CANCELED';
  return query select p_application_id, true, false;
end;
$$;
revoke all on function public.request_application_send(uuid, uuid) from public, anon;
grant execute on function public.request_application_send(uuid, uuid) to authenticated, service_role;

create or replace function public.cancel_application_send(p_application_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
begin
  select resolved.workspace_id, resolved.candidate_id into strict v_workspace, v_candidate
  from private.actor_personal_candidate(v_actor) as resolved;
  update public.application_send_intents as intent
  set closed_at = statement_timestamp(), close_reason = 'CANCELED'
  where intent.application_id = p_application_id and intent.workspace_id = v_workspace
    and intent.candidate_id = v_candidate and intent.closed_at is null;
  return found;
end;
$$;
revoke all on function public.cancel_application_send(uuid) from public, anon;
grant execute on function public.cancel_application_send(uuid) to authenticated, service_role;

-- Worker: delegate open intents whose application is READY with a current
-- revision, exactly as the candidate's own "Apply for me" would.
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
      null;
    end;
  end loop;
  return jsonb_build_object('delegated', v_delegated, 'closed', v_closed);
end;
$$;
revoke all on function public.delegate_ready_send_intents(uuid, integer) from public, anon, authenticated;
grant execute on function public.delegate_ready_send_intents(uuid, integer) to service_role;
