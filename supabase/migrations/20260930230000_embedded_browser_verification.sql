-- Public metadata for a candidate-owned human check; provider capabilities
-- remain private and are issued only by the authenticated server route.
create function public.read_application_browser_checks(p_application_id uuid default null)
returns table(autopilot_id uuid, application_id uuid, expires_at timestamptz)
language sql stable security definer set search_path='' as $$
  select a.id,a.application_id,(r.checkpoint->>'browserVerificationExpiresAt')::timestamptz
  from public.application_autopilots a
  join private.application_autopilot_runtime r on r.autopilot_id=a.id and r.runtime_lease=a.lease_token
  join public.candidates c on c.id=a.candidate_id and c.workspace_id=a.workspace_id and c.auth_user_id=auth.uid() and c.status in ('ACTIVE','ONBOARDING')
  join public.workspaces w on w.id=a.workspace_id and w.status='ACTIVE'
  join public.workspace_memberships m on m.workspace_id=a.workspace_id and m.auth_user_id=auth.uid() and m.status='ACTIVE'
  where (p_application_id is null or a.application_id=p_application_id)
    and a.status='RUNNING' and a.attempt_id is null and a.stop_requested is null
    and a.lease_expires_at>statement_timestamp() and a.expires_at>statement_timestamp()
    and r.runtime_reference is not null
    and (r.checkpoint->>'browserVerificationExpiresAt')::timestamptz>statement_timestamp()
    and (r.checkpoint->>'browserExpiresAt')::timestamptz>statement_timestamp();
$$;

create function public.get_application_browser_check_binding(p_application_id uuid,p_auth_user_id uuid)
returns table(provider_session_ref text,destination_url text,expires_at timestamptz)
language sql stable security definer set search_path='' as $$
  select r.runtime_reference,a.destination_url,least((r.checkpoint->>'browserVerificationExpiresAt')::timestamptz,(r.checkpoint->>'browserExpiresAt')::timestamptz,a.lease_expires_at)
  from public.application_autopilots a
  join private.application_autopilot_runtime r on r.autopilot_id=a.id and r.runtime_lease=a.lease_token
  join public.candidates c on c.id=a.candidate_id and c.workspace_id=a.workspace_id and c.auth_user_id=p_auth_user_id and c.status in ('ACTIVE','ONBOARDING')
  join public.workspaces w on w.id=a.workspace_id and w.status='ACTIVE'
  join public.workspace_memberships m on m.workspace_id=a.workspace_id and m.auth_user_id=p_auth_user_id and m.status='ACTIVE'
  where a.application_id=p_application_id and a.status='RUNNING' and a.attempt_id is null and a.stop_requested is null
    and a.lease_expires_at>statement_timestamp() and a.expires_at>statement_timestamp()
    and r.runtime_reference is not null
    and (r.checkpoint->>'browserVerificationExpiresAt')::timestamptz>statement_timestamp()
    and (r.checkpoint->>'browserExpiresAt')::timestamptz>statement_timestamp();
$$;
revoke all on function public.read_application_browser_checks(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_application_browser_checks(uuid) to authenticated;
revoke all on function public.get_application_browser_check_binding(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_application_browser_check_binding(uuid,uuid) to service_role;
