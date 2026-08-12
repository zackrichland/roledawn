-- RoleDawn / HireWire: shared, attributable job catalog.
-- Workers write through the server connection. Authenticated clients may read only sanitized jobs.

create table public.employers (
  id uuid primary key default extensions.gen_random_uuid(),
  canonical_name text not null check (btrim(canonical_name) <> ''),
  canonical_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_domain)
);

create table public.job_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  employer_id uuid references public.employers(id) on delete restrict,
  provider text not null check (btrim(provider) <> ''),
  tenant_key text not null check (btrim(tenant_key) <> ''),
  list_url text,
  application_domain text not null check (btrim(application_domain) <> ''),
  policy_status text not null default 'REVIEW'
    check (policy_status in ('ALLOWLISTED', 'REVIEW', 'BLOCKED')),
  polling_enabled boolean not null default false,
  adapter_release text not null check (btrim(adapter_release) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, tenant_key)
);

create table public.ingestion_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id uuid not null references public.job_sources(id) on delete restrict,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  checkpoint jsonb not null default '{}'::jsonb,
  response_status integer,
  snapshot_complete boolean,
  observed_count bigint not null default 0 check (observed_count >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (finished_at is null or finished_at >= started_at)
);

create table public.source_job_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id uuid not null references public.job_sources(id) on delete restrict,
  ingestion_run_id uuid not null references public.ingestion_runs(id) on delete restrict,
  external_job_id text not null check (btrim(external_job_id) <> ''),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  raw_payload_ref text,
  response_headers jsonb not null default '{}'::jsonb,
  parser_release text not null check (btrim(parser_release) <> ''),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_id, external_job_id, payload_hash)
);

create table public.source_job_listings (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id uuid not null references public.job_sources(id) on delete restrict,
  external_job_id text not null check (btrim(external_job_id) <> ''),
  source_url text not null check (source_url ~ '^https://'),
  apply_url text not null check (apply_url ~ '^https://'),
  state text not null default 'OPEN' check (state in ('OPEN', 'CLOSED', 'STALE', 'UNKNOWN')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_job_id),
  check (last_seen_at >= first_seen_at)
);

create table public.jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  employer_id uuid references public.employers(id) on delete restrict,
  source_listing_id uuid references public.source_job_listings(id) on delete restrict,
  canonical_url text not null check (canonical_url ~ '^https://'),
  state text not null default 'UNKNOWN' check (state in ('OPEN', 'CLOSED', 'STALE', 'UNKNOWN')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_url),
  unique (source_listing_id),
  check (last_seen_at >= first_seen_at)
);

create table public.job_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  version_number bigint not null check (version_number > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  title text not null check (btrim(title) <> ''),
  employer_name text not null check (btrim(employer_name) <> ''),
  description_text text not null check (btrim(description_text) <> ''),
  location_text text,
  work_mode text check (work_mode is null or work_mode in ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN')),
  employment_type text,
  apply_url text not null check (apply_url ~ '^https://'),
  published_at timestamptz,
  observed_at timestamptz not null,
  normalized_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, version_number),
  unique (job_id, content_hash),
  unique (job_id, id)
);

alter table public.jobs add column current_version_id uuid;
alter table public.jobs add constraint jobs_current_version_fkey
  foreign key (id, current_version_id) references public.job_versions(job_id, id)
  deferrable initially deferred;

create index employers_name_idx on public.employers (canonical_name);
create index job_sources_employer_idx on public.job_sources (employer_id) where employer_id is not null;
create index job_sources_polling_idx on public.job_sources (provider, id) where polling_enabled;
create index ingestion_runs_source_started_idx on public.ingestion_runs (source_id, started_at desc, id);
create index source_observations_run_idx on public.source_job_observations (ingestion_run_id, observed_at, id);
create index source_observations_source_idx on public.source_job_observations (source_id, observed_at desc, id);
create index source_listings_state_seen_idx on public.source_job_listings (state, last_seen_at desc, id);
create index source_listings_source_idx on public.source_job_listings (source_id, last_seen_at desc, id);
create index jobs_state_seen_idx on public.jobs (state, last_seen_at desc, id);
create index jobs_employer_idx on public.jobs (employer_id, last_seen_at desc, id) where employer_id is not null;
create index job_versions_job_created_idx on public.job_versions (job_id, created_at desc, id);

alter table public.employers enable row level security;
alter table public.job_sources enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.source_job_observations enable row level security;
alter table public.source_job_listings enable row level security;
alter table public.jobs enable row level security;
alter table public.job_versions enable row level security;

-- The candidate catalog exposes normalized jobs only. Source operations stay server-only.
create policy jobs_authenticated_select on public.jobs
  for select to authenticated using (true);
create policy job_versions_authenticated_select on public.job_versions
  for select to authenticated using (true);

revoke all on public.employers, public.job_sources, public.ingestion_runs,
  public.source_job_observations, public.source_job_listings, public.jobs,
  public.job_versions from anon, authenticated;
grant select on public.jobs, public.job_versions to authenticated;
grant all on public.employers, public.job_sources, public.ingestion_runs,
  public.source_job_observations, public.source_job_listings, public.jobs,
  public.job_versions to service_role;

comment on table public.source_job_observations is
  'Immutable source observation metadata; raw payloads remain in private object storage when permitted.';
