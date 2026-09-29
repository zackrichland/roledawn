-- RoleDawn / HireWire: default-deny future public-schema client grants.
--
-- Existing candidate RPCs keep their explicit authenticated EXECUTE grants.
-- Service tables remain RLS-enabled with no client policies. These default
-- privileges only prevent future objects owned by postgres from inheriting
-- broader anon/authenticated access than their migrations intentionally grant.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Trigger execution does not require callers to hold EXECUTE on this private
-- helper. Remove the unnecessary default grant without changing trigger use.
revoke all on function private.attach_preparation_run_to_outbox()
  from public, anon, authenticated, service_role;
