-- RoleDawn: cover the composite foreign keys introduced by the takeover
-- continuation and immutable application-schema releases. These indexes are
-- operational only; they do not change authority, RLS, or stored data.

create index application_fill_resume_attempts_fill_binding_idx
  on public.application_fill_resume_attempts (
    workspace_id, candidate_id, application_id, fill_attempt_id
  );

create index job_application_schema_versions_job_version_binding_idx
  on public.job_application_schema_versions (job_id, job_version_id);
