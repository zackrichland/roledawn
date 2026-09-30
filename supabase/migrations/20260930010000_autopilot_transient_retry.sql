-- Automatic retry of pre-submit provider failures (D-114).
--
-- A send that stopped before any submission because the model timed out, the
-- network dropped, the browser pool was full, or the worker hit an unknown
-- error sent nothing to the employer. It now runs again by itself, at most
-- twice (1 and 5 minutes later), before it waits for the candidate. The
-- founder: "Nothing stops an application." Stops with a submission attempt,
-- explicit employer refusals (D-111), and candidate-caused stops are unchanged.

alter table public.application_autopilots add column transient_retries smallint not null default 0
  check (transient_retries between 0 and 5);

create or replace function public.finish_application_autopilot(p_id uuid,p_lease_token uuid,p_outcome text,p_failure_code text default null,p_receipt jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_row public.application_autopilots%rowtype; v_outcome text:=p_outcome; v_refusals integer; v_next text;
begin
  select * into strict v_row from public.application_autopilots where id=p_id for update;
  if p_lease_token is null or v_row.lease_token is distinct from p_lease_token or v_row.status not in ('RUNNING','SUBMITTING','RECONCILING')
    or p_outcome is null or p_outcome not in ('CONFIRMED','UNCERTAIN','FAILED_SAFE','NOT_ACCEPTED')
    or (p_failure_code is not null and p_failure_code !~ '^[A-Z][A-Z0-9_]{2,119}$') then
    raise exception 'APPLICATION_AUTOPILOT_COMPLETION_INVALID' using errcode='55000'; end if;
  -- The employer answered this attempt's one submission with its emailed-code
  -- challenge, and the challenge was never satisfied (no code in time, or every
  -- code refused). Nothing was accepted, so the attempt closes and the send may
  -- run again: once automatically, then when the candidate presses Try again.
  if p_outcome='NOT_ACCEPTED' then
    if v_row.attempt_id is null
      or p_failure_code is distinct from 'DELIVERY_EMAIL_VERIFICATION_TIMEOUT' and p_failure_code is distinct from 'DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED' then
      raise exception 'APPLICATION_AUTOPILOT_COMPLETION_INVALID' using errcode='55000'; end if;
    update public.application_attempts set status='NOT_ACCEPTED',completed_at=statement_timestamp(),
      result_summary=result_summary||jsonb_build_object('not_accepted_reason',p_failure_code)
      where id=v_row.attempt_id and status='STARTED';
    if not found then raise exception 'APPLICATION_AUTOPILOT_COMPLETION_INVALID' using errcode='55000'; end if;
    select count(*) into v_refusals from public.application_attempts where application_id=v_row.application_id and status='NOT_ACCEPTED';
    v_next:=case when v_row.stop_requested='CANCEL' then 'CANCELED' when v_row.stop_requested='PAUSE' then 'PAUSED'
      when v_refusals<2 and v_row.expires_at>statement_timestamp()+interval '15 minutes' then 'QUEUED' else 'FAILED_SAFE' end;
    update public.application_autopilots set status=v_next,failure_code=case when v_next='QUEUED' then null else p_failure_code end,
      attempt_id=null,sealed_diff=null,sealed_diff_hash=null,readback_hash=null,request_fingerprint=null,
      stop_requested=case when v_next in ('CANCELED','PAUSED') then stop_requested else null end,
      lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,updated_at=statement_timestamp(),
      available_at=statement_timestamp()+interval '1 minute' where id=p_id;
    perform private.autopilot_event(p_id,'application.autopilot_not_accepted',
      case v_next when 'QUEUED' then 'EXECUTING' when 'PAUSED' then 'TAKEOVER' else v_next end);
    return;
  end if;
  -- A stop before any submission that a provider hiccup caused (the model or
  -- network timed out, the browser pool was full, an unknown worker error)
  -- sent nothing, so the send runs again by itself: at most twice, 1 then 5
  -- minutes later. Every other safe stop still waits for the candidate.
  if p_outcome='FAILED_SAFE' and v_row.attempt_id is null and v_row.stop_requested is null and v_row.transient_retries<2
    and v_row.expires_at>statement_timestamp()+interval '15 minutes'
    and p_failure_code in ('OPENAI_AGENTS_ABORTED','OPENAI_AGENTS_NETWORK_ERROR','OPENAI_AGENTS_HTTP_ERROR','AGENTS_FILL_CANCELLED',
      'DELIVERY_BROWSER_CONCURRENCY_LIMIT','APPLICATION_DELIVERY_FAILED') then
    update public.application_autopilots set status='QUEUED',transient_retries=transient_retries+1,failure_code=null,
      sealed_diff=null,sealed_diff_hash=null,readback_hash=null,request_fingerprint=null,
      lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,updated_at=statement_timestamp(),
      available_at=statement_timestamp()+case when v_row.transient_retries=0 then interval '1 minute' else interval '5 minutes' end where id=p_id;
    perform private.autopilot_event(p_id,'application.autopilot_retry_scheduled','EXECUTING');
    return;
  end if;
  if v_row.attempt_id is not null and p_outcome='FAILED_SAFE' then v_outcome:='UNCERTAIN'; end if;
  if v_row.attempt_id is null and v_outcome in ('CONFIRMED','UNCERTAIN') then
    raise exception 'APPLICATION_AUTOPILOT_ATTEMPT_REQUIRED' using errcode='55000'; end if;
  if v_outcome='CONFIRMED' then
    if jsonb_typeof(p_receipt) is distinct from 'object' or p_receipt->>'confirmationKind' not in ('PORTAL','EMAIL','EXTERNAL_RECEIPT')
      or coalesce(char_length(btrim(p_receipt->>'confirmationReference')),0) not between 1 and 2000
      or coalesce(p_receipt->>'receiptHash','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_receipt->'evidenceManifest') is distinct from 'object'
      or p_receipt#>>'{evidenceManifest,autopilotId}' is distinct from p_id::text
      or p_receipt#>>'{evidenceManifest,revisionId}' is distinct from v_row.revision_id::text
      or p_receipt#>>'{evidenceManifest,packetHash}' is distinct from v_row.packet_hash
      or p_receipt#>>'{evidenceManifest,attemptId}' is distinct from v_row.attempt_id::text
      or p_receipt#>>'{evidenceManifest,requestFingerprint}' is distinct from v_row.request_fingerprint
      or (p_receipt->>'confirmedAt')::timestamptz is null or octet_length(p_receipt::text)>262144 then
      raise exception 'APPLICATION_AUTOPILOT_RECEIPT_INVALID' using errcode='22023'; end if;
    update public.application_attempts set status='CONFIRMED',completed_at=statement_timestamp() where id=v_row.attempt_id;
    insert into public.receipts(workspace_id,application_id,attempt_id,confirmation_kind,confirmation_reference,evidence_manifest,receipt_hash,confirmed_at)
      values(v_row.workspace_id,v_row.application_id,v_row.attempt_id,p_receipt->>'confirmationKind',p_receipt->>'confirmationReference',
        p_receipt->'evidenceManifest',p_receipt->>'receiptHash',(p_receipt->>'confirmedAt')::timestamptz);
  elsif v_row.attempt_id is not null then
    update public.application_attempts set status='UNCERTAIN',completed_at=statement_timestamp() where id=v_row.attempt_id;
  end if;
  update public.application_autopilots set status=v_outcome,failure_code=case when v_outcome='CONFIRMED' then null else p_failure_code end,
    lease_expires_at=null,lease_owner=null,lease_token=null,version=version+1,updated_at=statement_timestamp(),available_at=statement_timestamp()+interval '5 minutes' where id=p_id;
  perform private.autopilot_event(p_id,'application.autopilot_completed',case when v_outcome='UNCERTAIN' then 'RECONCILING' else v_outcome end);
end; $$;
