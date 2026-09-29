-- Account auto-apply must not wait forever on one application. An enrollment
-- stops blocking selection once its application is terminal, waiting on the
-- candidate, reconciling an uncertain submission, or has made no progress for
-- two hours. The first closing reason is recorded once on the enrollment.
--
-- Unchanged: standing-consent and lease checks, the actual-submission rate
-- trigger, the single-use delegation/seal authority, and every grant. A closed
-- enrollment is never delegated automatically again; its application keeps its
-- own state and remains available to the candidate.

alter table public.auto_apply_enrollments
  add column closed_at timestamptz,
  add column close_reason text,
  add constraint auto_apply_enrollments_close_reason_check check (close_reason is null or close_reason in (
    'CONFIRMED','FAILED_SAFE','SKIPPED','CANCELED','NEEDS_USER','TAKEOVER','RECONCILING','PRE_SUBMIT_REVIEW','NO_PROGRESS')),
  add constraint auto_apply_enrollments_close_pair_check check ((closed_at is null) = (close_reason is null));

create index auto_apply_enrollments_open on public.auto_apply_enrollments(candidate_id,consent_version,created_at)
  where closed_at is null;

-- Identity, consent and matching evidence stay immutable. The only permitted
-- update records the first close; a closed enrollment can never reopen.
create function private.guard_auto_apply_enrollment_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.closed_at is null and new.closed_at is not null and new.close_reason is not null
    and (to_jsonb(new) - 'closed_at' - 'close_reason') = (to_jsonb(old) - 'closed_at' - 'close_reason') then
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end; $$;
drop trigger auto_apply_enrollment_identity_immutable on public.auto_apply_enrollments;
create trigger auto_apply_enrollment_identity_immutable before update on public.auto_apply_enrollments
  for each row execute function private.guard_auto_apply_enrollment_update();
revoke all on function private.guard_auto_apply_enrollment_update() from public,anon,authenticated,service_role;

create or replace function public.advance_auto_apply_candidate(p_candidate uuid,p_token uuid,p_version bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.candidate_auto_apply_settings%rowtype; e public.auto_apply_enrollments%rowtype; a public.applications%rowtype;
  revision public.application_revisions%rowtype; result jsonb; v_reason text;
  v_stale_before timestamptz:=statement_timestamp()-interval '2 hours';
begin
  s:=private.assert_auto_apply_worker(p_candidate,p_token,p_version);
  -- Oldest open enrollment first. Only an application that is still moving
  -- under automation keeps the account waiting.
  for e in select enrollment.* from public.auto_apply_enrollments enrollment
      where enrollment.candidate_id=p_candidate and enrollment.consent_version=p_version and enrollment.closed_at is null
      order by enrollment.created_at,enrollment.application_id
  loop
    select * into strict a from public.applications where id=e.application_id for update;
    v_reason:=null;
    if a.status in ('CONFIRMED','FAILED_SAFE','SKIPPED','CANCELED','NEEDS_USER','TAKEOVER','RECONCILING','PRE_SUBMIT_REVIEW') then
      -- Terminal, waiting on the candidate, or an uncertain submission that
      -- reconciliation owns. Capacity already consumed stays consumed.
      v_reason:=a.status;
    elsif a.status='READY' and not exists(select 1 from public.application_autopilots where application_id=a.id) then
      -- Waiting for this account's own send interval is not stalled.
      if s.next_submission_at>statement_timestamp() then return jsonb_build_object('outcome','RATE_LIMITED'); end if;
      begin
        select * into strict revision from public.application_revisions where id=a.current_revision_id and application_id=a.id;
        if not private.is_supported_autopilot_destination((select apply_url from public.job_versions where id=a.job_version_id)) then raise exception 'AUTO_APPLY_DESTINATION_UNSUPPORTED'; end if;
        result:=private.delegate_auto_apply_as_candidate(e.delegate_command_id,a.id,a.aggregate_version,revision.id,revision.packet_hash,s.consent_actor);
        return jsonb_build_object('outcome','DELEGATED','application_id',a.id,'autopilot_id',result->>'id');
      exception when others then
        -- A recent failure is retried by the next check. A packet that could
        -- not be delegated for two hours stops blocking; nothing was sent.
        if a.updated_at>v_stale_before then raise; end if;
        v_reason:='NO_PROGRESS';
      end;
    elsif a.updated_at<=v_stale_before then
      -- For example DRAFTING after a dead-lettered message, or delegated work
      -- that never advanced. Actual sends remain limited by the attempt trigger.
      v_reason:='NO_PROGRESS';
    else
      return jsonb_build_object('outcome','WAITING_APPLICATION');
    end if;
    update public.auto_apply_enrollments set closed_at=statement_timestamp(),close_reason=v_reason
      where application_id=e.application_id and closed_at is null;
  end loop;
  if s.next_submission_at>statement_timestamp() or s.next_prepare_at>statement_timestamp() then return jsonb_build_object('outcome','RATE_LIMITED'); end if;
  return jsonb_build_object('outcome','SELECT_MATCH');
end; $$;
revoke all on function public.advance_auto_apply_candidate(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.advance_auto_apply_candidate(uuid,uuid,bigint) to service_role;

-- A new match may be prepared only when no open enrollment is still moving.
-- Replace exactly the old guard so every other check (including the content
-- hash binding) is preserved; refuse a drifted upstream definition.
do $$
declare definition text; old_guard text:='and e.consent_version=p_version and a.status not in (''CONFIRMED'',''CANCELED'',''FAILED_SAFE'',''SKIPPED'')) then raise exception ''AUTO_APPLY_APPLICATION_ACTIVE''';
begin
  definition:=pg_get_functiondef('public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb)'::regprocedure);
  if position(old_guard in definition)=0 or position('p_decision->>''jobContentHash''=v.content_hash' in definition)=0 then
    raise exception 'AUTO_APPLY_ENQUEUE_GUARD_DRIFT';
  end if;
  execute replace(definition,old_guard,'and e.consent_version=p_version and e.closed_at is null and a.status not in (''CONFIRMED'',''CANCELED'',''FAILED_SAFE'',''SKIPPED'',''NEEDS_USER'',''TAKEOVER'',''RECONCILING'',''PRE_SUBMIT_REVIEW'')) then raise exception ''AUTO_APPLY_APPLICATION_ACTIVE''');
end; $$;
revoke all on function public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb) to service_role;
