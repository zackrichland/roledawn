-- RoleDawn / HireWire: admit application-kit/4 packets written under
-- roledawn-writing-policy/4 and checked by roledawn-application-quality-
-- evaluator/2 (per-segment sources, story evidence, company research, style
-- linting). Historical /2 and /3 packets stay valid and readable. The artifact
-- set for /4 is identical to /3.

create or replace function private.application_kit_variants_valid(p_artifacts jsonb, p_release text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_expected text[];
begin
  if jsonb_typeof(p_artifacts) is distinct from 'array' then return false; end if;
  if p_release = 'application-kit/2' then
    v_expected := array['COVER_LETTER_DOCX','COVER_LETTER_PDF','RESUME_DOCX','RESUME_PDF'];
  elsif p_release in ('application-kit/3', 'application-kit/4') then
    v_expected := array['APPLICATION_PDF','COVER_LETTER_DOCX','COVER_LETTER_PDF','RESUME_DOCX','RESUME_PDF'];
  else return false; end if;
  if jsonb_array_length(p_artifacts) <> cardinality(v_expected)
    or exists (select 1 from jsonb_array_elements(p_artifacts) item where jsonb_typeof(item) <> 'object') then return false; end if;
  return (select array_agg(item->>'variant' order by item->>'variant') from jsonb_array_elements(p_artifacts) item)
    is not distinct from v_expected;
end; $$;
revoke all on function private.application_kit_variants_valid(jsonb, text) from public, anon, authenticated;
grant execute on function private.application_kit_variants_valid(jsonb, text) to service_role;

create or replace function private.enforce_application_revision_quality_manifest()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_manifest_release text := new.packet_manifest #>> '{release}';
  v_writing_policy_release text := new.packet_manifest #>> '{drafting,writing_policy_release}';
  v_quality_policy_release text := new.packet_manifest #>> '{validation,quality,policyRelease}';
  v_quality_status text := new.packet_manifest #>> '{validation,quality,status}';
  v_evaluator_release text := new.packet_manifest #>> '{validation,quality,evaluatorRelease}';
begin
  if new.validation_status = 'PASSED' and (
    not coalesce(v_manifest_release in ('application-kit/2', 'application-kit/3', 'application-kit/4'), false)
    or (v_manifest_release in ('application-kit/3', 'application-kit/4')
      and not private.application_writing_provenance_valid(new.packet_manifest #> '{drafting,writing_policy}'))
    or not coalesce(v_writing_policy_release in ('roledawn-writing-policy/2', 'roledawn-writing-policy/3', 'roledawn-writing-policy/4'), false)
    or (v_manifest_release = 'application-kit/4' and v_writing_policy_release <> 'roledawn-writing-policy/4')
    or not coalesce(
      (v_manifest_release = 'application-kit/4' and v_evaluator_release = 'roledawn-application-quality-evaluator/2')
      or (v_manifest_release <> 'application-kit/4' and v_evaluator_release = 'roledawn-application-quality-evaluator/1'),
      false)
    or v_quality_policy_release is distinct from v_writing_policy_release
    or new.packet_manifest #>> '{validation,quality,readyForCandidateReview}' is distinct from 'true'
    or not coalesce(v_quality_status = any(array['PASSED', 'PASSED_WITH_WARNINGS']), false)
    or jsonb_typeof(new.packet_manifest #> '{validation,quality,measurements}') is distinct from 'object'
    or jsonb_typeof(new.packet_manifest #> '{validation,quality,issues}') is distinct from 'array'
  ) then
    raise exception 'APPLICATION_REVISION_QUALITY_MANIFEST_INVALID' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_application_revision_quality_manifest() from public, anon, authenticated;

-- Terminal drafting failures from the v4 writer record a redacted history:
-- up to three attempts, stable issue codes, counts only, never prose.
do $history$
declare
  v_signature regprocedure := 'private.application_drafting_attempt_history_valid(jsonb)'::regprocedure;
  v_definition text := pg_get_functiondef(v_signature);
  v_old text := 'begin
  if jsonb_typeof(p_history) is distinct from ''object'' or p_history->>''release'' is distinct from ''application-drafting-repair/1''';
  v_new text := 'begin
  if jsonb_typeof(p_history) = ''object'' and p_history->>''release'' = ''application-drafting-repair/2'' then
    if octet_length(p_history::text) > 12000
      or exists (select 1 from jsonb_object_keys(p_history) k where k not in (''release'', ''attempts'', ''failure''))
      or jsonb_typeof(p_history->''attempts'') is distinct from ''array''
      or jsonb_array_length(p_history->''attempts'') > 3
      or (p_history ? ''failure'' and not coalesce(p_history->>''failure'' ~ ''^[A-Z][A-Z0-9_]{2,119}$'', false)) then return false; end if;
    for v_attempt in select value from jsonb_array_elements(p_history->''attempts'') loop
      v_index := v_index + 1;
      if jsonb_typeof(v_attempt) is distinct from ''object''
        or exists (select 1 from jsonb_object_keys(v_attempt) k where k not in (''attempt'', ''outcome'', ''deterministicCodes'', ''styleCodes'', ''unsupportedSegments'', ''coverLetterWords''))
        or v_attempt->''attempt'' is distinct from to_jsonb(v_index)
        or coalesce(v_attempt->>''outcome'', '''') not in (''CLEAN'', ''REPAIR_REQUESTED'', ''FINAL'', ''ERROR'') then return false; end if;
      foreach v_key in array array[''deterministicCodes'', ''styleCodes''] loop
        if jsonb_typeof(v_attempt->v_key) is distinct from ''array'' or jsonb_array_length(v_attempt->v_key) > 40
          or exists (select 1 from jsonb_array_elements(v_attempt->v_key) c
            where jsonb_typeof(c) is distinct from ''string'' or not coalesce(c#>>''{}'' ~ ''^[A-Z][A-Z0-9_]{2,63}$'', false)) then return false; end if;
      end loop;
      foreach v_key in array array[''unsupportedSegments'', ''coverLetterWords''] loop
        if jsonb_typeof(v_attempt->v_key) is distinct from ''number'' or not coalesce(v_attempt->>v_key ~ ''^[0-9]{1,5}$'', false) then return false; end if;
      end loop;
    end loop;
    return true;
  end if;
  if jsonb_typeof(p_history) is distinct from ''object'' or p_history->>''release'' is distinct from ''application-drafting-repair/1''';
begin
  if position(v_old in v_definition) = 0 then
    raise exception 'APPLICATION_DRAFTING_HISTORY_PATCH_DRIFT';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$history$;
