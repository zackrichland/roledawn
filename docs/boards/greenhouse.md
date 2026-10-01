---
board: greenhouse
status: supported
difficulty: medium
last_verified: 2026-09-30
url_patterns:
  - job-boards.greenhouse.io/<board>/jobs/<job_id>
  - boards.greenhouse.io/<board>/jobs/<job_id>
  - job-boards.eu.greenhouse.io/<board>/jobs/<job_id>
  - boards.eu.greenhouse.io/<board>/jobs/<job_id>
  - job-boards.greenhouse.io/embed/job_app?for=<board>&token=<job_id>
  - job-boards.greenhouse.io/embed/job_board?for=<board>
  - boards.greenhouse.io/embed/job_board/js?for=<board>
  - <employer careers page>?gh_jid=<job_id>
  - boards-api.greenhouse.io/v1/boards/<board>/jobs[/<job_id>]
---

# Greenhouse

Compact agent context: `BOARD_CONTEXT.greenhouse` in [board-agent-context.ts](../../src/domain/board-agent-context.ts), sent to the form agent on every send (at most 10 bullets and 900 characters). Add lessons by the [README](README.md#how-to-add-a-lesson) rules.

## Recognize it

- Hosted boards: `job-boards.greenhouse.io/<board>` (current) and `boards.greenhouse.io/<board>` (legacy; one board observed to 301 to the new host), plus EU twins. RoleDawn parses all four hosts (`src/server/ingestion/job-reference.ts`).
- The API's `absolute_url` often points at the employer's own site with `?gh_jid=<id>`, and the hosted page can 302 there: 5 of 73 probed boards did (Carvana, Airbnb, Databricks, Datadog, Zipline) (D-102).
- Embeds (**Verified**, fetched script): `boards.greenhouse.io/embed/job_board/js?for=<board>` puts `iframe#grnhse_iframe` in `div#grnhse_app`, reads `gh_jid` and `gh_src` from the page URL, and loads `job-boards.greenhouse.io/embed/job_board` or `/embed/job_app`.
- Page markers (**Verified**, audit of 11 live forms, 2026-09-28): `form#application-form`; `#first_name`, `#last_name`, `#email`, `#country` (phone country), `#phone`, `#candidate-location`, `#resume`, `#cover_letter`; custom `question_<id>` and `question_<id>[]`; education `school--0`, `degree--0`; EEOC controls with numeric ids; React Select shells `.select-shell .select__control`; `www.recaptcha.net/recaptcha/enterprise.js?render=<sitekey>`.
- Public API (**Verified**, vendor docs): `GET boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true`; `GET .../jobs/<id>?questions=true&pay_transparency=true` returns `questions`, `location_questions`, `compliance` (EEOC, when enabled), `demographic_questions` (Greenhouse Inclusion) and `data_compliance` (GDPR).
- The application `POST` to that API needs the employer's Job Board API key and must be proxied by the employer's server. RoleDawn has no key and must not use it.
- **Open question:** EU API host. `boards-api.eu.greenhouse.io` did not resolve when checked; RoleDawn's endpoints are US-only.

## Application flow

Single page; the form sits under the posting.

1. Posting page; **Apply** scrolls to or opens the form.
2. Name, email, phone country + phone, location (city), résumé, optional cover letter.
3. Employer questions (`question_<id>`); optional education ("Add another").
4. GDPR consent checkboxes when the employer relies on consent.
5. Voluntary self-identification on jobs with EEOC enabled (gender, Hispanic/Latino, race, veteran, disability).
6. **Submit application** → confirmation, or an emailed security-code step.

## Accounts and sign-in

- No applicant account is needed (**Verified**: every RoleDawn live run applied without sign-in).
- MyGreenhouse is an optional candidate account with passwordless, emailed-code sign-in; its Quick Apply autofills forms when the employer enables it (vendor docs). RoleDawn never uses it.
- The security code goes to the email typed into the form, so it must be the candidate's application email.

## Documents and parsing

- Résumé and cover letter offer **Attach**, **Enter manually** (paste text), and on many boards **Dropbox** and **Google Drive** (on by default; employers can turn them off).
- Upload types: pdf, doc, docx, txt, rtf. Size limits conflict across vendor articles: 100 MB for candidate uploads, 500 MB for custom attachment questions. Parsing fails above 2.5 MB or on columns, tables and images.
- Upload protocol (**Verified**, `application-delivery-browser.ts`): GET presigned fields from `boards.greenhouse.io/uncacheable_attributes/presigned_fields?fields[]=resume&fields[]=cover_letter`, then multipart POST to a geo-routed S3 bucket (`grnhse-prod-jben-us-east-1` or `-us-west-2`); keys start `stash/applications/`.
- The page shows the uploaded name (sometimes shortened with an ellipsis) in `.file-upload__filename`.
- No résumé-to-field autofill was observed on the embed form (MyGreenhouse Quick Apply aside).

## Questions and widgets

- API field types: `input_text`, `textarea`, `input_file`, `input_hidden`, `multi_value_single_select`, `multi_value_multi_select`. One question can offer two fields (Resume: file or text).
- EEOC compliance blocks are sectioned in current payloads (D-095). Inclusion demographic questions can be multi-selects, and an option may allow free text.
- Single selects render as React Select comboboxes (`aria-haspopup="true"`, `.select__single-value`); multi-selects as React Select multi (`.select__multi-value`) or checkbox groups `question_<id>[]`.
- Phone: intl-tel-input with a 244-option country list; it reformats the number (`+1 555-010-0199`).
- **Location (City)**: typeahead with a remote lookup plus **Locate me**; the API adds hidden latitude/longitude fields.
- Education: school, degree, discipline, start and end month/year, each required, optional or hidden per employer.
- Labels are often doubled ("Email Email*") (D-103). Some employers make EEOC answers required and add questions (DoorDash: transgender identity; gender as a multi-select).

## Verification and anti-bot

- **Primary (vendor docs):** hosted and embedded forms use invisible reCAPTCHA. Each employer sets a spam-sensitivity level; a low-scoring session may have to verify its email before the application is accepted.
- **Verified (live):** from Browserbase the final POST returns **HTTP 428** with JSON `code: "captcha-failed"` and `security_code_recipient`; the page shows `fieldset#email-verification` with boxes `#security-input-0` … `#security-input-7`.
- The email: subject "Security code for your application to <Company>" (Community reports; RoleDawn's parser matched a real one on 2026-09-30); sender `no-reply@us.greenhouse-mail.io` (Community); 8 characters, sometimes letters only.
- Fraud Detection (Plus/Pro plans) shows recruiters risk flags, including data-center IPs; employer blocklists auto-reject listed emails, domains or IPs.
- During a 73-board read-only probe, Greenhouse began answering HTTP 403 to the probing IP (D-102).

## Submission and proof

- Final request: `POST https://boards.greenhouse.io/embed/<board>/jobs/<job_id>` with a JSON body carrying `g-recaptcha-enterprise-token`.
- Proof = this attempt's observed response (2xx, or 302/303 to the receipt URL) **and** `job-boards.greenhouse.io/embed/job_app/confirmation?for=<board>&token=<job_id>` showing `.confirmation__content`.
- After a 428, the resend must equal the first body except `security_code` (and the dropped token); at most three resends with a code.
- Only another explicit 428 `captcha-failed` with a recipient proves a resend was refused. Unknown 4xx/5xx responses remain uncertain and must not trigger another send (D-120; verified with local fixtures, not deployed).
- A fresh GET of the confirmation URL is never proof.
- Confirmation emails are optional per employer (template "Thank you for applying"); senders include `no-reply@greenhouse.io` and `no-reply@us.greenhouse-mail.io`, or the employer's own domain.

## Known quirks

- **Verified 2026-09-30:** native narrative inputs may cap text at 255 UTF-16 units; the reader exposes `maxLength`, rejects an oversized draft before writing and lets the agent compose a complete shorter answer (D-143; native-browser regression).

- Redirecting hosted pages still serve the same form at the embed URL (D-102).
- Opening React Select menus is slow: about 22 s per full inspection before caching, 2.1 s cached (D-104).
- Phone readback differs in format from saved E.164; compare digits. Upload bucket follows the browser's region (D-104).
- An unmet code means **not accepted**, not "unknown" (D-111).
- Carvana repeats the same nine questions; remembered answers cover them (D-112), and standing answers cover new wordings (D-117).
- The Job Board API does not check required fields; the client must (vendor docs).

## RoleDawn status and gaps

- **Supported (US).** Release `greenhouse-embed-us/2026-09-28` in `resolveGreenhouseDeliveryPolicy` (`src/server/workers/application-delivery-browser.ts`); driver `application-delivery-driver.ts`; widgets `agents-browser-tools.ts`, `agents-aria-combobox.ts`; codes `src/server/mailbox/google-mailbox.ts`.
- **Verified 2026-09-30:** three confirmed applications across two employers ([current state](../execution/current-state.md)). The two Carvana applications (Specialist, Inventory Quality; Strategy Analyst) read their codes from Gmail 7 s and 6 s after they were requested ([playbook](../execution/application-playbook.md)).
- Gaps:
  - `multi_value_multi_select`: **Verified** live on 2026-09-30 (Carvana Strategy Analyst, GPA ranges). React Select marks options `aria-selected="false"` on Linux (the hosted browser) and omits it on Apple platforms. Test with a Linux user agent and platform (D-113 follow-up). Values come from candidate, remembered or standing answers (D-117).
  - **Location (City)** (D-118): filled from the candidate's city fact through Greenhouse's geocoding proxy (`api-geocode-earth-proxy.greenhouse.io/v1/autocomplete`, parameters pinned), confirmed by their region and country. School/degree typeaheads are still unsupported.
  - EU hosts and employer custom domains are not delivery destinations.
  - The code step needs connected Gmail or a typed code within about 8 minutes.
  - `ATS_DELIVERY_CAPABILITIES.GREENHOUSE.liveEmployerAccepted` is still `false` (`src/domain/application-autopilot-eligibility.ts`).
  - **Open question:** Greenhouse frames the code as a spam check for low-scoring sessions; D-106 accepted reading it from the candidate's Gmail and flagged volume as an abuse risk. Recruiters may also see data-center-IP fraud flags.

## Agent guidance

Do:
- Drive only the embed URL built from board token and job id.
- Fill identity fields from approved facts; upload the exact approved file; read every field back.
- Use the candidate's application email; on 428 `captcha-failed`, wait for the code (Gmail or candidate), type it into the eight boxes and let the page resend the identical application.
- Fill multi-selects only from candidate, remembered or standing answers and confirm the chips match exactly (D-113, D-117). Fill the location typeahead only from the city fact, confirmed by region and country (D-118).

Don't:
- "Score-shop" reCAPTCHA or request a new token to retry; a solved CAPTCHA is not a receipt (D-146).
- Use MyGreenhouse, the API `POST`, or Dropbox/Drive pickers.
- Guess EEOC or demographic answers; fill only saved voluntary answers whose wording matches (D-091).
- Treat the confirmation URL, a model judgment or an email alone as proof; probe many boards in a burst; resend after an unknown outcome.

## Sources

- https://docs.greenhouse.io/job-board.html — Job Board API (301 from developers.greenhouse.io) (Primary), accessed 2026-09-30
- https://support.greenhouse.io/hc/en-us/articles/13446638483355-Create-a-job-board-API-key-for-an-integration — employer-created POST key (Primary), accessed 2026-09-30
- https://support.greenhouse.io/hc/en-us/articles/115005448066 — invisible reCAPTCHA and email verification (Primary), accessed 2026-09-30
- https://support.greenhouse.io/hc/en-us/articles/360052218132, /360025222851, /200989175 — upload types, 100 MB vs 500 MB, 2.5 MB parse limit (Primary), accessed 2026-09-30
- https://support.greenhouse.io/hc/en-us/articles/360030839892, /360031720371, /360042142612 — education, EEOC, GDPR consent (Primary), accessed 2026-09-30
- https://support.greenhouse.io/hc/en-us/articles/42738009117467, /45397259312027 — fraud detection and blocklists (Primary), accessed 2026-09-30
- https://support.greenhouse.io/hc/en-us/articles/28688386131739, /43418495049499 — MyGreenhouse optional, emailed-code sign-in (Primary), accessed 2026-09-30
- https://support.greenhouse.io/hc/en-us/articles/115004681926, /17675865619099 — optional confirmation emails, no-reply senders (Primary), accessed 2026-09-30
- https://github.com/yash10019coder/JOB-BORG/issues/79, https://github.com/CryptoJones/OSApplyTrack/pull/170 — security-code email sender and subject (Community), accessed 2026-09-30
- https://boards.greenhouse.io/embed/job_board/js?for=carvana — embed script (Direct observation), accessed 2026-09-30
- [Application playbook](../execution/application-playbook.md); [decision log](../execution/decision-log.md) D-095, D-102 to D-113; `tmp/form-audit/` (read-only audit, 2026-09-28, not committed) — RoleDawn evidence

- 2026-09-30 (D-142): a narrative prompt can use a native single-line text input. Format paragraph breaks into spaces before evidence validation, then fill and seal that exact text. Textareas retain paragraphs; no readback comparison is relaxed.
