-- Daily imports should not put every role from the last-polled employer first.
-- A UTC-day bucket keeps recent imports first; stable UUID order interleaves
-- boards within each batch and preserves the existing keyset cursor contract.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('public.search_catalog_jobs(text,integer,boolean,text,text,text,timestamptz,uuid)'::regprocedure) into definition;
  if position('or (version.observed_at, job.id) < (p_cursor_observed_at, p_cursor_job_id)' in definition)=0
    or position('order by version.observed_at desc, job.id desc' in definition)=0
    or position('and job.state = ''OPEN''' in definition)=0 then raise exception 'CATALOG_ORDER_DEFINITION_CHANGED'; end if;
  definition := replace(definition,
    'or (version.observed_at, job.id) < (p_cursor_observed_at, p_cursor_job_id)',
    'or (date_trunc(''day'',version.observed_at at time zone ''UTC''),job.id) < (date_trunc(''day'',p_cursor_observed_at at time zone ''UTC''),p_cursor_job_id)');
  definition := replace(definition,'order by version.observed_at desc, job.id desc',
    'order by date_trunc(''day'',version.observed_at at time zone ''UTC'') desc, job.id desc');
  definition := replace(definition,'and job.state = ''OPEN''',
    'and source.polling_enabled and job.last_seen_at >= statement_timestamp() - interval ''7 days'' and job.state = ''OPEN''');
  execute definition;
end $migration$;
