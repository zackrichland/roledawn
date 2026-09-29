---
last_updated: 2026-09-16
status: implemented and verified with synthetic accounts
---

# Direct résumé upload on Netlify

**Verified — provider documentation, checked September 16, 2026.** Netlify buffered Functions requests and responses have a 6 MB payload limit. Binary request encoding can reduce the effective upload size. The previous 10 MB résumé Server Action could exceed that limit. [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/).

**Verified — provider documentation.** Supabase signed upload URLs last two hours and permit upload without further authentication. The implementation uses authenticated, insert-only private Storage uploads tied to a live reservation so cancellation, expiry, and document deletion continue to block uploads. No signed upload token is issued. [Supabase signed upload URL reference](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

**Implemented.** The browser hashes the selected PDF/DOCX, reserves that exact hash, size, type, name and candidate-owned path, then sends the bytes straight to Storage. Small authenticated commands reserve and finalize. Finalization checks ownership, downloads the object, verifies actual size, MIME, hash and document structure, extracts deterministic text, and records the existing immutable source version and extraction. Uploads remain subject to the existing 10 MB size, document parser and candidate review limits.

Retries reuse the reservation and finalization command. A browser reload can finish extraction or select the same file to resume its existing reservation. A completed extraction is returned without another write. Rejected bytes are cancelled in the database before deletion; cleanup cannot remove a finalized upload. Cancelled files whose deletion failed remain discoverable by bounded hosted maintenance. Missing files and uncertain finalization responses preserve the reservation for recovery.

## Acceptance evidence

- 22 parser/direct-upload/candidate-scope/cleanup tests passed, including actual extraction of a 7 MB DOCX; typecheck and targeted ESLint passed.
- [`direct-resume-upload-acceptance.sql`](../../scripts/direct-resume-upload-acceptance.sql) passed on isolated PGlite and on HireWire inside an explicit rollback. It checks hash binding/replay, size, candidate RLS, insert-only Storage, hash immutability, wrong-actor/wrong-hash/missing-object finalization, replay, and cancellation cleanup.
- [`run-direct-resume-upload-acceptance.ts`](../../scripts/run-direct-resume-upload-acceptance.ts) passed against real private Supabase Storage using two synthetic accounts. A document above 6 MB uploaded, downloaded, rehashed, extracted, finalized, and replayed. Cross-tenant read/upload and owner overwrite were denied. Both synthetic accounts, workspaces and the object were removed; no real candidate data changed.
- Local evidence: `artifacts/acceptance/direct-resume-ee9326fe-83db-4a8f-9f6b-37af8f5fabb3.json`. The report contains synthetic identity cleanup references, no credentials or real candidate content.

**Scope of proof.** This verifies the actual Storage and database path plus the application finalization processor. A deployed Netlify browser upload remains a separate UI acceptance check. Evidence entries derived from a résumé keep their existing review workflow; no separate evidence-file upload product was introduced.


## Hosted browser acceptance

**Verified, 2026-09-16:** a disposable synthetic account completed the actual Netlify file-chooser/upload/review flow with a 7,340,032-byte DOCX. The UI displayed its 7.0 MB source, 360 extracted characters and Needs review; Review and save advanced onboarding to Job goals with the résumé step complete. No employer submission occurred. Synthetic cleanup evidence is retained with the UI acceptance run.
