-- Tighten résumé source reads from workspace-member visibility to the
-- authenticated candidate who owns the immutable source chain. A service-role
-- worker retains its existing table privileges and RLS bypass for processing,
-- recovery, and exact-document purge.

drop policy if exists source_documents_member_select on public.source_documents;
drop policy if exists source_documents_candidate_select on public.source_documents;
create policy source_documents_candidate_select
  on public.source_documents for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = source_documents.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

drop policy if exists document_versions_member_select on public.source_document_versions;
drop policy if exists source_document_versions_candidate_select on public.source_document_versions;
create policy source_document_versions_candidate_select
  on public.source_document_versions for select to authenticated
  using (
    workspace_id in (select private.authorized_workspace_ids())
    and candidate_id in (
      select candidate.id
      from public.candidates as candidate
      where candidate.auth_user_id = (select auth.uid())
        and candidate.workspace_id = source_document_versions.workspace_id
        and candidate.status in ('ONBOARDING', 'ACTIVE', 'PAUSED')
    )
  );

grant select on public.source_documents, public.source_document_versions to authenticated;
grant all on public.source_documents, public.source_document_versions to service_role;

comment on policy source_documents_candidate_select on public.source_documents is
  'Candidate-self read policy for the logical private résumé document.';
comment on policy source_document_versions_candidate_select on public.source_document_versions is
  'Candidate-self read policy for immutable private résumé source versions.';
