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

The first hosted claim takes a transaction advisory lock for only the candidate/ATS-job identity and locks matching autopilot rows with NOWAIT. All Lever/Ashby launch/attempt triggers use the same key. A competing claim that has selected a row makes the hosted reservation fail promptly; it cannot deadlock waiting for that row while blocking its launcher. Greenhouse takes no experimental advisory lock. There is no network call inside these transactions.

The reservation is unique by candidate plus ATS host/job UUID, independently of application row, URL suffix/query, packet version and provider. Any existing employer attempt blocks the experiment, including an explicit prior refusal; this deliberately does not introduce an experimental retry policy. Active/uncertain/confirmed delivery and retained runtime references also block it. Existing queued autopilots for the reserved identity are paused atomically with reservation; future inserts/requeues for it are also paused. This prevents an oldest reserved row from repeatedly aborting the global claim and starving unrelated work. Defensive triggers still reject direct Browserbase delivery/fill starts and ordinary employer-attempt creation for that reserved identity. They remain rejected after expiry, cleanup, uncertainty, rejection and confirmation. Cleanup and terminal writes remain possible. No fake application attempt or submit-seal fingerprint is created to achieve exclusion.

With no experimental reservation, the triggers do not change eligibility. A Greenhouse URL cannot acquire a reservation. Existing production TypeScript and Greenhouse/Browserbase submit implementations are unchanged. PGlite checks exercise the actual global claim with an older reserved row and newer Greenhouse row. A disposable PostgreSQL 18 test also uses concurrent connections for both boards: Browserbase wins, hosted wins, and the ordinary worker has selected but not yet claimed the row. All six cases leave one authority and allow the unrelated Greenhouse claim. This is real transaction-race evidence, not a production load test.

## Preflight and private manifest

```bash
node --experimental-strip-types --env-file=.env.local scripts/run-hosted-canary.ts --preflight
node --experimental-strip-types --env-file=.env.local scripts/run-hosted-canary.ts --preflight /absolute/private/canary.json
```

Preflight is local only. It prints missing configuration **names**, hashes of target/packet/intent, origin-decision counts, integer spend inputs and fixed blocker codes. It never prints keys, candidate facts, file bytes or target URLs. The private manifest must be a regular file with no group/other permissions and at most 4 MB. Required configuration names are `OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `ROLEDAWN_HOSTED_CANARY_EVIDENCE_DIR`; new execution additionally requires `ROLEDAWN_HOSTED_CANARY_ENABLED=true`. Browserbase and test-access keys are not needed by this isolated runner.

The manifest type is `CanaryOperatorManifest` in [preflight](../../src/server/workers/openai-hosted-canary-preflight.ts). Build its `plan` with [prepareHostedCanaryPlanFromReadback](../../src/server/workers/openai-hosted-canary-packet.ts), using the current materialized facts and exact PDF bytes. This builder rejects a different applicant, application or destination and returns a version-bound `packetReadbackHash` for independent review. Its separate `approval` binds the exact intent, packet digest and destination, with hashes referencing the actual scoped user approval, packet readback, prior-spend evidence, future cost bound and schema review, plus expiry. These local assertions alone grant nothing. An independently reviewed operator transaction must stage the **exact serialized plan**, enabled approval and budget evidence in the private SQL tables. No worker RPC can create those records or raise the $50 aggregate ceiling.

The prior upper bound must include earlier provider/model work. Each hosted reservation adds its approved conservative future bound atomically; reservations are never automatically refunded. Evidence expiry stops new work. Hashes reference a reviewed cost calculation; they do not manufacture one. A three-minute controller timeout is not a provider-enforced dollar cap. Missing historical usage or an unsupported future bound remains a hard operational blocker even if preflight fields are populated.

## Execution and recovery distinction

After all exact-scope review/configuration/schema/packet/budget prerequisites are independently satisfied, `--execute /absolute/private/canary.json` uses the real transport and RPC store. This is a paid and candidate-bearing action, not a smoke test. Do not run it merely because local preflight passes; preflight explicitly reports deployed approval/exclusion as unverified.

`--recover` uses the same immutable manifest and an existing reservation only. SQL refuses recovery when no run exists. Expired admission deadlines, expired approvals or a disabled experiment cannot prevent recovery; they cannot authorize new input either. Recovery reads bounded retained turn history because live SSE does not replay downtime. It then cancels, attempts deletion and checks independent evidence, without task replay or a replacement session. An unavailable history endpoint does not prevent cancellation or independent evidence review. Unknown session creation remains uncertain and reserved.

Cleanup state is durable. Deletion failure remains `cleanupPending`; a later terminal recovery retries deletion, treating an already absent session as cleaned. Employer outcome and the full bound evidence object are committed atomically and remain immutable. The isolated runner reads `private.hosted_canary_verified_evidence` through a fenced read RPC. This table must be populated by independent review of genuine employer evidence; the worker cannot write it, and model output/turn completion are never sufficient. It is an experimental evidence ledger, not a production receipt writer or an automatic employer-mailbox verifier.

## Remaining activation gates

The implementation is ready for review and synthetic rehearsal. It is **not ready for live activation**. Remaining gates are secure credentials; current approved packet and exact origin decisions; credible aggregate spend evidence; reviewed schema deployment and private approval/budget staging; and access to genuine employer evidence for independent reconciliation. Documented saved turns/items, tool screenshots and artifact bytes are now captured privately; they remain diagnostics until independently verified. Automatic semantic employer verification and production receipt-ledger mapping remain intentionally unconnected. Without employer evidence the result remains uncertain, with no retry or Browserbase fallback.

The accepted experimental limitation remains: the reservation prevents another RoleDawn run for the same intended job; it cannot enforce the exact payload, prevent another job on the approved ATS host, or prevent multiple employer requests within the first hosted task.

Local checks:

```bash
node scripts/migration-harness.mjs supabase/drafts/hosted_canary.sql supabase/checks/hosted_canary.sql
node --test --experimental-strip-types scripts/hosted-canary-store.test.ts
```


## Evidence capture and verification

The [capture/verification module](../../src/server/workers/openai-hosted-canary-evidence.ts) and its fixtures use documented [saved items](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/items/methods/list), [artifact listings](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/artifacts/methods/list) and [artifact content](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/artifacts/methods/content). The prepared canary requests tool screenshots. Saved model descriptions, completed turns, screenshot pixels and agent-published files are **not independently authenticated employer evidence**.

Before provider deletion, the isolated runner archives bounded saved turns/items, screenshot bytes and up to five published artifacts matched to the session and completed turn. There is one bounded page per listing, a 2 MiB transport limit per response/artifact, and a 15-second capture budget. Pagination, missing terminal history or any partial failure marks the archive INCOMPLETE. Partial raw data is still saved; archive failure never keeps a paid environment alive indefinitely. Lost-stream recovery uses saved provider history, not replay assumptions. No evidence URL is fetched from an untrusted item.

`ROLEDAWN_HOSTED_CANARY_EVIDENCE_DIR` must name an existing 0700 directory outside the repository, not a symlink. Raw files are content-addressed, exclusive-created at 0600 and hash-checked on reads. The archive manifest binds run/session hashes and capture time; filenames from the provider are never used as local paths. Public console output contains only static status and archive-manifest hashes. The directory must persist for recovery; raw bytes stay private.

The independent operator's evidence row additionally needs a `verification` object following `EmployerVerification`. It binds approved candidate ID/contact, employer board identity, job UUID, session, raw-content digest, actual observation/run-start/verification times, source URL, explicit outcome and reviewer-reference digest. `expectedEmployerBinding` and `verificationDigest` compute the exact hashes without printing candidate facts; the latter is canonical across JSONB key ordering. The raw employer bytes must exist under their hash in the private archive. Stage this reviewed envelope only through the independently privileged evidence-table operation. A worker/model cannot create that row. Do not mark the independent-verification flags true merely because an agent output looks convincing: verify the employer origin and the exact applicant/job from an independent authenticated observation.

The isolated runner rejects absent independent review, model-statement kinds, unknown outcomes, wrong host/job/applicant/session, old/future timestamps, changed bytes and unverified screenshots. Genuine independently reviewed screenshot evidence is supported, but screenshot extraction alone is never verification. No normal application attempt, HTTP request fingerprint or production receipt is invented.

## Minimal activation prerequisites and next command

1. Review and deploy exactly the draft's `private.hosted_canary_approvals`, `private.hosted_canary_budget`, `private.hosted_canary_runs`, `private.hosted_canary_verified_evidence`, their scoped triggers and service RPCs. Runtime uses the restricted `service_role` RPC grants; approval/budget/evidence staging requires a separate database-owner operator. The worker cannot stage its own approval or evidence.
2. Securely configure `OPENAI_API_KEY` and `SUPABASE_SECRET_KEY`; retain the existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Configure a private evidence directory via `ROLEDAWN_HOSTED_CANARY_EVIDENCE_DIR`; leave `ROLEDAWN_HOSTED_CANARY_ENABLED` disabled until the exact run is ready.
3. Retrieve the approved frozen packet's versioned PDFs from private Supabase storage using the existing execution materializer, verify their manifest hashes/sizes, read back the exact current structured facts and missing required answers, and build the private manifest from those bytes. The evidence module does not substitute a résumé from Library or reconstruct candidate facts. Stage the exact serialized plan and scoped approval independently.
4. Include explicit exact origin decisions in the immutable plan; approve only reviewed required origins. Separately stage credible prior aggregate spend, conservative future run cost, supporting evidence hashes and expiry under the original $50 total ceiling. These inputs are still missing in this environment.
5. Arrange independent employer-evidence inspection and private archival for reconciliation. This is not a request to send new employer/support messages.

The single safe operator command now is:

```bash
NODE_USE_ENV_PROXY=1 node --experimental-strip-types --env-file=.env.local scripts/run-hosted-canary.ts --preflight
```

After preparing the private manifest, append its absolute path to the same command. No additional speculative feature work is required before these operational gates are addressed. The canary still has zero new employer-confirmed receipts.

The real concurrency rehearsal is explicit and disposable:

```bash
node scripts/hosted-canary-concurrency.mjs --run-docker
```
