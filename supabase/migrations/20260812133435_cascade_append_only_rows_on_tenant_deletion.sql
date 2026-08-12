-- RoleDawn / HireWire: append-only means immutable during an active tenant's
-- life. It must not defeat the product's explicit whole-tenant deletion path.
-- PostgreSQL cascade triggers execute nested beneath the parent delete.

create or replace function private.reject_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

comment on function private.reject_row_mutation() is
  'Reject direct row mutation while permitting FK-cascaded deletion during an authorized parent lifecycle delete.';
