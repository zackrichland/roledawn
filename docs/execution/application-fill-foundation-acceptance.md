---
title: Application fill-to-review foundation acceptance
status: controlled fill, fail-closed takeover, and repository continuation accepted; hosted real-form continuation and Submit remain open
owner: engineering
last_updated: 2026-08-18
scope: refreshed revision-bound fill authorization, exact data materialization, controlled Greenhouse fill, real Greenhouse preflight, retained-runtime continuation and reconciliation, and no-submit safety
---

# Application fill-to-review foundation acceptance

## Result

RoleDawn now has the control-plane seam between a reviewable Application Kit
and a temporary computer. One candidate command may authorize one immutable
revision for **fill only**. The database consumes that authority once, reserves
one computer-session identity, and records append-only redacted checkpoints.
The workflow must stop at `PRE_SUBMIT_REVIEW`.

The original fill-foundation acceptance did not open a managed provider. A
separate [live Browserbase synthetic-session acceptance](browserbase-live-acceptance.md)
first verified API-key project inference, Playwright CDP connection, metadata
lookup, the origin and no-submit guards, explicit release, final `COMPLETED`
status, and zero outbound submission requests against `example.com`.

**Verified 2026-08-18:** a second gated Browserbase acceptance loaded the
refreshed founder revision, downloaded its private résumé and cover-letter
PDFs, verified both byte counts and SHA-256 hashes, and used the actual
Greenhouse driver against a controlled Greenhouse-shaped form on
`https://example.com`. All eight frozen reviewed ordinary fields read back
exactly; both PDFs read back with the expected canonical filenames, MIME type,
byte count, and source hash; optional sensitive fields stayed blank; Submit
remained disabled; the runtime recorded zero outbound submission requests; and
Browserbase ended `COMPLETED`. No employer was contacted.

**Verified 2026-08-18:** the actual candidate UI then issued fill-only authority
for the same current revision. The database materialized the revision and
Browserbase opened the public Anthropic Greenhouse job. Before any disclosure,
the driver found two required protected/legal fields and returned `TAKEOVER`.
It filled zero fields, uploaded zero files, recorded zero outbound submission
requests, created no submission attempt or receipt, and contacted no employer.
The provider session later became terminal. Because release telemetry was
uncertain, durable reconciliation marked the computer session `FAILED_SAFE`
instead of treating missing evidence as zero activity; the candidate-facing
takeover state remained intact.

These hosted acceptances prove controlled cloud fill and real-form fail-closed
preflight. They do not prove hosted candidate continuation, completion of a
real employer form, final submission, employer confirmation, or a receipt.

**Verified in the repository 2026-08-18:** candidate-controlled continuation
now resumes the exact retained fill/session after the candidate confirms that
required questions were completed in Live View. Real-Chromium tests preserve
the candidate's protected or unknown required answer, continue the same page
to review, and keep DOM and network submission blocked. The hosted migration
and a retained Browserbase acceptance are still pending. See the
[dedicated continuation acceptance](application-fill-takeover-resume-acceptance.md).

## Evidence by boundary

| Boundary | Evidence | Accepted result |
|---|---|---|
| Hosted authorization and lifecycle | Forward migrations through `20260819051428_reconcile_retained_browser_runtime_release` and `20260819052544_refresh_stale_application_packet`; rollback-only hosted harness plus founder run | Exact revision and authority hashes are consumed once; stale packets cannot fill; refresh preserves immutable history; fill authority cannot back a submission attempt; session reservation, activation, takeover, terminal release reconciliation, RLS, checkpoints, recovery fencing, and FK coverage passed |
| Exact execution package | `src/server/workers/application-fill-materializer.ts` and deterministic tests | Service-only reads materialize only the authorized fact versions and four private artifacts; fact values, artifact metadata, byte counts, MIME types, and SHA-256 hashes must match before the driver receives them |
| Provider-neutral coordinator | `src/server/workers/application-fill.ts` and deterministic tests | Database session ID is the provider idempotency key; allowed origins and network submit guards are mandatory; no submit method exists on the driver; terminal results are redacted and assert `application_submitted: false` and zero submission requests |
| Lease and recovery | `20260817063813_add_application_fill_recovery_lease`, coordinator recovery tests, and hosted rollback-only crash drill | Stale provisioning recovered the same session ID and replayed reservation; stale active/disclosure-possible work returned `FAIL_SAFE_DISCLOSURE_POSSIBLE` and was not re-driven |
| Real browser no-submit harness | `src/domain/browser-shadow-fill-acceptance.test.ts` and `src/test-support/synthetic-ats-shadow-fill.ts` | Installed Chrome filled four fields, uploaded a PDF, left a sensitive attestation blank, read the form back, and blocked a deliberate `requestSubmit`; the synthetic server observed zero submission requests |
| Managed-browser adapter | `src/server/workers/browserbase-runtime.ts`, `browserbase-runtime.node.ts`, focused adapter tests, and [live synthetic acceptance](browserbase-live-acceptance.md) | Explicit environment gate; API-key project inference; exactly one metadata-bound session; fresh unrecorded, no-CAPTCHA session; CDP connection; bounded TTL; exact-origin, DOM-submit, unsafe-method, post-load-navigation, and WebSocket guards; explicit release; final `COMPLETED`; zero outbound submission requests |
| Greenhouse-style deterministic driver | `src/server/workers/greenhouse-no-submit-driver.ts`, installed-Chrome acceptance, and `npm run acceptance:greenhouse` | Exact first/last/full names and ordinary fields are never derived; reviewed US/Canada work-authorization booleans fill only recognized yes/no select or radio controls; `aria-required` is enforced; unresolved or unknown required values stop before any disclosure; optional EEO stays blank; CAPTCHA, login, OTP/MFA, citizenship, consent, and other sensitive/legal paths stop; no submit method exists |
| Controlled founder artifact fill | `scripts/run-greenhouse-browserbase-acceptance.ts` | One real Browserbase session used the current revision's hash-verified résumé and cover-letter PDFs plus eight frozen reviewed fields; the driver reached `FILLED_TO_REVIEW`, read back all eight fields, uploaded both PDFs, disabled Submit, recorded zero outbound requests, contacted no employer, and released cleanly |
| Real Anthropic form preflight | Actual candidate UI, hosted authority/materialization, Browserbase, and Greenhouse driver | The public job opened; two required protected/legal fields were detected before disclosure; outcome `TAKEOVER`; 0 fields, 0 uploads, 0 outbound submission requests, no employer contact, no submit attempt, and no receipt |
| Retained-runtime release | Process-owned supervisor plus hosted release reconciliation | The provider session became terminal; uncertain telemetry produced a durable `FAILED_SAFE` computer-session state while preserving takeover and creating no submit or receipt record |
| Candidate-controlled continuation | Exact retained-runtime coordinator, additive schema, and real-Chromium tests | An owning candidate confirmation queues one replay-safe resume attempt; the same guarded fill/session continues only under its original no-submit authority; missing, expired, busy, or still-blocked runtimes preserve takeover |
| Runnable worker composition | `scripts/run-application-fill-worker.ts` and `npm run worker:fill` | The plain Node process passes one Browserbase adapter and one no-submit driver through stale recovery first, then claims at most one new fill message; startup fails before provider use unless the explicit Browserbase gate and credentials are present |
| Worker entrypoint shutdown | `scripts/run-worker-service-lifecycle.ts` and `scripts/run-worker-service.test.ts` | Repeated signals share one stop promise; the entrypoint waits for lane shutdown and then `fillRuntimeSupervisor.stop()` before process completion, so retained runtime release reconciliation cannot be abandoned on graceful shutdown |
| Candidate interface | Authenticated desktop and 390-pixel mobile browser QA | Application detail shows the exact four downloads, material résumé and cover-letter changes, fill-only boundary, required stop conditions, and **No application has been submitted.** The shared navigation persisted across Application Kits, Career Vault, Search, and Saved |

## Hosted rollback acceptance

The hosted harness used isolated test identities and rolled back every row. It
verified:

- stable command replay returned the same fill attempt and browser run;
- one fill authorization was consumed once for one application revision;
- that consumption could not satisfy the action-scoped foreign key required by
  `application_attempts`;
- one computer session moved through reservation, activation, and destruction;
- the application reached `PRE_SUBMIT_REVIEW` only after a
  `FILLED_TO_REVIEW` checkpoint;
- authenticated users could read their own redacted lifecycle rows but could
  not insert them or read private provider references;
- checkpoints could not be changed or deleted;
- source deletion could not remove bytes referenced by the active authority;
  and
- cross-candidate reads returned no rows.

The hosted crash drill created one computer session. A stale `PROVISIONING`
claim recovered with its original `computer_session_id`; reservation replay was
idempotent. A stale `ACTIVE` claim returned
`FAIL_SAFE_DISCLOSURE_POSSIBLE`, produced two recovery checkpoints, and did not
re-drive the browser. The transaction contained zero submit attempts and zero
receipts and was rolled back.

## Live managed-browser synthetic acceptance

**Verified live:** one Browserbase session used a 60-second TTL and
`https://example.com` as its only target. The API key inferred the project;
RoleDawn required no project-id setting. Playwright connected over CDP, and the
provider metadata query returned exactly one RoleDawn-bound session. The DOM
submit interlock, an unsafe `POST`, a post-load `GET`, and a
WebSocket attempt were blocked. Adapter accounting remained at zero outbound
submission requests. RoleDawn sent `REQUEST_RELEASE`, and the provider reported
the session `COMPLETED`.

No proxy, CAPTCHA solving, recording, candidate data, résumé, artifact,
employer page, or ATS page entered the session. No key, inferred project ID,
provider session ID, or provider URL is retained in this document. See the
[dedicated acceptance record](browserbase-live-acceptance.md).

## Controlled Greenhouse-shaped founder acceptance

Run with an explicit one-use gate and named READY application:

```bash
RUN_GREENHOUSE_BROWSERBASE_ACCEPTANCE=true \
ACCEPTANCE_APPLICATION_ID=<ready-application-uuid> \
npm run acceptance:greenhouse
```

The acceptance fails unless the revision is validation-passed, current for the
candidate input epoch, the résumé and
cover-letter PDF set is complete, every artifact is private, QA-passed, size-
matched, and SHA-256-matched, and the required frozen candidate-reviewed exact
facts exist. It prints hashes and identifiers, never candidate values. Its form is
Greenhouse-shaped but controlled by RoleDawn on the allowed `example.com`
origin. This makes the acceptance repeatable without sending founder data to
an employer or generating a junk application.

The founder dogfood application was used only under the explicit acceptance
gate. Its stale historical packet was refreshed first; current revision v2 is
bound to the current candidate input epoch and has exactly four QA-passed
artifacts. The controlled fixture run filled eight fields and two uploads. The
later real-form run disclosed nothing and created no submission attempt or
receipt. The remote and local migration ledgers now align through all 45
checked-in migrations.

The final hosted advisor read was informational rather than a release pass:
security returned 28 findings (8 intentional deny-all RLS `INFO`, 19
authenticated `SECURITY DEFINER` `WARN`, and 1 leaked-password
protection `WARN`); performance returned 64 `INFO` findings (63 unused indexes,
including newly added expected indexes, plus the Auth connection-strategy
advisory). It reported zero unindexed foreign keys.

## Execution and memory model

PostgreSQL is the memory. It stores candidate-reviewed facts, artifact hashes,
application state, authority, attempt identity, and checkpoints. The runtime is
temporary:

1. The candidate releases one unchanged revision for fill only.
2. A leased worker materializes the exact authorized values and bytes.
3. `BrowserSessionBroker` provisions one isolated session using the database
   session UUID as the idempotency key.
4. A no-submit driver preflights required fields before disclosure, then fills
   and reads back only when every required answer is authorized. Unknown
   sensitive fields, login, OTP, CAPTCHA, certification, and portal drift stop
   for takeover.
5. During takeover, the candidate may complete the blocked questions in Live
   View and issue one replay-safe continuation of the same retained fill and
   session. The worker never receives Submit authority.
6. The process-owned supervisor retains the guarded runtime through review or
   takeover, then destroys it and awaits durable release reconciliation before
   the worker entrypoint can exit.
7. A later, separate `SUBMIT_APPLICATION_ONCE` approval would be required for
   any final employer action.

Clean ephemeral sessions are the only active alpha mode. Persistent execution
fails closed because the current internal `browserProfileRef` is not yet
materialized to a provider-owned context reference. A future mapping may scope
one encrypted context to one candidate and ATS origin when login continuity is
required. The architecture does not keep one virtual machine running for every
candidate.

## Credentialed worker activation

The worker is intentionally inert without server-only environment values:

```text
ROLEDAWN_BROWSERBASE_ENABLED=true
BROWSERBASE_API_KEY=...
BROWSERBASE_REGION=us-west-2
BROWSERBASE_API_TIMEOUT_MS=20000
```

Browserbase infers the scoped project from the API key. RoleDawn verifies that
the key resolves to exactly one project at worker startup; there is no separate
project-id setting. With the existing Supabase worker credentials present, run
one bounded cycle:

```bash
npm run worker:fill
```

The process reconciles stale provisioning first and then claims at most one
new application-fill event. It exposes no live-view URL, disables provider
session recording, does not solve CAPTCHA, and has no final-submit interface.

## Remaining activation work

1. Deploy migration `20260819061711`, then accept the candidate takeover
   continuation against one controlled retained Browserbase session before
   attempting a real employer form.
2. Accept candidate close, TTL, worker-loss, and uncertain-provider-telemetry
   behavior through the retained-runtime supervisor and Live View broker.
3. Materialize `browser_profiles.provider_context_ref` before enabling any
   persistent-context mode.
4. Add monitoring for lease expiry, provider teardown, cost, and stuck sessions.
5. Expand deterministic fixtures for current Greenhouse tenant variants, then
   promote only measured mappings.
6. Build final-submit approval, same-attempt reconciliation, confirmation
   evidence, and receipt creation as a separate milestone.

Until those steps pass, RoleDawn can prepare and authorize an application, fill
a controlled Greenhouse-shaped form with real verified artifacts, open a real
Greenhouse form while failing closed before protected/legal disclosure, and
continue a retained controlled form in repository tests after candidate input.
It cannot yet complete a hosted real employer form or submit an application.
