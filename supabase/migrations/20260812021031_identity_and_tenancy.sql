-- RoleDawn / HireWire: identity and tenant boundary.
-- Supabase Auth owns login identity. These tables own product tenancy and candidate state.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  kind text not null default 'PERSONAL'
    check (kind in ('PERSONAL', 'COACH', 'ORGANIZATION')),
  personal_owner_auth_user_id uuid references auth.users(id) on delete restrict,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SUSPENDED', 'DELETION_PENDING')),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'PERSONAL' and personal_owner_auth_user_id is not null)
    or (kind <> 'PERSONAL' and personal_owner_auth_user_id is null)
  )
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER', 'CANDIDATE', 'COACH', 'SUPPORT')),
  status text not null default 'ACTIVE'
    check (status in ('INVITED', 'ACTIVE', 'REVOKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, auth_user_id)
);

create table public.candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (btrim(display_name) <> ''),
  status text not null default 'ONBOARDING'
    check (status in ('ONBOARDING', 'ACTIVE', 'PAUSED', 'DELETION_PENDING')),
  tailoring_mode text not null default 'REORDER_AND_TIGHTEN'
    check (tailoring_mode in ('AS_UPLOADED', 'REORDER_AND_TIGHTEN', 'REWRITE_FROM_VERIFIED_FACTS')),
  submission_mode text not null default 'PER_APPLICATION_APPROVAL'
    check (submission_mode in ('DRAFT_ONLY', 'PER_APPLICATION_APPROVAL')),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, auth_user_id)
);

create index workspace_memberships_user_active_idx
  on public.workspace_memberships (auth_user_id, workspace_id)
  where status = 'ACTIVE';
create index workspace_memberships_workspace_role_active_idx
  on public.workspace_memberships (workspace_id, role)
  where status = 'ACTIVE';
create index candidates_auth_user_idx on public.candidates (auth_user_id);
create index candidates_workspace_status_idx on public.candidates (workspace_id, status);
create unique index workspaces_personal_owner_idx
  on public.workspaces (personal_owner_auth_user_id)
  where kind = 'PERSONAL';

-- RLS helper. It derives membership from auth.uid(); no caller-supplied tenant is trusted.
create or replace function private.authorized_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.workspace_id
  from public.workspace_memberships as membership
  join public.workspaces as workspace on workspace.id = membership.workspace_id
  where membership.auth_user_id = (select auth.uid())
    and membership.status = 'ACTIVE'
    and workspace.status = 'ACTIVE'
$$;

create or replace function private.is_public_https_job_url(p_url text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  with parsed as (
    select lower(split_part(split_part(substring(p_url from 9), '/', 1), '?', 1)) as authority
  ), host as (
    select authority, authority as value
    from parsed
  )
  select char_length(p_url) between 10 and 2048
    and p_url ~ '^https://'
    and p_url !~ '[[:space:]]'
    and position('#' in p_url) = 0
    and authority <> ''
    and authority not like '%:%'
    and position('@' in authority) = 0
    and value ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$'
    and value <> 'localhost'
    and value !~ '\.(localhost|local)$'
    and value !~ '^\d{1,3}(?:\.\d{1,3}){3}$'
  from host
$$;

revoke all on function private.authorized_workspace_ids() from public, anon;
revoke all on function private.is_public_https_job_url(text) from public, anon, authenticated;
grant execute on function private.authorized_workspace_ids() to authenticated;
grant execute on function private.authorized_workspace_ids() to service_role;
grant execute on function private.is_public_https_job_url(text) to service_role;

-- One replay-safe onboarding surface for a newly authenticated candidate. The
-- caller never supplies an auth user or workspace ID; both are derived here.
create or replace function public.bootstrap_personal_workspace(
  p_display_name text default 'Candidate'
)
returns table (workspace_id uuid, candidate_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_existing_count integer;
  v_display_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_display_name) not between 1 and 120 then
    raise exception 'DISPLAY_NAME_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('candidate-bootstrap:' || v_actor::text, 0));

  select count(*) into v_existing_count
  from public.candidates as candidate
  join public.workspace_memberships as membership
    on membership.workspace_id = candidate.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = candidate.workspace_id
   and workspace.status = 'ACTIVE'
   and workspace.kind = 'PERSONAL'
   and workspace.personal_owner_auth_user_id = v_actor
  where candidate.auth_user_id = v_actor
    and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED');

  if v_existing_count > 1 then
    raise exception 'ACTIVE_CANDIDATE_AMBIGUOUS' using errcode = '21000';
  end if;

  if v_existing_count = 1 then
    select candidate.workspace_id, candidate.id
      into strict v_workspace, v_candidate
    from public.candidates as candidate
    join public.workspace_memberships as membership
      on membership.workspace_id = candidate.workspace_id
     and membership.auth_user_id = v_actor
     and membership.status = 'ACTIVE'
    join public.workspaces as workspace
      on workspace.id = candidate.workspace_id
     and workspace.status = 'ACTIVE'
     and workspace.kind = 'PERSONAL'
     and workspace.personal_owner_auth_user_id = v_actor
    where candidate.auth_user_id = v_actor
      and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED');

    return query select v_workspace, v_candidate, true;
    return;
  end if;

  insert into public.workspaces (name, kind, personal_owner_auth_user_id)
  values (v_display_name || ' workspace', 'PERSONAL', v_actor)
  returning id into v_workspace;

  insert into public.workspace_memberships (workspace_id, auth_user_id, role, status)
  values (v_workspace, v_actor, 'OWNER', 'ACTIVE');

  insert into public.candidates (workspace_id, auth_user_id, display_name, status)
  values (v_workspace, v_actor, v_display_name, 'ONBOARDING')
  returning id into v_candidate;

  return query select v_workspace, v_candidate, false;
end;
$$;

revoke all on function public.bootstrap_personal_workspace(text) from public, anon;
grant execute on function public.bootstrap_personal_workspace(text) to authenticated;
grant execute on function public.bootstrap_personal_workspace(text) to service_role;

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.candidates enable row level security;

create policy workspaces_member_select on public.workspaces
  for select to authenticated
  using (id in (select private.authorized_workspace_ids()));

create policy memberships_self_select on public.workspace_memberships
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    and workspace_id in (select private.authorized_workspace_ids())
  );

create policy candidates_member_select on public.candidates
  for select to authenticated
  using (workspace_id in (select private.authorized_workspace_ids()));

revoke all on public.workspaces, public.workspace_memberships, public.candidates from anon, authenticated;
grant select on public.workspaces, public.workspace_memberships, public.candidates to authenticated;
grant all on public.workspaces, public.workspace_memberships, public.candidates to service_role;

comment on function private.authorized_workspace_ids() is
  'Fail-closed workspace authorization derived from active Supabase Auth membership.';
comment on function public.bootstrap_personal_workspace(text) is
  'Replay-safe personal candidate bootstrap derived only from auth.uid().';
