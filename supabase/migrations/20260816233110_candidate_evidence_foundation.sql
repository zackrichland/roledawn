-- RoleDawn / HireWire: candidate-controlled narrative evidence derived from a
-- reviewed resume. Exact application answers remain in candidate_facts; these
-- tables hold source passages and candidate-reviewed narrative evidence only.

alter table public.source_document_text_reviews
  add constraint source_document_text_reviews_evidence_context_key
  unique (workspace_id, candidate_id, document_id, document_version_id, id);

create table public.source_evidence_passages (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  text_review_id uuid not null,
  stable_key text not null check (stable_key ~ '^[0-9a-f]{64}$'),
  ordinal integer not null check (ordinal between 0 and 249),
  evidence_category text not null
    check (evidence_category in (
      'EXPERIENCE', 'PROJECT', 'ACHIEVEMENT', 'SKILL', 'EDUCATION', 'SUMMARY', 'OTHER'
    )),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset and end_offset <= 200000),
  excerpt text not null check (char_length(excerpt) between 1 and 4000),
  excerpt_sha256 text not null check (excerpt_sha256 ~ '^[0-9a-f]{64}$'),
  segmenter_release text not null check (btrim(segmenter_release) <> '' and char_length(segmenter_release) <= 120),
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id, document_id, id),
  unique (text_review_id, stable_key),
  unique (text_review_id, ordinal),
  foreign key (workspace_id, candidate_id, document_id, document_version_id, text_review_id)
    references public.source_document_text_reviews(
      workspace_id, candidate_id, document_id, document_version_id, id
    ) on delete cascade
);

create table public.candidate_evidence_items (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  text_review_id uuid not null,
  primary_source_passage_id uuid not null,
  evidence_key text not null check (evidence_key ~ '^[0-9a-f]{64}$'),
  evidence_category text not null
    check (evidence_category in (
      'EXPERIENCE', 'PROJECT', 'ACHIEVEMENT', 'SKILL', 'EDUCATION', 'SUMMARY', 'OTHER'
    )),
  review_status text not null default 'NEEDS_REVIEW'
    check (review_status in ('NEEDS_REVIEW', 'VERIFIED', 'REJECTED')),
  current_version_number bigint check (current_version_number is null or current_version_number > 0),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, candidate_id, document_id, id),
  unique (candidate_id, evidence_key),
  unique (primary_source_passage_id),
  foreign key (workspace_id, candidate_id, document_id, primary_source_passage_id)
    references public.source_evidence_passages(workspace_id, candidate_id, document_id, id)
    on delete cascade
);

create table public.candidate_evidence_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  evidence_item_id uuid not null,
  version_number bigint not null check (version_number > 0),
  claim_text text not null check (char_length(claim_text) between 1 and 4000),
  claim_sha256 text not null check (claim_sha256 ~ '^[0-9a-f]{64}$'),
  usage_policy text not null
    check (usage_policy in ('RESUME_AND_COVER_LETTER', 'COVER_LETTER_ONLY', 'DO_NOT_USE')),
  candidate_disposition text not null
    check (candidate_disposition in ('PROPOSED', 'APPROVED', 'REJECTED')),
  review_kind text not null
    check (review_kind in ('PROPOSAL', 'EXACT_PASSAGE', 'CANDIDATE_EDIT')),
  candidate_attested boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, candidate_id, document_id, id),
  unique (evidence_item_id, version_number),
  foreign key (workspace_id, candidate_id, document_id, evidence_item_id)
    references public.candidate_evidence_items(workspace_id, candidate_id, document_id, id)
    on delete cascade,
  check (
    (candidate_disposition = 'PROPOSED'
      and review_kind = 'PROPOSAL'
      and not candidate_attested
      and reviewed_at is null
      and reviewed_by is null)
    or
    (candidate_disposition = 'APPROVED'
      and review_kind in ('EXACT_PASSAGE', 'CANDIDATE_EDIT')
      and (review_kind <> 'CANDIDATE_EDIT' or candidate_attested)
      and reviewed_at is not null
      and reviewed_by is not null)
    or
    (candidate_disposition = 'REJECTED'
      and review_kind in ('EXACT_PASSAGE', 'CANDIDATE_EDIT')
      and reviewed_at is not null
      and reviewed_by is not null)
  )
);

alter table public.candidate_evidence_items
  add constraint candidate_evidence_items_current_version_fkey
  foreign key (id, current_version_number)
  references public.candidate_evidence_versions(evidence_item_id, version_number)
  deferrable initially deferred;

create table public.candidate_evidence_citations (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  document_id uuid not null,
  evidence_version_id uuid not null,
  passage_id uuid not null,
  created_at timestamptz not null default now(),
  unique (evidence_version_id, passage_id),
  foreign key (workspace_id, candidate_id, document_id, evidence_version_id)
    references public.candidate_evidence_versions(workspace_id, candidate_id, document_id, id)
    on delete cascade,
  foreign key (workspace_id, candidate_id, document_id, passage_id)
    references public.source_evidence_passages(workspace_id, candidate_id, document_id, id)
    on delete cascade
);

create index source_evidence_passages_candidate_review_idx
  on public.source_evidence_passages (candidate_id, text_review_id, ordinal);
create index source_evidence_passages_document_version_idx
  on public.source_evidence_passages (document_version_id, ordinal);
create index candidate_evidence_items_candidate_status_idx
  on public.candidate_evidence_items (candidate_id, review_status, updated_at desc, id);
create index candidate_evidence_items_review_idx
  on public.candidate_evidence_items (text_review_id, evidence_category, id);
create index candidate_evidence_versions_item_idx
  on public.candidate_evidence_versions (evidence_item_id, version_number desc);
create index candidate_evidence_versions_creator_idx
  on public.candidate_evidence_versions (created_by);
create index candidate_evidence_versions_reviewer_idx
  on public.candidate_evidence_versions (reviewed_by) where reviewed_by is not null;
create index candidate_evidence_citations_passage_idx
  on public.candidate_evidence_citations (passage_id, evidence_version_id);

create trigger source_evidence_passages_immutable
  before update or delete on public.source_evidence_passages
  for each row execute function private.reject_source_document_evidence_mutation();
create trigger candidate_evidence_versions_immutable
  before update or delete on public.candidate_evidence_versions
  for each row execute function private.reject_source_document_evidence_mutation();
create trigger candidate_evidence_citations_immutable
  before update or delete on public.candidate_evidence_citations
  for each row execute function private.reject_source_document_evidence_mutation();

alter table public.source_evidence_passages enable row level security;
alter table public.candidate_evidence_items enable row level security;
alter table public.candidate_evidence_versions enable row level security;
alter table public.candidate_evidence_citations enable row level security;

create policy source_evidence_passages_candidate_select
  on public.source_evidence_passages for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = source_evidence_passages.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
create policy candidate_evidence_items_candidate_select
  on public.candidate_evidence_items for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_evidence_items.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
create policy candidate_evidence_versions_candidate_select
  on public.candidate_evidence_versions for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_evidence_versions.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );
create policy candidate_evidence_citations_candidate_select
  on public.candidate_evidence_citations for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = candidate_evidence_citations.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

revoke all on public.source_evidence_passages, public.candidate_evidence_items,
  public.candidate_evidence_versions, public.candidate_evidence_citations
  from public, anon, authenticated;
grant select on public.source_evidence_passages, public.candidate_evidence_items,
  public.candidate_evidence_versions, public.candidate_evidence_citations
  to authenticated;
grant all on public.source_evidence_passages, public.candidate_evidence_items,
  public.candidate_evidence_versions, public.candidate_evidence_citations
  to service_role;

create or replace function public.ingest_resume_evidence_proposals(
  p_command_id uuid,
  p_text_review_id uuid,
  p_segmenter_release text,
  p_passages jsonb
)
returns table (proposal_count integer, total_count integer, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_review public.source_document_text_reviews%rowtype;
  v_document public.source_documents%rowtype;
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
  v_entry jsonb;
  v_stable_key text;
  v_category text;
  v_excerpt text;
  v_excerpt_sha text;
  v_expected_stable_key text;
  v_segmenter_release text := btrim(coalesce(p_segmenter_release, ''));
  v_ordinal integer;
  v_start integer;
  v_end integer;
  v_passage_id uuid;
  v_item_id uuid;
  v_version_id uuid;
  v_inserted integer := 0;
  v_total integer;
  v_event_id uuid := extensions.gen_random_uuid();
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_text_review_id is null
     or v_segmenter_release <> 'resume-passages/1'
     or jsonb_typeof(p_passages) <> 'array'
     or jsonb_array_length(p_passages) not between 1 and 250 then
    raise exception 'EVIDENCE_PROPOSAL_INPUT_INVALID' using errcode = '22023';
  end if;

  select review.* into strict v_review
  from public.source_document_text_reviews as review
  join public.candidates as candidate
    on candidate.workspace_id = review.workspace_id
   and candidate.id = review.candidate_id
   and candidate.auth_user_id = v_actor
   and candidate.status in ('ONBOARDING', 'ACTIVE')
  join public.workspace_memberships as membership
    on membership.workspace_id = review.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = review.workspace_id
   and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = v_actor
  where review.id = p_text_review_id;

  select document.* into strict v_document
  from public.source_documents as document
  where document.workspace_id = v_review.workspace_id
    and document.candidate_id = v_review.candidate_id
    and document.id = v_review.document_id
  for update;

  if v_document.status <> 'READY'
     or v_document.current_version_number is null
     or exists (
       select 1 from public.source_document_text_reviews as newer
       where newer.document_id = v_review.document_id
         and newer.review_version_number > v_review.review_version_number
     ) then
    raise exception 'EVIDENCE_REVIEW_STALE' using errcode = 'PT409';
  end if;

  v_request_hash := encode(extensions.digest(convert_to(
    p_text_review_id::text || E'\n' || v_segmenter_release || E'\n' || p_passages::text,
    'utf8'
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_review.candidate_id::text || ':evidence-seed:' || p_text_review_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_review.workspace_id::text || ':' || p_command_id::text, 0));

  select * into v_existing from public.command_dedup
  where workspace_id = v_review.workspace_id and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'INGEST_RESUME_EVIDENCE_PROPOSALS'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select
      coalesce((v_existing.result ->> 'proposal_count')::integer, 0),
      coalesce((v_existing.result ->> 'total_count')::integer, 0),
      true;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_passages) as passage(value)
    group by passage.value ->> 'stable_key'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_passages) as passage(value)
    group by passage.value ->> 'ordinal'
    having count(*) > 1
  ) then
    raise exception 'EVIDENCE_PROPOSAL_DUPLICATE' using errcode = '22023';
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_review.workspace_id, p_command_id, v_actor,
     'INGEST_RESUME_EVIDENCE_PROPOSALS', v_request_hash, 'STARTED');

  for v_entry in select value from jsonb_array_elements(p_passages)
  loop
    v_stable_key := lower(coalesce(v_entry ->> 'stable_key', ''));
    v_category := upper(coalesce(v_entry ->> 'category', ''));
    v_excerpt := coalesce(v_entry ->> 'excerpt', '');
    v_excerpt_sha := lower(coalesce(v_entry ->> 'excerpt_sha256', ''));
    begin
      v_ordinal := (v_entry ->> 'ordinal')::integer;
      v_start := (v_entry ->> 'start_offset')::integer;
      v_end := (v_entry ->> 'end_offset')::integer;
    exception when others then
      raise exception 'EVIDENCE_PROPOSAL_LOCATOR_INVALID' using errcode = '22023';
    end;

    if v_stable_key !~ '^[0-9a-f]{64}$'
       or v_excerpt_sha !~ '^[0-9a-f]{64}$'
       or v_category not in ('EXPERIENCE', 'PROJECT', 'ACHIEVEMENT', 'SKILL', 'EDUCATION', 'SUMMARY', 'OTHER')
       or v_ordinal not between 0 and 249
       or v_start < 0 or v_end <= v_start or v_end > 200000
       or char_length(v_excerpt) not between 1 and 4000
       or substring(v_review.reviewed_text from v_start + 1 for v_end - v_start) <> v_excerpt
       or encode(extensions.digest(convert_to(v_excerpt, 'utf8'), 'sha256'), 'hex') <> v_excerpt_sha then
      raise exception 'EVIDENCE_PROPOSAL_INVALID' using errcode = '22023';
    end if;

    v_expected_stable_key := encode(extensions.digest(convert_to(
      p_text_review_id::text || E'\n' || v_start::text || E'\n' || v_end::text || E'\n' || v_excerpt_sha,
      'utf8'
    ), 'sha256'), 'hex');
    if v_stable_key <> v_expected_stable_key then
      raise exception 'EVIDENCE_PROPOSAL_KEY_INVALID' using errcode = '22023';
    end if;

    insert into public.source_evidence_passages
      (workspace_id, candidate_id, document_id, document_version_id,
       text_review_id, stable_key, ordinal, evidence_category,
       start_offset, end_offset, excerpt, excerpt_sha256, segmenter_release)
    values
      (v_review.workspace_id, v_review.candidate_id, v_review.document_id,
       v_review.document_version_id, p_text_review_id, v_stable_key,
       v_ordinal, v_category, v_start, v_end, v_excerpt, v_excerpt_sha,
       v_segmenter_release)
    on conflict (text_review_id, stable_key) do nothing
    returning id into v_passage_id;

    if v_passage_id is null then
      select passage.id into strict v_passage_id
      from public.source_evidence_passages as passage
      where passage.text_review_id = p_text_review_id
        and passage.stable_key = v_stable_key
        and passage.ordinal = v_ordinal
        and passage.evidence_category = v_category
        and passage.start_offset = v_start
        and passage.end_offset = v_end
        and passage.excerpt_sha256 = v_excerpt_sha;
    end if;

    v_item_id := null;
    insert into public.candidate_evidence_items
      (workspace_id, candidate_id, document_id, text_review_id,
       primary_source_passage_id, evidence_key, evidence_category,
       review_status, current_version_number, aggregate_version)
    values
      (v_review.workspace_id, v_review.candidate_id, v_review.document_id,
       p_text_review_id, v_passage_id, v_stable_key, v_category,
       'NEEDS_REVIEW', null, 1)
    on conflict (primary_source_passage_id) do nothing
    returning id into v_item_id;

    if v_item_id is not null then
      v_version_id := extensions.gen_random_uuid();
      insert into public.candidate_evidence_versions
        (id, workspace_id, candidate_id, document_id, evidence_item_id,
         version_number, claim_text, claim_sha256, usage_policy,
         candidate_disposition, review_kind, candidate_attested,
         reviewed_at, reviewed_by, created_by)
      values
        (v_version_id, v_review.workspace_id, v_review.candidate_id,
         v_review.document_id, v_item_id, 1, v_excerpt, v_excerpt_sha,
         'RESUME_AND_COVER_LETTER', 'PROPOSED', 'PROPOSAL', false,
         null, null, v_actor);

      insert into public.candidate_evidence_citations
        (workspace_id, candidate_id, document_id, evidence_version_id, passage_id)
      values
        (v_review.workspace_id, v_review.candidate_id, v_review.document_id,
         v_version_id, v_passage_id);

      update public.candidate_evidence_items as item
      set current_version_number = 1
      where item.id = v_item_id;
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  select count(*)::integer into v_total
  from public.candidate_evidence_items as item
  where item.workspace_id = v_review.workspace_id
    and item.candidate_id = v_review.candidate_id
    and item.text_review_id = p_text_review_id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_review.workspace_id, 'CANDIDATE_EVIDENCE_BATCH',
     p_command_id, 1, 'candidate_evidence.proposals_ready',
     jsonb_build_object('text_review_id', p_text_review_id,
       'proposal_count', v_inserted, 'total_count', v_total,
       'segmenter_release', v_segmenter_release),
     'CANDIDATE', v_actor, p_command_id);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_EVIDENCE_BATCH', aggregate_id = p_command_id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('proposal_count', v_inserted, 'total_count', v_total),
      completed_at = statement_timestamp()
  where workspace_id = v_review.workspace_id and command_id = p_command_id;

  return query select v_inserted, v_total, false;
end;
$$;

create or replace function public.review_candidate_evidence_item(
  p_command_id uuid,
  p_evidence_item_id uuid,
  p_expected_aggregate_version bigint,
  p_disposition text,
  p_claim_text text,
  p_usage_policy text,
  p_candidate_attested boolean default false
)
returns table (
  evidence_item_id uuid,
  evidence_version_id uuid,
  evidence_version_number bigint,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.candidate_evidence_items%rowtype;
  v_passage public.source_evidence_passages%rowtype;
  v_claim text := btrim(coalesce(p_claim_text, ''));
  v_disposition text := upper(btrim(coalesce(p_disposition, '')));
  v_usage text := upper(btrim(coalesce(p_usage_policy, '')));
  v_review_kind text;
  v_claim_sha text;
  v_version_number bigint;
  v_aggregate_version bigint;
  v_version_id uuid := extensions.gen_random_uuid();
  v_event_id uuid := extensions.gen_random_uuid();
  v_request_hash text;
  v_existing public.command_dedup%rowtype;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_evidence_item_id is null
     or p_expected_aggregate_version is null or p_expected_aggregate_version < 1
     or v_disposition not in ('APPROVED', 'REJECTED')
     or v_usage not in ('RESUME_AND_COVER_LETTER', 'COVER_LETTER_ONLY', 'DO_NOT_USE')
     or char_length(v_claim) not between 1 and 4000 then
    raise exception 'EVIDENCE_REVIEW_INPUT_INVALID' using errcode = '22023';
  end if;
  if v_disposition = 'REJECTED' and v_usage <> 'DO_NOT_USE' then
    raise exception 'REJECTED_EVIDENCE_MUST_NOT_BE_USED' using errcode = '22023';
  end if;

  select item.* into strict v_item
  from public.candidate_evidence_items as item
  join public.candidates as candidate
    on candidate.workspace_id = item.workspace_id
   and candidate.id = item.candidate_id
   and candidate.auth_user_id = v_actor
   and candidate.status in ('ONBOARDING', 'ACTIVE')
  join public.workspace_memberships as membership
    on membership.workspace_id = item.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = item.workspace_id
   and workspace.kind = 'PERSONAL'
   and workspace.status = 'ACTIVE'
   and workspace.personal_owner_auth_user_id = v_actor
  where item.id = p_evidence_item_id
  for update;

  v_request_hash := encode(extensions.digest(convert_to(
    p_evidence_item_id::text || E'\n' || p_expected_aggregate_version::text || E'\n' ||
    v_disposition || E'\n' || v_claim || E'\n' || v_usage || E'\n' ||
    coalesce(p_candidate_attested, false)::text,
    'utf8'
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_item.workspace_id::text || ':' || p_command_id::text, 0));
  select * into v_existing from public.command_dedup
  where workspace_id = v_item.workspace_id and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'REVIEW_CANDIDATE_EVIDENCE_ITEM'
       or v_existing.request_hash <> v_request_hash then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select
      (v_existing.result ->> 'evidence_item_id')::uuid,
      (v_existing.result ->> 'evidence_version_id')::uuid,
      (v_existing.result ->> 'evidence_version_number')::bigint,
      (v_existing.result ->> 'aggregate_version')::bigint,
      true;
    return;
  end if;

  select passage.* into strict v_passage
  from public.source_evidence_passages as passage
  join public.source_documents as document
    on document.workspace_id = passage.workspace_id
   and document.candidate_id = passage.candidate_id
   and document.id = passage.document_id
   and document.status = 'READY'
  where passage.id = v_item.primary_source_passage_id
    and not exists (
      select 1 from public.source_document_text_reviews as newer
      where newer.document_id = passage.document_id
        and newer.review_version_number > (
          select current_review.review_version_number
          from public.source_document_text_reviews as current_review
          where current_review.id = passage.text_review_id
        )
    );

  if v_item.aggregate_version <> p_expected_aggregate_version then
    raise exception 'CANDIDATE_EVIDENCE_VERSION_MISMATCH' using errcode = 'PT409';
  end if;

  v_review_kind := case when v_claim = v_passage.excerpt
    then 'EXACT_PASSAGE' else 'CANDIDATE_EDIT' end;
  if v_review_kind = 'CANDIDATE_EDIT' and not coalesce(p_candidate_attested, false) then
    raise exception 'CANDIDATE_EVIDENCE_ATTESTATION_REQUIRED' using errcode = '22023';
  end if;
  v_claim_sha := encode(extensions.digest(convert_to(v_claim, 'utf8'), 'sha256'), 'hex');

  v_version_number := coalesce(v_item.current_version_number, 0) + 1;
  v_aggregate_version := v_item.aggregate_version + 1;
  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values
    (v_item.workspace_id, p_command_id, v_actor,
     'REVIEW_CANDIDATE_EVIDENCE_ITEM', v_request_hash, 'STARTED');

  insert into public.candidate_evidence_versions
    (id, workspace_id, candidate_id, document_id, evidence_item_id,
     version_number, claim_text, claim_sha256, usage_policy,
     candidate_disposition, review_kind, candidate_attested,
     reviewed_at, reviewed_by, created_by)
  values
    (v_version_id, v_item.workspace_id, v_item.candidate_id, v_item.document_id,
     v_item.id, v_version_number, v_claim, v_claim_sha, v_usage,
     v_disposition, v_review_kind,
     v_review_kind = 'CANDIDATE_EDIT' and coalesce(p_candidate_attested, false),
     statement_timestamp(), v_actor, v_actor);

  insert into public.candidate_evidence_citations
    (workspace_id, candidate_id, document_id, evidence_version_id, passage_id)
  values
    (v_item.workspace_id, v_item.candidate_id, v_item.document_id,
     v_version_id, v_passage.id);

  update public.candidate_evidence_items as item
  set review_status = case when v_disposition = 'APPROVED' then 'VERIFIED' else 'REJECTED' end,
      current_version_number = v_version_number,
      aggregate_version = v_aggregate_version,
      updated_at = statement_timestamp()
  where item.id = v_item.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values
    (v_event_id, v_item.workspace_id, 'CANDIDATE_EVIDENCE', v_item.id,
     v_aggregate_version,
     case when v_disposition = 'APPROVED'
       then 'candidate_evidence.verified' else 'candidate_evidence.rejected' end,
     jsonb_build_object('evidence_version_id', v_version_id,
       'evidence_version_number', v_version_number,
       'usage_policy', v_usage, 'review_kind', v_review_kind,
       'candidate_attested', v_review_kind = 'CANDIDATE_EDIT'),
     'CANDIDATE', v_actor, p_command_id);

  update public.command_dedup
  set aggregate_type = 'CANDIDATE_EVIDENCE', aggregate_id = v_item.id,
      status = 'COMMITTED', result_event_id = v_event_id,
      result = jsonb_build_object('evidence_item_id', v_item.id,
        'evidence_version_id', v_version_id,
        'evidence_version_number', v_version_number,
        'aggregate_version', v_aggregate_version),
      completed_at = statement_timestamp()
  where workspace_id = v_item.workspace_id and command_id = p_command_id;

  return query select v_item.id, v_version_id, v_version_number,
    v_aggregate_version, false;
end;
$$;

revoke all on function public.ingest_resume_evidence_proposals(uuid, uuid, text, jsonb)
  from public, anon;
grant execute on function public.ingest_resume_evidence_proposals(uuid, uuid, text, jsonb)
  to authenticated, service_role;
revoke all on function public.review_candidate_evidence_item(uuid, uuid, bigint, text, text, text, boolean)
  from public, anon;
grant execute on function public.review_candidate_evidence_item(uuid, uuid, bigint, text, text, text, boolean)
  to authenticated, service_role;

comment on table public.source_evidence_passages is
  'Immutable exact passages from one candidate-reviewed resume text version.';
comment on table public.candidate_evidence_items is
  'Candidate-owned narrative evidence aggregates. Exact legal/contact/eligibility answers remain separate.';
comment on function public.ingest_resume_evidence_proposals(uuid, uuid, text, jsonb) is
  'Validates deterministic passage locators against the latest reviewed resume text and creates source-cited proposals.';
comment on function public.review_candidate_evidence_item(uuid, uuid, bigint, text, text, text, boolean) is
  'Appends an immutable candidate review decision; edited claims require candidate attestation.';
