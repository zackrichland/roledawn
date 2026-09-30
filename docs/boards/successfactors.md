---
board: successfactors
status: unsupported
difficulty: hard
last_verified: 2026-09-30
url_patterns:
  - <employer careers domain>/job/<City>-<Title>-<Region>/<id>/
  - <employer careers domain>/talentcommunity/apply/<id>/?locale=<locale>
  - <employer careers domain>/go/<Category>/<id>/
  - career<N>.sapsf.com/careers?company=<companyId>
  - career<N>.sapsf.com/career?company=<companyId>&career_ns=job_application&career_job_req_id=<reqId>
  - career<N>.successfactors.com/career?company=<companyId>&career_job_req_id=<reqId>
  - hcm<N>.sapsf.com/sf/careers/jobsearch?bplte_company=<companyId>
---

# SAP SuccessFactors Recruiting

Compact agent context: `BOARD_CONTEXT.successfactors` in [board-agent-context.ts](../../src/domain/board-agent-context.ts). Unverified, and never sent to a live prompt while this board is unsupported. Promotion rules: [README](README.md#how-to-add-a-lesson).

"Direct observation" below is one read-only visit on 2026-09-30 to the University of Toronto's career site (Recruiting Marketing front end, `career17.sapsf.com` back end). Nothing was typed or submitted. Vendor help pages load with JavaScript and were mostly unreadable, so this template leans on employer guides.

## Recognize it

- Front end (Recruiting Marketing / Career Site Builder) on the employer's domain (Direct observation): jobs `/job/<City>-<Title>-<Region>/<id>/`, categories `/go/<Category>/<id>/`, pages `/content/<Page>/?locale=en_US`, talent network `/talentcommunity/subscribe/`.
- Page markers: assets from `rmkcdn.successfactors.com` and `hcm<N>.sapsf.com`; **Apply now »** buttons with classes `apply dialogApplyBtn` linking to `/talentcommunity/apply/<id>/?locale=en_US`.
- **Apply** leads to the back end: `https://career<N>.sapsf.com/careers?company=<companyId>` ("Career Opportunities: Sign In"). Links carry `career_ns=job_application`, `career_job_req_id=<reqId>`, `login_ns=register` or `forgot_pwd`, `jobPipeline=Direct`, `clientId=jobs2web`.
- The URL id (606553517) differs from the requisition id (50343); use `career_job_req_id` as the job identity.
- Older links use `career<N>.successfactors.com/career?company=…&career_job_req_id=…` (not seen live this pass; **Unverified**).
- Internal boards run on `hcm<N>.sapsf.com/sf/careers/jobsearch?bplte_company=…` and may need the employer's network (Employer guide).
- Crawl notes (Community): `/sitemap.xml` is a job list or a Google-jobs RSS feed; search pages use `/search/?startrow=N`; closed postings return HTTP 200 with a `jobErrMsg` element.
- APIs: OData v2 with OAuth needs employer credentials (Community; **Unverified** in SAP docs).
- Not every SAP-branded site runs SuccessFactors: `jobs.sap.com` applies through SmartRecruiters (Direct observation by research agent), which SAP acquired in 2025 (Vendor claim; see [smartrecruiters.md](smartrecruiters.md)).

## Application flow

1. Job page → **Apply now** (browsing needs no login).
2. **Sign In**, or **Create an account** (Direct observation).
3. Accept the data privacy statement (DPCS) before entering data (snippet only; required on the observed Create Account form).
4. Profile and application: My Documents (résumé, cover letter), Profile Information, questions; U of T adds separate CV, cover-letter and "additional materials" fields plus a voluntary diversity survey (Employer guides).
5. **Submit** → the job appears under **Jobs Applied** with a status and a **Withdraw Application** button (Employer guide).

- Single page vs multi-step and exact step order: **Unverified**.

## Accounts and sign-in

- Required per employer: applying needs a SuccessFactors candidate account; browsing does not (Employer guide; Direct observation).
- Create Account fields (Direct observation): `fbclc_userName` (email), `fbclc_emailConf`, `fbclc_pwd`, `fbclc_pwdConf`, `fbclc_fName`, `fbclc_lName`, `fbclc_country`, a profile-visibility radio `fbclc_searPref` (any recruiter vs only recruiters for jobs I apply to), a job-alert checkbox `fbclc_emailEnabled`, and a required **Terms of Use** link to read and accept the data privacy statement.
- Password rules on that tenant: 10–32 characters, upper and lower case, a number or punctuation, no spaces or Unicode.
- Forgot-password emails instructions; passwords change in Settings; profiles can be deleted (Employer guide).
- DPCS 2.0 is country- and language-specific; candidates must re-accept at next login after the employer updates it (Primary, SAP knowledge base previews).
- Email verification codes: none mentioned (Employer guide; absence). Apply with LinkedIn, Indeed, SEEK or Xing: **Unverified**.

## Documents and parsing

- Résumé and cover letter live in My Documents; a different set can be chosen per application (Employer guide).
- U of T allows 10 MB per attachment (Employer guide); other limits and accepted types: **Unverified**.
- Parsing: Textkernel sells an autofill integration (Vendor claim); SAP's built-in parsing: **Unverified**.

## Questions and widgets

- Dates are entered with calendar buttons (Employer guide).
- Diversity surveys are voluntary, each question can be declined, and answers are hidden from hiring committees at U of T (Employer guide).
- Standard `select` for country; radio groups; the data-privacy acceptance is a separate required control.
- US EEO / CC-305, e-signature and questionnaire widgets: **Unverified**.

## Verification and anti-bot

- The Create Account page loads SAP's reCAPTCHA component script (`sfReCaptcha_<hash>.js`) but rendered no widget during the visit (Direct observation). **Inference:** employers can switch a reCAPTCHA on.
- The City of Toronto help mentions no CAPTCHA or email codes (Employer guide; absence).

## Submission and proof

- Jobs Applied lists each application with status (Employer guide).
- Confirmation page text and email: **Unverified**.
- Submission can trigger third-party email: U of T emails the applicant's referees automatically within 48 hours, with reminders after 10 days (Employer guide).

## Known quirks

- Toronto's help says to allow cookies and pop-ups from SuccessFactors; its browser minimums are outdated (Employer guide).
- Internal and external portals differ; the front-end job id is not the requisition id.
- A tenant can show service banners (Toronto showed a document-upload outage notice on 2026-09-30; Direct observation by research agent).

## RoleDawn status and gaps

- **Unsupported.** Not in `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- Current guards stop at **Sign In**: password field → `APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER` (`src/server/workers/agents-browser-tools.ts`).
- Missing: per-employer account creation with a generated password vault (D-031); a DPCS decision recorded as the candidate's own; handling of referee contact details (they trigger emails to third parties); a step policy and receipt contract.

## Agent guidance

Do:
- Key the job by `company` and `career_job_req_id`, not the front-end id.
- Use the candidate's application email; one unique generated password per employer (**Recommendation**; not built).
- Present the DPCS and profile-visibility choice to the candidate; record their decision.
- Tell the candidate before submitting that referees may be emailed automatically.

Don't:
- Accept the data privacy statement, Terms of Use or job alerts on the candidate's behalf.
- Enter referee contacts without the candidate supplying them for this application.
- Reuse a password across employers, or solve any CAPTCHA.

## Sources

- Direct observation (read-only), 2026-09-30: https://jobs.utoronto.ca/job/Toronto-Financial-and-Payroll-Assistant-%28TERM-1-Year%29-ON/606553517/ and the `career17.sapsf.com` Sign In and Create Account pages it links to
- https://jobs.toronto.ca/jobsatcity/content/Help/?locale=en_US — account, documents, Jobs Applied, cookies (Employer guide), accessed 2026-09-30
- https://jobs.utoronto.ca/content/Frequently-Asked-Questions/?locale=en_US — attachments, diversity survey, referee emails (Employer guide), accessed 2026-09-30
- https://userapps.support.sap.com/sap/support/knowledge/en/2341235, /2081574, /2763856 — DPCS versions and re-acceptance (Primary, previews), accessed 2026-09-30
- https://learning.sap.com/courses/sap-successfactors-recruiting-recruiter-experience-administration-es/creating-data-privacy-consent-statement-dpcs- — DPCS before data entry (snippet only), accessed 2026-09-30
- https://raw.githubusercontent.com/sarthakjain004/headstart/main/src/headstart/scrapers/successfactors.py, https://jobspipe.dev/sources/successfactors — sitemap, search paging, OData (Community), accessed 2026-09-30
- https://jobs.sap.com/en/jobs/744000152548459/technical-quality-manager-services-south-korea/ — SAP's own jobs apply via SmartRecruiters (Direct observation by research agent), accessed 2026-09-30
- https://www.textkernel.com/integrations/sap-successfactors/ — parsing integration (Vendor claim), accessed 2026-09-30
