-- Read-only mailbox connection for employer verification codes (D-106).
--
-- A candidate may connect their own mailbox so the delivery worker can read
-- the code an employer emails during a send (Greenhouse's "security code").
-- The refresh token is encrypted by the application before it reaches the
-- database and is bound to the candidate as associated data. The candidate
-- sees the connection, never the token; the worker can read it only while it
-- holds an active delivery lease for that candidate's application.

create table private.candidate_mailbox_connections (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check(provider in ('GOOGLE')),
  email_address text not null check(char_length(btrim(email_address)) between 3 and 320 and position('@' in email_address)>1),
  encrypted_token text not null check(char_length(encrypted_token) between 20 and 8000),
  key_id text not null check(key_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  scopes text[] not null check(cardinality(scopes) between 1 and 10),
  connected_by uuid not null references auth.users(id) on delete cascade,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text check(last_error ~ '^[A-Z][A-Z0-9_]{2,119}$')
);
create index candidate_mailbox_connections_workspace on private.candidate_mailbox_connections(workspace_id);
create index candidate_mailbox_connections_connected_by on private.candidate_mailbox_connections(connected_by);
alter table private.candidate_mailbox_connections enable row level security;
revoke all on private.candidate_mailbox_connections from public,anon,authenticated,service_role;

-- Who supplied a code: the candidate in RoleDawn, or the worker from the connected mailbox.
alter table public.application_autopilot_verifications add column source text not null default 'CANDIDATE' check(source in ('CANDIDATE','MAILBOX'));
grant select(source) on public.application_autopilot_verifications to authenticated;

-- The caller's own candidate in an active workspace they belong to.
create function private.assert_mailbox_candidate(p_candidate_id uuid)
returns public.candidates language plpgsql security definer set search_path='' as $$
declare v_candidate public.candidates%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select c.* into v_candidate from public.candidates c
    join public.workspaces w on w.id=c.workspace_id and w.status='ACTIVE'
    join public.workspace_memberships m on m.workspace_id=c.workspace_id and m.auth_user_id=auth.uid() and m.status='ACTIVE'
    where c.id=p_candidate_id and c.auth_user_id=auth.uid() and c.status in ('ACTIVE','ONBOARDING');
  if not found then raise exception 'CANDIDATE_MAILBOX_NOT_FOUND' using errcode='42501'; end if;
  return v_candidate;
end; $$;

create function public.save_candidate_mailbox_connection(p_candidate_id uuid,p_provider text,p_email text,p_encrypted_token text,p_key_id text,p_scopes text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_candidate public.candidates%rowtype;
begin
  v_candidate:=private.assert_mailbox_candidate(p_candidate_id);
  if p_provider is distinct from 'GOOGLE' or p_email is null or char_length(btrim(p_email)) not between 3 and 320 or position('@' in p_email)<2
    or p_encrypted_token is null or char_length(p_encrypted_token) not between 20 and 8000 or p_key_id !~ '^[A-Za-z0-9_-]{1,40}$'
    or p_scopes is null or cardinality(p_scopes) not between 1 and 10 then
    raise exception 'CANDIDATE_MAILBOX_INVALID' using errcode='22023'; end if;
  insert into private.candidate_mailbox_connections(candidate_id,workspace_id,provider,email_address,encrypted_token,key_id,scopes,connected_by)
    values(v_candidate.id,v_candidate.workspace_id,p_provider,lower(btrim(p_email)),p_encrypted_token,p_key_id,p_scopes,auth.uid())
  on conflict(candidate_id) do update set provider=excluded.provider,email_address=excluded.email_address,encrypted_token=excluded.encrypted_token,
    key_id=excluded.key_id,scopes=excluded.scopes,connected_by=excluded.connected_by,connected_at=now(),last_used_at=null,last_error=null;
  return jsonb_build_object('provider',p_provider,'emailAddress',lower(btrim(p_email)));
end; $$;

create function public.get_candidate_mailbox_connection(p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_connection private.candidate_mailbox_connections%rowtype;
begin
  perform private.assert_mailbox_candidate(p_candidate_id);
  select * into v_connection from private.candidate_mailbox_connections where candidate_id=p_candidate_id;
  if not found then return null; end if;
  return jsonb_build_object('provider',v_connection.provider,'emailAddress',v_connection.email_address,'connectedAt',v_connection.connected_at,
    'lastUsedAt',v_connection.last_used_at,'lastError',v_connection.last_error);
end; $$;

-- Returns the sealed token once, so the server can revoke it with the provider.
create function public.delete_candidate_mailbox_connection(p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_connection private.candidate_mailbox_connections%rowtype;
begin
  perform private.assert_mailbox_candidate(p_candidate_id);
  delete from private.candidate_mailbox_connections where candidate_id=p_candidate_id returning * into v_connection;
  if not found then return null; end if;
  return jsonb_build_object('provider',v_connection.provider,'encryptedToken',v_connection.encrypted_token,'keyId',v_connection.key_id);
end; $$;

-- Worker: the connection for the candidate whose application it is sending.
create function public.read_autopilot_mailbox_connection(p_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_connection private.candidate_mailbox_connections%rowtype;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,false);
  if v_row.status<>'SUBMITTING' or v_row.attempt_id is null then raise exception 'APPLICATION_AUTOPILOT_MAILBOX_NOT_ALLOWED' using errcode='55000'; end if;
  select * into v_connection from private.candidate_mailbox_connections where candidate_id=v_row.candidate_id and workspace_id=v_row.workspace_id;
  if not found then return null; end if;
  return jsonb_build_object('candidateId',v_connection.candidate_id,'provider',v_connection.provider,'emailAddress',v_connection.email_address,
    'encryptedToken',v_connection.encrypted_token,'keyId',v_connection.key_id);
end; $$;

create function public.record_autopilot_mailbox_use(p_id uuid,p_lease_token uuid,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,false);
  if p_error is not null and p_error !~ '^[A-Z][A-Z0-9_]{2,119}$' then raise exception 'APPLICATION_AUTOPILOT_MAILBOX_INVALID' using errcode='22023'; end if;
  update private.candidate_mailbox_connections set last_used_at=statement_timestamp(),last_error=p_error
    where candidate_id=v_row.candidate_id and workspace_id=v_row.workspace_id;
end; $$;

-- Worker: the code read from the candidate's own mailbox for the open request.
create function public.provide_application_autopilot_verification_from_mailbox(p_id uuid,p_lease_token uuid,p_verification_id uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_request public.application_autopilot_verifications%rowtype;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,false);
  if p_code is null or p_code !~ '^[A-Za-z0-9]{4,12}$' then raise exception 'APPLICATION_AUTOPILOT_VERIFICATION_CODE_INVALID' using errcode='22023'; end if;
  if not exists(select 1 from private.candidate_mailbox_connections where candidate_id=v_row.candidate_id and workspace_id=v_row.workspace_id) then
    raise exception 'APPLICATION_AUTOPILOT_MAILBOX_NOT_ALLOWED' using errcode='55000'; end if;
  select * into v_request from public.application_autopilot_verifications where id=p_verification_id and autopilot_id=p_id for update;
  if not found or v_request.status<>'REQUESTED' or v_request.expires_at<=statement_timestamp() or v_row.status<>'SUBMITTING'
    or v_row.attempt_id is distinct from v_request.attempt_id then
    raise exception 'APPLICATION_AUTOPILOT_VERIFICATION_STALE' using errcode='PT409'; end if;
  update public.application_autopilot_verifications set status='PROVIDED',code=p_code,provided_at=statement_timestamp(),provided_by=v_row.delegated_by,source='MAILBOX'
    where id=v_request.id;
  update public.application_autopilots set version=version+1,updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_verification_provided','RECONCILING');
end; $$;

revoke all on function private.assert_mailbox_candidate(uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_candidate_mailbox_connection(uuid,text,text,text,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.save_candidate_mailbox_connection(uuid,text,text,text,text,text[]) to authenticated;
revoke all on function public.get_candidate_mailbox_connection(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_candidate_mailbox_connection(uuid) to authenticated;
revoke all on function public.delete_candidate_mailbox_connection(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_candidate_mailbox_connection(uuid) to authenticated;
revoke all on function public.read_autopilot_mailbox_connection(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_autopilot_mailbox_connection(uuid,uuid) to service_role;
revoke all on function public.record_autopilot_mailbox_use(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.record_autopilot_mailbox_use(uuid,uuid,text) to service_role;
revoke all on function public.provide_application_autopilot_verification_from_mailbox(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.provide_application_autopilot_verification_from_mailbox(uuid,uuid,uuid,text) to service_role;
