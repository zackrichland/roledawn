begin;
do $$
declare v_url text;
begin
  foreach v_url in array array[
    'https://job-boards.greenhouse.io/example/jobs/1234',
    'https://JOB-BOARDS.GREENHOUSE.IO:443/example/jobs/1234/',
    'https://jobs.lever.co/example/10000000-0000-4000-8000-000000000001',
    'https://JOBS.LEVER.CO:443/example/10000000-0000-4000-8000-000000000001/apply/'
  ] loop
    if not private.is_supported_autopilot_destination(v_url) then raise exception 'EXPECTED_SUPPORTED_URL %',v_url; end if;
  end loop;
  foreach v_url in array array[
    null, '', 'https://jobs.ashbyhq.com/example/10000000-0000-4000-8000-000000000001/application',
    'https://jobs.eu.lever.co/example/10000000-0000-4000-8000-000000000001/apply',
    'https://jobs.lever.co.evil.test/example/10000000-0000-4000-8000-000000000001/apply',
    'https://user@jobs.lever.co/example/10000000-0000-4000-8000-000000000001/apply',
    'https://jobs.lever.co/example/10000000-0000-4000-8000-000000000001/apply?source=x',
    'https://jobs.lever.co/example/10000000-0000-4000-8000-000000000001/thanks',
    'https://job-boards.eu.greenhouse.io/example/jobs/1234',
    'https://job-boards.greenhouse.io/example/jobs/1234#application',
    'https://job-boards.greenhouse.io/example/../other/jobs/1234'
  ] loop
    if private.is_supported_autopilot_destination(v_url) then raise exception 'EXPECTED_UNSUPPORTED_URL %',v_url; end if;
  end loop;
  if has_function_privilege('anon','private.is_supported_autopilot_destination(text)','execute')
    or has_function_privilege('authenticated','private.is_supported_autopilot_destination(text)','execute')
    or has_function_privilege('service_role','private.is_supported_autopilot_destination(text)','execute') then
    raise exception 'CAPABILITY_HELPER_NOT_PRIVATE';
  end if;
  if position('if not private.is_supported_autopilot_destination(v_destination_url) then' in
    pg_get_functiondef('private.delegate_application_autopilot(uuid,uuid,bigint,uuid,text)'::regprocedure)) = 0 then
    raise exception 'DELEGATION_GUARD_NOT_BOUND';
  end if;
end;
$$;
rollback;
