-- RoleDawn / HireWire: private, versioned resume intake and review.
--
-- Design invariants:
--   * One logical RESUME document per candidate; replacements append versions.
--   * Original bytes remain in the private career-vault Storage bucket.
--   * An authenticated upload is limited to one exact reserved, non-upsert path.
--   * Immutable source_document_versions are inserted only after upload finalize.
--   * Extracted/reviewed text is versioned source evidence, not a candidate fact.
--   * A replacement is promoted only after extraction succeeds, so a bad upload
--     never displaces the last reviewed resume.
--   * This repository has no malware scanner. Uploads remain NOT_SCANNED.

alter table public.source_document_versions
  drop constraint source_document_versions_scan_status_check;

alter table public.source_document_versions
  add constraint source_document_versions_scan_status_check
  check (scan_status in ('NOT_SCANNED', 'PENDING', 'CLEAN', 'REJECTED'));

alter table public.source_document_versions
  add constraint source_document_versions_document_identity_key
  unique (workspace_id, candidate_id, document_id, id);

create unique index source_documents_one_active_resume_per_candidate_idx
  on public.source_documents (workspace_id, candidate_id)
  where document_kind = 'RESUME' and status <> 'DELETION_PENDING';

create table public.source_document_upload_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  version_number bigint not null check (version_number > 0),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 180),
  storage_bucket text not null default 'career-vault'
    check (storage_bucket = 'career-vault'),
  storage_object_path text not null check (btrim(storage_object_path) <> ''),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  expected_byte_size bigint not null
    check (expected_byte_size between 1 and 10485760),
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'FINALIZED', 'CANCELLED', 'EXPIRED')),
  reserved_by uuid not null references auth.users(id) on delete restrict,
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  cancelled_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  unique (document_version_id),
  unique (document_id, version_number),
  unique (storage_bucket, storage_object_path),
  foreign key (workspace_id, candidate_id, document_id)
    references public.source_documents(workspace_id, candidate_id, id)
    on delete cascade,
  check (expires_at > reserved_at),
  check (
    (status = 'RESERVED' and finalized_at is null and cancelled_at is null)
    or (status = 'FINALIZED' and finalized_at is not null and cancelled_at is null)
    or (
      status in ('CANCELLED', 'EXPIRED')
      and finalized_at is null
      and cancelled_at is not null
    )
  )
);

create table public.source_document_extractions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  attempt_number bigint not null check (attempt_number > 0),
  status text not null check (status in ('SUCCEEDED', 'FAILED')),
  extractor_kind text not null check (extractor_kind in (
    'LOCAL_DETERMINISTIC',
    'MANAGED_DOCUMENT_AI',
    'OCR_FALLBACK'
  )),
  extractor_release text not null
    check (char_length(btrim(extractor_release)) between 1 and 120),
  output_schema_version text not null
    check (char_length(btrim(output_schema_version)) between 1 and 80),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  extracted_text text,
  text_sha256 text check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count is null or page_count between 1 and 1000),
  language_code text
    check (language_code is null or language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  failure_code text
    check (failure_code is null or char_length(btrim(failure_code)) between 1 and 120),
  resulting_document_status text not null
    check (resulting_document_status in ('PARSING', 'NEEDS_REVIEW', 'READY', 'REJECTED')),
  document_aggregate_version bigint not null check (document_aggregate_version > 0),
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  unique (workspace_id, candidate_id, id, document_id, document_version_id),
  unique (document_version_id, attempt_number),
  foreign key (workspace_id, candidate_id, document_id)
    references public.source_documents(workspace_id, candidate_id, id)
    on delete cascade,
  foreign key (workspace_id, candidate_id, document_id, document_version_id)
    references public.source_document_versions(
      workspace_id, candidate_id, document_id, id
    ) on delete cascade,
  check (completed_at >= started_at),
  check (
    (
      status = 'SUCCEEDED'
      and extracted_text is not null
      and char_length(extracted_text) between 1 and 200000
      and text_sha256 is not null
      and failure_code is null
    )
    or (
      status = 'FAILED'
      and extracted_text is null
      and text_sha256 is null
      and failure_code is not null
    )
  )
);

create table public.source_document_text_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  extraction_id uuid not null,
  review_version_number bigint not null check (review_version_number > 0),
  document_aggregate_version bigint not null check (document_aggregate_version > 0),
  reviewed_text text not null check (char_length(reviewed_text) between 1 and 200000),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, candidate_id, id),
  unique (document_id, review_version_number),
  foreign key (workspace_id, candidate_id, document_id)
    references public.source_documents(workspace_id, candidate_id, id)
    on delete cascade,
  foreign key (workspace_id, candidate_id, document_id, document_version_id)
    references public.source_document_versions(
      workspace_id, candidate_id, document_id, id
    ) on delete cascade,
  foreign key (
    workspace_id, candidate_id, extraction_id, document_id, document_version_id
  ) references public.source_document_extractions(
    workspace_id, candidate_id, id, document_id, document_version_id
  ) on delete cascade
);

create index source_document_upload_reservations_active_path_idx
  on public.source_document_upload_reservations (storage_bucket, storage_object_path)
  where status = 'RESERVED';
create index source_document_upload_reservations_document_status_idx
  on public.source_document_upload_reservations
  (document_id, status, version_number desc);
create index source_document_upload_reservations_actor_idx
  on public.source_document_upload_reservations (reserved_by);
create index source_document_extractions_document_time_idx
  on public.source_document_extractions (document_id, completed_at desc, id);
create index source_document_extractions_version_status_idx
  on public.source_document_extractions
  (document_version_id, status, completed_at desc, id);
create index source_document_extractions_workspace_candidate_document_fk_idx
  on public.source_document_extractions (workspace_id, candidate_id, document_id);
create index source_document_extractions_workspace_candidate_version_fk_idx
  on public.source_document_extractions
  (workspace_id, candidate_id, document_id, document_version_id);
create index source_document_text_reviews_document_version_idx
  on public.source_document_text_reviews
  (document_id, review_version_number desc, id);
create index source_document_text_reviews_extraction_idx
  on public.source_document_text_reviews (extraction_id);
create index source_document_text_reviews_creator_idx
  on public.source_document_text_reviews (created_by);
create index source_document_text_reviews_workspace_candidate_version_fk_idx
  on public.source_document_text_reviews
  (workspace_id, candidate_id, document_id, document_version_id);
create index source_document_text_reviews_workspace_candidate_extraction_fk_idx
  on public.source_document_text_reviews
  (workspace_id, candidate_id, extraction_id, document_id, document_version_id);

-- Direct mutation remains forbidden. The service deletion function sets one
-- transaction-local document id after Storage API removal. A deeper service
-- cascade remains available for whole-workspace deletion.
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
       or (
         current_setting('roledawn.source_document_purge_id', true) is null
         and pg_trigger_depth() > 2
       )
     ) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create or replace function public.request_source_document_deletion(
  p_command_id uuid,
  p_document_id uuid,
  p_expected_aggregate_version bigint
)
returns table (
  document_id uuid,
  document_status text,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.source_documents%rowtype;
  v_new_aggregate bigint;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_document_id is null
     or p_expected_aggregate_version <= 0 then
    raise exception 'DOCUMENT_DELETION_INPUT_INVALID' using errcode = '22023';
  end if;

  select document.* into strict v_document
  from public.source_documents as document
  join public.candidates as candidate
    on candidate.workspace_id = document.workspace_id
   and candidate.id = document.candidate_id
   and candidate.auth_user_id = v_actor
   and candidate.status in ('ONBOARDING', 'ACTIVE')
  join public.workspace_memberships as membership
    on membership.workspace_id = document.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  where document.id = p_document_id
  for update of document;

  v_request_hash := encode(extensions.digest(
    convert_to(
      p_document_id::text || E'\n' || p_expected_aggregate_version::text,
      'utf8'
    ),
    'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(v_document.workspace_id::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_document.workspace_id and command_id = p_command_id;

  if found then
    if v_existing.command_type <> 'REQUEST_SOURCE_DOCUMENT_DELETION'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query
    select p_document_id, 'DELETION_PENDING'::text,
      (v_existing.result ->> 'aggregate_version')::bigint, true;
    return;
  end if;

  if v_document.aggregate_version <> p_expected_aggregate_version then
    raise exception 'SOURCE_DOCUMENT_VERSION_MISMATCH' using errcode = '40001';
  end if;
  if v_document.status = 'DELETION_PENDING' then
    raise exception 'DOCUMENT_ALREADY_DELETION_PENDING' using errcode = '55000';
  end if;

  v_new_aggregate := v_document.aggregate_version + 1;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_document.workspace_id, p_command_id, v_actor,
     'REQUEST_SOURCE_DOCUMENT_DELETION', v_request_hash, 'STARTED');

  update public.source_documents as document
  set status = 'DELETION_PENDING', aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where document.workspace_id = v_document.workspace_id
    and document.id = v_document.id;

  update public.command_dedup
  set aggregate_type = 'SOURCE_DOCUMENT', aggregate_id = v_document.id,
      status = 'COMMITTED',
      result = jsonb_build_object(
        'document_id', v_document.id,
        'document_status', 'DELETION_PENDING',
        'aggregate_version', v_new_aggregate
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_document.workspace_id and command_id = p_command_id;

  return query
  select v_document.id, 'DELETION_PENDING'::text, v_new_aggregate, false;
end;
$$;

create or replace function public.cancel_resume_upload_reservation(
  p_document_version_id uuid
)
returns table (
  document_id uuid,
  document_version_id uuid,
  storage_bucket text,
  storage_object_path text,
  cancelled boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reservation public.source_document_upload_reservations%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select reservation.* into strict v_reservation
  from public.source_document_upload_reservations as reservation
  where reservation.document_version_id = p_document_version_id
  for update;

  if v_reservation.status = 'FINALIZED' then
    raise exception 'FINALIZED_RESERVATION_CANNOT_BE_CANCELLED' using errcode = '55000';
  end if;

  if v_reservation.status = 'RESERVED' then
    update public.source_document_upload_reservations as reservation
    set status = case
          when reservation.expires_at <= statement_timestamp() then 'EXPIRED'
          else 'CANCELLED'
        end,
        cancelled_at = statement_timestamp()
    where reservation.id = v_reservation.id;
  end if;

  -- The caller removes any uploaded object through the Storage API before this
  -- function. An empty first-upload shell is safe to remove.
  if not exists (
    select 1 from public.source_document_versions as version
    where version.document_id = v_reservation.document_id
  ) and not exists (
    select 1 from storage.objects as storage_object
    where storage_object.bucket_id = v_reservation.storage_bucket
      and storage_object.name = v_reservation.storage_object_path
  ) then
    delete from public.source_documents as document
    where document.id = v_reservation.document_id
      and document.current_version_number is null;
  end if;

  return query
  select v_reservation.document_id, v_reservation.document_version_id,
    v_reservation.storage_bucket, v_reservation.storage_object_path, true;
end;
$$;

create or replace function public.list_expired_resume_upload_reservations(
  p_limit integer default 100
)
returns table (
  document_version_id uuid,
  storage_bucket text,
  storage_object_path text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    raise exception 'RESERVATION_CLEANUP_LIMIT_INVALID' using errcode = '22023';
  end if;

  return query
  select reservation.document_version_id, reservation.storage_bucket,
    reservation.storage_object_path
  from public.source_document_upload_reservations as reservation
  where reservation.status = 'RESERVED'
    and reservation.expires_at <= statement_timestamp()
  order by reservation.expires_at, reservation.id
  limit p_limit;
end;
$$;

create or replace function public.complete_source_document_deletion(
  p_document_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document public.source_documents%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select document.* into strict v_document
  from public.source_documents as document
  where document.id = p_document_id
  for update;

  if v_document.status <> 'DELETION_PENDING' then
    raise exception 'DOCUMENT_NOT_DELETION_PENDING' using errcode = '55000';
  end if;

  if exists (
    select 1
    from storage.objects as storage_object
    where storage_object.bucket_id = 'career-vault'
      and (
        exists (
          select 1
          from public.source_document_versions as version
          where version.document_id = v_document.id
            and version.storage_bucket = storage_object.bucket_id
            and version.storage_object_path = storage_object.name
        )
        or exists (
          select 1
          from public.source_document_upload_reservations as reservation
          where reservation.document_id = v_document.id
            and reservation.storage_bucket = storage_object.bucket_id
            and reservation.storage_object_path = storage_object.name
        )
      )
  ) then
    raise exception 'SOURCE_DOCUMENT_STORAGE_OBJECTS_REMAIN' using errcode = '55000';
  end if;

  perform set_config(
    'roledawn.source_document_purge_id', v_document.id::text, true
  );

  delete from public.source_documents as document
  where document.workspace_id = v_document.workspace_id
    and document.id = v_document.id;

  perform set_config('roledawn.source_document_purge_id', '', true);
  return true;
end;
$$;

create or replace function public.record_resume_extraction(
  p_document_version_id uuid,
  p_attempt_number bigint,
  p_status text,
  p_extractor_kind text,
  p_extractor_release text,
  p_output_schema_version text,
  p_source_sha256 text,
  p_extracted_text text,
  p_text_sha256 text,
  p_page_count integer,
  p_language_code text,
  p_warnings jsonb,
  p_failure_code text,
  p_started_at timestamptz
)
returns table (
  document_id uuid,
  document_version_id uuid,
  extraction_id uuid,
  document_status text,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version public.source_document_versions%rowtype;
  v_reservation public.source_document_upload_reservations%rowtype;
  v_document public.source_documents%rowtype;
  v_existing public.source_document_extractions%rowtype;
  v_extraction uuid := extensions.gen_random_uuid();
  v_completed timestamptz := statement_timestamp();
  v_result_status text;
  v_result_aggregate bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_document_version_id is null or p_attempt_number <= 0
     or p_status not in ('SUCCEEDED', 'FAILED')
     or p_extractor_kind not in (
       'LOCAL_DETERMINISTIC', 'MANAGED_DOCUMENT_AI', 'OCR_FALLBACK'
     )
     or char_length(btrim(coalesce(p_extractor_release, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_output_schema_version, ''))) not between 1 and 80
     or p_source_sha256 !~ '^[0-9a-f]{64}$'
     or p_started_at is null or p_started_at > v_completed
     or jsonb_typeof(coalesce(p_warnings, '[]'::jsonb)) <> 'array'
     or (
       p_status = 'SUCCEEDED'
       and (
         char_length(coalesce(p_extracted_text, '')) not between 1 and 200000
         or p_text_sha256 !~ '^[0-9a-f]{64}$'
         or encode(extensions.digest(convert_to(p_extracted_text, 'utf8'), 'sha256'), 'hex')
              <> p_text_sha256
         or p_failure_code is not null
       )
     )
     or (
       p_status = 'FAILED'
       and (
         p_extracted_text is not null
         or p_text_sha256 is not null
         or char_length(btrim(coalesce(p_failure_code, ''))) not between 1 and 120
       )
     ) then
    raise exception 'RESUME_EXTRACTION_INPUT_INVALID' using errcode = '22023';
  end if;

  select version.* into strict v_version
  from public.source_document_versions as version
  where version.id = p_document_version_id;

  select reservation.* into strict v_reservation
  from public.source_document_upload_reservations as reservation
  where reservation.document_version_id = p_document_version_id
    and reservation.status = 'FINALIZED';

  select document.* into strict v_document
  from public.source_documents as document
  where document.workspace_id = v_version.workspace_id
    and document.candidate_id = v_version.candidate_id
    and document.id = v_version.document_id
  for update;

  if v_document.status = 'DELETION_PENDING'
     or v_version.sha256 <> p_source_sha256 then
    raise exception 'RESUME_SOURCE_NOT_EXTRACTABLE' using errcode = '55000';
  end if;

  select extraction.* into v_existing
  from public.source_document_extractions as extraction
  where extraction.document_version_id = p_document_version_id
    and extraction.attempt_number = p_attempt_number;

  if found then
    if v_existing.status <> p_status
       or v_existing.extractor_kind <> p_extractor_kind
       or v_existing.extractor_release <> btrim(p_extractor_release)
       or v_existing.output_schema_version <> btrim(p_output_schema_version)
       or v_existing.source_sha256 <> p_source_sha256
       or v_existing.text_sha256 is distinct from p_text_sha256
       or v_existing.failure_code is distinct from p_failure_code then
      raise exception 'EXTRACTION_ATTEMPT_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    return query
    select v_document.id, p_document_version_id, v_existing.id,
      v_existing.resulting_document_status,
      v_existing.document_aggregate_version, true;
    return;
  end if;

  if exists (
    select 1
    from public.source_document_extractions as extraction
    where extraction.document_version_id = p_document_version_id
      and extraction.status = 'SUCCEEDED'
  ) then
    raise exception 'RESUME_VERSION_ALREADY_EXTRACTED' using errcode = '55000';
  end if;

  if p_status = 'SUCCEEDED'
     and (
       v_document.current_version_number is null
       or v_version.version_number > v_document.current_version_number
     ) then
    v_result_status := 'NEEDS_REVIEW';
    v_result_aggregate := v_document.aggregate_version + 1;
    update public.source_documents as document
    set display_name = v_reservation.display_name,
        current_version_number = v_version.version_number,
        status = 'NEEDS_REVIEW',
        aggregate_version = v_result_aggregate,
        updated_at = v_completed
    where document.workspace_id = v_document.workspace_id
      and document.id = v_document.id;
  elsif p_status = 'SUCCEEDED' then
    -- A newer version already won the promotion race. Retain this immutable
    -- successful result for provenance, but never move the current pointer
    -- backwards when extraction callbacks arrive out of order.
    v_result_status := v_document.status;
    v_result_aggregate := v_document.aggregate_version;
  elsif v_document.current_version_number is null then
    v_result_status := 'REJECTED';
    v_result_aggregate := v_document.aggregate_version + 1;
    update public.source_documents as document
    set status = 'REJECTED',
        aggregate_version = v_result_aggregate,
        updated_at = v_completed
    where document.workspace_id = v_document.workspace_id
      and document.id = v_document.id;
  else
    v_result_status := v_document.status;
    v_result_aggregate := v_document.aggregate_version;
  end if;

  insert into public.source_document_extractions
    (id, workspace_id, candidate_id, document_id, document_version_id,
     attempt_number, status, extractor_kind, extractor_release,
     output_schema_version, source_sha256, extracted_text, text_sha256,
     page_count, language_code, warnings, failure_code,
     resulting_document_status, document_aggregate_version,
     started_at, completed_at)
  values
    (v_extraction, v_version.workspace_id, v_version.candidate_id,
     v_version.document_id, v_version.id, p_attempt_number, p_status,
     p_extractor_kind, btrim(p_extractor_release),
     btrim(p_output_schema_version), p_source_sha256, p_extracted_text,
     p_text_sha256, p_page_count, p_language_code,
     coalesce(p_warnings, '[]'::jsonb), p_failure_code,
     v_result_status, v_result_aggregate, p_started_at, v_completed);

  return query
  select v_document.id, p_document_version_id, v_extraction,
    v_result_status, v_result_aggregate, false;
end;
$$;

create or replace function public.review_resume_text(
  p_command_id uuid,
  p_document_id uuid,
  p_extraction_id uuid,
  p_expected_aggregate_version bigint,
  p_reviewed_text text,
  p_text_sha256 text
)
returns table (
  document_id uuid,
  document_version_id uuid,
  extraction_id uuid,
  review_id uuid,
  review_version_number bigint,
  document_status text,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_document public.source_documents%rowtype;
  v_extraction public.source_document_extractions%rowtype;
  v_review uuid := extensions.gen_random_uuid();
  v_review_version bigint;
  v_new_aggregate bigint;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_document_id is null or p_extraction_id is null
     or p_expected_aggregate_version <= 0
     or char_length(coalesce(p_reviewed_text, '')) not between 1 and 200000
     or p_text_sha256 !~ '^[0-9a-f]{64}$'
     or encode(extensions.digest(convert_to(p_reviewed_text, 'utf8'), 'sha256'), 'hex')
          <> p_text_sha256 then
    raise exception 'RESUME_REVIEW_INPUT_INVALID' using errcode = '22023';
  end if;

  select document.* into strict v_document
  from public.source_documents as document
  join public.candidates as candidate
    on candidate.workspace_id = document.workspace_id
   and candidate.id = document.candidate_id
   and candidate.auth_user_id = v_actor
   and candidate.status in ('ONBOARDING', 'ACTIVE')
  join public.workspace_memberships as membership
    on membership.workspace_id = document.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  where document.id = p_document_id
    and document.document_kind = 'RESUME'
  for update of document;

  v_request_hash := encode(extensions.digest(
    convert_to(
      p_document_id::text || E'\n' || p_extraction_id::text || E'\n' ||
      p_expected_aggregate_version::text || E'\n' || p_text_sha256,
      'utf8'
    ),
    'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(v_document.workspace_id::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_document.workspace_id and command_id = p_command_id;

  if found then
    if v_existing.command_type <> 'REVIEW_RESUME_TEXT'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED'
       or v_existing.result ->> 'review_id' is null then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query
    select review.document_id, review.document_version_id,
      review.extraction_id, review.id, review.review_version_number,
      'READY'::text, review.document_aggregate_version, true
    from public.source_document_text_reviews as review
    where review.workspace_id = v_document.workspace_id
      and review.id = (v_existing.result ->> 'review_id')::uuid;
    return;
  end if;

  if v_document.aggregate_version <> p_expected_aggregate_version then
    raise exception 'SOURCE_DOCUMENT_VERSION_MISMATCH' using errcode = '40001';
  end if;
  if v_document.status not in ('NEEDS_REVIEW', 'READY')
     or v_document.current_version_number is null then
    raise exception 'RESUME_DOCUMENT_NOT_REVIEWABLE' using errcode = '55000';
  end if;

  select extraction.* into strict v_extraction
  from public.source_document_extractions as extraction
  join public.source_document_versions as version
    on version.workspace_id = extraction.workspace_id
   and version.candidate_id = extraction.candidate_id
   and version.document_id = extraction.document_id
   and version.id = extraction.document_version_id
  where extraction.workspace_id = v_document.workspace_id
    and extraction.candidate_id = v_document.candidate_id
    and extraction.document_id = v_document.id
    and extraction.id = p_extraction_id
    and extraction.status = 'SUCCEEDED'
    and version.version_number = v_document.current_version_number;

  select coalesce(max(review.review_version_number), 0) + 1
    into v_review_version
  from public.source_document_text_reviews as review
  where review.document_id = v_document.id;

  v_new_aggregate := v_document.aggregate_version + 1;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_document.workspace_id, p_command_id, v_actor,
     'REVIEW_RESUME_TEXT', v_request_hash, 'STARTED');

  insert into public.source_document_text_reviews
    (id, workspace_id, candidate_id, document_id, document_version_id,
     extraction_id, review_version_number, document_aggregate_version,
     reviewed_text, text_sha256, created_by)
  values
    (v_review, v_document.workspace_id, v_document.candidate_id,
     v_document.id, v_extraction.document_version_id, v_extraction.id,
     v_review_version, v_new_aggregate, p_reviewed_text, p_text_sha256,
     v_actor);

  update public.source_documents as document
  set status = 'READY', aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where document.workspace_id = v_document.workspace_id
    and document.id = v_document.id;

  update public.command_dedup
  set aggregate_type = 'SOURCE_DOCUMENT_TEXT_REVIEW', aggregate_id = v_review,
      status = 'COMMITTED',
      result = jsonb_build_object(
        'document_id', v_document.id,
        'document_version_id', v_extraction.document_version_id,
        'extraction_id', v_extraction.id,
        'review_id', v_review,
        'review_version_number', v_review_version,
        'document_status', 'READY',
        'aggregate_version', v_new_aggregate
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_document.workspace_id and command_id = p_command_id;

  return query
  select v_document.id, v_extraction.document_version_id, v_extraction.id,
    v_review, v_review_version, 'READY'::text, v_new_aggregate, false;
end;
$$;
revoke all on function private.reject_source_document_evidence_mutation()
  from public, anon, authenticated;

drop trigger source_document_versions_immutable on public.source_document_versions;
create trigger source_document_versions_immutable
  before update or delete on public.source_document_versions
  for each row execute function private.reject_source_document_evidence_mutation();
create trigger source_document_extractions_immutable
  before update or delete on public.source_document_extractions
  for each row execute function private.reject_source_document_evidence_mutation();
create trigger source_document_text_reviews_immutable
  before update or delete on public.source_document_text_reviews
  for each row execute function private.reject_source_document_evidence_mutation();

alter table public.source_document_upload_reservations enable row level security;
alter table public.source_document_extractions enable row level security;
alter table public.source_document_text_reviews enable row level security;

create policy source_document_upload_reservations_candidate_select
  on public.source_document_upload_reservations for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and reserved_by = (select auth.uid())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = source_document_upload_reservations.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create policy source_document_extractions_candidate_select
  on public.source_document_extractions for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = source_document_extractions.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create policy source_document_text_reviews_candidate_select
  on public.source_document_text_reviews for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = source_document_text_reviews.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

revoke all on public.source_document_upload_reservations,
  public.source_document_extractions,
  public.source_document_text_reviews from public, anon, authenticated;
grant select on public.source_document_upload_reservations,
  public.source_document_extractions,
  public.source_document_text_reviews to authenticated;
grant all on public.source_document_upload_reservations,
  public.source_document_extractions,
  public.source_document_text_reviews to service_role;

create or replace function public.reserve_resume_upload(
  p_command_id uuid,
  p_display_name text,
  p_mime_type text,
  p_byte_size bigint
)
returns table (
  document_id uuid,
  document_version_id uuid,
  storage_bucket text,
  storage_object_path text,
  version_number bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_candidate uuid;
  v_document public.source_documents%rowtype;
  v_document_version uuid := extensions.gen_random_uuid();
  v_reservation uuid := extensions.gen_random_uuid();
  v_version_number bigint;
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_request_hash text;
  v_path text;
  v_existing public.command_dedup%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null
     or char_length(v_display_name) not between 1 and 180
     or p_mime_type not in (
       'application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     )
     or p_byte_size not between 1 and 10485760 then
    raise exception 'RESUME_UPLOAD_INPUT_INVALID' using errcode = '22023';
  end if;

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
    and candidate.status in ('ONBOARDING', 'ACTIVE');

  v_request_hash := encode(extensions.digest(
    convert_to(
      v_display_name || E'\n' || p_mime_type || E'\n' || p_byte_size::text,
      'utf8'
    ),
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_candidate::text || ':resume', 0));
  perform pg_advisory_xact_lock(
    hashtextextended(v_workspace::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_workspace and command_id = p_command_id;

  if found then
    if v_existing.command_type <> 'RESERVE_RESUME_UPLOAD'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED'
       or v_existing.result ->> 'reservation_id' is null then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query
    select reservation.document_id, reservation.document_version_id,
      reservation.storage_bucket, reservation.storage_object_path,
      reservation.version_number, true
    from public.source_document_upload_reservations as reservation
    where reservation.workspace_id = v_workspace
      and reservation.id = (v_existing.result ->> 'reservation_id')::uuid;
    return;
  end if;

  select document.* into v_document
  from public.source_documents as document
  where document.workspace_id = v_workspace
    and document.candidate_id = v_candidate
    and document.document_kind = 'RESUME'
    and document.status <> 'DELETION_PENDING'
  for update;

  if not found then
    insert into public.source_documents
      (workspace_id, candidate_id, document_kind, display_name, status,
       current_version_number)
    values
      (v_workspace, v_candidate, 'RESUME', v_display_name, 'UPLOADING', null)
    returning * into v_document;
  end if;

  update public.source_document_upload_reservations as reservation
  set status = 'EXPIRED', cancelled_at = statement_timestamp()
  where reservation.document_id = v_document.id
    and reservation.status = 'RESERVED'
    and reservation.expires_at <= statement_timestamp();

  if exists (
    select 1
    from public.source_document_upload_reservations as reservation
    where reservation.document_id = v_document.id
      and reservation.status = 'RESERVED'
      and reservation.expires_at > statement_timestamp()
  ) then
    raise exception 'RESUME_UPLOAD_ALREADY_RESERVED' using errcode = '55000';
  end if;

  select greatest(
    coalesce((
      select max(version.version_number)
      from public.source_document_versions as version
      where version.document_id = v_document.id
    ), 0),
    coalesce((
      select max(reservation.version_number)
      from public.source_document_upload_reservations as reservation
      where reservation.document_id = v_document.id
    ), 0)
  ) + 1 into v_version_number;

  v_path := v_workspace::text || '/' || v_candidate::text || '/resumes/' ||
    v_document.id::text || '/' || v_document_version::text ||
    case when p_mime_type = 'application/pdf' then '.pdf' else '.docx' end;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_workspace, p_command_id, v_actor,
     'RESERVE_RESUME_UPLOAD', v_request_hash, 'STARTED');

  insert into public.source_document_upload_reservations
    (id, workspace_id, candidate_id, document_id, document_version_id,
     version_number, display_name, storage_object_path, mime_type,
     expected_byte_size, reserved_by, expires_at)
  values
    (v_reservation, v_workspace, v_candidate, v_document.id,
     v_document_version, v_version_number, v_display_name, v_path,
     p_mime_type, p_byte_size, v_actor,
     statement_timestamp() + interval '1 hour');

  update public.command_dedup
  set aggregate_type = 'SOURCE_DOCUMENT', aggregate_id = v_document.id,
      status = 'COMMITTED',
      result = jsonb_build_object(
        'document_id', v_document.id,
        'document_version_id', v_document_version,
        'reservation_id', v_reservation,
        'storage_bucket', 'career-vault',
        'storage_object_path', v_path,
        'version_number', v_version_number
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_workspace and command_id = p_command_id;

  return query
  select v_document.id, v_document_version, 'career-vault'::text,
    v_path, v_version_number, false;
end;
$$;

create or replace function public.finalize_resume_upload(
  p_actor_id uuid,
  p_command_id uuid,
  p_document_version_id uuid,
  p_sha256 text,
  p_byte_size bigint
)
returns table (
  document_id uuid,
  document_version_id uuid,
  document_status text,
  scan_status text,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
  v_reservation public.source_document_upload_reservations%rowtype;
  v_document public.source_documents%rowtype;
  v_storage_size bigint;
  v_storage_mime text;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_result_status text;
begin
  if current_user <> 'service_role' or v_actor is null then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_document_version_id is null
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_byte_size not between 1 and 10485760 then
    raise exception 'RESUME_FINALIZE_INPUT_INVALID' using errcode = '22023';
  end if;

  select reservation.* into strict v_reservation
  from public.source_document_upload_reservations as reservation
  join public.candidates as candidate
    on candidate.workspace_id = reservation.workspace_id
   and candidate.id = reservation.candidate_id
   and candidate.auth_user_id = v_actor
   and candidate.status in ('ONBOARDING', 'ACTIVE')
  join public.workspace_memberships as membership
    on membership.workspace_id = reservation.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  where reservation.document_version_id = p_document_version_id
  for update of reservation;

  select document.* into strict v_document
  from public.source_documents as document
  where document.workspace_id = v_reservation.workspace_id
    and document.candidate_id = v_reservation.candidate_id
    and document.id = v_reservation.document_id
  for update;

  v_request_hash := encode(extensions.digest(
    convert_to(
      p_document_version_id::text || E'\n' || p_sha256 || E'\n' ||
      p_byte_size::text,
      'utf8'
    ),
    'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(v_reservation.workspace_id::text || ':' || p_command_id::text, 0)
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_reservation.workspace_id and command_id = p_command_id;

  if found then
    if v_existing.command_type <> 'FINALIZE_RESUME_UPLOAD'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = '40001';
    end if;
    return query
    select v_document.id, p_document_version_id,
      v_existing.result ->> 'document_status',
      v_existing.result ->> 'scan_status', true;
    return;
  end if;

  if v_reservation.status <> 'RESERVED'
     or v_reservation.expires_at <= statement_timestamp()
     or v_reservation.expected_byte_size <> p_byte_size
     or v_document.status = 'DELETION_PENDING' then
    raise exception 'RESUME_UPLOAD_NOT_FINALIZABLE' using errcode = '55000';
  end if;

  select nullif(storage_object.metadata ->> 'size', '')::bigint,
    lower(coalesce(
      storage_object.metadata ->> 'mimetype',
      storage_object.metadata ->> 'contentType'
    ))
    into v_storage_size, v_storage_mime
  from storage.objects as storage_object
  where storage_object.bucket_id = v_reservation.storage_bucket
    and storage_object.name = v_reservation.storage_object_path;

  if not found
     or v_storage_size is distinct from p_byte_size
     or v_storage_mime is distinct from lower(v_reservation.mime_type) then
    raise exception 'RESUME_STORAGE_OBJECT_MISMATCH' using errcode = '55000';
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_reservation.workspace_id, p_command_id, v_actor,
     'FINALIZE_RESUME_UPLOAD', v_request_hash, 'STARTED');

  insert into public.source_document_versions
    (id, workspace_id, candidate_id, document_id, version_number,
     storage_bucket, storage_object_path, mime_type, byte_size, sha256,
     scan_status, created_by)
  values
    (v_reservation.document_version_id, v_reservation.workspace_id,
     v_reservation.candidate_id, v_reservation.document_id,
     v_reservation.version_number, v_reservation.storage_bucket,
     v_reservation.storage_object_path, v_reservation.mime_type, p_byte_size,
     p_sha256, 'NOT_SCANNED', v_actor);

  update public.source_document_upload_reservations as reservation
  set status = 'FINALIZED', finalized_at = statement_timestamp()
  where reservation.id = v_reservation.id;

  -- First upload has no usable current version, so expose parsing. A
  -- replacement preserves the current READY/NEEDS_REVIEW document state.
  if v_document.current_version_number is null then
    v_result_status := 'PARSING';
    update public.source_documents as document
    set display_name = v_reservation.display_name,
        status = 'PARSING',
        aggregate_version = document.aggregate_version + 1,
        updated_at = statement_timestamp()
    where document.workspace_id = v_document.workspace_id
      and document.id = v_document.id;
  else
    v_result_status := v_document.status;
  end if;

  update public.command_dedup
  set aggregate_type = 'SOURCE_DOCUMENT', aggregate_id = v_document.id,
      status = 'COMMITTED',
      result = jsonb_build_object(
        'document_id', v_document.id,
        'document_version_id', p_document_version_id,
        'document_status', v_result_status,
        'scan_status', 'NOT_SCANNED'
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_reservation.workspace_id and command_id = p_command_id;

  return query
  select v_document.id, p_document_version_id, v_result_status,
    'NOT_SCANNED'::text, false;
end;
$$;

-- Bucket remains private. Candidate inserts are authorized by one live exact
-- reservation; no authenticated UPDATE or DELETE policy exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'career-vault', 'career-vault', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy career_vault_reserved_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'career-vault'
    and owner_id = (select auth.uid())::text
    and exists (
      select 1
      from public.source_document_upload_reservations as reservation
      join public.candidates as candidate
        on candidate.workspace_id = reservation.workspace_id
       and candidate.id = reservation.candidate_id
       and candidate.auth_user_id = (select auth.uid())
       and candidate.status in ('ONBOARDING', 'ACTIVE')
      join public.source_documents as document
        on document.workspace_id = reservation.workspace_id
       and document.candidate_id = reservation.candidate_id
       and document.id = reservation.document_id
       and document.status <> 'DELETION_PENDING'
      where reservation.storage_bucket = bucket_id
        and reservation.storage_object_path = name
        and reservation.reserved_by = (select auth.uid())
        and reservation.status = 'RESERVED'
        and reservation.expires_at > statement_timestamp()
    )
  );

create policy career_vault_owned_finalized_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'career-vault'
    and owner_id = (select auth.uid())::text
    and exists (
      select 1
      from public.source_document_versions as version
      join public.source_documents as document
        on document.workspace_id = version.workspace_id
       and document.candidate_id = version.candidate_id
       and document.id = version.document_id
       and document.status <> 'DELETION_PENDING'
      join public.candidates as candidate
        on candidate.workspace_id = version.workspace_id
       and candidate.id = version.candidate_id
       and candidate.auth_user_id = (select auth.uid())
       and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
      where version.storage_bucket = bucket_id
        and version.storage_object_path = name
    )
  );

revoke all on function public.reserve_resume_upload(uuid, text, text, bigint)
  from public, anon;
grant execute on function public.reserve_resume_upload(uuid, text, text, bigint)
  to authenticated;
revoke all on function public.finalize_resume_upload(uuid, uuid, uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.finalize_resume_upload(uuid, uuid, uuid, text, bigint)
  to service_role;
revoke all on function public.record_resume_extraction(
  uuid, bigint, text, text, text, text, text, text, text, integer, text,
  jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_resume_extraction(
  uuid, bigint, text, text, text, text, text, text, text, integer, text,
  jsonb, text, timestamptz
) to service_role;
revoke all on function public.review_resume_text(
  uuid, uuid, uuid, bigint, text, text
) from public, anon;
grant execute on function public.review_resume_text(
  uuid, uuid, uuid, bigint, text, text
) to authenticated;
revoke all on function public.request_source_document_deletion(
  uuid, uuid, bigint
) from public, anon;
grant execute on function public.request_source_document_deletion(
  uuid, uuid, bigint
) to authenticated;
revoke all on function public.cancel_resume_upload_reservation(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_resume_upload_reservation(uuid)
  to service_role;
revoke all on function public.list_expired_resume_upload_reservations(integer)
  from public, anon, authenticated;
grant execute on function public.list_expired_resume_upload_reservations(integer)
  to service_role;
revoke all on function public.complete_source_document_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_source_document_deletion(uuid)
  to service_role;

comment on table public.source_document_upload_reservations is
  'Short-lived exact-path authorization for a private resume upload. Finalize creates the immutable source version.';
comment on table public.source_document_extractions is
  'Immutable parser/OCR result for one exact resume version, including release and content-hash provenance.';
comment on table public.source_document_text_reviews is
  'Immutable candidate-reviewed source text. Structured candidate facts are derived separately with per-fact provenance.';
comment on function public.reserve_resume_upload(uuid, text, text, bigint) is
  'Identity-derived, replay-safe exact-path reservation for the next version of one logical resume.';
comment on function public.finalize_resume_upload(uuid, uuid, uuid, text, bigint) is
  'Service-only verification of a reserved Storage object and server-computed hash; inserts an immutable source version without claiming malware clearance.';
comment on function public.record_resume_extraction(
  uuid, bigint, text, text, text, text, text, text, text, integer, text,
  jsonb, text, timestamptz
) is
  'Service-only immutable extraction result; success promotes a replacement, failure preserves the last usable version.';
comment on function public.review_resume_text(uuid, uuid, uuid, bigint, text, text) is
  'Candidate-only optimistic review that appends immutable text and marks the current resume READY.';
comment on function public.complete_source_document_deletion(uuid) is
  'Service-only database purge after every original object was removed through the Storage API.';
