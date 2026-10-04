# Isolated hosted canary: review and operator contract

**2026-10-04: one scoped Lever hosted canary ran and remains UNCERTAIN.** The isolated runner, Supabase RPC store and recovery controller are connected in code; no active worker imports this runner and the production app was not deployed from this branch. The paid canary's saved turn reported it could not upload approved PDFs, but its browser calls contained no screenshots or tool errors, so that report alone did not establish a file-staging failure. The provider session was deleted; the subsequent read-only trace lookup returned 404. No independently verified employer evidence or production receipt exists, and the reservation remains closed.

Two synthetic, non-employer hosted sessions then tested the upload boundary. Both created with an inline PDF and a setup command that checked its exact SHA-256 under `/workspace` before the agent started; the [hosted environment guide](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) says input files are prepared before setup commands. In the first, the agent claimed attachment was unavailable without opening the test page. In the second, it navigated to a public upload test form, opened its file chooser and selected `/workspace/synthetic.pdf`; a saved screenshot shows `synthetic.pdf` beside the control. Its single Upload click failed as a computer-use tool call, and the agent reported a protocol-approval block. No upload confirmation was observed. A separate ordinary HTTPS multipart POST to the same public test form returned HTTP 200 with no redirect, which narrows the failure to the hosted browser/action path; it does not explain that path's exact internal rejection. Both synthetic sessions were deleted. The current plan builder now checks staged PDF hashes and explicitly instructs file-chooser selection and filename inspection; an employer upload with that revised plan has **not** been tested.

A third synthetic run used a separately authorized $10 diagnostic allowance and a lower-cost model on another public HTTPS upload form. The same synthetic PDF passed hosted setup. After six completed browser calls, the agent again asserted that `/workspace` was inaccessible without attempting the chooser. The one-shot controller stopped at its 20-item limit. It retained the first 20 completed item events and stopped on the 21st, one in-progress turn with `usage: null`, and an HTTP 200 empty trace listing before cancellation; a follow-up deletion succeeded. No chooser attempt, upload request or server acknowledgement was observed in the retained records. A direct HTTPS multipart POST to the public test endpoint independently returned an uploaded-filename page, which verifies the test site but says nothing about this hosted run. The diagnostic's actual bill remains unknown; no further candidate or diagnostic task is authorized by that allowance.

A fourth run was explicitly authorized as one corrected rerun of that same synthetic HTTPS form. The private diagnostic no longer counted reasoning items as browser actions and waited for terminal usage and traces before deletion. It ended normally after three completed browser calls, with no origin-access request, chooser selection, Upload click or server acknowledgement. The model again claimed it could not access `/workspace/synthetic.pdf`, despite the earlier Astra chooser screenshot demonstrating that the staged path can be selected in a hosted desktop. The retained terminal record has usage and one published trace; neither contains a browser action error or the computer-use arguments that would establish the model's claimed reason. The public form's 500 KB limit was not implicated by the 46-byte synthetic PDF. This result is a clean failed upload probe, not proof of a general hosted file-system restriction. No further rerun or candidate dispatch is implied.

Offline parsing later found that the 46-byte synthetic fixture had no PDF page tree, cross-reference table or trailer. This could confound a server-side upload test, but it does not explain the fourth run's lack of any chooser attempt. A replacement 1,464-byte one-page PDF (`f795eddbfa942edb6c8e67d2433f76c10007f48da1d719a5ad3222e97c67d099`) passed independent PDF parsing and text extraction; it has not been used in a provider session. The fourth run retained event types and all completed item events, but only the first saved-item page and no full raw SSE stream or `required_actions` snapshot. Its event types contain no `requires_action`; the third run did contain one such event. These records must not be combined to infer a single cause.

| Upload boundary | Retained evidence |
| --- | --- |
| Exact PDF bytes staged in hosted `/workspace` | Verified after the environment connected following the setup SHA check. Session creation alone starts setup. |
| Browser chooser can select that path | Verified by the earlier Astra screenshot showing the synthetic filename. |
| Form held the exact PDF bytes | Filename screenshot only; no byte-level form readback. |
| Hosted browser dispatched multipart Upload | Not verified. The one observed Upload tool item failed without an exposed error; the corrected Luna run never clicked Upload. |
| Test server acknowledged an upload | No hosted-session acknowledgement. Separate direct multipart requests show the public sites work. |
| Employer confirmed an application | None from these synthetic probes or the candidate canary. |

## Reviewable files

- [Applied migration](../../supabase/migrations/20261004183836_hosted_canary.sql): private approval, aggregate budget, run and independently verified evidence tables; fenced service-role RPCs; scoped exclusion triggers.
- [Store](../../src/server/workers/openai-hosted-canary-store.ts): implements the controller's actual state contract, bounded RPC calls, durable cleanup and evidence reads.
- [Runner](../../scripts/run-hosted-canary.ts): explicit preflight, execute and recovery-only modes. It is not a worker fallback.
- [Controller](../../src/server/workers/openai-hosted-canary.ts): documented native hosted transport, immutable task identity, conservative recovery and independently bound evidence.
- [Database tests](../../scripts/hosted-canary-store.test.ts): apply all repository migrations and exercise both Lever and Ashby using the real service-role RPCs.

The reviewed draft was copied into the forward migration and applied to HireWire Supabase project `dxrrotrugwhquqxyoisk` through the authorized migration connector (remote version `20261004183836`). The installed CLI could not write telemetry under the read-only home directory. Initial readback confirmed four private RLS tables, five public service-role-only RPCs and five enabled triggers including immutable evidence; it preceded the later scoped approval, budget and run records. The public database types were regenerated from the live project. Schema installation alone grants no candidate task.

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

An optional annual USD salary answer is accepted only as an exact, application-specific operator input. It is never inferred from profile facts or promoted to a standing answer. The plan builder validates its numeric format and binds it into the packet and task hashes; the private approval must cover that exact value and question. The materialized-fact readback hash remains a separate record of source facts and artifacts.

The prior upper bound must include earlier provider/model work. Each hosted reservation adds its approved conservative future bound atomically; reservations are never automatically refunded. The Lever canary reservation is $20 against the $50 aggregate ceiling. The first two synthetic sessions incurred unmeasured model/container charges; the third used a separately approved $10 diagnostic allowance, with actual usage still unavailable. The production budget evidence expired after the Lever canary. Refresh the aggregate bound and budget record before another paid candidate task. Hashes reference a reviewed cost calculation; they do not manufacture one. A three-minute controller timeout is not a provider-enforced dollar cap.

## Execution and recovery distinction

After all exact-scope review/configuration/schema/packet/budget prerequisites are independently satisfied, `--execute /absolute/private/canary.json` uses the real transport and RPC store. This is a paid and candidate-bearing action, not a smoke test. Do not run it merely because local preflight passes; preflight explicitly reports deployed approval/exclusion as unverified.

`--recover` uses the same immutable manifest and an existing reservation only. SQL refuses recovery when no run exists. Expired admission deadlines, expired approvals or a disabled experiment cannot prevent recovery; they cannot authorize new input either. Recovery reads bounded retained turn history because live SSE does not replay downtime. It then cancels, attempts deletion and checks independent evidence, without task replay or a replacement session. An unavailable history endpoint does not prevent cancellation or independent evidence review. Unknown session creation remains uncertain and reserved.

Cleanup state is durable. Deletion failure remains `cleanupPending`; a later terminal recovery retries deletion, treating an already absent session as cleaned. Employer outcome and the full bound evidence object are committed atomically and remain immutable. The isolated runner reads `private.hosted_canary_verified_evidence` through a fenced read RPC. This table must be populated by independent review of genuine employer evidence; the worker cannot write it, and model output/turn completion are never sufficient. It is an experimental evidence ledger, not a production receipt writer or an automatic employer-mailbox verifier.

## Remaining activation gates

The implementation is **not ready for another live candidate task**. A separately approved Ashby packet was reverified through the current materializer: 12 source facts and all five artifacts, including byte-for-byte résumé and cover-letter PDFs, matched their recorded hashes. Before dispatch, a non-employer hosted test must demonstrate the full browser upload path, and the aggregate spend bound, exact private plan, origin decisions and independently staged approval/budget must be refreshed. The runner privately captures saved turns/items, screenshots and artifacts; these are diagnostics until independently verified. It does not expose a raw browser network log or hidden model reasoning. Automatic semantic employer verification and production receipt-ledger mapping remain unconnected. Without employer evidence the Lever result remains uncertain, with no retry or Browserbase fallback.

The accepted experimental limitation remains: the reservation prevents another RoleDawn run for the same intended job; it cannot enforce the exact payload, prevent another job on the approved ATS host, or prevent multiple employer requests within the first hosted task.

Local checks:

```bash
node scripts/migration-harness.mjs supabase/checks/hosted_canary.sql
node --test --experimental-strip-types scripts/hosted-canary-store.test.ts
```


## Evidence capture and verification

The [capture/verification module](../../src/server/workers/openai-hosted-canary-evidence.ts) and its fixtures use documented [saved items](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/items/methods/list), [artifact listings](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/artifacts/methods/list) and [artifact content](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/artifacts/methods/content). The prepared canary requests tool screenshots. Saved model descriptions, completed turns, screenshot pixels and agent-published files are **not independently authenticated employer evidence**.

The controller reads the documented hosted-environment status and requires `connected` before posting the candidate-bearing task. A `provisioning` state is polled under the existing deadline; `failed`, an unknown state or a mismatched environment ID stops admission. The earlier synthetic diagnostic had posted its task before `environment.connected`; that timing does not by itself explain its later unsupported file-access claim, because its three browser items occurred after connection.

Before provider deletion, the isolated runner polls briefly for terminal usage and archives bounded saved turns, paginated items and traces, screenshot bytes and up to five published artifacts matched to the session and completed turn. Trace spans are kept raw only in the private archive so their actual error fields survive; the separate public trace-summary reader still discards them. Items use pages of five and traces pages of one, up to 20 pages each, under a 2 MiB response limit and 20-second capture deadline. Missing usage or traces, excess pagination or any partial failure marks the archive INCOMPLETE. Independent capture steps preserve later artifact metadata if an earlier listing fails. Archive failure never keeps a paid environment alive indefinitely. Origin requests and exact decisions are privately archived before any approval is sent; an archive failure prevents the grant. Lost-stream recovery uses saved provider history, not replay assumptions. No evidence URL is fetched from an untrusted item.

`ROLEDAWN_HOSTED_CANARY_EVIDENCE_DIR` must name an existing 0700 directory outside the repository, not a symlink. Raw files are content-addressed, exclusive-created at 0600 and hash-checked on reads. The archive manifest binds run/session hashes and capture time; filenames from the provider are never used as local paths. Public console output contains only static status and archive-manifest hashes. The directory must persist for recovery; raw bytes stay private.

The independent operator's evidence row additionally needs a `verification` object following `EmployerVerification`. It binds approved candidate ID/contact, employer board identity, job UUID, session, raw-content digest, actual observation/run-start/verification times, source URL, explicit outcome and reviewer-reference digest. `expectedEmployerBinding` and `verificationDigest` compute the exact hashes without printing candidate facts; the latter is canonical across JSONB key ordering. The raw employer bytes must exist under their hash in the private archive. Stage this reviewed envelope only through the independently privileged evidence-table operation. A worker/model cannot create that row. Do not mark the independent-verification flags true merely because an agent output looks convincing: verify the employer origin and the exact applicant/job from an independent authenticated observation.

The isolated runner rejects absent independent review, model-statement kinds, unknown outcomes, wrong host/job/applicant/session, old/future timestamps, changed bytes and unverified screenshots. Genuine independently reviewed screenshot evidence is supported, but screenshot extraction alone is never verification. No normal application attempt, HTTP request fingerprint or production receipt is invented.

## Minimal activation prerequisites and next command

1. The scoped migration is deployed and read back. Runtime uses restricted `service_role` RPC grants; approval/budget/evidence staging requires a separate database-owner operator. The worker cannot stage its own approval or evidence.
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
