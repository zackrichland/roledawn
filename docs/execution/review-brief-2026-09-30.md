---
title: Review brief, 2026-09-28 to 2026-09-30
status: review request; history once reviewed
owner: engineering
last_updated: 2026-09-30
scope: every change that reached main on 2026-09-30, what is live, and where a reviewer should look hardest
---

# Review brief: 2026-09-28 to 2026-09-30

This brief is for an independent code review of the work that moved `main` from `f62f5d5` (2026-08-12) to the commit that adds this file. Read [AGENTS.md](../../AGENTS.md) first: it has the commands, invariants and gotchas. The [decision log](decision-log.md) rows cited below (D-0xx) hold the rationale and reversal triggers. Labels follow the repository convention: **Verified**, **Inference**, **Open question**.

## What reached main

| Commit | Scope |
|---|---|
| `2c6ca0d` Build RoleDawn autopilot end to end | 590 files. Bundles everything from 2026-08-13 to 2026-09-29: the Home/Jobs/Profile product, writing v4, catalog and matching, autopilot delivery, emailed codes, Gmail codes. The [changelog](../../CHANGELOG.md) (entries 2026-08-17 onward) describes it; history inside it is not preserved. |
| `1c55621` Remember candidate answers across applications | D-112, migration `20260930000000` |
| `32b90d4` Record the first confirmed application | Docs |
| `03fe052` Fill Greenhouse multi-selects; add ops status and founder directives | D-113, `scripts/ops-status.mjs`, [founder directives](founder-directives.md) |
| `daac99a` Add ATS board templates for the form agent | [docs/boards/](../boards/README.md), 11 boards, docs only |
| `d2a7dcf` Answer routine questions from standing answers; fix hosted multi-selects | D-114 to D-117, migrations `20260930010000` to `20260930050000` |
| `4be4750` Remove unused code, regenerate database types, rewrite AGENTS.md | Cleanup |
| `5a630e5` Record delivery phase timings with every send | Observability |
| `e895f03` Fill Greenhouse's Location (City) field | D-118 |
| `fa27648` Fix standing answers for sensitive questions; re-check waiting sends | D-117 follow-up, migration `20260930060000` |
| `e6e8b36` Time the pre-model fill phase; record two new standing answers | Observability, docs |

## Production state when this was written

- **Verified:** all 20 migrations dated 2026-09-28 to 2026-09-30 are applied to the hosted database and recorded (`supabase_migrations.schema_migrations`). They were applied with `supabase db query --linked` plus `migration repair`, never `db push` (see AGENTS.md).
- **Verified:** everything through `fa27648` is deployed to Netlify production. `e6e8b36` (adds `fillMs` timing only) is pushed but not deployed.
- **Verified:** two confirmed applications (Greenhouse, one employer). Each was submitted once, answered by Greenhouse's HTTP 428 emailed code, completed with the code read from the candidate's Gmail (7 s and 6 s after the request), and the employer's confirmation page was stored as the receipt. A third (Flexport) had all questions answered automatically and was still filling when this was written.

## Changes by area

### Delivery and submission (Greenhouse)

- Delivery goes through Greenhouse's embedded form (`/embed/job_app?for=<board>&token=<id>`), so boards that redirect to custom careers sites still work (D-102). Files: `src/server/workers/application-delivery-browser.ts` (network guard, uploads, submit, receipt), `application-delivery-driver.ts` (one step at a time), `agents-browser-tools.ts`, `agents-aria-combobox.ts`.
- HTTP 428 "captcha-failed" leads to an emailed code. The worker reads it from the candidate's read-only Gmail (D-105, D-106; `src/server/mailbox/google-mailbox.ts`, tokens sealed with AES-256-GCM), types it into Greenhouse's own boxes, and the page resends an identical body.
- An unmet code closes the attempt as `NOT_ACCEPTED`. The send retries once with a new idempotency key `autopilot:<id>:<n>` and a derived command id, then offers Try again (D-111, migration `20260929230000`).
- React Select multi-selects (for example GPA ranges) fill by option label, and the chips must equal the requested labels (D-113). **Follow-up:** React Select sets `aria-selected` on options everywhere except Apple platforms, so the hosted Linux browser saw `"false"` and the reader refused it. The reader now accepts `"false"`, and `"true"` only for a label already chipped. A Linux-platform fixture test covers it.
- "Location (City)" typeahead (D-118): the guard admits exactly `GET https://api-geocode-earth-proxy.greenhouse.io/v1/autocomplete`. The typed text is the candidate's approved city, and `api_key`, `layers` and `lang` are pinned by pattern (`DeliverySearchRule.params`, `searchPermitted`). A result is chosen only when the candidate's region and country confirm it. A control first seen as type-to-search keeps that identity, because React Select's async menu shows the last results after a choice (`remoteControls` in `agents-browser-tools.ts`).

### Where form answers come from

In order: profile facts matched by anchored label rules; remembered answers; standing answers; then the candidate.

- **Remembered answers** (D-112, D-115): an earlier answer to the same wording and kind is reused. Options match by a punctuation-insensitive key. Answers are prefilled on the first read so repeat questions fill in the same pass (`prefill_application_autopilot_answers`, `private.autopilot_remembered_value`). Migrations `20260930000000`, `20260930020000`, `20260930040000`.
- **Standing answers** (D-117): the candidate's saved answers to routine questions, in the new table `candidate_standing_answers`.
  - When a required question has no fact and no remembered answer, `src/server/workers/standing-answers.ts` makes one Responses API call (form model, strict JSON schema). It sees short ids only, never fingerprints or database ids, and never identity facts.
  - Code keeps an answer only if it picks options on the form and cites a basis (standing-answer ids, or `fact:<key>` for a short allow-list of facts).
  - `record_application_autopilot_standing_answers` re-checks everything and stores the answer with `source = 'STANDING'` and its `basis`.
  - The driver fills these in the same pass (`applySavedAnswers` in `application-delivery-driver.ts`).
  - Demographic, legal, consent, signature, citizenship and criminal-history questions never go this way (`CANDIDATE_ONLY`).
  - A sensitive question (reasonCode `SENSITIVE_REQUIRES_CANDIDATE`) may rest only on standing answers or `fact:work_authorization.*`.
  - Standing-derived answers are never remembered, so edits take effect on the next send.
  - Saving a standing answer re-queues the candidate's `WAITING_ANSWERS` sends (migration `20260930060000`).
- **Answer sources:** every answer row now has `source` (`CANDIDATE`, `REMEMBERED`, `STANDING`) and `basis`.

### Reliability and observability

- Transient stops before any submission (model or network timeouts, a full browser pool, unknown worker errors) re-queue at most twice, at +1 and +5 minutes (D-114, migration `20260930010000`).
- The model stops as soon as the step review passes (`shouldStop` in `openai-agents-client.ts`). The run limit is 240 s.
- `private.worker_events` (D-116, migration `20260930030000`) holds lane failures and one row per send: stage, outcome, code, duration, and a redacted detail.
  - `errorDetail` in `src/server/workers/worker-events.ts` keeps a message only when it is a code, a Playwright timeout or a `net::ERR` code; otherwise it keeps a hash and a length. A domain error's `.code` is kept.
  - Sends record phase timings (`openMs`, `readMs`, `fillMs`, `modelMs`, `submitMs`).
  - `npm run ops:status` (`--watch`, `--app <id>`) is a read-only production view.

### Access, models, writing

- Single-account mode requires a private access key at `/auth/test-session` (timing-safe comparison, `src/server/auth/single-account-access.ts`) (D-109).
- The form agent runs on GPT-6.1 Sol; drafting stays on GPT-6 Astra (D-108). The writing lint catches self-undercutting phrases even when they name the employer (D-110).

### Cleanup

- Deleted code no production entry point, script or route reached: `CandidateQueue`, `AutoApplyPanel`, `Icon`, `server/dashboard/automation.ts`, `server/ingestion/index.ts`, `browserbase-runtime.server.ts`, the application packet domain and its 20 tests. Also removed the kit worker's checks for v1 drafting errors it cannot receive.
- `src/lib/supabase/database.types.ts` is regenerated from the hosted schema; it had drifted. Generated types mark SQL parameters without defaults as non-null, so `src/server/candidate/knowledge.ts` asserts two nullable arguments with a comment.
- AGENTS.md is rewritten. `.env.example` reflects production (`ROLEDAWN_FORM_DRIVER=agents`). The link checker skips `tmp/`, `artifacts/`, `.netlify/`.

## Where to look hardest

1. **Submission authority.** `begin_application_autopilot_submit` and `finish_application_autopilot`: exactly one sealed, single-use permission per attempt; retries get new keys; uncertain outcomes block new sends; only the employer's response is a receipt. Nothing in this window should loosen that.
2. **Standing answers, parity and injection.**
   - The TypeScript rule (`acceptStandingAnswer`, `standingAnswerEligible`) and the SQL rule (`record_application_autopilot_standing_answers`) must agree. They did not at first; see the D-117 follow-up.
   - Form labels and options are page-controlled text sent to a model. Check that the model can only pick existing options, must cite a basis, and cannot reach sensitive questions except through the rules above.
   - Check that a wrong answer cannot become "remembered".
3. **Re-queue on save.** `save_candidate_standing_answer` moves `WAITING_ANSWERS` to `QUEUED` while `OPEN` questions remain. `seal_application_autopilot` refuses to seal while any question is open. Confirm no path can submit with an open question, and that stopped, expired or stale-revision sends are not re-queued.
4. **Network guard.** `searchPermitted` and the Greenhouse `searches` rule: can anything besides the typed city leave the browser through the lookup? Are `params` patterns anchored and validated at policy load?
5. **Combobox readers.** `multiState` (`aria-selected` handling) and sticky type-to-search identity: can a field's fingerprint change mid-step, or can a wrong option be chosen?
6. **Redaction.** Worker events, domain event payloads and tool-call logs must never hold form values, answers, documents, codes or raw provider text.
7. **Mailbox tokens.** Only a worker holding that application's lease can read the sealed refresh token; codes are cleared on use.

## How to verify

```bash
npm install
npm test                      # 714 tests at e6e8b36
npm run typecheck && npm run lint && npm run check:docs
node scripts/migration-harness.mjs supabase/checks/standing_answers.sql   # any file in supabase/checks/
npm run build                 # with no dev server running
```

`npm run ops:status` reads production and needs the linked Supabase CLI; it is read-only. `.env.local` points at the hosted database, so don't run local workers with `ROLEDAWN_AUTOPILOT_ENABLED=true` during a review.

## Known gaps and open decisions

- Consent, privacy-notice and attestation checkboxes always go to the candidate (open decision O-013).
- Passwords for account-based boards (Workday and similar) are undecided (O-012). Only Greenhouse is supported; Lever is fixture-tested only. The other boards are templates, not adapters.
- Standing answers have no UI yet, and automatic answers aren't listed on the application page.
- Legacy code still present (the no-submit fill path and v1 drafting); AGENTS.md lists it.
- One send runs at a time for all users. A pass spends most of its time filling fields before the model runs (each fill re-reads the whole form) and in the model itself; `fillMs` and `modelMs` now measure both.
- **Inference:** the standing-answer model can map a question wrongly within the allowed rules. Answers are labeled and auditable, but nothing yet asks the candidate to review them before sending (founder directive: sending must not wait on the candidate).
- The repository is public. Candidate-specific values live only in the database; keep it that way.
