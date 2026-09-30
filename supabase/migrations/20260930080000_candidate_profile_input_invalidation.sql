-- Published career/voice profiles and stories are application inputs (D-121).
-- Reuse the existing input epoch so packet freshness, submit lease checks and
-- auto-apply consent all reject documents prepared before a content change.
-- Extraction status and interview conversation updates do not change inputs.

create function private.bump_candidate_profile_application_input_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_input_version bigint;
begin
  -- Preparation may create the first derived career profile inline, after it
  -- claims the current input version. The reviewed resume already established
  -- that version. Do not cancel that first preparation's own auto-apply consent
  -- unless an existing snapshot could have frozen the absence of this profile.
  -- Serialize this test with snapshot commits, which take a candidate share lock.
  select candidate.application_input_version into strict v_input_version
  from public.candidates as candidate
  where candidate.workspace_id = new.workspace_id and candidate.id = new.candidate_id
  for update;

  if old.current_version_id is null and new.kind = 'CAREER_PROFILE'
    and exists (
      select 1 from public.candidate_profile_document_versions as version
      where version.id = new.current_version_id
        and version.workspace_id = new.workspace_id and version.candidate_id = new.candidate_id
        and version.source_kind = 'RESUME_EXTRACTION'
    ) and not exists (
      select 1 from public.application_input_snapshots as snapshot
      where snapshot.workspace_id = new.workspace_id and snapshot.candidate_id = new.candidate_id
        and snapshot.candidate_input_version = v_input_version
    ) then
    return new;
  end if;

  update public.candidates as candidate
  set application_input_version = candidate.application_input_version + 1
  where candidate.workspace_id = new.workspace_id and candidate.id = new.candidate_id;
  return new;
end;
$$;
revoke all on function private.bump_candidate_profile_application_input_version() from public, anon, authenticated;
grant execute on function private.bump_candidate_profile_application_input_version() to service_role;

create trigger candidate_profile_documents_bump_input_on_publish
  after update of current_version_id on public.candidate_profile_documents
  for each row when (new.current_version_id is distinct from old.current_version_id)
  execute function private.bump_candidate_profile_application_input_version();

create trigger candidate_profile_documents_bump_input_on_delete
  after delete on public.candidate_profile_documents
  for each row when (old.current_version_id is not null)
  execute function private.bump_candidate_application_input_version();

-- A new story starts with current_version_number = 1 before its first version
-- is inserted. Invalidate only once that version exists. Later versions publish
-- by advancing the story head, and archiving changes the head's status.
create trigger candidate_story_versions_bump_input_on_first_publish
  after insert on public.candidate_story_versions
  for each row when (new.version_number = 1)
  execute function private.bump_candidate_application_input_version();

create trigger candidate_stories_bump_input_on_publish
  after update of current_version_number, status on public.candidate_stories
  for each row when (new.current_version_number is distinct from old.current_version_number or new.status is distinct from old.status)
  execute function private.bump_candidate_application_input_version();

create trigger candidate_stories_bump_input_on_delete
  after delete on public.candidate_stories
  for each row execute function private.bump_candidate_application_input_version();
