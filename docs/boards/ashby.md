---
board: ashby
status: fills-only
difficulty: medium
last_verified: 2026-09-30
url_patterns:
  - jobs.ashbyhq.com/<org>
  - jobs.ashbyhq.com/<org>/<job_uuid>
  - jobs.ashbyhq.com/<org>/<job_uuid>/application
  - jobs.ashbyhq.com/<org>/embed
  - <employer careers page>?ashby_jid=<job_uuid>
  - api.ashbyhq.com/posting-api/job-board/<board>?includeCompensation=true
---

# Ashby

Compact agent context: `BOARD_CONTEXT.ashby` in [board-agent-context.ts](../../src/domain/board-agent-context.ts), sent to the form agent on every send (at most 10 bullets and 900 characters). Add lessons by the [README](README.md#how-to-add-a-lesson) rules.

## Recognize it

- Hosted board `jobs.ashbyhq.com/<org>`; postings `.../<job_uuid>`; the form is `.../<job_uuid>/application` (the `applyUrl` shape in Ashby's own feed). Ashby does not support custom domains; employers embed instead (vendor docs).
- Embed script (observed by research agent): `jobs.ashbyhq.com/<org>/embed` renders `iframe#ashby_embed_iframe` in `#ashby_embed`, reads `ashby_jid` and `utm_source`, and posts `application_submitted` / `application_errored` messages to the parent page.
- Page markers (**Verified**, audit of 5 live forms 2026-09-28): client-rendered, **no `<form>` element**; ids such as `_systemfield_name`, `_systemfield_email`, `_systemfield_resume`, `_systemfield_data_consent_ack`; custom questions keyed by UUID; reCAPTCHA from `www.recaptcha.net/recaptcha/api.js?render=<sitekey>` (standard, not Enterprise).
- The page talks to one shared endpoint, `POST https://jobs.ashbyhq.com/api/non-user-graphql?op=<Operation>`; observed reads: `ApiJobPosting`, `ApiOrganizationFromHostedJobsPageName`, `ApiAutocompleteGeoLocation`.
- Public API (**Verified**, vendor docs): `GET https://api.ashbyhq.com/posting-api/job-board/<board>?includeCompensation=true` lists jobs with `jobUrl`, `applyUrl`, `isListed` (`false` = direct link only).
- Employer API (**Verified**, vendor docs): `jobPosting.info` returns `applicationFormDefinition`; `applicationForm.submit` takes `fieldSubmissions` (`{path, value}`) with Basic Auth and `candidatesWrite`; files go through `file.createFileUploadHandle` (upload URL valid 10 minutes). Not available to RoleDawn.

## Application flow

Single page.

1. Posting overview → **Application** view.
2. Optional **Autofill from resume** (an employer board setting).
3. **Resume** upload (required on audited forms).
4. Full name, pronouns, email, phone, current location (typeahead), company, links.
5. Employer questions: Yes/No, short and long text, multiple choice, checkboxes, date, number, URL, file, education history.
6. Optional EEOC survey (gender, race, veteran) and diversity survey; data-consent checkbox.
7. **Submit Application** → employer-configured confirmation message.

## Accounts and sign-in

- No applicant account (**Verified**, audited forms).
- No emailed verification code is documented or observed.
- Application limits can throttle or block repeat applications, matched on the email entered; the candidate sees an employer-written message (vendor docs).

## Documents and parsing

- Two file inputs: an unlabelled **Autofill from resume** input and the **Resume** input.
- Accepted types in the `accept` attribute: pdf, doc, docx, odt, rtf, txt, md; one board's Resume input also accepted image, video and audio.
- Size: résumés up to 50 MB, but autofill and search only work at 16 MB or less (vendor docs).
- Autofill parses the résumé and fills Your Details (vendor docs); parsed values would need the same provenance checks as Lever.
- **Unverified:** cover-letter handling (usually an employer-defined file or text question).

## Questions and widgets

- Yes/No questions render as pressed-button pairs. The Ashby observer reads the parent question and required marker, offers explicit Yes/No values, clicks one observed choice, and reads back `aria-pressed` (2026-09-30).
- Multi-selects render as checkbox groups; single choices as radio groups.
- Location: "Start typing…" typeahead backed by `ApiAutocompleteGeoLocation`. The driver selects one result confirmed by the approved city, region and country. The request guard separately requires that exact server-returned location and provider ID.
- A bare **Location** label gets city semantics only with trusted Ashby adapter metadata, exact `_systemfield_location` name/id and the reviewed text-input single-select shape. Generic location questions remain unclassified (D-129).
- Salary expectations may be split into begin/end fields with format rules (1Password: base and OTE ranges).
- EEOC survey covers gender, race and veteran status; disability is asked, if at all, in an optional diversity survey. Survey answers are anonymous by default and kept out of the application payload (vendor docs).
- Example diversity survey (1Password): gender radios, a 12-option race/ethnicity checkbox group, a veteran radio and several "No / Yes / Prefer not to say" radios.
- A Candidate Data Consent checkbox and an Ashby cookie banner (Necessary, Analytical, Performance, Marketing) can appear; decline non-essential cookies.

## Verification and anti-bot

- Spam protection levels per employer: Strict, Less Permissive, Permissive (default), No Protection (vendor docs).
- The reviewed public form uses standard reCAPTCHA. RoleDawn admits its passive invisible badge and native scoring requests. Any visible challenge stops delivery; it never solves, suppresses or retries a challenge to improve its score.
- The page's own device fingerprint is an opaque, bounded vendor-format field on the final request. It supplies no application authority.
- No account sign-in or employer API key is used.

## Submission and proof

- **Verified public-client protocol:** the common endpoint is `POST /api/non-user-graphql?op=<name>`. Reads, lookups, draft writes, file attachment and final submission each have separately reviewed operation documents and payload checks.
- `ApiSetFormValue` saves an approved field to the employer's draft before final submission. The exact board, form, field and value must match, and the server response must echo the value without changing another field.
- `ApiCreateFileUploadHandle` binds the approved filename, media type and byte length. One exact server-issued S3 upload sends the hashed file; `ApiSetFormValueToFile` may attach its handle only after the upload succeeds. The field must show the approved filename.
- `ApiSubmitSingleApplicationFormAction` handles a form without surveys. `ApiSubmitMultipleFormsAction` binds the application and each survey's server-issued form/action identifiers.
- The final request still needs RoleDawn's sealed, single-use database permission. Its review includes the acknowledged server-side field values and document proofs.
- A receipt requires the response to that admitted request to contain `FormSubmitSuccess` for the application and every expected survey, no GraphQL errors or employer block, and the employer's visible success container. A static page, a model statement, or an HTTP 200 alone is insufficient.
- **Not yet verified:** a live employer-confirmed Ashby application. Fixture acceptance is separate from that proof.

## Known quirks

- Field saves disclose approved data before final submission; a stopped run may have an employer-side draft. Copy must not claim that no data was sent.
- One shared GraphQL URL handles both reads and writes. Never allow it by origin or operation name alone; query documents, variables and the current action must agree.
- The reviewed public client refetches organization metadata with optional `searchContext` omitted, `null` or `JobPosting`, and issues a constant empty City lookup on mount and around uploads. Those exact reads are admitted; empty-search responses never supply candidate location choices. Every nonempty lookup still requires an active approved-city search. Rejections report a static operation/rule code without request values.
- **Verified, 2026-09-30:** a draft-save response rotates the server-issued action identifier while the form, definition and field metadata stay fixed. RoleDawn accepts that rotation only after the approved value echoes exactly and every other value remains unchanged. The final review seals the latest identifier; an older identifier cannot consume submit permission. The observed run stopped before final submission, so this is protocol evidence, not a receipt.
- `aria-selected` on a location option marks keyboard focus, not a saved choice. After one selection click, read-only checks wait at most two seconds for the exact chosen label to render; they never click again. The selected label and acknowledged draft value establish readback (D-129).
- Playwright briefly reports `""` as a newly attached frame's URL. That URL supplies no controls or trust. The current DOM iframe source and eventual frame URL are checked independently against the reviewed CAPTCHA origin, anchor path, observed key and invisible mode; a late approved badge is not a challenge. Visible challenges and unapproved foreign frames still stop final readback before submit permission is consumed (D-127/D-128).
- The form has no native `<form>` element. Ashby labels, field paths and form identifiers supply the control identity.
- **Verified by reproduction, 2026-09-30:** the final submit click disables inputs before its request dispatches. Final readback retains and compares their identity, current values and files; ordinary filling still refuses disabled controls. Two real-client replays exercised the actual pre-dispatch guard, while changed disabled values/labels received no authorization or submission (D-130; published in `b103640`).
- A changed public operation document fails closed until reviewed. Defaults, hidden values and unrecognized widgets can still require candidate facts; passive processing notices are admitted with exact review binding and acknowledgements use saved delegation; support does not promise every employer-specific form.

## RoleDawn status and gaps

- **Delivery implemented; live acceptance unproven.** Hosted `jobs.ashbyhq.com/<org>/<uuid>` and its `/application` route resolve through the shared delivery registry and database predicate.
- The latest live attempt observed an HTTP 200 response and body hash, but the acceptance predicate found no receipt. The released browser and unretained response body prevent retrospective diagnosis. This remains an unknown outcome, not acceptance or rejection; do not resend it (D-131).
- Release `b4ae35b` adds only fixed response-shape categories and capped counts for future diagnostics. It preserves acceptance/retry rules and cannot recover the earlier response; no new live submission was made for this diagnostic release (D-131).
- The same Browserbase session, candidate facts, remembered/standing answers, missing-question UI, immutable files and submit permission used by Greenhouse and Lever are reused.
- The board's square-logo metadata can supply cached company branding; missing or changed metadata falls back to initials. It is not a paid lookup or guessed employer domain.
- Required security-clearance questions, including TS/SCI, go to the candidate. They cannot be inferred from standing answers or unrelated profile facts. D-125 permits deterministic reuse of an explicitly saved answer only for the exact reviewed clearance scope; worker and SQL validate the same owned basis and value, without model inference.
- Residence-worded authorization/sponsorship questions require the structured residence country and its matching country-scoped fact. Standing-answer instructions distinguish residence from job country and cite only the authorization/sponsorship fact as the sensitive basis; no SQL policy was widened (D-129).
- Embedded/custom employer pages are not accepted as delivery destinations. Intake should resolve a concrete hosted application URL first.

## Agent guidance

Do:
- Use the existing named-job send intent and application delivery worker; never make a separate direct submission.
- Check the actual terminal or needs-you state with `ops:status`. Count only an employer-evidenced receipt as Applied.
- On a required question, show the candidate the exact question and retain approved answers across the existing recovery flow.
- Treat drift in GraphQL documents, field identity, uploads or confirmation as a stopped or uncertain outcome under existing rules.

Don't:
- Use Ashby's employer-authenticated APIs or an employer's key.
- Broadly allow GraphQL, arbitrary S3 destinations, resume autofill, surveys or legal notices.
- Solve reCAPTCHA, retry to improve its score, or infer that an application-limit response authorizes another attempt.
- Restore an earlier closed send intent automatically when a new adapter ships. A fresh candidate request is required; uncertain and attempted deliveries keep their own recovery controls.

## Sources

- https://developers.ashbyhq.com/docs/public-job-posting-api — public job-board endpoint, `isListed` (Primary), accessed 2026-09-30
- https://developers.ashbyhq.com/reference/applicationformsubmit, /reference/authentication, /reference/jobpostinginfo, /docs/creating-a-custom-careers-page — employer API, permissions, form definition, upload handles (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/routes-for-integrating-your-ashby-job-board-with-your-careers-page — embed routes, no custom domains (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/job-board-configuring-your-setup, /application-forms, /eeoc-surveys, /diversity-surveys — autofill, field types, 50/16 MB, surveys (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/job-board-application-spam-protection, /application-limits, /candidate-fraud-detection-overview-and-admin-settings — spam levels, repeat limits, fraud signals (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/email-template-creation-and-management, /data-privacy-and-compliance, /job-board-cookie-consent-settings — confirmation email, consent, cookies (Primary), accessed 2026-09-30
- https://jobs.ashbyhq.com/Ashby/embed — embed script (Direct observation by research agent), accessed 2026-09-30
- [ATS delivery expansion acceptance](../execution/ats-delivery-expansion-acceptance.md); [source register](../research/source-register.md) ATS-D05, ATS-D06; [decision log](../execution/decision-log.md) D-086; `tmp/form-audit/` (5 live forms, 2026-09-28, not committed)

- [Hosted form protocol and branding](../research/source-register.md) AB-20260930-01 and AB-20260930-02 — public-client and DOM observation, accessed 2026-09-30; no live employer receipt implied.

- 2026-09-30 (D-136): `automatedProcessingLegalNotice` is a passive notice, including the standard null-HTML notice. Bind its observed rule ID and content hash into review and require the exact rule ID at submit; a notice alone must not stop delivery. Consent controls use the candidate's saved delegation.

- 2026-09-30 (D-137): application `sourceFormDefinitionId` can be the exact JSON `CompositeFormDefinitionId-JobPostingApplicationFormV2`, bound to this job and External board scope. Surveys still use UUIDs. Preserve the opaque string in every autosave and final review.

- 2026-09-30 (D-138): a Location widget can request the exact `Country, Region, City` list, including an empty mount read. Bind nonempty lookups to the observed widget types; only approved-text, server-returned City results can become saved location values.
