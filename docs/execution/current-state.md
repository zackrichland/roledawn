---
title: RoleDawn current state
status: canonical project snapshot
owner: founder, product, and engineering
last_updated: 2026-10-04
scope: current repository capability, recorded production evidence, and remaining single-account limits
---

# Current state

RoleDawn supports the founder's private application workflow. Greenhouse has
six employer-confirmed applications, including three fresh runs without
candidate questions, verified by hosted readback on 2026-10-01 UTC. Lever and Ashby have delivery adapters; live employer
acceptance remains unproven for both. Keep the product scoped to personal use.

**Published release:** `b439327`, full-build Netlify deployment
`6abeb461eac67700e371f1b7` (2026-10-01 UTC). Authenticated worker health
confirms that exact deploy with workers enabled. It includes D-150–D-153 form
repairs, rejection diagnostics and provider-local solver creation/polling.
The latest live Lever run admits creation and polling but still stops after
the full 120 s solve budget with zero submission attempts (D-154): two creates,
93 successful query responses, no HTTP failures and no employer receipt.
HTTP success does not establish a completed solve. The D-155 run also expires
without submission: 90 successful query responses, zero HTTP failures and no
recognized completion marker. Retained response bodies contain only a task
handle. The provider request uses the observed site key and exact application
URL. A completed solve and employer acceptance remain unproved.

**2026-10-01 acceptance batch remains incomplete:** nine fresh non-tech jobs (three per supported ATS) were pasted through the published Home with review-before-send off. Hosted readback at 19:36 UTC confirms three Greenhouse receipts, three unsent Lever failures and three uncertain Ashby outcomes. No candidate question interrupted the three confirmed sends; Gmail supplied the employer codes. Home shows six total Applied and Sent today 3/24.

**2026-10-04 follow-up:** one separately approved Ashby application reached `READY` with a validated packet, then stopped before any application attempt on the public client's initial empty Number-field autosave. It has no receipt. A narrow local protocol fix and public-form readback passed; it has not been deployed or retested with candidate data (D-157). An isolated hosted Lever probe ended `UNCERTAIN` after its browser agent reported that it could not upload the approved résumé; the probe produced no employer receipt and its reserved run remains locked. Neither result changes the original nine-job ledger.

**2026-10-04 isolated canary controls:** The scoped hosted-browser exclusion and evidence schema was installed in the HireWire Supabase production project and read back. Its four private tables have RLS; five RPCs execute only for `service_role`; the five scoped triggers are enabled. An exact packet, approval and conservative budget reservation were staged for the authorized FP&A probe. Its one hosted run ended `UNCERTAIN` with captured evidence and no receipt. The normal FP&A application remains `FAILED_SAFE` with zero application attempts and receipts; the hosted run is locked against replay. The nine-job employer-confirmed gate remains 3/9. Ashby originals remain uncertain and resend-blocked.

Lever reaches exact field and artifact readback after the native location and parser repairs (D-150/D-151). Its provider-local creation/polling now passes the guard (D-152/D-153), but the full solve budget ends without a completed result or employer request (D-154/D-155). This is the current delivery blocker, not proof of a platform-wide vendor outage. Ashby's three final responses contain the reviewed low-score verification error and no receipts. Unknown-outcome protection blocks their resend. The nine-job acceptance requirement has not passed; fixture success does not change that assessment.

The phone-country migration `20261001180000` is applied, recorded and read back; regenerated public types are unchanged. Unsent retries used the candidate control RPC with unchanged inputs and no attempt, seal, lease or stop request. Earlier question rechecks preserved open questions until worker readback. Initial city/SMS classification, a writing repair and intermittent Greenhouse 503/timeouts are recorded in D-149–D-151.

An earlier Ashby submission occurred on `b103640`. The last recorded readback
shows one attempt, zero confirmed attempts/receipts, and
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
| Delivery | Browserbase form agent, approved facts/files, acknowledged writes, sealed single-use submit permission and employer-evidenced receipts. | CAPTCHAs go to Browserbase's solver first (D-146); a final-click check still unsolved opens in the guarded browser inside RoleDawn for up to five minutes (D-144). Unknown contracts remain visibly stopped. |
| Answers | Profile facts, same-context remembered answers, saved standing answers and explicit acknowledgement delegation, then missing candidate facts. | Worker and SQL enforce the same scope; D-125 permits exact saved clearance reuse, and D-136 binds delegated acknowledgements without inferring qualifications. |
| Branding | Employer logos from exact Ashby theme, Greenhouse configuration or Lever header, with bounded thumbnails. The per-employer cache (`employer_logos`, D-134) is applied and deployed. Production returned the same 1,044-byte WebP twice and hosted readback confirmed a FOUND row for the tested Ashby board. | Missing branding retains initials; no guessed domains, platform logos or banners. |
| Stops and retry | One catalogue gives every stop plain-English copy, one primary action and a retry class; Try again shows only where it can help (D-133). | Database caps on manual retries and re-claimed fill runs are not built (needs a migration). |
| Agent context | Reviewed per-ATS notes for Greenhouse, Lever and Ashby are added to the delivery-step prompt; eight other boards keep unverified paths (D-132). | Deployed and unit-tested; not yet observed in a live application run. |
| Interface | SF system stack with Inter fallback, tokenized surfaces and CSS-only motion (D-135). | Signed-in local Home visually checked after rollout; the tested Ashby and Greenhouse logos render, Sent today reads 3/24 and review-before-send remains off as selected by the founder. Other screens retain earlier evidence. |
| Operations and access | Private access-key sessions, ownership checks, database leases, immediate lane wakeups, scheduled recovery and sanitized worker events. | Local web development still relies on the hosted scheduler for its initial tick. |

## ATS evidence

| Site | Supported path | Proof |
|---|---|---|
| Greenhouse | Prepare, fill, submit, handle emailed code and confirm. | Three earlier confirmations plus three fresh 2026-10-01 confirmations without candidate questions; all six record mailbox-supplied codes. The live location probe (D-118) is field-interaction evidence, not another application. |
| Lever | Delivery adapter and fixture coverage. | Three fresh runs pass complete field readback. The D-154 run expires after 120 s, with successful provider polling but no employer request. D-155 also expires with task-handle responses and no employer request. No recorded live employer confirmation. |
| Ashby | Exact-schema drafts, attachments, single/multiple-form submission and receipt handling. | Two real-client replays pass with the actual pre-dispatch checks. An earlier attempt remains unknown; three fresh final responses return a low-score verification error and have no receipts. Their resend blocks remain. |
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

**Verified D-139 rollout:** all 889 tests pass; typecheck, lint, docs links and the full production build pass. GitHub CI passed on rerun after a Chrome startup timeout. Both repaired live sends reached their forms: Ashby asked five required questions, Greenhouse retained four missing facts and Lever asked two optional parser-filled fields. None of these three sends had created an attempt. D-140 repairs the optional parser stop and the Home question reader, which wrongly hid existing questions when new-send execution was disabled. The signed-in local Answer panel now shows the actual text/select controls. Approved narrative evidence is provided before the model turn; the agent must attempt a draft through the independent validator before requesting new factual details. Unsupported claims are still refused.

**Verified D-140 rollout:** all 896 tests, typecheck, lint, documentation links and GitHub CI pass. The SQL check for retiring obsolete questions passes across 98 migrations; no new migration is needed. The full-build deployment and exact release checks above pass. Four candidate-supplied factual replies were saved through the owned standing-answer RPC and read back by count. That RPC re-queued the waiting sends without changing the frozen candidate input version. A separately guarded optional-question recovery transaction refused the already-changed send state and rolled back without mutation. Exact answers and operational IDs remain private. Subsequent live runs are recorded below; these checks alone do not establish employer acceptance.

**Further live diagnosis:** Ashby generated its narrative through the independent evidence validator, then stopped before an attempt because the standing-answer mapper omitted a supplied region. Its shortened location selected a same-named state; the unchanged city-only network check rejected it. A fresh hosted browser probe succeeds with the complete candidate-approved text, without final submission. D-141 preserves exact-topic text without a model call and requires all supplied location components when mapping new wording.

Greenhouse rejected two unsupported narrative proposals, then a validated proposal failed native text-input readback. The local browser regression reproduces paragraph-break loss and passes after formatting before validation/fill (D-142). Lever cleared the obsolete optional parser fields and reached final submission, where a visible CAPTCHA stopped it before any attempt or employer request. No challenge was interacted with or retried; there is still no Lever receipt.

**Verified D-141/D-142 rollout:** all 899 tests, typecheck, lint, documentation links, the standing-answer SQL check across 98 migrations and GitHub CI pass. The production build took 50.5 seconds; exact release, private gate, approved profile/story and all 14 checked assets pass. A public lookup confirms the shortened location names a Region, while the complete approved text passes the hosted City save/echo checks. The earlier derived answer remains append-only evidence: a guarded correction transaction was rejected by the immutable-row trigger and rolled back. Fresh Ashby forms have new schema fingerprints, and standing-derived answers never enter cross-form remembered reuse. The normal control RPC returned the two zero-attempt sends to waiting questions; re-saving the unchanged, owned city answer through its RPC re-queued both for the corrected resolver. No direct record mutation or submission bypass occurred.

**D-143 diagnosis and local verification:** the latest Greenhouse run still stopped on native narrative readback after D-142. Its short-answer input has a 255-unit native text limit; the reader now exposes and fingerprints the limit, refuses oversized drafts before validation/write, and allows a complete supported revision. Ashby correctly saved its location, experience and validated narrative, then repeatedly asked one sponsorship question even after the candidate answered it through Home. The Home save succeeded and re-queued the send, but fresh Ashby field fingerprints hit a recall function that excluded original replies within that same send. D-143 removes that exclusion under the unchanged candidate/input/job/wording/option and protected-question checks. Both regressions fail before the repair; all 901 tests, typecheck, lint and docs links pass afterward. The SQL check passes across 99 migrations. Migration `20260930222500` is applied and recorded in hosted history; private function execution remains unavailable to public/candidate roles. GitHub CI passes and the full build/deploy took 51.8 seconds. Hosted readback confirms the exact new deploy, all recall checks and unchanged private function grants; generated types are unchanged. The private gate, approved experience/story and all 14 checked assets pass. The two named zero-attempt sends were re-queued through their existing control/settings RPCs; live outcomes follow below.

**D-143 live readback:** the fresh Ashby form reused the original candidate sponsorship reply, filled the saved city and experience answers, and passed complete review before a visible verification check stopped it with zero attempts. Greenhouse wrote the bounded narrative successfully and now waits only on three missing factual choices; no new application receipt is claimed.

**Verified D-144 rollout:** final-click human verification retains the guarded worker/browser and opens the exact tab in Home or the application page. An owned metadata RPC exposes only the expiry; the provider binding stays service-only. Pausing, stale leases, expiry, wrong candidate or an existing attempt deny access. Synthetic completion sends once; drift, cancel and expiry send nothing. Migrations `20260930230000` and `20260930231000` are applied. All 905 tests, typecheck, lint, docs links, 19 SQL checks across 101 migrations and full builds pass. GitHub CI passed on rerun after an unchanged Chrome startup test failed; its isolated local rerun also passed. The live Lever browser rendered inside Home at 23:24 UTC and closed after five minutes, with no attempt. A usable challenge and human completion are not yet proven.

**D-145 diagnosis and local verification:** a fresh Ashby send passed answers and complete review, then rejected its final token envelope before any attempt. The current public client uses exact Enterprise prefixes that the existing regex excluded; both form-count variants now cover those prefixes and reject malformed/empty/oversized envelopes. A synthetic Lever replay reproduces a check-image request preceding the visible-frame observer; read-only images are now admitted during the active unsent submit, while answer requests still require the candidate's bounded window. Expiry receives its specific timeout code. Resuming an unsent FAILED_SAFE send rereads the form instead of waiting on stale OPEN descriptors; ordinary question pauses and unknown-outcome blocks remain. All 906 tests, typecheck, lint and documentation links pass; all 19 SQL checks pass across 102 migrations. Hosted rollout and new live results follow below.

**Verified D-145 rollout:** migration `20260930234000` is applied and recorded; hosted readback confirms the fresh-inspection branch, unchanged resume checks, empty search path and no anonymous execution. Regenerated public types are identical. GitHub CI, the local production build and full-build production deployment pass. The exact deployed worker, private gate, approved career/story and all 14 checked assets pass. The local web dashboard restarted with both worker-execution flags off. The named zero-attempt Ashby send resumed through Home; the named Lever send's preceding generic expiry was resumed through the same owned control RPC in an ID-scoped transaction after confirming no attempt or active lease. Ashby is running and Lever is queued; new employer acceptance is still unproven. The older uncertain application and its resend block are untouched.

**Live in-app verification, 23:43 UTC:** Ashby reused the saved facts, passed complete review and opened the owned browser check. The dashboard panel visibly renders the employer's real image challenge inside RoleDawn; the candidate was asked to complete it there. Hosted readback still shows zero attempts. No agent interacted with the challenge. Lever waits behind the retained delivery lane; human completion and new employer receipts remain pending.

**D-148 LinkedIn guidance:** the base delivery-step prompt now directs the agent to skip social sign-in, account connection and LinkedIn profile/résumé imports, use the ordinary form and approved upload, and fill a plain LinkedIn URL only from its approved profile fact. The founder reported a Lever connection stall; its exact cause and live behavior after this change remain unverified. No interface, candidate record or submission authority changed. The full suite passed 910 tests before pulling the two observability commits from main; afterward, all 35 focused context, fact and runtime tests, typecheck, lint, documentation links and the final production build pass. The full-build production deployment and authenticated release/assets checks above pass. Local web development restarted with both worker-execution flags off.
