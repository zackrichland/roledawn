-- Read-only acceptance after application_drafting_terminal_failure.
do $acceptance$
declare v_history jsonb := '{"release":"application-drafting-repair/1","attempts":[]}'::jsonb; v_role text;
begin
  if not private.application_drafting_attempt_history_valid(v_history) then raise exception 'DRAFTING_FAILURE_EMPTY_HISTORY_REJECTED'; end if;
  if private.application_drafting_attempt_history_valid(v_history||'{"providerError":"untrusted text"}'::jsonb)
    or private.application_drafting_attempt_history_valid('{"release":"application-drafting-repair/1","attempts":[{"attempt":1,"status":"ERROR","deterministicIssueCodes":[],"semanticIssueCodes":[],"qualityIssueCodes":["UNTRUSTED_TEXT"]}]}')
  then raise exception 'DRAFTING_FAILURE_PRIVATE_TEXT_ALLOWED'; end if;
  foreach v_role in array array['anon','authenticated'] loop
    if has_function_privilege(v_role,'public.fail_application_drafting_terminal(uuid,text,uuid,uuid,uuid,text,jsonb)','EXECUTE')
      or has_function_privilege(v_role,'private.application_drafting_attempt_history_valid(jsonb)','EXECUTE') then
      raise exception 'DRAFTING_FAILURE_RPC_EXPOSED'; end if;
  end loop;
  if not has_function_privilege('service_role','public.fail_application_drafting_terminal(uuid,text,uuid,uuid,uuid,text,jsonb)','EXECUTE') then
    raise exception 'DRAFTING_FAILURE_SERVICE_GRANT_MISSING'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='application_runs' and column_name='drafting_attempt_history' and data_type='jsonb') then
    raise exception 'DRAFTING_FAILURE_HISTORY_COLUMN_MISSING'; end if;
end;
$acceptance$;
select 'drafting terminal failure: redacted history and service-only ACLs passed' as acceptance;
