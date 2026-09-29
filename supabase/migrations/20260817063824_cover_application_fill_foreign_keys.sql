-- Cover the composite foreign keys introduced by the fill-to-review runtime.
-- These indexes keep authorization and teardown checks predictable as the
-- application, approval, session, and checkpoint tables grow.

create index application_attempts_submit_authority_fk_idx
  on public.application_attempts (
    workspace_id, approval_consumption_id, application_id, revision_id,
    approval_action
  );

create index application_fill_attempts_browser_run_fk_idx
  on public.application_fill_attempts (
    workspace_id, application_id, browser_run_id
  );

create index application_fill_attempts_approval_authority_fk_idx
  on public.application_fill_attempts (
    workspace_id, approval_consumption_id, application_id, revision_id,
    approval_action
  );

create index application_fill_checkpoints_attempt_binding_fk_idx
  on public.application_fill_checkpoints (
    workspace_id, candidate_id, application_id, fill_attempt_id
  );

create index application_fill_checkpoints_session_binding_fk_idx
  on public.application_fill_checkpoints (
    workspace_id, computer_session_id
  );

create index approval_consumptions_action_fk_idx
  on public.approval_consumptions (
    workspace_id, approval_id, application_id, revision_id, permitted_action
  );

create index computer_sessions_revision_attempt_fk_idx
  on public.computer_sessions (
    workspace_id, application_id, revision_id, fill_attempt_id
  );

create index computer_sessions_candidate_attempt_fk_idx
  on public.computer_sessions (
    workspace_id, candidate_id, application_id, fill_attempt_id
  );

