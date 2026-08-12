-- Allow immutable résumé evidence to be removed only as part of the
-- service-owned source-document purge cascade. Direct updates and deletes
-- remain blocked, including direct service-role deletes.

create or replace function private.reject_source_document_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_user = 'service_role'
     and (
       current_setting('roledawn.source_document_purge_id', true) = old.document_id::text
       or pg_trigger_depth() > 1
     ) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

comment on function private.reject_source_document_evidence_mutation() is
  'Blocks direct evidence mutation while permitting service-owned FK cascades for candidate-requested deletion.';
