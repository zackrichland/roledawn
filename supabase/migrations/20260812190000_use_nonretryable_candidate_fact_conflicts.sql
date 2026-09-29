-- Candidate-fact aggregate-version conflicts are expected user/business
-- conflicts, not PostgreSQL serialization failures. Return an explicit HTTP
-- 409-class SQLSTATE so PostgREST does not retry or obscure them.

create or replace function private.raise_candidate_fact_version_mismatch()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CANDIDATE_FACT_VERSION_MISMATCH' using errcode = 'PT409';
end;
$$;

revoke all on function private.raise_candidate_fact_version_mismatch()
  from public, anon, authenticated;

create or replace function private.raise_candidate_fact_command_in_progress()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
end;
$$;

revoke all on function private.raise_candidate_fact_command_in_progress()
  from public, anon, authenticated;

-- PostgreSQL has no small function-body patch operation. Replace only the
-- exact conflict branches in the already deployed command function, leaving
-- its signature, grants, and all other behavior unchanged.
do $$
declare
  v_function regprocedure :=
    'public.save_candidate_fact(uuid,text,jsonb,text,bigint)'::regprocedure;
  v_definition text;
begin
  v_definition := pg_get_functiondef(v_function);

  if position(
    'raise exception ''CANDIDATE_FACT_VERSION_MISMATCH'' using errcode = ''40001'';'
    in v_definition
  ) = 0 then
    raise exception 'EXPECTED_CANDIDATE_FACT_VERSION_BRANCH_NOT_FOUND'
      using errcode = '55000';
  end if;

  if position(
    'raise exception ''COMMAND_ALREADY_IN_PROGRESS'' using errcode = ''40001'';'
    in v_definition
  ) = 0 then
    raise exception 'EXPECTED_CANDIDATE_FACT_COMMAND_BRANCH_NOT_FOUND'
      using errcode = '55000';
  end if;

  v_definition := replace(
    v_definition,
    'raise exception ''CANDIDATE_FACT_VERSION_MISMATCH'' using errcode = ''40001'';',
    'perform private.raise_candidate_fact_version_mismatch();'
  );
  v_definition := replace(
    v_definition,
    'raise exception ''COMMAND_ALREADY_IN_PROGRESS'' using errcode = ''40001'';',
    'perform private.raise_candidate_fact_command_in_progress();'
  );
  execute v_definition;
end;
$$;

comment on function private.raise_candidate_fact_version_mismatch() is
  'Returns a non-retryable HTTP 409 business conflict for stale candidate-fact commands.';

comment on function private.raise_candidate_fact_command_in_progress() is
  'Returns a non-retryable HTTP 409 conflict for an incomplete duplicate candidate-fact command.';
