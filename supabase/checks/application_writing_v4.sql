-- Local PGlite check for 20260928110000_application_writing_v4.sql.
do $$ begin
  assert private.application_drafting_attempt_history_valid('{"release":"application-drafting-repair/2","attempts":[{"attempt":1,"outcome":"REPAIR_REQUESTED","deterministicCodes":["UNSUPPORTED_NUMBER"],"styleCodes":["AI_CLICHE_PHRASE"],"unsupportedSegments":2,"coverLetterWords":312},{"attempt":2,"outcome":"FINAL","deterministicCodes":[],"styleCodes":[],"unsupportedSegments":1,"coverLetterWords":298}],"failure":"LETTER_CLAIM_UNVERIFIED"}'::jsonb), 'v2 history accepted';
  assert not private.application_drafting_attempt_history_valid('{"release":"application-drafting-repair/2","attempts":[{"attempt":1,"outcome":"FINAL","deterministicCodes":["has prose in it"],"styleCodes":[],"unsupportedSegments":0,"coverLetterWords":1}]}'::jsonb), 'prose rejected';
  assert not private.application_drafting_attempt_history_valid('{"release":"application-drafting-repair/2","attempts":[],"text":"leak"}'::jsonb), 'unknown key rejected';
  assert private.application_drafting_attempt_history_valid('{"release":"application-drafting-repair/1","attempts":[{"attempt":1,"status":"ACCEPTED","deterministicIssueCodes":[],"semanticIssueCodes":[],"qualityIssueCodes":[]}]}'::jsonb), 'v1 history still accepted';
  assert private.application_kit_variants_valid('[{"variant":"APPLICATION_PDF"},{"variant":"COVER_LETTER_DOCX"},{"variant":"COVER_LETTER_PDF"},{"variant":"RESUME_DOCX"},{"variant":"RESUME_PDF"}]'::jsonb, 'application-kit/4'), 'kit/4 variants';
  assert pg_get_functiondef('private.enforce_application_revision_quality_manifest()'::regprocedure) like '%roledawn-application-quality-evaluator/2%', 'evaluator v2 admitted';
end $$;
select 'application writing v4 checks passed' as result;
