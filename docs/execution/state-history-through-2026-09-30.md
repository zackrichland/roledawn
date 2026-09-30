---
title: RoleDawn state history through 2026-09-30
status: historical evidence; not current operating instructions
owner: founder, product, and engineering
last_updated: 2026-09-30
scope: dated observations formerly accumulated in current-state.md; superseded statements retain their original observation period
---

# State history through 2026-09-30

This is an archived chronology, preserved during the independent review. Each
section describes its own observation period. The older sections retain
statements that later work superseded, including the pre-submission foundation
and early sign-in behavior. Do not use these as current instructions. Read
[current state](current-state.md) and the [application playbook](application-playbook.md)
for the active snapshot and operating rules.

The presentation-ready system, stack, data-flow, assumptions, and build order
are in [architecture at a glance](../architecture/architecture-at-a-glance.md).

## Second confirmed application and standing answers — 2026-09-30 01:26 UTC

**Verified end to end:** Carvana Strategy Analyst, whose form requires a GPA multi-select, was submitted at 01:26:15 and confirmed at 01:26:26. The emailed code was read from Gmail 6 seconds after Greenhouse asked for it. The final pass took 262 s from claim to receipt. Two earlier passes stopped on the GPA field. The cause was platform-specific: React Select marks options `aria-selected` on Linux (the hosted browser) but not on a Mac, and the reader refused that. Fixed and covered by a Linux-platform test (D-113 follow-up).

**Deployed:**
- Standing answers (D-117): questions new to the candidate are matched to their saved answers and filled in the same pass. The founder's ten standing answers are saved.
- Worker events and `npm run ops:status` timelines (D-116).
- One-pass remembered answers (D-115).
- Automatic retries of transient stops (D-114).

**Board templates:** eleven ATS templates for the form agent are in [docs/boards/](../boards/README.md) (Workday, iCIMS, Oracle, SuccessFactors and others; only Greenhouse is supported today).

## First confirmed application — 2026-09-30 00:04 UTC

**Verified end to end:** a pasted Carvana Greenhouse posting (Specialist, Inventory Quality) was imported, written (documents in 5 minutes), filled in a Browserbase browser by the GPT-6.1 Sol form agent, paused once for nine questions, submitted at 00:03:51, answered by Greenhouse with its emailed security code, and completed with the code RoleDawn read from the candidate's Gmail seven seconds later (verification `USED:MAILBOX`). Greenhouse's confirmation page is stored as the receipt; Home shows Applied. A second job (Data Product Engineer) stopped safely before submitting on an unsupported multi-select GPA question.

**Also live:** remembered answers (D-112): repeat questions are answered from the candidate's earlier answers.

## Production review and fixes — 2026-09-29 (evening)

**Live problems (Verified):** production deploy `6abb4cf0` (05:30 UTC) was published without a build, so every `/_next/static` script and stylesheet returns 404; pages without cached files do not work (the application page shows "Something didn't load"). Production `/login` signs every visitor into the founder's account. Two Carvana applications stay "Confirming" after unmet Greenhouse code challenges and block new sends for those jobs. 0 applications are confirmed.

**Fixed and deployed (`6abc4897`, Verified):** scripts and styles load again and build files are no longer public; single-account sign-in requires the private access key (D-109); GPT-6.1 Sol form agent (D-108); writing-lint talk-down fix (D-110); Gmail code search and rate-limit handling; Browserbase 402/429 messages; an unmet employer code is final `NOT_ACCEPTED` with one automatic retry, and applications can be archived (D-111, both migrations applied and recorded). All seven earlier test applications are archived; Home starts empty.

**Healthy (Verified, read-only audit):** row-level security on all 66 public tables with no anonymous grants; all 32 generated files present in private storage; background lanes current; repository and hosted migrations in sync apart from the known 2026-08-19 version drift; no leaked Browserbase sessions. Browserbase is on the Developer plan (25 browsers).

See the [application playbook](application-playbook.md).

## Gmail codes and the needs-you panel — 2026-09-29

**Deployed:** a Home row that needs the candidate says what ("Enter code", "Answer 9 questions"); one click opens a side panel with the application page's own controls; the tab title counts what needs you (D-107). "Connect Gmail" (read-only) is live under Profile → Preferences; with it, the worker reads Greenhouse's emailed code itself while a send waits (D-106). Migration `20260929010000_candidate_mailbox_codes.sql` is applied and recorded; `ROLEDAWN_MAILBOX_TOKEN_KEY` is set as a production secret.

**Connected (Verified):** the Google OAuth client (`GOOGLE_MAILBOX_CLIENT_ID`, `GOOGLE_MAILBOX_CLIENT_SECRET`) is set in production, and the founder's Gmail is connected; the sealed connection row exists in `private.candidate_mailbox_connections`.

**Not yet proven live:** the first fresh application after connecting (Carvana, Legal Technology Specialist) failed safe at `PROVISIONING` before any page opened. Browserbase answered HTTP 402, "Free plan browser minutes limit reached." Nothing was sent, and no attempt exists, so Try again remains available. Reading a real Greenhouse code from Gmail is still verified only with unit tests and synthetic emails; the parser follows Greenhouse's email wording as described by open-source projects and needs one real email to confirm. That failure now reads `DELIVERY_BROWSER_QUOTA_EXHAUSTED` (402) or `DELIVERY_BROWSER_CONCURRENCY_LIMIT` (429) instead of the generic `APPLICATION_DELIVERY_FAILED`; this change is local and not yet deployed.

## Home queue, ranked Jobs and live delivery fixes — 2026-09-28 (evening)

**Deployed to production:** Home is one paste bar and one status queue (D-101). Jobs opens on roles ranked against the candidate's profile, with a side panel for the full posting and one-click Apply into the queue. Greenhouse delivery uses Greenhouse's embedded form (D-102). Unchanged dropdown menus are reused between inspections, and an autopilot run gets 540 s inside a 600 s lease (D-104). Lever's hCaptcha loader is admitted as a passive score (D-104).

**Verified (read-only):** the production observer reads all 15 fields of the live Carvana posting through the embed route with no takeover and no non-read request. A cached inspection of that form takes 2.1 s, down from about 22 s. With the loader admitted, a live Lever form loads hCaptcha's passive frames.

**Live runs (one real application, Carvana, Analyst, Workforce Management, the founder's own profile and answers):** four runs failed safe before any submission, each exposing one defect that is now fixed: the hosted page redirects to carvana.com (`DELIVERY_STEP_UNSUPPORTED`); inspections were too slow for the 240 s budget (`AGENTS_FILL_CANCELLED`); the E.164 phone read back in the widget's own format (`AGENTS_FILL_READBACK_MISMATCH`); and the geo-routed upload bucket was not allowlisted (`DELIVERY_UPLOAD_ENDPOINT_UNVERIFIED`). The fifth run filled every field, uploaded the résumé and cover letter, asked nine questions in the app (answered with the founder's answers), and then sent the final request, about three minutes of fill time per run. **Greenhouse answered HTTP 428, not a confirmation.** Its form code treats that response as `captcha-failed`: the invisible reCAPTCHA Enterprise did not accept the cloud browser, and Greenhouse asks the applicant for a security code it emails to them. The application is therefore **not accepted**. RoleDawn recorded the attempt as uncertain (`DELIVERY_RECEIPT_UNVERIFIED`, application `RECONCILING`) and shows "Submission is not confirmed". **Inference:** Greenhouse autopilot from Browserbase will usually need the candidate to supply an emailed code for each application.

**Deployed (D-105):** that email-code step now exists. When Greenhouse asks for a code, the application page (and Home, as "Needs you") shows "Check your email" with a code box; the worker, still holding the page, types the code into Greenhouse's own boxes and resends only the identical application. Migration `20260928230000_autopilot_email_verification.sql` is applied to hosted and recorded. **Second live run (Carvana, Specialist, AI Strategy & Support, 8231506, 2026-09-29):** pasted link → documents written in about 4 minutes → first form pass in about 3 minutes → nine questions answered in the app with the founder's answers → second pass filled, uploaded and sent in about 5 minutes → Greenhouse answered with its emailed-code challenge → RoleDawn showed "Check your email" and waited eight minutes. No code was entered in that window, so the send ended unconfirmed with `DELIVERY_EMAIL_VERIFICATION_TIMEOUT` and was not accepted by the employer. The typing-and-resend half of the step is verified only against the synthetic Greenhouse fixture (right code, wrong code, tampered resend), not yet live.

**Operational constraint (Inference):** the candidate must enter the code within about eight minutes of the email, while the worker still holds the page. Longer waits need a browser session that outlives one background run (a Browserbase keep-alive session) and a notification when a code is needed.

**Form audit (21 live postings, read-only, D-103):** see `tmp/form-audit/` (not committed). Greenhouse postings mostly need candidate answers for employer-specific questions. One of the 11 (DoorDash) needs a location search box and a multi-select the observer does not support. Every Ashby form hands over at its CAPTCHA, and Ashby remains preparation-only.

## Simpler product, story bank and writing v4 — 2026-09-28

**Deployed to production (roledawn.netlify.app, deploy `6abad3bb016355dfce858861`):** a simpler signed-in product with three destinations. Home holds paste-a-link, needs-you items, a profile checklist, autopilot, applications, and top matches (streamed in after the rest of the page). Jobs is ranked catalog search. Profile covers Résumé, Experience, Stories and interview, Answers, and Preferences. Onboarding runs résumé → basics → what you want → stories (optional). The application page shows the status rail, one next step, live previews of the cover letter and résumé, short answers, and a "why this approach" brief with cited research. Under it: the STAR interviewer and story bank (D-088), the editable career profile (D-089), application writing v4 with renderer v3 (D-090), explicit self-identification and logistics answers wired into form filling (D-091), send-when-ready intents with a remembered review-first preference (D-092), whole-catalog matching (D-093), ranked search (D-094), pasted-link import fixes and retry (D-095), the auto-apply stall fix (D-096), large-board catalog commits (D-098), and the no-self-undercutting writing rule (D-099).

**Hosted database:** all nine 2026-09-28 migrations are applied and recorded. The catalog holds 40,382 open roles from 436 of 437 reviewed boards; Amplitude's board returns 404 and needs registry review.

**Verified:** 680 of 680 unit tests, lint, typecheck, a production build, and all 78 migrations plus six checks in the local harness. One review-first application (GitLab, Staff Forward Deployed Engineer) ran end to end through preparation and kit/4 writing against the hosted database, and its documents, answers and research brief render on the application page locally and in production. After the policy change in D-099, a fresh offline draft of the same posting had no self-undercutting lines, no repeated phrases, and no unsupported claims. Production checks: `/login` forwards to the pinned test session, worker health returns 401 without credentials, catalog and cleanup lanes ran on the new release, and page requests completed server-side in 3.1 s or less.

**Not yet verified:** a real employer submission with the new answer mapping, and the interview end to end with the candidate. Supabase reported degraded API gateway performance throughout 2026-09-28; the app now cuts stalled reads at 6 s and retries once (15 s for large matching reads).

## Applications, matching and account auto-apply — 2026-09-16

**Testing access update, 2026-09-17:** the founder requested temporary shared access pinned to the existing test account. The deployed app opens that account automatically and hides sign-in, sign-out and switching. Ordinary Supabase sessions and RLS remain in use. [Single-account testing](single-account-testing.md) records acceptance and the flag that restores authentication.

**Deployed and verified with synthetic acceptance:** Applications now contains a profile-ranked shortlist, editable preferences, default-off auto-apply and recent individual application history. All jobs remains the full catalog. Matching scans fresh inventory before ranking, uses approved evidence and explicit preferences, and separates relevance from supported delivery. Standing opt-in creates immutable per-job applications; attempts are limited to one per hour and 24 per UTC day. Pause cancels unsent automatic work, profile changes pause consent, and uncertain submissions retain their reconciliation path. Lever adds a concrete hosted delivery adapter; Ashby remains preparation-only.

Acceptance, deployment and remaining limits are recorded in [matching and auto-apply acceptance](matching-and-auto-apply-acceptance.md). The dated sections below preserve their earlier scope.

## Catalog and hosting update — 2026-09-16

**Verified:** 25 reviewed sources, 5,879 fresh open jobs, daily source polling with recovery/backoff, seven-day stale exclusion, guarded closures, and successive cursor pages. The main navigation is Profile, Jobs and Applications. A full hosted synthetic delivery recorded exactly one receipt and cleaned all scoped records and provider sessions. See [hosting acceptance](catalog-and-hosted-workers-acceptance.md) for operational activation and [full-stack delivery proof](application-autopilot-acceptance.md).

## Application autopilot and writing update — 2026-09-16

**Implemented:** profession-neutral owned writing policies loaded for every new draft, content-hash provenance, a combined PDF plus four separate files, a single named-job **Apply for me** action, durable authorization, acknowledged uploads, adapter-defined page navigation, one-use final request dispatch, receipt export, pause/cancel and missing-answer continuation after a browser restart. Existing fill-only authority does not permit submission.

**Verified controlled acceptance:** the real Agents API completed two passes across two fresh local browsers, six model tool actions, two exact-byte uploads, a missing-answer round trip and one synthetic final submission with a receipt. Three model sessions received deletion acknowledgements. No employer application was submitted. Teacher, nurse and finance synthetic packets passed extraction and visual rendering checks. A fresh live synthetic teacher draft under the tuned writing policy passed citation, semantic and quality gates, then built all five QA-passed artifacts. Mobile/desktop action and question controls were rendered with no horizontal overflow. See [current acceptance evidence](application-autopilot-acceptance.md).

**Remaining:** real-employer end-to-end acceptance, broader ATS adapters, official conditional-schema binding, remote/virtualized custom menus, account/CAPTCHA handoff and generalized answer reuse. The current concrete delivery adapter targets US Greenhouse hosted boards; configured multi-page test coverage does not establish support for every ATS. The current Netlify deployment and scheduled-worker evidence are tracked in [hosting acceptance](catalog-and-hosted-workers-acceptance.md).

## Earlier bounded-fill update — 2026-09-16

**Implemented:** the managed OpenAI Agents API form driver, native/static ARIA controls, independently validated narrative answers, durable tool replay, batched candidate questions, and same-browser continuation. Local configuration selects the new driver. Browserbase still provides the browser; the API supplies the Codex harness.

**Verified:** the existing key works; the final live synthetic two-pass form completed nine tool actions, verified custom dropdown selection, and received deletion acknowledgements for both provider sessions. Four new/forward migrations are hosted. Runtime and question persistence passed 17 and 11 hosted rollback assertions respectively; no synthetic candidate/run/question rows remained. Mobile and desktop question layouts were browser-rendered. See the [acceptance record](agents-application-execution-acceptance.md) for the final validation and scope.

The bounded-fill lane remains available; the newer delivery lane above adds submission authority separately. No employer application has been submitted by these acceptance runs.

## Live foundation recheck — 2026-08-18

**Verified live:** the founder-owned HireWire development project is healthy,
uses PostgreSQL 17, and contains the 45-migration activation baseline. The
hosted ledger now includes release-2 application-quality enforcement, candidate
onboarding and search profiles, separate candidate names, the corrected résumé
and application-specific eligibility readiness checks, the service-only
Browserbase Live View binding, retained-runtime release reconciliation, and
stale Application Kit refresh.

Durable dogfood candidate, résumé, evidence, job, and application state exists.
The founder application was refreshed after its candidate input epoch changed.
Its current release-2 revision is bound to the current epoch and has one
official-posting research bundle plus exactly four private QA-passed artifacts.
The prior revision and files remain immutable history. Submission attempts and
receipts remain empty. A reviewable revision is not proof of employer
submission.

**Verified hosted counts on 2026-08-18:** one durable candidate, one persisted
résumé, 17 evidence items, 480 jobs, and 492 job versions exist. Of the jobs,
464 are open. The founder application now has
durable fill and computer-session history from the no-submit acceptance;
submission attempts and receipts are still zero.
The only polling-enabled, allowlisted source is Anthropic's Greenhouse board.
The latest successful poll observed 464 jobs.

The exact-snapshot research/drafting contracts, strict provider-output parser,
provider-safe context projection, immutable revision provenance, server-only
Terra adapter, separate semantic-entailment check, exact-fact merge,
deterministic PDF/DOCX renderer, private artifact persistence, atomic writer,
candidate download route, material review, fill-only authorization, exact
execution materialization, provider-neutral coordinator, and stale-work
recovery are implemented. A live Browserbase synthetic acceptance verified
API-key project inference, Playwright CDP connection, exact-origin and no-submit
guards, metadata lookup, explicit release, and zero outbound submission
requests. A long-running worker service now owns independent catalog,
preparation, kit, and fill lanes with bounded backoff, health endpoints,
redacted logs, and safe lane isolation. It passed a live local run against
HireWire, but no host deploys it yet. There is still no broader company-research
provider, completed real ATS fill, or employer submission. The real Anthropic
Greenhouse form has now passed a no-disclosure fail-closed preflight, described
below.

**Earlier verified live blocked preflight:** one authorized
`worker:once` run claimed and completed preparation run
`35fa282c-4c2a-4cb4-929f-7fef96de056f` for application
`681215c7-0d80-4420-ba13-c4af20296c0d`. It committed immutable input snapshot
`a0238d65-4740-465c-80e7-65a8b3c882e1` with candidate input version `1`, one
approved exact-fact reference, no approved narrative-evidence references, and
readiness `BLOCKED`. The typed blocker was `RESUME_REQUIRED`; the application
remains `NEEDS_USER`. The worker summary was one claimed, one completed, and
zero failed. No revision, artifact, approval, attempt, submission, or receipt
was created.

**Verified live founder dogfood seam:** the existing dogfood identity is aligned
across the candidate, current legal-name fact, personal workspace, and Auth
display metadata without reproducing the identity value here. The founder-
selected Phoebe résumé is `READY` after one-page deterministic extraction of
3,353 normalized characters with zero warnings; its source remains truthfully
`NOT_SCANNED`. Segmenter `resume-passages/2` produced 17 exact source-linked
items. Candidate-authorized review approved 12 and left five in
`NEEDS_REVIEW`.

Preparation run `559ec07c-5193-4fda-b3a7-a68be103095b` committed immutable
snapshot `a6a98e45-305b-496f-bd46-754b870a2a4b` as
`READY_FOR_DRAFTING` with zero blockers, 12 approved evidence-version
references, and one approved exact-fact reference. The Application Kit worker
consumed its drafting message. The first attempt failed closed on timestamp
parsing; replay succeeded on attempt two. The run is now
`SUCCEEDED / COMPLETE`, the application is `READY`, and the outbox message is
published. Revision `8e3c1680-39f7-4211-9157-f04582bdeaed`, research bundle
`40df390d-2d4b-44bf-829f-f4d8b58ddf98`, and exactly four private QA-passed
artifacts exist. No approval, attempt, or receipt was created.

That revision is retained as historical release-1 evidence. After the candidate
input epoch changed, hosted fill authorization rejected it as stale. The
deployed refresh command queued a replacement, and the worker produced current
revision v2 with the candidate input epoch matched and exactly four new private
QA-passed artifacts. The accepted run followed a strict OpenAI claim/citation
schema correction. This is hosted release-2 pipeline evidence, not a claim that
the writing has passed a broad candidate-outcome benchmark.

**Verified live résumé persistence:** hosted migration
`20260817044053_harden_resume_candidate_scope` is deployed. The current
integrity audit found one candidate, one logical résumé, one immutable source
version, and zero duplicates, orphans, broken current selections, missing
review, missing Storage, or inconsistent finalization. An authenticated browser
reload of `/vault` showed the same reviewed v1 résumé filename and text.

**Verified live catalog slice:** `anthropic` is the only allowlisted polling
tenant. The latest worker-service run completed with 464 observations and then
returned to idle. The current catalog has 480 jobs, 464 open jobs, and 492
immutable versions. Earlier hosted acceptance run `20260816235350` passed all
12 catalog checkpoints plus cleanup, including ETag replay and candidate-action
isolation. Search uses opaque cursor pagination at 24 roles per page. The
worker-service process is implemented and locally accepted, but not deployed.

**Verified current advisors:** the post-migration security run still reports
intentional deny-all RLS notices, authenticated `SECURITY DEFINER` warnings that
require function-by-function production disposition, and the hosted Auth
password-protection warning. The performance run is dominated by unused-index
notices on a low-traffic development project plus the Auth connection-strategy
advisory. These are not production sign-off.

**Verified live Browserbase synthetic session and 2026-08-17 recheck:** a fresh
60-second session again reached only `https://example.com`. It used no proxy,
CAPTCHA solving,
recording, candidate data, artifact, employer data, or ATS page. RoleDawn
connected over CDP, found exactly one metadata-bound session, blocked DOM
submit, unsafe `POST`, post-load `GET`, WebSocket attempts, and
Service Worker registration. The hardened rerun reported
`service_worker_blocked=true`, all previously accepted checks remained true,
zero outbound submission requests were reported, and explicit release reached
final `COMPLETED` state. Repository tests also verify that untracked
`requestfailed` events are counted and that a session is explicitly released
if CDP provisioning fails; the successful live rerun did not force that failure
branch. No key, project ID, session ID, or provider URL is retained in the
repository record. See
[Browserbase live no-submit acceptance](browserbase-live-acceptance.md).

**Verified controlled founder fill:** the refreshed revision's two private
PDFs were downloaded and verified by byte count and SHA-256 before entering a
Browserbase session. The Greenhouse-shaped controlled fixture filled and read
back eight frozen reviewed ordinary fields, uploaded both PDFs, kept Submit
disabled, observed zero outbound submission requests, and contacted no
employer.

**Verified real-form fail-closed path:** the candidate UI created the fill-only
authority, the database supplied the exact revision, and Browserbase opened the
public Anthropic Greenhouse job. Preflight found two required protected/legal
fields and stopped before disclosure. The attempt entered `TAKEOVER` with zero
fields filled, zero uploads, zero outbound submission requests, no submission
attempt, no receipt, and no employer contact. After the provider session became
terminal, uncertain telemetry reconciled the computer session to `FAILED_SAFE`;
the candidate-facing takeover state was preserved rather than misreported as a
submission.

## Three-system placement

RoleDawn's core product is organized into [three systems](../architecture/three-system-product-architecture.md):

| System | Current implementation |
|---|---|
| Candidate Intelligence | Private candidate-owned résumé source/reviewed text, candidate-attested exact answers, exact source-linked evidence review, four-step onboarding, search goals, and a database readiness gate are implemented. Founder dogfood has one persistent reviewed résumé with 12 approved and five review-pending passages; OCR, malware isolation, story development, voice policy, and export remain open. |
| Opportunity Intelligence | One Anthropic Greenhouse source is allowlisted and was refreshed by the live worker-service proof; canonical versions, Search, Saved, queueing, candidate search preferences, and deterministic fit explanations are implemented. Deployment, broader sources, watchlists, persisted assessments, and learned ranking remain open. |
| Application Delivery | Persistent Application Kits, immutable inputs, deployed release-2 quality enforcement and stale refresh, official-posting research, strict output parsing, deterministic and semantic validation, server-side exact-fact merge, four private PDF/DOCX artifacts, material review, single-use fill authority, exact execution materialization, provider-neutral session/recovery code, controlled Browserbase artifact fill, candidate-owned Live View lookup, and deployed retained-runtime reconciliation exist. The real Anthropic form reached a zero-disclosure `TAKEOVER`; completing a real form, candidate intervention, Submit, confirmation, and receipt remain open. |

Identity, tenancy, commands, events, outbox, policy, and future workflow/model/browser adapters are one shared control plane, not a fourth product system.

RoleDawn is a trust-first career agent. The current executable product is a
persistent-only **Applications** view over one signed-in candidate's Queue:
paste a supported official job URL, create durable preparation intent, inspect
the database-backed application record, and see an honest status. The candidate can also upload one
PDF or DOCX résumé, review or edit its extracted text, replace the source, and
delete the source plus saved text; review exact source-linked passages with
approve/edit/reject/use controls; and save reviewed application answers for
identity, contact, city/region/country, and country-scoped U.S. or Canada work
eligibility. Search and Saved read from the shared allowlisted catalog, and one
current job version can start an application. A preparation worker can
now freeze the exact current inputs, stop with a candidate-readable blocker, or
emit the named drafting request after deterministic preflight. An
worker-service kit lane can research the official posting, generate and
validate one revision, render four private files, and expose authenticated
downloads when the service is running. The candidate can release that exact
revision for fill only. A
provider-neutral worker can materialize the authorized values and bytes. A
Browserbase adapter and deterministic Greenhouse-style driver exist. A managed
session opened the public Anthropic Greenhouse form and failed closed before
candidate disclosure when two required protected/legal fields were found. The persistent
control plane, one official-source resolver run, the Career Vault lifecycle,
and both blocked and ready preparation paths are verified in the hosted
HireWire development project.

## Current runtime

| Route | Implemented behavior | Boundary |
|---|---|---|
| `/` | Redirects to `/dashboard` | No public sample or landing runtime |
| `/login` | Supabase magic-link sign-in with a preserved safe next route; Google appears only when the hosted provider is enabled | Google code is ready, but HireWire keeps the provider off until the founder accepts Google's User Data Policy and creates the OAuth credentials |
| `/auth/error` | Public recovery copy for expired or failed authentication links and candidate-bootstrap failures | Recovery is explanatory; there is no support workflow or preserved deep-link destination |
| `/auth/confirm` | Exchanges the one-time link for a normal session, bootstraps the personal workspace, and resumes the safe requested route | The callback supports Google; policy agreement, credentials, and hosted-provider activation remain founder actions |
| `/onboarding` | Four resumable steps for reviewed résumé, job goals, exact application answers, and a database-enforced completion check | Missing or unresolved work authorization remains a named-job review item; a fresh-user cross-device acceptance is still required |
| `/dashboard` | Authenticated, RLS-scoped newest-first Applications queue and pasted-link intake | Incomplete candidates redirect to onboarding; the worker service is not deployed |
| `/applications/:applicationId` | Database-backed application detail with preparation state, current revision, four authenticated downloads, material changes, stale-file refresh, fill-only authorization, and a live-browser link for an owned active session | Fill authorization is separate from Submit. Hosted refresh and retained-runtime reconciliation are deployed; one real-form run reached safe takeover, but candidate intervention and Submit have not passed acceptance |
| `/vault` | Private candidate-owned résumé upload, deterministic PDF/DOCX transcription, review/edit, replacement, persistence across reload, and deletion | Uploaded versions remain `NOT_SCANNED`; no quarantine, isolated parsing, or OCR |
| `/vault/facts` | Exact source-linked résumé evidence with review progress, source excerpts, approve/edit/reject, attestation, and allowed-use controls | Hosted 10-checkpoint acceptance passed; no AI story extraction or Candidate Evidence Snapshot |
| `/vault/answers` | Candidate-reviewed reusable application answers | Exact-field identity/contact/location plus country-scoped U.S./Canada work eligibility; hosted acceptance passed |
| `/search` | Search and filter current jobs in 24-role pages; see deterministic fit status/reasons; save or start one application from an immutable job version | Fit is advisory and read-time; source breadth is Anthropic only |
| `/saved` | Candidate-private saved-job view with the same fit explanation, pagination, remove, and start-application actions | Saving never creates an application; starting one creates preparation intent only |
| `/mobile-preview` | Non-indexed internal QA frame for the authenticated `/dashboard` route at 390 px | Internal responsive test utility, not candidate navigation or a sample-data product route |

The authenticated shell exposes only working destinations: **Profile** under
Prepare, then **Applications**, **Search jobs**, and **Saved jobs** under Apply.
Profile contains Résumé, Experience, and Application answers. Unbuilt roadmap
destinations are hidden instead of appearing as disabled **Soon** rows. The
shell is mounted by one URL-transparent shared layout, so candidate route
changes replace workspace content without remounting the sidebar. Browse,
Swipe, the marketing landing experience, and the browser-local sample workspace
are not runtime destinations. Profile is database-backed.
The only in-memory implementation is an explicit computer-session test adapter.

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
- Shared responsive authenticated shell in a persistent candidate layout: fixed
  grouped desktop sidebar, focus-managed mobile drawer, working destinations
  only, and route-level loading, error, and not-found recovery.
- Persistent Career Vault with one logical résumé per candidate, a private
  source file, deterministic transcription, candidate text review, replacement,
  and deletion.
- Candidate-reviewed application answers with an explicit key allowlist,
  candidate-owned attestation, exact-field policy, country-scoped sensitive
  work eligibility, and unresolved **I'm not sure** values.
- Exact passages derived deterministically from the latest reviewed résumé;
  immutable source citations and review versions; candidate approve, attested
  edit, reject, and allowed-use controls in `/vault/facts`.
- Search and Saved over current allowlisted job versions, with candidate-private
  save state and replay-safe queue-from-catalog commands.
- An Application Kit preparation panel that reads committed stage and snapshot
  readiness, shows one typed next action, and can request a fresh preflight run.
- A candidate Application Kit detail view that reads the current revision,
  exposes four authenticated signed downloads, shows the material résumé and
  cover-letter changes, lists mandatory takeover conditions, can issue one
  revision-bound fill-only authorization, and states the no-submit boundary.
- Fail-closed handling when authentication or the persistent backend is
  unavailable.

### Database and runtime contracts

- Forward migrations through default-privilege hardening and the fill-to-review
  foundation:
  identity/tenancy, shared job catalog,
  application runtime, Career Vault/packet records, foreign-key indexes, leased
  worker commands, intake-deduplication/dead-letter recovery hardening, and
  tenant-cleanup corrections, plus résumé upload reservation, extraction,
  review, explicit evidence purge controls, race-safe reservation cancellation,
  candidate-reviewed fact persistence, explicit non-retryable fact conflicts,
  candidate evidence passages/reviews, opportunity catalog commands,
  exact-document purge coverage for candidate evidence, immutable application-
  input snapshots with preparation claim/commit/retry commands, and v2 evidence
  segmentation, plus exact-snapshot research and application-revision
  provenance, candidate-specific résumé RLS, the atomic Application Kit
  runtime, remaining candidate-evidence FK coverage, and default-deny future
  database grants, plus action-scoped fill authorization, fill attempts,
  computer sessions, private provider references, append-only checkpoints,
  execution leases, and fail-safe recovery. See the fill acceptance record for
  exact migration names and hosted versus local evidence.
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
- The catalog worker leases one due allowlisted source, uses a fixed-origin
  provider adapter, commits complete observations and immutable current job
  versions, reconciles closure only from a complete snapshot, persists ETags,
  and records `NOT_MODIFIED` or bounded failure outcomes. The long-running
  service can schedule this lane, but that service is not hosted yet.
- The preparation worker claims one version-bound application run, freezes the
  current reviewed résumé and approved evidence/fact version references under
  a candidate input epoch, commits one immutable Application Input Snapshot,
  and emits either a typed blocker or a later drafting handoff. Snapshot commit
  rechecks the same epoch and eligible version sets before publication.
- The Application Kit worker revalidates the frozen snapshot, researches only
  the official posting, parses strict Terra output, runs deterministic and
  semantic gates, merges exact facts outside the model, renders four files,
  verifies their bytes, stages them privately, and commits revision provenance
  and artifact rows atomically before publishing the outbox message.
- Two-stage immutable application-packet rules for candidate attestation versus
  document evidence, evidence citations, truthful resume modes, material diffs,
  no-slop validation, sensitive-answer abstention, narrative model-context
  exclusions, and a finalizer that hashes rendered bytes itself and recomputes
  its logical artifact and citation ledgers before sealing.
- A provider-neutral fill coordinator with no Submit method, required origin
  and network guards, database-session idempotency, bounded teardown, and
  redacted terminal results.
- A service-only execution materializer that releases only exact authorized
  fact values and four hash-verified private artifacts to the driver.
- Lease-fenced recovery: stale provisioning may resume only under the same
  computer-session ID; active or disclosure-possible work fails safe instead
  of being driven twice.
- A real local Chrome synthetic-ATS harness under test support. It fills and
  uploads, performs read-back, leaves sensitive uncertainty unresolved, and
  observes zero submit requests. It is not a live runtime provider.

### Local verification

- The current deterministic suite covers bounded PDF/DOCX extraction,
  application-input snapshot determinism, Application Kit entailment, exact
  artifact-set enforcement, fill authorization parsing, fact/artifact
  materialization, idempotent provider provisioning, recovery, teardown, and
  the real-Chrome no-submit interlock. Record the exact count from the final
  gate rather than copying an earlier result.
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
process isolation, OCR, source-linked résumé facts, packet generation, browser
fill, or employer submission.

The cleanup artifact for the run is intentionally local and ignored. It records
the exact ephemeral identities required for bounded cleanup; it is not product
data or application evidence.

### Hosted candidate-profile acceptance

**Verified live:** regression run `20260816235136` completed against the
then-current 24-migration baseline. Thirteen checkpoints plus cleanup proved
anonymous and direct-write denial, two ordinary personal candidates, stable
command replay, payload-mismatch rejection, canonical database-owned policy,
candidate-self and cross-tenant RLS, append-only updates, explicit non-retryable
`PT409` stale-write denial, unresolved sensitive answers, immutable evidence
versions, exact service accounting, and cleanup.

This verifies the reviewed application-answer persistence boundary. It does not
verify résumé fact extraction, packet generation, browser fill, approval
consumption, or employer submission. See the
[candidate-profile acceptance record](candidate-profile-hosted-acceptance.md).

### Hosted candidate-evidence acceptance

**Verified live:** run `20260816235101` passed all 10 checkpoints plus cleanup.
It exercised two real candidates, one reviewed résumé source, deterministic
proposal ingestion, stable command replay, two-user isolation, direct-write
denial, approve/edit/reject/use review, edit attestation, explicit stale-write
denial, and immutable history with citations. Cleanup exercised
`include_candidate_evidence_in_document_purge`: a candidate-requested,
service-completed exact-document deletion removed the passages, evidence items,
versions, and citations for that document while ordinary direct mutation
remained blocked.

This accepts the source-linked evidence review and deletion boundary. It does
not accept Candidate Evidence Snapshot assembly, story generation, packet
drafting, browser fill, or submission.

### Hosted opportunity-catalog acceptance

**Verified live:** run `20260816235350` passed all 12 checkpoints plus cleanup.
It exercised anonymous denial, the allowlisted Anthropic fixture, two real
candidates, the safe 15-field search contract, filters, save/replay/remove,
stale-version denial, replay-safe queueing, preparation-only authority,
candidate isolation, direct table/raw-column denial, and a byte-for-byte
unchanged shared catalog after candidate actions.

This accepts the candidate-facing Search, Saved, and queue-from-catalog
boundary. It does not prove recurring polling, wider source rights, eligibility,
recommendations, match scores, or employer submission.

### Hosted application-preparation preflight

**Verified live:** migrations `20260817011359_bucket3_preparation_snapshots`,
`20260817013109_bucket3_preparation_fk_indexes`, and
`20260817013440_bucket3_snapshot_reference_fk_indexes` are deployed. An earlier
authorized `worker:once` run claimed and completed preparation
run `35fa282c-4c2a-4cb4-929f-7fef96de056f` for application
`681215c7-0d80-4420-ba13-c4af20296c0d`. It committed immutable Application
Input Snapshot `a0238d65-4740-465c-80e7-65a8b3c882e1` as `BLOCKED` with
`RESUME_REQUIRED`. This is the expected fail-closed outcome for a candidate
without a reviewed résumé. The worker reported one claimed, one completed, and
zero failed.

Retry command `2db7c97e-8f2d-43aa-9f52-c25ddc00f8b1` created preparation run
`b73713de-6a01-4e51-a7a4-b05ad4e9546b` and snapshot
`bcfa61e7-e159-46f0-9567-62b14db8220d`. A second worker run again claimed and
completed one message. The snapshot had the same deterministic hash and
blocker. Replaying the command returned the original run and aggregate version;
a new retry at stale expected version `3` failed with `PT409
APPLICATION_VERSION_MISMATCH`. The application ended `NEEDS_USER` at aggregate
version `5` with two input snapshots and no revision or employer-side state.

After the founder résumé and approved evidence were available, preparation run
`559ec07c-5193-4fda-b3a7-a68be103095b` committed snapshot
`a6a98e45-305b-496f-bd46-754b870a2a4b` with candidate input version `84`,
readiness `READY_FOR_DRAFTING`, zero blockers, 12 approved evidence references,
and one approved exact-fact reference. The application advanced to `DRAFTING`
at aggregate version `7`; the preparation run initially waited at
`INPUTS_READY`. The later Application Kit worker completed that run, published
the drafting outbox message on attempt two, and advanced the application to
`READY` with one revision and four artifacts. Approval, attempt, and receipt
counts remain zero.

This accepts the deployed immutable input-freeze and deterministic preflight
seam for both blocked and ready inputs.

### Hosted drafting-provenance foundation

**Verified live:** migration
`20260817025617_drafting_research_and_revision_provenance` is deployed and
aligned with its checked-in file. Every future application revision must bind
one exact input snapshot and one research bundle by ID and canonical hash. A
rollback-only acceptance inserted one valid bundle, one revision, and 12
evidence references, rejected an invalid snapshot hash, rolled the valid rows
back, and ended with zero rows in all three tables. The four revision
provenance columns are `NOT NULL`.

The exact founder snapshot also passed the server-side context read: all frozen
hashes matched, and the provider projection contained only the 12 approved
narrative-evidence items plus job context. Candidate identity, exact application
facts, raw résumé text, and internal document IDs were excluded.

This accepted only the earlier hosted exact-input and provenance seam.
Separately, one local Terra proposal passed strict parsing and deterministic
checks while semantic entailment remained `REQUIRED_NOT_RUN`. Those earlier
acceptances are now superseded for the durable no-submit path by the Application
Kit acceptance below. See
[the hosted acceptance record](application-drafting-foundation-hosted-acceptance.md).
The bounded provider run is recorded in
[live Terra drafting acceptance](live-terra-drafting-acceptance.md).

### Hosted no-submit Application Kit acceptance

**Verified live:** hosted migrations
`20260817044053_harden_resume_candidate_scope` and
`20260817044103_application_kit_runtime` are deployed and aligned with the
checked-in filenames. The worker consumed the founder drafting request. Attempt
one failed closed on timestamp parsing and committed no revision or artifact;
after timestamp canonicalization, attempt two completed and published the
outbox message.

Application `681215c7-0d80-4420-ba13-c4af20296c0d` first produced historical
revision `8e3c1680-39f7-4211-9157-f04582bdeaed`. After the candidate input epoch
changed, the deployed refresh command produced current revision v2 with the
epoch matched and exactly four private QA-passed artifacts. The strict OpenAI
claim/citation schema fix was required before the refreshed worker output could
pass. Authenticated browser QA renders the four current downloads and **No
application has been submitted.** Submit-attempt and receipt counts remain
zero. See the
[Application Kit hosted acceptance](application-kit-hosted-acceptance.md).

### Application fill-to-review foundation acceptance

**Verified hosted control plane:** the fill, recovery, FK-coverage,
retained-runtime release, and stale-packet refresh migrations are deployed. A
rollback-only hosted harness proved stable replay,
one-time `FILL_APPLICATION_ONCE` consumption, action-scoped separation from
`SUBMIT_APPLICATION_ONCE`, session reservation/activation/destruction,
candidate RLS, private provider-reference denial, immutable checkpoints,
source-deletion guards, cross-candidate isolation, `PRE_SUBMIT_REVIEW`, and
zero submit attempts or receipts. A crash drill recovered stale `PROVISIONING`
with the original session ID and returned `FAIL_SAFE_DISCLOSURE_POSSIBLE` for
stale `ACTIVE` without re-driving.

**Verified locally:** the provider-neutral worker materializes the exact
authorized values and private bytes, requires origin and submit-network guards,
uses the database session UUID as the provider idempotency key, destroys the
runtime, and records only redacted output. Recovery may resume stale
provisioning under that same session ID; it never automatically re-drives an
active or disclosure-possible session. A real local Chrome harness filled and
uploaded to a synthetic ATS, left a sensitive attestation blank, and blocked a
deliberate submit request. Authenticated desktop and mobile QA verified the
review and fill-only UI without spending the founder authorization.

See the [fill-to-review acceptance record](application-fill-foundation-acceptance.md).

**Verified live no-submit execution:** the controlled Greenhouse-shaped run
filled eight reviewed fields and uploaded two private hash-verified PDFs with
zero outbound submission requests. The subsequent UI-to-database-to-Browserbase
run opened the public Anthropic Greenhouse form and stopped during preflight on
two required protected/legal fields. It entered `TAKEOVER` with zero fields,
uploads, outbound submission requests, submission attempts, or receipts. The
provider session became terminal; uncertain release telemetry reconciled the
computer session to `FAILED_SAFE` without turning the takeover into a claimed
submission.

## Not connected

- Malware scanning, file quarantine, or isolated parsing workers. Current
  deterministic parsing occurs in the application server after bounded local
  validation and records `NOT_SCANNED` truthfully.
- OCR for scanned PDFs; Candidate Evidence Snapshot assembly, AI-assisted story
  development, voice/presentation policy, retention scheduling, and candidate
  export.
- A deployed catalog scheduler, broader source allowlist, watchlists,
  deterministic eligibility, recommendations, or match scoring.
- Recurring drafting scheduling, broader company research, a richer
  candidate-facing material diff, or renderer-v2 visual parity between PDF and
  DOCX. One official-posting research, semantic validation, atomic revision,
  exact-byte rendering/persistence, and candidate-download path is live.
- Temporal or another durable workflow deployment.
- Completing a real ATS form. The Browserbase connection, guards, controlled
  eight-field fill, real Anthropic form preflight, fail-closed `TAKEOVER`, and
  terminal release reconciliation are accepted. Candidate intervention on the
  protected/legal questions has not passed, and Final Submit, submission
  reconciliation, and externally evidenced receipts remain unconnected.
- iMessage, SMS, email, push, billing, analytics, or support tooling.

Nothing in this repository can submit a real job application. An application
row records preparation intent; it is not evidence of submission.

## Next five actions

1. Apply the pending search-ranking and import-retry migrations to hosted
   (and any reviewed catalog-ingestion migration), then deploy the current
   repository to Netlify so hosted workers run the new pipeline.
2. Finish the candidate profile in the new screens: confirm the résumé,
   answer work authorization, and run the interview.
3. Prepare one review-first application end to end on a supported
   Greenhouse posting; inspect the documents and research brief before
   enabling send.
4. Watch the first real deliveries that use the new self-identification and
   logistics answers; widen option mappings only from observed forms.
5. Monitor first polls for the newly registered boards and fix any large-board
   ingestion failures before adding more sources.

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
