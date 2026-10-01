-- Terminal writing failures must satisfy the existing dead-letter pair constraint atomically.
do $patch$
declare
 signature regprocedure := 'public.fail_application_drafting_terminal(uuid,text,uuid,uuid,uuid,text,jsonb)'::regprocedure;
 definition text := pg_get_functiondef(signature);
 old text := 'set dead_lettered_at=statement_timestamp(),last_error=p_error_code';
begin
 if position(old in definition)=0 then raise exception 'DRAFTING_FAILURE_PATCH_DRIFT'; end if;
 execute replace(definition,old,'set dead_lettered_at=statement_timestamp(),dead_letter_reason=p_error_code,last_error=p_error_code');
end $patch$;

create or replace function private.auto_apply_state(p_candidate uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce(s.enabled,false),'status',coalesce(s.status,'OFF'),'version',coalesce(s.version,0),
   'interval_seconds',p.interval_seconds,'daily_cap',p.daily_cap,'next_submission_at',s.next_submission_at,
   'last_checked_at',s.last_checked_at,'last_outcome',s.last_outcome,
   'attempted_today',(select count(*) from public.application_attempts a join public.applications e on e.id=a.application_id
     where e.candidate_id=p_candidate and a.started_at >= date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC'),
   'confirmed_today',(select count(*) from public.application_attempts a join public.applications e on e.id=a.application_id
     where e.candidate_id=p_candidate and a.status='CONFIRMED' and a.started_at >= date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC'))
 from private.auto_apply_plans p left join public.candidate_auto_apply_settings s on s.candidate_id=p_candidate and s.plan_key=p.plan_key
 where p.plan_key=coalesce((select plan_key from public.candidate_auto_apply_settings where candidate_id=p_candidate),'PILOT');
$$;

-- The same candidate's manual and catalog submissions share the daily cap.
-- Lock the candidate before counting, so simultaneous workers cannot both consume the last slot.
-- Unknown attempts consume capacity; preparation and employer-side draft saves do not.
create or replace function private.enforce_auto_apply_submission_rate() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 c public.candidates%rowtype; e public.auto_apply_enrollments%rowtype;
 s public.candidate_auto_apply_settings%rowtype; plan private.auto_apply_plans%rowtype; used integer;
begin
 select candidate.* into strict c from public.candidates candidate
   join public.applications application on application.candidate_id=candidate.id where application.id=new.application_id
   for update of candidate;
 select * into strict plan from private.auto_apply_plans where plan_key=coalesce(
   (select plan_key from public.candidate_auto_apply_settings where candidate_id=c.id),'PILOT');
 select count(*) into used from public.application_attempts a join public.applications application on application.id=a.application_id
   where application.candidate_id=c.id and a.started_at>=date_trunc('day',statement_timestamp() at time zone 'UTC') at time zone 'UTC';
 if used>=plan.daily_cap then raise exception 'APPLICATION_DAILY_LIMIT_REACHED' using errcode='55000'; end if;
 select * into e from public.auto_apply_enrollments where application_id=new.application_id;
 if not found then return new; end if;
 s:=private.assert_auto_apply_consent(e.candidate_id,e.consent_version);
 if s.next_submission_at>statement_timestamp() then raise exception 'AUTO_APPLY_RATE_LIMITED' using errcode='55000'; end if;
 update public.candidate_auto_apply_settings set next_submission_at=statement_timestamp()+make_interval(secs=>plan.interval_seconds),updated_at=statement_timestamp() where candidate_id=e.candidate_id;
 return new;
end; $$;
