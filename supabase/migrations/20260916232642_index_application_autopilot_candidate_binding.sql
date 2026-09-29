-- Cover the candidate/application composite foreign key for tenant deletion and lookup.
create index application_autopilots_candidate_binding_idx
  on public.application_autopilots(workspace_id,candidate_id,application_id);
