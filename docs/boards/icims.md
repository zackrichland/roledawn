---
board: icims
status: unsupported
difficulty: hard
last_verified: 2026-09-30
url_patterns:
  - careers-<company>.icims.com/jobs/<id>/<slug>/job
  - <prefix>-<company>.icims.com/jobs/<id>/<slug>/job
  - <prefix>-<company>.icims.com/jobs/<id>/<slug>/job?mode=apply&apply=yes
  - <prefix>-<company>.icims.com/jobs/search?ss=1&in_iframe=1
  - <prefix>-<company>.icims.com/jobs/login?loginOnly=1
  - <client>.jibeapply.com
  - api.icims.com/customers/<customerId>/search/portals/<portal>
---

# iCIMS

## Recognize it

- Portal hosts: `careers-<company>.icims.com`, `globalcareers-<company>.icims.com` and other prefixes before `.icims.com` (Community scrapers).
- Paths (Community): job `/jobs/<id>/<slug>/job`; search `/jobs/search?ss=1`; apply `?mode=apply&apply=yes`; login `/jobs/login?loginOnly=1` (UCLA links to it for status checks; Direct observation by research agent).
- Portal content usually sits in an iframe; adding `in_iframe=1` serves it directly on the iCIMS host (Community).
- Front ends: iCIMS sells "Career Sites" (formerly Jibe, acquired 2019) (Vendor claim). These pages load assets from `cms.jibecdn.com` or live at `<client>.jibeapply.com`, and their apply links lead to an iCIMS portal (Direct observation; Community).
- Custom domains such as `jobs.<company>.com` may front iCIMS with an internal JSON endpoint and per-domain CDN rate limits; portal `robots.txt` often disallows everything (Community).
- Job Portal API (**Verified**, vendor docs): for partner vendors only, HTTP Basic credentials per customer, e.g. `GET /customers/{customerId}/search/portals/{portalIdOrName}` and `/portalposts/job/{jobId}`. No public unauthenticated jobs API was found.

## Application flow

Multi-page; steps and labels vary per employer (Primary, iCIMS candidate guide):

1. Job title → **Apply for This Job Online**.
2. **Enter Your Email** decides new or returning.
3. New applicants give name and email and create a login and password, or use social sign-in where offered; a résumé upload can autofill the profile.
4. **Candidate Profile** page → **Update Profile**.
5. Screening questions, job-specific questions, then the EEO step.
6. Confirmation page, sometimes with an optional job-alert signup.

- **Finish Later** pauses; the Dashboard's **Continue Application** resumes.
- UCLA's sequence: email, résumé, profile and password, education and experience, job questions, cover letter, voluntary demographics, the UCLA application, certification, **Submit** (Employer guide).
- **Submit Your Resume** / **Connect with Us** create a profile without applying to any job (Primary).

## Accounts and sign-in

- One account per employer; credentials do not carry across employers (Primary).
- Returning candidates use **Log Back In!** with credentials or a social account (Primary).
- Social sign-in (Facebook, Google, LinkedIn, Microsoft) is optional per employer and fills only first name, last name and email (Primary).
- Password-reset links expire after 8 hours or on a newer request; the email can take up to 5 minutes (Primary).
- Email addresses with accented characters are not supported (Primary).
- No emailed one-time code for candidate portals was found (**Unverified**).
- Indeed apply through the iCIMS Apply Network and LinkedIn Apply Connect exist (Vendor claims).

## Documents and parsing

- Upload from computer, Google Drive, Dropbox or OneDrive; parsing autofills fields, best when the résumé is uploaded first (Primary).
- File types are broad in the API docs and vary by client; UCLA asks for Word or PDF; Guelph wants résumé and cover letter as one file (Employer guides).
- Size limits: **Unverified**.

## Questions and widgets

- EEO step: gender, race, disability and veteran status, each with an opt-out (snippet only); UCLA allows multiple race selections and hides answers from hiring managers.
- Repeating education and experience entries with add/delete (Employer guide).
- E-signature at UCLA: initials, typed name and an **I ACCEPT Signature** checkbox (Employer guide).
- Screening questions and iForms are set per requisition, sometimes on separate portals per job type (snippet only).
- **Use My Location** asks for browser location permission (Primary).

## Verification and anti-bot

- **Primary (June 2025 release notes):** hCaptcha replaced reCAPTCHA on the Referral, Login, Password Reset, Basic Profile and Profile pages. Only suspicious sessions get a challenge, at most once per login or profile-creation session. An accessibility challenge or cookie is the alternative; employers can allowlist bot traffic by public IP through a helpdesk ticket.
- Per-domain CDN rate limiting (Community).

## Submission and proof

- A confirmation page appears (Primary); Guelph quotes "Your application was submitted successfully" and says two emails follow (Employer guide).
- The Dashboard shows status, **Withdraw**, **Continue Application**, email subscriptions and data requests (Primary). Status labels are employer-set.
- After the application, screening and EEO steps, iCIMS can hand the candidate to an assessment or WOTC (tax-credit) partner site and back via `returnUrl` (Primary).
- Emails reportedly come from `hire.icims.com` (snippet only).

## Known quirks

- UCLA advises no Back button, waiting after **Submit**, and using a computer; iCIMS says phones and tablets work (Employer guide vs Primary).
- Unsubscribing from mass email also blocks interview notices (Primary).
- A **Finish Later** draft and a profile-only submission are not applications.

## RoleDawn status and gaps

- **Unsupported.** Not in `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- Current guards stop early: an iframe from another origin → `AGENTS_FILL_CROSS_ORIGIN_FRAME_TAKEOVER`; a `/login` path or password field → `APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER` (`src/server/workers/agents-browser-tools.ts`).
- Missing: per-employer account creation with a generated password vault (not built; D-031); multi-page step policy; partner-redirect handling; a receipt contract (confirmation page plus Dashboard status).
- The partner route (Job Portal API, Apply Network) needs iCIMS partner approval ([ingestion matrix](../research/ats-api-ingestion-matrix.md)).

## Agent guidance

Do:
- Open the portal on its own `*.icims.com` host (`in_iframe=1`) instead of driving it inside an employer iframe.
- Use the candidate's application email; one unique generated password per employer portal, stored encrypted (**Recommendation**; not built).
- Upload the approved résumé first, then check every parsed value against approved facts.
- Count an application only with the confirmation page plus a Dashboard status.

Don't:
- Solve hCaptcha or ask the employer to allowlist RoleDawn's IPs on the candidate's behalf.
- Sign the certification or e-signature, or answer EEO or WOTC questions, without candidate authority and saved answers.
- Use social sign-in, or unsubscribe the candidate from employer email.
- Continue into a third-party assessment or WOTC site; stop and hand over.

## Sources

- https://community.icims.com/articles/HowTo/Candidate-Guide-to-the-iCIMS-Talent-Platform — flow, accounts, uploads, dashboard (Primary), accessed 2026-09-30
- https://community.icims.com/articles/HowTo/Changing-Your-Password-Candidates-New-Hires — per-employer credentials, reset expiry (Primary), accessed 2026-09-30
- https://community.icims.com/articles/Knowledge/2025-06-June-Release-Notes — hCaptcha rollout (Primary), accessed 2026-09-30
- https://developer-community.icims.com/applications/applicant-tracking/job-portal — Job Portal API, Basic auth, partners (Primary), accessed 2026-09-30
- https://developer-community.icims.com/applications/applicant-tracking/binary-files, /application-complete-notification — file types, post-apply partner redirect (Primary), accessed 2026-09-30
- https://chr.ucla.edu/career-opportunities/how-to-apply, https://guelph.ca/employment-careers/careers-jobs/online-application-instructions/ — employer walkthroughs (Employer guide), accessed 2026-09-30
- https://jobs.ucla.edu/ — Jibe CDN front end, iCIMS login link (Direct observation by research agent), accessed 2026-09-30
- https://apify.com/automation-lab/icims-jobs-scraper, https://github.com/DKarap/web-driver/issues/32, https://jobspipe.dev/sources/icims — URL patterns, `in_iframe`, rate limits (Community), accessed 2026-09-30
- https://www.icims.com/company/newsroom/icims-acquires-jibe-to-provide-employers-best-in-class-candidate-engagement-and-recruitment-marketing-capabilities/, https://www.icims.com/blog/stay-in-control-of-your-hiring-icims-winter-2025-release/ — Jibe, Apply Network (Vendor claim), accessed 2026-09-30
- https://community.icims.com/articles/Knowledge/Recruiting-Workflow-Searches-EEO-Reports — EEO opt-out (snippet only; page returned 401), accessed 2026-09-30
