-- Read-only assertions after application_kit_combined_pdf. No candidate rows or
-- provider calls. Run in BEGIN ... ROLLBACK with the migration owner role.
do $acceptance$
declare
  v_four jsonb;
  v_five jsonb;
  v_policy jsonb;
  v_role text;
  v_signature text;
  v_definition text;
begin
  select jsonb_agg(jsonb_build_object(
    'variant',variant,'kind',case when variant like 'RESUME%' then 'RESUME' else 'COVER_LETTER' end,
    'display_name',variant||case when variant like '%PDF' then '.pdf' else '.docx' end,
    'storage_bucket','application-artifacts','storage_object_path','synthetic/'||variant,
    'mime_type',case when variant like '%PDF' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' end,
    'byte_size',1000,'sha256',repeat('a',64),'renderer_release','synthetic/1','qa_status','PASSED'
  )) into v_four from unnest(array['RESUME_PDF','RESUME_DOCX','COVER_LETTER_PDF','COVER_LETTER_DOCX']) variant;
  v_five := v_four || jsonb_build_array(jsonb_build_object('variant','APPLICATION_PDF','kind','OTHER',
    'display_name','Synthetic Application.pdf','storage_bucket','application-artifacts','storage_object_path','synthetic/application.pdf',
    'mime_type','application/pdf','byte_size',1000,'sha256',repeat('b',64),'renderer_release','synthetic/1','qa_status','PASSED'));
  if not private.application_kit_artifact_set_valid(v_four,'application-kit/2') then raise exception 'KIT_ACCEPTANCE_LEGACY_FOUR_REJECTED'; end if;
  if not private.application_kit_artifact_set_valid(v_five,'application-kit/3') then raise exception 'KIT_ACCEPTANCE_NEW_FIVE_REJECTED'; end if;
  if private.application_kit_artifact_set_valid(v_four,'application-kit/3')
    or private.application_kit_artifact_set_valid(v_five,'application-kit/2') then raise exception 'KIT_ACCEPTANCE_RELEASE_ARTIFACT_SET_MISMATCH'; end if;
  if private.application_kit_variants_valid(jsonb_set(v_five,'{4,variant}','"UNEXPECTED"'),'application-kit/3')
    or private.application_kit_variants_valid(jsonb_set(v_five,'{4,variant}','"RESUME_PDF"'),'application-kit/3') then raise exception 'KIT_ACCEPTANCE_WRONG_FIFTH_VARIANT'; end if;
  if private.application_kit_artifact_set_valid(v_five || (v_five->0),'application-kit/3') then raise exception 'KIT_ACCEPTANCE_DUPLICATE_ALLOWED'; end if;
  if private.application_kit_artifact_set_valid(jsonb_set(v_five,'{4,kind}','"RESUME"'),'application-kit/3') then raise exception 'KIT_ACCEPTANCE_COMBINED_WRONG_KIND'; end if;
  if private.application_kit_artifact_set_valid(jsonb_set(v_five,'{4,mime_type}','"text/plain"'),'application-kit/3') then raise exception 'KIT_ACCEPTANCE_COMBINED_WRONG_MEDIA'; end if;
  if private.application_kit_artifact_set_valid(jsonb_set(v_five,'{4,sha256}','null'),'application-kit/3') then raise exception 'KIT_ACCEPTANCE_NULL_HASH_ALLOWED'; end if;
  if private.application_kit_artifact_set_valid(jsonb_set(v_five,'{4,byte_size}','"not-a-number"'),'application-kit/3') then raise exception 'KIT_ACCEPTANCE_INVALID_SIZE_ALLOWED'; end if;
  if private.application_kit_artifact_set_valid(null,'application-kit/3')
    or private.application_kit_artifact_set_valid('{}','application-kit/3') then raise exception 'KIT_ACCEPTANCE_NON_ARRAY_ALLOWED'; end if;
  select jsonb_build_object('release','owned-writing/1','sha256',repeat('a',64),'documents',jsonb_agg(jsonb_build_object('name',name,'sha256',repeat('b',64))))
    into v_policy from unnest(array['evidence.md','resume.md','cover-letter.md','voice.md','quality.md']) name;
  if not private.application_writing_provenance_valid(v_policy) then raise exception 'KIT_ACCEPTANCE_POLICY_REJECTED'; end if;
  if private.application_writing_provenance_valid(v_policy-'sha256')
    or private.application_writing_provenance_valid(jsonb_set(v_policy,'{documents,0,name}','"../../outside.md"'))
    or private.application_writing_provenance_valid(jsonb_set(v_policy,'{documents,0,sha256}','"bad"'))
    or private.application_writing_provenance_valid(jsonb_set(v_policy,'{documents}','[]')) then raise exception 'KIT_ACCEPTANCE_INVALID_PROVENANCE_ALLOWED'; end if;
  foreach v_signature in array array['private.application_kit_variants_valid(jsonb,text)','private.application_kit_artifact_set_valid(jsonb,text)','private.application_writing_provenance_valid(jsonb)'] loop
    if not has_function_privilege('service_role',v_signature,'EXECUTE') then raise exception 'KIT_ACCEPTANCE_SERVICE_GRANT_MISSING'; end if;
    foreach v_role in array array['anon','authenticated'] loop
      if has_function_privilege(v_role,v_signature,'EXECUTE') then raise exception 'KIT_ACCEPTANCE_POLICY_HELPER_EXPOSED'; end if;
    end loop;
  end loop;
  select pg_get_functiondef('public.authorize_application_fill_once(uuid,uuid,bigint,uuid,text)'::regprocedure) into v_definition;
  if position('private.application_kit_variants_valid' in v_definition)=0
    or position('work_authorization.us.authorized' in v_definition)=0
    or position('work_authorization.us.sponsorship_required' in v_definition)=0
    or position('work_authorization.ca.authorized' in v_definition)=0
    or position('work_authorization.ca.sponsorship_required' in v_definition)=0
    or position('fact.sensitivity = ''SENSITIVE''' in v_definition)=0
    or position('version.candidate_disposition = ''APPROVED''' in v_definition)=0
    or position('fact.verification_status = ''VERIFIED''' in v_definition)=0
    or position('fact.usage_policy = ''EXACT_FIELDS''' in v_definition)=0
  then raise exception 'KIT_ACCEPTANCE_FILL_DISCLOSURE_HARDENING_LOST'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.approval_challenges'::regclass
    and tgname='approval_challenges_reject_stale_candidate_inputs' and tgenabled='O'
    and tgfoid='private.reject_stale_application_fill_authorization()'::regprocedure)
    or position('application_input_version' in pg_get_functiondef('private.reject_stale_application_fill_authorization()'::regprocedure))=0
  then raise exception 'KIT_ACCEPTANCE_FILL_FRESHNESS_GUARD_LOST'; end if;
  select pg_get_functiondef('public.commit_application_kit(uuid,text,uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,jsonb,jsonb,text,jsonb,uuid[],jsonb)'::regprocedure) into v_definition;
  if position('private.commit_application_kit_single_revision_v1' in v_definition)=0
    or position('v_candidate.application_input_version' in v_definition)=0
  then raise exception 'KIT_ACCEPTANCE_COMMIT_REFRESH_WRAPPER_LOST'; end if;
end;
$acceptance$;
select 'application-kit/3: legacy compatibility, five-artifact contract, content provenance, and helper ACLs passed' as acceptance;
