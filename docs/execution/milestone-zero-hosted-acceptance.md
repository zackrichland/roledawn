---
title: Milestone 0 hosted acceptance
status: verified live in HireWire development
owner: engineering
last_updated: 2026-08-12
---

# Milestone 0 hosted acceptance

## Verified run

**Verified live:** run `20260812135034` completed successfully against the
HireWire development project on 2026-08-12. Every required control-plane check
passed, the optional official-source worker claimed one message and completed
one resolution without failure, and cleanup removed the ephemeral Auth users
and cascading tenant data.

The result verifies the persistent Auth/RLS/command/outbox/read-model foundation
and narrow official-source resolver. It does not verify resume ingestion, packet
generation, CUA/browser fill, approval consumption, employer submission,
confirmation evidence, receipts, or reconciliation.

| Check | Preserved result |
|---|---|
| Anonymous denial | `PASS` — application reads denied |
| Auth and bootstrap | `PASS` — two real sessions; both bootstraps replayed stable IDs |
| Self-tenancy | `PASS` — each session read only its own workspace records |
| Command safety | `PASS` — command replay stable; same URL deduplicated; mismatched payload rejected |
| Application detail | `PASS` — aggregate, intake, run, event, and no-receipt invariants held |
| Cross-tenant isolation | `PASS` — second session read zero rows for the first application |
| Retry and dead letter | `PASS` — exactly five claims reached terminal dead-letter |
| Recovery authority | `PASS` — candidate/owner denied; explicit `SUPPORT` member inspected and audited one requeue |
| Official-source worker | `PASS` — claimed `1`, completed `1`, failed `0` |
| Service boundary and cleanup | `PASS` — server-side accounting succeeded; ephemeral users and tenant data removed |

This harness proves the persistent Supabase foundation through normal candidate
sessions. It does not grant submission authority, create application materials,
fill an ATS form, or contact an employer.

## What it proves

- Anonymous reads of `applications` fail.
- Two confirmed Supabase Auth users can establish ordinary password sessions.
- Each user bootstraps one stable personal workspace and candidate.
- Replaying bootstrap returns the same IDs.
- One pasted-link command creates one application, intake, preparation run,
  semantic event, and outbox message.
- Replaying the same command and payload returns the same application.
- Reusing that command ID with another URL fails.
- A new command for the same candidate and canonical URL returns the original
  application rather than creating a second aggregate.
- The owner can read the exact data needed by Queue and application detail.
- A second authenticated user sees zero rows from the first user's tenant.
- No receipt exists and nothing can be presented as submitted.
- Optionally, the one-shot resolver worker advances the intake to a resolved or
  fail-safe state without producing submission evidence.
- The test outbox message follows the bounded retry count, reaches dead-letter,
  remains hidden from an owner-only session, and is inspectable/requeueable only
  after a temporary explicit `SUPPORT` membership. Requeue records an immutable
  recovery action and still creates no receipt.

## Safety gates

The script refuses to run unless all of these are true:

1. The operator provides the exact acknowledgement value.
2. `ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF` matches the hostname in
   `NEXT_PUBLIC_SUPABASE_URL`.
3. Public configuration and a real server-only Supabase secret are available.
4. The test identities use the `roledawn-m0-` prefix and reserved
   `acceptance.invalid` domain.

The secret must remain in ignored `.env.local`; never pass it in a command,
commit, issue, screenshot, or chat.

## Prerequisites

1. Inspect the hosted migration ledger and deploy only reviewed pending
   migrations.
2. Confirm Data API exposure and grants match the committed migrations.
3. Put the hosted public values and `SUPABASE_SECRET_KEY` in `.env.local`.
4. Add the exact project ref:

```dotenv
ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF=your-project-ref
RUN_HOSTED_MILESTONE_ZERO_ACCEPTANCE=I_UNDERSTAND_THIS_CREATES_TEST_DATA
```

The harness defaults to a known public Greenhouse posting URL. Set
`ACCEPTANCE_JOB_URL` to another currently open official Greenhouse, Lever, or
Ashby posting when validating the optional live resolver.

## Run

```bash
npm run acceptance:m0
```

The default run does not invoke the worker. Enable the official-source network
step only when that access is intended:

```dotenv
ACCEPTANCE_RUN_WORKER=true
```

Then run the same npm command. The worker is still limited to job resolution;
it cannot draft, approve, fill, or submit an application.

## Cleanup and recovery

The harness writes a mode-`0600` cleanup record under ignored
`artifacts/acceptance/` immediately after both tenants exist. By default it
validates and deletes each recorded personal workspace first, allowing tenant
foreign keys to cascade, and then deletes only the matching prefix-validated
Auth user. If cleanup is incomplete, keep the record and run:

```bash
npm run acceptance:m0:cleanup -- artifacts/acceptance/m0-<run>-cleanup.json
```

Set `ACCEPTANCE_KEEP_ARTIFACTS=true` only when intentionally preserving the
ephemeral tenants for inspection. The cleanup command checks the project ref,
the stored user ID, and the exact prefixed email before each delete.

## Pass bar

The foundation passes when every required check prints `PASS`, cleanup prints
`PASS`, and the process exits with status zero. The optional worker may print
`SKIP`; this does not weaken Auth, RLS, command, or read-model acceptance.

Run `20260812135034` met the full bar with the optional worker enabled. A passing
run is evidence for the persistent control plane and official-source resolution
only. Resume intake, packet generation, browser shadow mode, approval
consumption, submission, receipt evidence, and reconciliation remain later
milestones.
