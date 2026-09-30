---
board: workable
status: unsupported
difficulty: medium
last_verified: 2026-09-30
url_patterns:
  - apply.workable.com/<subdomain>/
  - apply.workable.com/<subdomain>/j/<SHORTCODE>/
  - apply.workable.com/<subdomain>/j/<SHORTCODE>/apply/
  - apply.workable.com/j/<SHORTCODE>
  - <subdomain>.workable.com/j/<SHORTCODE>
  - www.workable.com/api/accounts/<subdomain>
  - apply.workable.com/api/v1/widget/accounts/<subdomain>
  - jobs.workable.com
---

# Workable

Compact agent context: `BOARD_CONTEXT.workable` in [board-agent-context.ts](../../src/domain/board-agent-context.ts). Unverified, and never sent to a live prompt while this board is unsupported. Promotion rules: [README](README.md#how-to-add-a-lesson).

## Recognize it

- Careers page `apply.workable.com/<subdomain>/`; jobs at `.../j/<SHORTCODE>/` with the form at `.../apply/`; share link `apply.workable.com/j/<SHORTCODE>`. Sampled shortcodes were 10-character uppercase hex (Direct observation).
- Legacy `<subdomain>.workable.com/...` URLs 301 to the `apply.workable.com` path; `<subdomain>.workable.com/backend` is the recruiter app, not a candidate page (Primary; Direct observation).
- Pages render client-side; a plain fetch sees only the title `<Job> - <Company>` and an image on `workablehr.s3.amazonaws.com`.
- Careers-page options (Primary): Workable-hosted (on `apply.workable.com` or a custom domain), an embedded widget (applying still happens on `apply.workable.com`), or an API-built page whose form can live on the employer's domain.
- Public jobs API (**Verified**, vendor docs): `GET https://www.workable.com/api/accounts/<subdomain>[?details=true]` plus `/locations` and `/departments`; an unknown account returns 404 `{"error":"not-found"}`. It now 302s to `apply.workable.com/api/v1/widget/accounts/<subdomain>` (Direct observation). Jobs carry `shortcode`, `url`, `application_url`, `shortlink`.
- Undocumented GETs the page uses (Direct observation by research agent): `apply.workable.com/api/v1/accounts/<subdomain>` (GDPR consent flag, CCPA URL, `applyWithIndeed`, `ofccp` flags), `/api/v1/jobs/<SHORTCODE>/form` (form schema), `/api/v2/accounts/<subdomain>/jobs/<SHORTCODE>` (job JSON).
- `jobs.workable.com` is the "Jobs by Workable" search site, not an employer board.

## Application flow

1. Job page → **Apply** → `/apply/`.
2. Optional **Apply with LinkedIn** prefill (custom questions still need answers) or résumé import to autofill (snippet only).
3. One form in three sections: personal information, profile, details (custom fields `CA_<n>`, questions `QA_<n>`) (Direct observation of the schema).
4. GDPR consent checkbox, required, for jobs in the EU, UK, Norway, Iceland, Switzerland or Liechtenstein when enabled (Primary).
5. **Submit** → candidate lands in the job's Applied stage; automatic confirmation email (Primary).
6. US jobs with EEO/OFCCP reporting: an optional survey right after submit; skippers get a reminder email (Primary).

- **Inference:** a single page plus the separate EEO step; not visually confirmed.

## Accounts and sign-in

- No account is needed to apply (**Inference** from the form schema).
- Candidates may save a Workable job-seeker profile (email magic link, Google, LinkedIn or Microsoft) that autofills later applications (snippet only).
- Indeed Apply is on by default; it makes cover letter, phone, address and photo optional (Primary). SEEK applications truncate short answers to 128 characters and drop file questions (Primary).

## Documents and parsing

- Résumés: up to 5 MB as pdf, doc, docx, rtf, html or odt; file questions up to 20 MB with a broader list (Primary).
- **Conflict:** the sampled form schema listed a 12,000,000-byte résumé size. **Recommendation:** enforce 5 MB.
- Résumé import parses the file to autofill (snippet only); treat parsed values as unapproved.
- The employer-authenticated `application_form` endpoint exposes `supported_file_types` and `max_file_size` per field (Primary).

## Questions and widgets

- Question types (Primary): paragraph, short answer (128 characters), yes/no (can auto-disqualify), dropdown, multiple choice (one or many), date, number, file upload. All custom questions are mandatory.
- Standard fields can each be mandatory, optional or off per employer (Primary).
- EEO survey: US-only, optional, with a "prefer not to specify" choice; job-board applicants get it after submit or by email (Primary).
- **Unverified:** widget libraries (date picker, dropdown implementation) on the hosted form.

## Verification and anti-bot

- **Primary:** Workable runs a web application firewall, IP-reputation and browser-integrity checks, rate limiting, bot management, and a CAPTCHA for suspicious traffic (provider not named).
- **Primary:** applications whose metadata matches automated-tool patterns get an **AI-assisted** tag; recruiters can filter on it, disable job boards per job, and add disqualifying questions. Relay emails are replaced by the email on the résumé when available.
- A previously sourced candidate who applies with the same email gets a "Verify your application" email instead of the normal confirmation (Primary).
- API limits (account tokens 10 requests per 10 s; OAuth 50 per 10 s; `429` with `X-Rate-Limit-*`) apply to API credentials only (Primary).

## Submission and proof

- The automatic confirmation email includes the application details and cannot be disabled (Primary). Sender and subject: **Unverified** (the `<subdomain>@jobs.workablemail.com` address in account config is a job mailbox, not a confirmed sender).
- With GDPR features on, the email links the privacy notice and a withdraw-and-delete option.
- Re-applying to the same job overwrites the earlier application if the candidate has not been engaged; if engaged, nothing updates and no email is sent (Primary). A different job creates a separate profile.
- Confirmation page text: **Unverified**.

## Known quirks

- Changing an account's subdomain breaks old links with a 404 (snippet only).
- Indeed and SEEK channels map fields lossily (above).
- **Inference:** RoleDawn applications from a cloud browser may carry the AI-assisted tag and reach recruiters pre-filtered.

## RoleDawn status and gaps

- **Unsupported.** Not in `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- Discovery: the documented public accounts API is a candidate source after source review ([ingestion matrix](../research/ats-api-ingestion-matrix.md)).
- Delivery: `POST https://<subdomain>.workable.com/spi/v3/jobs/<shortcode>/candidates` needs an employer token with `w_candidates`; not a candidate channel.
- **Inference:** the undocumented `/api/v1/jobs/<SHORTCODE>/form` schema could give a per-job field contract like Greenhouse `questions=true`, but it is undocumented and may change.
- Unknown: hosted-form widgets, the CAPTCHA provider, and the receipt page.

## Agent guidance

Do:
- Normalize legacy `<subdomain>.workable.com` links to `apply.workable.com` before matching.
- Read jobs through the documented accounts API, read-only.
- Use the candidate's application email and real details; never a relay address.
- Leave the GDPR consent box to the candidate's explicit decision.
- Stop on any CAPTCHA, browser-integrity interstitial or block page.

Don't:
- Re-apply to the same job to "fix" an answer; it overwrites or silently no-ops. Reconcile first.
- Use the SPI `w_candidates` endpoint or Indeed/SEEK/LinkedIn shortcuts on the candidate's behalf.
- Answer the EEO survey without saved voluntary answers (D-091).

## Sources

- https://workable.readme.io/reference/jobs-1 — public accounts endpoint (Primary), accessed 2026-09-30
- https://www.workable.com/api/accounts/workable?details=true — 302 to the widget API (Direct observation), accessed 2026-09-30
- https://apply.workable.com/api/v1/widget/accounts/mediaradar, https://apply.workable.com/api/v1/jobs/AFB818810B/form — widget JSON, form schema (Direct observation by research agent), accessed 2026-09-30
- https://help.workable.com/hc/en-us/articles/5270992137751-Where-can-I-find-my-account-subdomain, /115012944968-Comparing-careers-page-options — hosts and careers-page options (Primary), accessed 2026-09-30
- https://help.workable.com/hc/en-us/articles/115012238108-What-types-of-files-can-be-uploaded-on-the-application-form, /115012087467-What-types-of-questions-can-I-add-to-my-application-form — files and question types (Primary), accessed 2026-09-30
- https://help.workable.com/hc/en-us/articles/360041472254-Setting-up-GDPR-automation-features, /360056592054-EEO-survey-how-will-candidates-complete-it — consent and EEO (Primary), accessed 2026-09-30
- https://help.workable.com/hc/en-us/articles/35293126257815-Managing-AI-assisted-and-automated-job-applications — bot management, AI-assisted tag (Primary), accessed 2026-09-30
- https://help.workable.com/hc/en-us/articles/115013695147-How-does-Workable-handle-duplicate-and-or-multiple-applications, /115015713847-What-happens-when-a-candidate-applies — duplicates, confirmation email (Primary), accessed 2026-09-30
- https://help.workable.com/hc/en-us/articles/4407003772695-Does-Workable-use-Indeed-Apply, /6443854557591-Which-question-custom-field-types-are-supported-on-the-Seek-network — Indeed and SEEK (Primary), accessed 2026-09-30
- https://workable.readme.io/reference/job-candidates-create, https://workable.readme.io/reference/rate-limits — employer write API, limits (Primary), accessed 2026-09-30
