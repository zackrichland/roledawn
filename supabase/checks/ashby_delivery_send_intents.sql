-- Synthetic, local-only proof: enabling a provider does not create authority.
begin;
create temporary table ashby_send_checks(check_name text primary key, passed boolean not null) on commit drop;

create function pg_temp.ashby_ready(p_url text default 'https://jobs.ashbyhq.com/SyntheticBoard/11111111-1111-4111-8111-111111111111/application') returns jsonb
language plpgsql as $$
declare u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); j uuid:=gen_random_uuid();
  v uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(u,'ashby-check-'||u||'@example.invalid');
  insert into public.workspaces(id,name,kind,status,personal_owner_auth_user_id) values(w,'Synthetic workspace','PERSONAL','ACTIVE',u);
  insert into public.workspace_memberships(workspace_id,auth_user_id,role,status) values(w,u,'OWNER','ACTIVE');
  insert into public.candidates(id,workspace_id,auth_user_id,display_name,status) values(c,w,u,'Synthetic candidate','ACTIVE');
  insert into public.jobs(id,canonical_url,state) values(j,'https://synthetic-check.invalid/jobs/'||j,'OPEN');
  insert into public.job_versions(id,job_id,version_number,content_hash,title,employer_name,description_text,apply_url,observed_at)
    values(v,j,1,repeat('b',64),'Synthetic role','Synthetic employer','Synthetic fixture only.',p_url,now());
  insert into public.applications(id,workspace_id,candidate_id,job_id,job_version_id,status) values(a,w,c,j,v,'DRAFTING');
  -- Skip packet-production FKs only in fixture setup; all commands run normally.
  set local session_replication_role=replica;
  insert into public.application_input_snapshots(id,workspace_id,candidate_id,application_id,preparation_run_id,job_id,job_version_id,tailoring_mode,submission_mode,readiness,snapshot_manifest,snapshot_hash,candidate_input_version,policy_release,assembler_release,blockers)
    values(s,w,c,a,gen_random_uuid(),j,v,'AS_UPLOADED','PER_APPLICATION_APPROVAL','BLOCKED','{}',repeat('a',64),
      (select application_input_version from public.candidates where id=c),'check/1','check/1','["fixture"]');
  insert into public.application_revisions(id,workspace_id,application_id,version_number,job_version_id,packet_manifest,material_diff,packet_hash,validation_status,input_snapshot_id,input_snapshot_hash,research_bundle_id,research_bundle_hash)
    values(r,w,a,1,v,'{"authority":{"state":"CANDIDATE_REVIEW_REQUIRED","application_submitted":false}}','{}',repeat('c',64),'PASSED',s,repeat('a',64),gen_random_uuid(),repeat('e',64));
  insert into public.artifact_versions(workspace_id,application_revision_id,kind,storage_bucket,storage_object_path,mime_type,byte_size,sha256,qa_status,variant,display_name)
    select w,r,case when item like 'RESUME%' then 'RESUME' else 'COVER_LETTER' end,'application-artifacts',w||'/'||a||'/'||item,
      case when item like '%PDF' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end,
      10,encode(sha256(convert_to(item,'UTF8')),'hex'),'PASSED',item,item||case when item like '%PDF' then '.pdf' else '.docx' end
    from unnest(array['RESUME_PDF','RESUME_DOCX','COVER_LETTER_PDF','COVER_LETTER_DOCX']) item;
  set local session_replication_role=origin;
  update public.applications set status='READY',current_revision_id=r where id=a;
  return jsonb_build_object('user',u,'workspace',w,'candidate',c,'application',a,'revision',r,'snapshot',s);
end $$;

create function pg_temp.ashby_request(f jsonb, command uuid default gen_random_uuid()) returns jsonb
language plpgsql as $$ declare result record; begin
  perform set_config('request.jwt.claim.sub',f->>'user',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  select * into strict result from public.request_application_send(command,(f->>'application')::uuid);
  execute 'reset role';
  return to_jsonb(result);
end $$;

create function pg_temp.ashby_sweep(f jsonb) returns jsonb
language plpgsql as $$ declare result jsonb; begin
  perform set_config('request.jwt.claim.role','service_role',true);
  execute 'set local role service_role';
  result:=public.delegate_ready_send_intents((f->>'application')::uuid,1);
  execute 'reset role';
  return result;
end $$;

do $check$
declare f jsonb:=pg_temp.ashby_ready(); command uuid:=gen_random_uuid(); first_delegate uuid; outcome jsonb;
begin
  outcome:=pg_temp.ashby_sweep(f);
  assert (outcome->>'delegated')::int=0 and not exists(select 1 from public.application_autopilots where application_id=(f->>'application')::uuid), 'READY without intent never delegates';
  insert into ashby_send_checks values('ready_ashby_without_intent_has_no_authority',true);

  outcome:=pg_temp.ashby_request(f,command);
  assert (outcome->>'intent_open')::boolean and not (outcome->>'replayed')::boolean, 'candidate opens intent';
  select delegate_command_id into first_delegate from public.application_send_intents where application_id=(f->>'application')::uuid;
  -- Existing unsupported closures must stay closed when the scheduler runs.
  update public.application_send_intents set closed_at=now(),close_reason='NOT_DELIVERABLE' where application_id=(f->>'application')::uuid;
  outcome:=pg_temp.ashby_sweep(f);
  assert (outcome->>'delegated')::int=0, 'provider release cannot reopen historical intent';
  outcome:=pg_temp.ashby_request(f,command);
  assert (outcome->>'replayed')::boolean and not (outcome->>'intent_open')::boolean, 'original command replay reports closed';
  insert into ashby_send_checks values('closed_intent_requires_a_fresh_candidate_command',true);

  outcome:=pg_temp.ashby_request(f);
  assert (outcome->>'intent_open')::boolean and not (outcome->>'replayed')::boolean, 'explicit retry reopens';
  assert (select delegate_command_id<>first_delegate from public.application_send_intents where application_id=(f->>'application')::uuid), 'retry gets fresh delegation key';
  outcome:=pg_temp.ashby_sweep(f);
  assert (outcome->>'delegated')::int=1, 'supported fresh READY packet delegates';
  assert (select count(*) from public.application_autopilots where application_id=(f->>'application')::uuid)=1, 'one delegation';
  assert not exists(select 1 from public.application_attempts where application_id=(f->>'application')::uuid), 'delegation is not submission';
  assert (select close_reason='DELEGATED' from public.application_send_intents where application_id=(f->>'application')::uuid), 'intent consumed';
  outcome:=pg_temp.ashby_sweep(f);
  assert (outcome->>'delegated')::int=0, 'second sweep cannot duplicate';
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  assert not public.cancel_application_send((f->>'application')::uuid), 'consumed intent never claims a successful cancellation';
  execute 'reset role';
  begin perform pg_temp.ashby_request(f); raise exception 'CHECK_DUPLICATE_SEND_ACCEPTED';
  exception when others then if sqlerrm<>'APPLICATION_SEND_NOT_AVAILABLE' then raise; end if; end;
  insert into ashby_send_checks values('fresh_request_delegates_once_without_submitting',true);
end $check$;

do $check$
declare f jsonb:=pg_temp.ashby_ready(); command uuid:=gen_random_uuid(); outcome jsonb;
begin
  perform pg_temp.ashby_request(f,command);
  perform set_config('request.jwt.claim.sub',f->>'user',true);
  execute 'set local role authenticated';
  perform public.cancel_application_send((f->>'application')::uuid);
  execute 'reset role';
  outcome:=pg_temp.ashby_request(f,command);
  assert (outcome->>'replayed')::boolean and not (outcome->>'intent_open')::boolean, 'replay does not undo cancel';
  assert (pg_temp.ashby_sweep(f)->>'delegated')::int=0, 'cancel prevents scheduler delegation';
  update public.applications set status='CANCELED' where id=(f->>'application')::uuid;
  begin perform pg_temp.ashby_request(f); raise exception 'CHECK_CANCELED_SEND_ACCEPTED';
  exception when others then if sqlerrm<>'APPLICATION_SEND_NOT_AVAILABLE' then raise; end if; end;
  insert into ashby_send_checks values('cancellation_and_canceled_replay_preserve_stop',true);
end $check$;

do $check$
declare f jsonb:=pg_temp.ashby_ready(); outcome jsonb;
begin
  perform pg_temp.ashby_request(f);
  update public.candidates set application_input_version=application_input_version+1 where id=(f->>'candidate')::uuid;
  outcome:=pg_temp.ashby_sweep(f);
  assert (outcome->>'delegated')::int=0, 'stale packet cannot delegate';
  assert not exists(select 1 from public.application_autopilots where application_id=(f->>'application')::uuid), 'no stale authority';
  insert into ashby_send_checks values('old_candidate_input_packet_cannot_delegate',true);
end $check$;

do $check$
declare f jsonb:=pg_temp.ashby_ready('https://jobs.ashbyhq.com.evil.invalid/SyntheticBoard/11111111-1111-4111-8111-111111111111'); outcome jsonb;
begin
  perform pg_temp.ashby_request(f);
  outcome:=pg_temp.ashby_sweep(f);
  assert (outcome->>'closed')::int=1 and (outcome->>'delegated')::int=0, 'unsupported host closes';
  begin perform pg_temp.ashby_request(f); raise exception 'CHECK_UNSUPPORTED_REOPENED';
  exception when others then if sqlerrm<>'APPLICATION_SEND_DESTINATION_UNSUPPORTED' then raise; end if; end;
  -- Candidate direct delegation must use the same adapter gate as the worker.
  perform set_config('request.jwt.claim.sub',f->>'user',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform private.delegate_application_autopilot(gen_random_uuid(),(f->>'application')::uuid,1,(f->>'revision')::uuid,repeat('c',64));
    raise exception 'CHECK_DIRECT_UNSUPPORTED_ACCEPTED';
  exception when others then if sqlerrm<>'APPLICATION_FILL_DESTINATION_INVALID' then raise; end if; end;
  insert into ashby_send_checks values('unsupported_hosts_block_both_initial_and_direct_delegation',true);
end $check$;

do $check$
declare f jsonb:=pg_temp.ashby_ready(); outcome jsonb;
begin
  perform pg_temp.ashby_request(f);
  -- An uncertain submit result blocks even if a stale UI says READY.
  set local session_replication_role=replica;
  insert into public.application_attempts(workspace_id,application_id,revision_id,approval_consumption_id,approval_action,idempotency_key,adapter_release,status,result_summary)
    values((f->>'workspace')::uuid,(f->>'application')::uuid,(f->>'revision')::uuid,gen_random_uuid(),'SUBMIT_APPLICATION_ONCE','synthetic:'||gen_random_uuid(),'check/1','UNCERTAIN','{}');
  set local session_replication_role=origin;
  outcome:=pg_temp.ashby_sweep(f);
  assert (outcome->>'delegated')::int=0, 'uncertain prior attempt prevents delegation';
  update public.application_send_intents set closed_at=now(),close_reason='NOT_DELIVERABLE' where application_id=(f->>'application')::uuid;
  begin perform pg_temp.ashby_request(f); raise exception 'CHECK_UNCERTAIN_REOPENED';
  exception when others then if sqlerrm<>'APPLICATION_SEND_NOT_AVAILABLE' then raise; end if; end;
  insert into ashby_send_checks values('uncertain_attempt_never_reopens_or_delegates',true);
end $check$;

do $check$
begin
  assert not has_function_privilege('anon','public.request_application_send(uuid,uuid)','execute'), 'anonymous request denied';
  assert has_function_privilege('authenticated','public.request_application_send(uuid,uuid)','execute'), 'candidate request allowed';
  assert not has_function_privilege('authenticated','public.delegate_ready_send_intents(uuid,integer)','execute'), 'candidate cannot sweep';
  assert has_function_privilege('service_role','public.delegate_ready_send_intents(uuid,integer)','execute'), 'worker sweep allowed';
  assert not has_function_privilege('authenticated','private.is_supported_autopilot_destination(text)','execute'), 'private predicate not exposed';
  insert into ashby_send_checks values('request_and_worker_privileges_unchanged',true);
end $check$;

select check_name,passed from ashby_send_checks order by check_name;
rollback;
