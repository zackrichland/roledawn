---
title: ATS delivery expansion acceptance
last_updated: 2026-09-16
status: Lever implementation accepted in synthetic browser tests; live CAPTCHA boundary verified
---

# ATS delivery expansion

## Implemented scope

The delivery registry distinguishes catalog coverage from application execution.

| Provider | Catalog and application preparation | Delivery | Current acceptance |
|---|---|---|---|
| Greenhouse US hosted | Yes | Existing exact board/job adapter | Earlier synthetic fullstack acceptance; no real employer submission |
| Lever global hosted | Yes | Exact tenant/UUID form, résumé parse upload, native fields, one-use multipart submit, retained receipt | Synthetic browser acceptance; official Aledade form read-only probe correctly stopped at CAPTCHA |
| Ashby hosted | Yes | Preparation only | Official form inspected; server-backed form mutation and upload protocol still needs an adapter |

**Verified:** Lever's hosted application uses a `POST` multipart form at
`https://jobs.lever.co/{tenant}/{posting}/apply`, a résumé parsing request to
`/parseResume`, and a public `/thanks` page with a submission-success marker.
Those observations do not prove that any real application was sent or accepted.
The concrete policy checks the observed form action, method and encoding before
using it. Custom domains, EU hosts, query/referral variants and unexpected steps
remain outside this release.

## Controls exercised

- The parser upload must contain the exact approved artifact bytes and only the
  observed employer account ID as its additional field. A filename alone cannot
  acknowledge an upload: the HTTP response and parser-success control must agree.
- Lever's question wrapper supplies the question text independently from each
  Yes/No option. This preserves sensitive-question classification. Its résumé
  label stays stable when the displayed filename changes; the employer's required
  marker is retained even when the file input lacks native `required`.
- Approved exact facts are filled before the résumé. Any additional fields
  populated by Lever's parser require an approved fact or candidate answer;
  parsing is not candidate authority.
- Before final authority is consumed, the multipart submission's artifact bytes
  must still equal the acknowledged artifact. The existing final review and
  durable single-use hook remain in the dispatch path.
- Duplicate requests are blocked. Missing confirmation stays uncertain and is
  reconciled against the retained page and persisted response without sending
  again. A direct visit to the public thank-you page is not proof.
- CAPTCHA, changed form contracts, failed uploads and unknown controls stop
  safely. No CAPTCHA solution, token fabrication or challenge bypass is present.

## Evidence and commands

**Verified 2026-09-16:** a read-only probe of the official Aledade Lever form
loaded the concrete application step, observed 28 fields and returned
`APPLICATION_FILL_CAPTCHA_TAKEOVER`. It dispatched zero non-GET requests and
zero submissions. This establishes a live compatibility boundary, not live
delivery acceptance.

The production resolver and request boundary are exercised by
`src/server/workers/application-delivery-lever.test.ts` using reserved synthetic
candidate data and an in-memory transport that cannot forward to an employer.
It covers normal/duplicate submission, failed upload, extra upload fields,
tampered final bytes, parser-added values, CAPTCHA, form drift, reconciliation,
and provider question/filename semantics.

```sh
node --experimental-strip-types --test src/domain/application-autopilot-eligibility.test.ts src/server/workers/application-delivery-lever.test.ts src/server/workers/application-delivery-browser.test.ts
npx supabase db query --linked --file scripts/ats-delivery-capability-acceptance.sql
```

**Verified:** the capability migration plus its rollback SQL acceptance passed
against the hosted database before application. The helper is private, rejects
unsupported destinations and is used inside the existing immutable delegation
function. It must precede the account auto-apply scheduler migration.

## Ashby boundary

**Verified:** the inspected Notion form has an asynchronous form load, a separate
autofill control, required résumé upload, custom question controls and reCAPTCHA.
Official API documentation describes permissioned application submission and
presigned uploads. This is not an applicant API key available to RoleDawn.

**Inference from current public client code:** hosted Ashby uses a shared
non-user GraphQL endpoint with named operations for form rendering, field state,
upload handles and final submission. Safely supporting that flow requires
operation and payload binding, including per-field autosave authority. Allowing
the shared endpoint by origin would admit more than final submission. Ashby is
therefore explicitly excluded from automatic delivery eligibility until that
protocol and recovery behavior have their own accepted tests.

Primary sources and observed URLs are in the
[source register](../research/source-register.md#ats-delivery-contracts-2026-09-16).
