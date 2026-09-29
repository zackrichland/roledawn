-- Match the concrete TypeScript/browser adapters. Catalog membership is not
-- delivery support. Custom domains, EU routes and Ashby remain unsupported.
create function private.is_supported_autopilot_destination(p_url text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    p_url ~ '^https://[jJ][oO][bB]-[bB][oO][aA][rR][dD][sS]\.[gG][rR][eE][eE][nN][hH][oO][uU][sS][eE]\.[iI][oO](:443)?/[a-z0-9_-]+/jobs/[0-9]+/?$'
    or p_url ~ '^https://[jJ][oO][bB][sS]\.[lL][eE][vV][eE][rR]\.[cC][oO](:443)?/[a-z0-9_-]+/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(/apply)?/?$', false);
$$;
revoke all on function private.is_supported_autopilot_destination(text) from public, anon, authenticated, service_role;

-- Preserve the existing authority, immutable revision, audit and replay logic.
-- Refuse a changed upstream function rather than silently patching the wrong guard.
do $$
declare
  v_definition text := pg_get_functiondef('private.delegate_application_autopilot(uuid,uuid,bigint,uuid,text)'::regprocedure);
  v_old text := 'if v_destination_url is null or not private.is_public_https_job_url(v_destination_url) then';
begin
  if position(v_old in v_definition) = 0 then raise exception 'AUTOPILOT_DESTINATION_GUARD_PATCH_MISMATCH'; end if;
  execute replace(v_definition, v_old, 'if not private.is_supported_autopilot_destination(v_destination_url) then');
end;
$$;

comment on function private.is_supported_autopilot_destination(text) is
  'Concrete delivery adapters only: Greenhouse US hosted and Lever global hosted. CAPTCHA and form drift can still require candidate intervention; no real employer acceptance implied.';
