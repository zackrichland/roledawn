---
title: RoleDawn current state
status: canonical project snapshot
owner: founder, product, and engineering
last_updated: 2026-09-30
scope: current repository capability, recorded production evidence, and remaining single-account limits
---

# Current state

RoleDawn supports the founder's private application workflow. Greenhouse has
three employer-confirmed applications across two employers, verified by hosted
readback on 2026-09-30 UTC. Lever and Ashby have delivery adapters; live employer
acceptance remains unproven for both. Keep the product scoped to personal use.

**Published release:** `b4ae35b`, Netlify deployment
`6abca481cfba66dce4ca9bd1`. Authenticated worker health verified that exact release
at 05:56:59 UTC; the private gate returns 404 without access, all 14 checked page
assets return 200 and the approved private profile/story content remains
visible. The sole new Ashby submission occurred on `b103640`. Final readback
still shows one attempt, zero confirmed attempts/receipts, and
`RECONCILING`/`UNCERTAIN` with `DELIVERY_RECEIPT_RECONCILIATION_REQUIRED`.
The retained evidence establishes neither acceptance nor rejection; do not resend.
A deployment or mocked submission is not an employer receipt.

The initial [review and rollout](codex-review-2026-09-30.md),
[handoff brief](review-brief-2026-09-30.md) and
[state history](state-history-through-2026-09-30.md) preserve earlier evidence.
They do not override this snapshot or the [application playbook](application-playbook.md).

## Product capability

| Area | Current behavior | Boundary |
|---|---|---|
| Home and application detail | Paste a supported posting, follow preparation/sending, answer questions, enter an emailed code, and retry eligible stops. An existing send intent shows Queued to apply or Applying without a second approval. | Stored workflow state is authoritative; uncertain outcomes require reconciliation. |
| Jobs | Ranked catalog search, saved jobs and named-job application intake. | Source inventory changes; old catalog counts are historical. |
| Profile | Résumé review, structured experience, approved stories, routine answers, preferences and read-only Gmail connection. | Exact private content stays in owned database records. |
| Writing | Frozen candidate inputs, source-linked drafting and verification, owned writing policies and five rendered files. | See [writing policies](../../policies/application-writing/README.md). |
| Delivery | Browserbase form agent, approved facts/files, acknowledged writes, sealed single-use submit permission and employer-evidenced receipts. | Visible challenges and unknown contracts stop the send. |
| Answers | Profile facts, same-context remembered candidate answers, saved standing answers, then the candidate. | Sensitive exclusions remain in worker and SQL; D-125 permits only exact explicitly saved clearance reuse. |
| Branding | Employer logos from exact Ashby theme, Greenhouse configuration or Lever header, with bounded thumbnails. Code for a per-employer stored cache (`employer_logos`, D-134) is written and tested locally; the migration is **not applied** and the code falls back to live fetching. | Missing branding retains initials; no guessed domains, platform logos or banners. |
| Stops and retry | One catalogue gives every stop plain-English copy, one primary action and a retry class; Try again shows only where it can help (D-133). | Database caps on manual retries and re-claimed fill runs are not built (needs a migration). |
| Agent context | Reviewed per-ATS notes for Greenhouse, Lever and Ashby are added to the delivery-step prompt; eight other boards keep unverified paths (D-132). | Unit-tested only; not yet observed in a live run. |
| Interface | SF system stack with Inter fallback, tokenized surfaces and CSS-only motion (D-135). | Public pages screenshotted; signed-in screens checked only in a static mock. |
| Operations and access | Private access-key sessions, ownership checks, database leases, immediate lane wakeups, scheduled recovery and sanitized worker events. | Local web development still relies on the hosted scheduler for its initial tick. |

## ATS evidence

| Site | Supported path | Proof |
|---|---|---|
| Greenhouse | Prepare, fill, submit, handle emailed code and confirm. | Three earlier confirmed applications across two employers; all three record mailbox-supplied codes. The live location probe (D-118) is field-interaction evidence, not another application. |
| Lever | Delivery adapter and fixture coverage. | No recorded live employer confirmation. |
| Ashby | Exact-schema drafts, attachments, single/multiple-form submission and receipt handling. | Two real-client replays pass with the actual pre-dispatch checks. The live run reached a response on one submission attempt, but has no employer receipt and remains unknown. |
| Other boards | Research templates only. | No delivery proof; see [board templates](../boards/README.md). |

Ashby diagnosis found action-ID rotation after acknowledged saves, widget
refetches, transient frame URLs, late passive CAPTCHA badges, and the provider's
bare Location label plus asynchronous selection readback. The published fixes
keep exact operation, field/value, origin and submit-permission checks. The
prior run resolved its questions and completed review, then Ashby disabled
inputs on the final click. The pre-dispatch reader omitted those controls and
falsely reported field drift at 05:32:53 UTC; no final authority or request
followed. The published correction reads those exact values without making
disabled controls writable. Details and reversal triggers
are in D-123 and D-126–D-130 of the
[decision log](decision-log.md). A stopped Ashby run can leave an employer draft
containing approved candidate data.

For the latest attempt, `SUBMIT_RESPONSE_OBSERVED` records HTTP 200 and a body
hash, but `ashbyAccepted=false` and no observed receipt. That flag means the
acceptance predicate did not establish success; it is not proof of rejection.
The browser runtime is released with no reference, and the raw response was
not retained. New diagnostics cannot recover that response. Bounded static
response categories/counts are now published and verified for future attempts.
They use fixed enums, counts capped at 1,000
and a 2 MB parse limit, without raw response or candidate content. Acceptance,
retry and runtime-retention rules are unchanged (D-131). No new live application
is planned, and this unknown application will not be retried.

## Verified review changes

The initial review preserved the interface at the founder's request. Later
explicitly authorized changes added truthful send/error copy, removed duplicate
send approval, accelerated lane handoffs and supplied employer logos. The
layout remains unchanged. The approved private career entry and responsibility-only
story were saved through owning RPCs, preserving earlier records and evidence
bindings, and verified on their authenticated pages.

| Change | Current evidence |
|---|---|
| Matching worker/SQL standing-answer eligibility, fact-key allowlists and protected-question exclusions. | D-119; migration `20260930070000` applied, recorded and read back. |
| Unknown verification responses remain uncertain; Greenhouse city lookups require approved text and exact reviewed constants. | D-120; deployed with focused regressions. No new Greenhouse receipt is claimed for this review. |
| Published career, voice and story changes invalidate older inputs and pause auto-apply. | D-121; migration `20260930080000` applied/read back, including the bounded first-derived-profile exemption. Private profile publication verified the version increase. |
| Remembered answers require current candidate inputs and the same frozen job; only explicit GPA/education questions can cross jobs. | D-122; migration `20260930090000` applied/read back. Original candidate responses establish recall authority. |
| Ashby delivery and truthful send-intent replay/retry. | D-123/D-124; migration `20260930100000` applied/read back; historical uncertain attempts remain blocked. |
| Exact explicitly saved clearance reuse, without model inference or packet-version changes. | D-125; migration `20260930110000` and matching worker active, with owned basis/value checks. |
| Ashby city binding and independent answer-batch progress; residence-country authorization instructions. | D-129; only the reviewed provider/system control gets city semantics. Residence wording requires its matching country-scoped fact; location selects jurisdiction, not the sensitive basis. No SQL gate was widened. |

All five review/follow-up migrations have verified function bodies, security
modes and grants. Regenerated public types are unchanged. All 15 SQL check files
pass across 94 migrations. The security advisor reported no error or finding
on the changed follow-up functions; existing authenticated-RPC and password-policy
warnings remain.

For `b4ae35b`, all **805 tests** pass in 88.6 seconds, with zero failures or skips.
Typecheck, lint and documentation links also pass. The latest production dependency audit reported no known
vulnerabilities. The city-settle replay waits only for the exact chosen label
after one click; it neither retries the write nor bypasses the server's saved-value
proof. Final disabled-control verification passed 80 focused tests and two
real-client replays using the actual pre-dispatch checks, upload proof, required
field checks, sealed readback hash and saved-value proof hash. Changed disabled
values and labels received zero authorizations and zero submissions. These
checks establish mechanics, not live Ashby employer acceptance.

The published D-131 diagnostics pass 70 focused tests and independent
privacy/acceptance-parity checks across 24,307 payload cases plus three byte
cases. The final full suite and exact published-deployment readback also pass.

## Remaining limits

| Gap | Consequence for one candidate |
|---|---|
| Standing answers have no editor; automatic answers are not listed on the application page. | Their source and basis are persisted, but correction and inspection still need operator access. |
| Private agent replay records can retain extracted document text after provider cleanup. | No public disclosure was found; retention cleanup must preserve active and uncertain-session recovery. |
| Required consent, privacy and attestation fields need candidate input. | A send may pause on a valid form. O-013 remains open; automation must not invent consent. |
| Two historical archived attempts remain uncertain, with no lease and reconciliation exhausted. | Preserve their retry blocks; profile changes and a different application's result do not resolve them. |
| One additional Ashby attempt has an observed response but no receipt, raw response or retained browser. | Acceptance and rejection are both unproven. Future diagnostics cannot resolve this older attempt; preserve its resend block. |
| Archive has no candidate button; candidate export and account deletion are incomplete. | Operator work remains; this is not a broader-user release. |
| No notification channel outside the app. | Check Home while sends run; Gmail disconnection or a new question may need attention. |
| Only one delivery runs at once. | Bounded personal use; throughput and multi-user operation are unproven. |
| Wider Gmail consent verification and account-based ATS flows are incomplete. | Keep the private-account scope; Workday and similar sites are unsupported delivery paths. |
| Résumé parsing has no malware quarantine or OCR. | Sources are truthfully marked NOT_SCANNED; scanned files need a text-based replacement. |

## Operating boundary

This review is complete without a confirmed Ashby receipt. The current Ashby
attempt needs new employer-side evidence to resolve its outcome; no new
submission or retry is planned. Keep it and the two historical uncertain
attempts blocked until their own outcomes are established. Greenhouse remains
the only ATS with verified live acceptance for this account.

The [application playbook](application-playbook.md) owns operating instructions;
the [decision log](decision-log.md) owns decisions and reversal triggers.
