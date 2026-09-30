---
board: smartrecruiters
status: unsupported
difficulty: medium
last_verified: 2026-09-30
url_patterns:
  - jobs.smartrecruiters.com/<CompanyIdentifier>/<postingId>-<slug>
  - jobs.smartrecruiters.com/<CompanyIdentifier>/<postingId>-<slug>?oga=true
  - jobs.smartrecruiters.com/oneclick-ui/company/<company>/publication/<uuid>
  - www.smartrecruiters.com/oneclick-ui/company/<id>/job/<id>/publication/<id>
  - careers.smartrecruiters.com/<CompanyIdentifier>
  - jobs.smartrecruiters.com/external-referrals/company/<company>/publication/<uuid>
  - api.smartrecruiters.com/v1/companies/<companyIdentifier>/postings[/<postingId>]
---

# SmartRecruiters

Compact agent context: `BOARD_CONTEXT.smartrecruiters` in [board-agent-context.ts](../../src/domain/board-agent-context.ts). Unverified, and never sent to a live prompt while this board is unsupported. Promotion rules: [README](README.md#how-to-add-a-lesson).

## Recognize it

- Job ads live at `jobs.smartrecruiters.com/<CompanyIdentifier>/<postingId>-<slug>` (Direct observation, Bosch and SmartRecruiters postings). Page title `<Job> | SmartRecruiters`; the apply button reads **I'm interested** (shown twice); share links include LinkedIn and Xing.
- `careers.smartrecruiters.com/<Company>` is either a hosted list ("powered by SmartRecruiters", Equinox) or a 302 to the employer's own site (Bosch → jobs.bosch.com). Identify the board by the apply host, not the landing domain.
- Public Posting API (**Verified**, vendor docs and direct GET):
  - `GET https://api.smartrecruiters.com/v1/companies/<companyIdentifier>/postings` needs no authentication for public postings; `limit` up to 100; filters include `q`, `country`, `city`, `department`, `releasedAfter`.
  - List items carry `id`, `uuid`, `name`, `refNumber`, `company.identifier` but no apply URL.
  - `GET .../postings/<postingId>` adds `postingUrl`, `applyUrl` (= posting URL + `?oga=true`) and `referralUrl`.
- One-click apply URLs vary: `jobs.smartrecruiters.com/oneclick-ui/company/<company>/publication/<uuid>` (returned 403 to a fetch) and `www.smartrecruiters.com/oneclick-ui/company/<id>/job/<id>/publication/<id>` titled "Easy apply" (snippet only).
- **Vendor claim:** SAP completed its acquisition of SmartRecruiters on 2025-09-11; customers may pair it with SAP or other HR systems.

## Application flow

From SAP's SmartRecruiters course (Primary; the SAP SuccessFactors edition, so standalone tenants may differ):

1. **I'm interested** on the job ad.
2. Upload a résumé; parsing prefills the form; review it and add attachments.
3. Screening questions, possibly conditional on job type, location or department.
4. Diversity questions where configured.
5. Privacy policy and consent: one checkbox, or separate ones per purpose.
6. **Submit** → confirmation message and an email linking to the application.

- **Open question:** single page or several steps.

## Accounts and sign-in

- No account or profile is required to apply (Primary).
- After applying, a candidate portal reached from the confirmation email uses a one-time passcode; it shows status and lets the candidate update details, manage attachments or withdraw (Primary).
- The legacy SmartR/SmartProfile appears retired (`smartr.me` redirects to smartrecruiters.com; snippet mentions a shutdown).
- Apply with LinkedIn (Vendor claim, LinkedIn integrations page), Apply with SEEK (2020 trade news), Indeed (marketplace listing, unreadable).

## Documents and parsing

- Résumé parsing prefills the form (Primary).
- Application API files (partner guide): Base64, 2 MB per file, PDF, DOC(X), RTF, JPG, PNG; slots `resume`, `avatar`, `attachments`; free text `messageToHiringManager`.
- **Conflict:** the API reference allows about 10 MiB of Base64 content. **Recommendation:** treat 2 MB as the ceiling.
- Hosted-form limits: **Unverified**.

## Questions and widgets

- Posting configuration (`GET /postings/{uuid}/configuration`, partner API) lists screening questions, diversity questions and privacy policies, to be shown in the returned order.
- Question types: `CHECKBOX`, `RADIO`, `SINGLE_SELECT`, `MULTI_SELECT`, `INPUT_TEXT`, `TEXTAREA` (up to 4 kB), `INFORMATION` (static), currency and `DATE`; questions can repeat or be conditional (Primary).
- Diversity questions sit under a confidential-questionnaire heading. US federal veteran and disability self-ID pages are served from `www.smartrecruiters.com/oneclick-ui/resources/html/ofccpVeterans` and `ofccpDisability` (snippet only).
- Consent is `SINGLE` or split into recruiting, CRM, SMS and WhatsApp keys; omitted split keys default to false. An AI-use disclosure can appear (Primary).

## Verification and anti-bot

- No CAPTCHA provider is named anywhere (**Open question**).
- **Verified (direct GET):** the job ad returned 200, but the `?oga=true` apply URL and the one-click path returned 403 to automated fetches. The mechanism is unknown.
- Customer API limits: 10 requests per second, 8 concurrent, `429` with `X-RateLimit-*` headers (Primary). These apply to API credentials, not the hosted form.
- The portal passcode comes after applying; no pre-submit email code is documented.

## Submission and proof

- On-screen confirmation plus an email with a link to the application (Primary). Page text, sender and subject: **Unverified**.
- The candidate portal shows the application's status (Primary); status values differ between SmartRecruiters' two status APIs.
- **Recommendation:** proof = the submit response observed in the browser plus the confirmation state on the page; the email is a secondary check.

## Known quirks

- Careers landing pages can redirect off-platform while applications still run on `jobs.smartrecruiters.com`.
- Posting list results lack apply URLs; one detail call per posting is needed.
- Apply URLs refuse plain automated fetches (403) even when the job ad loads.

## RoleDawn status and gaps

- **Unsupported.** Not in `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- Discovery: the documented public Posting API is a candidate source after the usual source review ([ingestion matrix](../research/ats-api-ingestion-matrix.md) ranks it priority 1).
- Delivery: the Application API (`POST /postings/{uuid}/candidates`) needs an employer or partner credential with `candidate_applications_manage`; it is not a candidate channel.
- The one-click form has not been observed in a real browser; its widgets, consent layout and receipt are unknown.

## Agent guidance

Do:
- Recognize the board by `jobs.smartrecruiters.com` apply links, even behind a branded careers site.
- Read posting identity (`uuid`, `refNumber`) from the public Posting API, read-only.
- Treat each consent checkbox as the candidate's decision; split consents stay unchecked unless the candidate chose them.
- Stop on any robot check or HTTP 403.

Don't:
- Use the Application API, the candidate portal passcode, or SmartR.
- Fill diversity or OFCCP self-ID pages without saved voluntary answers (D-091).
- Retry an apply URL that returned 403 or a challenge.

## Sources

- https://developers.smartrecruiters.com/docs/customer-overview, /docs/posting-api, /reference/v1listpostings, /docs/endpoints — public Posting API, limits (Primary), accessed 2026-09-30
- https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744000152547069 — `postingUrl`, `applyUrl`, `referralUrl` (Direct observation), accessed 2026-09-30
- https://jobs.smartrecruiters.com/BoschGroup/744000152547069-head-of-autonomous-driving-technology-ai-development — "I'm interested" button (Direct observation), accessed 2026-09-30
- https://careers.smartrecruiters.com/Equinox, https://careers.smartrecruiters.com/BoschGroup — hosted list vs redirect (Direct observation by research agent), accessed 2026-09-30
- https://developers.smartrecruiters.com/docs/application-api, /docs/partners-post-an-application, /reference/createcandidate-1, /docs/rate-limiting — questions, consent, files, limits (Primary), accessed 2026-09-30
- https://learning.sap.com/courses/smartrecruiters-for-sap-successfactors-academy/exploring-the-candidate-experience_fdf1f35a-7ebc-458c-9194-0a1823a8ea98 — candidate flow, no account, portal passcode (Primary), accessed 2026-09-30
- https://news.sap.com/2025/09/sap-completes-smartrecruiters-acquisition/ — acquisition (Vendor claim), accessed 2026-09-30
- https://business.linkedin.com/talent-solutions/linkedin-hiring-integrations/smartrecruiters — LinkedIn apply (Vendor claim); https://hrtechfeed.com/smartrecruiters-adds-apply-with-seek/ — SEEK (Community), accessed 2026-09-30
