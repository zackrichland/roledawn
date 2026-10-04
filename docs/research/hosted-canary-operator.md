# Isolated hosted canary: review and operator contract

**2026-10-04: implemented and tested locally; not activated.** The isolated runner, Supabase RPC store, recovery controller and SQL draft are connected in code. No active worker imports this runner. No schema was deployed, approval/budget row staged, credential transferred, paid session started or application sent.

## Reviewable files

- [SQL draft](../../supabase/drafts/hosted_canary.sql): private approval, aggregate budget, run and independently verified evidence tables; fenced service-role RPCs; scoped exclusion triggers.
- [Store](../../src/server/workers/openai-hosted-canary-store.ts): implements the controller's actual state contract, bounded RPC calls, durable cleanup and evidence reads.
- [Runner](../../scripts/run-hosted-canary.ts): explicit preflight, execute and recovery-only modes. It is not a worker fallback.
- [Controller](../../src/server/workers/openai-hosted-canary.ts): documented native hosted transport, immutable task identity, conservative recovery and independently bound evidence.
- [Database tests](../../scripts/hosted-canary-store.test.ts): apply the real draft on all repository migrations and exercise both Lever and Ashby using the real service-role RPCs.

The SQL remains outside automatic migrations because the installed Supabase CLI failed while creating its configuration directory on the read-only home filesystem. No home override or permission bypass was used. After review, an operator with the appropriate environment should generate a migration using the CLI, copy the reviewed draft unchanged, apply it through the repository's approved migration process, verify grants/functions/triggers and regenerate database types. None of those deployment steps is authorized or performed by this checkpoint.

## Actual cross-provider exclusion

The first hosted claim briefly takes table locks on autopilots, fill attempts, computer sessions and application attempts, checks existing candidate/job work, then atomically reserves the normalized job identity and aggregate budget. There is no network call while holding these locks. This administrative lock can briefly delay unrelated writes, including Greenhouse writes; Greenhouse eligibility and delivery logic are unchanged. This locking impact needs deployment review.

The reservation is unique by candidate plus ATS host/job UUID, independently of application row, URL suffix/query, packet version and provider. Any existing employer attempt blocks the experiment, including an explicit prior refusal; this deliberately does not introduce an experimental retry policy. Active/uncertain/confirmed delivery and retained runtime references also block it. New Browserbase delivery/fill starts and ordinary employer-attempt creation for that reserved identity are rejected by database triggers. They remain rejected after expiry, cleanup, uncertainty, rejection and confirmation. Cleanup and terminal writes remain possible. No fake application attempt or submit-seal fingerprint is created to achieve exclusion.

With no experimental reservation, the triggers do not change eligibility. A Greenhouse URL cannot acquire a reservation. Existing production TypeScript and Greenhouse/Browserbase submit implementations are unchanged. Local PGlite checks cover real constraints/RPCs/triggers, not distributed production load; production lock contention still needs review.

## Preflight and private manifest

```bash
node --experimental-strip-types --env-file=.env.local scripts/run-hosted-canary.ts --preflight
node --experimental-strip-types --env-file=.env.local scripts/run-hosted-canary.ts --preflight /absolute/private/canary.json
```

Preflight is local only. It prints missing configuration **names**, hashes of target/packet/intent, origin-decision counts, integer spend inputs and fixed blocker codes. It never prints keys, candidate facts, file bytes or target URLs. The private manifest must be a regular file with no group/other permissions and at most 4 MB. Required configuration names are `OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`; new execution additionally requires `ROLEDAWN_HOSTED_CANARY_ENABLED=true`. Browserbase and test-access keys are not needed by this isolated runner.

The manifest type is `CanaryOperatorManifest` in [preflight](../../src/server/workers/openai-hosted-canary-preflight.ts). Its `plan` must come from `prepareHostedCanaryPlan` using the current read-back facts and exact PDF bytes. Its separate `approval` binds the exact intent, packet digest and destination, with hashes referencing the actual scoped user approval, packet readback, prior-spend evidence, future cost bound and schema review, plus expiry. These local assertions alone grant nothing. An independently reviewed operator transaction must stage the **exact serialized plan**, enabled approval and budget evidence in the private SQL tables. No worker RPC can create those records or raise the $50 aggregate ceiling.

The prior upper bound must include earlier provider/model work. Each hosted reservation adds its approved conservative future bound atomically; reservations are never automatically refunded. Evidence expiry stops new work. Hashes reference a reviewed cost calculation; they do not manufacture one. A three-minute controller timeout is not a provider-enforced dollar cap. Missing historical usage or an unsupported future bound remains a hard operational blocker even if preflight fields are populated.

## Execution and recovery distinction

After all exact-scope review/configuration/schema/packet/budget prerequisites are independently satisfied, `--execute /absolute/private/canary.json` uses the real transport and RPC store. This is a paid and candidate-bearing action, not a smoke test. Do not run it merely because local preflight passes; preflight explicitly reports deployed approval/exclusion as unverified.

`--recover` uses the same immutable manifest and an existing reservation only. SQL refuses recovery when no run exists. Expired admission deadlines, expired approvals or a disabled experiment cannot prevent recovery; they cannot authorize new input either. Recovery reads bounded retained turn history because live SSE does not replay downtime. It then cancels, attempts deletion and checks independent evidence, without task replay or a replacement session. An unavailable history endpoint does not prevent cancellation or independent evidence review. Unknown session creation remains uncertain and reserved.

Cleanup state is durable. Deletion failure remains `cleanupPending`; a later terminal recovery retries deletion, treating an already absent session as cleaned. Employer outcome and the full bound evidence object are committed atomically and remain immutable. The isolated runner reads `private.hosted_canary_verified_evidence` through a fenced read RPC. This table must be populated by independent review of genuine employer evidence; the worker cannot write it, and model output/turn completion are never sufficient. It is an experimental evidence ledger, not a production receipt writer or an automatic employer-mailbox verifier.

## Remaining activation gates

The implementation is ready for review and synthetic rehearsal. It is **not ready for live activation**. Remaining gates are secure credentials; current approved packet and exact origin decisions; credible aggregate spend evidence; reviewed schema deployment and private approval/budget staging; and access to genuine employer evidence for independent reconciliation. Automatic employer evidence capture and production receipt-ledger mapping are deliberately not connected. Without employer evidence the result remains uncertain, with no retry or Browserbase fallback.

The accepted experimental limitation remains: the reservation prevents another RoleDawn run for the same intended job; it cannot enforce the exact payload, prevent another job on the approved ATS host, or prevent multiple employer requests within the first hosted task.

Local checks:

```bash
node scripts/migration-harness.mjs supabase/drafts/hosted_canary.sql supabase/checks/hosted_canary.sql
node --test --experimental-strip-types scripts/hosted-canary-store.test.ts
```
