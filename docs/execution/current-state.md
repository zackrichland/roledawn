---
title: RoleDawn current state
status: canonical project snapshot
owner: founder, product, and engineering
last_updated: 2026-08-12
scope: current worktree and verified hosted Milestone 0 and Career Vault foundations
---

# Current state

RoleDawn is a trust-first career agent. The current executable product is a
persistent-only Queue for one signed-in candidate: paste a supported official
job URL, create durable preparation intent, inspect the database-backed
application record, and see an honest status. The candidate can also upload one
PDF or DOCX résumé, review or edit its extracted text, replace the source, and
delete the source plus saved text. It cannot prepare or submit a real
application packet yet, and it cannot fill or submit an employer form. The
persistent control plane, one official-source resolver run, and the Career Vault
data lifecycle are verified in the hosted HireWire development project.

## Current runtime

| Route | Implemented behavior | Boundary |
|---|---|---|
| `/` | Redirects to `/dashboard` | No public sample or landing runtime |
| `/login` | Supabase magic-link sign-in | Requires configured Supabase public values |
| `/auth/confirm` | Exchanges the one-time link for a normal session | Redirect allowlist and production origin remain open |
| `/dashboard` | Authenticated, RLS-scoped Queue and pasted-link intake | Anonymous users redirect to sign-in |
| `/applications/:applicationId` | Database-backed application detail | Uses the application UUID for routing; ordinary page copy does not display it |
| `/vault` | Private résumé upload, deterministic PDF/DOCX transcription, review/edit, replacement, and deletion | Uploaded versions remain `NOT_SCANNED`; no OCR, structured facts, or drafting consumer |

Browse, Swipe, the marketing landing experience, and the browser-local sample
workspace are not runtime destinations. Career Vault is database-backed. The
only in-memory implementation is an explicit computer-session test adapter.

## Implemented in the repository

### Persistent web slice

- Supabase SSR browser/server clients, session validation, magic-link callback,
  and an authenticated dashboard boundary.
- Replay-safe personal workspace and candidate bootstrap derived from
  `auth.uid()`.
- RLS-scoped Queue reads ordered by immutable `queued_at` descending.
- Transactional pasted-link enqueue with command deduplication, an application,
  preparation run, semantic event, and outbox message committed together.
- Persistent application detail that keeps the routing UUID out of ordinary
  candidate copy.
- Persistent Career Vault with one logical résumé per candidate, a private
  source file, deterministic transcription, candidate text review, replacement,
  and deletion.
- Fail-closed handling when authentication or the persistent backend is
  unavailable.

### Database and runtime contracts

- Eighteen forward migrations in source: identity/tenancy, shared job catalog,
  application runtime, Career Vault/packet records, foreign-key indexes, leased
  worker commands, intake-deduplication/dead-letter recovery hardening, and
  tenant-cleanup corrections, plus résumé upload reservation, extraction,
  review, and explicit evidence purge controls.
- Original PDF/DOCX bytes in the private `career-vault` Storage bucket. Immutable
  Postgres records hold source hashes and metadata, deterministic extraction
  attempts, reviewed text versions, parser/schema releases, and aggregate
  versions.
- Bounded deterministic parsing for text-based PDFs and DOCX files. Invalid,
  encrypted, mismatched, oversized, over-complex, image-only, and over-limit
  documents fail closed. OCR is not implemented.
- Fixed-origin Greenhouse, Lever, and Ashby URL parsing and normalization.
- Bounded official-source fetching, deterministic job-version hashing, safe
  unsupported-link handling, and a one-shot leased resolver worker.
- Direct-link provenance is currently embedded in the immutable normalized job
  version. Dedicated ingestion-run and source-observation rows are not yet
  written by this narrow worker.
- Immutable application-packet rules for provenance, evidence citations,
  truthful resume modes, material diffs, no-slop validation, and sensitive
  answer abstention.
- Provider-neutral immutable-packet and computer-session contracts with no
  click, upload, or submit authority.
- An in-memory computer-session adapter under `src/test-support`; it cannot
  provision a browser or enter the runtime dependency graph.

### Local verification

- 77 deterministic tests pass, including bounded PDF/DOCX extraction and hosted
  acceptance configuration guards.
- TypeScript checking, lint, production build, and whitespace checks pass.
- Local Markdown links pass the repository scan.

These local checks prove repository behavior. Hosted deployment has the
separate acceptance evidence below; neither proves employer submission or
employer outcomes.

### Hosted Milestone 0 acceptance

**Verified live:** hosted acceptance run `20260812135034` completed against the
founder-owned HireWire development project after all eleven forward migrations
were recorded. The run proved anonymous denial, two ordinary Auth sessions,
stable personal-workspace bootstrap, self-tenancy, command replay and payload
mismatch protection, candidate-plus-canonical-URL deduplication, database-backed
application detail, cross-tenant read denial, bounded outbox retry,
support-only dead-letter inspection, optimistic audited requeue, server-only
accounting, and cleanup. The optional one-shot worker claimed and completed one
official-source resolution with no worker failure.

This is proof of the persistent control plane and narrow official-source
resolver only. The run created no receipt and conferred no application-submit
authority. See the [hosted acceptance record](milestone-zero-hosted-acceptance.md).

### Hosted Career Vault acceptance

**Verified live:** run `20260812170337` completed after all 18 migrations through
`20260812182500` were present in the HireWire hosted ledger. Two ordinary Auth
sessions exercised an exact private upload reservation, cross-tenant row and
Storage denial before and after upload, source finalization, deterministic
extraction, candidate review, stale-write rejection, failed-replacement safety,
deletion-pending reservation denial, deletion, and cleanup. See the
[Career Vault acceptance record](career-vault-hosted-acceptance.md).

This verifies the current résumé data lifecycle, not malware scanning, parser
process isolation, OCR, structured facts, packet generation, browser fill, or
employer submission.

The cleanup artifact for the run is intentionally local and ignored. It records
the exact ephemeral identities required for bounded cleanup; it is not product
data or application evidence.

## Not connected

- Malware scanning, file quarantine, or isolated parsing workers. Current
  deterministic parsing occurs in the application server after bounded local
  validation and records `NOT_SCANNED` truthfully.
- OCR for scanned PDFs; structured candidate-approved facts; retention-policy
  scheduling; and candidate export.
- Model or company-research adapters, versioned prompts, artifact rendering, or
  packet persistence beyond offline contracts.
- Temporal or another durable workflow deployment.
- Live browser/CUA driver, ATS form filling, credential brokerage, takeover,
  final submit, reconciliation, or externally evidenced receipt.
- iMessage, SMS, email, push, billing, analytics, or support tooling.

Nothing in this repository can submit a real job application. An application
row records preparation intent; it is not evidence of submission.

## Next five actions

1. Put untrusted files behind quarantine, malware scanning, and an isolated
   parser worker; add OCR as a separately reviewed fallback.
2. Add structured candidate fact review, retention-policy behavior, and export.
3. Consume `application.job_resolved` plus one named reviewed résumé version to
   produce an immutable, evidence-checked no-submit packet.
4. Add a browser/CUA implementation only after that exact packet is reviewable;
   keep approval consumption, submission, receipts, and reconciliation closed.
5. Schedule the bounded expired-upload cleanup command and add operational
   alerting for stuck `UPLOADING` and `DELETION_PENDING` records.

## Truth labels

| Label | Meaning |
|---|---|
| **Implemented** | Present and locally testable in this worktree |
| **Previously recorded** | Reported by an earlier tool run; not current live proof |
| **Designed** | Documented contract without complete runtime code |
| **Not connected** | No activated end-to-end capability |
| **Verified live** | Reserved for preserved current external evidence |

The full change history for this worktree begins in the root
[changelog](../../CHANGELOG.md).
