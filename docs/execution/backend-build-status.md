---
title: Backend build status
status: active implementation record
owner: engineering
last_updated: 2026-08-12
---

# Backend build status

This file is the operational recovery point for the Supabase-backed HireWire
development control plane. It distinguishes repository evidence from hosted
evidence. The [architecture operating model](../architecture/backend-operating-model.md)
remains the long-range design authority.

## Repository checkpoint

| Capability | Repository state | End-to-end state |
|---|---|---|
| Supabase SSR Auth | Implemented | Two normal hosted sessions verified in run `20260812135034` |
| Persistent Queue | Implemented with RLS-scoped reads | Hosted self-tenancy and cross-tenant denial verified |
| Pasted-link command | Implemented as identity-derived transactional RPC | Command replay, mismatch rejection, and same-URL dedup verified |
| Application detail | Implemented as a database-backed candidate route | Hosted aggregate/read-model invariants verified |
| Career Vault résumé intake | Private source, deterministic PDF/DOCX transcription, review/edit, replacement, and deletion implemented | Hosted two-user acceptance passed in run `20260812170337` |
| Foundation schema | Eighteen forward migrations in source | Hosted ledger aligned through `20260812182500`; schema lint returned no errors |
| FK indexes and worker commands | Implemented | Deployed and exercised in hosted acceptance |
| Official-link resolver | Fixed-origin Greenhouse, Lever, and Ashby implementation | One live official-source resolution verified |
| One-shot worker | Lease, capped retry, dead-letter, acknowledgment, catalog write, and intake transition | Hosted claim and completion verified; support-only inspect/requeue verified |
| Application packet | Offline immutable domain contract implemented | No model, renderer, or persistence adapter |
| Browser/CUA and submission | Contracts only | Not connected |

## Hosted foundation checkpoint

**Verified live:** run `20260812135034` completed the Milestone 0 harness against
HireWire. It exercised:

- anonymous denial and two normal authenticated sessions;
- replay-safe bootstrap, self-tenancy, application detail, and cross-tenant
  negative reads;
- command replay, mismatched replay rejection, and same-canonical-URL dedup;
- five bounded outbox claims, terminal dead-letter, support-only inspection,
  optimistic audited requeue, and no receipt creation; and
- one optional worker claim and successful official-source resolution.

All eleven local migrations were recorded in the hosted ledger before the run.
The acceptance identities and cascading tenant rows were cleaned up. Preserve
the forward-only rule for future schema changes:

1. Read the remote migration ledger.
2. Compare it with `supabase/migrations` without modifying recorded files.
3. Apply only new reviewed forward migrations.
4. Regenerate database types and rerun security/performance advisors.

Never edit or replay a migration that the remote ledger says is applied. The
repository now contains 18 forward migrations through `20260812182500`. The
accepted Milestone 0 run remains evidence only for its original scope; the
separate Career Vault run below covers the later résumé lifecycle.

## Career Vault repository checkpoint

**Implemented:**

- `/vault` requires a normal signed-in session and RLS-scoped candidate rows.
- An authenticated reservation grants one exact, tenant-scoped, non-upsert
  Storage path. Original PDF or DOCX bytes stay in the private `career-vault`
  bucket.
- Finalization records source SHA-256, byte size, media type, uploader, version,
  and `NOT_SCANNED` status. It does not claim a malware scan occurred.
- Deterministic PDF/DOCX extraction records parser release, output schema,
  source/text hashes, page count, warnings, result, and immutable text.
- The candidate can correct the transcription and save another immutable review
  version. Saving text does not create structured candidate facts.
- A replacement appends a version. A failed replacement does not replace the
  last reviewed version.
- Deletion removes the exact Storage objects before a service-only evidence
  purge. The UI can finish an already-pending deletion.

**Verified live:** Career Vault run `20260812170337` passed all 12 required
checkpoints and cleanup. It covered exact path reservation, RLS and Storage
isolation, hash-bound finalization, deterministic extraction, review,
optimistic locking, failed-replacement safety, deletion-pending reservation
denial, and deletion. The final hosted ledger contained all 18 migrations and
`supabase db lint --linked --level warning` returned no schema errors.

## Remaining product blockers

- Resume malware scanning, quarantine, isolated parsing, OCR, structured
  candidate-approved facts, retention-policy scheduling, and export are not
  implemented. Current source versions remain `NOT_SCANNED`.
- Company research, model routing, evidence-checked packet generation,
  rendering, storage promotion, and packet persistence are not implemented.
- No live browser/CUA adapter or ATS form-fill path exists.
- Approval issuance/consumption is schema and domain design, not a connected
  runtime workflow.
- Submission, confirmation evidence, receipt reconciliation, and uncertain-state
  recovery remain unbuilt.

## Historical pre-deployment probe — 2026-08-12

This read-only probe preceded deployment of the final three migrations and is
retained only as chronological evidence. Run `20260812135034` supersedes its
open findings.

Using only the configured publishable key and no user session:

- `applications`, `job_intakes`, `source_documents`,
  `application_revisions`, and `outbox` returned `401 / 42501` for reads.
- `bootstrap_personal_workspace` and `enqueue_pasted_link_application` returned
  `401 / 42501`.
- `claim_outbox_batch` and `resolve_pasted_link_intake` returned
  `404 / PGRST202` because the then-pending worker migration was not exposed.

No data was created or changed. At that point the results proved anonymous
denial and the then-current absence of worker RPCs; they did not prove signed-in
RLS isolation. The later hosted acceptance proved the deployed RPC and RLS
boundaries described above.

The local one-shot worker was also invoked without a server secret during that
earlier probe. It stopped at startup with `SUPABASE_SECRET_KEY_REQUIRED`; no
message was claimed and no hosted data was changed. The later authorized
acceptance run configured the server boundary and completed one resolver claim.

## Milestone 0 result

Milestone 0 passed in hosted run `20260812135034`. The evidence is bounded to
Auth, RLS, durable enqueue/read models, deduplication, worker lease/recovery, and
one official-source resolution. It is not evidence of resume processing,
generated application materials, browser automation, approval consumption,
submission, confirmation, or employer outcomes.

The Career Vault slice was added after Milestone 0. Keep the older result as
narrow evidence; do not reinterpret it as résumé-intake acceptance.

## Next activation sequence

1. Add quarantine, malware scanning, isolated parse, OCR fallback, structured
   fact review, retention, and export around the implemented intake.
2. Consume `application.job_resolved` and a named reviewed résumé version into
   an immutable no-submit packet.
3. Connect bounded research/model/renderer adapters and reject unsupported
   claims before artifact promotion.
4. Add a Greenhouse-first browser/CUA shadow adapter that cannot submit. Later,
   implement approval consumption, one bounded submit attempt, confirmation
   evidence, and reconciliation as separate later gates.
5. Schedule expired-upload cleanup and monitor stuck document states.

The worker resolves and versions a posting only. It does not research a company,
draft materials, fill a form, approve, or submit.

## Local gates

```bash
npm test
npm run typecheck
npm run lint
npm run check:docs
npm run build
git diff --check
```

The command set is the required local gate; report current results from the
actual run rather than carrying an older count forward. Hosted RLS and resolver
acceptance passed in run `20260812135034`; Career Vault acceptance passed in run
`20260812170337`.
