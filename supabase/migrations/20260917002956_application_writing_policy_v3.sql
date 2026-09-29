-- Preserve historical packets while allowing the new evidence-aware 120-word
-- minimum. Existing factual, provenance, artifact, and review gates stay intact.
do $migration$
declare
  v_signature regprocedure := 'private.enforce_application_revision_quality_manifest()'::regprocedure;
  v_definition text := pg_get_functiondef(v_signature);
  v_old text := 'v_writing_policy_release is distinct from ''roledawn-writing-policy/2''';
  v_new text := 'not coalesce(v_writing_policy_release in (''roledawn-writing-policy/2'', ''roledawn-writing-policy/3''), false)';
begin
  if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old)
    or position('application_writing_provenance_valid' in v_definition) = 0
    or position('readyForCandidateReview' in v_definition) = 0
  then raise exception 'APPLICATION_WRITING_POLICY_V3_PATCH_DRIFT'; end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
