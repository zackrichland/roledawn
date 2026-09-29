-- Employer non-acceptance is a final, retryable outcome (D-111).
--
-- Greenhouse answers a cloud-browser submission with HTTP 428 and emails the
-- applicant a security code. If that code never arrives in time, or every code
-- is refused, the employer did not accept the application. Recording that as
-- UNCERTAIN left the application "Confirming" forever and blocked any new send.
-- Such an attempt now closes as NOT_ACCEPTED: the send runs once more by itself,
-- then the candidate can press Try again. Every other rule is unchanged: an
-- attempt whose outcome is unknown still blocks new sends until reconciled.

alter table public.application_attempts drop constraint application_attempts_status_check;
alter table public.application_attempts add constraint application_attempts_status_check
  check (status in ('STARTED','UNCERTAIN','CONFIRMED','FAILED_SAFE','TAKEOVER','NOT_ACCEPTED'));

create or replace function private.assert_application_agent_binding(p_run_id uuid)
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
      and not exists (select 1 from public.application_attempts x where x.application_id = a.id and x.status <> 'NOT_ACCEPTED')
  ) then raise exception 'APPLICATION_AGENT_BINDING_INACTIVE' using errcode = '55000'; end if;
  return v_run;
end; $$;

create or replace function private.assert_autopilot_lease(p_id uuid,p_lease_token uuid,p_mutating boolean default true)
returns public.application_autopilots language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype;
begin
  select * into strict v_row from public.application_autopilots where id=p_id for update;
  if p_lease_token is null or v_row.lease_token is distinct from p_lease_token or v_row.lease_expires_at<=statement_timestamp()
    or v_row.status not in ('RUNNING','RECONCILING','SUBMITTING') then
    raise exception 'APPLICATION_AUTOPILOT_LEASE_INACTIVE' using errcode='55000'; end if;
  if p_mutating and (v_row.status<>'RUNNING' or v_row.attempt_id is not null or v_row.stop_requested is not null
      or v_row.expires_at<=statement_timestamp()) then
    raise exception 'APPLICATION_AUTOPILOT_MUTATION_DENIED' using errcode='55000'; end if;
  if p_mutating then
    perform 1 from public.applications a
    join public.candidates c on c.id=a.candidate_id and c.workspace_id=a.workspace_id and c.status in ('ONBOARDING','ACTIVE')
    join public.workspaces w on w.id=a.workspace_id and w.status='ACTIVE'
    join public.workspace_memberships m on m.workspace_id=a.workspace_id and m.auth_user_id=v_row.delegated_by and m.status='ACTIVE'
    join public.application_revisions r on r.id=v_row.revision_id and r.application_id=a.id and r.workspace_id=a.workspace_id and r.packet_hash=v_row.packet_hash and r.validation_status='PASSED'
    join public.application_input_snapshots s on s.id=r.input_snapshot_id and s.candidate_input_version=c.application_input_version
    where a.id=v_row.application_id and a.current_revision_id=v_row.revision_id and a.status in ('EXECUTING','TAKEOVER','AUTHORIZED','PRE_SUBMIT_REVIEW')
      and not exists(select 1 from public.application_attempts x where x.application_id=a.id and x.status<>'NOT_ACCEPTED')
    for share of a,c,w,m;
    if not found then raise exception 'APPLICATION_AUTOPILOT_AUTHORITY_STALE' using errcode='55000'; end if;
  end if;
  return v_row;
end; $$;

create or replace function private.delegate_application_autopilot(p_command_id uuid,p_application_id uuid,p_expected_aggregate_version bigint,p_revision_id uuid,p_packet_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_application public.applications%rowtype; v_revision public.application_revisions%rowtype;
  v_existing public.command_dedup%rowtype; v_hash text; v_id uuid:=extensions.gen_random_uuid(); v_event uuid:=extensions.gen_random_uuid();
  v_destination_url text; v_artifact_manifest jsonb; v_fact_disclosure_manifest jsonb; v_disclosure_manifest jsonb; v_destination_url_hash text;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if p_command_id is null or p_application_id is null or p_revision_id is null or p_expected_aggregate_version is null or p_expected_aggregate_version<1 or p_packet_hash is null or p_packet_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'APPLICATION_AUTOPILOT_INPUT_INVALID' using errcode='22023'; end if;
  select a.* into strict v_application from public.applications a
  join public.candidates c on c.id=a.candidate_id and c.workspace_id=a.workspace_id and c.auth_user_id=v_actor and c.status in ('ACTIVE','ONBOARDING')
  join public.workspaces w on w.id=a.workspace_id and w.status='ACTIVE'
  join public.workspace_memberships m on m.workspace_id=a.workspace_id and m.auth_user_id=v_actor and m.status='ACTIVE'
  where a.id=p_application_id for update of a for share of c,w,m;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_application_id,p_expected_aggregate_version,p_revision_id,p_packet_hash)::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_application.workspace_id::text||':'||p_command_id::text,0));
  select * into v_existing from public.command_dedup where workspace_id=v_application.workspace_id and command_id=p_command_id;
  if found then
    if v_existing.command_type<>'DELEGATE_APPLICATION_AUTOPILOT' or v_existing.request_hash<>v_hash or v_existing.actor_id<>v_actor then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode='23505'; end if;
    return v_existing.result||'{"replayed":true}'::jsonb;
  end if;
  if v_application.status<>'READY' or v_application.aggregate_version<>p_expected_aggregate_version or v_application.current_revision_id is distinct from p_revision_id
    or exists(select 1 from public.application_attempts where application_id=p_application_id and status<>'NOT_ACCEPTED')
    or exists(select 1 from public.application_fill_attempts where application_id=p_application_id and status in ('QUEUED','STARTED','TAKEOVER','FILLED_TO_REVIEW')) then
    raise exception 'APPLICATION_AUTOPILOT_REVIEW_STALE' using errcode='PT409'; end if;
  select * into strict v_revision from public.application_revisions where id=p_revision_id and application_id=p_application_id and workspace_id=v_application.workspace_id;
  if v_revision.packet_hash<>p_packet_hash or v_revision.validation_status<>'PASSED' or v_revision.job_version_id is distinct from v_application.job_version_id
    or v_revision.packet_manifest #>> '{authority,state}' is distinct from 'CANDIDATE_REVIEW_REQUIRED'
    or v_revision.packet_manifest #>> '{authority,application_submitted}' is distinct from 'false'
    or not exists(select 1 from public.application_input_snapshots s join public.candidates c on c.id=v_application.candidate_id
      where s.id=v_revision.input_snapshot_id and s.candidate_input_version=c.application_input_version) then
    raise exception 'APPLICATION_AUTOPILOT_REVISION_INVALID' using errcode='55000'; end if;
  select version.apply_url into strict v_destination_url
  from public.job_versions as version
  where version.job_id = v_application.job_id
    and version.id = v_application.job_version_id;
  if v_destination_url is null or not private.is_public_https_job_url(v_destination_url) then
    raise exception 'APPLICATION_FILL_DESTINATION_INVALID' using errcode = '55000';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'artifact_version_id', artifact.id,
      'variant', artifact.variant,
      'display_name', artifact.display_name,
      'mime_type', artifact.mime_type,
      'byte_size', artifact.byte_size,
      'sha256', artifact.sha256,
      'qa_status', artifact.qa_status
    ) order by artifact.variant
  ) into v_artifact_manifest
  from public.artifact_versions as artifact
  where artifact.workspace_id = v_application.workspace_id
    and artifact.application_revision_id = v_revision.id
    and artifact.variant in (
      'RESUME_PDF', 'RESUME_DOCX', 'COVER_LETTER_PDF', 'COVER_LETTER_DOCX', 'APPLICATION_PDF'
    );

  if jsonb_array_length(coalesce(v_artifact_manifest, '[]'::jsonb)) not in (4,5)
     or exists (
       select 1 from jsonb_array_elements(v_artifact_manifest) as item
       where item ->> 'qa_status' <> 'PASSED'
          or item ->> 'sha256' !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'APPLICATION_FILL_ARTIFACT_SET_INVALID' using errcode = '55000';
  end if;

  v_destination_url_hash := encode(extensions.digest(convert_to(v_destination_url, 'utf8'), 'sha256'), 'hex');

  -- Only verified standard EXACT_FIELDS facts that the candidate approved and
  -- that were frozen into this revision may be typed. Sensitive, protected,
  -- narrative-only, and never-autofill facts are excluded even when approved.
  -- Values remain outside the authorization manifest and are represented by a
  -- deterministic hash.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'fact_version_id', version.id,
      'fact_key', fact.fact_key,
      'value_hash', encode(extensions.digest(convert_to(version.value_json::text, 'utf8'), 'sha256'), 'hex'),
      'candidate_disposition', version.candidate_disposition
    ) order by fact.fact_key, version.id
  ), '[]'::jsonb) into v_fact_disclosure_manifest
  from public.application_snapshot_fact_refs as snapshot_ref
  join public.candidate_fact_versions as version
    on version.workspace_id = snapshot_ref.workspace_id
   and version.candidate_id = snapshot_ref.candidate_id
   and version.id = snapshot_ref.fact_version_id
  join public.candidate_facts as fact
    on fact.workspace_id = version.workspace_id
   and fact.candidate_id = version.candidate_id
   and fact.id = version.fact_id
  where snapshot_ref.workspace_id = v_application.workspace_id
    and snapshot_ref.candidate_id = v_application.candidate_id
    and snapshot_ref.application_id = v_application.id
    and snapshot_ref.input_snapshot_id = v_revision.input_snapshot_id
    and version.candidate_disposition = 'APPROVED'
    and version.reviewed_at is not null
    and (fact.sensitivity = 'STANDARD' or (fact.sensitivity = 'SENSITIVE' and fact.fact_key in (
      'work_authorization.us.authorized','work_authorization.us.sponsorship_required',
      'work_authorization.ca.authorized','work_authorization.ca.sponsorship_required'
    )))
    and fact.usage_policy = 'EXACT_FIELDS'
    and fact.verification_status = 'VERIFIED';

  v_disclosure_manifest := jsonb_build_object(
    'destination_origin', regexp_replace(v_destination_url, '^((https://[^/]+)).*$', '\1'),
    'destination_url_hash', v_destination_url_hash,
    'allowed_fact_versions', v_fact_disclosure_manifest,
    'artifacts', v_artifact_manifest,
    'policy', jsonb_build_object(
      'unknown_field', 'TAKEOVER',
      'sensitive_field_without_exact_fact', 'TAKEOVER',
      'captcha_or_otp', 'TAKEOVER',
      'submit_authorized', false
    ),
    'policy_release', 'fill-disclosure-policy/1'
  );
  if not (v_artifact_manifest @> '[{"variant":"RESUME_PDF"},{"variant":"RESUME_DOCX"},{"variant":"COVER_LETTER_PDF"},{"variant":"COVER_LETTER_DOCX"}]'::jsonb) then
    raise exception 'APPLICATION_AUTOPILOT_ARTIFACT_SET_INVALID' using errcode='55000'; end if;
  insert into public.application_autopilots(id,workspace_id,candidate_id,application_id,revision_id,delegated_by,command_id,packet_hash,destination_url,artifact_manifest,disclosure_manifest)
    values(v_id,v_application.workspace_id,v_application.candidate_id,p_application_id,p_revision_id,v_actor,p_command_id,p_packet_hash,v_destination_url,v_artifact_manifest,v_disclosure_manifest);
  insert into private.application_autopilot_runtime(autopilot_id) values(v_id);
  update public.applications as a set status='EXECUTING',aggregate_version=a.aggregate_version+1,updated_at=statement_timestamp() where a.id=p_application_id;
  insert into public.domain_events(id,workspace_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,actor_kind,actor_id,correlation_id)
    values(v_event,v_application.workspace_id,'APPLICATION',p_application_id,v_application.aggregate_version+1,'application.autopilot_delegated',
      jsonb_build_object('autopilot_id',v_id,'revision_id',p_revision_id,'packet_hash',p_packet_hash,'application_submitted',false),'CANDIDATE',v_actor,p_command_id);
  v_result:=jsonb_build_object('id',v_id,'application_id',p_application_id,'aggregate_version',v_application.aggregate_version+1,'replayed',false);
  insert into public.command_dedup(workspace_id,command_id,actor_id,command_type,request_hash,status,aggregate_type,aggregate_id,result,result_event_id,completed_at)
    values(v_application.workspace_id,p_command_id,v_actor,'DELEGATE_APPLICATION_AUTOPILOT',v_hash,'COMMITTED','APPLICATION',p_application_id,v_result,v_event,statement_timestamp());
  return v_result;
end; $$;

create or replace function private.control_application_autopilot(p_command_id uuid,p_id uuid,p_expected_version bigint,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_existing public.command_dedup%rowtype; v_hash text; v_result jsonb; v_status text;
begin
  v_row:=private.assert_autopilot_candidate(p_id);
  if p_command_id is null or p_expected_version is null or p_action is null or p_action not in ('PAUSE','RESUME','CANCEL') then
    raise exception 'APPLICATION_AUTOPILOT_CONTROL_INVALID' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_id,p_expected_version,p_action)::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_row.workspace_id::text||':'||p_command_id::text,0));
  select * into v_existing from public.command_dedup where workspace_id=v_row.workspace_id and command_id=p_command_id;
  if found then
    if v_existing.command_type<>'CONTROL_APPLICATION_AUTOPILOT' or v_existing.actor_id<>auth.uid() or v_existing.request_hash<>v_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode='23505'; end if;
    return v_existing.result||'{"replayed":true}'::jsonb;
  end if;
  if v_row.version<>p_expected_version or v_row.status in ('CONFIRMED','CANCELED') or (v_row.status='FAILED_SAFE' and p_action<>'RESUME') then raise exception 'APPLICATION_AUTOPILOT_CONTROL_STALE' using errcode='PT409'; end if;
  if p_action='RESUME' then
    if v_row.attempt_id is not null or v_row.status not in ('PAUSED','FAILED_SAFE') or v_row.expires_at<=statement_timestamp()
      or not exists(select 1 from public.applications a
        join public.application_revisions r on r.id=a.current_revision_id and r.application_id=a.id and r.packet_hash=v_row.packet_hash and r.validation_status='PASSED'
        join public.application_input_snapshots s on s.id=r.input_snapshot_id
        join public.candidates c on c.id=a.candidate_id and c.application_input_version=s.candidate_input_version
        where a.id=v_row.application_id and r.id=v_row.revision_id)
      or exists(select 1 from public.application_attempts where application_id=v_row.application_id and status<>'NOT_ACCEPTED') then
      raise exception 'APPLICATION_AUTOPILOT_RESUME_DENIED' using errcode='55000'; end if;
    v_status:=case when exists(select 1 from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN') then 'WAITING_ANSWERS' else 'QUEUED' end;
  else v_status:=case when v_row.attempt_id is not null then 'UNCERTAIN' when p_action='CANCEL' then 'CANCELED' else 'PAUSED' end; end if;
  update public.application_autopilots set status=v_status,stop_requested=case when p_action='RESUME' then null else p_action end,
    sealed_diff=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else sealed_diff end,
    sealed_diff_hash=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else sealed_diff_hash end,
    readback_hash=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else readback_hash end,
    request_fingerprint=case when p_action='RESUME' and v_row.status='FAILED_SAFE' then null else request_fingerprint end,
    failure_code=case when p_action='RESUME' then null else failure_code end,
    lease_token=null,lease_owner=null,lease_expires_at=null,version=version+1,available_at=statement_timestamp(),updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_controlled',case when v_status='UNCERTAIN' then 'RECONCILING' when v_status='CANCELED' then 'CANCELED' when v_status='QUEUED' then 'EXECUTING' else 'TAKEOVER' end);
  v_result:=jsonb_build_object('id',p_id,'version',v_row.version+1,'status',v_status,'replayed',false);
  insert into public.command_dedup(workspace_id,command_id,actor_id,command_type,request_hash,status,aggregate_type,aggregate_id,result,completed_at)
    values(v_row.workspace_id,p_command_id,auth.uid(),'CONTROL_APPLICATION_AUTOPILOT',v_hash,'COMMITTED','APPLICATION',v_row.application_id,v_result,statement_timestamp());
  return v_result;
end; $$;

create or replace function public.begin_application_autopilot_submit(p_id uuid,p_lease_token uuid,p_seal_hash text,p_request_fingerprint text,p_adapter_release text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_approval uuid:=extensions.gen_random_uuid(); v_consumption uuid:=extensions.gen_random_uuid();
 v_attempt uuid:=extensions.gen_random_uuid(); v_key text; v_manifest jsonb; v_authority_hash text; v_retry integer; v_command uuid;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,true);
  if v_row.sealed_diff_hash is null or v_row.sealed_diff_hash is distinct from p_seal_hash or v_row.request_fingerprint is distinct from p_request_fingerprint
    or p_adapter_release is null or char_length(btrim(p_adapter_release)) not between 1 and 120
    or exists(select 1 from public.application_attempts where application_id=v_row.application_id and status<>'NOT_ACCEPTED') then
    raise exception 'APPLICATION_AUTOPILOT_SUBMIT_DENIED' using errcode='55000'; end if;
  -- The first send keeps its original key and command; each send after an
  -- explicit employer non-acceptance gets its own, derived from its number.
  select count(*) into v_retry from public.application_attempts where application_id=v_row.application_id and status='NOT_ACCEPTED';
  v_key:='autopilot:'||p_id::text||case when v_retry=0 then '' else ':'||v_retry::text end;
  v_command:=case when v_retry=0 then p_id else md5(p_id::text||':retry:'||v_retry::text)::uuid end;
  v_manifest:=jsonb_build_object('permitted_action','SUBMIT_APPLICATION_ONCE','submission_authority',true,
    'authority_scope','ONE_JOB_AUTOPILOT','delegation_id',p_id,'delegated_by',v_row.delegated_by,'revision_id',v_row.revision_id,
    'packet_hash',v_row.packet_hash,'sealed_diff_hash',p_seal_hash,'request_fingerprint',p_request_fingerprint,'destination_url',v_row.destination_url);
  v_authority_hash:=encode(extensions.digest(convert_to(v_manifest::text,'utf8'),'sha256'),'hex');
  insert into public.approval_challenges(id,workspace_id,candidate_id,application_id,revision_id,permitted_action,diff_hash,nonce_hash,authority_manifest,authority_hash,expires_at)
    values(v_approval,v_row.workspace_id,v_row.candidate_id,v_row.application_id,v_row.revision_id,'SUBMIT_APPLICATION_ONCE',p_seal_hash,
      encode(extensions.digest(convert_to(v_approval::text||p_id::text,'utf8'),'sha256'),'hex'),v_manifest,v_authority_hash,statement_timestamp()+interval '2 minutes');
  insert into public.approval_consumptions(id,workspace_id,approval_id,application_id,revision_id,consumed_by,command_id,permitted_action)
    values(v_consumption,v_row.workspace_id,v_approval,v_row.application_id,v_row.revision_id,v_row.delegated_by,v_command,'SUBMIT_APPLICATION_ONCE');
  insert into public.application_attempts(id,workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
    values(v_attempt,v_row.workspace_id,v_row.application_id,v_row.revision_id,v_consumption,'SUBMIT_APPLICATION_ONCE',v_key,p_adapter_release,'STARTED',
      jsonb_build_object('autopilot_id',p_id,'sealed_diff_hash',p_seal_hash,'request_fingerprint',p_request_fingerprint));
  update public.application_autopilots set attempt_id=v_attempt,status='SUBMITTING',version=version+1,updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_submit_started','RECONCILING');
  -- This is the only response that permits one network submission. Replays fail.
  return jsonb_build_object('attempt_id',v_attempt,'idempotency_key',v_key,'seal_hash',p_seal_hash,'request_fingerprint',p_request_fingerprint);
end; $$;

create or replace function private.stop_unsent_auto_apply(p_candidate uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;
begin
  -- Work already submitted remains observable/reconcilable, even after consent is withdrawn.
  for r in select a.id from public.application_autopilots a join public.auto_apply_enrollments e on e.application_id=a.application_id
    where e.candidate_id=p_candidate and a.attempt_id is null and a.status not in ('CANCELED','FAILED_SAFE','CONFIRMED') for update of a
  loop
    update public.application_autopilots set stop_requested='CANCEL',status=case when status='RUNNING' then status else 'CANCELED' end,
      version=version+1,updated_at=statement_timestamp() where id=r.id;
  end loop;
  -- No draft/fill may be published after pause. Existing immutable files remain available.
  update public.application_runs run set status='CANCELED',finished_at=statement_timestamp(),error_code='AUTO_APPLY_CONSENT_WITHDRAWN'
    from public.auto_apply_enrollments e where e.application_id=run.application_id and e.candidate_id=p_candidate
      and run.status in ('QUEUED','RUNNING','WAITING') and not exists(select 1 from public.application_attempts a where a.application_id=e.application_id and a.status<>'NOT_ACCEPTED');
  update public.applications a set status='CANCELED',aggregate_version=a.aggregate_version+1,updated_at=statement_timestamp()
    from public.auto_apply_enrollments e where e.application_id=a.id and e.candidate_id=p_candidate
      and a.status not in ('CONFIRMED','RECONCILING','CANCELED') and not exists(select 1 from public.application_attempts x where x.application_id=a.id and x.status<>'NOT_ACCEPTED');
end; $$;

create or replace function public.finish_application_autopilot(p_id uuid,p_lease_token uuid,p_outcome text,p_failure_code text default null,p_receipt jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_outcome text:=p_outcome; v_refusals integer; v_next text;
begin
  select * into strict v_row from public.application_autopilots where id=p_id for update;
  if p_lease_token is null or v_row.lease_token is distinct from p_lease_token or v_row.status not in ('RUNNING','SUBMITTING','RECONCILING')
    or p_outcome is null or p_outcome not in ('CONFIRMED','UNCERTAIN','FAILED_SAFE','NOT_ACCEPTED')
    or (p_failure_code is not null and p_failure_code !~ '^[A-Z][A-Z0-9_]{2,119}$') then
    raise exception 'APPLICATION_AUTOPILOT_COMPLETION_INVALID' using errcode='55000'; end if;
  -- The employer answered this attempt's one submission with its emailed-code
  -- challenge, and the challenge was never satisfied (no code in time, or every
  -- code refused). Nothing was accepted, so the attempt closes and the send may
  -- run again: once automatically, then when the candidate presses Try again.
  if p_outcome='NOT_ACCEPTED' then
    if v_row.attempt_id is null
      or p_failure_code is distinct from 'DELIVERY_EMAIL_VERIFICATION_TIMEOUT' and p_failure_code is distinct from 'DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED' then
      raise exception 'APPLICATION_AUTOPILOT_COMPLETION_INVALID' using errcode='55000'; end if;
    update public.application_attempts set status='NOT_ACCEPTED',completed_at=statement_timestamp(),
      result_summary=result_summary||jsonb_build_object('not_accepted_reason',p_failure_code)
      where id=v_row.attempt_id and status='STARTED';
    if not found then raise exception 'APPLICATION_AUTOPILOT_COMPLETION_INVALID' using errcode='55000'; end if;
    select count(*) into v_refusals from public.application_attempts where application_id=v_row.application_id and status='NOT_ACCEPTED';
    v_next:=case when v_row.stop_requested='CANCEL' then 'CANCELED' when v_row.stop_requested='PAUSE' then 'PAUSED'
      when v_refusals<2 and v_row.expires_at>statement_timestamp()+interval '15 minutes' then 'QUEUED' else 'FAILED_SAFE' end;
    update public.application_autopilots set status=v_next,failure_code=case when v_next='QUEUED' then null else p_failure_code end,
      attempt_id=null,sealed_diff=null,sealed_diff_hash=null,readback_hash=null,request_fingerprint=null,
      stop_requested=case when v_next in ('CANCELED','PAUSED') then stop_requested else null end,
      lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,updated_at=statement_timestamp(),
      available_at=statement_timestamp()+interval '1 minute' where id=p_id;
    perform private.autopilot_event(p_id,'application.autopilot_not_accepted',
      case v_next when 'QUEUED' then 'EXECUTING' when 'PAUSED' then 'TAKEOVER' else v_next end);
    return;
  end if;
  if v_row.attempt_id is not null and p_outcome='FAILED_SAFE' then v_outcome:='UNCERTAIN'; end if;
  if v_row.attempt_id is null and v_outcome in ('CONFIRMED','UNCERTAIN') then
    raise exception 'APPLICATION_AUTOPILOT_ATTEMPT_REQUIRED' using errcode='55000'; end if;
  if v_outcome='CONFIRMED' then
    if jsonb_typeof(p_receipt) is distinct from 'object' or p_receipt->>'confirmationKind' not in ('PORTAL','EMAIL','EXTERNAL_RECEIPT')
      or coalesce(char_length(btrim(p_receipt->>'confirmationReference')),0) not between 1 and 2000
      or coalesce(p_receipt->>'receiptHash','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_receipt->'evidenceManifest') is distinct from 'object'
      or p_receipt#>>'{evidenceManifest,autopilotId}' is distinct from p_id::text
      or p_receipt#>>'{evidenceManifest,revisionId}' is distinct from v_row.revision_id::text
      or p_receipt#>>'{evidenceManifest,packetHash}' is distinct from v_row.packet_hash
      or p_receipt#>>'{evidenceManifest,attemptId}' is distinct from v_row.attempt_id::text
      or p_receipt#>>'{evidenceManifest,requestFingerprint}' is distinct from v_row.request_fingerprint
      or (p_receipt->>'confirmedAt')::timestamptz is null or octet_length(p_receipt::text)>262144 then
      raise exception 'APPLICATION_AUTOPILOT_RECEIPT_INVALID' using errcode='22023'; end if;
    update public.application_attempts set status='CONFIRMED',completed_at=statement_timestamp() where id=v_row.attempt_id;
    insert into public.receipts(workspace_id,application_id,attempt_id,confirmation_kind,confirmation_reference,evidence_manifest,receipt_hash,confirmed_at)
      values(v_row.workspace_id,v_row.application_id,v_row.attempt_id,p_receipt->>'confirmationKind',p_receipt->>'confirmationReference',
        p_receipt->'evidenceManifest',p_receipt->>'receiptHash',(p_receipt->>'confirmedAt')::timestamptz);
  elsif v_row.attempt_id is not null then
    update public.application_attempts set status='UNCERTAIN',completed_at=statement_timestamp() where id=v_row.attempt_id;
  end if;
  update public.application_autopilots set status=v_outcome,failure_code=case when v_outcome='CONFIRMED' then null else p_failure_code end,
    lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,updated_at=statement_timestamp(),available_at=statement_timestamp()+interval '5 minutes' where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_completed',case when v_outcome='UNCERTAIN' then 'RECONCILING' else v_outcome end);
end; $$;
