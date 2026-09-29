-- Keep provider-specific session identifiers behind one service-only server
-- boundary. Candidate ownership and session state are verified separately
-- through RLS before the application server calls this function.

create function public.get_active_computer_session_provider_binding(
  p_computer_session_id uuid
)
returns table (
  provider_adapter text,
  provider_session_ref text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_computer_session_id is null then
    raise exception 'COMPUTER_SESSION_ID_REQUIRED' using errcode = '22023';
  end if;

  return query
  select binding.provider_adapter, binding.provider_session_ref
  from public.computer_sessions as session
  join private.computer_session_provider_refs as binding
    on binding.computer_session_id = session.id
  where session.id = p_computer_session_id
    and session.state in ('ACTIVE', 'PAUSED_FOR_REVIEW')
    and session.expires_at > statement_timestamp();
end;
$$;

revoke all on function public.get_active_computer_session_provider_binding(uuid)
  from public, anon, authenticated;
grant execute on function public.get_active_computer_session_provider_binding(uuid)
  to service_role;

comment on function public.get_active_computer_session_provider_binding(uuid) is
  'Service-only lookup for an unexpired active/paused provider binding after candidate-scoped RLS authorization.';
