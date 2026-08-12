-- Aggregate-version conflicts are expected user/business conflicts, not
-- PostgreSQL serialization failures. Return an explicit HTTP 409-class SQLSTATE
-- so PostgREST clients and infrastructure do not retry or stall them.

create or replace function private.raise_source_document_version_mismatch()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SOURCE_DOCUMENT_VERSION_MISMATCH' using errcode = 'PT409';
end;
$$;

revoke all on function private.raise_source_document_version_mismatch()
  from public, anon, authenticated;

-- PostgreSQL has no small function-body patch operation. Replace the two exact
-- business-conflict branches in the already deployed command functions while
-- leaving their signatures, grants, and all other behavior unchanged.
do $$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.request_source_document_deletion(uuid,uuid,bigint)'::regprocedure,
    'public.review_resume_text(uuid,uuid,uuid,bigint,text,text)'::regprocedure
  ]
  loop
    v_definition := pg_get_functiondef(v_function);
    if position(
      'raise exception ''SOURCE_DOCUMENT_VERSION_MISMATCH'' using errcode = ''40001'';'
      in v_definition
    ) = 0 then
      raise exception 'EXPECTED_SOURCE_DOCUMENT_VERSION_BRANCH_NOT_FOUND'
        using errcode = '55000';
    end if;
    v_definition := replace(
      v_definition,
      'raise exception ''SOURCE_DOCUMENT_VERSION_MISMATCH'' using errcode = ''40001'';',
      'perform private.raise_source_document_version_mismatch();'
    );
    execute v_definition;
  end loop;
end;
$$;

comment on function private.raise_source_document_version_mismatch() is
  'Returns a non-retryable HTTP 409 business conflict for stale résumé commands.';
