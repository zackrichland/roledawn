---
title: RoleDawn implementation handoff
status: canonical build entrypoint
owner: founder, product, and engineering
last_updated: 2026-08-18
prototype_version: 0.1.0
---

# Implementation handoff

## Outcome

Build RoleDawn as a multi-tenant, event-driven career application system. The
current vertical slice is intentionally narrow: one authenticated founder
candidate, guided onboarding with a database readiness gate, one reviewed
Career Vault résumé, candidate-attested exact answers, source-linked evidence
review, one reviewed official catalog, deterministic fit explanations,
Search/Saved, one persistent Queue, one resolved job, and one immutable
Application Input Snapshot. The latest founder snapshot is
`READY_FOR_DRAFTING`. The hosted Application Kit worker consumed that handoff
and committed one official-posting research bundle, one current `READY`
revision, 12 evidence refs, one exact-fact ref, and exactly four private
QA-passed PDF/DOCX artifacts. Candidate downloads work. A long-running worker
service now owns independent catalog, preparation, kit, and fill lanes and
passed a live local health run; no host deploys it. Broader company research
and learned recommendation ranking are not connected. The candidate-facing
material review and single-use fill-only authority now exist, together with a
provider-neutral worker, exact execution materializer, session leases, and
recovery. A live Browserbase synthetic acceptance verified API-key project
inference, a 60-second session, Playwright CDP connection, metadata lookup,
origin and no-submit guards, explicit release, final `COMPLETED` state, and zero
outbound submission requests against `example.com`. The deterministic
Greenhouse-style driver has not filled a real ATS. Candidate-owned Live View
lookup is implemented and its service-only binding is deployed. A process-owned
runtime supervisor and awaited service-only release reconciliation now exist in
the repository; the additive migration is not deployed and no retained
candidate review/takeover run has passed. Final Submit, confirmation, and
receipt are not connected.

Do not add a sample runtime, a permanent general-purpose agent/container per
candidate, or any path that lets a model authorize a side effect.

## Read first

1. [Current state](current-state.md)
2. [Backend build status](backend-build-status.md)
3. [Decision log](decision-log.md)
4. [Three-system product architecture](../architecture/three-system-product-architecture.md)
5. [Backend architecture operating model](../architecture/backend-operating-model.md)
6. [Frontend-to-backend contract](../architecture/frontend-backend-contract.md)
7. [Career Vault résumé intake](../architecture/career-vault-resume-intake.md)
8. [Candidate-profile hosted acceptance](candidate-profile-hosted-acceptance.md)
9. [Application-drafting foundation hosted acceptance](application-drafting-foundation-hosted-acceptance.md)
10. [Live Terra drafting acceptance](live-terra-drafting-acceptance.md)
11. [Application Kit hosted acceptance](application-kit-hosted-acceptance.md)
12. [Application fill-to-review foundation acceptance](application-fill-foundation-acceptance.md)
13. [Browserbase live synthetic-session acceptance](browserbase-live-acceptance.md)

Use specialized architecture documents only for the subsystem being changed.
Research and vendor claims are evidence, not authority.

## Executable surface

| Route | Current contract |
|---|---|
| `/` | Redirect to `/dashboard` |
| `/login` | Supabase magic-link sign-in with a validated next route; Google appears only when the hosted provider is enabled |
| `/auth/confirm` | Establish a normal session, bootstrap the personal workspace/candidate, and resume the safe next route |
| `/onboarding` | Resume, job goals, exact application answers, and database-enforced activation readiness |
| `/dashboard` | Authenticated RLS-scoped Applications queue plus pasted-link intake |
| `/applications/:applicationId` | Database-backed detail with preparation state, current revision, four authenticated downloads, material changes, fill-only authority, required takeover conditions, candidate-owned live-browser link for active sessions, and explicit no-submit state |
| `/vault` | Private candidate-owned PDF/DOCX résumé source, deterministic transcription, persistent candidate review/edit, replacement, and deletion |
| `/vault/facts` | Source-linked résumé evidence with approve/edit/reject/use controls |
| `/vault/answers` | Candidate-reviewed identity, contact, location, and country-scoped work-eligibility answers |
| `/search` | Current jobs from the one allowlisted catalog source with deterministic fit reasons; save or start an application |
| `/saved` | Candidate-private saved jobs with the same fit reasons; remove or start an application |

Browse, Swipe, the landing experience, and browser-local sample state are not
runtime products. Candidate-facing Profile is persistent. There is no candidate-facing mock data.
Deterministic fixtures and the in-memory computer-session adapter remain
isolated under test code.

## What is implemented

- Cookie-aware Supabase clients and authenticated actor validation.
- Identity-derived, replay-safe personal workspace bootstrap.
- Four-step resumable onboarding, candidate search profiles, database-owned
  readiness checks, and replay-safe activation.
- Newest-first persistent Queue reads.
- Atomic pasted-link enqueue with command result, application, run, event, and
  outbox record.
- Persistent application detail that uses the application UUID for routing
  without displaying it as ordinary candidate copy.
- A private Career Vault source file with immutable source, extraction, and
  candidate-review versions; deterministic PDF/DOCX parsing; replacement; and
  service-completed deletion.
- Candidate-attested exact answers behind candidate-self RLS, canonical
  exact-field policy, immutable fact versions, optimistic locking, and command
  replay protection.
- Deterministic `resume-passages/2` source segmentation, immutable citations and
  evidence versions, candidate review controls, and candidate-input invalidation.
- Allowlisted leased catalog polling, conditional ETag reuse, immutable job
  versions, Search/Saved reads, and replay-safe queue-from-catalog commands.
- Deterministic fit classification from candidate search goals, current job
  versions, and verified work-authorization facts. Missing facts remain review
  items and no percentage is fabricated.
- Application preparation claim/commit/retry, immutable per-application input
  snapshots, typed blockers, and a canonical `application.drafting_requested`
  outbox handoff.
- An exact-snapshot drafting-context reader, provider-safe request projection,
  provider-neutral cited research contract, strict model-output parser, and
  fail-closed validation that requires a separate semantic-entailment pass.
- A server-only OpenAI Responses adapter using `gpt-5.6-terra`, strict
  Structured Outputs, no SDK-owned retries, `store: false`, and a RoleDawn-owned
  writing policy. It has both a bounded local acceptance and one hosted durable
  no-submit consumer path.
- Immutable research-bundle, revision-input, and revision-evidence provenance,
  including exact ID/hash bindings and source-purge-safe tombstones.
- A leased, replay-safe Application Kit worker that performs official-posting
  research, deterministic and semantic validation, exact-fact merge outside the
  model, deterministic résumé/cover-letter PDF/DOCX rendering, private staging,
  exact-byte QA, and atomic revision/artifact commit before acknowledgment.
- Authenticated current-revision artifact downloads through short-lived signed
  URLs, plus an explicit candidate-visible no-submit statement.
- Candidate-facing review of material résumé and cover-letter changes plus one
  revision-bound `FILL_APPLICATION_ONCE` command. The authority manifest binds
  destination, exact fact versions, artifact metadata and hashes, policy, and a
  false submission flag.
- Action-scoped fill authorization and one-time consumption, application-fill
  attempts, provider-neutral computer sessions, private provider references,
  append-only redacted checkpoints, execution leases, and fail-safe recovery.
- A service-only execution materializer that verifies authorized exact fact
  values and private artifact bytes before the no-submit driver receives them.
- A provider-neutral coordinator with no Submit method, mandatory origin and
  submit-network guards, database-session idempotency, bounded teardown, and
  redacted terminal output.
- A real local Chrome synthetic-ATS acceptance that fills and uploads, reads
  the form back, leaves sensitive uncertainty unresolved, and observes zero
  submission requests.
- A credential-gated Browserbase adapter, deterministic Greenhouse-style
  no-submit driver, and `worker:fill` composition. Startup fails before
  provider use without the explicit execution gate and server-only credentials.
- A candidate-owned Live View boundary that resolves only unexpired active or
  paused sessions, keeps provider references server-only, and validates the
  Browserbase debug URL before redirecting.
- One long-running worker service with independent catalog, preparation, kit,
  and fill lanes, capped backoff, redacted structured logs, health endpoints,
  and graceful stop. It is packaged in `Dockerfile.worker` but not deployed.
- Fixed-origin Greenhouse, Lever, and Ashby resolution.
- A leased one-shot resolver worker with fixed catalog identity, canonical-job
  conflict reuse only for the same source listing, aligned observation
  timestamps, and `UNSPECIFIED`-to-`UNKNOWN` work-mode persistence.
- Capped outbox retry, terminal dead-letter, support-only inspection,
  optimistic audited requeue, and terminal intake acknowledgement.
- A 41-entry aligned local/hosted forward-only migration history, including
  release-2 quality, onboarding, fill authority, completion, recovery lease,
  covering FK indexes, and service-only Live View binding. Compare exact
  versions before every deployment.
- Two-stage immutable evidence-bound packet and bounded browser-session domain
  contracts. The finalizer hashes rendered artifact bytes itself, recomputes
  logical evidence ledgers, and binds those values plus the renderer release.
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
sequence. Neither the Milestone 0 nor Career Vault run proves packet generation,
browser fill, or employer submission.

Candidate-profile regression run `20260816235136` separately proved anonymous and direct
write denial, two-user isolation, stable replay, mismatched replay rejection,
canonical policy, candidate-self RLS, append-only updates, non-retryable stale
conflicts, unresolved sensitive answers, immutable versions, service
accounting, and cleanup. It does not prove résumé fact extraction or packet
generation.

Candidate-evidence run `20260816235101` passed 10 checkpoints plus cleanup, and
opportunity-catalog run `20260816235350` passed 12 checkpoints plus cleanup.
Those runs accept the source-linked review boundary and current one-source
Search/Saved boundary; they do not accept a reusable Candidate Evidence
Snapshot, recommendations, match scores, drafting, or submission.

**Verified founder dogfood:** one one-page résumé extracted deterministically to
3,353 normalized characters with zero warnings and remains `NOT_SCANNED`.
Segmenter `resume-passages/2` created 17 source-linked items; 12 are approved and
five remain in review. Preparation run
`559ec07c-5193-4fda-b3a7-a68be103095b` committed snapshot
`a6a98e45-305b-496f-bd46-754b870a2a4b` as `READY_FOR_DRAFTING` with zero
blockers, 12 evidence refs, and one exact-fact ref. The Application Kit worker
completed this run and published its drafting message on delivery attempt two.
The application is now `READY` with one revision and four artifacts; approval,
attempt, and receipt counts remain zero.

Drafting-provenance migration
`20260817025617_drafting_research_and_revision_provenance` is deployed. A
rollback-only hosted acceptance inserted one valid research bundle, one
revision, and 12 exact evidence references; rejected an invalid snapshot hash;
rolled the valid rows back; and ended with no retained research or revision
rows. The exact founder snapshot also passed the provider-safe context read.
This accepts the provenance seam, not a generated draft.

**Verified locally:** the exact founder snapshot also passed one bounded Terra
drafting call. The proposal passed strict parsing and deterministic checks, but
semantic entailment stayed `REQUIRED_NOT_RUN`; at that earlier checkpoint the
event remained pending and no hosted row or employer-side action was created.
This accepts the adapter boundary only. See
[live Terra drafting acceptance](live-terra-drafting-acceptance.md).

**Verified hosted no-submit kit:** application
`681215c7-0d80-4420-ba13-c4af20296c0d` has revision
`8e3c1680-39f7-4211-9157-f04582bdeaed`, official-posting research bundle
`40df390d-2d4b-44bf-829f-f4d8b58ddf98`, 12 revision-evidence refs, one exact-
fact ref, and exactly four private `PASSED` artifacts. Attempt one failed closed
on timestamp parsing; replay succeeded without duplicates on attempt two.
Browser QA rendered all four downloads and the no-submit statement with zero
console errors. See [Application Kit hosted acceptance](application-kit-hosted-acceptance.md).

**Verified hosted fill control plane:** a rollback-only acceptance consumed one
fill-only authority, reserved and activated one computer session, completed it
as `FILLED_TO_REVIEW`, destroyed the session, and moved the test application to
`PRE_SUBMIT_REVIEW`. Replay, RLS, private provider-reference denial, immutable
checkpoints, source-deletion guards, cross-candidate isolation, and the action-
scoped block against submit attempts passed. All test rows rolled back; the
founder record remained unchanged. A separate rollback-only crash drill
reclaimed stale `PROVISIONING` with the original session ID and failed stale
`ACTIVE` safely without re-driving. It wrote two recovery checkpoints, created
zero submit attempts or receipts, and left the founder application `READY` at
aggregate version 8 with zero fill/session/submit/receipt rows.

**Verified locally:** exact fact and artifact materialization, provider
idempotency, network submit blocking, bounded teardown, stale-work recovery,
and the real-Chrome synthetic ATS passed. Desktop and mobile QA showed the
material review and fill-only UI without spending the founder authorization.
See [fill-to-review acceptance](application-fill-foundation-acceptance.md).

**Verified live against a synthetic target:** one fresh Browserbase session
connected through Playwright CDP to `example.com`, matched exactly one
RoleDawn-metadata session, enforced the DOM and network guards, reported zero
outbound submission requests, and reached `COMPLETED` after explicit release.
No candidate, employer, ATS, proxy, CAPTCHA, or recording data was involved.
See [Browserbase live acceptance](browserbase-live-acceptance.md).

## What is not connected

- Malware scanning, quarantine, isolated parsing, OCR, reusable Candidate
  Evidence Snapshot assembly, story/voice development, retention scheduling, or
  candidate export. Source versions are truthfully marked `NOT_SCANNED`.
- Recurring drafting scheduling, broader company research, a rich
  candidate-facing material diff, or renderer-v2 PDF/DOCX visual parity.
- A real ATS provider run. The Browserbase credential, cloud-session, CDP,
  guard, metadata, and teardown seam is accepted against a synthetic target;
  the Greenhouse-style no-submit driver has not opened a real ATS. Secure
  takeover, employer fill, final-submit approval consumption, reconciliation,
  and external receipt evidence are not connected.
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
| Reusable application answers | Immutable candidate-attested fact versions with exact-field policy |
| Narrative résumé evidence | Immutable source passages, cited evidence versions, candidate disposition, and use policy |
| One drafting run's exact inputs | Immutable Application Input Snapshot and reference rows |
| Research and generated revision provenance | Immutable research bundle, exact input/research hashes, and revision evidence references |
| Fill-only authority | One action-scoped approval/consumption bound to the named revision, destination, exact fact/artifact manifest, expiry, and nonce |
| Browser fill lifecycle | PostgreSQL fill attempt, computer session, execution lease, private opaque provider reference, and append-only redacted checkpoints |
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
6. Fill and Submit are separate actions. Each approval binds one candidate,
   application, immutable packet/diff, action, destination, expiry, and nonce;
   fill authority cannot become submit authority.
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

### 1. Stabilize the Candidate Intelligence handoff

- **Implemented:** private PDF/DOCX upload, bounded validation, deterministic
  transcription, provenance, candidate text review, immutable versioning,
  replacement, deletion, reviewed exact answers, v2 source passages, and
  candidate approve/edit/reject/restrict controls.
- **Verified founder slice:** 12 approved and five review-pending evidence items
  from one real reviewed résumé; one application-scoped snapshot safely bound
  those 12 approved versions.
- **Next:** seal approved versions, exact-answer refs, use policy, and explicit
  gaps into the separate reusable Candidate Evidence Snapshot; add cited story
  and voice proposals only behind candidate review.
- **Public-upload gate:** add quarantine, malware scanning, killable isolated
  parsing, OCR fallback, retention, and export before opening uploads broadly.

Exit: one candidate can create a reusable reproducible evidence snapshot in which every
narrative claim points to a reviewed source passage, exact and sensitive answers
remain candidate-attested, and no extracted or generated statement becomes
approved silently. Public-upload activation separately requires hostile-file
tests. Hosted tenant isolation and lifecycle recovery are already accepted.

### 2. Produce one immutable no-submit packet

- **Implemented:** exact-snapshot loading and hash verification, provider-safe
  context projection, cited research and drafting contracts, strict structural
  parsing, fail-closed deterministic checks, and immutable research/revision
  provenance.
- **Implemented locally:** a server-only Terra adapter records policy/model
  releases, uses strict Structured Outputs, and handles refusal/incomplete
  responses without SDK-owned retries.
- **Implemented and verified live:** official-posting research, separate
  semantic entailment, exact-fact merge, atomic research/revision/provenance
  commit, deterministic PDF/DOCX rendering, private artifact staging, exact-byte
  QA, and authenticated candidate downloads.
- **Next:** schedule the one-shot worker behind bounded leases and health/cost
  alerts; expose citations, unanswered questions, and the material diff in the
  candidate review surface; unify PDF/DOCX typography in renderer v2.

The task contracts and initial adapter now exist. Keep the provider credential
only at the server boundary; never place it in browser code, snapshot payloads,
logs, artifacts, or checked-in files.

**Exit met for one founder no-submit kit:** one reviewable packet contains cited
facts, exact hashes, and four downloadable private artifacts. This does not
grant application-submit authority.

### 3. Preserve the fill-only review and authority boundary

- **Implemented:** four exact artifacts, material résumé and cover-letter
  changes, mandatory stop conditions, destination-bound disclosure manifest,
  one-time fill authority, and explicit no-submit state in application detail.
- **Implemented:** action-scoped foreign keys keep fill authority out of the
  submit-attempt table; edits, expiry, replay, wrong owner, wrong revision, and
  manifest drift fail closed.
- **Next:** show field-level read-back and unresolved questions from the real
  browser session without exposing sensitive values in ordinary logs.

Exit met for the database boundary: fill authority is bound to one immutable
application revision and cannot be replayed against changed content. The live
provider seam is accepted against a synthetic target; real ATS execution
remains the next gate.

### 4. Activate browser shadow mode

- Preserve the accepted Browserbase API-key inference, explicit gate, origin
  and submission guards, metadata lookup, and explicit teardown.
- Preserve the deterministic Greenhouse-style no-submit driver; add a
  separately authorized secure live-view and takeover broker.
- Run one founder session through fill and read-back; the founder retains the
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
npm run dev:full
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
