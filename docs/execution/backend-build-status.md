---
title: Backend build status
status: active implementation record
owner: engineering
last_updated: 2026-09-16
---

# Backend build status

This file is the operational recovery point for the Supabase-backed HireWire
development control plane. It distinguishes repository evidence from hosted
evidence. The [architecture operating model](../architecture/backend-operating-model.md)
remains the long-range design authority.

The [three-system product architecture](../architecture/three-system-product-architecture.md)
is the product ownership and sequencing authority. In short: Career Vault and
candidate answers belong to Candidate Intelligence; the catalog and matching
belong to Opportunity Intelligence; Application Kits, packet preparation,
execution, and proof belong to Application Delivery.

Use [architecture at a glance](../architecture/architecture-at-a-glance.md) for
the presentation-ready component map, stack, data flow, assumptions, and build
order.

## Current hosted pilot — 2026-09-16

The current implementation includes 25 reviewed catalog sources, daily refresh leases, progressive job browsing, named-application delegation and receipt handling, profession-neutral policy files, one bounded drafting repair with actual-prose verification, and authenticated direct Storage uploads. Netlify hosts the web app and worker functions; [hosting acceptance](catalog-and-hosted-workers-acceptance.md) is the authoritative deployment/activation and recovery record. [Full-stack delivery acceptance](application-autopilot-acceptance.md) proves one synthetic receipt and complete cleanup; [writing acceptance](application-writing-repair-acceptance.md) records both accepted and blocked cases. No employer submission was made.

The August snapshots below are historical, including their empty submission tables, source counts and deployment status. Only migrations added in this September change were aligned to their new hosted timestamps; pre-existing historical filename differences were not silently rewritten.

## Historical live recheck — 2026-08-18

The HireWire project is healthy on PostgreSQL 17. All 45 checked-in migrations
are present in the hosted ledger. The latest deployed sequence adds release-2
application-quality enforcement, candidate onboarding/search profiles, the
corrected résumé readiness gate, the service-only Browserbase Live View
binding, retained-runtime release reconciliation, and stale Application Kit
refresh. Local and hosted migration ledgers align.

The live founder state includes one persistent reviewed résumé and 12 approved
narrative-evidence versions. After a candidate input change made the historical
packet stale, the deployed refresh path created a new immutable Application
Input Snapshot and current release-2 revision with the input epoch matched.
The worker committed an official-posting research bundle and exactly four
private QA-passed artifacts after the strict OpenAI claim/citation schema was
corrected. Submit-attempt and receipt tables remain empty.
Deterministic input freeze, official-posting research, Terra drafting,
deterministic and semantic validation, exact-fact merge, PDF/DOCX rendering,
atomic persistence, and candidate downloads are connected. A long-running
worker service with independent catalog, preparation, kit, and fill lanes now
exists and passed a live local health run against HireWire. It is not deployed.
Candidate search preferences and deterministic fit reasons are connected. No
broader company research, completed real ATS fill, or employer submission
exists. The process-owned retained-runtime supervisor and service-only release
reconciliation are deployed. A controlled Browserbase fixture filled eight
reviewed fields and uploaded two private hash-verified PDFs. A separate
UI-to-database run opened the public Anthropic Greenhouse form and failed closed
at `TAKEOVER` before disclosure when it found two required protected/legal
fields. The provider session then became terminal and the database reconciled
the computer session to `FAILED_SAFE` because release telemetry was uncertain.

The post-migration advisors still report intentional deny-all RLS notices,
authenticated `SECURITY DEFINER` warnings that need function-by-function
production disposition, the hosted Auth password-protection warning, unused
indexes on the low-traffic development project, and the Auth connection-
strategy advisory. This is not production sign-off.

## Repository checkpoint

| Capability | Repository state | End-to-end state |
|---|---|---|
| Supabase SSR Auth | Implemented | Two normal hosted sessions verified in run `20260812135034` |
| Google OAuth | Safe redirect/callback policy, conditional login UI, and hosted-provider check implemented | Hosted provider is off pending founder acceptance of Google's User Data Policy and creation of OAuth credentials |
| Guided onboarding | Four resumable steps, candidate search goals, database readiness function, and replay-safe activation | Desktop and 390 px flows verified; a fresh-user cross-device acceptance remains open |
| Persistent Queue | Implemented with RLS-scoped reads | Hosted self-tenancy and cross-tenant denial verified |
| Pasted-link command | Implemented as identity-derived transactional RPC | Command replay, mismatch rejection, and same-URL dedup verified |
| Application detail | Implemented as a database-backed candidate route | Hosted aggregate/read-model invariants verified |
| Career Vault résumé intake | Private candidate-owned source, deterministic PDF/DOCX transcription, review/edit, replacement, persistence across reload, and deletion implemented | Two-user acceptance passed; candidate-specific source/version RLS is deployed and the current integrity audit found no inconsistency |
| Candidate-reviewed answers | Exact-field candidate attestation, candidate-self RLS, immutable versions, and optimistic command implemented | Hosted 13-checkpoint regression acceptance plus cleanup passed in run `20260816235136` |
| Source-linked résumé evidence | Deterministic exact passages, immutable cited review versions, and candidate approve/edit/reject/use controls at `/vault/facts` | Hosted acceptance passed; founder dogfood has 12 approved and five review-pending `resume-passages/2` items; no reusable Candidate Evidence Snapshot |
| Foundation schema | Forward-only migrations through candidate-specific résumé RLS, release-2 Application Kit quality, onboarding, fill-only authority, computer sessions/checkpoints, leases, FK coverage, default-deny grants, service-only Live View binding, retained-runtime release reconciliation, and stale-packet refresh | All 45 checked-in migrations are deployed to HireWire |
| FK indexes and worker commands | Implemented | Deployed and exercised in hosted acceptance |
| Official-link resolver | Fixed-origin Greenhouse, Lever, and Ashby implementation | One live official-source resolution verified |
| One-shot worker | Lease, capped retry, dead-letter, acknowledgment, catalog write, and intake transition | Hosted claim and completion verified; support-only inspect/requeue verified |
| Catalog poller | One-source lease, fixed-origin fetch, complete-snapshot commit, ETag reuse, closure guard, failure record, and independent worker-service lane | Latest live worker run observed 464 open jobs and returned to idle; the service is not hosted |
| Search and Saved | Candidate-safe catalog projection, opaque cursor pages of 24, private save command, replay-safe queueing, and deterministic fit labels/reasons from search preferences plus verified eligibility | Hosted candidate boundary passed; fit is advisory/read-time and source coverage remains one company |
| Application Input Snapshot | Immutable job/candidate/policy manifest, candidate input epoch, evidence/fact reference tables, source-deletion invalidation, and candidate-self RLS | Blocked/retry controls plus one ready founder snapshot are verified; the snapshot grants no authority and now anchors the accepted revision |
| Preparation preflight | Leased claim/commit, typed blockers, candidate retry, exact replay, stale-version conflict, semantic events, latest-run-bound UI projection, and drafting handoff | Latest run reached `READY_FOR_DRAFTING`; its drafting message was consumed and published after durable commit |
| Research and drafting context | Exact-snapshot reader, official-posting research, provider-safe projection, structurally consistent claim/citation schema, strict parser, RoleDawn writing policy, Terra adapter, deterministic checks, separate semantic-entailment gate, and exact-fact merge | The refreshed hosted revision passed after claim type and citation source were tied structurally; failures expose issue codes rather than provider content |
| Application packet | Two-stage immutable domain contract, stale-input rejection and refresh, deterministic PDF/DOCX rendering, private Storage staging, byte QA, atomic persistence, signed candidate downloads, and material-change review | Current revision v2 matches the candidate input epoch and has exactly four private `PASSED` artifacts; the prior packet remains immutable history |
| Fill authorization | Revision-bound `FILL_APPLICATION_ONCE`, disclosure/artifact manifests, one-time consumption, action-scoped foreign keys, fill attempts, sessions, private provider refs, and checkpoints | Hosted rollback acceptance passed; fill authority cannot back a submit attempt |
| Worker service | Independent catalog, preparation, kit, and fill lanes, busy/idle cadence, capped backoff, health endpoints, redacted logs, and graceful stop | `/live`, `/ready`, and `/health` passed against hosted HireWire; a regression test requires lane stop and retained-runtime reconciliation before entrypoint exit; no deployment or alerting yet |
| Fill execution worker | Exact service-only fact/artifact materializer, provider-neutral coordinator, mandatory origin/submit guard, database-session idempotency, process-owned retained-runtime supervisor, awaited release reconciliation, leases, fail-safe recovery, and candidate-owned Live View lookup | Controlled cloud fill passed 8 fields/2 uploads. The real Anthropic form reached zero-disclosure `TAKEOVER`; terminal uncertain telemetry reconciled the session `FAILED_SAFE`. Candidate intervention and a completed real form remain open |
| Submission and proof | Separate `SUBMIT_APPLICATION_ONCE` design plus pre-existing attempt/receipt schema | Not connected; no submit, confirmation, reconciliation, or receipt runtime |

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
accepted hosted foundation is forward-only; compare exact local and remote
version names before every deployment. The accepted Milestone 0 run
remains evidence only for its original scope; the separate Career Vault,
candidate-profile, and 2026-08-16 checkpoints below cover later behavior.

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

**Verified founder dogfood:** the selected Phoebe résumé PDF is `READY` after a
one-page deterministic extraction of 3,353 normalized characters with zero
warnings and one immutable reviewed-text version. The source remains correctly
recorded as `NOT_SCANNED`; this is development evidence, not public-upload
acceptance. Candidate, active legal-name fact, workspace, and Auth display
labels are internally aligned without reproducing their values here.

**Verified persistence hardening:** hosted migration
`20260817044053_harden_resume_candidate_scope` requires candidate-self access
for logical résumé sources and versions. Server reads and deletion preflight
also bind the active workspace and candidate. The current hosted audit found
one candidate, one logical résumé, one version, and zero duplicates, orphans,
broken current selections, missing review, missing Storage, or inconsistent
finalization. An authenticated `/vault` reload showed the same reviewed v1
filename and text.

## Hosted candidate-profile checkpoint

**Implemented:** `/vault/answers` appends candidate-attested exact-field
versions for legal name, contact, city/region/country, and separate U.S./Canada
authorization and sponsorship. The save command owns its key allowlist,
sensitivity, usage policy, tenancy, optimistic lock, and replay behavior.
Candidate facts, versions, and sources use candidate-self RLS. **I'm not sure**
remains `NEEDS_REVIEW` and cannot be resolved by a model.

**Verified live:** regression run `20260816235136` passed all 13 required
checkpoints and cleanup against the then-current 24-migration baseline. It proved
anonymous and direct-write denial, two ordinary personal candidates, stable
replay, mismatched replay rejection, canonical policy, candidate-self and
cross-tenant RLS, append-only updates, explicit non-retryable `PT409`
stale-write denial, unresolved sensitive answers, immutable versions, exact
service accounting, and cleanup.

The preserved checkpoint list, safety gates, correction history, and rerun
triggers are in the
[candidate-profile acceptance record](candidate-profile-hosted-acceptance.md).

## Candidate evidence checkpoint

**Implemented:** the latest candidate-reviewed résumé text is segmented
deterministically into immutable exact passages with stable offsets and hashes.
`/vault/facts` exposes every item with its exact source excerpt. A candidate can
approve the source wording, make an attested edit, reject it, or restrict reuse
to résumé-and-cover-letter, cover-letter-only, or private. Reviews append
immutable versions and citations, use optimistic `PT409` conflict handling,
and emit typed domain events. Exact application answers remain in the separate
candidate-fact authority.

**Verified live:** run `20260816235101` passed all 10 required checkpoints plus
cleanup. It proved two real candidates, a reviewed résumé source,
deterministic proposal ingestion, stable replay, two-user isolation,
direct-write denial, candidate review, edit attestation, explicit stale-write
denial, and immutable history with citations. Cleanup exercised the deployed
`include_candidate_evidence_in_document_purge` migration: exact-document
candidate-requested deletion now removes passages, items, versions, and
citations while ordinary direct mutation remains blocked. Deterministic
Candidate Evidence Snapshot assembly, story development, voice policy, and
retrieval remain open.

**Verified founder dogfood:** segmenter `resume-passages/2` produced 17 exact,
source-linked items from the reviewed résumé. Twelve are `VERIFIED` for allowed
narrative use and five remain `NEEDS_REVIEW`; none is rejected. The approved set
contains one education item and 11 experience items. Three experience items plus
the summary and skills items remain in review. This selective outcome is the
desired fail-closed behavior; extraction did not silently become blanket
approval.

## Opportunity catalog checkpoint

**Implemented:** a service-owned lane leases one due allowlisted source,
fetches through fixed provider origins, requires a complete normalized snapshot
before applying closure, stores source/run/observation and immutable job-version
data, and persists ETags. Authenticated Search/Saved reads expose a candidate-
safe projection in opaque cursor pages of 24. Save/remove/queue commands derive
the candidate from `auth.uid()`; queueing records preparation intent only.
Search and Saved also read candidate search goals plus verified work-
authorization facts and calculate a deterministic fit label with plain reasons.

**Verified live:** `opportunity_catalog_commands` is deployed. Anthropic is the
only allowlisted tenant. The 2026-08-18 worker-service proof completed a fresh
Greenhouse poll with 464 observations. The hosted catalog now has 480 jobs, 464
open jobs, and 492 immutable versions. Earlier conditional acceptance completed
with HTTP 304 and `not_modified: true`. The long-running service is not hosted,
and no broader source allowlist is deployed.

**Verified candidate boundary:** run `20260816235350` passed all 12 required
checkpoints plus cleanup. It proved anonymous denial, the allowlisted fixture,
two real candidates, search/filter behavior, save replay and removal,
stale-version denial, replay-safe queueing, preparation-only authority,
candidate isolation, direct table/raw-column denial, and that candidate actions
left the shared catalog byte-for-byte unchanged.

## Application preparation checkpoint

**Implemented:** `application_input_snapshots` freezes the exact job version,
candidate input epoch, reviewed résumé hashes, approved narrative-evidence
version references, approved exact-fact version references, tailoring mode,
submission mode, and policy releases used by one preparation run. Snapshot rows
and their reference rows are immutable. Candidate-input mutations advance an
epoch; commit locks and rechecks that epoch plus the current eligible versions
before publishing a drafting handoff. Exact fact values are referenced, not
copied into the snapshot manifest or narrative model context.

The worker records `READY_FOR_DRAFTING` or a typed blocker. Current blockers are
`RESUME_REQUIRED`, `RESUME_REVIEW_REQUIRED`, and
`EVIDENCE_REVIEW_REQUIRED`. Retry creates a new run and snapshot; command replay
returns the original run, and a stale expected application version fails with
`PT409`.

**Verified live:** the initial authorized worker run claimed and completed
preparation run `35fa282c-4c2a-4cb4-929f-7fef96de056f` for application
`681215c7-0d80-4420-ba13-c4af20296c0d`, committing snapshot
`a0238d65-4740-465c-80e7-65a8b3c882e1` as `BLOCKED / RESUME_REQUIRED`.
Retry command `2db7c97e-8f2d-43aa-9f52-c25ddc00f8b1` created run
`b73713de-6a01-4e51-a7a4-b05ad4e9546b` at application aggregate version `4`;
the same command replay returned that run and version. A second worker run
claimed and completed one message, committing snapshot
`bcfa61e7-e159-46f0-9567-62b14db8220d` with the same deterministic hash and
same blocker. The application ended `NEEDS_USER` at aggregate version `5`. A
new retry command using stale expected version `3` failed with `PT409
APPLICATION_VERSION_MISMATCH`.

After the founder résumé/evidence review, preparation run
`559ec07c-5193-4fda-b3a7-a68be103095b` committed snapshot
`a6a98e45-305b-496f-bd46-754b870a2a4b` as `READY_FOR_DRAFTING` with zero
blockers, 12 approved evidence refs, and one approved fact ref. The application
is `DRAFTING` at aggregate version `7`; the run is `WAITING` at
`INPUTS_READY`. The Application Kit worker later completed this run, published
the drafting message on delivery attempt two, and advanced the application to
`READY` with one revision and four artifacts. Approval, attempt, and receipt
counts remain zero.

This checkpoint accepts input freeze, blocker persistence, retry replay, stale-
version denial, and the ready drafting-request seam.

## Drafting foundation checkpoint

The repository now verifies the exact snapshot before creating a provider-safe
request. Only approved narrative evidence and frozen job context cross that
boundary; candidate identity, exact facts, raw résumé text, and internal source
IDs do not. The research and drafting parsers reject unknown fields, malformed
citations, unsupported enums, and incomplete output. Deterministic validation
cannot mark a proposal publishable until semantic entailment runs separately.

**Verified live:** migration
`20260817025617_drafting_research_and_revision_provenance` is deployed. A
rollback-only transaction inserted one valid research bundle, one revision, and
12 revision-evidence references against the founder snapshot, rejected an
invalid snapshot hash, rolled the valid rows back, and ended with counts
`0 / 0 / 0`. All four revision-provenance columns are `NOT NULL`. See
[the acceptance record](application-drafting-foundation-hosted-acceptance.md).

This checkpoint accepted the earlier schema, exact-snapshot context, and
provenance contracts. A separate local acceptance called the Terra adapter and
produced a proposal with zero deterministic issues; it left semantic
entailment as `REQUIRED_NOT_RUN`, did not acknowledge the event, and wrote no
hosted row. The later Application Kit checkpoint below supersedes those limits
for the no-submit path. See
[the local Terra acceptance](live-terra-drafting-acceptance.md).

## Hosted no-submit Application Kit checkpoint

**Implemented:** the leased worker revalidates one immutable Application Input
Snapshot, builds official-posting research, calls the bounded Terra adapter,
runs deterministic and separate semantic-entailment gates, merges exact
candidate-attested facts outside the model, renders résumé and cover-letter
PDF/DOCX, verifies bytes and hashes, stages them in private Storage, and commits
the research bundle, revision, provenance, and artifact rows atomically before
publishing the outbox message.

**Verified live:** application `681215c7-0d80-4420-ba13-c4af20296c0d`
retains historical revision `8e3c1680-39f7-4211-9157-f04582bdeaed`. The
deployed stale-packet refresh path subsequently produced current revision v2
with its candidate input epoch matched and exactly four private `PASSED`
artifacts. The strict OpenAI claim/citation schema correction was required
before the refresh could commit. Browser QA renders all four current downloads
and the explicit no-submit statement. Submit-attempt and receipt counts remain
zero. See the
[Application Kit hosted acceptance](application-kit-hosted-acceptance.md).

## Fill-to-review foundation checkpoint

**Verified hosted control plane:** the rollback-only harness consumed one
revision-bound `FILL_APPLICATION_ONCE` authority, reserved and activated one
computer session, completed it as `FILLED_TO_REVIEW`, destroyed the session,
and moved the test application to `PRE_SUBMIT_REVIEW`. It proved stable replay,
candidate RLS, private provider-reference denial, immutable checkpoints,
cross-candidate isolation, source-deletion guards, and zero submit attempts or
receipts. A separate crash drill reclaimed stale `PROVISIONING` with the
original session ID and replayed reservation; stale `ACTIVE` returned
`FAIL_SAFE_DISCLOSURE_POSSIBLE` and was not re-driven. It used one session,
wrote two recovery checkpoints, and created zero submit attempts or receipts.
Every test row rolled back. Later founder no-submit runs created durable
fill/session history, described below, without a submit attempt or receipt.

**Implemented and locally tested:**

- service-only materialization reads only the authorized fact versions and four
  private artifacts, then verifies policy, metadata, bytes, and hashes;
- `BrowserSessionBroker` provisioning uses the database session UUID as the
  provider idempotency key and requires an origin allowlist plus submit-network
  block;
- the driver has no Submit method and terminal output contains only redacted
  read-back and usage evidence;
- clean ephemeral sessions are the implemented default; candidate-scoped
  persistent context exists only as provider-neutral policy and currently
  fails closed in Browserbase until an internal browser-profile record can map
  to a provider context;
- stale provisioning may recover only the same session; active or disclosure-
  possible work fails safe after lease expiry; and
- a real local Chrome synthetic-ATS test filled fields, uploaded a PDF, left a
  sensitive answer blank, and observed zero submission requests.

The Browserbase adapter, deterministic Greenhouse-style no-submit driver, and
`worker:fill` composition preserve the explicit server-only gate. A controlled
Greenhouse-shaped Browserbase run filled and read back eight reviewed ordinary
fields, uploaded the two private hash-verified PDFs, kept Submit disabled, and
reported zero outbound submission requests. A later actual
UI-to-database-to-Browserbase run opened the public Anthropic Greenhouse form.
Preflight found two required protected/legal fields and returned `TAKEOVER`
before any disclosure: zero fields, zero uploads, zero outbound submission
requests, no submission attempt, and no receipt. When the provider session
became terminal, uncertain release telemetry reconciled the computer session to
`FAILED_SAFE` while preserving the candidate-facing takeover state. See the
[fill-to-review acceptance](application-fill-foundation-acceptance.md) and
[Browserbase live no-submit acceptance](browserbase-live-acceptance.md).

## Remaining product blockers

- Resume malware scanning, quarantine, isolated parsing, OCR, Candidate
  Evidence Snapshot assembly, story/voice development, retention scheduling,
  and export are not implemented. Current source versions remain `NOT_SCANNED`.
- Catalog scheduling, wider reviewed source coverage, watchlists,
  deterministic eligibility, recommendation runs, and match scores are not
  implemented.
- Recurring drafting scheduling, broader company research, a richer candidate
  material-diff review, and renderer-v2 PDF/DOCX visual parity are not
  implemented. One official-posting research, semantic validation, atomic
  revision, private artifact, and candidate-download path is live.
- A credential-gated Browserbase adapter and deterministic Greenhouse-style
  no-submit driver exist. Controlled fill and real-form fail-closed preflight
  are live-accepted; candidate intervention on protected/legal fields and a
  completed real ATS form are not.
- Fill-only approval issuance/consumption is connected to the candidate UI and
  hosted database. Final-submit approval remains a separate unconnected action.
- Submission, confirmation evidence, receipt reconciliation, and submit-side
  uncertain-state recovery remain unbuilt.

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

1. Preserve the forward-only hosted foundation by comparing exact ledger and
   filename versions before applying reviewed additions.
2. Before public upload activation, add quarantine, malware scanning, killable
   isolated parsing, and OCR fallback; add retention and export controls.
3. Schedule the accepted Application Kit worker behind bounded leases and add
   health, latency, cost, retry, and stuck-run alerts without widening research
   beyond the official posting.
4. Preserve the accepted Browserbase API-key, explicit-gate, exact-origin,
   network-guard, metadata, and teardown boundary.
5. Complete the candidate intervention for the two protected/legal questions
   that stopped the real Anthropic form, then resume the same guarded attempt.
   Separately run a non-blocked real Greenhouse form to filled read-back with
   zero submit requests before implementing final-submit authority,
   confirmation evidence, and reconciliation.
6. Unify PDF/DOCX typography in renderer v2 without weakening byte/provenance
   binding; deploy bounded catalog scheduling and source-health monitoring without
   widening the current one-tenant allowlist; separately schedule expired-upload
   cleanup and monitor stuck document states.

The `worker:once` path resolves and versions a posting or freezes and checks one
application's exact inputs. It does not research a company, draft or render
materials, fill a form, approve, or submit.

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
`20260812170337`; candidate-profile regression acceptance passed in
`20260816235136`; candidate-evidence acceptance passed in `20260816235101`;
opportunity-catalog acceptance passed in `20260816235350`; blocked and ready
Application Delivery preflights are verified; the first hosted no-submit
Application Kit refresh is accepted; the fill-only database lifecycle,
controlled eight-field/two-upload Browserbase run, real Anthropic form
fail-closed preflight, retained-runtime release, and terminal reconciliation
are accepted. A completed real ATS fill, candidate intervention, employer
submission, confirmation, and receipt are not connected.
