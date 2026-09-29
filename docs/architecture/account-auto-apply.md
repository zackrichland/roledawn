---
title: Account auto-apply contract
status: implemented; local and hosted database acceptance passed
owner: engineering
last_updated: 2026-09-16
---

# Account auto-apply

The candidate can enable automatic selection and delivery from Applications. Every
account starts **off**. Enabling saves candidate-owned standing consent for the
current résumé/evidence/exact-answer epoch and search-preference version. The model
never creates consent, changes limits, or decides that a submission succeeded.

## Selection and preparation

A worker claims one candidate for five minutes and reads that candidate's current
profile and the fresh catalog through the shared deterministic matcher. It selects
only strong, supported matches after excluding previous applications and passed
jobs. An incomplete scan creates no applications. An empty result is normal idle
state; the worker checks again after fifteen minutes.

The database rechecks the current job version, freshness, reviewed source, concrete
delivery adapter, consent version, candidate epoch, preferences and lease before
creating an application. The same candidate/job uniqueness and advisory lock used
by manual queue commands prevent duplicates. The immutable enrollment retains the
profile hash, matching release, job version, complete decision and consent version.
It cannot adopt an earlier manual application or borrow newer consent.

Only one automatic application is prepared per hour, with one unfinished automatic
application per consent version. A missing answer holds that application for the
candidate. This initial policy bounds drafting and browser costs while plan-based
throughput remains unimplemented.

## Packet delegation and final dispatch

Once a current validated packet becomes ready, the service resolves the actor from
saved consent and runs the same private named-application delegation contract used
by **Apply for me**. The command freezes the exact revision, document hashes,
allowed facts and destination. It does not modify a JWT or expose a candidate
impersonation endpoint.

At the actual network boundary the existing application coordinator seals the
readback and request fingerprint. Its transaction creates one approval consumption
and one immutable attempt before allowing a final request. A database trigger on
that attempt serializes the candidate's capacity:

- At least **3,600 seconds** between automatic submission attempts.
- At most **24 attempts per UTC day** for the server-owned pilot plan.
- Uncertain attempts consume capacity, as do confirmed attempts.
- Preparation, ready packets and approval alone consume no submission capacity.
- Pause, re-enable and day rollover cannot shorten the one-hour interval.

The client cannot send a plan name, interval, daily cap, candidate identity or target
URL through the enable command. Future paid plans require an explicit server-side
policy change. Attempts and confirmations are separate UI counters.

## Pause, changes and recovery

Pause revokes unsent automatic work, cancels its queued or running preparation and
requests cancellation of its browser work. Existing files remain private and
available; manual applications are unaffected. A request already sent cannot be
withdrawn. Its attempt, receipt and reconciliation remain active independently of
the toggle, and uncertainty never permits another submit for the same application.

Changing the profile epoch, candidate status or search-preference version pauses
automatic selection and withdraws pending automatic work. The candidate must enable
it again for the new input. Old enrollments remain bound to their original consent.

Concurrent toggle commands use optimistic versions and command IDs. If PostgreSQL
explicitly aborts a toggle with a deadlock error, the server retries that same
command at most three times. Network uncertainty is not retried automatically.

A candidate-specific read or selection failure records a stable error outcome and
backs off for fifteen minutes, allowing another candidate to proceed. Missing or
expired leases cannot publish success. The hosted worker lane supplies global
concurrency control; each candidate additionally has its own database lease.

## Interfaces

- `src/server/auto-apply/state.ts`: `readAutoApplyState(client)` and
  `setAutoApplyEnabled(client, { commandId, expectedVersion, enabled })`.
- `src/server/workers/auto-apply.ts`: `runAutoApplyWorkerOnce(environment)`.
- Public candidate RPCs: `read_auto_apply_state`, `set_auto_apply_enabled`.
- Service-only RPCs: `claim_auto_apply_candidate`, `advance_auto_apply_candidate`,
  `enqueue_auto_apply_match`, `finish_auto_apply_check`.

## Verification

The rollback harness creates a fresh synthetic Auth user, tenant, candidate, jobs
and packet. It uses the real migration functions, RLS roles and submission gate.
Artifact bytes and writing quality are fixture metadata because this is an authority
and scheduling test; browser/file delivery has separate acceptance evidence.
Nothing is committed and no network submission is made.

```sh
# Local PostgreSQL in WebAssembly, without a database server or credentials.
npm install --prefix /tmp/roledawn-auto-apply-db @electric-sql/pglite@0.3.14
ROLEDAWN_PGLITE_MODULE=/tmp/roledawn-auto-apply-db/node_modules/@electric-sql/pglite/dist/index.js node scripts/run-auto-apply-sql-acceptance.mjs

# Generate a SQL-only rollback suite after migrations have been applied.
node --experimental-strip-types scripts/build-auto-apply-acceptance.ts
```

Local verification covers ownership, default-off behavior, immutable consent replay,
stale commands, claim collision, wrong leases, queue creation, preserving manual
work on pause, exact packet delegation, the final submission interval and daily
cap, uncertainty, no capacity reset, stale consent and preference invalidation.
See [the delivery acceptance](../execution/application-autopilot-acceptance.md) for
the independently tested browser/receipt boundary.

**Verified 2026-09-16:** all eleven local PostgreSQL assertion groups passed. The
hosted rollback repeated those checks, rejected a mismatched job-content hash,
proved scheduled-lane due/lease gating, and confirmed the synthetic Auth user,
workspace and both jobs were absent afterward. Eight TypeScript regressions passed.

A separate hosted test used two authenticated connections for the same fresh,
always-off candidate. Two simultaneous version-zero commands produced one commit
and one stale-version rejection; two replays of the committed command both returned
the same version. It created no applications, and verified Auth/workspace cleanup.
The actual deadlock schedule was not forced; the explicit deadlock retry path has
an RPC fault-injection regression.
