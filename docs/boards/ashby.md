---
board: ashby
status: prep-only
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

- Yes/No questions render as `<button>Yes</button>` / `<button>No</button>` pairs, which RoleDawn's observer cannot see (manual annotation of the 2026-09-28 audit).
- Multi-selects render as checkbox groups; single choices as radio groups.
- Location: "Start typing…" typeahead backed by `ApiAutocompleteGeoLocation`.
- Salary expectations may be split into begin/end fields with format rules (1Password: base and OTE ranges).
- EEOC survey covers gender, race and veteran status; disability is asked, if at all, in an optional diversity survey. Survey answers are anonymous by default and kept out of the application payload (vendor docs).
- Example diversity survey (1Password): gender radios, a 12-option race/ethnicity checkbox group, a veteran radio and several "No / Yes / Prefer not to say" radios.
- A Candidate Data Consent checkbox and an Ashby cookie banner (Necessary, Analytical, Performance, Marketing) can appear; decline non-essential cookies.

## Verification and anti-bot

- Spam protection levels per employer: Strict, Less Permissive, Permissive (default), No Protection. Ashby names no CAPTCHA vendor (vendor docs).
- Observed: reCAPTCHA on 5 of 5 audited forms; its invisible anchor (`api2/anchor?size=invisible`) renders as a 256×60 badge, so RoleDawn's generic observer hands over (`APPLICATION_FILL_CAPTCHA_TAKEOVER`).
- **Verified (diagnostic):** with that invisible frame explicitly permitted, the observer read 50 fields on the 1Password form with no takeover. Nothing was submitted.
- Optional fraud detection uses device, IP, email and phone signals and routes flags to manual review (vendor docs).

## Submission and proof

- **Inference:** the hosted form submits through a GraphQL mutation on the shared endpoint; its name and response were not captured.
- The embed script's `application_submitted` message is a candidate receipt signal for embedded boards (**Inference**, unproven).
- Confirmation message text is set by the employer. The confirmation email comes from Ashby's no-reply address only when the employer enables it (vendor docs). Exact sender **Unverified**.
- No Ashby receipt contract exists until a real submission is observed.

## Known quirks

- **Inference:** fields may autosave server-side as they change, so data could reach the employer before **Submit**; an origin-level allow rule would admit more than the final submission (D-086).
- The shared GraphQL endpoint serves reads, lookups and writes; it cannot be allowlisted by URL alone.
- Button-rendered Yes/No controls and the location typeahead escape generic `input/select/textarea` observers.
- Auto-reject rules can act on form answers, with a delayed rejection email (vendor docs).

## RoleDawn status and gaps

- **Prep-only.** `ATS_DELIVERY_CAPABILITIES.ASHBY.status = "PREPARATION_ONLY"`; `parseAutopilotDestination` accepts only Greenhouse and Lever (`src/domain/application-autopilot-eligibility.ts`). RoleDawn imports the posting, writes documents, and the candidate submits ([playbook](../execution/application-playbook.md)).
- Before an adapter: bind named GraphQL operations and payloads (including autosave and upload handles); observe button Yes/No controls and the location lookup; admit only passive reCAPTCHA frames; define the receipt from a real submission.
- Copy gap: `src/app/(candidate)/apply-actions.ts` and `src/domain/application-presentation.ts` tell candidates RoleDawn "applies" on Ashby, which overstates preparation-only support.

## Agent guidance

Do:
- Prepare the documents and answers, then give the candidate the exact `/application` URL and say plainly that they submit on Ashby.
- In any future adapter, allow GraphQL operations by name and bound payload, never by origin.

Don't:
- Open the Ashby form with candidate data or upload files today.
- Call Ashby's authenticated API; it needs the employer's key.
- Solve reCAPTCHA or retry to improve a score; retry after an application-limit block.
- Mark an Ashby application "Applied" from anything RoleDawn did.

## Sources

- https://developers.ashbyhq.com/docs/public-job-posting-api — public job-board endpoint, `isListed` (Primary), accessed 2026-09-30
- https://developers.ashbyhq.com/reference/applicationformsubmit, /reference/authentication, /reference/jobpostinginfo, /docs/creating-a-custom-careers-page — employer API, permissions, form definition, upload handles (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/routes-for-integrating-your-ashby-job-board-with-your-careers-page — embed routes, no custom domains (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/job-board-configuring-your-setup, /application-forms, /eeoc-surveys, /diversity-surveys — autofill, field types, 50/16 MB, surveys (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/job-board-application-spam-protection, /application-limits, /candidate-fraud-detection-overview-and-admin-settings — spam levels, repeat limits, fraud signals (Primary), accessed 2026-09-30
- https://docs.ashbyhq.com/email-template-creation-and-management, /data-privacy-and-compliance, /job-board-cookie-consent-settings — confirmation email, consent, cookies (Primary), accessed 2026-09-30
- https://jobs.ashbyhq.com/Ashby/embed — embed script (Direct observation by research agent), accessed 2026-09-30
- [ATS delivery expansion acceptance](../execution/ats-delivery-expansion-acceptance.md); [source register](../research/source-register.md) ATS-D05, ATS-D06; [decision log](../execution/decision-log.md) D-086; `tmp/form-audit/` (5 live forms, 2026-09-28, not committed)
