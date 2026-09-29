-- RoleDawn: preserve the exact employer application-form structure observed
-- with an official job payload. This is execution metadata, not candidate
-- data and not submission authority.

create table public.job_application_schema_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null,
  job_version_id uuid not null,
  provider text not null check (provider in ('GREENHOUSE', 'LEVER', 'ASHBY')),
  adapter_release text not null check (btrim(adapter_release) <> ''),
  schema_hash text not null check (schema_hash ~ '^[0-9a-f]{64}$'),
  normalized_schema jsonb not null
    check (jsonb_typeof(normalized_schema) = 'object'),
  provider_binding jsonb not null
    check (jsonb_typeof(provider_binding) = 'object'),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (job_version_id, schema_hash),
  constraint job_application_schema_versions_job_version_fkey
  foreign key (job_id, job_version_id)
    references public.job_versions(job_id, id)
    on delete restrict
);

create index job_application_schema_versions_latest_idx
  on public.job_application_schema_versions
    (job_version_id, observed_at desc, created_at desc, id);

create trigger job_application_schema_versions_immutable
before update or delete on public.job_application_schema_versions
for each row execute function private.reject_row_mutation();

alter table public.job_application_schema_versions enable row level security;

revoke all on public.job_application_schema_versions
  from public, anon, authenticated;
grant select, insert on public.job_application_schema_versions
  to service_role;

comment on table public.job_application_schema_versions is
  'Append-only normalized employer form schemas and private provider bindings; contains no candidate answers and grants no fill or submit authority.';
