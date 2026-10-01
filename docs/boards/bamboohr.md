---
board: bamboohr
status: unsupported
difficulty: easy
last_verified: 2026-09-30
url_patterns:
  - <company>.bamboohr.com/careers
  - <company>.bamboohr.com/careers/<id>
  - <company>.bamboohr.com/careers/list
  - <company>.bamboohr.com/careers/<id>/detail
  - <company>.bamboohr.com/jobs/view.php?id=<id>
  - <company>.bamboohr.com/js/embed.js
  - <company>.bamboohr.com/jobs/embed2.php?version=1.0.0&format=json
---

# BambooHR

Compact agent context: `BOARD_CONTEXT.bamboohr` in [board-agent-context.ts](../../src/domain/board-agent-context.ts). Unverified, and never sent to a live prompt while this board is unsupported. Promotion rules: [README](README.md#how-to-add-a-lesson).

Difficulty `easy` is provisional: no CAPTCHA, submit request or confirmation page has been observed yet.

## Recognize it

- Job pages `https://<company>.bamboohr.com/careers/<id>`: a client-rendered shell titled "BambooHR" (Direct observation by research agent).
- Page JSON the careers site uses (Direct observation; undocumented):
  - `/careers/list` → `{meta, result[]}` with `id`, `jobOpeningName`, `departmentLabel`, `employmentStatusLabel`, `location`, `isRemote`, `locationType`.
  - `/careers/<id>/detail` → `{result: {jobOpening, formFields}}`, including `jobOpeningShareUrl` and `datePosted`.
- Embed widget on employer sites: `<div id="BambooHR" data-domain=…>` plus `/js/embed.js`, which calls `/jobs/embed2.php?version=1.0.0&format=json`; listed positions link to `/careers/<id>`.
- Legacy `/jobs/view.php?id=<id>` gives a minimal page on some tenants and HTTP 410 on others; inactive tenants redirect to `bamboohr.com` (Direct observation).
- BambooHR's API index documents only authenticated ATS endpoints; the careers JSON is undocumented and changes without notice (Primary; Community).
- Brand is not board: BambooHR itself hires through Greenhouse (snippet only). Classify by URL, not company name.

## Application flow

1. Careers page or embedded widget → `/careers/<id>`.
2. One detail call returns the whole form, so the application is most likely a single page (**Inference**).
3. Enabled standard fields, résumé upload, custom questions, optional EEO fields.
4. **Submit**. Post-submit screens were not observed (**Unverified**).

- SEEK sends candidates to the BambooHR careers site with name, email, phone and résumé prefilled (Primary). Indeed Apply keeps candidates on Indeed (Vendor claim).

## Accounts and sign-in

- The form JSON has no account or sign-in fields; no account appears to be needed (**Inference**).
- LinkedIn is a plain `linkedinUrl` text field, not an apply-with button.
- Email verification: **Open question**.

## Documents and parsing

- The form references the résumé as `resumeFileId`, which suggests upload first, then reference by id (**Inference**). The JSON carries no type or size limits.
- The employer API accepts `resume` and `coverLetter` as PDF, Word, plain text, RTF, JPEG, GIF, PNG, TIFF or BMP; no size limit is stated (Primary).
- Hosted-form limits and résumé parse-to-autofill: **Unverified**.

## Questions and widgets

- Standard fields (each with `isRequired`): `firstName`, `lastName`, `email`, `phone`, `resumeFileId`, `desiredPay`, `address`, `countryId`, `educationLevelId`, `linkedinUrl`, `referredBy`, `educationInstitutionName`, `dateAvailable`, `websiteUrl`, `references` (Direct observation).
- `customQuestions[]` carry `type`, `options`, `isRequired`; types seen: `long`, `yes_no`, `multi`, `file`. Release notes add checkbox, short answer and multiple choice; yes/no answers can auto-disqualify (Primary).
- EEO keys `genderId`, `ethnicityId`, `veteranStatusId`, `disabilityId` exist (empty on the sampled job).
- `desiredPay` and `dateAvailable` map to RoleDawn's saved salary-expectation and start-date answers (D-091); never put current salary into `desiredPay`.
- Consent or privacy fields: none observed (**Open question**).

## Verification and anti-bot

- CAPTCHA: none visible in the form JSON; page scripts were not inspected (**Open question**).
- The employer API uses an API key over HTTP Basic or OAuth 2.0; repeated unknown keys temporarily return 403 (Primary). Not relevant to the hosted form.

## Submission and proof

- Confirmation page and email: **Unverified**. Employers can send emails on status changes (Primary).
- The employer API's create call returns `{result: "success", candidateId}` (Primary); RoleDawn cannot use it.
- No candidate status page was found.
- **Recommendation:** until a real submission is observed, there is no receipt contract; treat any send as uncertain.

## Known quirks

- Undocumented careers JSON can drift; version any parser against it.
- Inactive tenants redirect to `bamboohr.com`; legacy URLs can return 410.
- The help center (Salesforce-hosted) did not render for fetch tools.

## RoleDawn status and gaps

- **Unsupported.** Not in `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- **Hypothesis:** BambooHR could be the simplest next adapter: one page, no account, and a per-job form contract in `/careers/<id>/detail` (like Greenhouse `questions=true`). It needs an observed submit request, CAPTCHA check and receipt first.
- Delivery through the API needs the employer's `hiring:applications.write` scope with ATS-settings access; not a candidate channel.
- Gaps: upload endpoint, submit request, confirmation page, anti-bot behavior, and whether custom `file` questions accept RoleDawn's artifacts.

## Agent guidance

Do:
- Match the tenant subdomain and `/careers/<id>`; confirm the job via `/careers/<id>/detail`, read-only.
- Fill standard fields only from approved facts; `desiredPay` only from a saved expected-salary answer; `dateAvailable` only from a saved start date.
- Answer custom questions from candidate answers; ask when none exists.
- Stop on any block page or unknown control; CAPTCHAs go to the session's solver (D-146).

Don't:
- Treat a BambooHR-branded company's Greenhouse board as BambooHR.
- Use the employer API or guess EEO values.
- Mark the application Applied without an observed employer response.

## Sources

- https://touchstonetherapycenter.bamboohr.com/careers/list, /careers/21/detail, /careers/21, /js/embed.js, /jobs/embed2.php?version=1.0.0&format=json — careers JSON, form fields, embed (Direct observation by research agent), accessed 2026-09-30
- https://domain7.bamboohr.com/jobs/view.php?id=82 — legacy URL returning 410 (Direct observation by research agent), accessed 2026-09-30
- https://bamboohr.bamboohr.com/careers/list — inactive tenant redirects to bamboohr.com (Direct observation), accessed 2026-09-30
- https://documentation.bamboohr.com/reference/create-candidate — employer API, file types, scope (Primary), accessed 2026-09-30
- https://documentation.bamboohr.com/docs/getting-started, https://documentation.bamboohr.com/llms.txt — auth; no public careers endpoint documented (Primary), accessed 2026-09-30
- https://www.bamboohr.com/product-updates/custom-application-questions, https://www.bamboohr.com/product-updates/three-updates-to-the-ats — question types, disqualifying answers, status emails (Primary), accessed 2026-09-30
- https://www.bamboohr.com/product-updates/post-to-seek-and-manage-applicants-in-bamboohr — SEEK prefill (Primary); https://www.bamboohr.com/integrations/listings/indeed — Indeed Apply (Vendor claim), accessed 2026-09-30
- https://jobspipe.dev/sources/bamboohr — undocumented feed drift (Community), accessed 2026-09-30
