-- Local PGlite check for 20260930143000_employer_logos.sql.
--   node scripts/migration-harness.mjs supabase/checks/employer_logos.sql
-- Synthetic bytes only; everything is rolled back. Route calls run as service_role.
begin;
create temporary table employer_logo_checks(check_name text primary key, passed boolean not null) on commit drop;

do $check$
declare
  v_row public.employer_logos%rowtype;
  v_status text;
  v_first timestamptz;
begin
  -- A found logo is stored with its bytes and type, through the service role's function only.
  execute 'set local role service_role';
  v_status := public.record_employer_logo_check('ashby', 'example', 'FOUND', 'image/webp', '\x52494646000000005745425000'::bytea);
  select * into v_row from public.employer_logos where provider = 'ashby' and board_slug = 'example';
  execute 'reset role';
  if v_status <> 'FOUND' or v_row.status <> 'FOUND' or v_row.content_type <> 'image/webp' or v_row.miss_count <> 0
     or octet_length(v_row.logo_bytes) <> 13 then raise exception 'CHECK_FOUND_NOT_STORED'; end if;
  insert into employer_logo_checks values ('found_logo_is_stored', true);

  -- A transient failure touches attempted_at and nothing else.
  v_first := v_row.attempted_at;
  execute 'set local role service_role';
  v_status := public.record_employer_logo_check('ashby', 'example', 'ERROR');
  select * into v_row from public.employer_logos where provider = 'ashby' and board_slug = 'example';
  execute 'reset role';
  if v_status <> 'FOUND' or v_row.status <> 'FOUND' or v_row.logo_bytes is null or v_row.checked_at = v_row.attempted_at
     or v_row.attempted_at <= v_first then raise exception 'CHECK_ERROR_TOUCHED_LOGO'; end if;
  insert into employer_logo_checks values ('transient_failure_never_replaces_a_logo', true);

  -- An error for a board with no row creates nothing: a transient failure is not an answer.
  execute 'set local role service_role';
  v_status := public.record_employer_logo_check('lever', 'nothing-yet', 'ERROR');
  execute 'reset role';
  if v_status is not null or exists (select 1 from public.employer_logos where board_slug = 'nothing-yet') then
    raise exception 'CHECK_ERROR_CREATED_ROW';
  end if;
  insert into employer_logo_checks values ('transient_failure_creates_no_row', true);

  -- Definite misses keep a found logo for two rounds and demote it on the third.
  execute 'set local role service_role';
  perform public.record_employer_logo_check('ashby', 'example', 'NONE');
  perform public.record_employer_logo_check('ashby', 'example', 'NONE');
  select * into v_row from public.employer_logos where provider = 'ashby' and board_slug = 'example';
  if v_row.status <> 'FOUND' or v_row.logo_bytes is null or v_row.miss_count <> 2 then raise exception 'CHECK_MISS_DEMOTED_EARLY'; end if;
  -- A new logo resets the count.
  perform public.record_employer_logo_check('ashby', 'example', 'FOUND', 'image/webp', '\x52494646000000005745425001'::bytea);
  select * into v_row from public.employer_logos where provider = 'ashby' and board_slug = 'example';
  if v_row.miss_count <> 0 or encode(v_row.logo_bytes, 'hex') <> '5249464600000000574542500' || '1' then raise exception 'CHECK_FOUND_DID_NOT_RESET'; end if;
  perform public.record_employer_logo_check('ashby', 'example', 'NONE');
  perform public.record_employer_logo_check('ashby', 'example', 'NONE');
  perform public.record_employer_logo_check('ashby', 'example', 'NONE');
  select * into v_row from public.employer_logos where provider = 'ashby' and board_slug = 'example';
  execute 'reset role';
  if v_row.status <> 'NONE' or v_row.logo_bytes is not null or v_row.content_type is not null or v_row.miss_count <> 0 then
    raise exception 'CHECK_THIRD_MISS_NOT_DEMOTED';
  end if;
  insert into employer_logo_checks values ('a_logo_survives_two_misses_and_a_third_demotes_it', true);

  -- A NONE row is created for a board that never had a logo, and a later found logo replaces it.
  execute 'set local role service_role';
  v_status := public.record_employer_logo_check('greenhouse', 'no-logo-board', 'NONE');
  if v_status <> 'NONE' then raise exception 'CHECK_NONE_NOT_STORED'; end if;
  v_status := public.record_employer_logo_check('greenhouse', 'no-logo-board', 'FOUND', 'image/svg+xml', '\x3c7376672f3e'::bytea);
  execute 'reset role';
  if v_status <> 'FOUND' then raise exception 'CHECK_NONE_NOT_REPLACED'; end if;
  insert into employer_logo_checks values ('none_is_remembered_and_a_found_logo_replaces_it', true);

  -- The EU twin of a board is a different employer identity.
  execute 'set local role service_role';
  perform public.record_employer_logo_check('greenhouse-eu', 'no-logo-board', 'NONE');
  execute 'reset role';
  if (select count(*) from public.employer_logos where board_slug = 'no-logo-board') <> 2 then raise exception 'CHECK_REGION_MERGED'; end if;
  insert into employer_logo_checks values ('regions_are_separate_identities', true);

  -- Bad input is refused by the table and the function.
  begin
    execute 'set local role service_role';
    perform public.record_employer_logo_check('ashby', 'Upper.Case', 'NONE');
    raise exception 'CHECK_UPPERCASE_SLUG_ACCEPTED';
  exception when check_violation then execute 'reset role'; end;
  begin
    execute 'set local role service_role';
    perform public.record_employer_logo_check('ashby', 'a..b', 'NONE');
    raise exception 'CHECK_DOTDOT_SLUG_ACCEPTED';
  exception when check_violation then execute 'reset role'; end;
  begin
    execute 'set local role service_role';
    perform public.record_employer_logo_check('ashby', 'huge', 'FOUND', 'image/webp', decode(repeat('ab', 262145), 'hex'));
    raise exception 'CHECK_OVERSIZED_LOGO_ACCEPTED';
  exception when check_violation then execute 'reset role'; end;
  begin
    execute 'set local role service_role';
    perform public.record_employer_logo_check('ashby', 'wrong-type', 'FOUND', 'text/html', '\x3c68313e'::bytea);
    raise exception 'CHECK_HTML_LOGO_ACCEPTED';
  exception when check_violation then execute 'reset role'; end;
  begin
    execute 'set local role service_role';
    perform public.record_employer_logo_check('ashby', 'no-bytes', 'FOUND');
    raise exception 'CHECK_FOUND_WITHOUT_BYTES_ACCEPTED';
  exception when invalid_parameter_value then execute 'reset role'; end;
  begin
    execute 'set local role service_role';
    perform public.record_employer_logo_check('ashby', 'bad-outcome', 'MAYBE');
    raise exception 'CHECK_BAD_OUTCOME_ACCEPTED';
  exception when invalid_parameter_value then execute 'reset role'; end;
  insert into employer_logo_checks values ('malformed_rows_are_refused', true);

  -- Clients cannot read the table or call the function; the service role can read but not write directly.
  execute 'set local role authenticated';
  begin
    perform 1 from public.employer_logos;
    raise exception 'CHECK_CANDIDATE_READ_LOGOS';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_employer_logo_check('ashby', 'example', 'NONE');
    raise exception 'CHECK_CANDIDATE_RECORDED_LOGO';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform 1 from public.employer_logos;
    raise exception 'CHECK_ANON_READ_LOGOS';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_employer_logo_check('ashby', 'example', 'NONE');
    raise exception 'CHECK_ANON_RECORDED_LOGO';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  perform 1 from public.employer_logos;
  begin
    insert into public.employer_logos(provider, board_slug, status) values ('ashby', 'direct-write', 'NONE');
    raise exception 'CHECK_SERVICE_ROLE_DIRECT_WRITE';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  insert into employer_logo_checks values ('only_the_service_role_reads_and_only_the_function_writes', true);

  -- Every public table has RLS, and this one has no client policy.
  if not (select relrowsecurity from pg_class where oid = 'public.employer_logos'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employer_logos') then
    raise exception 'CHECK_RLS_MISSING_OR_POLICY_PRESENT';
  end if;
  -- SECURITY DEFINER with an empty search path.
  if not exists (select 1 from pg_proc p where p.oid = 'public.record_employer_logo_check(text,text,text,text,bytea)'::regprocedure
                 and p.prosecdef and p.proconfig @> array['search_path=""']) then
    raise exception 'CHECK_FUNCTION_NOT_HARDENED';
  end if;
  insert into employer_logo_checks values ('rls_enabled_without_policies_and_function_is_hardened', true);
end $check$;

select check_name, passed from employer_logo_checks order by check_name;
rollback;
