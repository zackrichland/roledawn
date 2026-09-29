-- Employer email verification during an autopilot submission.
--
-- Greenhouse (and similar ATSs) can decline a final request from a cloud
-- browser and email the applicant a one-time code instead. The same worker,
-- still holding the page and its lease, asks the candidate for that code and
-- types it into the employer's own form. The code authorizes nothing inside
-- RoleDawn: the single submission attempt already exists, and the worker only
-- resends that attempt's exact application content with the code attached.
-- A code is readable by the worker only while PROVIDED and is cleared on use.

create table public.application_autopilot_verifications (
  id uuid primary key default extensions.gen_random_uuid(),
  autopilot_id uuid not null references public.application_autopilots(id) on delete cascade,
  attempt_id uuid not null references public.application_attempts(id) on delete restrict,
  recipient_hint text not null check(char_length(btrim(recipient_hint)) between 1 and 320),
  status text not null default 'REQUESTED' check(status in ('REQUESTED','PROVIDED','USED','EXPIRED')),
  retry_reason text check(retry_reason in ('CODE_REJECTED')),
  code text check(code ~ '^[A-Za-z0-9]{4,12}$'),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '10 minutes',
  provided_at timestamptz,
  provided_by uuid references auth.users(id) on delete restrict,
  settled_at timestamptz,
  check((status='PROVIDED') = (code is not null)),
  check((status in ('PROVIDED','USED')) = (provided_at is not null and provided_by is not null) or status='EXPIRED')
);
create unique index application_autopilot_verifications_one_open on public.application_autopilot_verifications(autopilot_id)
  where status in ('REQUESTED','PROVIDED');
create index application_autopilot_verifications_autopilot on public.application_autopilot_verifications(autopilot_id,requested_at desc);
create index application_autopilot_verifications_attempt on public.application_autopilot_verifications(attempt_id);
create index application_autopilot_verifications_provider on public.application_autopilot_verifications(provided_by);

alter table public.application_autopilot_verifications enable row level security;
create policy application_autopilot_verifications_owner_select on public.application_autopilot_verifications for select to authenticated using(exists(
  select 1 from public.application_autopilots a where a.id=autopilot_id
));
revoke all on public.application_autopilot_verifications from public,anon,authenticated,service_role;
-- The candidate sees the request, never a stored code.
grant select(id,autopilot_id,attempt_id,recipient_hint,status,retry_reason,requested_at,expires_at,provided_at) on public.application_autopilot_verifications to authenticated;
grant select on public.application_autopilot_verifications to service_role;

-- Worker: the employer asked for an emailed code. Any earlier open request expires.
create function public.request_application_autopilot_verification(p_id uuid,p_lease_token uuid,p_recipient_hint text,p_retry_reason text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_id uuid;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,false);
  if v_row.status<>'SUBMITTING' or v_row.attempt_id is null or p_recipient_hint is null or char_length(btrim(p_recipient_hint)) not between 1 and 320
    or (p_retry_reason is not null and p_retry_reason<>'CODE_REJECTED') then
    raise exception 'APPLICATION_AUTOPILOT_VERIFICATION_INVALID' using errcode='22023'; end if;
  if (select count(*) from public.application_autopilot_verifications where autopilot_id=p_id)>=4 then
    raise exception 'APPLICATION_AUTOPILOT_VERIFICATION_LIMIT' using errcode='55000'; end if;
  update public.application_autopilot_verifications set status='EXPIRED',code=null,settled_at=statement_timestamp()
    where autopilot_id=p_id and status in ('REQUESTED','PROVIDED');
  insert into public.application_autopilot_verifications(autopilot_id,attempt_id,recipient_hint,retry_reason,requested_at,expires_at)
    values(p_id,v_row.attempt_id,btrim(p_recipient_hint),p_retry_reason,statement_timestamp(),statement_timestamp()+interval '10 minutes') returning id into v_id;
  update public.application_autopilots set version=version+1,updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_verification_requested','TAKEOVER');
  return v_id;
end; $$;

-- Candidate: the code from their inbox, for the one open request.
create function private.provide_application_autopilot_verification_code(p_command_id uuid,p_id uuid,p_verification_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_existing public.command_dedup%rowtype; v_request public.application_autopilot_verifications%rowtype;
  v_code text:=btrim(coalesce(p_code,'')); v_hash text; v_result jsonb;
begin
  v_row:=private.assert_autopilot_candidate(p_id);
  if p_command_id is null or p_verification_id is null or v_code !~ '^[A-Za-z0-9]{4,12}$' then
    raise exception 'APPLICATION_AUTOPILOT_VERIFICATION_CODE_INVALID' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_id,p_verification_id,encode(extensions.digest(convert_to(v_code,'utf8'),'sha256'),'hex'))::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_row.workspace_id::text||':'||p_command_id::text,0));
  select * into v_existing from public.command_dedup where workspace_id=v_row.workspace_id and command_id=p_command_id;
  if found then
    if v_existing.command_type<>'PROVIDE_APPLICATION_AUTOPILOT_VERIFICATION' or v_existing.actor_id<>auth.uid() or v_existing.request_hash<>v_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode='23505'; end if;
    return v_existing.result||'{"replayed":true}'::jsonb;
  end if;
  select * into v_request from public.application_autopilot_verifications where id=p_verification_id and autopilot_id=p_id for update;
  if not found or v_request.status<>'REQUESTED' or v_request.expires_at<=statement_timestamp() or v_row.status<>'SUBMITTING'
    or v_row.attempt_id is distinct from v_request.attempt_id then
    raise exception 'APPLICATION_AUTOPILOT_VERIFICATION_STALE' using errcode='PT409'; end if;
  update public.application_autopilot_verifications set status='PROVIDED',code=v_code,provided_at=statement_timestamp(),provided_by=auth.uid()
    where id=v_request.id;
  update public.application_autopilots set version=version+1,updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_verification_provided','RECONCILING');
  v_result:=jsonb_build_object('id',p_id,'verificationId',v_request.id,'replayed',false);
  insert into public.command_dedup(workspace_id,command_id,actor_id,command_type,request_hash,status,aggregate_type,aggregate_id,result,completed_at)
    values(v_row.workspace_id,p_command_id,auth.uid(),'PROVIDE_APPLICATION_AUTOPILOT_VERIFICATION',v_hash,'COMMITTED','APPLICATION',v_row.application_id,v_result,statement_timestamp());
  return v_result;
end; $$;
create function public.provide_application_autopilot_verification_code(p_command_id uuid,p_id uuid,p_verification_id uuid,p_code text)
returns jsonb language sql security invoker set search_path='' as $$ select private.provide_application_autopilot_verification_code(p_command_id,p_id,p_verification_id,p_code); $$;

-- Worker: the latest request. The code is returned only while PROVIDED.
create function public.read_application_autopilot_verification(p_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.application_autopilot_verifications%rowtype;
begin
  perform private.assert_autopilot_lease(p_id,p_lease_token,false);
  select * into v_request from public.application_autopilot_verifications where autopilot_id=p_id order by requested_at desc,id desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',v_request.id,'status',case when v_request.status='REQUESTED' and v_request.expires_at<=statement_timestamp() then 'EXPIRED' else v_request.status end,
    'code',case when v_request.status='PROVIDED' then v_request.code end,'expires_at',v_request.expires_at);
end; $$;

-- Worker: a provided code was typed into the form (USED), or the request lapsed (EXPIRED).
create function public.settle_application_autopilot_verification(p_id uuid,p_lease_token uuid,p_verification_id uuid,p_outcome text)
returns void language plpgsql security definer set search_path='' as $$
declare v_request public.application_autopilot_verifications%rowtype;
begin
  perform private.assert_autopilot_lease(p_id,p_lease_token,false);
  select * into v_request from public.application_autopilot_verifications where id=p_verification_id and autopilot_id=p_id for update;
  if not found or p_outcome is null or (p_outcome='USED' and v_request.status<>'PROVIDED') or (p_outcome='EXPIRED' and v_request.status not in ('REQUESTED','PROVIDED'))
    or p_outcome not in ('USED','EXPIRED') then
    raise exception 'APPLICATION_AUTOPILOT_VERIFICATION_SETTLE_INVALID' using errcode='22023'; end if;
  update public.application_autopilot_verifications set status=p_outcome,code=null,settled_at=statement_timestamp() where id=v_request.id;
end; $$;

-- Worker: keep an active lease while it waits on the candidate (never shortens it).
create function public.extend_application_autopilot_lease(p_id uuid,p_lease_token uuid,p_seconds integer)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare v_expires timestamptz;
begin
  perform private.assert_autopilot_lease(p_id,p_lease_token,false);
  if p_seconds is null or p_seconds not between 30 and 600 then raise exception 'APPLICATION_AUTOPILOT_LEASE_EXTENSION_INVALID' using errcode='22023'; end if;
  update public.application_autopilots set lease_expires_at=greatest(lease_expires_at,statement_timestamp()+make_interval(secs=>p_seconds)),updated_at=statement_timestamp()
    where id=p_id returning lease_expires_at into v_expires;
  return v_expires;
end; $$;

revoke all on function public.request_application_autopilot_verification(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.request_application_autopilot_verification(uuid,uuid,text,text) to service_role;
revoke all on function private.provide_application_autopilot_verification_code(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.provide_application_autopilot_verification_code(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.provide_application_autopilot_verification_code(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.provide_application_autopilot_verification_code(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.read_application_autopilot_verification(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_application_autopilot_verification(uuid,uuid) to service_role;
revoke all on function public.settle_application_autopilot_verification(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.settle_application_autopilot_verification(uuid,uuid,uuid,text) to service_role;
revoke all on function public.extend_application_autopilot_lease(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.extend_application_autopilot_lease(uuid,uuid,integer) to service_role;
