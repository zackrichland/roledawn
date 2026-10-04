-- Run after the reviewed draft in local PGlite; no provider or hosted DB calls.
do $$ begin
  if private.hosted_canary_job_key('https://job-boards.greenhouse.io/example/jobs/123') is not null then raise exception 'GREENHOUSE_SCOPE_CHANGED'; end if;
  if private.hosted_canary_job_key('https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111/apply?source=fixture')
    is distinct from private.hosted_canary_job_key('https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111') then raise exception 'JOB_IDENTITY_CHANGED'; end if;
  if has_function_privilege('anon','public.claim_hosted_canary(text,boolean)','execute')
    or has_function_privilege('authenticated','public.commit_hosted_canary(uuid,uuid,integer,jsonb)','execute')
    or has_table_privilege('service_role','private.hosted_canary_approvals','INSERT')
    or has_table_privilege('service_role','private.hosted_canary_verified_evidence','INSERT') then raise exception 'EXPERIMENT_PRIVILEGE_TOO_BROAD'; end if;
  if exists(select 1 from private.hosted_canary_runs) or exists(select 1 from private.hosted_canary_approvals) then raise exception 'EXPERIMENT_MUST_START_EMPTY'; end if;
end $$;
select 'disabled schema and scoped privileges pass' as result;
