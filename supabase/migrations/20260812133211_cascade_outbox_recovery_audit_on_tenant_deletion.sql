-- RoleDawn / HireWire: preserve append-only recovery history for the life of a
-- tenant while allowing an explicit whole-tenant deletion to remove that
-- tenant's audit records. Row-level update/delete remains trigger-rejected.

create or replace function private.reject_outbox_recovery_action_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'OUTBOX_RECOVERY_ACTION_IMMUTABLE' using errcode = '55000';
end;
$$;

drop trigger outbox_recovery_actions_immutable
  on public.outbox_recovery_actions;

create trigger outbox_recovery_actions_immutable
  before update or delete on public.outbox_recovery_actions
  for each row execute function private.reject_outbox_recovery_action_mutation();

alter table public.outbox_recovery_actions
  drop constraint outbox_recovery_actions_workspace_id_fkey,
  drop constraint outbox_recovery_actions_outbox_id_fkey,
  drop constraint outbox_recovery_actions_operator_auth_user_id_fkey,
  drop constraint outbox_recovery_actions_workspace_id_outbox_id_fkey;

alter table public.outbox_recovery_actions
  add constraint outbox_recovery_actions_workspace_id_fkey
    foreign key (workspace_id)
    references public.workspaces(id) on delete cascade,
  add constraint outbox_recovery_actions_outbox_id_fkey
    foreign key (outbox_id)
    references public.outbox(id) on delete cascade,
  add constraint outbox_recovery_actions_operator_auth_user_id_fkey
    foreign key (operator_auth_user_id)
    references auth.users(id) on delete cascade,
  add constraint outbox_recovery_actions_workspace_id_outbox_id_fkey
    foreign key (workspace_id, outbox_id)
    references public.outbox(workspace_id, id) on delete cascade;
