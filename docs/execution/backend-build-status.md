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
| Foundation schema | Eleven forward migrations in source | All eleven recorded in the hosted ledger |
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

Never edit or replay a migration that the remote ledger says is applied.

## Remaining product blockers

- Resume quarantine, malware scanning, parsing, candidate-reviewed facts,
  retention, export, and deletion are not implemented.
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

## Next activation sequence

1. Add quarantined resume intake and reviewed structured facts.
2. Consume `application.job_resolved` into an immutable no-submit packet.
3. Connect bounded research/model/renderer adapters and reject unsupported
   claims before artifact promotion.
4. Add a Greenhouse-first browser/CUA shadow adapter that cannot submit.
5. Implement approval consumption, one bounded submit attempt, confirmation
   evidence, and reconciliation as separate later gates.

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

All passed in the current worktree. Hosted RLS and resolver acceptance also
passed in run `20260812135034`; future schema or runtime changes must rerun the
same gate.
