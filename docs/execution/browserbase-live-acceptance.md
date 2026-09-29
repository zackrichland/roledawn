---
title: Browserbase live no-submit acceptance
status: managed-session, controlled fill, and real-form fail-closed takeover accepted; real-form completion remains open
owner: engineering
last_updated: 2026-08-18
scope: managed-session lifecycle, controlled Greenhouse fill, real Greenhouse preflight, origin and submission guards, retained-runtime reconciliation, and explicit release
---

# Browserbase live no-submit acceptance

## Result

**Verified live on 2026-08-16 and rechecked with a fresh session on
2026-08-17:** RoleDawn opened a 60-second Browserbase session against
`https://example.com`, connected to it through Playwright over CDP, exercised
the existing fill-only security boundary, and released the session explicitly.
Browserbase returned `COMPLETED` after `REQUEST_RELEASE`. The recheck reported
`service_worker_blocked=true`; all previously accepted checks remained true,
and the adapter again reported zero outbound submission requests.

The API key inferred its Browserbase project. RoleDawn did not require or
persist a project ID. The key, inferred project ID, provider session ID, CDP
URL, and any Browserbase session URL are deliberately absent from this record.

That first run is a **live managed-provider acceptance against a synthetic
public target**. It is not an employer-side outcome or a production-provider
selection. Two later runs extended the evidence without granting Submit:

- a controlled Greenhouse-shaped form filled and read back eight frozen
  reviewed fields, uploaded two private byte/hash-verified PDFs, kept Submit
  disabled, observed zero outbound submission requests, and contacted no
  employer; and
- the actual candidate UI and hosted database opened the public Anthropic
  Greenhouse job in Browserbase. Preflight found two required protected/legal
  fields and returned `TAKEOVER` before disclosure: zero fields, zero uploads,
  zero outbound submission requests, no submission attempt, no receipt, and no
  employer contact. The provider session became terminal, and uncertain release
  telemetry reconciled the computer session to `FAILED_SAFE` while preserving
  the takeover state.

## Verified controls

| Boundary | Accepted evidence |
|---|---|
| Authentication | One server-only `BROWSERBASE_API_KEY` authenticated the SDK; Browserbase inferred the project. |
| Session isolation | One clean ephemeral session used a 60-second TTL with no persistent context, proxy, CAPTCHA solving, or recording requested. |
| Provider idempotency metadata | The RoleDawn computer-session metadata query returned exactly one matching session. No provider ID is copied into this document. |
| Browser connection | Playwright connected through the provider-issued CDP endpoint and reached the exact allowed origin, `https://example.com`. |
| DOM guard | A synthetic form submission attempt was blocked in the page. |
| Network guard | An unsafe `POST`, a post-load `GET`, and a WebSocket attempt were blocked. |
| Service Worker guard | Service Worker registration was blocked; the live rerun reported `service_worker_blocked=true`. |
| Submission accounting | The adapter reported zero outbound submission requests. |
| Teardown | RoleDawn requested explicit provider release; the final provider state was `COMPLETED`. |
| Data minimization | The run used no candidate, résumé, artifact, employer, login, or ATS data. |
| Controlled candidate data | The controlled fixture received only the current revision's eight frozen reviewed fields and two verified PDFs; values were not logged. |
| Real-form preflight | The real Anthropic form was inspected before disclosure. Two protected/legal blockers caused `TAKEOVER` with no candidate data or file upload. |
| Retained-runtime release | The runtime remained supervised through takeover. Terminal provider state plus uncertain telemetry was reconciled durably as `FAILED_SAFE`, never as submission proof. |

## Additional repository hardening

**Verified in repository tests:** request failures that are not already
attributed to the route guard are counted as untracked telemetry instead of
being silently ignored. If CDP provisioning fails after Browserbase creates a
session, the adapter explicitly requests provider release before returning the
failure.

The successful live synthetic rerun did not exercise a CDP provisioning
failure. That failure-path protection is therefore repository-tested, not a
claim about a live forced-failure drill.

## What this proves

- The installed Browserbase SDK and server-only credential can create a managed
  browser session without a separate project-id setting.
- The provider-issued CDP endpoint works with RoleDawn's Playwright connector.
- RoleDawn's exact-origin, unsafe-method, navigation, WebSocket, Service Worker,
  and DOM-submit interlocks remain active in a real cloud browser.
- Metadata-scoped session discovery and explicit release work at the provider
  boundary.
- Untracked request-failure accounting and release-on-CDP-provisioning-failure
  are covered by repository tests.

## What this does not prove

- a Greenhouse, Lever, Ashby, Workday, or other ATS form can be filled;
- arbitrary candidate facts or artifacts can be disclosed across employer
  forms safely; only the controlled fixture is accepted for disclosure;
- hosted candidate continuation of a retained Browserbase attempt; repository
  and real-Chromium coverage exist, but the additive migration and hosted
  Browserbase acceptance remain pending;
- login, OTP, CAPTCHA, certification, or unknown legal-question handling;
- `SUBMIT_APPLICATION_ONCE`, employer submission, uncertain-state
  reconciliation, confirmation evidence, or a receipt;
- reliability, cost, isolation, or support across the multi-ATS benchmark; or
- Browserbase as RoleDawn's production browser provider.

## Next acceptance gate

The controlled founder acceptance in
[application-fill-foundation-acceptance.md](application-fill-foundation-acceptance.md)
now materializes the current revision's eight reviewed fields and hash-verified
PDFs into one Browserbase session, reads them back, disables Submit, records
zero outbound requests, and releases cleanly. Passive no-disclosure inspection
also passed on the real Anthropic Greenhouse form by stopping on two
protected/legal questions. The repository now implements and regression-tests
candidate continuation under the same no-submit guard. The next gate is
deploying its additive migration and exercising it on one controlled retained
Browserbase session; see
[application-fill-takeover-resume-acceptance.md](application-fill-takeover-resume-acceptance.md).
CAPTCHA is detected and paused, never solved or bypassed. Final submission
remains a separate authority milestone.

## References

Browserbase documents API-key project inference in its
[Create a Session](https://docs.browserbase.com/reference/api/create-a-session)
API, CDP connection in
[Deploying a browser session](https://docs.browserbase.com/platform/browser/getting-started/deploying-browser-session),
and explicit `REQUEST_RELEASE` teardown in
[Update a Session](https://docs.browserbase.com/reference/api/update-a-session).
These vendor documents explain the provider contract; the results above come
from RoleDawn's bounded live acceptance.
