-- RoleDawn / HireWire: one replay-safe, no-submit Application Kit commit.
-- Storage objects are staged first at immutable paths. This transaction binds
-- those exact paths and hashes to the frozen inputs, completes the preparation
-- run, and publishes the drafting outbox message atomically.

alter table public.artifact_versions
  add column display_name text,
  add column variant text;

update public.artifact_versions
set display_name = case kind
      when 'RESUME' then 'Resume'
      when 'COVER_LETTER' then 'Cover Letter'
      else 'Application Artifact'
    end,
    variant = case
      when kind = 'RESUME' and mime_type = 'application/pdf' then 'RESUME_PDF'
      when kind = 'RESUME' and mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'RESUME_DOCX'
      when kind = 'COVER_LETTER' and mime_type = 'application/pdf' then 'COVER_LETTER_PDF'
      when kind = 'COVER_LETTER' and mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'COVER_LETTER_DOCX'
      else 'OTHER'
    end;

alter table public.artifact_versions
  alter column display_name set not null,
  alter column variant set not null,
  add constraint artifact_versions_display_name_check
    check (char_length(btrim(display_name)) between 1 and 255),
  add constraint artifact_versions_variant_check
    check (variant in ('RESUME_PDF', 'RESUME_DOCX', 'COVER_LETTER_PDF', 'COVER_LETTER_DOCX', 'OTHER')),
  add constraint artifact_versions_variant_contract_check
    check (
      variant = 'OTHER'
      or (variant = 'RESUME_PDF' and kind = 'RESUME' and mime_type = 'application/pdf')
      or (variant = 'RESUME_DOCX' and kind = 'RESUME' and mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      or (variant = 'COVER_LETTER_PDF' and kind = 'COVER_LETTER' and mime_type = 'application/pdf')
      or (variant = 'COVER_LETTER_DOCX' and kind = 'COVER_LETTER' and mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    );

-- Legacy revisions can contain more than one uncategorized artifact. The four
-- released candidate-facing variants are unique without forcing those older
-- OTHER rows into a lossy migration.
create unique index artifact_versions_revision_variant_key
  on public.artifact_versions (application_revision_id, variant)
  where variant <> 'OTHER';

drop policy if exists revisions_member_select on public.application_revisions;
create policy application_revisions_candidate_select
  on public.application_revisions for select to authenticated
  using (
    exists (
      select 1
      from public.applications as application
      join public.candidates as candidate
        on candidate.workspace_id = application.workspace_id
       and candidate.id = application.candidate_id
      where application.workspace_id = application_revisions.workspace_id
        and application.id = application_revisions.application_id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

drop policy if exists revision_fact_refs_member_select on public.application_revision_fact_refs;
create policy application_revision_fact_refs_candidate_select
  on public.application_revision_fact_refs for select to authenticated
  using (
    candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.workspace_id = application_revision_fact_refs.workspace_id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

drop policy if exists artifacts_member_select on public.artifact_versions;
create policy artifact_versions_candidate_select
  on public.artifact_versions for select to authenticated
  using (
    exists (
      select 1
      from public.application_revisions as revision
      join public.applications as application
        on application.workspace_id = revision.workspace_id
       and application.id = revision.application_id
      join public.candidates as candidate
        on candidate.workspace_id = application.workspace_id
       and candidate.id = application.candidate_id
      where revision.workspace_id = artifact_versions.workspace_id
        and revision.id = artifact_versions.application_revision_id
        and candidate.auth_user_id = (select auth.uid())
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

create or replace function public.commit_application_kit(
  p_outbox_id uuid,
  p_worker_id text,
  p_application_id uuid,
  p_preparation_run_id uuid,
  p_input_snapshot_id uuid,
  p_input_snapshot_hash text,
  p_research_manifest jsonb,
  p_research_hash text,
  p_researcher_release text,
  p_freshness_policy_release text,
  p_freshness_expires_at timestamptz,
  p_revision_manifest jsonb,
  p_material_diff jsonb,
  p_packet_hash text,
  p_evidence_refs jsonb,
  p_fact_version_ids uuid[],
  p_artifacts jsonb
)
returns table (
  research_bundle_id uuid,
  revision_id uuid,
  aggregate_version bigint,
  artifact_ids jsonb,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_worker_id text := btrim(coalesce(p_worker_id, ''));
  v_outbox public.outbox%rowtype;
  v_application public.applications%rowtype;
  v_run public.application_runs%rowtype;
  v_snapshot public.application_input_snapshots%rowtype;
  v_research_id uuid := extensions.gen_random_uuid();
  v_revision_id uuid := extensions.gen_random_uuid();
  v_event_id uuid := extensions.gen_random_uuid();
  v_version bigint;
  v_aggregate bigint;
  v_artifact_ids jsonb;
  v_expected_path_prefix text;
  v_evidence_count integer;
  v_fact_count integer;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if p_outbox_id is null or p_application_id is null or p_preparation_run_id is null
     or p_input_snapshot_id is null or char_length(v_worker_id) not between 1 and 120
     or p_input_snapshot_hash !~ '^[0-9a-f]{64}$'
     or p_research_hash !~ '^[0-9a-f]{64}$'
     or p_packet_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_research_manifest) <> 'object'
     or jsonb_typeof(p_revision_manifest) <> 'object'
     or jsonb_typeof(p_material_diff) <> 'object'
     or jsonb_typeof(p_evidence_refs) <> 'array'
     or jsonb_typeof(p_artifacts) <> 'array'
     or cardinality(coalesce(p_fact_version_ids, array[]::uuid[])) > 64
  then
    raise exception 'APPLICATION_KIT_INPUT_INVALID' using errcode = '22023';
  end if;

  select message.* into strict v_outbox
  from public.outbox as message
  where message.id = p_outbox_id
  for update;

  select application.* into strict v_application
  from public.applications as application
  where application.id = p_application_id
    and application.workspace_id = v_outbox.workspace_id
  for update;

  if v_application.current_revision_id is not null then
    perform revision.id
    from public.application_revisions as revision
    where revision.workspace_id = v_application.workspace_id
      and revision.application_id = v_application.id
      and revision.id = v_application.current_revision_id
      and revision.packet_hash = p_packet_hash
      and revision.validation_status = 'PASSED';
    if found and v_outbox.published_at is not null then
      return query
      select revision.research_bundle_id, revision.id, v_application.aggregate_version,
        coalesce((
          select jsonb_agg(artifact.id order by artifact.variant)
          from public.artifact_versions as artifact
          where artifact.workspace_id = v_application.workspace_id
            and artifact.application_revision_id = revision.id
        ), '[]'::jsonb), true
      from public.application_revisions as revision
      where revision.id = v_application.current_revision_id;
      return;
    end if;
    raise exception 'APPLICATION_KIT_CURRENT_REVISION_CONFLICT' using errcode = '40001';
  end if;

  if v_outbox.topic <> 'application.drafting_requested'
     or v_outbox.published_at is not null or v_outbox.dead_lettered_at is not null
     or v_outbox.lease_owner is distinct from v_worker_id
     or v_outbox.lease_expires_at is null
     or v_outbox.lease_expires_at <= statement_timestamp()
     or v_outbox.payload ->> 'application_id' <> p_application_id::text
     or v_outbox.payload ->> 'preparation_run_id' <> p_preparation_run_id::text
     or v_outbox.payload ->> 'input_snapshot_id' <> p_input_snapshot_id::text
     or v_outbox.payload ->> 'snapshot_hash' <> p_input_snapshot_hash
  then
    raise exception 'APPLICATION_KIT_OUTBOX_LEASE_INVALID' using errcode = '40001';
  end if;

  select run.* into strict v_run
  from public.application_runs as run
  where run.workspace_id = v_application.workspace_id
    and run.application_id = v_application.id
    and run.id = p_preparation_run_id
    and run.run_kind = 'PREPARATION'
  for update;

  select snapshot.* into strict v_snapshot
  from public.application_input_snapshots as snapshot
  where snapshot.workspace_id = v_application.workspace_id
    and snapshot.candidate_id = v_application.candidate_id
    and snapshot.application_id = v_application.id
    and snapshot.preparation_run_id = v_run.id
    and snapshot.id = p_input_snapshot_id
  for key share;

  if v_application.status <> 'DRAFTING'
     or v_run.status <> 'WAITING'
     or v_run.preparation_stage <> 'INPUTS_READY'
     or v_run.input_snapshot_id is distinct from v_snapshot.id
     or v_snapshot.readiness <> 'READY_FOR_DRAFTING'
     or v_snapshot.snapshot_hash <> p_input_snapshot_hash
  then
    raise exception 'APPLICATION_KIT_FROZEN_INPUT_INVALID' using errcode = '55000';
  end if;
  if p_freshness_expires_at <= statement_timestamp() then
    raise exception 'APPLICATION_KIT_RESEARCH_EXPIRED' using errcode = '55000';
  end if;
  if p_research_manifest #>> '{binding,input_snapshot_id}' <> v_snapshot.id::text
     or p_research_manifest #>> '{binding,input_snapshot_hash}' <> v_snapshot.snapshot_hash
     or p_research_manifest #>> '{binding,application_id}' <> v_application.id::text
     or p_research_manifest #>> '{binding,job_version_id}' <> v_snapshot.job_version_id::text
  then
    raise exception 'APPLICATION_KIT_RESEARCH_BINDING_INVALID' using errcode = '55000';
  end if;
  if p_revision_manifest #>> '{authority,state}' <> 'CANDIDATE_REVIEW_REQUIRED'
     or p_revision_manifest #>> '{authority,application_submitted}' <> 'false'
     or p_revision_manifest #>> '{binding,application_id}' <> v_application.id::text
     or p_revision_manifest #>> '{binding,candidate_id}' <> v_application.candidate_id::text
     or p_revision_manifest #>> '{binding,job_version_id}' <> v_snapshot.job_version_id::text
     or p_revision_manifest #>> '{binding,input_snapshot_id}' <> v_snapshot.id::text
     or p_revision_manifest #>> '{binding,input_snapshot_hash}' <> v_snapshot.snapshot_hash
     or p_revision_manifest #>> '{binding,research_bundle_hash}' <> p_research_hash
     or p_revision_manifest #>> '{validation,deterministic,deterministicChecksPassed}' <> 'true'
     or p_revision_manifest #>> '{validation,semantic,semanticChecksPassed}' <> 'true'
  then
    raise exception 'APPLICATION_KIT_REVISION_MANIFEST_INVALID' using errcode = '55000';
  end if;

  select count(*) into v_evidence_count
  from jsonb_to_recordset(p_evidence_refs) as supplied(
    evidence_version_id uuid,
    document_id uuid,
    evidence_hash text
  )
  join public.application_snapshot_evidence_refs as snapshot_ref
    on snapshot_ref.workspace_id = v_application.workspace_id
   and snapshot_ref.candidate_id = v_application.candidate_id
   and snapshot_ref.application_id = v_application.id
   and snapshot_ref.input_snapshot_id = v_snapshot.id
   and snapshot_ref.evidence_version_id = supplied.evidence_version_id
   and snapshot_ref.document_id = supplied.document_id
  join public.candidate_evidence_versions as evidence
    on evidence.workspace_id = snapshot_ref.workspace_id
   and evidence.candidate_id = snapshot_ref.candidate_id
   and evidence.document_id = snapshot_ref.document_id
   and evidence.id = snapshot_ref.evidence_version_id
   and evidence.claim_sha256 = supplied.evidence_hash;
  if v_evidence_count <> jsonb_array_length(p_evidence_refs) then
    raise exception 'APPLICATION_KIT_EVIDENCE_REFS_INVALID' using errcode = '55000';
  end if;

  select count(*) into v_fact_count
  from unnest(coalesce(p_fact_version_ids, array[]::uuid[])) as supplied(fact_version_id)
  join public.application_snapshot_fact_refs as snapshot_ref
    on snapshot_ref.workspace_id = v_application.workspace_id
   and snapshot_ref.candidate_id = v_application.candidate_id
   and snapshot_ref.application_id = v_application.id
   and snapshot_ref.input_snapshot_id = v_snapshot.id
   and snapshot_ref.fact_version_id = supplied.fact_version_id;
  if v_fact_count <> cardinality(coalesce(p_fact_version_ids, array[]::uuid[])) then
    raise exception 'APPLICATION_KIT_FACT_REFS_INVALID' using errcode = '55000';
  end if;

  if jsonb_array_length(p_artifacts) <> 4
     or (select count(distinct artifact.variant)
         from jsonb_to_recordset(p_artifacts) as artifact(variant text)) <> 4
     or exists (
       select 1
       from jsonb_to_recordset(p_artifacts) as artifact(
         kind text, variant text, display_name text, storage_bucket text,
         storage_object_path text, mime_type text, byte_size bigint,
         sha256 text, renderer_release text, qa_status text
       )
       where artifact.storage_bucket <> 'application-artifacts'
          or char_length(btrim(artifact.display_name)) not between 1 and 255
          or artifact.byte_size not between 1 and 10485760
          or artifact.sha256 !~ '^[0-9a-f]{64}$'
          or artifact.qa_status <> 'PASSED'
          or char_length(btrim(artifact.renderer_release)) not between 1 and 120
          or not (
            (artifact.variant = 'RESUME_PDF' and artifact.kind = 'RESUME' and artifact.mime_type = 'application/pdf')
            or (artifact.variant = 'RESUME_DOCX' and artifact.kind = 'RESUME' and artifact.mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            or (artifact.variant = 'COVER_LETTER_PDF' and artifact.kind = 'COVER_LETTER' and artifact.mime_type = 'application/pdf')
            or (artifact.variant = 'COVER_LETTER_DOCX' and artifact.kind = 'COVER_LETTER' and artifact.mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          )
     )
  then
    raise exception 'APPLICATION_KIT_ARTIFACTS_INVALID' using errcode = '55000';
  end if;

  v_expected_path_prefix := v_application.workspace_id::text || '/' ||
    v_application.candidate_id::text || '/' || v_application.id::text || '/' ||
    p_packet_hash || '/';
  if exists (
    select 1
    from jsonb_to_recordset(p_artifacts) as artifact(storage_object_path text)
    where artifact.storage_object_path not like v_expected_path_prefix || '%'
      or position('..' in artifact.storage_object_path) > 0
  ) then
    raise exception 'APPLICATION_KIT_ARTIFACT_PATH_INVALID' using errcode = '55000';
  end if;

  insert into public.application_research_bundles
    (id, workspace_id, candidate_id, application_id, input_snapshot_id,
     input_snapshot_hash, bundle_manifest, bundle_hash, researcher_release,
     freshness_policy_release, freshness_expires_at)
  values
    (v_research_id, v_application.workspace_id, v_application.candidate_id,
     v_application.id, v_snapshot.id, v_snapshot.snapshot_hash,
     p_research_manifest, p_research_hash, btrim(p_researcher_release),
     btrim(p_freshness_policy_release), p_freshness_expires_at);

  select coalesce(max(revision.version_number), 0) + 1 into v_version
  from public.application_revisions as revision
  where revision.application_id = v_application.id;

  insert into public.application_revisions
    (id, workspace_id, application_id, version_number, job_version_id,
     packet_manifest, material_diff, packet_hash, validation_status,
     input_snapshot_id, input_snapshot_hash, research_bundle_id,
     research_bundle_hash)
  values
    (v_revision_id, v_application.workspace_id, v_application.id, v_version,
     v_snapshot.job_version_id, p_revision_manifest, p_material_diff,
     p_packet_hash, 'PASSED', v_snapshot.id, v_snapshot.snapshot_hash,
     v_research_id, p_research_hash);

  insert into public.application_revision_evidence_refs
    (workspace_id, candidate_id, document_id, application_id,
     input_snapshot_id, application_revision_id, evidence_version_id, evidence_hash)
  select v_application.workspace_id, v_application.candidate_id,
    supplied.document_id, v_application.id, v_snapshot.id, v_revision_id,
    supplied.evidence_version_id, supplied.evidence_hash
  from jsonb_to_recordset(p_evidence_refs) as supplied(
    evidence_version_id uuid,
    document_id uuid,
    evidence_hash text
  );

  insert into public.application_revision_fact_refs
    (workspace_id, candidate_id, application_id, application_revision_id, fact_version_id)
  select v_application.workspace_id, v_application.candidate_id,
    v_application.id, v_revision_id, supplied.fact_version_id
  from unnest(coalesce(p_fact_version_ids, array[]::uuid[])) as supplied(fact_version_id);

  with inserted as (
    insert into public.artifact_versions
      (workspace_id, application_revision_id, kind, variant, display_name,
       storage_bucket, storage_object_path, mime_type, byte_size, sha256,
       renderer_release, qa_status)
    select v_application.workspace_id, v_revision_id, artifact.kind,
      artifact.variant, artifact.display_name, artifact.storage_bucket,
      artifact.storage_object_path, artifact.mime_type, artifact.byte_size,
      artifact.sha256, artifact.renderer_release, artifact.qa_status
    from jsonb_to_recordset(p_artifacts) as artifact(
      kind text, variant text, display_name text, storage_bucket text,
      storage_object_path text, mime_type text, byte_size bigint,
      sha256 text, renderer_release text, qa_status text
    )
    returning id, variant
  )
  select jsonb_agg(inserted.id order by inserted.variant) into v_artifact_ids
  from inserted;

  v_aggregate := v_application.aggregate_version + 1;
  update public.applications
  set current_revision_id = v_revision_id,
      status = 'READY',
      aggregate_version = v_aggregate,
      updated_at = statement_timestamp()
  where id = v_application.id;

  update public.application_runs
  set input_revision_id = v_revision_id,
      status = 'SUCCEEDED',
      preparation_stage = 'COMPLETE',
      finished_at = statement_timestamp(),
      last_heartbeat_at = statement_timestamp(),
      lease_owner = null,
      lease_expires_at = null,
      error_code = null
  where id = v_run.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, correlation_id, causation_id)
  values
    (v_event_id, v_application.workspace_id, 'APPLICATION', v_application.id,
     v_aggregate, 'application.kit_ready',
     jsonb_build_object(
       'revision_id', v_revision_id,
       'input_snapshot_id', v_snapshot.id,
       'packet_hash', p_packet_hash,
       'artifact_count', 4,
       'application_submitted', false
     ),
     'WORKER', v_run.id, v_outbox.event_id);

  update public.outbox
  set published_at = statement_timestamp(),
      lease_owner = null,
      lease_expires_at = null,
      last_error = null
  where id = v_outbox.id;

  return query select v_research_id, v_revision_id, v_aggregate,
    coalesce(v_artifact_ids, '[]'::jsonb), false;
end;
$$;

revoke all on function public.commit_application_kit(
  uuid, text, uuid, uuid, uuid, text, jsonb, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, uuid[], jsonb
) from public, anon, authenticated;
grant execute on function public.commit_application_kit(
  uuid, text, uuid, uuid, uuid, text, jsonb, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, uuid[], jsonb
) to service_role;

comment on function public.commit_application_kit(
  uuid, text, uuid, uuid, uuid, text, jsonb, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, uuid[], jsonb
) is
  'Service-only replay-safe commit for one cited, semantically validated, rendered no-submit application kit.';
comment on column public.artifact_versions.variant is
  'Stable document-and-format key; one immutable artifact per variant per revision.';
comment on column public.artifact_versions.display_name is
  'Candidate-facing download filename, separate from the private Storage object path.';
