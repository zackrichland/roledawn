---
board: lever
status: fills-only
difficulty: medium
last_verified: 2026-10-01
url_patterns:
  - jobs.lever.co/<site>/<posting_uuid>
  - jobs.lever.co/<site>/<posting_uuid>/apply
  - jobs.lever.co/<site>/<posting_uuid>/thanks
  - jobs.eu.lever.co/<site>/<posting_uuid>[/apply]
  - jobs.lever.co/<site>
  - api.lever.co/v0/postings/<site>?mode=json
  - api.eu.lever.co/v0/postings/<site>?mode=json
---

# Lever

Compact agent context: `BOARD_CONTEXT.lever` in [board-agent-context.ts](../../src/domain/board-agent-context.ts), sent to the form agent on every send (at most 10 bullets and 900 characters). Add lessons by the [README](README.md#how-to-add-a-lesson) rules.

## Recognize it

- Hosted postings on `jobs.lever.co` (global) and `jobs.eu.lever.co` (EU); posting ids are UUIDs; the form is at `/apply` (`src/server/ingestion/job-reference.ts`, `src/domain/application-autopilot-eligibility.ts`).
- Page markers (**Verified**, audit of 5 live forms 2026-09-28 and code): `form#application-form` (POST, `multipart/form-data`, action = the `/apply` URL); hidden `input[name="accountId"]` (UUID); `input[type="file"][name="resume"]`; wrappers `.application-label` + `.application-field` with a `.required` marker (✱); submit `#btn-submit`; hCaptcha loader `js.hcaptcha.com/1/secure-api.js` and a `[data-sitekey]` element.
- Field names: `name`, `email`, `phone`, `location`, `org`, `urls[LinkedIn]`, `urls[GitHub]`, `urls[Other]`, `pronouns`, custom `cards[<uuid>][fieldN]`, survey `eeo[gender]`, `eeo[race]`, `eeo[veteran]`.
- Public API (**Verified**, vendor docs): `GET https://api.lever.co/v0/postings/<site>?mode=json` with `skip`/`limit` and filters (EU: `api.eu.lever.co`); postings carry `hostedUrl` and `applyUrl`. The apply `POST .../<site>/<id>?key=<APIKEY>` needs the employer's key; RoleDawn must not use it.
- **Inference:** custom-domain Lever job sites exist; the repo lists them as out of scope ([delivery expansion](../execution/ats-delivery-expansion-acceptance.md)).

## Application flow

Single page.

1. Posting page → **Apply for this job** (links to `/apply`; checked 2026-09-30).
2. Optional **Apply with LinkedIn** (3 of 5 audited forms; LinkedIn Apply Connect per Lever help, snippet only).
3. **Resume/CV** upload; Lever parses it and may prefill fields, including current location.
4. Full name, pronouns, email, phone, current location, current company, links. Lever says these standard fields cannot be removed (snippet only).
5. Employer question cards (radios, text, textareas, checkboxes, selects).
6. Optional US EEO section; optional diversity survey; consents (for example SMS or future-jobs contact).
7. **Submit application** → invisible hCaptcha runs (Inference from client code) → success page.

## Accounts and sign-in

- No applicant account (**Verified**, audited forms had no sign-in).
- No emailed verification code has been observed.
- Lever can block repeat applications by email and posting; the candidate is told when they may reapply (help center, snippet only).

## Documents and parsing

- **Verified (code):** the résumé upload POSTs multipart to `https://jobs.lever.co/parseResume` with the file plus one extra field, the page's `accountId`.
- Acknowledgement: `.visible-resume-upload .filename` shows the name and `.resume-upload-success` appears.
- The final multipart submit carries the résumé bytes again; RoleDawn requires them to equal the acknowledged artifact.
- The parser can fill or change other fields (current location among them). Parsed values are not candidate authority.
- Limits: Lever's demo form rejects files over 100 MB (Direct observation); the parser reads docx, PDF, RTF, WordPerfect, HTML and ODF (help center, snippet only).
- Cover letters usually go in an "Additional information" textarea (`comments` in the API) or a file card.

## Questions and widgets

- Mostly native controls: text inputs, textareas, radio groups, checkbox groups, `select-one` dropdowns.
- The question text lives in the card's `.application-label`; each option has its own label. Classify sensitivity from the question text, not the option.
- US EEO section: gender, race, veteran status and disability; Lever says to use it only on US postings (snippet only). Race appears as a select, radio group or checkboxes. The demo's disability block cites form CC-305 with an OMB expiration of 04/30/2026.
- A separate optional diversity survey (demo: age range, gender identity, ethnicity) and an AI-use notice can follow.
- Current location: filled from the résumé or picked from a dropdown (snippet only); audited forms exposed it as a text input.
- The file input may lack native `required`; the ✱ marker is the requirement signal.

## Verification and anti-bot

- hCaptcha on 5 of 5 audited forms via `secure-api.js` (D-104). **Vendor claim (snippet only):** 99.9% of applicants pass without seeing a challenge.
- Lever help (snippet only): a session flagged as a suspicious bot must solve an hCaptcha puzzle before the current-location dropdown works.
- RoleDawn admits only the loader, site config (`api.hcaptcha.com/checksiteconfig?host=jobs.lever.co`), the passive `getcaptcha` call during submit and a logo beacon; `checkcaptcha` (answers) is blocked.
- The Postings API returns `429` above 2 application POSTs per second and tells custom-form builders to add CAPTCHAs and rate limits.

## Submission and proof

- Final request: `POST https://jobs.lever.co/<site>/<id>/apply` (multipart).
- Default success page: `/thanks` with `[data-qa="msg-submit-success"]` reading "Application submitted!".
- **Verified:** a direct GET of `/thanks` returns HTTP 200 with the success marker and no application (source register ATS-D04). Proof must be this attempt's observed response plus the retained page.
- Employers can set an "Application Success Page URL" that redirects to their own site with `LeverAppId` appended (snippet only); RoleDawn's receipt check expects `/thanks` and would report such a send as uncertain.
- Lever emails the candidate after applying unless the API `silent` flag is set; employers toggle and template these emails. Sender **Unverified**.

## Known quirks

- **Verified, 2026-10-01:** a provider-local task can continue polling without a visible challenge after the 45 s dispatch wait. D-154 gives an observed task the existing fixed 120 s solve budget and records request/response counts at expiry; live acceptance still must be proved.

- **Founder observation, 2026-10-01 UTC:** a watched run became stuck at LinkedIn connection. The base form-agent prompt now explicitly skips social sign-in and profile imports, uses the ordinary form and approved résumé upload, and retains the saved LinkedIn URL field (D-148). The exact cause and a live run after this change are not yet verified.

- **Verified regression, 2026-09-30:** the SDK can request a check image before the visible frame opens Live View. Only the active unsent submit admits images from the reviewed provider origin; challenge-answer POSTs still require the bounded candidate window. A live embedded browser renders, but human completion and employer acceptance remain unproven (D-145).

- 2026-09-30: A visible check after the final click opens the exact guarded tab inside RoleDawn for the candidate, up to five minutes; no model challenge tools run, and exact final readback still gates submission (D-144; synthetic completion/drift/expiry/cancel coverage).

- The static `/thanks` page and employer success-page redirects (above).
- Live forms load hCaptcha from `secure-api.js`; RoleDawn's guard blocked it until D-104, so no submit could have scored.
- Parser side effects after upload (above).
- Lever's form contract (method, encoding, action) must be checked before use; drift stops delivery.

## RoleDawn status and gaps

- **Fills-only** (see [README](README.md)). Release `lever-hosted-global/2026-09-16` in `resolveLeverDeliveryPolicy` (`src/server/workers/application-delivery-browser.ts`); `application-delivery-driver.ts` demands provenance for every non-file Lever value; card labels (`leverLabels`) and passive hCaptcha handling live in `agents-browser-tools.ts` and `agents-captcha.ts`.
- **Verified:** the adapter fills, uploads and includes a one-use multipart submit, exercised only against synthetic fixtures (`application-delivery-lever.test.ts`). Autopilot accepts `jobs.lever.co` destinations, so a live send **would submit**.
- **Verified:** no live Lever submission or receipt exists. The 2026-09-16 read-only probe (Aledade, 28 fields) stopped at CAPTCHA takeover with zero non-GET requests, before the D-104 loader fix.
- Gaps: no live proof; EU host and custom domains excluded; a visible hCaptcha goes to the session's solver and hands over only if still unsolved after 120 s (D-146); custom success-page redirects are not recognized as receipts; `liveEmployerAccepted: false` (correctly) in the capability registry.

## Agent guidance

Do:
- Use only `https://jobs.lever.co/<site>/<uuid>/apply`; verify form method, encoding and action first.
- Skip **Apply with LinkedIn** and account-connection/profile-import widgets; fill `urls[LinkedIn]` only from the approved profile URL.
- Fill approved facts before the résumé upload; re-verify every value afterwards.
- Treat any parser-filled value as unapproved until it matches a fact or a candidate answer.
- Upload exactly one approved résumé artifact; confirm the displayed name and success marker.
- Interact with hCaptcha as the agent; the server and the session's solver handle it (D-146).

Don't:
- Resubmit to get a better score, or count a solved challenge as a receipt.
- Treat `/thanks`, a LinkedIn import or an email as proof.
- Use the Postings API `POST` (it needs the employer's key).
- Fill EEO, disability or pronoun fields without a saved voluntary answer (D-091).
- Retry after a repeat-application block; reconcile instead.

## Sources

- https://github.com/lever/postings-api — Postings API: GETs, EU host, key-protected apply, 429 above 2/s, `silent` (Primary), accessed 2026-09-30
- https://jobs.lever.co/outreach/9fbc3919-b949-4978-b3fe-3b69d4e91767 — "Apply for this job" → `/apply` (Direct observation), accessed 2026-09-30
- https://jobs.lever.co/leverdemo/681fbc53-1e34-4a46-8677-3a78118674eb/apply — demo form: 100 MB limit, EEO with CC-305, diversity survey, AI notice (Direct observation), accessed 2026-09-30
- https://help.lever.co/hc/en-us/articles/20087243347741 — form fields, hCaptcha on location dropdown (Snippet only; help center returned 401/403), accessed 2026-09-30
- https://help.lever.co/hc/en-us/articles/20087269688733-Winter-2023-Release — 99.9% claim (Vendor claim, snippet only), accessed 2026-09-30
- https://help.lever.co/hc/en-us/articles/20087458260893-Blocking-repeat-applications, /20087340764701, /20087307202333, /20087313893021 — repeat blocking, EEO, success URL, LinkedIn (Snippet only), accessed 2026-09-30
- [ATS delivery expansion acceptance](../execution/ats-delivery-expansion-acceptance.md); [source register](../research/source-register.md) ATS-D01 to ATS-D04; [decision log](../execution/decision-log.md) D-086, D-104; `tmp/form-audit/` (5 live forms, 2026-09-28, not committed)

- 2026-09-30 (D-136): the hosted Linux browser loads a full-page, `visibility:hidden` hCaptcha enclave at the exact reviewed `newassets.hcaptcha.com/captcha/v1/<revision>/static/hcaptcha-enclave.html` path. Treat that hidden bootstrap as passive; a visible enclave, widget, prompt or unreviewed origin/path still stops. No challenge interaction is admitted.

- 2026-09-30 (D-138): the public résumé parser tracks native change/paste events. Complete approved text edits with blur before upload; otherwise the last focused field can be overwritten. Real public-client replay with a mocked parser response preserves exact values after the correction; this is field-mechanics proof, not employer acceptance.

- 2026-09-30 (D-139): the upload button uppercases its displayed filename through CSS. Check its exact DOM text, while retaining visible-marker, response, byte and final readback requirements. A real synthetic PDF parsed successfully but old innerText comparison falsely stopped; a different underlying filename remains rejected.

- 2026-09-30 (D-140): optional native `org`/Current company and `location`/Current location fields can be populated by parsing. After approved uploads, omit unverified values only when the exact slot was initially empty; preserve initial values, approved writes and required questions. Reintroduced values fail final readback.

- 2026-10-01 (D-149): a required native `location`/`location-input` slot labeled Current location was left for résumé parsing, then stopped when a saved answer differed from that unapproved value. The reviewed Lever observer now gives only this exact native slot city semantics, so the approved city is filled and blurred before upload. A fixture verifies one submit with that city and zero submits without an approved city; live acceptance is still pending.
- 2026-10-01 (D-150): the same city input clears unselected text on blur. Its client queries `/searchLocations?text=...` on keydown and sets `selectedLocation` only when a menu result is selected. Type the approved city, choose a result confirmed by approved region/country, and verify both values before upload and submit. A country-only result cannot displace a matching regional city. See LV-20261001-02; employer acceptance remains pending.
- 2026-10-01 (D-151): résumé parsing protects edited visible inputs but always overwrites hidden `selectedLocation`, even after a native city selection. After an acknowledged upload, restore only the worker's own initially-empty city through the approved lookup and menu, then verify all writes. Never repair metadata during final submission. See LV-20261001-03; live acceptance remains pending.
- 2026-10-01 (D-152): a real Browserbase session attempted a CORS preflight from the employer page to `http://127.0.0.1:8080/solve/hcaptcha/create`; RoleDawn blocked it, preventing the built-in solver from starting. Admit only that exact provider-local endpoint, employer origin and bounded JSON request while the observed hCaptcha is active and no submission is consumed. Other loopback ports, paths, methods and query strings remain blocked. Allow the vendor's documented solve latency before declaring no final request.
- 2026-10-01 (D-153): after creation succeeds, Browserbase polls `/solve/hcaptcha/query` with exactly `query.taskIdEuler`, `solveId`, `tabId` and `solveAttempts`. Admit only the observed types, bounded attempts and same provider origin, including while an approved upload is active. Candidate fields and other endpoints remain blocked; employer acceptance is still pending.
