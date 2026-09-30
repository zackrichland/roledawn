---
title: Named-job autopilot and writing-policy acceptance
status: hosted delivery acceptance passed; real-employer validation pending
last_updated: 2026-09-16
---

# Named-job autopilot and writing-policy acceptance

## Scope

The founder authorized implementing one-click, named-job application delegation and translating their personal writing workflow into reusable product policies. No real employer application was authorized as an acceptance test. Every final submission below goes to a synthetic local HTTP server.

## Verified evidence

| Area | Evidence | Limit |
|---|---|---|
| Hosted delivery pipeline | Actual candidate delegation and answer RPCs on HireWire, scoped worker claims, two fresh Browserbase sessions, three Agents sessions, four model tool calls, two acknowledged uploads, exactly one synthetic submission and one hosted receipt; all provider resources released/deleted and 20 scoped Auth/DB/Storage counts verified zero | Synthetic rendered packet and reserved-origin ATS; preparation quality and employer execution are separate |
| Earlier live managed harness | `RUN_APPLICATION_DELIVERY_ACCEPTANCE=true npm run acceptance:delivery`: two fresh browser passes, six model tool actions, two acknowledged exact-byte uploads, one local submission and receipt, three API session deletion acknowledgements | In-memory synthetic control-plane fixture; hosted persistence checked separately |
| Browser protocol | Local HTTP tests exercise asynchronous upload acknowledgement, next/back, single dispatch, duplicate blocking, uncertain receipt, read-only reconciliation and fresh-browser answer continuation | Configured synthetic site; not all ATSs |
| Worker recovery | Tests require attempt-before-dispatch and receipt-before-confirmation, prevent a fresh form during reconciliation, retain questions, erase in-memory artifact bytes and rebuild an expired pre-submit browser | Unit dependencies isolate provider failures |
| Writing policy | Every new draft loads owned Markdown files; output records release, aggregate hash and individual file hashes. Missing/corrupt policies fail closed | Existing immutable packets retain their original provenance |
| Live profession-neutral draft | One synthetic teacher draft under policy `/1` passed 16 factual checks but was blocked at 138 words. After policy tuning, one fresh draft under `/2` produced a 149-word, four-paragraph letter, passed all 13 factual checks, passed the quality gate with only posting-limited research warning, and built an `application-kit/3` manifest | Two observed drafts from one synthetic profession; not a broad or blind writing-quality benchmark |
| Documents | Teacher, nurse and finance synthetic packets produced five QA-passed artifacts; combined PDF has the letter first and résumé on a fresh page; visual review found no clipping or overlap | Rendering and structure checks, not a blind assessment of live drafting quality |
| Hosted database | Nine grouped rollback assertions passed on HireWire: ownership, idempotency, tool intent, exact false answers, pause, seal/attempt, uncertain recovery, receipt binding and rollback preservation; 48 isolated PostgreSQL assertions cover claims and cleanup races | Transaction-local synthetic packet; no employer request or retained test rows |
| Browser provider | Full hosted acceptance uses isolated `serviceWorkers: "block"` contexts. A live blank probe found a provider extension worker in the default profile and zero workers in the isolated context. Binding persists before candidate browser access, and known sessions release on binding/connection failure | The failure paths and retained-context selection have regression tests; the completed live flow rebuilds a fresh browser on answer continuation |
| Candidate UX | Action and question components rendered at 390px and 1280px; no horizontal overflow; mobile buttons 48px; consent answer initially empty | Preview route removed after verification |

A repeat live test exposed a no-op model turn after an exact candidate answer had already been saved. The worker now applies fingerprint-matched answers deterministically, records their provenance and verifies their browser values before deciding whether another model turn is useful. The unchanged acceptance script then passed with one local submission; a regression confirms explicit false consent still prevents submission. Pre-submit recovery rebuilds every page; post-attempt recovery remains read-only.

## Hosted synthetic acceptance

**Verified on 2026-09-16:** the final automatic run exited successfully. The run's local output records the result: delivery proof (`artifacts/acceptance/delivery-fullstack-38630cfb-c868-409c-8f19-f8e1e5a51f73/delivery-proof.json`), provider/result summary (`artifacts/acceptance/delivery-fullstack-38630cfb-c868-409c-8f19-f8e1e5a51f73/result.json`), cleanup absence proof (`artifacts/acceptance/delivery-fullstack-38630cfb-c868-409c-8f19-f8e1e5a51f73/cleanup-proof.json`) and run log (`artifacts/acceptance/delivery-fullstack-38630cfb-c868-409c-8f19-f8e1e5a51f73/run.log`). That folder is gitignored scratch output, so these files are not in the repository and are shown as paths, not links.

The [script](../../scripts/run-application-delivery-fullstack-acceptance.ts) creates one isolated Auth user/workspace with a unique synthetic marker, records an exact candidate fact through the normal RPC, renders and uploads five application artifacts, and seeds an explicitly synthetic approved packet. It calls the normal candidate delegation RPC, claims only that application, and runs the shared production coordinator, materializer, Browserbase adapter, managed Agents harness and database submission authority. A missing consent answer pauses the first pass. The candidate answer RPC saves `true`; the second pass rebuilds the browser, applies that exact answer and records one receipt. A confirmed application cannot be claimed again.

The browser destination is a unique `roledawn-acceptance.invalid` host. A trusted test-only route transport serves the controlled local HTTP fixture only after the normal browser request policy has admitted each request. It cannot turn a disallowed URL into an allowed request. No public fixture site, employer endpoint or real candidate information is used. Production has no environment-configurable site-policy bypass. The test bypasses the UI-only Greenhouse availability filter for the synthetic origin; it does not bypass the candidate authority RPC or single-use submission checks.

This test deliberately starts with a rendered synthetic packet whose writing-quality gate is marked as fixture data. It proves the delivery path from candidate delegation to receipt and cleanup; it does not prove parsing, research, drafting quality, all controls on Greenhouse, or a real employer application.

The first provider run failed safely on the default context's extension service worker before a model call or upload. A second run proved delivery but exposed restrictive evidence-deletion ordering in the test cleanup. Both earlier scopes were fully removed and received the same 20-zero-count cleanup verification. The final script now removes acknowledged provider resources and private Storage objects, validates the exact synthetic owner/job, orders the synthetic receipt/attempt/approval cleanup, uses the existing service-role source-document purge, and verifies absence after Auth deletion. Immutable-row exceptions are transaction-local and limited to the exact synthetic records; no application schema or global trigger is relaxed.

Reproduce explicitly against the pinned test project:

```sh
RUN_HOSTED_DELIVERY_ACCEPTANCE=CREATE_AND_DELETE_ISOLATED_SYNTHETIC_DATA \
ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF=dxrrotrugwhquqxyoisk \
node --experimental-strip-types --env-file=.env.local \
  scripts/run-application-delivery-fullstack-acceptance.ts
```

## Deterministic delivery fast paths

Known exact fact labels, matching saved answers and unambiguous resume/cover-letter artifacts fill before the model. They use the same fact compatibility, lease, field fingerprint, immutable byte and browser readback checks as model-selected tools. Conflicting fact IDs and unclear labels stay unresolved for model interpretation or a candidate question. A completed step skips the model only after independent required-field and upload checks; a local regression completes a two-page form with zero model calls. Rejected explicit false consent remains a stop and is never changed to true.

The final focused delivery, runtime, routed-transport, acceptance-scope and repository suite passed 35 tests without skips. An additional connection-failure release regression passed afterward with all seven runtime tests. Owned-file lint passed. Whole-repository validation is recorded separately as concurrent product changes finish.

## Deployed migrations and local activation

The initial deployed migration set for this change was:

- `20260916231850_application_kit_combined_pdf.sql`
- `20260916231857_application_autopilot_delegation.sql`
- `20260916232449_detach_autopilot_cleanup_resources_before_delete.sql`
- `20260916232642_index_application_autopilot_candidate_binding.sql`

A service-only scoped claim overload was also applied for isolated acceptance; the ordinary global queue claim remains available with all existing lease and status checks.

The combined-PDF migration preserves the current authorization function body, work-authorization exceptions and wrapper ACLs while extending the artifact contract. Hosted policy acceptance passed. The forward cleanup fix detaches a resource before provider deletion, preventing a reclaimed worker from reconnecting to it. The performance advisor reports no uncovered autopilot foreign key. Existing intentional RPC/RLS notices and the prior Auth password-protection warning remain.

Local web and worker configuration enables the Agents driver and named-job delivery. `npm run dev:full` starts the app on port 3001 and the worker on port 8788. `/ready` reported all seven lanes healthy, including autopilot and cleanup. No permanent hosting deployment was made. The existing two blocked preparation runs were preserved; startup processed no application claims.

Earlier local-pilot checkpoint: 455 tests passed with none skipped; typecheck, lint, production build, Markdown links and whitespace checks passed. The final delivery browser suite passed 13 tests, including deterministic saved answers, exact contact defaults, wrong-fact rejection and normalized destination binding. No real employer submission attempts or receipts were created by these acceptance runs.

## Runtime controls

`ROLEDAWN_FORM_DRIVER=agents` selects the harness. `ROLEDAWN_AUTOPILOT_ENABLED=true` enables the new action and worker lanes. Both use the existing server-side OpenAI key. `npm run worker:autopilot` handles one claim; the long-running service handles `autopilot` and `autopilot_cleanup` independently of legacy fill. Cleanup continues while the Agents driver is selected even when new delegations are disabled.

One delegation binds an application, current revision, packet hash, artifact manifest and approved exact fact versions. The database verifies candidate ownership and freshness. It seals final readback and request fingerprint, then creates one `SUBMIT_APPLICATION_ONCE` consumption and attempt before the network request. Uncertain outcomes can be observed, never resubmitted automatically. Candidate replies survive browser teardown and remain scoped to their observed field fingerprint.

Known model/browser resources have private cleanup records. Failed cleanup remains pending with retry backoff. A lost model-session creation response can leave an unknown generic bootstrap session; candidate/form input is sent only after durable session binding.

## Remaining boundaries

Real-employer submission has not been exercised. A concrete US Greenhouse hosted-board policy exists; additional ATSs require an adapter and acceptance. CAPTCHA, login, MFA, unsupported controls and unverified receipt outcomes remain explicit stops. A static thank-you URL fetched in a new browser is never accepted as receipt evidence. The worker/database own application state; model-session memory is not a source of truth.

Related: [execution architecture](../architecture/agents-application-execution.md), [writing policy files](../../policies/application-writing/README.md), [earlier bounded-fill acceptance](agents-application-execution-acceptance.md).
