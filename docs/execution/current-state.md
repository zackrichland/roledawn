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

**Published release:** `8914db5` (includes Claude main `0364902`), Netlify deployment
`6abd6e09a26825e9a0a454c5`. Authenticated worker health verified that exact release
at 20:17:45 UTC; the private gate returns 404 without access, all 14 checked page
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
| Answers | Profile facts, same-context remembered answers, saved standing answers and explicit acknowledgement delegation, then missing candidate facts. | Worker and SQL enforce the same scope; D-125 permits exact saved clearance reuse, and D-136 binds delegated acknowledgements without inferring qualifications. |
| Branding | Employer logos from exact Ashby theme, Greenhouse configuration or Lever header, with bounded thumbnails. The per-employer cache (`employer_logos`, D-134) is applied and deployed. Production returned the same 1,044-byte WebP twice and hosted readback confirmed a FOUND row for the tested Ashby board. | Missing branding retains initials; no guessed domains, platform logos or banners. |
| Stops and retry | One catalogue gives every stop plain-English copy, one primary action and a retry class; Try again shows only where it can help (D-133). | Database caps on manual retries and re-claimed fill runs are not built (needs a migration). |
| Agent context | Reviewed per-ATS notes for Greenhouse, Lever and Ashby are added to the delivery-step prompt; eight other boards keep unverified paths (D-132). | Deployed and unit-tested; not yet observed in a live application run. |
| Interface | SF system stack with Inter fallback, tokenized surfaces and CSS-only motion (D-135). | Signed-in local Home visually checked after rollout; the tested Ashby and Greenhouse logos render, Sent today reads 3/24 and review-before-send remains off as selected by the founder. Other screens retain earlier evidence. |
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
retry and runtime-retention rules are unchanged (D-131). This historical unknown application will not be retried; separate new named
applications with zero attempts follow their own authorized sends.

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
| New factual qualification questions may lack an approved answer. | Saved delegation handles application acknowledgements automatically; it does not supply personal qualifications or missing facts (D-136). |
| Two historical archived attempts remain uncertain, with no lease and reconciliation exhausted. | Preserve their retry blocks; profile changes and a different application's result do not resolve them. |
| One additional Ashby attempt has an observed response but no receipt, raw response or retained browser. | Acceptance and rejection are both unproven. Future diagnostics cannot resolve this older attempt; preserve its resend block. |
| Archive has no candidate button; candidate export and account deletion are incomplete. | Operator work remains; this is not a broader-user release. |
| No notification channel outside the app. | Check Home while sends run; Gmail disconnection or a new question may need attention. |
| Only one delivery runs at once. | Bounded personal use; throughput and multi-user operation are unproven. |
| Wider Gmail consent verification and account-based ATS flows are incomplete. | Keep the private-account scope; Workday and similar sites are unsupported delivery paths. |
| Résumé parsing has no malware quarantine or OCR. | Sources are truthfully marked NOT_SCANNED; scanned files need a text-based replacement. |

## Operating boundary

The historical uncertain Ashby attempt needs new employer-side evidence to
resolve its outcome and will not be resent. New named applications with zero
attempts are being repaired and resumed under the founder's request. Keep it and the two historical uncertain
attempts blocked until their own outcomes are established. Greenhouse remains
the only ATS with verified live acceptance for this account.

The [application playbook](application-playbook.md) owns operating instructions;
the [decision log](decision-log.md) owns decisions and reversal triggers.

## Current repair (2026-09-30)

Verified root causes: passive Ashby automated-processing notices were rejected as posting drift; terminal writing failure release omitted `dead_letter_reason`, violating the outbox pair constraint and leaving Writing active; Greenhouse logos rejected the reviewed s5 CDN and disabled board indexes prevented extraction; daily usage joined only catalog enrollments, excluding pasted links. Local fixes and integration checks cover each. The configured OpenAI key reported credit exhaustion; a small request succeeded after the founder funded it.

D-136 adds explicit saved acknowledgement delegation with worker/database rule parity and exact employer descriptor audit. Model-turn failures and writing repair counts are logged without candidate text. The 95% delivery goal remains a target, not measured product evidence. Deployment, migration readback and new live results are recorded below.

**Verified repair readback:** migrations `20260930184500`, `20260930190000` and `20260930193436` are applied and recorded (98 migrations). Generated public types are unchanged. Terminal release, pasted usage, cap serialization, delegated mapping and worker/private grants read back correctly. The candidate's explicit delegation and earlier exact clearance answer are present; no profile input epoch changed. The requested Greenhouse logo cache was refreshed through the existing logo RPC. A read-only hosted Linux probe reproduced Lever's hidden hCaptcha enclave false positive, then passed inspection after the exact-path correction. No candidate fields or submission were used in that probe.

**Published repair:** `c17fda7`, full-build production deploy `6abd66cc945a219a569f32ff`; GitHub CI passed. The local dashboard reads Sent today 3/24. Three failed sends with zero attempts were resumed through their owning control RPC. Ashby reached a second startup mismatch: the public form uses a reviewed composite definition ID (D-137). Greenhouse reached missing factual questions; Lever remained queued behind the one active delivery lane. These are live progress observations, not employer receipts.

**Follow-up adapter repair:** D-137 composite definition support passed a fresh public posting read and all 884 unit tests; full-build deploy `6abd6af831bdb2c8beb0fb5f` passed worker health, private gate, profile/story and all 14 page assets. A resumed zero-attempt Ashby run then stopped on the mixed-location empty mount request; D-138 binds that observed widget contract. Lever stopped on exact field readback after parsing; its public client only protects changed/pasted fields, so the last focused edit needs native blur. The real-client mocked-parser replay and regression test pass without employer submission.

**Verified D-138 rollout:** all 886 tests pass; typecheck, lint, docs links and full production build pass. Deploy `6abd6e09a26825e9a0a454c5` serves the enabled workers, private gate, approved career/story and all 14 checked page assets. Real public Lever client replay with mocked parsing reproduced loss of the last focused approved field before the change and preserved it afterwards; no employer upload or submission occurred in either probe.

**Further live diagnosis:** the next zero-attempt Ashby send stopped on an idle hidden reCAPTCHA Enterprise challenge document; the hosted Linux before/after probe reproduces the old stop and corrected inspection with exact key/origin/path checks (D-139). The next Lever send stopped on upload acknowledgement, while a synthetic PDF parser probe shows successful markers and filename DOM text differing from uppercase innerText. D-139 corrects that comparison without changing filename identity or submission proof. No additional confirmed application is claimed.
