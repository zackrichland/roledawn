-- Redacted drafting history and a lease-bound atomic terminal outcome. No
-- candidate prose, provider error body, source text, or credentials are accepted.
create function private.application_drafting_attempt_history_valid(p_history jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_attempt jsonb; v_key text; v_index integer:=0;
begin
  if jsonb_typeof(p_history) is distinct from 'object' or p_history->>'release' is distinct from 'application-drafting-repair/1'
    or jsonb_typeof(p_history->'attempts') is distinct from 'array' or octet_length(p_history::text)>12000
    or exists(select 1 from jsonb_object_keys(p_history) k where k not in ('release','attempts')) then return false; end if;
  if jsonb_array_length(p_history->'attempts')>2 then return false; end if;
  if jsonb_array_length(p_history->'attempts')=2 and p_history#>>'{attempts,0,status}' is distinct from 'REPAIR_REQUESTED' then return false; end if;
  for v_attempt in select value from jsonb_array_elements(p_history->'attempts') loop
    v_index:=v_index+1;
    if jsonb_typeof(v_attempt) is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(v_attempt) k where k not in (
      'attempt','status','deterministicIssueCodes','semanticIssueCodes','qualityIssueCodes','coverLetterWords','coverLetterParagraphs','policyRelease','policySha256'))
      or v_attempt->'attempt' is distinct from to_jsonb(v_index)
      or coalesce(v_attempt->>'status','') not in ('ACCEPTED','REPAIR_REQUESTED','REJECTED','REFUSED','INCOMPLETE','ERROR') then return false; end if;
    foreach v_key in array array['deterministicIssueCodes','semanticIssueCodes','qualityIssueCodes'] loop
      if jsonb_typeof(v_attempt->v_key) is distinct from 'array' then return false; end if;
      if jsonb_array_length(v_attempt->v_key)>24 or exists(select 1 from jsonb_array_elements(v_attempt->v_key) c
        where jsonb_typeof(c) is distinct from 'string' or c#>>'{}' not in (
          'ADAPTER_OUTPUT_INVALID','INPUT_INVALID','INPUT_BINDING_MISMATCH','TARGET_MISMATCH','MODE_MISMATCH','DUPLICATE_ID','UNKNOWN_CLAIM','UNUSED_CLAIM',
          'CITATION_REQUIRED','CITATION_INVALID','EVIDENCE_USE_NOT_ALLOWED','SOURCE_RESUME_CHANGED','UNSUPPORTED_NUMBER','WRITING_POLICY_VIOLATION',
          'DUPLICATE_DECISION','MISSING_DECISION','UNKNOWN_DECISION','CLAIM_NOT_ENTAILED','SOURCE_VALIDATION_INCOMPLETE','POLICY_BINDING_MISMATCH',
          'COVER_LETTER_LENGTH_OUT_OF_RANGE','COVER_LETTER_PARAGRAPH_COUNT_OUT_OF_RANGE','COVER_LETTER_CANDIDATE_PROOF_MISSING','COVER_LETTER_ROLE_CONTEXT_MISSING',
          'COVER_LETTER_TARGET_MISSING','TAILORED_RESUME_CANDIDATE_PROOF_MISSING','CANDIDATE_FACING_PLACEHOLDER','INTERNAL_METADATA_EXPOSED',
          'RESEARCH_DEPTH_LIMITED','RESUME_SECTION_STRUCTURE_WEAK','CEREMONIAL_OPENING','RHETORICAL_QUESTION','EM_DASH_DENSITY','DUPLICATE_COVER_LETTER_PARAGRAPH'
        )) then return false; end if;
    end loop;
    foreach v_key in array array['coverLetterWords','coverLetterParagraphs'] loop
      if v_attempt?v_key and (jsonb_typeof(v_attempt->v_key) is distinct from 'number' or not coalesce(v_attempt->>v_key ~ '^[0-9]{1,5}$',false)) then return false; end if;
    end loop;
    if v_attempt?'policyRelease' and not coalesce(v_attempt->>'policyRelease' ~ '^[A-Za-z][A-Za-z0-9._/-]{1,119}$',false) then return false; end if;
    if v_attempt?'policySha256' and not coalesce(v_attempt->>'policySha256' ~ '^[0-9a-f]{64}$',false) then return false; end if;
  end loop;
  return true;
end; $$;
revoke all on function private.application_drafting_attempt_history_valid(jsonb) from public,anon,authenticated;
grant execute on function private.application_drafting_attempt_history_valid(jsonb) to service_role;

alter table public.application_runs add column drafting_attempt_history jsonb
  check(drafting_attempt_history is null or private.application_drafting_attempt_history_valid(drafting_attempt_history));

create function public.fail_application_drafting_terminal(
  p_outbox_id uuid,p_worker_id text,p_application_id uuid,p_preparation_run_id uuid,p_input_snapshot_id uuid,
  p_error_code text,p_attempt_history jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
declare
  v_message public.outbox%rowtype; v_application public.applications%rowtype; v_run public.application_runs%rowtype;
  v_aggregate bigint;
begin
  if current_user<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 120 or p_application_id is null
    or p_outbox_id is null or p_preparation_run_id is null or p_input_snapshot_id is null
    or p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{3,99}(:ATTEMPTS_[0-2])?$'
    or not private.application_drafting_attempt_history_valid(p_attempt_history) then
    raise exception 'APPLICATION_DRAFTING_FAILURE_INPUT_INVALID' using errcode='22023'; end if;
  if position(':ATTEMPTS_' in p_error_code)>0 and right(p_error_code,1) is distinct from jsonb_array_length(p_attempt_history->'attempts')::text then
    raise exception 'APPLICATION_DRAFTING_FAILURE_INPUT_INVALID' using errcode='22023'; end if;
  select * into strict v_message from public.outbox where id=p_outbox_id for update;
  select * into strict v_application from public.applications where id=p_application_id and workspace_id=v_message.workspace_id for update;
  select * into strict v_run from public.application_runs where id=p_preparation_run_id and workspace_id=v_application.workspace_id
    and application_id=v_application.id and run_kind='PREPARATION' and input_snapshot_id=p_input_snapshot_id for update;
  if v_message.topic<>'application.drafting_requested' or v_message.payload->>'application_id' is distinct from p_application_id::text
    or v_message.payload->>'preparation_run_id' is distinct from p_preparation_run_id::text
    or v_message.payload->>'input_snapshot_id' is distinct from p_input_snapshot_id::text
    or not exists(select 1 from public.application_input_snapshots s where s.id=p_input_snapshot_id and s.workspace_id=v_application.workspace_id
      and s.candidate_id=v_application.candidate_id and s.application_id=v_application.id and s.preparation_run_id=v_run.id
      and s.snapshot_hash=v_message.payload->>'snapshot_hash') then
    raise exception 'APPLICATION_DRAFTING_FAILURE_BINDING_INVALID' using errcode='55000'; end if;
  if v_message.dead_lettered_at is not null and v_run.status='FAILED' and v_run.error_code=p_error_code and v_run.drafting_attempt_history=p_attempt_history then
    return true;
  end if;
  if v_message.published_at is not null or v_message.dead_lettered_at is not null or v_message.lease_owner is distinct from btrim(p_worker_id)
    or v_message.lease_expires_at is null or v_message.lease_expires_at<=statement_timestamp()
    or v_application.status<>'DRAFTING' or v_run.status<>'WAITING' or v_run.preparation_stage<>'INPUTS_READY' then
    raise exception 'APPLICATION_DRAFTING_FAILURE_LEASE_INVALID' using errcode='40001'; end if;
  update public.application_runs set status='FAILED',error_code=p_error_code,drafting_attempt_history=p_attempt_history,
    finished_at=statement_timestamp(),last_heartbeat_at=statement_timestamp(),lease_owner=null,lease_expires_at=null where id=v_run.id;
  update public.applications set status='FAILED_SAFE',aggregate_version=aggregate_version+1,updated_at=statement_timestamp()
    where id=v_application.id returning aggregate_version into v_aggregate;
  insert into public.domain_events(id,workspace_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,actor_kind,correlation_id,causation_id)
    values(extensions.gen_random_uuid(),v_application.workspace_id,'APPLICATION',v_application.id,v_aggregate,'application.drafting_failed',
      jsonb_build_object('preparation_run_id',v_run.id,'input_snapshot_id',p_input_snapshot_id,'error_code',p_error_code,
        'attempt_count',jsonb_array_length(p_attempt_history->'attempts'),'application_submitted',false),'WORKER',v_run.id,v_message.event_id);
  update public.outbox set dead_lettered_at=statement_timestamp(),last_error=p_error_code,lease_owner=null,lease_expires_at=null where id=v_message.id;
  return true;
end; $$;
revoke all on function public.fail_application_drafting_terminal(uuid,text,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fail_application_drafting_terminal(uuid,text,uuid,uuid,uuid,text,jsonb) to service_role;
