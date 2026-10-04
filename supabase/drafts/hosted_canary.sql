-- REVIEW DRAFT ONLY: not deployed and deliberately outside auto-applied migrations.
-- Stage approval/budget records only via an independently reviewed operator transaction.
-- No public RPC can create approval, weaken the limit, or release a job reservation.
create function private.hosted_canary_job_key(p_url text) returns text
language sql immutable set search_path='' as $$
  select case when split_part(split_part(p_url,'?',1),'#',1) ~ '^https://(jobs[.]lever[.]co|jobs[.]ashbyhq[.]com)/[A-Za-z0-9_-]+/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(/(apply|application))?/?$'
    then split_part(p_url,'/',3)||'/'||lower(split_part(split_part(split_part(p_url,'?',1),'#',1),'/',5)) else null end;
$$;
create table private.hosted_canary_budget (
  id boolean primary key default true check(id),
  prior_upper_cents integer not null check(prior_upper_cents>=0),
  reserved_cents integer not null default 0 check(reserved_cents>=0),
  ceiling_cents integer not null default 5000 check(ceiling_cents between 1 and 5000),
  evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  valid_until timestamptz not null,
  check(prior_upper_cents+reserved_cents<=ceiling_cents)
);
create table private.hosted_canary_approvals (
  intent_hash text primary key check(intent_hash ~ '^[0-9a-f]{64}$'),
  plan_text text not null check(octet_length(plan_text)<=4000000 and jsonb_typeof(plan_text::jsonb)='object'),
  approval_hash text not null check(approval_hash ~ '^[0-9a-f]{64}$'),
  packet_readback_hash text not null check(packet_readback_hash ~ '^[0-9a-f]{64}$'),
  future_cost_bound_hash text not null check(future_cost_bound_hash ~ '^[0-9a-f]{64}$'),
  valid_until timestamptz not null,
  enabled boolean not null default false
);
create table private.hosted_canary_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  application_id uuid not null unique references public.applications(id) on delete restrict,
  job_key text not null,
  intent_hash text not null unique references private.hosted_canary_approvals(intent_hash) on delete restrict,
  phase text not null default 'RESERVED' check(phase in ('RESERVED','CREATING','READY','ADMISSION_PENDING','ACTIVE','UNCERTAIN','CONFIRMED','NOT_ACCEPTED','STOPPED')),
  session_id text unique check(session_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  possible_egress boolean not null default false,
  cancel_requested boolean not null default false,
  cleanup_pending boolean not null default false,
  evidence jsonb,
  version integer not null default 0,
  controller_token uuid,
  controller_until timestamptz,
  unique(candidate_id,job_key)
);
-- Evidence is independently reviewed by an operator. There is intentionally no worker write RPC.
create table private.hosted_canary_verified_evidence (
  run_id uuid primary key references private.hosted_canary_runs(id) on delete restrict,
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  verifier_reference_hash text not null check(verifier_reference_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz not null default now()
);
alter table private.hosted_canary_verified_evidence enable row level security;
revoke all on private.hosted_canary_verified_evidence from public,anon,authenticated,service_role;
create trigger hosted_canary_verified_evidence_immutable before update or delete on private.hosted_canary_verified_evidence
  for each row execute function private.reject_row_mutation();
alter table private.hosted_canary_budget enable row level security;
alter table private.hosted_canary_approvals enable row level security;
alter table private.hosted_canary_runs enable row level security;
revoke all on private.hosted_canary_budget,private.hosted_canary_approvals,private.hosted_canary_runs from public,anon,authenticated,service_role;

create function private.hosted_canary_run_json(r private.hosted_canary_runs) returns jsonb
language sql stable set search_path='' as $$ select jsonb_build_object(
  'runId',r.id,'controllerToken',r.controller_token,'version',r.version,'intentSha256',r.intent_hash,
  'phase',r.phase,'sessionId',r.session_id,'possibleEgress',r.possible_egress,'cancelRequested',r.cancel_requested,'cleanupPending',r.cleanup_pending,'evidence',r.evidence); $$;

-- Only an explicitly reserved candidate/job is blocked. Cleanup/terminal writes remain available.
-- Every Lever/Ashby launch and the hosted reservation serialize on the same job key. Greenhouse never takes this lock.
create function private.hosted_canary_exclude_browserbase() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; c uuid; active boolean;
begin
  c:=new.candidate_id;
  if tg_table_name='application_autopilots' then
    k:=private.hosted_canary_job_key(new.destination_url); active:=new.status in ('RUNNING','SUBMITTING','RECONCILING');
  elsif tg_table_name='computer_sessions' then
    k:=private.hosted_canary_job_key(new.start_url); active:=new.state in ('PROVISIONING','ACTIVE','PAUSED_FOR_REVIEW');
  else
    k:=private.hosted_canary_job_key(new.destination_url); active:=new.status in ('QUEUED','STARTED');
  end if;
  if k is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('hosted-canary:'||c::text||':'||k,0));
  if exists(select 1 from private.hosted_canary_runs r where r.candidate_id=c and r.job_key=k) then
    if tg_table_name='application_autopilots' then
      if new.status='QUEUED' then
        new.status:='PAUSED'; new.stop_requested:='PAUSE'; new.failure_code:='HOSTED_CANARY_RESERVED';
      elsif active then raise exception 'HOSTED_CANARY_PROVIDER_EXCLUDED' using errcode='55000'; end if;
    elsif active then raise exception 'HOSTED_CANARY_PROVIDER_EXCLUDED' using errcode='55000'; end if;
  end if;
  return new;
end $$;
create trigger hosted_canary_autopilot_exclusion before insert or update on public.application_autopilots
  for each row execute function private.hosted_canary_exclude_browserbase();
create trigger hosted_canary_fill_exclusion before insert or update on public.application_fill_attempts
  for each row execute function private.hosted_canary_exclude_browserbase();
create trigger hosted_canary_computer_exclusion before insert or update on public.computer_sessions
  for each row execute function private.hosted_canary_exclude_browserbase();

create function private.hosted_canary_exclude_attempt() returns trigger
language plpgsql security definer set search_path='' as $$
declare c uuid; k text;
begin
  select x.candidate_id,coalesce(private.hosted_canary_job_key(j.apply_url),private.hosted_canary_job_key(i.canonical_url)) into c,k
    from public.applications x left join public.job_versions j on j.id=x.job_version_id left join public.job_intakes i on i.id=x.job_intake_id where x.id=new.application_id;
  if k is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('hosted-canary:'||c::text||':'||k,0));
  if exists(select 1 from private.hosted_canary_runs r where r.candidate_id=c and r.job_key=k) then raise exception 'HOSTED_CANARY_PROVIDER_EXCLUDED'; end if;
  return new;
end $$;
create trigger hosted_canary_attempt_exclusion before insert on public.application_attempts
  for each row execute function private.hosted_canary_exclude_attempt();

create function public.claim_hosted_canary(p_plan_text text,p_recovery boolean default false) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare p jsonb:=p_plan_text::jsonb; a private.hosted_canary_approvals%rowtype; r private.hosted_canary_runs%rowtype;
  b private.hosted_canary_budget%rowtype; c uuid:=(p->>'candidateId')::uuid; app uuid:=(p->>'applicationId')::uuid;
  k text:=private.hosted_canary_job_key(p->>'destinationUrl'); cost integer:=(p->>'reservedRunCents')::integer;
begin
  select * into a from private.hosted_canary_approvals where intent_hash=p->>'intentSha256';
  if not found or a.plan_text is distinct from p_plan_text or k is null then raise exception 'HOSTED_CANARY_APPROVAL_REQUIRED'; end if;
  -- No task admission on expired recovery: the controller will only cancel/reconcile.
  select * into r from private.hosted_canary_runs where intent_hash=a.intent_hash for update;
  if found then
    if r.controller_token is not null and r.controller_until>clock_timestamp() then raise exception 'HOSTED_CANARY_CONTROLLER_BUSY'; end if;
    update private.hosted_canary_runs set controller_token=extensions.gen_random_uuid(),controller_until=clock_timestamp()+interval '5 minutes',version=version+1,
      phase=case when phase in ('CONFIRMED','NOT_ACCEPTED','STOPPED') then phase
        when p_recovery or not a.enabled or a.valid_until<=clock_timestamp() or r.controller_token is not null
          then case when possible_egress then 'UNCERTAIN' else 'STOPPED' end else phase end
      where id=r.id returning * into r;
    return private.hosted_canary_run_json(r);
  end if;
  if p_recovery then raise exception 'HOSTED_CANARY_RECOVERY_NOT_FOUND'; end if;
  if not a.enabled or a.valid_until<=clock_timestamp() or (p->>'deadlineMs')::numeric/1000<=extract(epoch from clock_timestamp()) then
    raise exception 'HOSTED_CANARY_APPROVAL_EXPIRED'; end if;
  -- Fail promptly if a competing launch owns the job or has selected a queued row.
  -- NOWAIT avoids a row-lock/advisory-lock inversion with the existing global claim.
  if not pg_try_advisory_xact_lock(hashtextextended('hosted-canary:'||c::text||':'||k,0)) then raise exception 'HOSTED_CANARY_PROVIDER_BUSY'; end if;
  perform 1 from public.application_autopilots x where x.candidate_id=c and private.hosted_canary_job_key(x.destination_url)=k for update nowait;
  if not exists(select 1 from public.applications x left join public.job_versions j on j.id=x.job_version_id
      left join public.job_intakes i on i.id=x.job_intake_id where x.id=app and x.candidate_id=c
      and (private.hosted_canary_job_key(j.apply_url)=k or private.hosted_canary_job_key(i.canonical_url)=k)) then
    raise exception 'HOSTED_CANARY_APPLICATION_MISMATCH'; end if;
  if exists(select 1 from public.application_autopilots x where x.candidate_id=c and private.hosted_canary_job_key(x.destination_url)=k
      and (x.status in ('RUNNING','SUBMITTING','UNCERTAIN','RECONCILING','CONFIRMED') or x.attempt_id is not null
        or exists(select 1 from private.application_autopilot_runtime rt where rt.autopilot_id=x.id and (rt.runtime_reference is not null or rt.agent_session_id is not null))))
    or exists(select 1 from public.application_fill_attempts x where x.candidate_id=c and private.hosted_canary_job_key(x.destination_url)=k and x.status in ('QUEUED','STARTED'))
    or exists(select 1 from public.computer_sessions x where x.candidate_id=c and private.hosted_canary_job_key(x.start_url)=k and x.state in ('PROVISIONING','ACTIVE','PAUSED_FOR_REVIEW'))
    or exists(select 1 from public.application_attempts t join public.applications x on x.id=t.application_id
      left join public.job_versions j on j.id=x.job_version_id left join public.job_intakes i on i.id=x.job_intake_id
      where x.candidate_id=c and (private.hosted_canary_job_key(j.apply_url)=k or private.hosted_canary_job_key(i.canonical_url)=k)) then
    raise exception 'HOSTED_CANARY_PRIOR_WORK'; end if;
  select * into b from private.hosted_canary_budget where id=true for update;
  if not found or b.valid_until<=clock_timestamp() or cost is null or cost<=0
    or (p->>'priorSpendUpperBoundCents')::integer is distinct from b.prior_upper_cents
    or b.prior_upper_cents+b.reserved_cents+cost>b.ceiling_cents then raise exception 'HOSTED_CANARY_BUDGET_REQUIRED'; end if;
  update private.hosted_canary_budget set reserved_cents=reserved_cents+cost where id=true;
  insert into private.hosted_canary_runs(candidate_id,application_id,job_key,intent_hash,controller_token,controller_until)
    values(c,app,k,a.intent_hash,extensions.gen_random_uuid(),clock_timestamp()+interval '5 minutes') returning * into r;
  -- Remove only this reserved job from the ordinary global queue. Future QUEUED
  -- inserts/requeues are paused by the trigger too, so they cannot poison claims.
  update public.application_autopilots set status='PAUSED',stop_requested='PAUSE',failure_code='HOSTED_CANARY_RESERVED'
    where candidate_id=c and private.hosted_canary_job_key(destination_url)=k and status='QUEUED';
  return private.hosted_canary_run_json(r);
end $$;

create function public.commit_hosted_canary(p_run_id uuid,p_token uuid,p_version integer,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.hosted_canary_runs%rowtype; next_phase text; next_session text;
begin
  select * into strict r from private.hosted_canary_runs where id=p_run_id for update;
  if p_token is null or r.controller_token is distinct from p_token or r.version<>p_version or r.controller_until<=clock_timestamp()
    or jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('phase','sessionId','possibleEgress','cancelRequested','cleanupPending','evidence')) then
    raise exception 'HOSTED_CANARY_FENCE'; end if;
  next_phase:=coalesce(p_patch->>'phase',r.phase); next_session:=coalesce(p_patch->>'sessionId',r.session_id);
  if (r.session_id is not null and next_session is distinct from r.session_id)
    or (r.possible_egress and p_patch->>'possibleEgress'='false') or (r.cancel_requested and p_patch->>'cancelRequested'='false')
    or not (next_phase=r.phase or (r.phase='RESERVED' and next_phase in ('CREATING','STOPPED'))
      or (r.phase='CREATING' and next_phase in ('READY','UNCERTAIN'))
      or (r.phase='READY' and next_phase in ('ADMISSION_PENDING','UNCERTAIN'))
      or (r.phase='ADMISSION_PENDING' and next_phase in ('ACTIVE','UNCERTAIN'))
      or (r.phase in ('ACTIVE','UNCERTAIN') and next_phase in ('UNCERTAIN','CONFIRMED','NOT_ACCEPTED'))) then raise exception 'HOSTED_CANARY_TRANSITION'; end if;
  if next_phase not in ('RESERVED','STOPPED') and not coalesce((p_patch->>'possibleEgress')::boolean,r.possible_egress) then raise exception 'HOSTED_CANARY_EGRESS_REQUIRED'; end if;
  if p_patch ? 'evidence' and (r.evidence is not null and r.evidence is distinct from p_patch->'evidence') then raise exception 'HOSTED_CANARY_EVIDENCE_IMMUTABLE'; end if;
  if next_phase in ('CONFIRMED','NOT_ACCEPTED') then
    if not exists(select 1 from private.hosted_canary_verified_evidence e where e.run_id=r.id and e.evidence=coalesce(p_patch->'evidence',r.evidence)) then raise exception 'HOSTED_CANARY_INDEPENDENT_EVIDENCE_REQUIRED'; end if;
    if not exists(select 1 from private.hosted_canary_approvals a where a.intent_hash=r.intent_hash
      and coalesce(p_patch->'evidence',r.evidence)->>'source'='VERIFIED_EMPLOYER_EVIDENCE'
      and coalesce(p_patch->'evidence',r.evidence)->>'outcome'=next_phase
      and coalesce(p_patch->'evidence',r.evidence)->>'applicationId'=r.application_id::text
      and coalesce(p_patch->'evidence',r.evidence)->>'destinationUrl'=a.plan_text::jsonb->>'destinationUrl'
      and coalesce(p_patch->'evidence',r.evidence)->>'packetSha256'=a.plan_text::jsonb->>'packetSha256'
      and coalesce(p_patch->'evidence',r.evidence)->>'evidenceSha256' ~ '^[0-9a-f]{64}$') then raise exception 'HOSTED_CANARY_EVIDENCE_REQUIRED'; end if;
  elsif p_patch ? 'evidence' then raise exception 'HOSTED_CANARY_EVIDENCE_REQUIRED'; end if;
  update private.hosted_canary_runs set phase=next_phase,session_id=next_session,
    possible_egress=coalesce((p_patch->>'possibleEgress')::boolean,possible_egress),
    cleanup_pending=coalesce((p_patch->>'cleanupPending')::boolean,cleanup_pending),
    evidence=coalesce(p_patch->'evidence',evidence),
    cancel_requested=coalesce((p_patch->>'cancelRequested')::boolean,cancel_requested),version=version+1
    where id=r.id returning * into r;
  return private.hosted_canary_run_json(r);
end $$;
create function public.hosted_canary_budget_available(p_run_id uuid,p_token uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.hosted_canary_runs r cross join private.hosted_canary_budget b join private.hosted_canary_approvals a on a.intent_hash=r.intent_hash
    where r.id=p_run_id and r.controller_token=p_token and r.controller_until>clock_timestamp()
    and a.enabled and a.valid_until>clock_timestamp() and b.valid_until>clock_timestamp() and b.prior_upper_cents+b.reserved_cents<=b.ceiling_cents);
$$;
create function public.release_hosted_canary_controller(p_run_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
  update private.hosted_canary_runs set controller_token=null,controller_until=null,version=version+1 where id=p_run_id and controller_token=p_token;
  if not found then raise exception 'HOSTED_CANARY_FENCE'; end if;
end $$;
create function public.read_hosted_canary_evidence(p_run_id uuid,p_token uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select e.evidence from private.hosted_canary_verified_evidence e join private.hosted_canary_runs r on r.id=e.run_id
  where r.id=p_run_id and r.controller_token=p_token and r.controller_until>clock_timestamp();
$$;
revoke all on function private.hosted_canary_exclude_attempt() from public,anon,authenticated,service_role;
revoke all on function public.read_hosted_canary_evidence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_hosted_canary_evidence(uuid,uuid) to service_role;

revoke all on function private.hosted_canary_job_key(text),private.hosted_canary_run_json(private.hosted_canary_runs),private.hosted_canary_exclude_browserbase() from public,anon,authenticated,service_role;
revoke all on function public.claim_hosted_canary(text,boolean),public.commit_hosted_canary(uuid,uuid,integer,jsonb),public.hosted_canary_budget_available(uuid,uuid),public.release_hosted_canary_controller(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_hosted_canary(text,boolean),public.commit_hosted_canary(uuid,uuid,integer,jsonb),public.hosted_canary_budget_available(uuid,uuid),public.release_hosted_canary_controller(uuid,uuid) to service_role;
