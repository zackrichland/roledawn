-- Match the shipped hosted-form parsers; support is not employer acceptance.
create or replace function private.is_supported_autopilot_destination(p_url text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    p_url ~ '^https://[jJ][oO][bB]-[bB][oO][aA][rR][dD][sS]\.[gG][rR][eE][eE][nN][hH][oO][uU][sS][eE]\.[iI][oO](:443)?/[a-z0-9_-]+/jobs/[0-9]+/?$'
    or p_url ~ '^https://[jJ][oO][bB][sS]\.[lL][eE][vV][eE][rR]\.[cC][oO](:443)?/[a-z0-9_-]+/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(/apply)?/?$'
    or p_url ~ '^https://[jJ][oO][bB][sS]\.[aA][sS][hH][bB][yY][hH][qQ]\.[cC][oO][mM](:443)?/[A-Za-z0-9_-]+/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(/application)?/?$', false);
$$;
revoke all on function private.is_supported_autopilot_destination(text) from public, anon, authenticated, service_role;

comment on function private.is_supported_autopilot_destination(text) is
  'Concrete delivery adapters: Greenhouse US, Lever global and Ashby hosted. Verification and unsupported controls still require candidate intervention; no employer acceptance implied.';

-- A fresh candidate request may recover an unsupported destination after its
-- adapter ships. Migration alone never reopens or creates a send intent.
create or replace function public.request_application_send(p_command_id uuid, p_application_id uuid)
returns table (application_id uuid, intent_open boolean, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_application public.applications%rowtype;
  v_existing public.command_dedup%rowtype;
  v_intent public.application_send_intents%rowtype;
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
    if v_existing.command_type <> 'REQUEST_APPLICATION_SEND' or v_existing.request_hash <> v_hash
      or v_existing.actor_id is distinct from v_actor then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    -- A replay never undoes a later cancellation, delegation or unsupported
    -- decision. Return the current durable state instead of claiming success.
    return query select p_application_id, exists (
      select 1 from public.application_send_intents as intent
      where intent.application_id = p_application_id and intent.workspace_id = v_workspace
        and intent.candidate_id = v_candidate and intent.closed_at is null
    ), true;
    return;
  end if;
  select app.* into v_application from public.applications as app
  where app.id = p_application_id and app.workspace_id = v_workspace and app.candidate_id = v_candidate
  for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = '23503'; end if;
  if v_application.status in ('CONFIRMED', 'CANCELED', 'SKIPPED', 'EXECUTING', 'RECONCILING', 'AUTHORIZED')
    or exists(select 1 from public.application_autopilots where public.application_autopilots.application_id = p_application_id)
    or exists(select 1 from public.application_attempts where public.application_attempts.application_id = p_application_id) then
    -- Paused, canceled and uncertain deliveries use their existing controls;
    -- an initial send request is never a retry or reconciliation command.
    raise exception 'APPLICATION_SEND_NOT_AVAILABLE' using errcode = '55000';
  end if;
  -- The sweep locks intent before application. Do not wait while holding the
  -- opposite lock order: let a racing sweep finish and report an unconfirmed
  -- candidate change, with this command fully rolled back.
  select intent.* into v_intent from public.application_send_intents as intent
  where intent.application_id = p_application_id for update nowait;
  if found and v_intent.closed_at is not null then
    if v_intent.close_reason not in ('CANCELED', 'NOT_DELIVERABLE') then
      raise exception 'APPLICATION_SEND_NOT_AVAILABLE' using errcode = '55000';
    end if;
    if v_intent.close_reason = 'NOT_DELIVERABLE' and not private.is_supported_autopilot_destination(
      (select version.apply_url from public.job_versions as version where version.id = v_application.job_version_id)
    ) then
      raise exception 'APPLICATION_SEND_DESTINATION_UNSUPPORTED' using errcode = '55000';
    end if;
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
      and public.application_send_intents.close_reason in ('CANCELED', 'NOT_DELIVERABLE');
  return query select p_application_id, exists (
    select 1 from public.application_send_intents as intent
    where intent.application_id = p_application_id and intent.workspace_id = v_workspace
      and intent.candidate_id = v_candidate and intent.closed_at is null
  ), false;
end;
$$;
revoke all on function public.request_application_send(uuid, uuid) from public, anon;
grant execute on function public.request_application_send(uuid, uuid) to authenticated, service_role;

-- A later retry migration restored the broad HTTPS guard on direct delegation.
-- Restore the same concrete adapter gate used by send intents and auto-apply.
do $$
declare
  v_definition text := pg_get_functiondef('private.delegate_application_autopilot(uuid,uuid,bigint,uuid,text)'::regprocedure);
  v_old text := 'if v_destination_url is null or not private.is_public_https_job_url(v_destination_url) then';
  v_new text := 'if not private.is_supported_autopilot_destination(v_destination_url) then';
begin
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  elsif position(v_new in v_definition) = 0 then
    raise exception 'AUTOPILOT_DESTINATION_GUARD_PATCH_MISMATCH';
  end if;
end;
$$;

-- Clearance eligibility and explicit no-AI questions are candidate-only.
-- Never infer them from profile facts, standing answers or another application.
-- A candidate response saved for this exact application remains usable.
create or replace function private.autopilot_standing_candidate_only(p_label text)
returns boolean language sql immutable set search_path = '' as $$
  -- Match the two non-ASCII letters that ECMAScript /iu folds into ASCII.
  select translate(coalesce(p_label, ''), 'ſK', 'sk') ~* '(^|[^a-z0-9_])(gender|sex|sexual|race|racial|ethnic[a-z0-9_]*|hispanic|latin[aeox]|veteran[a-z0-9_]*|disabilit[a-z0-9_]*|pronouns?|transgender|religio[a-z0-9_]*|marital|pregnan[a-z0-9_]*|citizen[a-z0-9_]*|nationality|passport|social security|ssn|criminal|convict[a-z0-9_]*|felon[a-z0-9_]*|misdemeanor[a-z0-9_]*|arrest[a-z0-9_]*|background check|clearance|ts[\s/-]*sci|top[\s-]+secret|polygraph|fsp|(without\s+using|do\s+not\s+use|don[''’]t\s+use|no)\s+(ai|artificial\s+intelligence)|drug|medical|health|signature|sign|consent|agree[a-z0-9_]*|acknowledg[a-z0-9_]*|certify|attest[a-z0-9_]*|terms|privacy|eeo|arbitrat[a-z0-9_]*|non[\s-]*compet[a-z0-9_]*|(person|people) of colou?r|(confirm|declare)(?=$|[^a-z0-9_]).*(?<![a-z0-9_])(information|statements?)(?=$|[^a-z0-9_]).*(?<![a-z0-9_])(true|accurate|complete))($|[^a-z0-9_])'
$$;

revoke all on function private.autopilot_standing_candidate_only(text) from public, anon, authenticated, service_role;
