-- Allow the versioned segmenter that reconstructs wrapped PDF bullets and
-- excludes pre-section identity/contact text from narrative evidence.
-- The function body remains fail-closed for every other release.
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
     or v_segmenter_release not in ('resume-passages/1', 'resume-passages/2')
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
