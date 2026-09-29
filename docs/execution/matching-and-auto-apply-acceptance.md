---
title: Matching and account auto-apply acceptance
last_updated: 2026-09-16
status: deployed; synthetic and hosted UI acceptance verified; fixtures cleaned
---

# Applications, matching and auto-apply

## Product behavior

Applications is the primary page. It contains account auto-apply, editable job preferences, an explained shortlist and individual application records. All jobs remains the complete inventory; it is not presented as a personalized feed. The Profile route retains résumé, evidence and exact-answer management.

Auto-apply is off until the candidate turns it on. That action authorizes automatic selection and delivery from current approved inputs. Each selected job creates a separate application and writing packet. The worker delegates its immutable packet, and the existing final request boundary consumes a named single-use submission approval. A model cannot alter consent, select a plan, invent exact sensitive answers, or claim an employer accepted a submission.

## Capacity and recovery

- The pilot plan permits at most one attempted submission per hour and 24 attempts per UTC day. Capacity is consumed when the durable attempt is inserted, including uncertain outcomes. Confirmations are counted separately.
- At most one nonterminal automatic application is active for a candidate. A required missing answer waits for that candidate; an adapter failure can end that application and let selection continue at the next available slot. Preparation is also bounded to once per hour.
- Pausing cancels unsent automatic work and invalidates candidate selection leases. It cannot recall a request already attempted. Such requests remain eligible for reconciliation, without another submit.
- Profile or preference changes pause standing consent. Re-enabling binds the new versions. Manual applications keep their existing authority and are not canceled by an account pause.
- Candidate-owned commands have RLS, ownership, optimistic version and idempotency checks. The hosted scheduler uses server-only credentials and leased lanes. No user can set their own capacity.

## Matching and delivery

Matching reads current approved evidence and saved targets, locations, countries, work styles and job types. It scans the fresh catalog with stable cursor pages, ranks transferable work and explicit role alignment, and excludes prior applications and passed jobs. The shared cache contains public catalog data only. Internal matching scores are ranking weights, not probabilities of a response or hire. Missing eligibility or credentials are review reasons; they are never inferred as exact answers.

Greenhouse US hosted and Lever global hosted have concrete delivery adapters. Ashby jobs can be recommended and prepared, but are excluded from automatic selection until their stateful delivery protocol is implemented. See [ATS acceptance](ats-delivery-expansion-acceptance.md).

## Evidence

**Verified 2026-09-16:** 549 tests passed with zero failures; lint, TypeScript, production builds, local Markdown links and diff checks passed. The final application deploy is `6aab41876b046b99ff99998c` at [RoleDawn](https://roledawn.netlify.app/dashboard).

- [Matching acceptance](profile-matching-acceptance.md) records the complete 5,879-job scan, a supported strong AI Product Manager match from the current profile, unrelated-profession rejections and candidate ownership checks. Cold matching measured 7.2 seconds and warm matching 1.67 seconds in the read-only benchmark.
- [Account auto-apply acceptance](../architecture/account-auto-apply.md) records eleven SQL assertion groups in isolated PostgreSQL and the hosted rollback run, content-hash binding, hourly/daily enforcement at the actual attempt, pause/uncertainty behavior, version/replay handling with two real concurrent clients, and zero residual synthetic records. The explicit database-deadlock retry is fault-injection tested; a real deadlock was not forced.
- The hosted `auto-apply` background lane completed an idle run successfully. The final deploy's authenticated health returned HTTP 200, enabled workers, and no auto-apply lane failures; anonymous health returned HTTP 401. Four private credential values were absent from all 32 text assets in the final browser output.
- Desktop, 390-pixel mobile and 768-pixel tablet views were inspected; the latter two had document scroll widths equal to viewport widths. Preferences stay on Applications and preserve comma-containing city/state names. A repeated-save command-ID defect found during review was fixed before final hosted UI acceptance.
- The hosted UI test used an isolated synthetic candidate with a deliberately unmatched target. Turning the switch on persisted active consent; the actual scheduled worker claimed it and recorded `NO_MATCHES` at `2026-09-17T01:27:12.479465Z`, after checking all 5,879 jobs. No application was created. A preference save paused consent; a second consecutive save retained `Washington, DC` and `New York, NY` as two locations. Re-enabling and turning off persisted separate consent versions, and the UI returned to Off. The synthetic account was signed out before cleanup.
- Post-UI database proof recorded consent version 4, status `OFF`, profile version 3 and the exact two-location array. Cleanup then verified zero scoped records across 23 checks, including Auth, workspace, résumé Storage, settings, runtime, enrollments, applications, attempts and receipts. The consumed login-link artifact was removed. No real candidate was enabled or changed; the final global check found zero enabled accounts and zero automatic enrollments. Private proof files are retained under `artifacts/acceptance/auto-apply-ui-d3148091-bbc2-484b-8c64-a7b08bf4119f/`.

No real employer application was sent. Synthetic browser tests exercise delivery; a live employer acceptance rate has not been established.

## Remaining boundaries

Ashby delivery, login/CAPTCHA completion, arbitrary employer controls and generalized answer reuse are still limited. The current page labels its ledger **Recent applications**; it loads the latest 100 while older database records remain retained. Full application-history pagination and commercial plan assignment/billing are later work. Required missing information may pause a candidate until answered; the hourly limit is a maximum, not a promised successful submission every hour.
