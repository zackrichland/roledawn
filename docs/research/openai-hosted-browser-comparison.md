# OpenAI-hosted browser comparison checkpoint

Status: offline public-probe request builder, 2026-10-04. No hosted-browser session or employer request has been started from this branch. Candidate-bearing hosted submission remains blocked; this builder is not a submission guard.

RoleDawn's form agent already uses the Agents API with `environment.type: "none"` and function tools. The employer browser is a separately controlled Browserbase/Playwright runtime. Changing the model alone would not compare browser providers. The [Agents API computer-use guide](https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use) describes a different runtime: a `computer_use` tool in an `openai_hosted` environment with desktop enabled. Its session event stream must be open before posting the task; each new website origin produces a `computer_use_approval_request` that requires a decision through the session events API.

The guide explicitly says origin approval does not enforce confirmation before each consequential browser action. RoleDawn's sealed, single-use submit permission is enforced by its controlled browser runtime. Direct candidate submission through the built-in hosted browser would bypass that enforcement. A noncandidate public-page probe avoids sharing applicant data, but a prompt alone does not block an HTTP POST. A candidate submission path needs a server-enforced equivalent before it can be used for acceptance.

For a bounded public-page comparison, configure the hosted sandbox with [restricted network access](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) to exact required host names where feasible. Browser origin approval is a separate decision. Record only redacted lifecycle markers, requested origins, session and turn IDs, and usage. Delete the session after the task; a closed event stream alone does not stop it. [Agent usage](https://developers.openai.com/api/docs/guides/agents-api/observability) is best effort and is not an invoice. [Container time and model tokens](https://developers.openai.com/api/docs/pricing) both count toward a comparison budget.

An organization costs read requires an appropriately authorized billing credential. A failed billing read does not by itself prove a budget was reached. Project browser-minute metering, an unknown invoice, and unretained prior model-token totals cannot establish a numeric upper bound on aggregate dollars. A conservative future probe estimate needs: a confirmed prior billed amount or credible upper bound; its chosen model/service tier and context length; a total input/output token allowance across all model calls; container size and elapsed billable minutes; and any other tools. The [current pricing table](https://developers.openai.com/api/docs/pricing) lists 4 GB containers at $0.12 per 20-minute session with eligible minute billing and a five-minute minimum, and multiple GPT-6 Astra rates by tier/context. Use the rate for the actual tier or a higher published rate; do not infer an invoice from best-effort session usage. A noncandidate public-page probe cannot count toward the employer-confirmed nine-job release gate.

An opt-in request builder in `src/server/workers/openai-hosted-browser-probe.ts` is restricted to public Lever or Ashby job URLs, exact network host names, no candidate packet, no caller-supplied prompt or files, and an explicit origin decision. It has no path to the submit authority or receipt writer. It is not wired into production or run live. These constraints preserve RoleDawn's single-use submission invariant because any candidate send still uses the controlled runtime. They do not make the built-in hosted browser safe for a candidate-bearing employer form: the API documents no mandatory per-click or per-request interception hook for this tool. A custom browser runtime with application-enforced network and action checks is the documented way to guarantee that invariant; that would be a different browser comparison from the built-in OpenAI-hosted desktop.

## Cloud continuation and remaining gates

**Verified, 2026-10-04:** the cloud executor checked out the transferred public-safe checkpoint `838b2c759ef07df2e49e5132f27c1ecace2bdaa1` on an isolated repair branch. The transferred Browserbase fixes remain intact. No production adapter or Greenhouse flow is changed by the hosted probe.

The probe now separates idle session creation from the task event. The caller must establish the event stream before posting `createHostedBrowserProbeTask` to the session events endpoint, matching the current official walkthrough. This prevents the request builder from eagerly starting browser work during session creation. Origin responses reject authentication and function-call action types at runtime, even if a caller bypasses TypeScript. The builder does not itself establish a stream or run a browser.

**Verified transport diagnosis:** direct Node fetch returned `TypeError` with cause `ECONNREFUSED`; curl through the configured transport reached public documentation and GitHub. Node 24's documented `--use-env-proxy` option made the same read-only checks succeed through the existing `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` configuration. The configured Supabase health endpoint returned HTTP 401 without credentials, establishing network reachability, not authenticated database access. Do not replace the proxy, disable certificate checks, or print environment values. This is an executor invocation setting, not an application transport change.

The remaining live gates are independent:

- Secure provider and application service credentials must be configured by the operator. The cloud readiness check found public Supabase configuration but no OpenAI, Browserbase, or Supabase service credential.
- The aggregate additional-test budget needs a credible prior-spend upper bound. Existing browser-minute counts and unknown model charges do not establish one. No new provider call was made during cloud readiness work.
- Built-in hosted computer use still lacks the mandatory action/request interception needed to enforce RoleDawn's sealed, single-use submission authority. An origin allowlist cannot restrict the number of POSTs to an approved employer host. A model-called permission function, later cancellation, or post-hoc receipt check cannot replace pre-dispatch enforcement. Do not connect candidate packets or the receipt writer to this adapter until that boundary can actually be enforced and tested.

The official guide explicitly recommends a runtime under application control when consequential actions need guaranteed confirmation. A separately controlled runtime would require an explicit change to the comparison design; it must not be reported as acceptance by the built-in hosted browser. No employer receipt is claimed here.

## Submission architecture decision

**2026-10-04 design review:** the following controls are useful but insufficient for the built-in hosted desktop:

| Proposed control | What it enforces | Remaining failure |
| --- | --- | --- |
| One application lease and immutable packet | One worker owns the approved candidate/job/packet version | The browser can issue multiple employer requests during that worker's turn. |
| One task or one active turn | Restricts application orchestration | One turn can include many tool calls; a message during work steers the active turn. |
| Function-tool submit permission | The function can validate the existing sealed permission | Built-in computer use need not call the function before clicking or sending. |
| Stop/delete immediately after submission | Bounds later work after the signal is received | First and duplicate requests can already be in flight. Cancellation is not transactional rollback. |
| Restricted exact employer host | Limits outbound destinations | Upload, draft, submit and duplicate submit can share one allowed host. |
| Published traces and receipts | Supports diagnosis and reconciliation | Traces arrive after work and cannot prevent a request. Model text is not a receipt. |

**Concrete supported alternative, not implemented as a new provider:** retain the Agents API function-tool agent with `environment.type: none` and an application-controlled browser runtime. A provider adapter may supply a Playwright/CDP browser only if it supports the existing mandatory request guard, service-worker handling, verified upload bytes, exact field readback, and final durable authority callback. The agent receives no raw CDP, shell, unguarded navigation or fetch tool. Preserve the existing database lease and packet/version bindings; consume the existing one-use submit authority immediately before the matching employer request leaves the controlled runtime; block every later submission; classify an ambiguous network outcome as uncertain and reconcile before retry. Reuse the current protocol predicates and receipt writer rather than introducing a second ledger or in-memory substitute for durable authority. A successful outcome here would be an alternative runtime test, **not** built-in OpenAI-hosted browser acceptance.

The currently available Browserbase adapter already provides that controlled-runtime boundary. It remains the approved fallback for previously named Lever applications after credentials, current readback, spend verification and duplicate checks. There is no reason to remove its fixes while investigating another provider. The supported integration pattern is described in [computer-use integration recipes](https://developers.openai.com/api/docs/guides/tools-computer-use-integration); it does not document an interception hook for the built-in Agents API desktop.

## Redacted trace inspection

`src/server/workers/openai-hosted-browser-traces.ts` and `scripts/read-hosted-browser-traces.ts` read **existing** sessions via the documented [session traces endpoint](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/subresources/traces/methods/list). They never create a session, send a task, or write application state. The endpoint's trace `id` is the root turn ID, allowing correlation with a private operator-owned turn/stage map. Use a single stage only when that turn belongs to that stage; leave mixed or unknown turns unmapped.

The reader bounds requests to five pages, one trace per page, 2 MiB per response and a 15-second transport timeout. It rejects session mismatches and repeated pagination, hashes session/turn identifiers, and exports only stage, span count, failed-span count and unset-status count. Names, attributes, prompts, tool inputs/outputs, screenshots, URL paths, error messages, and purported hidden reasoning are discarded. Permission failures remain a fixed diagnostic. This is offline-tested diagnostic tooling, not a live collector wired into production.

Run only with an authorized existing session and a private manifest outside the repository:

```bash
node --use-env-proxy --experimental-strip-types --env-file=.env.local scripts/read-hosted-browser-traces.ts /absolute/private/manifest.json
```

The manifest shape is `{ "sessionId": "sess_example", "stages": { "turn_example": "INSPECTION" } }`. Allowed stages are SETUP, INSPECTION, FILL, READBACK, VERIFICATION, SUBMISSION and RECONCILIATION. Trace export must be enabled for the organization and the project key needs `api.traces.read` or `api.agents.read`. Empty/pending traces do not prove zero work or zero cost; pagination completion does not mean late traces or billing are complete.

For tool/network/verification/receipt investigation, correlate this turn summary with the existing controlled-runtime worker events and authoritative employer evidence. The built-in trace API is not documented as a complete browser network log. Do not infer a CAPTCHA token, employer POST, or receipt from span completion. No live trace access or network/receipt observability for the native desktop has been verified.
