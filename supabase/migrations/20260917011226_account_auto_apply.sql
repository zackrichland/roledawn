-- Explicit standing candidate consent selects jobs; the existing immutable
-- packet delegation and single-use submission seal remain the delivery authority.
create table private.auto_apply_plans (
  plan_key text primary key,
  interval_seconds integer not null check(interval_seconds >= 3600),
  daily_cap integer not null check(daily_cap between 1 and 24)
);
insert into private.auto_apply_plans values('PILOT',3600,24);
create table public.candidate_auto_apply_settings (
  candidate_id uuid primary key,
  workspace_id uuid not null,
  enabled boolean not null default false,
  status text not null default 'OFF' check(status in ('OFF','ACTIVE','PAUSED_PROFILE_CHANGED')),
  version bigint not null default 0 check(version>=0),
  plan_key text not null default 'PILOT' references private.auto_apply_plans(plan_key),
  consent_actor uuid references auth.users(id) on delete restrict,
  consented_at timestamptz,
  candidate_input_version bigint,
  search_profile_version bigint,
  next_submission_at timestamptz,
  next_prepare_at timestamptz,
  next_check_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_outcome text check(last_outcome in ('PREPARED','DELEGATED','WAITING_APPLICATION','NO_MATCHES','RANKING_INCOMPLETE','RATE_LIMITED','CHECK_FAILED','PAUSED','PROFILE_CHANGED')),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,candidate_id) references public.candidates(workspace_id,id) on delete cascade,
  check(enabled=(status='ACTIVE')),
  check(not enabled or (consent_actor is not null and consented_at is not null and candidate_input_version is not null and search_profile_version is not null))
);
create index candidate_auto_apply_due on public.candidate_auto_apply_settings(next_check_at,candidate_id) where enabled;
create index candidate_auto_apply_consent_actor on public.candidate_auto_apply_settings(consent_actor);
create index candidate_auto_apply_workspace on public.candidate_auto_apply_settings(workspace_id,candidate_id);
create table private.auto_apply_runtime (
  candidate_id uuid primary key references public.candidate_auto_apply_settings(candidate_id) on delete cascade,
  lease_token uuid, lease_expires_at timestamptz, lease_owner text
);
create table public.auto_apply_enrollments (
  application_id uuid primary key,
  workspace_id uuid not null,
  candidate_id uuid not null,
  job_id uuid not null,
  job_version_id uuid not null,
  consent_version bigint not null check(consent_version>0),
  candidate_input_version bigint not null,
  search_profile_version bigint not null,
  profile_hash text not null check(profile_hash ~ '^[0-9a-f]{64}$'),
  matching_policy text not null check(char_length(matching_policy) between 1 and 120),
  matching_decision jsonb not null check(jsonb_typeof(matching_decision)='object' and octet_length(matching_decision::text)<=16000),
  delegate_command_id uuid not null default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique(candidate_id,job_id),
  foreign key(workspace_id,candidate_id,application_id) references public.applications(workspace_id,candidate_id,id) on delete cascade,
  foreign key(job_id,job_version_id) references public.job_versions(job_id,id) on delete restrict
);
create index auto_apply_enrollments_scope on public.auto_apply_enrollments(workspace_id,candidate_id,application_id);
create index auto_apply_enrollments_job on public.auto_apply_enrollments(job_id,job_version_id);
create trigger auto_apply_enrollment_identity_immutable before update on public.auto_apply_enrollments
  for each row execute function private.reject_row_mutation();
-- Withdrawal is intentionally stored in settings consent versions, not by editing history.
alter table private.auto_apply_plans enable row level security;
alter table private.auto_apply_runtime enable row level security;
alter table public.candidate_auto_apply_settings enable row level security;
alter table public.auto_apply_enrollments enable row level security;
create policy auto_apply_settings_owner on public.candidate_auto_apply_settings for select to authenticated using(exists(
  select 1 from public.candidates c where c.id=candidate_id and c.workspace_id=candidate_auto_apply_settings.workspace_id and c.auth_user_id=(select auth.uid())
));
create policy auto_apply_enrollments_owner on public.auto_apply_enrollments for select to authenticated using(exists(
  select 1 from public.candidates c where c.id=candidate_id and c.workspace_id=auto_apply_enrollments.workspace_id and c.auth_user_id=(select auth.uid())
));
revoke all on private.auto_apply_plans,private.auto_apply_runtime,public.candidate_auto_apply_settings,public.auto_apply_enrollments from public,anon,authenticated,service_role;
grant select on public.candidate_auto_apply_settings,public.auto_apply_enrollments to authenticated,service_role;

create function private.auto_apply_owned_candidate() returns public.candidates
language plpgsql security definer set search_path='' as $$
declare c public.candidates%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select candidate.* into strict c from public.candidates candidate
    join public.workspaces w on w.id=candidate.workspace_id and w.kind='PERSONAL' and w.status='ACTIVE' and w.personal_owner_auth_user_id=auth.uid()
    join public.workspace_memberships m on m.workspace_id=w.id and m.auth_user_id=auth.uid() and m.status='ACTIVE'
    where candidate.auth_user_id=auth.uid() and candidate.status in ('ACTIVE','ONBOARDING','PAUSED');
  return c;
exception when no_data_found then raise exception 'AUTO_APPLY_CANDIDATE_NOT_FOUND' using errcode='42501';
end; $$;
create function private.auto_apply_state(p_candidate uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(s.enabled,false),'status',coalesce(s.status,'OFF'),'version',coalesce(s.version,0),
   'interval_seconds',p.interval_seconds,'daily_cap',p.daily_cap,'next_submission_at',s.next_submission_at,
   'last_checked_at',s.last_checked_at,'last_outcome',s.last_outcome,
   'attempted_today',(select count(*) from public.application_attempts a join public.auto_apply_enrollments e on e.application_id=a.application_id
     where e.candidate_id=p_candidate and a.started_at >= date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC'),
   'confirmed_today',(select count(*) from public.application_attempts a join public.auto_apply_enrollments e on e.application_id=a.application_id
     where e.candidate_id=p_candidate and a.status='CONFIRMED' and a.started_at >= date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC'))
 from private.auto_apply_plans p left join public.candidate_auto_apply_settings s on s.candidate_id=p_candidate and s.plan_key=p.plan_key
 where p.plan_key=coalesce((select plan_key from public.candidate_auto_apply_settings where candidate_id=p_candidate),'PILOT');
$$;
create function public.read_auto_apply_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.candidates%rowtype;
begin c:=private.auto_apply_owned_candidate(); return private.auto_apply_state(c.id); end; $$;

create function private.stop_unsent_auto_apply(p_candidate uuid) returns void
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
      and run.status in ('QUEUED','RUNNING','WAITING') and not exists(select 1 from public.application_attempts a where a.application_id=e.application_id);
  update public.applications a set status='CANCELED',aggregate_version=a.aggregate_version+1,updated_at=statement_timestamp()
    from public.auto_apply_enrollments e where e.application_id=a.id and e.candidate_id=p_candidate
      and a.status not in ('CONFIRMED','RECONCILING','CANCELED') and not exists(select 1 from public.application_attempts x where x.application_id=a.id);
end; $$;
create function public.set_auto_apply_enabled(p_command_id uuid,p_expected_version bigint,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.candidates%rowtype; s public.candidate_auto_apply_settings%rowtype; v_search bigint; h text; prior public.command_dedup%rowtype; result jsonb; event_id uuid:=extensions.gen_random_uuid();
begin
  c:=private.auto_apply_owned_candidate();
  if p_command_id is null or p_expected_version is null or p_expected_version<0 or p_enabled is null then raise exception 'AUTO_APPLY_COMMAND_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c.id::text||':auto-apply',0));
  perform pg_advisory_xact_lock(hashtextextended(c.workspace_id::text||':'||p_command_id::text,0));
  h:=encode(extensions.digest(convert_to(jsonb_build_array(p_expected_version,p_enabled)::text,'utf8'),'sha256'),'hex');
  select * into prior from public.command_dedup where workspace_id=c.workspace_id and command_id=p_command_id;
  if found then
    if prior.command_type<>'SET_AUTO_APPLY' or prior.actor_id<>auth.uid() or prior.request_hash<>h then raise exception 'AUTO_APPLY_COMMAND_REPLAY_MISMATCH' using errcode='23505'; end if;
    return private.auto_apply_state(c.id);
  end if;
  insert into public.candidate_auto_apply_settings(candidate_id,workspace_id) values(c.id,c.workspace_id) on conflict do nothing;
  insert into private.auto_apply_runtime(candidate_id) values(c.id) on conflict do nothing;
  select * into strict s from public.candidate_auto_apply_settings where candidate_id=c.id for update;
  if s.version<>p_expected_version then raise exception 'AUTO_APPLY_SETTINGS_STALE' using errcode='PT409'; end if;
  if p_enabled and s.enabled then raise exception 'AUTO_APPLY_ALREADY_ACTIVE' using errcode='55000'; end if;
  select aggregate_version into v_search from public.candidate_search_profiles where candidate_id=c.id and workspace_id=c.workspace_id;
  if p_enabled and (c.status<>'ACTIVE' or v_search is null or cardinality(private.candidate_onboarding_missing_items(c.workspace_id,c.id))>0) then
    raise exception 'AUTO_APPLY_PROFILE_INCOMPLETE' using errcode='55000'; end if;
  update public.candidate_auto_apply_settings set enabled=p_enabled,status=case when p_enabled then 'ACTIVE' else 'OFF' end,version=version+1,
    consent_actor=case when p_enabled then auth.uid() else consent_actor end,consented_at=case when p_enabled then statement_timestamp() else consented_at end,
    candidate_input_version=case when p_enabled then c.application_input_version else candidate_input_version end,
    search_profile_version=case when p_enabled then v_search else search_profile_version end,
    next_check_at=statement_timestamp(),last_outcome=case when p_enabled then null else 'PAUSED' end,updated_at=statement_timestamp() where candidate_id=c.id;
  update private.auto_apply_runtime set lease_token=null,lease_expires_at=null,lease_owner=null where candidate_id=c.id;
  if not p_enabled then perform private.stop_unsent_auto_apply(c.id); end if;
  insert into public.domain_events(id,workspace_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,actor_kind,actor_id,correlation_id)
    values(event_id,c.workspace_id,'AUTO_APPLY_SETTINGS',c.id,s.version+1,'candidate.auto_apply_changed',
      jsonb_build_object('enabled',p_enabled,'consent_version',s.version+1,'candidate_input_version',c.application_input_version,'search_profile_version',v_search),
      'CANDIDATE',auth.uid(),p_command_id);
  result:=private.auto_apply_state(c.id);
  insert into public.command_dedup(workspace_id,command_id,actor_id,command_type,request_hash,status,aggregate_type,aggregate_id,result,result_event_id,completed_at)
    values(c.workspace_id,p_command_id,auth.uid(),'SET_AUTO_APPLY',h,'COMMITTED','AUTO_APPLY_SETTINGS',c.id,result,event_id,statement_timestamp());
  return result;
end; $$;

create function private.pause_auto_apply_on_profile_change() returns trigger language plpgsql security definer set search_path='' as $$
declare candidate uuid; workspace uuid; s public.candidate_auto_apply_settings%rowtype;
begin
  if tg_table_name='candidates' then
    if new.application_input_version is not distinct from old.application_input_version and new.status is not distinct from old.status then return new; end if;
    candidate:=new.id; workspace:=new.workspace_id;
  else
    if tg_op='UPDATE' and new.aggregate_version is not distinct from old.aggregate_version then return new; end if;
    candidate:=coalesce(new.candidate_id,old.candidate_id); workspace:=coalesce(new.workspace_id,old.workspace_id);
  end if;
  update public.candidate_auto_apply_settings set enabled=false,status='PAUSED_PROFILE_CHANGED',version=version+1,last_outcome='PROFILE_CHANGED',updated_at=statement_timestamp()
    where candidate_id=candidate and workspace_id=workspace and enabled returning * into s;
  if found then
    update private.auto_apply_runtime set lease_token=null,lease_expires_at=null,lease_owner=null where candidate_id=candidate;
    perform private.stop_unsent_auto_apply(candidate);
    insert into public.domain_events(workspace_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,actor_kind,correlation_id)
      values(workspace,'AUTO_APPLY_SETTINGS',candidate,s.version,'candidate.auto_apply_profile_changed',jsonb_build_object('enabled',false),'SYSTEM',extensions.gen_random_uuid());
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
create trigger candidates_pause_auto_apply after update of application_input_version,status on public.candidates for each row execute function private.pause_auto_apply_on_profile_change();
create trigger search_profile_pause_auto_apply after update or delete on public.candidate_search_profiles for each row execute function private.pause_auto_apply_on_profile_change();

-- Reuse the mature candidate commands with an explicit actor argument in private
-- functions. The actor is selected from stored consent by the service command;
-- JWT claims are never forged or changed. Original user-facing functions remain intact.
do $copy$
declare definition text; modified text;
begin
  definition:=pg_get_functiondef('public.enqueue_catalog_job_application(uuid,uuid,uuid)'::regprocedure);
  modified:=replace(definition,'public.enqueue_catalog_job_application(p_command_id uuid, p_job_id uuid, p_job_version_id uuid)',
    'private.enqueue_auto_apply_as_candidate(p_command_id uuid, p_job_id uuid, p_job_version_id uuid, p_actor uuid)');
  modified:=replace(modified,'v_actor uuid := auth.uid();','v_actor uuid := p_actor;');
  if modified=definition or position('v_actor uuid := auth.uid();' in modified)>0 or position('private.enqueue_auto_apply_as_candidate' in modified)=0 then raise exception 'AUTO_APPLY_ENQUEUE_BINDING_DRIFT'; end if;
  execute modified;
  definition:=pg_get_functiondef('private.delegate_application_autopilot(uuid,uuid,bigint,uuid,text)'::regprocedure);
  modified:=replace(definition,'private.delegate_application_autopilot(p_command_id uuid, p_application_id uuid, p_expected_aggregate_version bigint, p_revision_id uuid, p_packet_hash text)',
    'private.delegate_auto_apply_as_candidate(p_command_id uuid, p_application_id uuid, p_expected_aggregate_version bigint, p_revision_id uuid, p_packet_hash text, p_actor uuid)');
  modified:=replace(modified,'v_actor uuid:=auth.uid();','v_actor uuid:=p_actor;');
  if modified=definition or position('v_actor uuid:=auth.uid();' in modified)>0 or position('private.delegate_auto_apply_as_candidate' in modified)=0 then raise exception 'AUTO_APPLY_DELEGATION_BINDING_DRIFT'; end if;
  execute modified;
end; $copy$;

create function private.assert_auto_apply_consent(p_candidate uuid,p_version bigint) returns public.candidate_auto_apply_settings
language plpgsql security definer set search_path='' as $$
declare s public.candidate_auto_apply_settings%rowtype;
begin
  select settings.* into s from public.candidate_auto_apply_settings settings
    join public.candidates c on c.id=settings.candidate_id and c.workspace_id=settings.workspace_id and c.status='ACTIVE' and c.auth_user_id=settings.consent_actor
    join public.candidate_search_profiles profile on profile.candidate_id=c.id and profile.workspace_id=c.workspace_id
    join public.workspaces w on w.id=c.workspace_id and w.status='ACTIVE' and w.personal_owner_auth_user_id=settings.consent_actor
    join public.workspace_memberships m on m.workspace_id=w.id and m.auth_user_id=settings.consent_actor and m.status='ACTIVE'
    where settings.candidate_id=p_candidate and settings.enabled and settings.version=p_version
      and settings.candidate_input_version=c.application_input_version and settings.search_profile_version=profile.aggregate_version
    for update of settings for share of c,profile,w,m;
  if not found then raise exception 'AUTO_APPLY_CONSENT_INACTIVE' using errcode='55000'; end if;
  return s;
end; $$;
create function private.assert_auto_apply_worker(p_candidate uuid,p_token uuid,p_version bigint) returns public.candidate_auto_apply_settings
language plpgsql security definer set search_path='' as $$
declare s public.candidate_auto_apply_settings%rowtype;
begin
  s:=private.assert_auto_apply_consent(p_candidate,p_version);
  perform 1 from private.auto_apply_runtime where candidate_id=p_candidate and lease_token=p_token and lease_expires_at>statement_timestamp() for update;
  if not found then raise exception 'AUTO_APPLY_LEASE_INACTIVE' using errcode='55000'; end if;
  return s;
end; $$;
create function public.claim_auto_apply_candidate(p_worker_id text,p_candidate_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.candidate_auto_apply_settings%rowtype; token uuid:=extensions.gen_random_uuid();
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 120 then raise exception 'AUTO_APPLY_WORKER_INVALID'; end if;
  select settings.* into s from public.candidate_auto_apply_settings settings join private.auto_apply_runtime r using(candidate_id)
    where settings.enabled and settings.next_check_at<=statement_timestamp() and (p_candidate_id is null or settings.candidate_id=p_candidate_id)
      and (r.lease_expires_at is null or r.lease_expires_at<=statement_timestamp())
    order by settings.next_check_at,settings.candidate_id for update of settings,r skip locked limit 1;
  if not found then return null; end if;
  update private.auto_apply_runtime set lease_token=token,lease_expires_at=statement_timestamp()+interval '5 minutes',lease_owner=p_worker_id where candidate_id=s.candidate_id;
  return jsonb_build_object('candidate_id',s.candidate_id,'workspace_id',s.workspace_id,'consent_version',s.version,
    'candidate_input_version',s.candidate_input_version,'search_profile_version',s.search_profile_version,'lease_token',token);
end; $$;
create function public.advance_auto_apply_candidate(p_candidate uuid,p_token uuid,p_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.candidate_auto_apply_settings%rowtype; e public.auto_apply_enrollments%rowtype; a public.applications%rowtype; revision public.application_revisions%rowtype; result jsonb;
begin
  s:=private.assert_auto_apply_worker(p_candidate,p_token,p_version);
  select enrollment.* into e from public.auto_apply_enrollments enrollment join public.applications app on app.id=enrollment.application_id
    where enrollment.candidate_id=p_candidate and enrollment.consent_version=p_version
      and app.status not in ('CONFIRMED','CANCELED','FAILED_SAFE','SKIPPED') order by enrollment.created_at limit 1;
  if found then
    select * into strict a from public.applications where id=e.application_id for update;
    if a.status='READY' and not exists(select 1 from public.application_autopilots where application_id=a.id) then
      if s.next_submission_at>statement_timestamp() then return jsonb_build_object('outcome','RATE_LIMITED'); end if;
      select * into strict revision from public.application_revisions where id=a.current_revision_id and application_id=a.id;
      if not private.is_supported_autopilot_destination((select apply_url from public.job_versions where id=a.job_version_id)) then raise exception 'AUTO_APPLY_DESTINATION_UNSUPPORTED'; end if;
      result:=private.delegate_auto_apply_as_candidate(e.delegate_command_id,a.id,a.aggregate_version,revision.id,revision.packet_hash,s.consent_actor);
      return jsonb_build_object('outcome','DELEGATED','application_id',a.id,'autopilot_id',result->>'id');
    end if;
    return jsonb_build_object('outcome','WAITING_APPLICATION');
  end if;
  if s.next_submission_at>statement_timestamp() or s.next_prepare_at>statement_timestamp() then return jsonb_build_object('outcome','RATE_LIMITED'); end if;
  return jsonb_build_object('outcome','SELECT_MATCH');
end; $$;
create function public.enqueue_auto_apply_match(p_candidate uuid,p_token uuid,p_version bigint,p_job uuid,p_job_version uuid,p_profile_hash text,p_policy text,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.candidate_auto_apply_settings%rowtype; result record; command uuid:=extensions.gen_random_uuid();
begin
  s:=private.assert_auto_apply_worker(p_candidate,p_token,p_version);
  if p_profile_hash is null or p_profile_hash !~ '^[0-9a-f]{64}$' or p_policy is null or char_length(p_policy) not between 1 and 120
    or p_decision is null or jsonb_typeof(p_decision)<>'object' or octet_length(p_decision::text)>16000
    or p_decision->>'autoApplyEligible' is distinct from 'true' or p_decision->>'band' is distinct from 'STRONG'
    or p_decision->>'jobVersionId' is distinct from p_job_version::text or p_decision->>'profileHash' is distinct from p_profile_hash
    or p_decision->>'policyVersion' is distinct from p_policy then raise exception 'AUTO_APPLY_MATCH_INVALID'; end if;
  if s.next_submission_at>statement_timestamp() or s.next_prepare_at>statement_timestamp() then raise exception 'AUTO_APPLY_RATE_LIMITED'; end if;
  if exists(select 1 from public.auto_apply_enrollments e join public.applications a on a.id=e.application_id where e.candidate_id=p_candidate
    and e.consent_version=p_version and a.status not in ('CONFIRMED','CANCELED','FAILED_SAFE','SKIPPED')) then raise exception 'AUTO_APPLY_APPLICATION_ACTIVE'; end if;
  if not exists(select 1 from public.jobs j join public.job_versions v on v.id=j.current_version_id join public.source_job_listings l on l.id=j.source_listing_id
    join public.job_sources source on source.id=l.source_id where j.id=p_job and v.id=p_job_version and j.state='OPEN' and l.state='OPEN'
      and j.last_seen_at>statement_timestamp()-interval '7 days' and source.policy_status='ALLOWLISTED' and source.polling_enabled
      and private.is_supported_autopilot_destination(v.apply_url)) then raise exception 'AUTO_APPLY_JOB_UNAVAILABLE'; end if;
  if exists(select 1 from public.candidate_job_decisions where candidate_id=p_candidate and job_id=p_job and decision='PASSED' and undone_at is null) then raise exception 'AUTO_APPLY_JOB_PASSED'; end if;
  select * into strict result from private.enqueue_auto_apply_as_candidate(command,p_job,p_job_version,s.consent_actor);
  -- Manual and earlier automatic applications retain their existing authority.
  if result.replayed then return jsonb_build_object('outcome','ALREADY_EXISTS'); end if;
  insert into public.auto_apply_enrollments(application_id,workspace_id,candidate_id,job_id,job_version_id,consent_version,candidate_input_version,search_profile_version,profile_hash,matching_policy,matching_decision)
    values(result.application_id,s.workspace_id,p_candidate,p_job,p_job_version,s.version,s.candidate_input_version,s.search_profile_version,p_profile_hash,p_policy,p_decision);
  update public.candidate_auto_apply_settings set next_prepare_at=statement_timestamp()+interval '1 hour' where candidate_id=p_candidate;
  return jsonb_build_object('outcome','PREPARED','application_id',result.application_id);
end; $$;
create function public.finish_auto_apply_check(p_candidate uuid,p_token uuid,p_outcome text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_outcome is null or p_outcome not in ('PREPARED','DELEGATED','WAITING_APPLICATION','NO_MATCHES','RANKING_INCOMPLETE','RATE_LIMITED','CHECK_FAILED') then raise exception 'AUTO_APPLY_OUTCOME_INVALID'; end if;
  perform 1 from public.candidate_auto_apply_settings where candidate_id=p_candidate for update;
  update private.auto_apply_runtime set lease_token=null,lease_expires_at=null,lease_owner=null where candidate_id=p_candidate and lease_token=p_token and lease_expires_at>statement_timestamp();
  if not found then return false; end if;
  update public.candidate_auto_apply_settings set last_checked_at=statement_timestamp(),last_outcome=p_outcome,
    next_check_at=statement_timestamp()+case when p_outcome in ('NO_MATCHES','RANKING_INCOMPLETE','CHECK_FAILED') then interval '15 minutes' else interval '1 minute' end,
    updated_at=statement_timestamp() where candidate_id=p_candidate;
  return true;
end; $$;

-- The transaction which creates the durable attempt is the actual network
-- permission boundary. Unknown outcomes consume capacity; retries cannot reset it.
create function private.enforce_auto_apply_submission_rate() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.auto_apply_enrollments%rowtype; s public.candidate_auto_apply_settings%rowtype; plan private.auto_apply_plans%rowtype; used integer;
begin
  select * into e from public.auto_apply_enrollments where application_id=new.application_id;
  if not found then return new; end if;
  s:=private.assert_auto_apply_consent(e.candidate_id,e.consent_version);
  select * into strict plan from private.auto_apply_plans where plan_key=s.plan_key;
  select count(*) into used from public.application_attempts a join public.auto_apply_enrollments enrollment on enrollment.application_id=a.application_id
    where enrollment.candidate_id=e.candidate_id and a.started_at>=date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC';
  if s.next_submission_at>statement_timestamp() or used>=plan.daily_cap then raise exception 'AUTO_APPLY_RATE_LIMITED' using errcode='55000'; end if;
  update public.candidate_auto_apply_settings set next_submission_at=statement_timestamp()+make_interval(secs=>plan.interval_seconds),updated_at=statement_timestamp() where candidate_id=e.candidate_id;
  return new;
end; $$;
create trigger auto_apply_actual_submission_rate before insert on public.application_attempts for each row execute function private.enforce_auto_apply_submission_rate();

-- All private helpers are inaccessible to clients, including service direct calls.
revoke all on function private.auto_apply_owned_candidate(),private.auto_apply_state(uuid),private.stop_unsent_auto_apply(uuid),
 private.pause_auto_apply_on_profile_change(),private.enqueue_auto_apply_as_candidate(uuid,uuid,uuid,uuid),
 private.delegate_auto_apply_as_candidate(uuid,uuid,bigint,uuid,text,uuid),private.assert_auto_apply_consent(uuid,bigint),
 private.assert_auto_apply_worker(uuid,uuid,bigint),private.enforce_auto_apply_submission_rate()
 from public,anon,authenticated,service_role;
revoke all on function public.read_auto_apply_state(),public.set_auto_apply_enabled(uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_auto_apply_state(),public.set_auto_apply_enabled(uuid,bigint,boolean) to authenticated;
revoke all on function public.claim_auto_apply_candidate(text,uuid),public.advance_auto_apply_candidate(uuid,uuid,bigint),
 public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb),public.finish_auto_apply_check(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_auto_apply_candidate(text,uuid),public.advance_auto_apply_candidate(uuid,uuid,bigint),
 public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb),public.finish_auto_apply_check(uuid,uuid,text) to service_role;
