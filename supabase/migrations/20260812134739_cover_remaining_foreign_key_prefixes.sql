-- RoleDawn / HireWire: cover the remaining composite foreign-key prefixes
-- reported by the hosted database advisor after the Milestone 0 hardening pass.
-- PostgreSQL does not create indexes on referencing columns automatically.

create index if not exists candidate_job_decisions_workspace_candidate_fk_idx
  on public.candidate_job_decisions (workspace_id, candidate_id);

create index if not exists job_intakes_workspace_candidate_fk_idx
  on public.job_intakes (workspace_id, candidate_id);

create index if not exists jobs_current_version_fk_idx
  on public.jobs (id, current_version_id)
  where current_version_id is not null;

create index if not exists outbox_recovery_actions_workspace_message_fk_idx
  on public.outbox_recovery_actions (workspace_id, outbox_id);
