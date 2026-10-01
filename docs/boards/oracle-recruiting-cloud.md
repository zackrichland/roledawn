---
board: oracle-recruiting-cloud
status: unsupported
difficulty: hard
last_verified: 2026-09-30
url_patterns:
  - <pod>.fa.<dc>.oraclecloud.com/hcmUI/CandidateExperience/<lang>/sites/<siteNumber>/job/<requisitionId>
  - <career-site-domain>/hcmUI/CandidateExperience/...
  - <pod>.fa.<dc>.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=<site>
  - <company>.taleo.net/careersection/<cs_no>/jobdetail.ftl?job=<id>&lang=<lang>
  - <company>.taleo.net/careersection/<cs_no>/jobapply.ftl?job=<id>
  - <shard>.tbe.taleo.net/<instance>/ats/careers/v2/viewRequisition?org=<ORG>&cws=<n>&rid=<id>
---

# Oracle Recruiting Cloud and Taleo

Compact agent context: `BOARD_CONTEXT["oracle-recruiting-cloud"]` in [board-agent-context.ts](../../src/domain/board-agent-context.ts). Unverified, and never sent to a live prompt while this board is unsupported. Promotion rules: [README](README.md#how-to-add-a-lesson).

Two Oracle products with different flows. **ORC** = Oracle Recruiting Cloud (Fusion HCM "Candidate Experience"): no password, emailed or texted codes. **Taleo** = legacy Taleo Enterprise career sections (username and password) and Taleo Business Edition (TBE). Detect which one before anything else.

## Recognize it

- ORC: career sites live under `/hcmUI/CandidateExperience` on `*.fa.<dc>.oraclecloud.com` or a custom domain (Primary); jobs at `.../<lang>/sites/<siteNumber>/job/<requisitionId>`, with site numbers such as `CX` or `CX_1` (Community; snippet).
- ORC jobs JSON: `recruitingCEJobRequisitions` with finder `findReqs` (`siteNumber`, `keyword`, `location`, `limit`, `offset`…) is documented but labelled "for Oracle internal use only" (Primary). One unauthenticated GET returned 200 JSON (Direct observation by research agent). ORC can also publish a job sitemap (Primary).
- Taleo Enterprise: `https://<domain>/careersection/<cs_no>/<page>.ftl` with `jobsearch`, `jobdetail`, `jobapply`, `moresearch`; parameters `lang`, `job`, `src` (source or event id, case-sensitive) (Primary). Separate mobile career sections exist.
- TBE: `<shard>.tbe.taleo.net/<instance>/ats/careers/v2/viewRequisition?org=…&cws=…&rid=…`; RSS at `/ats/servlet/Rss`; list paging depends on the first request's session cookie (Community).
- APIs: Taleo Web Services and TBE REST are organization-specific integrations with customer credentials (Primary; Community). No public cross-employer feed. Taleo Enterprise docs list release 25B as current (Primary); Oracle's stance on Taleo versus ORC is **Unverified**.

## Application flow

ORC (Primary):
1. **Apply** → enter email or phone; accept the employer's legal disclaimer if configured; optional marketing opt-in.
2. Returning candidates enter a 6-digit code first and get a prefilled flow; new candidates go straight in.
3. Import from LinkedIn or Indeed, upload a résumé, or type.
4. Sections (Personal Info, Job Application Questions, Experience, More About You; snippet only), on one page or several per employer setting; e-signature if configured.
5. **Submit**; new candidates then confirm with a code unless the employer enabled auto-confirmation.
- Drafts autosave every 10 seconds once contact details and the disclaimer are in; reminders go out after 60 idle minutes and 3 days; drafts expire after 30 days and recruiters cannot see them.

Taleo Enterprise (Primary): multi-page blocks, e.g. Profile Upload → Personal Information → Education → Work Experience → E-Signature → Review and Submit → Thank You. Résumé upload and disqualification questions sit alone on their pages; screening requires login.

## Accounts and sign-in

- ORC: no candidate password. Identity = email or phone plus a 6-digit code by email or SMS; a verified session lasts 4 hours (**Keep Me Signed In** skips re-verification); five wrong codes lock the candidate out for 30 minutes; employers may add a date-of-birth check (Primary).
- Taleo: username and password per career section, with optional email confirmation, forgot-username/password, and Google sign-in via OpenID; lockout after failed sign-ins; reset by access code and/or security questions (Primary).
- Taleo options to watch: a privacy agreement before the login page, sign-in required before job lists, and a "Use SSN as User Name" setting (Primary).
- Taleo email verification is a link sent at an employer-chosen workflow step (Primary).
- Apply with LinkedIn (ORC plugin; Taleo, where later viewing still needs Taleo credentials) and Apply with Indeed (Primary).

## Documents and parsing

- ORC: a résumé upload autofills new candidates' fields; returning candidates choose between saved data and the parsed résumé; the file also lands in Supporting Documents (Primary). A 5 MB limit and txt, rtf, doc, docx, pdf, html appear in a community thread (snippet only; **Unverified**).
- Taleo: the Resume Upload block parses; attachments default to 1 MB per file and 10 files, raisable by Oracle support to 5 MB; candidates get 5 attachment updates per period (Primary).

## Questions and widgets

- ORC diversity section: date of birth, ethnicity, gender, marital status, religion and country-specific legal fields; disability uses form CC-305 on US jobs; veteran status is US-only. Answers start blank on every application and are hidden from recruiters (Primary). CC-305 cannot be made required (snippet only).
- ORC e-signature: typed name (last name required); records date, time and IP address (Primary).
- Taleo blocks: prescreening and disqualification questionnaires, EEO forms, Personal Information that can require a valid US SSN, background-check consent and address history, repeating education and work experience (0–10 minimum entries), references, certifications, a 7-day × 5-period shift-availability grid, source tracking (hidden when `src` is set), and an e-signature with a second check such as ZIP code (Primary).
- CC-305 is being retired by a 2026 OFCCP rule (law-firm alerts; see [workday.md](workday.md)); expect the disability block to change.

## Verification and anti-bot

- ORC: hCaptcha, switched on per employer, on verification pages (Apply to Job, events, talent community, Access Talent Profile, email-link verification); skipped under Keep Me Signed In and Apply with Indeed (Primary). Code emails can be delayed (snippet only).
- Taleo: the 25A career-site admin guide has no CAPTCHA topic (Primary; absence). Sessions time out after 1 idle hour by default with a 20-minute reminder; login errors are deliberately generic (Primary).

## Submission and proof

- ORC: new external candidates' applications stay **unconfirmed**, hidden from recruiters by default, until the emailed code is entered; recruiters can resend or confirm on their behalf. The "Job Application Confirmation Notification" email carries the code (Primary).
- ORC candidate dashboard: Active, Inactive and Draft applications; confirm pending ones; withdraw before the offer stage (Primary).
- Taleo: a Thank You page; My Submissions shows Draft, Complete or Withdraw only if the employer enabled it (Primary).
- Sender addresses and subjects: **Unverified**.

## Known quirks

- An ORC confirmation email is a request to act, not proof; only a confirmed application counts.
- Abandoned ORC drafts trigger reminder emails to the candidate.
- A Taleo setting can log the candidate out on the last page; Back then shows the job list (Primary).
- TBE was not verified in Oracle docs (the docs URL returned 404).

## RoleDawn status and gaps

- **Unsupported.** Neither product is in `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- ORC's code step resembles Greenhouse's, but RoleDawn's Gmail parser reads only Greenhouse codes (`src/server/mailbox/google-mailbox.ts`), and any one-time-code field hands over (`APPLICATION_FILL_OTP_MFA_TAKEOVER`).
- Taleo password fields hand over (`APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER`); no per-site password vault exists (D-031).
- Missing: SSN and background-check handling (must stay candidate-owned), disqualification-question policy, a 1 MB upload path for Taleo, and receipt contracts for both.

## Agent guidance

Do:
- Decide ORC vs Taleo from the URL before acting; the account model differs.
- ORC: use the candidate's application email; treat the code as an explicit verification step and count the application only once confirmed.
- Taleo: plan for 1 MB attachments and multi-page review; one unique password per career section (**Recommendation**; not built).
- Read-only discovery only; do not poll Oracle's internal-use endpoints at volume.

Don't:
- Enter an SSN, date of birth, religion, marital status or background-check consent without explicit candidate authority for that application.
- Answer disqualification or prescreening questions by inference.
- Retry codes (five failures lock the candidate out), or accept legal disclaimers for the candidate.

## Sources

- https://docs.oracle.com/en/cloud/saas/talent-management/fajaf/candidates-apply-using-the-job-application-flow.html, /faimh/application-flow.html, /faimh/save-draft-job-applications.html — ORC flow, parsing, drafts (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/talent-management/faush/email-and-sms-for-candidate-identity-verification-and.html, /faush/how-candidate-job-applications-are-confirmed.html, /faimh/enable-candidate-autoconfirmation.html — codes, lockout, confirmation (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/talent-management/faimh/enable-hcaptcha.html — ORC hCaptcha (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/talent-management/faush/candidate-legislative-and-diversity-information.html, /faush/validation-of-e-signatures-on-job-applications-and-offers.html, /faimh/candidate-self-service.html — diversity, e-signature, dashboard (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/human-resources/farws/api-recruiting-ce-job-requisitions.html, /op-recruitingcejobrequisitions-get.html — jobs JSON, internal use only (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/readiness/hcm/24b/recr-24b/24B-recruiting-wn-f33615.htm — career-site URL and sitemap (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/taleo-enterprise/22b/otcug/c-careersectionurl.html, /r-applicationflowblocks.html, /r-careersectionsettings.html, /Chunk409284270.html, /c-candidatesigninoptions.html — Taleo URLs, blocks, sessions, sign-in (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/taleo-enterprise/25a/otrcg/c-attachmentpermissionsandsettings.html, /21c/otrcg/c-candidateemailaddressverification.html — Taleo attachments, email verification (Primary), accessed 2026-09-30
- https://docs.oracle.com/en/cloud/saas/taleo-enterprise/otwsu/c-taleoapi.html — Taleo web services, organization-specific (Primary), accessed 2026-09-30
- https://raw.githubusercontent.com/sarthakjain004/headstart/main/src/headstart/scrapers/taleo_be.py, https://jobspipe.dev/sources/taleo, https://apify.com/nexgenwatch/oracle-recruiting-jobs-exporter — TBE and ORC URL patterns (Community), accessed 2026-09-30
- https://hcgn.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=CX_1,limit=1 — unauthenticated 200 (Direct observation by research agent), accessed 2026-09-30
