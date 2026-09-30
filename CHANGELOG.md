# Changelog

This file records material repository changes. Product capability is described
with evidence labels; repository implementation does not imply hosted activation
or production readiness.

## 2026-09-30 — Standing answers, second confirmed application, observability

- **Verified:** second confirmed application (Carvana Strategy Analyst) with a required GPA multi-select; Gmail code read in 6 s.
- **Deployed:** React Select multi-selects read correctly in the hosted Linux browser (options carry `aria-selected` there); Linux-platform fixture test (D-113 follow-up).
- **Deployed:** standing answers (D-117). A candidate's saved answers to routine questions fill new wordings in the same pass; each automatic answer is labeled `CANDIDATE`, `REMEMBERED` or `STANDING` with its basis. Migration `20260930050000` applied to hosted and recorded.
- **Deployed:** worker events and `npm run ops:status` (`--watch`, `--app <id>`) (D-116); one-pass remembered answers (D-115); transient-stop retries (D-114). Migrations `20260930010000` to `20260930040000` applied to hosted and recorded.
- **Docs:** [founder directives](docs/execution/founder-directives.md), [ATS board templates](docs/boards/README.md), playbook updates.

## 2026-09-30 — First confirmed application and remembered answers

- **Verified:** first end-to-end confirmed application (Carvana, Greenhouse): automatic Gmail security code, receipt stored, Home shows Applied.
- **Applied to hosted:** remembered answers (D-112; migration `20260930000000`).

## 2026-09-29 — Production review fixes and application playbook

- **Deployed:** a production deploy without `--build` had broken every script and stylesheet; a proper build restored them and removed public build files.
- **Deployed:** single-account sign-in requires a private access key; visitors without it see "This RoleDawn workspace is private." (D-109).
- **Deployed:** the form agent defaults to GPT-6.1 Sol; per-task model overrides reach background workers (D-108).
- **Deployed:** the writing lint flags self-undercutting sentences even when they name the employer, plus "not a direct match" (D-110).
- **Deployed:** Gmail code search covers both Greenhouse sender domains; a Gmail rate limit no longer turns code reading off for the send.
- **Deployed:** an unmet employer code closes the attempt as `NOT_ACCEPTED`, the send retries once by itself, then Try again is offered; old applications can be archived off Home (D-111; migrations `20260929220000`, `20260929230000`). The seven earlier test applications are archived.
- **Docs:** [application playbook](docs/execution/application-playbook.md).

## 2026-09-29 — Gmail codes and needs-you panel

- **Implemented:** Connect Gmail (read-only) under Profile → Preferences; while a send waits on an employer's emailed code, the worker reads it from the candidate's own inbox and finishes the application (D-106). Migration `20260929010000_candidate_mailbox_codes.sql` with a local check.
- **Implemented:** Home rows say exactly what an application needs ("Enter code", "Answer 9 questions"); one click opens a side panel with the same controls as the application page; the tab title counts what needs you (D-107).
- **Implemented (local):** when the cloud browser provider refuses a session, the application says why: out of plan minutes (`DELIVERY_BROWSER_QUOTA_EXHAUSTED`, HTTP 402) or too many browsers at once (`DELIVERY_BROWSER_CONCURRENCY_LIMIT`, HTTP 429). Nothing is sent in either case.

## 2026-09-28 — Home queue, ranked Jobs, and live delivery fixes

- **Implemented:** Home is a paste bar and one status queue of every application (autopilot switch, applied, sent today, last update). Jobs opens on roles ranked against the candidate's profile; any job opens in a side panel with the full posting, and Apply moves it into the Home queue (D-101).
- **Fixed:** Greenhouse delivery now uses Greenhouse's embedded application form, so boards whose hosted page redirects to the employer's own careers site (Carvana, Airbnb, Databricks, Datadog, Zipline in a 73-board sample) are deliverable (D-102).
- **Fixed:** a live fill ran out of time because every form inspection re-opened every dropdown. Unchanged React Select menus are now reused (about 22 s to 2 s per inspection on the live Carvana form), and a run gets 540 s inside a 600 s lease (D-104).
- **Fixed:** Lever's hCaptcha loader (`secure-api.js`, seen on all five audited Lever forms) was blocked by the delivery guard, so a Lever submission could never score (D-104).
- **Fixed (form audit, D-103):** repeated Greenhouse labels ("Email Email*") now match profile facts, so name, email and phone fill from the profile.
- **Fixed:** a phone widget's own format of the saved number now reads back as the same number (`tel` inputs only), and Greenhouse's us-west-2 upload bucket is accepted (presigns are geo-routed) (D-104). Candidate questions show a form's doubled labels once.
- **Implemented:** employer email-code step (D-105). When Greenhouse emails the applicant a verification code instead of accepting the send, the application shows "Check your email" with a code box; RoleDawn types the code into Greenhouse's form and resends the identical application. New migration `20260928230000_autopilot_email_verification.sql` (applied to hosted), with a local check covering ownership, single use, expiry, retry limits and lease extension.
- **Live result:** one real Carvana application ran end to end: every field, both files, nine in-app answers, and the final request. Greenhouse answered HTTP 428 (its emailed security-code challenge after the invisible CAPTCHA), so the application is **not accepted**, and RoleDawn shows it as unconfirmed. An email-code handoff is recommended next (D-105).

## 2026-09-28 — simpler product, story bank, writing v4

- **Implemented:** Home / Jobs / Profile navigation; a rebuilt application page with document previews, short answers and a cited "why this approach" brief; rebuilt onboarding (résumé → basics → what you want → optional stories); one-step résumé confirmation; editable career profile; STAR interview and story bank with candidate readback approval; voice profile.
- **Implemented:** application writing v4 (`application-kit/4`) with cited employer research, a needs brief, per-segment sources, independent verification, a style lint, up to three repair attempts, and one-page PDF/Word rendering.
- **Implemented:** voluntary self-identification (default "Decline to self-identify", saved only by the candidate), salary expectation, start date, relocation, how-you-heard, degree and address answers, filled only where a form's own label asks for them.
- **Implemented:** send-when-ready intents with a remembered review-first preference; whole-catalog matching with repost collapse and country filtering; ranked job search; retry for failed pasted-link imports.
- **Fixed:** pasted Greenhouse links failed to import when the posting used sectioned EEOC questions, `null` sections, or a non-https AI opt-out link (25 of 39 sampled supported postings failed; all 39 now import). Autopilot no longer stalls after one application needs the candidate.
- **Fixed:** large boards (Carvana, Databricks) now ingest: set-based snapshot commits with a scoped 60 s budget, longer catalog fetch limits, and backoff instead of re-claiming a timed-out source. Research bundles list each page once. Home no longer fails hydration when server and browser time zones differ, and it streams matches separately.
- **Writing:** applications never volunteer what the candidate lacks; the linter blocks self-undercutting lines and phrases repeated across résumé lines (D-099).
- **Hosted:** nine migrations applied; 437 reviewed boards registered; 40,382 open roles from 436 boards. Deployed to production as `6abad3bb016355dfce858861`. See [current state](docs/execution/current-state.md) and decisions D-088 to D-099.

## 2026-09-16 — editable writing policies and named-job delivery

- **Implemented:** five owned, profession-neutral writing policies loaded for every draft, with file hashes recorded in packet provenance. New packets include a combined cover-letter-first PDF plus separate PDF/DOCX files.
- Added **Apply for me**, durable per-application delegation, acknowledged file uploads, configured next/back navigation, one-use final dispatch, independently observed receipts and receipt download.
- Added batched missing-answer continuation across fresh browsers, pause/cancel, read-only uncertain-submission recovery, session cleanup and cleanup/reclaim fencing.
- **Verified:** the live Agents API completed a two-page synthetic application, a missing-answer round trip and exactly one local submission. No employer application was sent. A guarded passive Greenhouse check read real short screening dropdowns without candidate disclosure.
- See [autopilot acceptance and remaining coverage](docs/execution/application-autopilot-acceptance.md). This extends the earlier fill-only lane below; it is not a permanent web/worker deployment or universal ATS support.

## 2026-09-16 — managed agent form execution and in-app questions

- **Implemented:** OpenAI Agents API/Codex harness adapter behind a reversible driver flag, with Browserbase retained as browser host.
- Added native and constrained static ARIA form tools, immutable fact/file references, independent narrative entailment, and browser readback.
- Added candidate-owned question batches and one atomic Save and continue flow; preserved no-submit authority and candidate-entered values.
- Deployed question, runtime, resume SQL correction and session-cleanup retry migrations. Hosted rollback acceptance passed 28 checks in total.
- Reused the existing OpenAI key and enabled the driver in local configuration. At that milestone, uploads, multi-page progression and final submission were unfinished; the delivery lane above implements the controlled path. See the [earlier acceptance record](docs/execution/agents-application-execution-acceptance.md).

## 2026-08-18 — guided activation, explainable fit, continuous workers, and Live View foundation

### Candidate activation

- Removed country-scoped work authorization from the global account-activation
  gate. Missing answers and an explicit **I’m not sure** remain unresolved;
  deterministic job fit marks the affected role **Needs review**, and a named
  application pauses before disclosing any candidate data when the employer
  requires that answer.
- Added a resumable four-step onboarding route for résumé, job goals, exact
  application answers, and readiness. Completion is derived from hosted
  candidate records; protected routes return an incomplete candidate to the
  correct step.
- Persisted candidate-private target roles, locations, work modes, and search
  rules in Supabase. The hosted readiness correction requires candidate-entered
  given and family names but does not make unresolved work authorization a
  global blocker. The refreshed founder revision freezes reviewed ordinary
  facts; no name or work-authorization answer is guessed.
- Preserved the uploaded résumé and reviewed extraction across reloads. The
  hosted founder record has one source document, one current source version,
  and 17 evidence items: 12 `VERIFIED` and 5 `NEEDS_REVIEW`.
- Preserved the original deep link through sign-in and made Google an honest
  conditional option. Hosted Supabase currently reports the Google provider as
  disabled. The callback, safe redirect policy, provider check, and login UI are
  ready; activation is waiting on the founder to accept Google's User Data
  Policy and create the OAuth credentials before enabling the hosted provider.

### Opportunity experience

- Replaced unsupported match percentages with deterministic `Good fit`,
  `Needs review`, and `Eligibility issue` labels. The adapter uses candidate
  goals and verified authorization facts, never silently removes jobs, and
  permits an eligibility issue only for an explicit conflict.
- Kept fit advisory and read-time. There is no claim of calibrated ranking,
  learned recommendations, or application permission.
- Rechecked the hosted catalog after a worker-driven run: 480 total jobs, 464
  open jobs, 492 immutable job versions, and a latest successful ingestion run
  with 464 observations. Anthropic Greenhouse remains the only allowlisted
  polling tenant.

### Application operations

- Added and deployed the stale-file refresh boundary. Fill authorization now
  fails with `APPLICATION_FILL_INPUTS_STALE` when the current revision was
  prepared from an older candidate input epoch.
- Added an authenticated, replay-safe **Refresh files** command for stale
  `READY`, `NEEDS_USER`, and `FAILED_SAFE` applications. It refuses active
  preparation or fill work, appends the command/event/outbox/run transaction,
  and keeps the current immutable files in place until a replacement revision
  commits.
- Added the lean **Profile changed** application-detail state. It derives one
  boolean from the current and frozen input epochs without rendering either
  value, hides fill authorization for a stale `READY` revision, and queues the
  replacement through a Server Action.
- Verified the hosted refresh path on the founder application. It produced a
  current release-2 revision whose frozen candidate input epoch matches the
  candidate, with exactly four private QA-passed artifacts. The successful
  replay followed a strict OpenAI claim/citation schema correction; the prior
  revision and artifacts remain immutable history.
- Added one long-running Node/TypeScript worker service with independent
  catalog, preparation, Application Kit, and fill lanes. Each lane has its own
  cadence, jitter, exponential backoff, overlap guard, recovery, redacted
  logging, and health state.
- Added liveness, readiness, and health endpoints, graceful shutdown, a worker
  Dockerfile, and a dedicated `npm run worker:service` command.
- Extracted the entrypoint shutdown coordinator and added a regression test
  proving the process awaits lane shutdown and retained-browser release
  reconciliation before it exits. Repeated signals share one stop promise.
- Kept idle lanes visible in health state without emitting repetitive
  lane-start and zero-work completion logs. Claimed work, failures, recovery,
  readiness, and service lifecycle changes remain logged.
- Proved the service locally: catalog claimed and completed one 464-observation
  run; preparation, kit, and fill lanes ran idle without failures; the service
  reported ready and stopped gracefully. It is not deployed to an always-on
  host yet.
- Deployed the 45-migration hosted baseline through separate candidate names
  and application-specific work-authorization readiness. It also includes the
  release-2 Application Kit quality manifest, onboarding/search profile,
  résumé-readiness repair, candidate-owned Browserbase Live View binding,
  retained-runtime release reconciliation, and stale-packet refresh.

### Browserbase and takeover boundary

- Added an owner-scoped application Live View route and compact application-
  detail control. The server returns an on-demand Live View URL only for an
  active, unexpired session owned by the signed-in candidate; provider IDs stay
  server-only and the response is no-store/no-referrer.
- Preserved the credentialed synthetic Browserbase acceptance: exact-origin and
  no-submit guards stayed active, the session released explicitly, and no
  candidate or employer data was used.
- Added explicit candidate-entered first, last, and full legal name facts and
  Greenhouse driver mappings; names are never split or guessed. Hardened
  required-field detection for `aria-required` controls.
- Allowed only the four reviewed US/Canada work-authorization booleans through
  the exact fill manifest. Recognized yes/no selects and radios fill
  deterministically; unresolved answers, citizenship, demographics, consent,
  CAPTCHA, and unknown legal fields still pause before any disclosure.
- Passed a gated Greenhouse-shaped Browserbase acceptance with the refreshed
  revision's hash-verified résumé and cover-letter PDFs. Both uploads and all
  eight frozen reviewed ordinary fields read back correctly, Submit stayed
  disabled, outbound submission requests remained zero, the session released
  `COMPLETED`, and no employer was contacted.
- Added a process-owned runtime supervisor that keeps the browser, network
  guard, lease, and review/takeover wait together, then awaits durable release
  reconciliation before the lifecycle is considered finished.
- Added the candidate-controlled continuation after a takeover pause. The
  candidate must confirm that required questions were completed in Live View;
  one replay-safe command then resumes the exact retained fill/session under
  the original fill-only authority. Missing, expired, busy, or still-blocked
  runtimes fail safe and create no submission authority, attempt, or receipt.
- Added real-Chromium regression coverage proving a candidate-entered
  protected Greenhouse answer is preserved, the same page continues to
  fill-to-review, and both DOM and network submission remain blocked. Hosted
  activation is pending migration `20260819061711`.
- Added one additive, service-only, idempotent release RPC bound to the exact
  fill attempt and computer session. A measured release with zero outbound
  submission requests becomes `DESTROYED`; an uncertain release becomes
  `FAILED_SAFE` with submission state unknown. Both preserve
  `PRE_SUBMIT_REVIEW` or `TAKEOVER` and create no submit attempt or receipt.
- Deployed retained-runtime release reconciliation and exercised the actual
  UI-to-database-to-Browserbase path against the public Anthropic Greenhouse
  form. The driver found two required protected/legal fields during preflight
  and returned `TAKEOVER` before disclosure: zero fields filled, zero files
  uploaded, zero outbound submission requests, no submission attempt, no
  receipt, and no employer contact. After the provider session became terminal,
  uncertain release telemetry reconciled the computer session to `FAILED_SAFE`
  while preserving the candidate-facing takeover state.

### Verification and remaining boundary

- Passed the integrated automated suite, TypeScript, lint, production build,
  documentation-link checks, and whitespace validation after integration.
- Rechecked the hosted database after refresh and no-submit execution: the
  founder application has a current release-2 revision and four artifacts plus
  durable fill/session history. Submit attempts and receipts remain zero.
- This is a working founder-alpha foundation, not autonomous application
  delivery. A real ATS was opened and correctly failed closed without
  disclosure, but completing an ordinary real form, candidate intervention,
  single-use Submit, employer confirmation, submission reconciliation, receipt
  proof, worker deployment, broader job sources, and production operations
  remain open.

## 2026-08-17 — end-to-end product audit and Browserbase recheck

### Verified current product path

- Walked the signed-in Applications, Search jobs, Saved jobs, Résumé,
  Experience, Application answers, and application-detail routes in the
  in-app browser. The shared navigation persisted, the tested pages produced
  no browser warnings or errors, and the 390 px QA frame kept the primary
  Applications flow readable with a working mobile drawer.
- Confirmed one private résumé survives reload, 17 source-linked evidence
  items are reviewable, exact application answers are candidate-attested, 441
  jobs are searchable, and one application has four downloadable PDF/DOCX
  artifacts.
- Downloaded and rendered the current résumé and cover-letter PDFs. Both are
  one-page, readable, unclipped, and text-extractable. The content remains
  truthful to reviewed evidence, but it is not yet a competitive quality bar:
  the cover letter mostly restates the posting, and the résumé omits basic
  contact details because onboarding did not collect them.
- Re-ran the credentialed Browserbase synthetic acceptance against
  `example.com`. The fresh ephemeral session connected over CDP, stayed on the
  exact allowlisted origin, blocked DOM submit, unsafe `POST`, post-load `GET`,
  WebSocket, and Service Worker paths, reported zero outbound submission
  requests, and reached `COMPLETED` after explicit release.
- Rechecked the hosted database read-only. It contains one candidate still in
  `ONBOARDING`, one persisted résumé, 17 evidence items, 441 jobs, and one
  `READY` application, with zero fill attempts, computer sessions, submission
  attempts, or receipts.

### Product findings

- A new candidate can create an email-link account, persist a supported résumé,
  review evidence and a limited answer set, search or paste a supported job,
  and receive a reviewable application packet when an operator runs the
  one-shot workers.
- A new candidate cannot yet apply on autopilot. There is no guided onboarding,
  profile-readiness gate, personalized ranking, continuous worker deployment,
  real ATS acceptance, usable live takeover, final Submit approval,
  confirmation, or receipt.
- The current application demonstrates the recommendation gap: the official
  posting requires Australian public-sector depth, extensive experience, and
  security clearances, while the approved candidate record contains none of
  those qualifications. The system still produced a `READY` packet because no
  hard-eligibility or candidate-fit gate exists.
- The candidate UI does not refresh agent progress in real time, loses deep-link
  intent through sign-in, and still exposes two implementation terms on
  application detail: “Official job snapshot” and “preparation run.”

### Integrated validation

- All 251 tests pass with zero failures.
- TypeScript, ESLint, local Markdown links, the production Next.js build, and
  `git diff --check` pass.
- The repository contains 38 migrations. The hosted ledger remains accepted
  through migration 37; `20260817072000_enforce_application_quality_manifest`
  is checked in but is not yet deployed.

### Boundary

- The Browserbase result is still a synthetic provider-seam test, not an ATS
  form fill and not evidence of employer submission.
- No fill-only authorization was created or consumed during this audit. No
  candidate data was sent to an employer and no Submit action was attempted.

## 2026-08-16 — Browserbase live synthetic-session acceptance

### Implemented in the repository

- Removed the stale Browserbase project-ID requirement. The server-only API key
  now uses Browserbase's documented project inference while RoleDawn still
  verifies that it resolves to exactly one project before provider use.
- Preserved the explicit execution gate, metadata-bound provider lookup,
  short-lived session policy, Playwright-over-CDP adapter, exact-origin guard,
  no-submit network interlock, and explicit release path.
- Added Service Worker registration blocking, telemetry for request failures
  not already attributed to the route guard, and explicit provider release if
  CDP provisioning fails after session creation.

### Verified live

- Opened one fresh 60-second Browserbase session against `example.com` with no
  proxy, CAPTCHA solving, recording, employer data, or candidate data.
- Connected over CDP, matched exactly one session by RoleDawn metadata, and
  verified that DOM submit, unsafe `POST`, post-load `GET`, and
  WebSocket attempts were blocked.
- Re-ran the synthetic acceptance after hardening and observed
  `service_worker_blocked=true` while all previously accepted checks remained
  true.
- Observed zero outbound submission requests, sent `REQUEST_RELEASE`, and
  verified final provider status `COMPLETED` on the hardened rerun.
- The secret, inferred project ID, provider session ID, and provider URLs were
  not added to the repository or acceptance record.

### Boundary

- This accepts Browserbase only for the founder no-submit benchmark. It does
  not accept a real ATS fill, Live View or candidate takeover, Submit,
  reconciliation, confirmation, receipt generation, multi-ATS reliability, or
  Browserbase as the production provider.

See [Browserbase live synthetic-session acceptance](docs/execution/browserbase-live-acceptance.md).

## 2026-08-16 — product-readiness audit and lean candidate UI

### Implemented in the repository

- Added a verified development-state audit across Candidate Intelligence,
  Opportunity Intelligence, Application Delivery, and the shared control plane.
  It separates durable records from unattended execution, hosted proof from
  local contracts, and missing production controls from product claims.
- Made the Auth callback bootstrap the signed-in user's personal workspace and
  candidate immediately after a successful email-link exchange. Google OAuth
  and guided onboarding remain unconnected.
- Simplified candidate language and navigation to **Profile**,
  **Applications**, **Search jobs**, and **Saved jobs**. Removed disabled roadmap
  rows instead of presenting unavailable destinations as product features.
- Moved the fill/review action ahead of long application detail on smaller
  screens, hid completed preparation after `READY`, made job detail and history
  collapsible on mobile, and added route-level loading, error, and not-found
  states.
- Verified the primary READY-application action within the first mobile
  viewport at 390 x 844, with no horizontal overflow across Applications,
  application detail, Search jobs, Resume, and Application answers.

### Boundary

- This cleanup does not add onboarding, Google OAuth, matching, worker hosting,
  a credentialed Browserbase session, real employer fill, takeover, Submit,
  confirmation, or receipt.
- The full local validation result for the integrated change is recorded in the
  product-readiness handoff, not inferred from the existence of UI files.

### Integrated validation

- All 245 tests pass; TypeScript, ESLint, the production Next.js build,
  Markdown-link validation, and `git diff --check` pass.

## 2026-08-16 — candidate-neutral application quality gate

### Implemented in the repository

- Promoted `roledawn-writing-policy/2` for new Application Input Snapshots. It
  adds bounded cover-letter structure plus minimum candidate-proof, role-context,
  and tailored-résumé evidence requirements to the provider-safe request.
- Added `roledawn-application-quality-evaluator/1` after deterministic citation
  checks and separate semantic entailment. It blocks thin or generic letters,
  missing target names, missing proof, unresolved placeholders, internal
  workflow metadata, and evidence-free tailored résumés before rendering.
- Preserved auditable warnings for official-posting-only research, weak résumé
  section structure, ceremonial openings, questions, repeated paragraphs, and
  heavy em-dash use. Application Kit manifest release `application-kit/2`
  includes the exact report in its immutable packet hash.
- Added a new-revision database guard for release 2 so a `PASSED` row cannot be
  inserted without the exact quality-policy binding and a review-ready report.
- Documented which reusable controls from the private personal workflow are
  productized and which quality layers remain. No candidate-specific claim,
  fixed positioning line, or bundled skill text was added to shared code.

### Validation

- The complete local suite passes 245 tests. TypeScript and ESLint pass.
- Migration `20260817072000_enforce_application_quality_manifest` is checked in
  but not yet deployed. This change has not generated or persisted a new hosted
  kit. The existing
  founder kit remains a writing-policy/1 and application-kit/1 historical
  artifact; a new snapshot and worker run are required to accept release 2.

## 2026-08-16 — fill-to-review control plane and no-submit browser foundation

### Implemented in the repository

- Added revision-bound `FILL_APPLICATION_ONCE` authorization, one-time
  consumption, fill attempts, database-owned computer sessions, redacted
  checkpoints, lease fencing, and action-scoped foreign keys that prevent fill
  authority from creating a submit attempt.
- Added an exact execution materializer that reads only the authorized fact and
  artifact versions, verifies private bytes and hashes, and emits a fill-only
  package with no Submit capability.
- Added a provider-neutral fill coordinator and recovery worker. Provider
  provisioning uses the database `computer_session_id` as the idempotency key;
  only stale `PROVISIONING` work may resume. Stale active or
  disclosure-possible work fails safe instead of re-driving candidate data.
- Added an installed-Chrome synthetic ATS harness that fills ordinary fields,
  uploads a PDF, leaves an unknown sensitive attestation blank, reads the form
  back, and blocks a deliberate submit request.
- Added candidate-facing Application Kit review copy for the exact artifacts,
  material changes, fill-only boundary, stop conditions, and explicit
  no-submit state on desktop and mobile.

### Deployed and verified live

- The remote and local ledgers align at 37 migrations, including
  `20260817055750_application_fill_authorization`,
  `20260817060143_fix_application_fill_completion_event`,
  `20260817063813_add_application_fill_recovery_lease`, and
  `20260817063824_cover_application_fill_foreign_keys`.
- Rollback-only hosted acceptance proved stable replay, one-time action-scoped
  fill authority, reservation/activation/completion, RLS, immutable
  checkpoints, source-deletion and cross-candidate guards, and zero submit
  attempts or receipts.
- A hosted crash drill reclaimed stale `PROVISIONING` with the original session
  ID, replayed reservation idempotently, and returned
  `FAIL_SAFE_DISCLOSURE_POSSIBLE` for stale `ACTIVE` without re-driving. It used
  one session, wrote two recovery checkpoints, and rolled back all test rows.
- The founder application remained `READY` at aggregate version 8 with zero
  fill/session/submit/receipt rows.
- At the recovery checkpoint, the complete local suite passed 231 tests with
  TypeScript, ESLint, and whitespace validation passing. The final validation
  record must include any later provider-adapter additions.
- The current advisors report zero unindexed foreign keys. Security reports 24
  findings: 8 intentional deny-all RLS `INFO`, 15 intentional authenticated
  `SECURITY DEFINER` `WARN`, and 1 leaked-password-protection `WARN`.
  Performance reports 64 `INFO`: 63 unused indexes plus the Auth
  connection-strategy advisory.

### Runtime boundary

- No managed browser provider or real ATS driver has filled an employer form.
- Human takeover, final submit approval, submission, confirmation,
  reconciliation, and receipts remain unconnected.
- Clean ephemeral computers are the default. Encrypted context may persist only
  for one candidate and one ATS origin when login continuity requires it; the
  product does not keep an always-on desktop per candidate.
- Provider selection remains benchmark-gated on isolation, lifecycle recovery,
  live takeover, latency, support, and accepted-output cost.

See the [fill-to-review acceptance record](docs/execution/application-fill-foundation-acceptance.md).

## 2026-08-16 — first hosted no-submit Application Kit

### Implemented in the repository

- Added one leased, replay-safe Application Kit worker that revalidates an
  immutable input snapshot, researches the official posting, drafts through
  the bounded Terra adapter, runs deterministic plus semantic-entailment gates,
  merges exact candidate facts outside the model, and commits the complete
  no-submit revision atomically.
- Added deterministic PDF/DOCX rendering and private artifact persistence for
  exactly four candidate files: tailored résumé PDF/DOCX and cover-letter
  PDF/DOCX. Candidate downloads require Auth, application ownership, the
  current revision, and the named artifact before issuing a short-lived signed
  URL.
- Added candidate-specific résumé query scoping and RLS for logical source
  documents and source versions. Career Vault reads and deletion preflight now
  require the active workspace and the current candidate, while immutable
  source/version/Storage provenance remains the persistence authority.
- Added the [ATS API and ingestion matrix](docs/research/ats-api-ingestion-matrix.md),
  separating public or contract-authorized job discovery from employer/partner
  submission APIs and candidate-approved browser delivery.

### Deployed and verified live

- Deployed hosted migrations `20260817044053_harden_resume_candidate_scope`
  and `20260817044103_application_kit_runtime` to HireWire development. The
  later hardening migrations
  `20260817050040_cover_remaining_candidate_evidence_foreign_keys` and
  `20260817050057_harden_default_database_privileges` are also deployed. The
  33-migration hosted ledger and checked-in filenames align through
  `20260817050057`.
- Application `681215c7-0d80-4420-ba13-c4af20296c0d` now has current revision
  `8e3c1680-39f7-4211-9157-f04582bdeaed` in `READY`, official-posting research
  bundle `40df390d-2d4b-44bf-829f-f4d8b58ddf98`, 12 evidence references, one
  exact-fact reference, and exactly four private `PASSED` artifacts.
- The first delivery attempt failed closed on strict timestamp parsing and
  committed no revision or artifact. After server-side timestamp
  canonicalization, replay succeeded on attempt two and published the outbox
  message without duplicate rows.
- The hosted résumé integrity audit found one candidate, one logical résumé,
  one source version, and zero duplicates, orphans, broken current selections,
  missing review, missing Storage, or inconsistent finalization state.
- Browser QA reloaded `/vault` and showed the same reviewed v1 résumé filename
  and text. Application detail rendered all four downloads and the explicit
  statement **No application has been submitted.** with zero console errors.
- Approval-challenge, approval-consumption, application-attempt, and receipt
  counts remained zero. No employer form was opened or submitted. See the
  [hosted acceptance record](docs/execution/application-kit-hosted-acceptance.md).
- The performance advisor reports zero unindexed foreign keys. Remaining
  findings are 53 unused-index informational notices plus one Auth connection-
  strategy informational notice. The security advisor still reports eight
  intentional deny-all service tables, 14 bounded authenticated definer
  commands, and the leaked-password-protection pre-public-signup warning.

### Runtime boundary

- The worker remains operator-invoked; no recurring drafting scheduler is
  deployed.
- Research is limited to the official job posting. There is no eligibility or
  match engine, browser/CUA, ATS fill/upload, approval consumption, submit,
  reconciliation, or external receipt.
- The four files are usable and unclipped, but PDF/DOCX typography is not yet a
  unified visual system. That is renderer v2 polish, not accepted fidelity.
- Public résumé upload still requires quarantine, malware scanning, isolated
  parsing, retention, recovery monitoring, and OCR where needed.

## 2026-08-16 — first live Terra drafting proposal

### Implemented in the repository

- Added a server-only OpenAI Responses API drafting adapter using
  `gpt-5.6-terra`, medium reasoning, strict Structured Outputs, `store: false`,
  and no SDK-owned retries. The model remains behind the existing provider
  interface.
- Promoted one RoleDawn-owned application writing policy with direct-language,
  word-limit, prohibited-phrase, citation, and unsupported-number checks.
- Added a repeatable local acceptance command that loads only the exact pending
  Application Input Snapshot, builds the minimized provider request, calls the
  adapter, validates the proposal, and writes a private Git-ignored diagnostic
  artifact without acknowledging the event or mutating application state.
- Fixed numeric validation so sentence punctuation after a supported year is
  not misclassified as part of an invented number.

### Verified locally

- The configured account exposes `gpt-5.6-terra`.
- The first accepted live proposal produced a tailored résumé and cover-letter
  proposal with zero deterministic validation issues. Candidate identity,
  exact facts, internal document IDs, and raw reviewed résumé text stayed out
  of the provider request.
- The private acceptance artifact is
  `artifacts/acceptance/live-terra-drafting.json`; it is intentionally excluded
  from Git. See [live Terra drafting acceptance](docs/execution/live-terra-drafting-acceptance.md).

### Runtime boundary

- This is a live adapter acceptance, not the durable drafting consumer. The
  pending `application.drafting_requested` event remains unacknowledged and the
  hosted revision, artifact, approval, attempt, and receipt tables remain
  unchanged.
- Semantic entailment is still `REQUIRED_NOT_RUN`; no proposal can be promoted
  to `PASSED`. Research, atomic persistence, exact-fact merge, rendering,
  review, browser fill, submission, and receipt remain unconnected.

### Validation

- All 180 tests, TypeScript, ESLint, Markdown links, the production Next.js
  build, dependency audit, and `git diff --check` pass.

## 2026-08-16 — application research and drafting foundation

### Implemented in the repository

- Added a provider-neutral research contract bound to one immutable Application
  Input Snapshot. Research claims require HTTPS citations, explicit conflict
  handling, bounded freshness, and deterministic hashing. Candidate facts,
  evidence, identity, and résumé text are not part of the research-provider
  request.
- Added an exact-snapshot drafting-context reader and a provider-safe drafting
  request. It verifies the frozen job, résumé, approved evidence versions,
  hashes, and use policy before exposing only approved narrative evidence.
  Exact application facts and candidate identity remain server-side.
- Added a strict, fail-closed parser for model output. Deterministic validation
  can reject malformed structure and uncited claims, but it deliberately cannot
  mark a draft publishable until a separate semantic-entailment check passes.
  `AS_UPLOADED` résumé mode preserves the source artifact server-side rather
  than asking a model to reconstruct it.
- Added immutable research-bundle, revision-input, and revision-evidence
  provenance. Every future revision must bind the exact input snapshot and
  research bundle by ID and canonical hash. Provider-specific IDs remain behind
  adapters.

### Deployed and verified live

- Forward migration
  `20260817025617_drafting_research_and_revision_provenance` is deployed and
  aligned with the hosted HireWire ledger. The accepted foundation now contains
  29 aligned migrations.
- A rollback-only hosted acceptance inserted one valid research bundle, one
  revision, and 12 exact evidence references for the founder snapshot; rejected
  an invalid snapshot hash; rolled the valid rows back; and ended with zero
  research bundles, revisions, and revision-evidence references.
- The four revision-provenance columns are `NOT NULL`. The security advisor
  reports zero errors, and the performance advisor reports zero errors or
  warnings after deployment.

### Runtime boundary

- No model provider, API key, drafting-event consumer, semantic-entailment
  grader, renderer, or atomic revision writer is connected. The pending
  `application.drafting_requested` message remains unacknowledged.
- No résumé, cover letter, artifact, approval, browser session, employer upload,
  submission, or receipt was created.

### Validation

- All 175 tests, TypeScript, ESLint, Markdown links, the production Next.js
  build, and `git diff --check` pass.
- Browser QA verified the persistent sidebar and Zack Richland identity on
  `/vault/facts`, the real résumé's 12-of-17 review state, and the database-
  backed `Ready to draft` Application Kit on `/dashboard`.

## 2026-08-16 — founder dogfood candidate handoff

### Implemented in the repository

- Added a confirmation-gated dogfood command that aligns the existing test
  candidate's display labels and current candidate-attested legal-name version,
  uploads one founder-selected résumé to private Career Vault Storage, records
  deterministic extraction and review versions, and ingests source-linked
  evidence proposals. The command is resumable only when the existing source and
  reviewed-text hashes match the selected file.
- Released deterministic segmenter `resume-passages/2`. It recognizes common
  résumé sections, reconstructs wrapped role and bullet text into contiguous
  source spans, and excludes pre-section identity/contact text from narrative
  evidence when recognizable sections exist. Exact source offsets and hashes
  remain the authority.
- Kept evidence review selective. Candidate-authorized dogfood review approved
  useful experience and education passages while leaving summary, skills, and
  uncertain experience passages in `NEEDS_REVIEW`; the system did not silently
  approve every extracted line.

### Deployed and verified live

- The existing founder dogfood identity is internally aligned across the
  candidate label, active legal-name fact version, personal workspace label,
  and Auth display metadata. No raw identity value is reproduced here.
- The founder-selected Phoebe résumé PDF is `READY` after one-page deterministic
  extraction: 3,353 normalized characters, zero parser warnings, one immutable
  candidate-reviewed text version, and the truthful source status
  `NOT_SCANNED`.
- `resume-passages/2` produced 17 source-linked evidence items: 12 are
  `VERIFIED`, five remain `NEEDS_REVIEW`, and none is rejected. The approved set
  comprises 11 experience passages and one education passage.
- Preparation run `559ec07c-5193-4fda-b3a7-a68be103095b` committed Application
  Input Snapshot `a6a98e45-305b-496f-bd46-754b870a2a4b` as
  `READY_FOR_DRAFTING` with zero blockers, 12 approved narrative-evidence
  references, and one approved exact-fact reference. The application is
  `DRAFTING`; the run is intentionally `WAITING / INPUTS_READY`.
- Exactly one unpublished `application.drafting_requested` outbox message is
  pending for that application. There are still zero application revisions,
  artifacts, approvals, attempts, and receipts. This verifies the input seam,
  not drafting or an employer-side action.
- The hosted ledger entry and checked-in file now share version
  `20260817020942_candidate_evidence_segmenter_v2`. The 28-migration hosted
  foundation is aligned through that version. Later unverified migration work
  is outside this checkpoint.

### Runtime boundary

- No model provider or API key was used. Company research, drafting, generated-
  claim validation, rendering, application revision/artifact persistence, and
  candidate packet review remain unbuilt.
- The pending drafting request grants no approval, browser, upload, submit, or
  receipt authority.

## 2026-08-16 — immutable application inputs and preparation preflight

### Implemented in the repository

- Added migration `20260817011359_bucket3_preparation_snapshots`. It persists
  immutable Application Input Snapshots, version references, preparation stage,
  lease/attempt state, and identity-derived claim, commit, and retry commands.
- Added a candidate input epoch. Changes to the résumé lifecycle, reviewed
  evidence, approved exact facts, tailoring mode, or submission mode advance
  the epoch. Snapshot commit checks the same epoch and current eligible-version
  set before it can publish a drafting handoff.
- Added a deterministic assembler that binds one application and exact job
  version to reviewed résumé hashes, approved narrative-evidence version
  references, approved exact-fact version references, and immutable policy and
  assembler releases. Exact fact values do not enter the manifest or narrative
  model context.
- Added typed preflight results for `RESUME_REQUIRED`,
  `RESUME_REVIEW_REQUIRED`, and `EVIDENCE_REVIEW_REQUIRED`. A blocked run stores
  the reason and next candidate action. A ready run may enqueue later drafting,
  but does not create a revision or authorize an employer-side action.
- Added an Application Kit preparation panel and a retry action backed by a new
  preparation run. Queue and detail reads now return committed preparation
  state instead of inferring it in the browser. The detail projection binds a
  snapshot only through the newest preparation run, so a queued retry cannot
  inherit an older run's blocker while its new inputs are still being frozen.
- Kept the Application Input Snapshot separate from the planned Candidate
  Evidence Snapshot. The former freezes the exact inputs used by one
  application run; the latter remains the reusable Candidate Intelligence
  handoff described by the product architecture.

### Deployed and verified live

- Deployed `20260817011359_bucket3_preparation_snapshots`,
  `20260817013109_bucket3_preparation_fk_indexes`, and
  `20260817013440_bucket3_snapshot_reference_fk_indexes` to the founder-owned
  HireWire development project. The two index migrations add 11 covering FK
  indexes. All 27 checked-in migrations are aligned with the hosted ledger
  through `20260817013440`; linked dry-run reports the remote database is up to
  date.
- One authorized `worker:once` run claimed and completed preparation run
  `35fa282c-4c2a-4cb4-929f-7fef96de056f` for application
  `681215c7-0d80-4420-ba13-c4af20296c0d`.
- The worker committed input snapshot
  `a0238d65-4740-465c-80e7-65a8b3c882e1` as `BLOCKED` with
  `RESUME_REQUIRED`. That is a safe accepted result for the current test
  candidate, not a drafting success.
- The worker summary was `claimed: 1`, `completed: 1`, `failed: 0`. The hosted
  application remains `NEEDS_USER` and has no revision, artifact, approval,
  attempt, submission, or receipt.
- A candidate retry created a new preparation run and second immutable snapshot
  with the same deterministic hash. Replaying the same retry command returned
  the original run and version; a stale expected application version failed
  with `PT409 APPLICATION_VERSION_MISMATCH`.
- Added and deployed 11 covering FK indexes. The linked dry-run reports the
  hosted database is up to date, and the performance advisor reports zero
  Bucket 3 unindexed-FK findings. The security advisor still flags the
  authenticated `retry_application_preparation` security-definer entrypoint;
  its explicit identity, ownership, active-workspace, lifecycle, version,
  deduplication, and state checks were reviewed while protected tables remain
  directly unwritable.

### Runtime boundary

- Company and role research, model drafting, generated-claim validation,
  rendering, revision/artifact persistence, and candidate packet review are
  still not connected.
- No live browser/CUA provider, form fill, upload, approval consumption,
  employer submission, confirmation reconciliation, or receipt exists.

## 2026-08-16 — candidate evidence and first opportunity catalog slices

### Implemented in the repository

- Added deterministic segmentation of the latest candidate-reviewed résumé text
  into immutable, hash-addressed source passages.
- Added `/vault/facts` as a source-linked evidence-review surface. A candidate
  can approve exact source wording, make an attested edit, reject an item, or
  restrict it to résumé-and-letter, cover-letter-only, or private use. Exact
  identity and work-eligibility answers remain separate.
- Added immutable evidence versions and citations, optimistic `PT409` review
  conflicts, command replay protection, candidate-self RLS reads, and typed
  domain events.
- Added an allowlisted job-source polling lane with bounded leases, complete-
  snapshot commits, stored ETags, conditional requests, freshness/closure
  reconciliation, and failure recording.
- Added persistent Search and Saved routes plus replay-safe save/remove and
  queue-from-catalog commands. Adding a catalog job creates preparation intent;
  it does not claim an employer application was submitted.
- Added opaque, validated cursor pagination over the shared catalog at 24 roles
  per page; internal job identifiers remain out of candidate-facing copy.
- Extended candidate-requested exact-document purge to source passages,
  evidence items, immutable evidence versions, and citations. The purge stays
  service-only after candidate request and exact Storage deletion; ordinary
  direct evidence mutation remains denied.

### Deployed and verified live

- Deployed the `candidate_evidence_foundation`,
  `opportunity_catalog_commands`, and
  `include_candidate_evidence_in_document_purge` migrations to the
  founder-owned HireWire development project on 2026-08-16. All 24 checked-in
  migration versions are aligned with the hosted ledger through
  `20260816234940`.
- Candidate-evidence run `20260816235101` passed all 10 checkpoints plus
  cleanup: two real candidates, reviewed source input, deterministic proposal
  ingestion, command replay, two-user isolation, direct-write denial,
  candidate review, edit attestation, stale-write denial, and immutable history
  with citations. Cleanup also exercised the extended exact-document purge.
- Candidate-profile regression run `20260816235136` passed all 13 checkpoints
  plus cleanup against the current hosted baseline.
- Opportunity-catalog run `20260816235350` passed all 12 checkpoints plus
  cleanup: anonymous denial, the allowlisted fixture, two-user search/filter
  behavior, save replay/removal, stale-version denial, replay-safe queueing,
  preparation-only authority, tenant isolation, direct table/raw-column denial,
  and a byte-for-byte unchanged shared catalog after candidate actions.
- Verified Anthropic's official careers page links its roles to Greenhouse and
  kept `anthropic` as the only allowlisted polling tenant.
- Ran one authorized manual poll against the public Anthropic Greenhouse board:
  HTTP 200, 441 observed and accepted open jobs, 441 unique canonical URLs,
  zero blank titles, employers, locations, or descriptions, and zero non-HTTPS
  apply URLs.
- Ran the same worker again with the stored ETag: the source returned HTTP 304
  and the ingestion run completed as `NOT_MODIFIED` without rewriting the
  snapshot.
- Rechecked Supabase advisors. Security reports no errors; its authenticated
  `SECURITY DEFINER` warnings correspond to intentional reviewed API
  entrypoints, while leaked-password protection remains an Auth platform
  setting to enable before public launch. Performance reports no errors or
  warnings; informational notices remain review inputs, not failures.

### Runtime boundary

- The catalog worker is operator-invoked; no cron, scheduler, or always-on
  worker is deployed.
- Candidate evidence has no completed snapshot assembler or model-driven story
  development. The hosted review/RLS boundary is accepted; snapshot assembly is
  the next separate gate.
- Eligibility, recommendations, and match scores are not implemented.
- Company research, model drafting, rendering, packet persistence/review,
  browser/CUA execution, submission, reconciliation, and receipts remain
  unbuilt.

## 2026-08-16 — architecture at a glance and pre-slice foundation recheck

### Documented and verified

- Added one presentation-ready architecture map that separates working,
  contract-only, next, and planned components across Candidate Intelligence,
  Opportunity Intelligence, Application Delivery, and the shared control plane.
- Added a RoleDawn-branded architecture poster that makes Candidate and
  Opportunity Intelligence parallel inputs to Application Delivery, places
  approval before the temporary browser, and returns a receipt only after the
  employer boundary. The LLM-readable Mermaid map remains alongside it.
- Added the end-to-end data flow, current technology stack, authoritative table
  ownership, scaling model, explicit assumptions, open provider decisions, and
  milestone acceptance gates.
- At that checkpoint, rechecked the HireWire project read-only: PostgreSQL 17
  was healthy, all 21
  repository migrations are present, and all `public` domain tables report RLS
  enabled. Existing durable state still contains no application revision,
  artifact, approval, attempt, or receipt.
- Verified effective privileges around the advisor-flagged private purge table
  and authenticated security-definer RPCs; recorded the remaining defense-in-
  depth, leaked-password protection, and foreign-key-index reviews without
  presenting a generic advisor warning as a confirmed exploit.
- Marked the older Excalidraw system map and Milestone 0 operator runbook as
  historical, corrected the accepted Supabase decision, and made the current
  architecture document the default presentation path.

### Runtime boundary

- This entry changes documentation only. It adds no model, renderer, browser,
  approval command, submission, reconciliation, or receipt capability.
- The later 2026-08-16 entry above supersedes this checkpoint's migration and
  advisor counts with the deployed evidence/catalog slices.

## 2026-08-13 — three-system product architecture

### Documented decision

- Organized the core product into **Candidate Intelligence**, **Opportunity
  Intelligence**, and **Application Delivery**.
- Mapped every current candidate surface and backend primitive to one owning
  system while keeping Auth, Storage, commands, events, workflows, models,
  browser providers, policy, audit, and channels in one shared control plane.
- Defined immutable Candidate Evidence and Opportunity Snapshots as the inputs
  to one application-scoped immutable revision.
- Recorded the current implementation and missing work for each system without
  converting schemas or offline contracts into working-product claims.
- Set the next product build to source-linked résumé facts and stories with
  candidate review, followed by one persistent no-submit Application Kit.
- Kept recurring catalog ingestion, Search, Saved, watchlists, and matching as
  a parallel lane after packet quality is proven; the existing pasted-link
  resolver is enough for the first end-to-end slice.

### Runtime boundary

- This entry changes architecture and sequencing documentation only. It adds no
  model drafting, generated documents, browser execution, submission, or
  employer receipt capability.

## 2026-08-12 — candidate-reviewed answers and packet hardening

### Implemented in the repository

- Added `/vault/answers` for candidate-reviewed legal name, application email,
  phone, LinkedIn, website, city, region, country, and separate U.S. and Canada
  work-authorization and sponsorship answers.
- Kept legal and sensitive uncertainty explicit with **I'm not sure**. An
  unresolved value remains `NEEDS_REVIEW`; a model cannot resolve it.
- Added canonical SQL-owned key, sensitivity, and usage-policy controls. Current
  answers are exact-field records; work eligibility is sensitive and
  country-scoped.
- Narrowed fact, version, and source reads to the authenticated candidate within
  their active personal workspace. Saving appends an immutable reviewed version
  through one identity-derived, idempotent, optimistic command.
- Added `/vault/facts` as a real empty-state surface. The résumé fact extractor
  is not connected, so it shows no fixture or inferred facts.
- Added a same-document advisory lock and exact-path checks to failed-upload
  cancellation so an older cleanup cannot remove a newer reservation.
- Added three migrations through `20260812190000`, bringing the repository and
  hosted HireWire ledger to 21. Hosted schema lint reports no errors.
- Changed stale candidate-fact versions and incomplete duplicate commands from
  PostgreSQL serialization errors to explicit non-retryable `PT409` conflicts.
- Split the offline application-packet domain into logical preparation and
  rendered-artifact finalization. The finalizer accepts rendered bytes, derives
  their size and SHA-256 itself, recomputes the logical-artifact and citation
  ledgers, and binds those values plus the renderer release in the packet hash.
- Blocked unresolved fact versions at the packet snapshot boundary, including
  candidate-reviewed **I'm not sure** work-eligibility answers.
- Separated candidate attestation from document-evidence provenance. Exact,
  never-autofill, and protected facts are excluded from narrative model context;
  sensitive requirements remain candidate-owned blockers.

### Not connected

- The résumé fact extractor is not connected. `/vault/facts` is intentionally
  empty until it can produce source-linked facts for candidate review.
- No model, renderer, packet persistence worker, or application-detail packet
  review runtime exists. No browser fill or submission was added.

### Verification boundary

- **Verified live:** candidate-profile run `20260812195628` passed all 13
  required checkpoints and cleanup after all 21 migrations were present. It
  proved anonymous and direct-write denial, two ordinary personal candidates,
  stable command replay, mismatched replay rejection, database-owned policy,
  candidate-self and cross-tenant RLS, append-only updates, explicit `PT409`
  stale-write denial, unresolved sensitive answers, immutable versions, exact
  service accounting, and cleanup.

## 2026-08-12 — grouped candidate navigation

### Implemented in the repository

- Restored a shared authenticated sidebar across Application Kits, application
  detail, and Résumé.
- Mounted that shell in one URL-transparent App Router layout so the sidebar,
  account controls, and mobile navigation persist while candidate pages change.
- Derived the active sidebar item from the current route, keeping Résumé active
  on `/vault` and Application Kits active on Queue and application detail.
- Grouped destinations under Prepare, Apply, and Interview. Application Kits
  and Résumé use their real persistent routes; unbuilt destinations are
  disabled and labeled Soon.
- Renamed the Queue page heading to Application Kits while preserving the
  Queue as the underlying newest-first source-of-truth model.
- Replaced the desktop top navigation with a fixed compact sidebar. Mobile uses
  a sticky header and focus-managed drawer with the same hierarchy.
- Moved application search into the Application Kits list header instead of the
  global shell.

### Not connected

- Cover Letters, Auto Apply, Search, Saved, Interview Buddy, and Mock
  Interviews have no candidate routes or working controls yet. No fixture data,
  fake toggle, or placeholder page was added.

## 2026-08-12 — Career Vault résumé intake

### Implemented in the repository

- Restored Career Vault as a persistent authenticated route at `/vault`; no
  browser-local sample state or candidate-facing mock résumé data returned.
- Added PDF and DOCX upload with filename, media-type, size, signature, document
  complexity, text-length, PDF-page, timeout, and encrypted-file checks.
- Stored original bytes in the private Supabase Storage `career-vault` bucket.
  Each upload uses one non-upsert, tenant-scoped reserved path and records the
  source hash, byte size, media type, parser release, and scan truth.
- Added deterministic PDF and DOCX text extraction. Scanned/image-only PDFs stop
  with `OCR_REQUIRED`; OCR is not implemented.
- Added immutable Postgres records for upload reservations, source versions,
  extraction attempts, and candidate text reviews. A replacement appends a new
  version and does not displace the reviewed version unless extraction succeeds.
- Added candidate review/edit, replace, and permanent-delete controls. Deletion
  removes private Storage objects before a service-owned database purge and
  remains recoverable when the request is already `DELETION_PENDING`.
- Added seven forward migrations from `20260812150302` through
  `20260812182500`, bringing the repository migration count to 18. The final
  hardening closes stale-review retries, duplicate logical résumés during
  deletion, incomplete extraction replay checks, citation purge, and
  failed-upload cancellation races.
- Added a bounded hosted Career Vault acceptance and cleanup harness.
- Tightened DOCX preflight to 256 entries, 8 MiB expanded total, 4 MiB per
  part, and a 200:1 per-entry expansion ratio; wrapped PDF opening in a bounded
  timeout. These are alpha defenses, not process isolation.

### Not connected

- Uploaded source versions remain `NOT_SCANNED`. There is no malware scanner,
  quarantine service, or isolated parsing worker.
- There is no OCR fallback, résumé fact extraction, retention-policy scheduler,
  or candidate export. The later section above supersedes the earlier absence
  of candidate-reviewed exact answers.
- Reviewed résumé text does not yet feed a company-research, model-drafting,
  renderer, application-packet, browser/CUA, approval, or submission runtime.

### Verification boundary

- **Verified locally:** all 77 deterministic tests pass, including bounded PDF
  and DOCX extraction, hostile-compression rejection, failed-upload cleanup,
  and hosted-acceptance configuration guards.
- **Verified live, narrower scope:** Milestone 0 run `20260812135034` still proves
  the first 11 migrations, Auth/RLS foundation, pasted-link intake, Queue/detail,
  outbox recovery, and one official-source resolution.
- **Verified live:** Career Vault run `20260812170337` passed all 12 required
  checkpoints and cleanup against HireWire after all 18 migrations were
  recorded. It proved upload, review, replacement, tenant isolation, and
  deletion—not model drafting or employer submission.

## 2026-08-12 — hosted foundation baseline

This baseline contains the foundation work completed after `2768e3d`. It is an
accepted engineering milestone, not a tagged product release or a claim that
application execution is available.

### Implemented in the repository

- Replaced the multi-surface sample runtime with one persistent-only candidate
  path: `/` redirects to `/dashboard`, anonymous users are sent to `/login`, and
  authenticated users see an RLS-scoped Queue.
- Added pasted-link intake for supported official Greenhouse, Lever, and Ashby
  posting URLs. The command derives identity from the signed-in actor, records
  one transactional application intake, and grants no submission authority.
- Added a database-backed application detail path for the persistent Queue.
- Made submission copy receipt-gated: a `CONFIRMED` status without stored
  confirmation evidence is shown as `Receipt missing`, never `Submitted`.
- Added Supabase SSR Auth helpers, magic-link confirmation, session validation,
  replay-safe personal-workspace bootstrap, and a fail-closed local test-login
  policy. The local shortcut remains hidden without all development-only gates.
- Added 11 forward SQL migrations through `20260812134739`, covering identity
  and tenancy, the shared job catalog, application runtime, Career Vault and
  immutable packet records, worker/outbox commands, intake deduplication,
  dead-letter recovery, tenant cleanup, and foreign-key indexes.
- Added fixed-origin Greenhouse, Lever, and Ashby parsing, normalization, bounded
  fetching, direct-link resolution, and safe unsupported-link handling.
- Added a leased one-shot `application.queued` worker that resolves and versions
  one supported official posting. A canonical-URL conflict reuses the existing
  job only when it belongs to the same source listing; otherwise the worker
  fails closed.
- Aligned catalog timestamps to one normalized observation time and translated
  the ingestion value `UNSPECIFIED` to the database value `UNKNOWN` before
  persisting work mode.
- Fixed the application-detail runtime date formatter by replacing an invalid
  `Intl.DateTimeFormat` option combination with an explicit UTC formatter and
  deterministic regression tests.
- Normalized provider-encoded Greenhouse markup before persistence and again at
  the read boundary for older immutable job versions, so application detail
  renders plain job text instead of literal HTML tags.
- Suppressed unknown or unspecified work-mode and employment labels from the
  candidate-facing application header.
- Added capped exponential retry, a terminal dead-letter transition after five
  failed claims, support-only inspection, optimistic requeue, and an immutable
  recovery record.
- Reject successful official ATS responses that do not advertise a JSON media
  type, preventing an HTML response from entering normalization.
- Added a repository-owned Markdown link validator and made it a CI gate.
- Added provider-neutral domain contracts for immutable evidence-bound packets
  and browser-session lifecycle. The in-memory browser implementation is
  isolated under test support and cannot provision a real browser.
- Added deterministic no-slop, provenance, evidence-citation, sensitive-answer,
  replay, expiry, failure, and idempotency checks.
- Expanded CI to run tests, TypeScript checking, lint, documentation-link checks,
  and the production build.
- Removed synthetic workspaces, browser-local persistence, Browse, Swipe,
  Career Vault fixtures, the landing experience, and the sample runtime. The
  only in-memory replacement is an explicit computer-session test adapter.
- Removed all candidate-facing mock data. Deterministic fixtures and the
  computer-session adapter remain under test-only code and cannot enter the
  runtime dependency graph.
- Removed candidate-facing internal IDs, operational labels, and redundant
  section copy; Queue ordering and displayed dates now both use `queued_at`.
- Removed the obsolete browser-local vertical-slice document from the active
  corpus; Git history remains the source for the retired sample runtime.

### Not connected

- No production document upload, scanner, parser, or reviewed Career Vault flow
  was present in the baseline. The newer section above supersedes this item for
  the current worktree.
- No model drafting, company-research provider, PDF/DOCX renderer, or artifact
  upload path.
- No durable packet-preparation workflow, live browser/CUA driver, ATS form
  fill, approval consumption, submit, human takeover, confirmation capture, or
  live application receipt. Application execution remains unbuilt.
- No iMessage, SMS, email, push, billing, analytics, support, export, or deletion
  workflow.
- Nothing in the repository can submit a real job application.

### Verification

- **Verified live:** HireWire development run `20260812135034` passed anonymous
  denial, two-user Auth and RLS checks, stable bootstrap, command replay and
  mismatch rejection, canonical-URL deduplication, Queue/detail reads, bounded
  dead-letter recovery, one official-source worker resolution, and cleanup.
- **Verified live:** the local and hosted migration ledgers matched through
  `20260812134739` before the accepted run.
- **Verified locally against hosted data:** the development-only normal Supabase
  test session pasted and resolved a real Anthropic Greenhouse posting, reloaded
  it from the persistent Queue, opened application detail without a runtime
  error, and fit both Queue and detail at 390 px without horizontal overflow.
- Local tests, typecheck, lint, documentation-link checks, production build, and
  whitespace checks pass in the current worktree.
- Anonymous route smoke tests pass: `/` redirects to `/dashboard`, protected
  routes redirect to `/login`, and `/login` plus the 390 px QA route return 200.
- No model call, browser session, employer portal, submission, or external
  confirmation was verified.
