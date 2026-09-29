-- RoleDawn / HireWire: new PASSED revisions must carry the exact quality
-- release and a review-ready report. Historical application-kit/1 revisions
-- remain readable; this trigger applies only to newly inserted revisions.

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
begin
  if new.validation_status = 'PASSED' and (
    v_manifest_release is distinct from 'application-kit/2'
    or v_writing_policy_release is distinct from 'roledawn-writing-policy/2'
    or new.packet_manifest #>> '{validation,quality,evaluatorRelease}'
      is distinct from 'roledawn-application-quality-evaluator/1'
    or v_quality_policy_release is distinct from v_writing_policy_release
    or new.packet_manifest #>> '{validation,quality,readyForCandidateReview}'
      is distinct from 'true'
    or not coalesce(v_quality_status = any(array['PASSED', 'PASSED_WITH_WARNINGS']), false)
    or jsonb_typeof(new.packet_manifest #> '{validation,quality,measurements}')
      is distinct from 'object'
    or jsonb_typeof(new.packet_manifest #> '{validation,quality,issues}')
      is distinct from 'array'
  ) then
    raise exception 'APPLICATION_REVISION_QUALITY_MANIFEST_INVALID'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_application_revision_quality_manifest() from public;
revoke all on function private.enforce_application_revision_quality_manifest() from anon;
revoke all on function private.enforce_application_revision_quality_manifest() from authenticated;

drop trigger if exists application_revisions_quality_manifest_guard
  on public.application_revisions;
create trigger application_revisions_quality_manifest_guard
before insert on public.application_revisions
for each row execute function private.enforce_application_revision_quality_manifest();
