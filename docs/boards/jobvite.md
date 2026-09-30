---
board: jobvite
status: unsupported
difficulty: medium
last_verified: 2026-09-30
url_patterns:
  - jobs.jobvite.com/<company>/jobs
  - jobs.jobvite.com/<company>/job/<jobId>
  - jobs.jobvite.com/<company>/job/<jobId>/apply
  - app.jobvite.com/j?cj=<jobId>
  - app.jobvite.com/CompanyJobs/Careers.aspx?c=<companyId>&j=<jobId>[&k=Job|Apply]
  - jobs.jobvite.com/careers/service/redirect?c=<companyId>&k=Job&j=<jobId>
  - app.jobvite.com/CompanyJobs/Xml.aspx?c=<companyId>
---

# Jobvite

The thinnest template: the apply form after the consent gate renders client-side and was not observed. Difficulty `medium` is provisional.

## Recognize it

- Hosted career sites (Primary): `jobs.jobvite.com/<company-name>`; employers can instead iframe the listings on their own domain or build listings from the API. Every option sends candidates to the Jobvite-hosted apply page.
- Observed paths (Direct observation by research agent, Nutanix): list `/jobs`, job `/job/<jobId>` (8-character ids), **Apply** → `/job/<jobId>/apply`, job alerts `/jobAlerts`; a "Powered by Jobvite" footer and a "Check Your Application" link to `app.jobvite.com`.
- Legacy short links redirect: `app.jobvite.com/j?cj=<jobId>` → `app.jobvite.com/CompanyJobs/Careers.aspx?...&k=Job&j=<jobId>` → `jobs.jobvite.com/careers/service/redirect?c=<companyId>&k=Job&j=<jobId>` → the job page. A `k=Apply` variant exists.
- An unknown company slug redirects to `search.jobvite.com/?invalid=1` and then the job-seeker support page.
- Employers often front Jobvite with a branded careers domain; identify the board by the apply host.
- Job Feed API (Primary): a paid add-on with a key and secret, limited to 500 calls per day, with caching recommended; applications must still use the Jobvite apply page. `api.jobvite.com/api/v2/job` returned 401 without credentials.
- A public XML feed `app.jobvite.com/CompanyJobs/Xml.aspx?c=<companyId>` returned jobs with `apply-url` and `detail-url` (Direct observation by research agent); whether it is documented is an **Open question**.
- **Vendor claim:** Employ, Inc. lists Jobvite, Lever and JazzHR among its brands. Lever and Jobvite forms are still separate products (**Inference**).

## Application flow

1. Job page → **Apply** → `/job/<jobId>/apply`.
2. **Data Consent** gate: choose location of residence and language, then **Accept** or **Decline**; Decline goes to an employer-set URL (Direct observation by research agent).
3. Later steps render client-side and were not observed (**Open question**); the flow has at least two steps (**Inference**).

## Accounts and sign-in

- Jobvite tells job seekers it is not a job board and to apply on the employer's site (Primary).
- `app.jobvite.com` offers username/password or SSO for customers, and a job-seeker sign-in with Google or LinkedIn (Direct observation by research agent). Whether applying requires an account: **Open question**.
- LinkedIn Apply Connect is offered (Vendor claim); Indeed, SEEK and Xing: **Unverified**.

## Documents and parsing

- File types, size limits and résumé parsing: **Unverified**.
- **Recommendation:** observe the form read-only (after a candidate-approved consent decision) before any adapter work.

## Questions and widgets

- Job pages show an EEO statement and employer privacy links (Direct observation by research agent).
- The job-alert form requires first name, last name, email and job categories; it is a marketing sign-up, not an application.
- Screening questions, self-ID and widgets: **Unverified**.

## Verification and anti-bot

- The `app.jobvite.com` sign-in page shows a "verify that you are not a robot" check; provider unknown (Direct observation by research agent).
- A CAPTCHA on the apply form: **Open question**.
- Jobvite also runs text-to-apply and career-site chatbots (Vendor claim); SMS terms cover job invites with STOP and HELP keywords (Primary).

## Submission and proof

- Confirmation page, email sender and subject: **Unverified**.
- "Check Your Application" suggests a status lookup after sign-in (**Inference**).
- **Recommendation:** no receipt contract until one real submission is observed.

## Known quirks

- Old `app.jobvite.com` links still redirect through several hops; follow them to `jobs.jobvite.com` before matching.
- Invalid company slugs bounce to support pages.
- The help center is JavaScript-rendered and unreadable to fetch tools.

## RoleDawn status and gaps

- **Unsupported.** Not in `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- The Data Consent gate is a legal consent. RoleDawn has no stored, per-employer consent record to answer it, so today it is a hard stop.
- Missing: an observed form, upload and submit contract, CAPTCHA behavior, and a receipt.
- Discovery: the Job Feed API is paid and per employer; the XML feed is unverified as a sanctioned source.

## Agent guidance

Do:
- Resolve short links and branded pages to `jobs.jobvite.com/<company>/job/<jobId>` before matching.
- Stop at the Data Consent gate and ask the candidate; record their choice as theirs.
- Stop on any robot check.

Don't:
- Click **Accept** on the consent gate without the candidate's explicit decision.
- Use the job-alert form as an application, or the candidate's Google or LinkedIn sign-in.
- Poll the Job Feed API or XML feed at volume.

## Sources

- https://careers.jobvite.com/careersite/integration.html — hosted, iframe and API options; Jobvite-hosted apply (Primary), accessed 2026-09-30
- https://careers.jobvite.com/careersite/job_feed_api.html — paid Job Feed API, key and secret, 500 calls/day, apply page required (Primary), accessed 2026-09-30
- https://jobs.jobvite.com/nutanix/jobs, https://jobs.jobvite.com/nutanix/job/oheGAfwv, https://jobs.jobvite.com/nutanix/job/oheGAfwv/apply — paths, Apply, Data Consent gate (Direct observation by research agent), accessed 2026-09-30
- https://app.jobvite.com/j?cj=oheGAfwv, https://app.jobvite.com/CompanyJobs/Xml.aspx?c=qKr9VfwZ — redirect chain, XML feed (Direct observation by research agent), accessed 2026-09-30
- https://app.jobvite.com/ — sign-in options and robot check (Direct observation by research agent), accessed 2026-09-30
- https://api.jobvite.com/api/v2/job — 401 without credentials (Direct observation by research agent), accessed 2026-09-30
- https://www.jobvite.com/support/job-seeker-support/ — "not a job board" guidance (Primary), accessed 2026-09-30
- https://www.jobvite.com/sms-terms-of-service/ — SMS terms (Primary); https://www.jobvite.com/jobvite-linkedin-apply-connect/ — LinkedIn Apply Connect (Vendor claim), accessed 2026-09-30
- https://www.employinc.com/ — Employ brands (Vendor claim), accessed 2026-09-30
