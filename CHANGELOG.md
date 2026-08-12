# Changelog

This file records material repository changes. Product capability is described
with evidence labels; repository implementation does not imply hosted activation
or production readiness.

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

- No production document upload, scanner, parser, or reviewed Career Vault flow.
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
