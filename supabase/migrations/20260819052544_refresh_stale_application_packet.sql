-- RoleDawn: candidate profile changes invalidate fill authority for an older
-- Application Input Snapshot. Candidates may explicitly queue a replacement
-- packet while the prior immutable revision remains current until the new
-- revision commits atomically.

create function private.reject_stale_application_fill_authorization()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_current_candidate_input_version bigint;
  v_snapshot_candidate_input_version bigint;
begin
  if new.permitted_action <> 'FILL_APPLICATION_ONCE' then
    return new;
  end if;

  select candidate.application_input_version,
         snapshot.candidate_input_version
    into v_current_candidate_input_version,
         v_snapshot_candidate_input_version
  from public.applications as application
  join public.candidates as candidate
    on candidate.workspace_id = application.workspace_id
   and candidate.id = application.candidate_id
  join public.application_revisions as revision
    on revision.workspace_id = application.workspace_id
   and revision.application_id = application.id
   and revision.id = new.revision_id
  join public.application_input_snapshots as snapshot
    on snapshot.workspace_id = revision.workspace_id
   and snapshot.application_id = revision.application_id
   and snapshot.id = revision.input_snapshot_id
  where application.workspace_id = new.workspace_id
    and application.candidate_id = new.candidate_id
    and application.id = new.application_id
    and application.current_revision_id = revision.id
  for share of candidate;

  if not found then
    raise exception 'APPLICATION_FILL_INPUT_BINDING_INVALID'
      using errcode = '55000';
  end if;
  if v_snapshot_candidate_input_version
       <> v_current_candidate_input_version then
    raise exception 'APPLICATION_FILL_INPUTS_STALE'
      using errcode = 'PT409';
  end if;

  return new;
end;
$$;

revoke all on function private.reject_stale_application_fill_authorization()
  from public, anon, authenticated;

create trigger approval_challenges_reject_stale_candidate_inputs
before insert on public.approval_challenges
for each row execute function private.reject_stale_application_fill_authorization();

comment on function private.reject_stale_application_fill_authorization() is
  'Rejects new fill-only authority when the revision snapshot predates the current candidate input epoch.';

create function public.refresh_stale_application_packet(
  p_command_id uuid,
  p_application_id uuid,
  p_expected_aggregate_version bigint
)
returns table (
  application_id uuid,
  preparation_run_id uuid,
  aggregate_version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_application public.applications%rowtype;
  v_candidate public.candidates%rowtype;
  v_existing public.command_dedup%rowtype;
  v_baseline_snapshot public.application_input_snapshots%rowtype;
  v_run_id uuid := extensions.gen_random_uuid();
  v_event_id uuid := extensions.gen_random_uuid();
  v_request_hash text;
  v_new_aggregate bigint;
begin
  if v_actor is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_command_id is null or p_application_id is null
     or p_expected_aggregate_version is null
     or p_expected_aggregate_version <= 0 then
    raise exception 'APPLICATION_PACKET_REFRESH_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select application.* into strict v_application
  from public.applications as application
  join public.candidates as candidate
    on candidate.workspace_id = application.workspace_id
   and candidate.id = application.candidate_id
   and candidate.auth_user_id = v_actor
   and candidate.status in ('ONBOARDING', 'ACTIVE')
  join public.workspace_memberships as membership
    on membership.workspace_id = application.workspace_id
   and membership.auth_user_id = v_actor
   and membership.status = 'ACTIVE'
  join public.workspaces as workspace
    on workspace.id = application.workspace_id
   and workspace.status = 'ACTIVE'
  where application.id = p_application_id
  for update of application
  for share of candidate, membership, workspace;

  select candidate.* into strict v_candidate
  from public.candidates as candidate
  where candidate.workspace_id = v_application.workspace_id
    and candidate.id = v_application.candidate_id
    and candidate.auth_user_id = v_actor;

  v_request_hash := encode(extensions.digest(convert_to(
    p_application_id::text || E'\n' || p_expected_aggregate_version::text,
    'utf8'
  ), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_application.workspace_id::text || ':' || p_command_id::text,
      0
    )
  );

  select * into v_existing
  from public.command_dedup
  where workspace_id = v_application.workspace_id
    and command_id = p_command_id;
  if found then
    if v_existing.command_type <> 'REFRESH_STALE_APPLICATION_PACKET'
       or v_existing.request_hash <> v_request_hash
       or v_existing.actor_id <> v_actor then
      raise exception 'COMMAND_ID_PAYLOAD_MISMATCH' using errcode = '23505';
    end if;
    if v_existing.status <> 'COMMITTED' then
      raise exception 'COMMAND_ALREADY_IN_PROGRESS' using errcode = 'PT409';
    end if;
    return query select v_application.id,
      (v_existing.result ->> 'preparation_run_id')::uuid,
      (v_existing.result ->> 'aggregate_version')::bigint,
      true;
    return;
  end if;

  if v_application.status not in ('READY', 'NEEDS_USER', 'FAILED_SAFE') then
    raise exception 'APPLICATION_PACKET_NOT_REFRESHABLE'
      using errcode = '55000';
  end if;
  if v_application.aggregate_version <> p_expected_aggregate_version then
    raise exception 'APPLICATION_VERSION_MISMATCH' using errcode = 'PT409';
  end if;
  if v_application.job_id is null or v_application.job_version_id is null then
    raise exception 'PREPARATION_JOB_NOT_RESOLVED' using errcode = '55000';
  end if;

  if v_application.status <> 'NEEDS_USER'
     and v_application.current_revision_id is not null then
    select snapshot.* into v_baseline_snapshot
    from public.application_revisions as revision
    join public.application_input_snapshots as snapshot
      on snapshot.workspace_id = revision.workspace_id
     and snapshot.application_id = revision.application_id
     and snapshot.id = revision.input_snapshot_id
    where revision.workspace_id = v_application.workspace_id
      and revision.application_id = v_application.id
      and revision.id = v_application.current_revision_id
    for key share of revision, snapshot;
  else
    select snapshot.* into v_baseline_snapshot
    from public.application_input_snapshots as snapshot
    where snapshot.workspace_id = v_application.workspace_id
      and snapshot.candidate_id = v_application.candidate_id
      and snapshot.application_id = v_application.id
    order by snapshot.created_at desc, snapshot.id desc
    limit 1
    for key share;
  end if;

  if v_baseline_snapshot.id is null then
    raise exception 'APPLICATION_INPUT_SNAPSHOT_REQUIRED'
      using errcode = '55000';
  end if;
  if v_baseline_snapshot.candidate_input_version
       = v_candidate.application_input_version then
    raise exception 'APPLICATION_PACKET_INPUTS_UNCHANGED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.application_runs as run
    where run.workspace_id = v_application.workspace_id
      and run.application_id = v_application.id
      and run.run_kind = 'PREPARATION'
      and (
        run.status in ('QUEUED', 'RUNNING')
        or (
          run.status = 'WAITING'
          and run.preparation_stage is distinct from 'BLOCKED'
        )
      )
  ) then
    raise exception 'PREPARATION_ALREADY_ACTIVE' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.application_fill_attempts as fill
    where fill.workspace_id = v_application.workspace_id
      and fill.application_id = v_application.id
      and fill.status in ('QUEUED', 'STARTED')
  ) or exists (
    select 1
    from public.application_runs as run
    where run.workspace_id = v_application.workspace_id
      and run.application_id = v_application.id
      and run.run_kind = 'BROWSER_FILL'
      and run.status in ('QUEUED', 'RUNNING', 'WAITING')
  ) or exists (
    select 1
    from public.computer_sessions as session
    where session.workspace_id = v_application.workspace_id
      and session.application_id = v_application.id
      and session.state in ('PROVISIONING', 'ACTIVE', 'PAUSED_FOR_REVIEW')
  ) then
    raise exception 'APPLICATION_FILL_ALREADY_ACTIVE' using errcode = '55000';
  end if;

  insert into public.command_dedup
    (workspace_id, command_id, actor_id, command_type, request_hash, status)
  values (
    v_application.workspace_id, p_command_id, v_actor,
    'REFRESH_STALE_APPLICATION_PACKET', v_request_hash, 'STARTED'
  );

  insert into public.application_runs
    (id, workspace_id, application_id, run_kind, status, preparation_stage)
  values (
    v_run_id, v_application.workspace_id, v_application.id,
    'PREPARATION', 'QUEUED', 'QUEUED'
  );

  v_new_aggregate := v_application.aggregate_version + 1;
  update public.applications
  set status = 'DRAFTING',
      aggregate_version = v_new_aggregate,
      updated_at = statement_timestamp()
  where id = v_application.id;

  insert into public.domain_events
    (id, workspace_id, aggregate_type, aggregate_id, aggregate_version,
     event_type, payload, actor_kind, actor_id, correlation_id)
  values (
    v_event_id, v_application.workspace_id, 'APPLICATION', v_application.id,
    v_new_aggregate, 'application.files_refresh_queued',
    jsonb_build_object(
      'reason', 'CANDIDATE_INPUTS_CHANGED',
      'preparation_run_id', v_run_id,
      'previous_input_snapshot_id', v_baseline_snapshot.id,
      'retained_revision_id', v_application.current_revision_id,
      'application_submitted', false
    ),
    'CANDIDATE', v_actor, p_command_id
  );

  insert into public.outbox (workspace_id, event_id, topic, payload)
  values (
    v_application.workspace_id, v_event_id,
    'application.preparation_requested',
    jsonb_build_object(
      'application_id', v_application.id,
      'job_id', v_application.job_id,
      'job_version_id', v_application.job_version_id,
      'preparation_run_id', v_run_id,
      'reason', 'CANDIDATE_INPUTS_CHANGED'
    )
  );

  update public.command_dedup
  set aggregate_type = 'APPLICATION',
      aggregate_id = v_application.id,
      status = 'COMMITTED',
      result_event_id = v_event_id,
      result = jsonb_build_object(
        'application_id', v_application.id,
        'preparation_run_id', v_run_id,
        'aggregate_version', v_new_aggregate
      ),
      completed_at = statement_timestamp()
  where workspace_id = v_application.workspace_id
    and command_id = p_command_id;

  return query select v_application.id, v_run_id, v_new_aggregate, false;
end;
$$;

revoke all on function public.refresh_stale_application_packet(
  uuid, uuid, bigint
) from public, anon;
grant execute on function public.refresh_stale_application_packet(
  uuid, uuid, bigint
) to authenticated, service_role;

comment on function public.refresh_stale_application_packet(
  uuid, uuid, bigint
) is
  'Authenticated replay-safe command that requeues preparation only after candidate inputs changed and no preparation or fill is active.';

-- The hosted v1 commit path correctly refuses to overwrite a current revision.
-- Preserve it as a private primitive and add a narrow wrapper that admits only
-- a newer snapshot replacing a stale current revision. The temporary null is
-- transaction-local: concurrent readers keep seeing the old revision until
-- the primitive atomically installs the replacement, and any error rolls back.
alter function public.commit_application_kit(
  uuid, text, uuid, uuid, uuid, text, jsonb, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, uuid[], jsonb
) rename to commit_application_kit_single_revision_v1;

alter function public.commit_application_kit_single_revision_v1(
  uuid, text, uuid, uuid, uuid, text, jsonb, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, uuid[], jsonb
) set schema private;

revoke all on function private.commit_application_kit_single_revision_v1(
  uuid, text, uuid, uuid, uuid, text, jsonb, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, uuid[], jsonb
) from public, anon, authenticated;
grant execute on function private.commit_application_kit_single_revision_v1(
  uuid, text, uuid, uuid, uuid, text, jsonb, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, uuid[], jsonb
) to service_role;

create function public.commit_application_kit(
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
  v_application public.applications%rowtype;
  v_candidate public.candidates%rowtype;
  v_current_revision public.application_revisions%rowtype;
  v_current_snapshot public.application_input_snapshots%rowtype;
  v_replacement_snapshot public.application_input_snapshots%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;

  if p_application_id is not null then
    select application.* into strict v_application
    from public.applications as application
    join public.candidates as candidate
      on candidate.workspace_id = application.workspace_id
     and candidate.id = application.candidate_id
    where application.id = p_application_id
    for update of application
    for share of candidate;

    select candidate.* into strict v_candidate
    from public.candidates as candidate
    where candidate.workspace_id = v_application.workspace_id
      and candidate.id = v_application.candidate_id;

    if v_application.current_revision_id is not null then
      select revision.* into strict v_current_revision
      from public.application_revisions as revision
      where revision.workspace_id = v_application.workspace_id
        and revision.application_id = v_application.id
        and revision.id = v_application.current_revision_id
      for key share;

      -- Preserve the primitive's exact replay behavior for the revision that
      -- already committed from this same input snapshot.
      if v_current_revision.input_snapshot_id = p_input_snapshot_id
         and v_current_revision.packet_hash = p_packet_hash then
        return query
        select committed.research_bundle_id, committed.revision_id,
          committed.aggregate_version, committed.artifact_ids,
          committed.replayed
        from private.commit_application_kit_single_revision_v1(
          p_outbox_id, p_worker_id, p_application_id,
          p_preparation_run_id, p_input_snapshot_id, p_input_snapshot_hash,
          p_research_manifest, p_research_hash, p_researcher_release,
          p_freshness_policy_release, p_freshness_expires_at,
          p_revision_manifest, p_material_diff, p_packet_hash,
          p_evidence_refs, p_fact_version_ids, p_artifacts
        ) as committed;
        return;
      end if;

      select snapshot.* into strict v_current_snapshot
      from public.application_input_snapshots as snapshot
      where snapshot.workspace_id = v_current_revision.workspace_id
        and snapshot.application_id = v_current_revision.application_id
        and snapshot.id = v_current_revision.input_snapshot_id
      for key share;

      select snapshot.* into strict v_replacement_snapshot
      from public.application_input_snapshots as snapshot
      where snapshot.workspace_id = v_application.workspace_id
        and snapshot.candidate_id = v_application.candidate_id
        and snapshot.application_id = v_application.id
        and snapshot.preparation_run_id = p_preparation_run_id
        and snapshot.id = p_input_snapshot_id
      for key share;

      if v_application.status <> 'DRAFTING'
         or v_current_revision.validation_status <> 'PASSED'
         or v_current_snapshot.candidate_input_version
              = v_candidate.application_input_version
         or v_replacement_snapshot.candidate_input_version
              <= v_current_snapshot.candidate_input_version
         or v_replacement_snapshot.candidate_input_version
              <> v_candidate.application_input_version then
        raise exception 'APPLICATION_KIT_CURRENT_REVISION_CONFLICT'
          using errcode = '40001';
      end if;

      update public.applications
      set current_revision_id = null
      where id = v_application.id;
    end if;
  end if;

  return query
  select committed.research_bundle_id, committed.revision_id,
    committed.aggregate_version, committed.artifact_ids,
    committed.replayed
  from private.commit_application_kit_single_revision_v1(
    p_outbox_id, p_worker_id, p_application_id,
    p_preparation_run_id, p_input_snapshot_id, p_input_snapshot_hash,
    p_research_manifest, p_research_hash, p_researcher_release,
    p_freshness_policy_release, p_freshness_expires_at,
    p_revision_manifest, p_material_diff, p_packet_hash,
    p_evidence_refs, p_fact_version_ids, p_artifacts
  ) as committed;
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
  'Service-only Application Kit commit that atomically replaces a stale current revision from a newer immutable input snapshot.';
