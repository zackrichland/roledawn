-- Employer logos: one durable thumbnail per (provider, board slug).
--
-- The web app used to read the employer's board page and logo, and run sharp, on every logo request that
-- missed the CDN. The CDN cache is purged on every deploy and a miss was never remembered, so a slow or
-- throttled read left the queue with initials. The route now serves the thumbnail stored here, refreshes a
-- found logo weekly (serving the stored one meanwhile), and asks again about a "none" after a few hours.
-- A transient upstream failure is recorded only as an attempt and never replaces a logo.
--
-- Employer identity is (provider, board slug) taken from the posting URL: 'ashby', 'greenhouse', 'lever' and the
-- EU twins 'greenhouse-eu' and 'lever-eu'. Never a guessed company domain. Rows hold public employer branding
-- only; nothing here is candidate data. Access is service-role only: no client policies, no client grants.

create table public.employer_logos (
  provider text not null check (provider ~ '^[a-z][a-z-]{1,31}$'),
  board_slug text not null check (board_slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$' and position('..' in board_slug) = 0),
  -- FOUND: a logo is stored. NONE: the board answered and has no usable logo.
  status text not null check (status in ('FOUND', 'NONE')),
  content_type text check (content_type in ('image/webp', 'image/svg+xml')),
  -- At most 96 px per side as webp; an employer SVG passes through untouched under the same size cap.
  logo_bytes bytea check (logo_bytes is null or octet_length(logo_bytes) between 1 and 262144),
  -- When the stored bytes (or the NONE answer) were last replaced.
  fetched_at timestamptz not null default now(),
  -- The last time the board gave a definite answer. Drives the weekly refresh and the NONE retry.
  checked_at timestamptz not null default now(),
  -- The last upstream attempt of any outcome, including transient failures. Throttles retries across instances.
  attempted_at timestamptz not null default now(),
  -- Consecutive definite "no logo" answers for a FOUND row. Three in a row demote it; one never does.
  miss_count smallint not null default 0 check (miss_count between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (provider, board_slug),
  constraint employer_logos_bytes_match_status check (
    (status = 'FOUND' and logo_bytes is not null and content_type is not null)
    or (status = 'NONE' and logo_bytes is null and content_type is null)
  )
);
alter table public.employer_logos enable row level security;
revoke all on table public.employer_logos from public, anon, authenticated, service_role;
grant select on table public.employer_logos to service_role;
comment on table public.employer_logos is 'Public employer logo thumbnails keyed by ATS provider and board slug. Service role only; written through record_employer_logo_check.';

-- One atomic transition per live read. The database, not the caller, decides what may replace what.
--   FOUND: store the bytes.
--   NONE:  a definite "no logo". Creates or refreshes a NONE row. On a FOUND row it counts a miss and keeps
--          the logo until the third consecutive miss, so a markup change or a bad page cannot wipe logos.
--   ERROR: a transient failure. Touches attempted_at on an existing row and nothing else; never creates a row.
-- Returns the row's status afterwards, or null when there is no row.
create or replace function public.record_employer_logo_check(
  p_provider text,
  p_board_slug text,
  p_outcome text,
  p_content_type text default null,
  p_logo_bytes bytea default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  -- One instant per call (clock, not transaction, time) so its columns agree and successive calls always order.
  v_now timestamptz := clock_timestamp();
begin
  if p_outcome is null or p_outcome not in ('FOUND', 'NONE', 'ERROR') then
    raise exception 'EMPLOYER_LOGO_OUTCOME_INVALID' using errcode = '22023';
  end if;

  if p_outcome = 'FOUND' then
    if p_logo_bytes is null or p_content_type is null then
      raise exception 'EMPLOYER_LOGO_BYTES_REQUIRED' using errcode = '22023';
    end if;
    insert into public.employer_logos as logo
      (provider, board_slug, status, content_type, logo_bytes, fetched_at, checked_at, attempted_at, miss_count)
    values
      (p_provider, p_board_slug, 'FOUND', p_content_type, p_logo_bytes,
       v_now, v_now, v_now, 0)
    on conflict (provider, board_slug) do update set
      status = 'FOUND',
      content_type = excluded.content_type,
      logo_bytes = excluded.logo_bytes,
      fetched_at = excluded.fetched_at,
      checked_at = excluded.checked_at,
      attempted_at = excluded.attempted_at,
      miss_count = 0
    returning logo.status into v_status;
  elsif p_outcome = 'NONE' then
    insert into public.employer_logos as logo
      (provider, board_slug, status, content_type, logo_bytes, fetched_at, checked_at, attempted_at, miss_count)
    values
      (p_provider, p_board_slug, 'NONE', null, null,
       v_now, v_now, v_now, 0)
    on conflict (provider, board_slug) do update set
      status = case when logo.status = 'FOUND' and logo.miss_count < 2 then 'FOUND' else 'NONE' end,
      content_type = case when logo.status = 'FOUND' and logo.miss_count < 2 then logo.content_type else null end,
      logo_bytes = case when logo.status = 'FOUND' and logo.miss_count < 2 then logo.logo_bytes else null end,
      fetched_at = case when logo.status = 'FOUND' and logo.miss_count < 2 then logo.fetched_at else v_now end,
      checked_at = v_now,
      attempted_at = v_now,
      miss_count = case when logo.status = 'FOUND' and logo.miss_count < 2 then logo.miss_count + 1 else 0 end
    returning logo.status into v_status;
  else
    update public.employer_logos as logo
    set attempted_at = v_now
    where logo.provider = p_provider and logo.board_slug = p_board_slug
    returning logo.status into v_status;
  end if;
  return v_status;
end;
$$;
revoke all on function public.record_employer_logo_check(text, text, text, text, bytea) from public, anon, authenticated, service_role;
grant execute on function public.record_employer_logo_check(text, text, text, text, bytea) to service_role;
