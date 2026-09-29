-- Cover the server-owned plan relationship before account enrollment grows.
create index candidate_auto_apply_plan_reference on public.candidate_auto_apply_settings(plan_key);
