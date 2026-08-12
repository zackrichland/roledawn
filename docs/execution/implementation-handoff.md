---
title: RoleDawn implementation handoff
status: canonical build entrypoint
owner: founder, product, and engineering
last_updated: 2026-08-12
prototype_version: 0.1.0
---

# Implementation handoff

## Outcome

Build RoleDawn as a multi-tenant, event-driven career application system. The
current vertical slice is intentionally narrow: one authenticated candidate,
one persistent Queue, one pasted official job URL, one resolved catalog record,
one database-backed application detail, and one persistent résumé source in
Career Vault. It resolves preparation intent and reviewed résumé text but does
not prepare or execute an employer application.

Do not add a sample runtime, a permanent general-purpose agent/container per
candidate, or any path that lets a model authorize a side effect.

## Read first

1. [Current state](current-state.md)
2. [Backend build status](backend-build-status.md)
3. [Decision log](decision-log.md)
4. [Backend architecture operating model](../architecture/backend-operating-model.md)
5. [Frontend-to-backend contract](../architecture/frontend-backend-contract.md)
6. [Career Vault résumé intake](../architecture/career-vault-resume-intake.md)

Use specialized architecture documents only for the subsystem being changed.
Research and vendor claims are evidence, not authority.

## Executable surface

| Route | Current contract |
|---|---|
| `/` | Redirect to `/dashboard` |
| `/login` | Supabase magic-link sign-in; no sample-workspace branch |
| `/auth/confirm` | Establish a normal Supabase session |
| `/dashboard` | Authenticated RLS-scoped Queue plus pasted-link intake |
| `/applications/:applicationId` | Database-backed application detail |
| `/vault` | Private PDF/DOCX résumé source, deterministic transcription, candidate review/edit, replacement, and deletion |

Browse, Swipe, the landing experience, and browser-local sample state are not
runtime products. Career Vault is persistent. There is no candidate-facing mock data.
Deterministic fixtures and the in-memory computer-session adapter remain
isolated under test code.

## What is implemented

- Cookie-aware Supabase clients and authenticated actor validation.
- Identity-derived, replay-safe personal workspace bootstrap.
- Newest-first persistent Queue reads.
- Atomic pasted-link enqueue with command result, application, run, event, and
  outbox record.
- Persistent application detail that uses the application UUID for routing
  without displaying it as ordinary candidate copy.
- A private Career Vault source file with immutable source, extraction, and
  candidate-review versions; deterministic PDF/DOCX parsing; replacement; and
  service-completed deletion.
- Fixed-origin Greenhouse, Lever, and Ashby resolution.
- A leased one-shot resolver worker with fixed catalog identity, canonical-job
  conflict reuse only for the same source listing, aligned observation
  timestamps, and `UNSPECIFIED`-to-`UNKNOWN` work-mode persistence.
- Capped outbox retry, terminal dead-letter, support-only inspection,
  optimistic audited requeue, and terminal intake acknowledgement.
- Eighteen forward migrations through `20260812182500`, aligned with the hosted
  HireWire development ledger. Milestone 0 and Career Vault have separate
  accepted hosted runs.
- Immutable evidence-bound packet and bounded browser-session domain contracts.
- Deterministic tests plus typecheck, lint, documentation, production-build,
  and whitespace gates.

## Hosted acceptance

**Verified live:** run `20260812135034` passed against HireWire development. It
proved anonymous denial, two ordinary Auth sessions, stable workspace bootstrap,
self-tenancy, cross-tenant read denial, command replay and mismatch rejection,
canonical-URL deduplication, Queue/detail reads, bounded dead-letter recovery,
support-only requeue, one official-source worker resolution, and cleanup.

The run created no receipt and granted no submit authority. Its scope ends at a
resolved job record in the persistent Queue.

Career Vault run `20260812170337` separately passed the two-user upload,
private-path isolation, finalization, extraction, review, optimistic lock,
failed-replacement, deletion-pending reservation denial, deletion, and cleanup
sequence. Neither run proves packet generation, browser fill, or employer
submission.

## What is not connected

- Malware scanning, quarantine, isolated parsing, OCR, structured reviewed
  facts, retention-policy scheduling, or candidate export. Source versions are
  truthfully marked `NOT_SCANNED`.
- Model/company research, rendering, and artifact persistence.
- A connected packet-preparation coordinator, live browser/CUA, ATS form fill,
  takeover, approval consumption, submit, reconciliation, and external receipt
  evidence.
- Messaging, billing, analytics, account-wide export/deletion, or support
  tooling. Career Vault résumé deletion is implemented separately.

Nothing in the current application state or UI grants employer submission
authority.

## Authority model

| Concern | Authority |
|---|---|
| Identity and session | Supabase Auth user ID |
| Candidate facts, jobs, applications, approvals, attempts, receipts | PostgreSQL domain records |
| Original résumé bytes | Private Supabase Storage object selected by immutable Postgres source version |
| Résumé transcription and candidate review | Immutable Postgres extraction and review versions |
| Timers, waits, retries, and replay | Future durable workflow history |
| Consequential proof | Append-only redacted domain events and evidence |
| Provider secrets | Future credential/token broker |
| Browser-local and synthetic state | Tests only; never production authority |

## Invariants

1. PostgreSQL is the durable domain source of truth.
2. Every command authorizes the current principal and uses an idempotency key.
3. A queued application is preparation intent, not a submission.
4. Reviewed résumé text is source evidence for narrative drafting; exact facts
   come from structured candidate-approved records.
5. A model may draft but cannot grant authority, infer sensitive answers, or
   declare a side effect successful.
6. One approval binds one candidate, application, immutable packet/diff, action,
   expiry, and nonce.
7. Any material change invalidates approval.
8. One attempt identity crosses the consequential boundary at most once.
9. An uncertain outcome reconciles before any retry.
10. Confirmed requires external evidence.

## Immediate build order

### 0. Preserve the accepted foundation

- Keep migration files immutable and add forward migrations only.
- Rerun hosted Milestone 0 after changes to Auth, RLS, command replay, catalog
  identity, Queue/detail reads, or worker recovery.
- Keep the server secret out of clients, logs, artifacts, and source control.

Exit: run `20260812135034` remains a repeatable gate, not a one-time claim.

### 1. Harden reviewed evidence intake for public traffic

- **Implemented:** private PDF/DOCX upload, bounded validation, deterministic
  transcription, provenance, candidate text review, immutable versioning,
  replacement, and deletion.
- **Next:** add quarantine, malware scanning, isolated parsing, OCR fallback,
  structured fact review, retention, and export.

Exit: public-upload abuse tests prove the application process survives hostile
files, and no extracted or generated statement becomes an approved fact
silently. Hosted tenant isolation and lifecycle recovery are already accepted.

### 2. Produce one immutable no-submit packet

- Consume `application.job_resolved`.
- Capture reviewed job and a named Career Vault review snapshot.
- Add versioned research/model adapters, claim validation, no-slop evaluation,
  deterministic PDF/DOCX rendering, and artifact persistence.

Exit: one reviewable packet contains only cited facts and exact hashes.

### 3. Expose packet review and approval boundaries

- Show exact facts, sources, generated changes, unanswered questions, and the
  immutable packet hash in application detail.
- Implement approval issuance, invalidation, expiry, and one-time consumption
  as server-authorized commands.
- Keep the execution command disconnected until browser shadow mode passes.

Exit: approval is bound to one immutable application revision and cannot be
replayed against changed content.

### 4. Add browser shadow mode

- Show the immutable diff and decisions in application detail.
- Consume one server-side approval.
- Fill one Greenhouse-first fixture/live shadow session; founder retains the
  final employer click.

Exit: drift, OTP, CAPTCHA, network loss, and takeover fail safe without a second
attempt.

### 5. Build controlled application execution

- Revalidate the live form and approval immediately before the side effect.
- Execute at most one submit attempt identity.
- Capture external confirmation evidence or enter same-attempt reconciliation.

Exit: every confirmed application has evidence, and uncertain outcomes never
trigger a blind second submission.

## Release gates

| Area | Required evidence |
|---|---|
| Auth/tenancy | Anonymous denial and two-user negative RLS tests |
| Commands | Replay, payload mismatch, concurrency, and deduplication |
| Upload | Private path isolation, quarantine, malware scan, parse isolation, provenance, replacement, deletion |
| Writing | Exact-field, unsupported-claim, citation, and no-slop tests |
| Approval | Wrong user/application, edit invalidation, expiry, replay |
| Browser | Drift, takeover, network-loss, kill-switch, no duplicate submit |
| Confirmation | Every confirmed state resolves to external evidence |

## Local commands

```bash
npm test
npm run typecheck
npm run lint
npm run check:docs
npm run build
git diff --check
```

The package lock and framework versions are committed. Follow `AGENTS.md` and
the installed Next.js documentation before changing framework behavior.

## First alpha definition

The alpha is not complete until informed candidates can review sourced facts,
inspect one immutable application, approve it once, pause/cancel, take over for
human-only steps, receive externally evidenced outcomes, and export/delete their
data—with zero invented claims and zero unauthorized or duplicate submissions.
