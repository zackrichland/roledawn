-- One candidate delegation for one immutable application packet. Browser delivery
-- is separate from fill-only tables. No public/candidate direct writes are granted.
create table public.application_autopilots (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null, application_id uuid not null, revision_id uuid not null,
  delegated_by uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null, packet_hash text not null check(packet_hash ~ '^[0-9a-f]{64}$'),
  destination_url text not null check(private.is_public_https_job_url(destination_url)),
  artifact_manifest jsonb not null check(jsonb_typeof(artifact_manifest)='array'),
  disclosure_manifest jsonb not null check(jsonb_typeof(disclosure_manifest)='object'),
  status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','WAITING_ANSWERS','PAUSED','SUBMITTING','UNCERTAIN','RECONCILING','CONFIRMED','CANCELED','FAILED_SAFE')),
  version bigint not null default 1 check(version>0),
  lease_token uuid, lease_owner text, lease_expires_at timestamptz,
  available_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
  stop_requested text check(stop_requested in ('PAUSE','CANCEL')),
  sealed_diff jsonb, sealed_diff_hash text check(sealed_diff_hash ~ '^[0-9a-f]{64}$'),
  readback_hash text check(readback_hash ~ '^[0-9a-f]{64}$'), request_fingerprint text check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  attempt_id uuid references public.application_attempts(id) on delete restrict,
  failure_code text check(failure_code ~ '^[A-Z][A-Z0-9_]{2,119}$'),
  reconcile_count integer not null default 0 check(reconcile_count between 0 and 3),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,command_id),
  foreign key(workspace_id,candidate_id,application_id) references public.applications(workspace_id,candidate_id,id) on delete cascade,
  foreign key(workspace_id,application_id,revision_id) references public.application_revisions(workspace_id,application_id,id) on delete restrict,
  check((sealed_diff is null and sealed_diff_hash is null and readback_hash is null and request_fingerprint is null)
    or (jsonb_typeof(sealed_diff)='object' and sealed_diff_hash is not null and readback_hash is not null and request_fingerprint is not null)),
  check(attempt_id is null or sealed_diff_hash is not null)
);
create unique index application_autopilots_one_active on public.application_autopilots(application_id)
  where status not in ('CANCELED','FAILED_SAFE');
create index application_autopilots_claim on public.application_autopilots(available_at,created_at,id)
  where status in ('QUEUED','RUNNING','SUBMITTING','UNCERTAIN','RECONCILING');
create index application_autopilots_candidate on public.application_autopilots(candidate_id,created_at desc,id);
create index application_autopilots_revision on public.application_autopilots(workspace_id,application_id,revision_id);
create index application_autopilots_delegator on public.application_autopilots(delegated_by);
create index application_autopilots_attempt on public.application_autopilots(attempt_id) where attempt_id is not null;
create table private.application_autopilot_runtime (
  autopilot_id uuid primary key references public.application_autopilots(id) on delete cascade,
  runtime_reference text, runtime_lease uuid,
  checkpoint jsonb not null default '{}' check(jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=262144),
  agent_session_id text, agent_session_lease uuid, agent_session_ids text[] not null default '{}'
);
create table public.application_autopilot_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  autopilot_id uuid not null references public.application_autopilots(id) on delete cascade,
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'), descriptor jsonb not null,
  status text not null default 'OPEN' check(status in ('OPEN','ANSWERED','SUPERSEDED')),
  created_at timestamptz not null default now(), unique(autopilot_id,fingerprint),
  check(jsonb_typeof(descriptor)='object' and octet_length(descriptor::text)<=100000)
);
create table public.application_autopilot_answers (
  id uuid primary key default extensions.gen_random_uuid(),
  question_id uuid not null unique references public.application_autopilot_questions(id) on delete cascade,
  value_json jsonb not null check(jsonb_typeof(value_json) in ('string','boolean','array') and octet_length(value_json::text)<=40000),
  answered_by uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null, created_at timestamptz not null default now()
);
create index application_autopilot_answers_actor on public.application_autopilot_answers(answered_by);
create table private.application_autopilot_tool_calls (
  autopilot_id uuid not null references public.application_autopilots(id) on delete cascade,
  session_id text not null, turn_id text not null, call_id text not null,
  tool_name text not null, arguments_hash text not null check(arguments_hash ~ '^[0-9a-f]{64}$'),
  lease_token uuid not null, result jsonb, created_at timestamptz not null default now(),
  primary key(autopilot_id,session_id,turn_id,call_id),
  check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=262144))
);
create trigger application_autopilot_answers_immutable before update on public.application_autopilot_answers
  for each row execute function private.reject_row_mutation();

alter table public.application_autopilots enable row level security;
alter table public.application_autopilot_questions enable row level security;
alter table public.application_autopilot_answers enable row level security;
alter table private.application_autopilot_runtime enable row level security;
alter table private.application_autopilot_tool_calls enable row level security;
create policy application_autopilots_owner_select on public.application_autopilots for select to authenticated using(exists(
  select 1 from public.candidates c where c.id=application_autopilots.candidate_id and c.workspace_id=application_autopilots.workspace_id and c.auth_user_id=(select auth.uid())
));
create policy application_autopilot_questions_owner_select on public.application_autopilot_questions for select to authenticated using(exists(
  select 1 from public.application_autopilots a where a.id=autopilot_id
));
create policy application_autopilot_answers_owner_select on public.application_autopilot_answers for select to authenticated using(exists(
  select 1 from public.application_autopilot_questions q where q.id=question_id
));
revoke all on public.application_autopilots,public.application_autopilot_questions,public.application_autopilot_answers from public,anon,authenticated,service_role;
grant select on public.application_autopilots,public.application_autopilot_questions,public.application_autopilot_answers to authenticated,service_role;
revoke all on private.application_autopilot_runtime,private.application_autopilot_tool_calls from public,anon,authenticated,service_role;

create function private.assert_autopilot_candidate(p_id uuid)
returns public.application_autopilots language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select a.* into strict v_row from public.application_autopilots a
  join public.candidates c on c.id=a.candidate_id and c.workspace_id=a.workspace_id and c.auth_user_id=auth.uid() and c.status in ('ACTIVE','ONBOARDING')
  join public.workspaces w on w.id=a.workspace_id and w.status='ACTIVE'
  join public.workspace_memberships m on m.workspace_id=a.workspace_id and m.auth_user_id=auth.uid() and m.status='ACTIVE'
  where a.id=p_id for update of a for share of c,w,m;
  return v_row;
end; $$;

create function private.assert_autopilot_lease(p_id uuid,p_lease_token uuid,p_mutating boolean default true)
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
      and not exists(select 1 from public.application_attempts x where x.application_id=a.id)
    for share of a,c,w,m;
    if not found then raise exception 'APPLICATION_AUTOPILOT_AUTHORITY_STALE' using errcode='55000'; end if;
  end if;
  return v_row;
end; $$;

create function private.delegate_application_autopilot(p_command_id uuid,p_application_id uuid,p_expected_aggregate_version bigint,p_revision_id uuid,p_packet_hash text)
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
    or exists(select 1 from public.application_attempts where application_id=p_application_id)
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
create function public.delegate_application_autopilot(p_command_id uuid,p_application_id uuid,p_expected_aggregate_version bigint,p_revision_id uuid,p_packet_hash text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.delegate_application_autopilot(p_command_id,p_application_id,p_expected_aggregate_version,p_revision_id,p_packet_hash);
$$;

create function private.autopilot_event(p_id uuid,p_event text,p_application_status text)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_version bigint;
begin
  select * into strict v_row from public.application_autopilots where id=p_id;
  update public.applications a set status=p_application_status,aggregate_version=a.aggregate_version+1,updated_at=statement_timestamp()
    where a.id=v_row.application_id returning a.aggregate_version into v_version;
  insert into public.domain_events(id,workspace_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,actor_kind,correlation_id)
    values(extensions.gen_random_uuid(),v_row.workspace_id,'APPLICATION',v_row.application_id,v_version,p_event,
      jsonb_build_object('autopilot_id',p_id,'revision_id',v_row.revision_id,'status',v_row.status),'SYSTEM',p_id);
end; $$;

create function public.claim_application_autopilot(p_worker_id text,p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_runtime private.application_autopilot_runtime%rowtype;
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 120 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    raise exception 'APPLICATION_AUTOPILOT_CLAIM_INVALID' using errcode='22023'; end if;
  select a.* into v_row from public.application_autopilots a where a.available_at<=statement_timestamp()
    and (a.lease_expires_at is null or a.lease_expires_at<=statement_timestamp())
    and ((a.status in ('QUEUED','RUNNING') and a.attempt_id is null and a.stop_requested is null and a.expires_at>statement_timestamp())
      or (a.status in ('SUBMITTING','UNCERTAIN','RECONCILING') and a.attempt_id is not null and a.reconcile_count<3))
    order by a.available_at,a.created_at,a.id for update skip locked limit 1;
  if not found then return null; end if;
  update public.application_autopilots set status=case when attempt_id is null then 'RUNNING' else 'RECONCILING' end,
    lease_token=extensions.gen_random_uuid(),lease_owner=p_worker_id,lease_expires_at=statement_timestamp()+make_interval(secs=>p_lease_seconds),
    reconcile_count=reconcile_count+case when attempt_id is null then 0 else 1 end,version=version+1,updated_at=statement_timestamp()
    where id=v_row.id returning * into v_row;
  -- Never reopen the submit permission on recovery. A prior attempt only permits observation.
  select * into strict v_runtime from private.application_autopilot_runtime where autopilot_id=v_row.id;
  return jsonb_build_object('id',v_row.id,'workspace_id',v_row.workspace_id,'candidate_id',v_row.candidate_id,'application_id',v_row.application_id,
    'revision_id',v_row.revision_id,'packet_hash',v_row.packet_hash,'destination_url',v_row.destination_url,'artifact_manifest',v_row.artifact_manifest,
    'disclosure_manifest',v_row.disclosure_manifest,'status',v_row.status,'mode',case when v_row.attempt_id is null then 'FILL' else 'RECONCILE' end,
    'lease_token',v_row.lease_token,'lease_expires_at',v_row.lease_expires_at,'checkpoint',v_runtime.checkpoint,
    'runtime_reference',v_runtime.runtime_reference,'attempt_id',v_row.attempt_id,'sealed_diff_hash',v_row.sealed_diff_hash);
end; $$;
create function public.assert_application_autopilot_lease(p_id uuid,p_lease_token uuid,p_mutating boolean default true)
returns void language plpgsql security definer set search_path='' as $$
begin perform private.assert_autopilot_lease(p_id,p_lease_token,p_mutating); end; $$;
create function public.checkpoint_application_autopilot(p_id uuid,p_lease_token uuid,p_stage text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_autopilot_lease(p_id,p_lease_token,false);
  if p_stage is null or p_stage !~ '^[A-Z][A-Z0-9_]{0,79}$' or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>131072 then
    raise exception 'APPLICATION_AUTOPILOT_CHECKPOINT_INVALID' using errcode='22023'; end if;
  update private.application_autopilot_runtime set checkpoint=checkpoint||p_data||jsonb_build_object('stage',p_stage) where autopilot_id=p_id;
end; $$;

create table private.application_autopilot_resources (
  id uuid primary key default extensions.gen_random_uuid(),autopilot_id uuid not null references public.application_autopilots(id) on delete cascade,
  kind text not null check(kind in ('AGENT','BROWSER')),reference text not null check(reference ~ '^[A-Za-z0-9_-]{1,128}$'),
  lease_token uuid not null,deleted_at timestamptz,cleanup_after timestamptz not null default now()+interval '10 minutes',
  created_at timestamptz not null default now(),unique(autopilot_id,kind,reference)
);
create index application_autopilot_resources_cleanup on private.application_autopilot_resources(cleanup_after,id) where deleted_at is null;
alter table private.application_autopilot_resources enable row level security;
revoke all on private.application_autopilot_resources from public,anon,authenticated,service_role;
create function public.bind_application_autopilot_resource(p_id uuid,p_lease_token uuid,p_kind text,p_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare v_reference text; v_runtime private.application_autopilot_runtime%rowtype;
begin
  if p_kind is null or p_kind not in ('AGENT','BROWSER') then raise exception 'APPLICATION_AUTOPILOT_RESOURCE_INVALID' using errcode='22023'; end if;
  if p_reference is not null then
    perform private.assert_autopilot_lease(p_id,p_lease_token,false);
    if p_reference !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'APPLICATION_AUTOPILOT_RESOURCE_INVALID' using errcode='22023'; end if;
    insert into private.application_autopilot_resources(autopilot_id,kind,reference,lease_token)
      values(p_id,p_kind,p_reference,p_lease_token) on conflict(autopilot_id,kind,reference) do nothing;
    if p_kind='AGENT' then
      update private.application_autopilot_runtime set agent_session_id=p_reference,agent_session_lease=p_lease_token,
        agent_session_ids=case when p_reference=any(agent_session_ids) then agent_session_ids else array_append(agent_session_ids,p_reference) end where autopilot_id=p_id;
    else update private.application_autopilot_runtime set runtime_reference=p_reference,runtime_lease=p_lease_token where autopilot_id=p_id; end if;
  else
    -- Cleanup can record success after pause/cancel, but a stale finalizer cannot
    -- clear a reference subsequently rebound by another lease.
    select * into strict v_runtime from private.application_autopilot_runtime where autopilot_id=p_id for update;
    if p_kind='AGENT' and v_runtime.agent_session_lease=p_lease_token then
      v_reference:=v_runtime.agent_session_id;
      update private.application_autopilot_runtime set agent_session_id=null,agent_session_lease=null where autopilot_id=p_id;
    elsif p_kind='BROWSER' and v_runtime.runtime_lease=p_lease_token then
      v_reference:=v_runtime.runtime_reference;
      update private.application_autopilot_runtime set runtime_reference=null,runtime_lease=null,checkpoint=checkpoint||'{"runtimeState":"RELEASED"}'::jsonb where autopilot_id=p_id;
    end if;
    update private.application_autopilot_resources set deleted_at=statement_timestamp() where autopilot_id=p_id and kind=p_kind and reference=v_reference and lease_token=p_lease_token;
  end if;
end; $$;
create function public.claim_application_autopilot_cleanup(p_limit integer default 20)
returns setof private.application_autopilot_resources language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'APPLICATION_AUTOPILOT_CLEANUP_INVALID' using errcode='22023'; end if;
  return query with pending as (
    select r.id from private.application_autopilot_resources r join public.application_autopilots a on a.id=r.autopilot_id
    where r.deleted_at is null and r.cleanup_after<=statement_timestamp()
      and (a.lease_expires_at is null or a.lease_expires_at<=statement_timestamp() or a.status in ('WAITING_ANSWERS','PAUSED','CANCELED','CONFIRMED','FAILED_SAFE'))
    order by r.cleanup_after,r.id for update of r skip locked limit p_limit
  ) update private.application_autopilot_resources r set cleanup_after=statement_timestamp()+interval '5 minutes' from pending p where r.id=p.id returning r.*;
end; $$;
create function public.acknowledge_application_autopilot_cleanup(p_resource_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_resource private.application_autopilot_resources%rowtype;
begin
  update private.application_autopilot_resources set deleted_at=coalesce(deleted_at,statement_timestamp()) where id=p_resource_id returning * into strict v_resource;
  if v_resource.kind='BROWSER' then
    update private.application_autopilot_runtime set runtime_reference=null,runtime_lease=null,checkpoint=checkpoint||'{"runtimeState":"RELEASED"}'::jsonb where autopilot_id=v_resource.autopilot_id and runtime_reference=v_resource.reference;
  else
    update private.application_autopilot_runtime set agent_session_id=null,agent_session_lease=null where autopilot_id=v_resource.autopilot_id and agent_session_id=v_resource.reference;
  end if;
end; $$;
create function public.request_application_autopilot_questions(p_id uuid,p_lease_token uuid,p_questions jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_item jsonb; v_existing public.application_autopilot_questions%rowtype;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,true);
  if v_row.sealed_diff_hash is not null or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>24 then
    raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
  if (select count(distinct value->>'fingerprint') from jsonb_array_elements(p_questions))<>jsonb_array_length(p_questions) then
    raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item->>'fingerprint','') !~ '^[0-9a-f]{64}$'
      or coalesce(char_length(btrim(v_item->>'fieldId')),0) not between 1 and 160
      or coalesce(char_length(btrim(v_item->>'label')),0) not between 1 and 1000
      or coalesce(v_item->>'kind','') not in ('TEXT','LONG_TEXT','BOOLEAN','SINGLE_SELECT','MULTI_SELECT')
      or jsonb_typeof(v_item->'required') is distinct from 'boolean'
      or coalesce(v_item->>'reasonCode','') not in ('MISSING_EXACT_ANSWER','SENSITIVE_REQUIRES_CANDIDATE','AMBIGUOUS_ANSWER')
      or jsonb_typeof(v_item->'options') is distinct from 'array' then
      raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
    if jsonb_array_length(v_item->'options')>80 or ((v_item->>'kind' in ('SINGLE_SELECT','MULTI_SELECT')) is distinct from (jsonb_array_length(v_item->'options')>0))
      or exists(select 1 from jsonb_array_elements(v_item->'options') o where jsonb_typeof(o->'value') is distinct from 'string' or jsonb_typeof(o->'label') is distinct from 'string'
        or char_length(btrim(o->>'value')) not between 1 and 500 or char_length(btrim(o->>'label')) not between 1 and 500)
      or (select count(distinct o->>'value') from jsonb_array_elements(v_item->'options') o)<>jsonb_array_length(v_item->'options') then
      raise exception 'APPLICATION_AUTOPILOT_QUESTIONS_INVALID' using errcode='22023'; end if;
    select * into v_existing from public.application_autopilot_questions where autopilot_id=p_id and fingerprint=v_item->>'fingerprint' for update;
    if found then
      if v_existing.descriptor<>v_item then raise exception 'APPLICATION_AUTOPILOT_FIELD_CHANGED' using errcode='PT409'; end if;
      if v_existing.status='SUPERSEDED' then update public.application_autopilot_questions set status='OPEN' where id=v_existing.id; end if;
    else
      if (select count(*) from public.application_autopilot_questions where autopilot_id=p_id)>=96 then
        raise exception 'APPLICATION_AUTOPILOT_QUESTION_LIMIT' using errcode='55000'; end if;
      insert into public.application_autopilot_questions(autopilot_id,fingerprint,descriptor) values(p_id,v_item->>'fingerprint',v_item);
    end if;
  end loop;
  update public.application_autopilot_questions q set status='SUPERSEDED' where q.autopilot_id=p_id and q.status='OPEN'
    and not exists(select 1 from jsonb_array_elements(p_questions) x where x->>'fingerprint'=q.fingerprint);
  if exists(select 1 from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN') then
    update public.application_autopilots set status='WAITING_ANSWERS',lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,updated_at=statement_timestamp() where id=p_id;
    perform private.autopilot_event(p_id,'application.autopilot_questions_requested','TAKEOVER');
  end if;
end; $$;
create function public.read_application_autopilot_answers(p_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.assert_autopilot_lease(p_id,p_lease_token,false);
  select coalesce(jsonb_agg(jsonb_build_object('answer_id',a.id,'field_id',q.descriptor->>'fieldId','fingerprint',q.fingerprint,'value',a.value_json,'descriptor',q.descriptor)),'[]')
    into v_result from public.application_autopilot_questions q join public.application_autopilot_answers a on a.question_id=q.id where q.autopilot_id=p_id and q.status='ANSWERED';
  return v_result;
end; $$;
create function private.save_application_autopilot_answers(p_command_id uuid,p_id uuid,p_expected_version bigint,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_existing public.command_dedup%rowtype;
  v_answer jsonb; v_value jsonb; v_question public.application_autopilot_questions%rowtype; v_hash text; v_result jsonb;
begin
  v_row:=private.assert_autopilot_candidate(p_id);
  if p_command_id is null or p_expected_version is null or p_expected_version<1 or jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers) not between 1 and 24 then
    raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_array(p_id,p_expected_version,(select jsonb_agg(value order by value->>'questionId') from jsonb_array_elements(p_answers)))::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_row.workspace_id::text||':'||p_command_id::text,0));
  select * into v_existing from public.command_dedup where workspace_id=v_row.workspace_id and command_id=p_command_id;
  if found then
    if v_existing.command_type<>'SAVE_APPLICATION_AUTOPILOT_ANSWERS' or v_existing.actor_id<>auth.uid() or v_existing.request_hash<>v_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode='23505'; end if;
    return v_existing.result||'{"replayed":true}'::jsonb;
  end if;
  if v_row.status<>'WAITING_ANSWERS' or v_row.version<>p_expected_version or v_row.attempt_id is not null or v_row.stop_requested is not null or v_row.expires_at<=statement_timestamp()
    or not exists(select 1 from public.applications where id=v_row.application_id and current_revision_id=v_row.revision_id)
    or (select count(*) from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN')<>jsonb_array_length(p_answers)
    or (select count(distinct value->>'questionId') from jsonb_array_elements(p_answers))<>jsonb_array_length(p_answers) then
    raise exception 'APPLICATION_AUTOPILOT_ANSWERS_STALE' using errcode='PT409'; end if;
  for v_answer in select value from jsonb_array_elements(p_answers) loop
    select * into strict v_question from public.application_autopilot_questions where id=(v_answer->>'questionId')::uuid
      and autopilot_id=p_id and fingerprint=v_answer->>'fingerprint' and status='OPEN' for update;
    v_value:=v_answer->'value';
    if v_value is null or octet_length(v_value::text)>40000 then raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023'; end if;
    case v_question.descriptor->>'kind'
      when 'TEXT','LONG_TEXT' then
        if jsonb_typeof(v_value)<>'string' or char_length(v_value#>>'{}')>8000 or ((v_question.descriptor->>'required')::boolean and btrim(v_value#>>'{}')='') then
          raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023'; end if;
      when 'BOOLEAN' then
        if jsonb_typeof(v_value)<>'boolean' then raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023'; end if;
      when 'SINGLE_SELECT' then
        if jsonb_typeof(v_value)<>'string' or not exists(select 1 from jsonb_array_elements(v_question.descriptor->'options') o where o->'value'=v_value) then
          raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023'; end if;
      when 'MULTI_SELECT' then
        if jsonb_typeof(v_value)<>'array' then raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023'; end if;
        if jsonb_array_length(v_value)>80 or ((v_question.descriptor->>'required')::boolean and jsonb_array_length(v_value)=0)
          or (select count(distinct value) from jsonb_array_elements(v_value))<>jsonb_array_length(v_value)
          or exists(select 1 from jsonb_array_elements(v_value) choice where not exists(select 1 from jsonb_array_elements(v_question.descriptor->'options') o where o->'value'=choice)) then
          raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023'; end if;
      else raise exception 'APPLICATION_AUTOPILOT_ANSWER_INVALID' using errcode='22023';
    end case;
    insert into public.application_autopilot_answers(question_id,value_json,answered_by,command_id) values(v_question.id,v_value,auth.uid(),p_command_id);
    update public.application_autopilot_questions set status='ANSWERED' where id=v_question.id;
  end loop;
  update public.application_autopilots set status='QUEUED',version=version+1,available_at=statement_timestamp(),updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_answers_saved','EXECUTING');
  v_result:=jsonb_build_object('id',p_id,'version',v_row.version+1,'replayed',false);
  insert into public.command_dedup(workspace_id,command_id,actor_id,command_type,request_hash,status,aggregate_type,aggregate_id,result,completed_at)
    values(v_row.workspace_id,p_command_id,auth.uid(),'SAVE_APPLICATION_AUTOPILOT_ANSWERS',v_hash,'COMMITTED','APPLICATION',v_row.application_id,v_result,statement_timestamp());
  return v_result;
end; $$;
create function public.save_application_autopilot_answers(p_command_id uuid,p_id uuid,p_expected_version bigint,p_answers jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_application_autopilot_answers(p_command_id,p_id,p_expected_version,p_answers); $$;

create function private.control_application_autopilot(p_command_id uuid,p_id uuid,p_expected_version bigint,p_action text)
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
      or exists(select 1 from public.application_attempts where application_id=v_row.application_id) then
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
create function public.control_application_autopilot(p_command_id uuid,p_id uuid,p_expected_version bigint,p_action text)
returns jsonb language sql security invoker set search_path='' as $$ select private.control_application_autopilot(p_command_id,p_id,p_expected_version,p_action); $$;
create function public.seal_application_autopilot(p_id uuid,p_lease_token uuid,p_diff jsonb,p_readback_hash text,p_request_fingerprint text,p_destination_url text)
returns text language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_hash text;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,true);
  if jsonb_typeof(p_diff) is distinct from 'object' or octet_length(p_diff::text)>262144
    or p_readback_hash is null or p_readback_hash !~ '^[0-9a-f]{64}$' or p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$'
    or p_destination_url is distinct from v_row.destination_url
    or exists(select 1 from public.application_autopilot_questions where autopilot_id=p_id and status='OPEN') then
    raise exception 'APPLICATION_AUTOPILOT_SEAL_INVALID' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('autopilot_id',p_id,'revision_id',v_row.revision_id,'packet_hash',v_row.packet_hash,
    'destination_url',p_destination_url,'diff',p_diff,'readback_hash',p_readback_hash,'request_fingerprint',p_request_fingerprint)::text,'utf8'),'sha256'),'hex');
  if v_row.sealed_diff_hash is not null and v_row.sealed_diff_hash<>v_hash then raise exception 'APPLICATION_AUTOPILOT_SEAL_IMMUTABLE' using errcode='55000'; end if;
  update public.application_autopilots set sealed_diff=p_diff,sealed_diff_hash=v_hash,readback_hash=p_readback_hash,request_fingerprint=p_request_fingerprint,updated_at=statement_timestamp() where id=p_id;
  return v_hash;
end; $$;
create function public.begin_application_autopilot_submit(p_id uuid,p_lease_token uuid,p_seal_hash text,p_request_fingerprint text,p_adapter_release text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_approval uuid:=extensions.gen_random_uuid(); v_consumption uuid:=extensions.gen_random_uuid();
 v_attempt uuid:=extensions.gen_random_uuid(); v_key text; v_manifest jsonb; v_authority_hash text;
begin
  v_row:=private.assert_autopilot_lease(p_id,p_lease_token,true);
  if v_row.sealed_diff_hash is null or v_row.sealed_diff_hash is distinct from p_seal_hash or v_row.request_fingerprint is distinct from p_request_fingerprint
    or p_adapter_release is null or char_length(btrim(p_adapter_release)) not between 1 and 120
    or exists(select 1 from public.application_attempts where application_id=v_row.application_id) then
    raise exception 'APPLICATION_AUTOPILOT_SUBMIT_DENIED' using errcode='55000'; end if;
  v_key:='autopilot:'||p_id::text;
  v_manifest:=jsonb_build_object('permitted_action','SUBMIT_APPLICATION_ONCE','submission_authority',true,
    'authority_scope','ONE_JOB_AUTOPILOT','delegation_id',p_id,'delegated_by',v_row.delegated_by,'revision_id',v_row.revision_id,
    'packet_hash',v_row.packet_hash,'sealed_diff_hash',p_seal_hash,'request_fingerprint',p_request_fingerprint,'destination_url',v_row.destination_url);
  v_authority_hash:=encode(extensions.digest(convert_to(v_manifest::text,'utf8'),'sha256'),'hex');
  insert into public.approval_challenges(id,workspace_id,candidate_id,application_id,revision_id,permitted_action,diff_hash,nonce_hash,authority_manifest,authority_hash,expires_at)
    values(v_approval,v_row.workspace_id,v_row.candidate_id,v_row.application_id,v_row.revision_id,'SUBMIT_APPLICATION_ONCE',p_seal_hash,
      encode(extensions.digest(convert_to(v_approval::text||p_id::text,'utf8'),'sha256'),'hex'),v_manifest,v_authority_hash,statement_timestamp()+interval '2 minutes');
  insert into public.approval_consumptions(id,workspace_id,approval_id,application_id,revision_id,consumed_by,command_id,permitted_action)
    values(v_consumption,v_row.workspace_id,v_approval,v_row.application_id,v_row.revision_id,v_row.delegated_by,p_id,'SUBMIT_APPLICATION_ONCE');
  insert into public.application_attempts(id,workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
    values(v_attempt,v_row.workspace_id,v_row.application_id,v_row.revision_id,v_consumption,'SUBMIT_APPLICATION_ONCE',v_key,p_adapter_release,'STARTED',
      jsonb_build_object('autopilot_id',p_id,'sealed_diff_hash',p_seal_hash,'request_fingerprint',p_request_fingerprint));
  update public.application_autopilots set attempt_id=v_attempt,status='SUBMITTING',version=version+1,updated_at=statement_timestamp() where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_submit_started','RECONCILING');
  -- This is the only response that permits one network submission. Replays fail.
  return jsonb_build_object('attempt_id',v_attempt,'idempotency_key',v_key,'seal_hash',p_seal_hash,'request_fingerprint',p_request_fingerprint);
end; $$;
create function public.finish_application_autopilot(p_id uuid,p_lease_token uuid,p_outcome text,p_failure_code text default null,p_receipt jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_outcome text:=p_outcome;
begin
  select * into strict v_row from public.application_autopilots where id=p_id for update;
  if p_lease_token is null or v_row.lease_token is distinct from p_lease_token or v_row.status not in ('RUNNING','SUBMITTING','RECONCILING')
    or p_outcome is null or p_outcome not in ('CONFIRMED','UNCERTAIN','FAILED_SAFE')
    or (p_failure_code is not null and p_failure_code !~ '^[A-Z][A-Z0-9_]{2,119}$') then
    raise exception 'APPLICATION_AUTOPILOT_COMPLETION_INVALID' using errcode='55000'; end if;
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

create function public.begin_application_autopilot_tool(p_id uuid,p_lease_token uuid,p_session_id text,p_turn_id text,p_call_id text,p_tool_name text,p_arguments_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing private.application_autopilot_tool_calls%rowtype;
begin
  perform private.assert_autopilot_lease(p_id,p_lease_token,true);
  if p_session_id is null or p_session_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_turn_id is null or p_turn_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or p_call_id is null or p_call_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_tool_name is null or p_tool_name !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
    or p_arguments_hash is null or p_arguments_hash !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from private.application_autopilot_runtime where autopilot_id=p_id and agent_session_id=p_session_id and agent_session_lease=p_lease_token) then
    raise exception 'APPLICATION_AUTOPILOT_TOOL_INVALID' using errcode='22023'; end if;
  select * into v_existing from private.application_autopilot_tool_calls where autopilot_id=p_id and session_id=p_session_id and turn_id=p_turn_id and call_id=p_call_id for update;
  if found then
    if v_existing.tool_name<>p_tool_name or v_existing.arguments_hash<>p_arguments_hash then raise exception 'APPLICATION_AUTOPILOT_TOOL_REPLAY_MISMATCH' using errcode='23505'; end if;
    if v_existing.result is null then return '{"status":"uncertain"}'; end if;
    return jsonb_build_object('status','completed','result',v_existing.result);
  end if;
  if (select count(*) from private.application_autopilot_tool_calls where autopilot_id=p_id)>=1000 then raise exception 'APPLICATION_AUTOPILOT_TOOL_LIMIT' using errcode='55000'; end if;
  insert into private.application_autopilot_tool_calls(autopilot_id,session_id,turn_id,call_id,tool_name,arguments_hash,lease_token)
    values(p_id,p_session_id,p_turn_id,p_call_id,p_tool_name,p_arguments_hash,p_lease_token);
  return '{"status":"new"}';
end; $$;
create function public.complete_application_autopilot_tool(p_id uuid,p_lease_token uuid,p_session_id text,p_turn_id text,p_call_id text,p_tool_name text,p_arguments_hash text,p_result jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_existing private.application_autopilot_tool_calls%rowtype;
begin
  select * into strict v_existing from private.application_autopilot_tool_calls where autopilot_id=p_id and session_id=p_session_id and turn_id=p_turn_id and call_id=p_call_id for update;
  if v_existing.lease_token is distinct from p_lease_token or v_existing.tool_name is distinct from p_tool_name or v_existing.arguments_hash is distinct from p_arguments_hash
    or jsonb_typeof(p_result) is distinct from 'object' or p_result->>'type' is distinct from 'agent.session.input.tool_result'
    or p_result->>'turn_id' is distinct from p_turn_id or p_result->>'call_id' is distinct from p_call_id
    or jsonb_typeof(p_result->'success') is distinct from 'boolean' or octet_length(p_result::text)>262144
    or ((p_result->>'success')::boolean and (jsonb_typeof(p_result->'output') is distinct from 'string' or p_result?'error'))
    or (not (p_result->>'success')::boolean and (jsonb_typeof(p_result->'error') is distinct from 'string' or p_result?'output'))
    or (v_existing.result is not null and v_existing.result<>p_result) then
    raise exception 'APPLICATION_AUTOPILOT_TOOL_RESULT_INVALID' using errcode='23505'; end if;
  update private.application_autopilot_tool_calls set result=p_result where autopilot_id=p_id and session_id=p_session_id and turn_id=p_turn_id and call_id=p_call_id;
end; $$;

-- Every public service function is a definer with a fixed empty search path;
-- all authorization is explicit and candidate APIs derive identity from auth.uid().
revoke all on function private.assert_autopilot_candidate(uuid) from public,anon,authenticated,service_role;
revoke all on function private.assert_autopilot_lease(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.delegate_application_autopilot(uuid,uuid,bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.delegate_application_autopilot(uuid,uuid,bigint,uuid,text) to authenticated;
revoke all on function public.delegate_application_autopilot(uuid,uuid,bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.delegate_application_autopilot(uuid,uuid,bigint,uuid,text) to authenticated;
revoke all on function private.autopilot_event(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_application_autopilot(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_application_autopilot(text,integer) to service_role;
revoke all on function public.assert_application_autopilot_lease(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.assert_application_autopilot_lease(uuid,uuid,boolean) to service_role;
revoke all on function public.checkpoint_application_autopilot(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.checkpoint_application_autopilot(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.bind_application_autopilot_resource(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.bind_application_autopilot_resource(uuid,uuid,text,text) to service_role;
revoke all on function public.claim_application_autopilot_cleanup(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_application_autopilot_cleanup(integer) to service_role;
revoke all on function public.acknowledge_application_autopilot_cleanup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.acknowledge_application_autopilot_cleanup(uuid) to service_role;
revoke all on function public.request_application_autopilot_questions(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.request_application_autopilot_questions(uuid,uuid,jsonb) to service_role;
revoke all on function public.read_application_autopilot_answers(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_application_autopilot_answers(uuid,uuid) to service_role;
revoke all on function private.save_application_autopilot_answers(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_application_autopilot_answers(uuid,uuid,bigint,jsonb) to authenticated;
revoke all on function public.save_application_autopilot_answers(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_application_autopilot_answers(uuid,uuid,bigint,jsonb) to authenticated;
revoke all on function private.control_application_autopilot(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function private.control_application_autopilot(uuid,uuid,bigint,text) to authenticated;
revoke all on function public.control_application_autopilot(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.control_application_autopilot(uuid,uuid,bigint,text) to authenticated;
revoke all on function public.seal_application_autopilot(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.seal_application_autopilot(uuid,uuid,jsonb,text,text,text) to service_role;
revoke all on function public.begin_application_autopilot_submit(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_application_autopilot_submit(uuid,uuid,text,text,text) to service_role;
revoke all on function public.finish_application_autopilot(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.finish_application_autopilot(uuid,uuid,text,text,jsonb) to service_role;
revoke all on function public.begin_application_autopilot_tool(uuid,uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_application_autopilot_tool(uuid,uuid,text,text,text,text,text) to service_role;
revoke all on function public.complete_application_autopilot_tool(uuid,uuid,text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.complete_application_autopilot_tool(uuid,uuid,text,text,text,text,text,jsonb) to service_role;
