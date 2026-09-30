---
board: workday
status: unsupported
difficulty: hard
last_verified: 2026-09-30
url_patterns:
  - <tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>
  - <tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>/job/[<location>/]<title-slug>_<req_id>
  - <tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>/job/.../apply[/autofillWithResume|/applyManually|/useMyLastApplication]
  - <tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>/login
  - <tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>/userHome
  - wd<N>.myworkdaysite.com/[<locale>/]recruiting/<tenant>/<site>
  - <tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
  - <tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/job/<externalPath>
---

# Workday

Compact agent context: `BOARD_CONTEXT.workday` in [board-agent-context.ts](../../src/domain/board-agent-context.ts). Unverified, and never sent to a live prompt while this board is unsupported. Promotion rules: [README](README.md#how-to-add-a-lesson).

"Direct observation" below means read-only visits on 2026-09-30 to NVIDIA (`wd5`), Salesforce (`wd12`), Boeing (`wd1`) and Northrop Grumman (`wd1`). No account was created and nothing was typed. Community IDs come from open-source bots and drift by tenant and release.

## Recognize it

- Host `<tenant>.wd<N>.myworkdayjobs.com`; `N` is a shard (seen: 1, 3, 5, 12, 103) read from a real URL, never guessed. Variant: `wd<N>.myworkdaysite.com/recruiting/<tenant>/<site>`.
- Job URL: `/<locale>/<site>/job/<location>/<title>_<req_id>`; locale and location segments are optional; reposts add `-1`.
- Interactive elements carry `data-automation-id` (Direct observation): `jobTitle`, `jobPostingHeader`, `jobPostingDescription`, `requisitionId`, `adventureButton` (**Apply**), `utilityButtonSignIn`.
- Postings embed JSON-LD `JobPosting` (`identifier.value` = requisition id; `hiringOrganization.name` = legal entity).
- `robots.txt` lists `/<site>/siteMap.xml`, a standard `urlset` of postings: the crawler-sanctioned listing.
- Undocumented "CXS" JSON the site itself calls (Direct observation; Community):
  - `POST /wday/cxs/<tenant>/<site>/jobs` with `appliedFacets`, `limit`, `offset`, `searchText` → `total`, `jobPostings[]`, `facets`. Pages hold 20; a larger `limit` returns HTTP 400 or zero rows. `total` caps at 2,000 (NVIDIA showed 2,000 against 2,642 in facets); split by facet to read more.
  - `GET /wday/cxs/<tenant>/<site>/job/<externalPath>` needs no cookies → `jobPostingInfo` with `jobReqId`, `canApply`, `includeResumeParsing`, `questionnaireId`, `secondaryQuestionnaireId`, `externalUrl`.
  - No CORS; one tenant returned HTTP 500 without `Accept-Language`.
- Official Recruiting APIs need tenant credentials: SOAP `Get_Job_Postings`, `Put_Candidate`, `Put_Applicant` (Primary); REST through OAuth clients registered in the tenant (snippet only). Workday does not document CXS; the repo treats it as experimental ([handoff reconciliation](../research/claude-handoff-reconciliation.md)).

## Application flow

Multi-step wizard with `progressBar` / `progressBarActiveStep`. Workday's own section list: contact information, experience, application questions, voluntary disclosures, terms and conditions, review (Primary).

1. **Apply** → `applyAdventurePage`: **Autofill with Resume**, **Apply Manually**, **Use My Last Application**, and when enabled **Apply with LinkedIn** or **Apply with SEEK**.
2. **Create Account/Sign In**.
3. **Autofill with Resume** (autofill path only): upload, parse, prefill.
4. **My Information** → 5. **My Experience** → 6. **Application Questions** (Boeing: "1 of 2", "2 of 2").
7. **Voluntary Disclosures** (includes the terms agreement) → 8. **Self Identify** on some tenants.
9. **Review** → **Submit**.

- Observed step counts: NVIDIA 6 (manual) or 7 (autofill); Salesforce and Northrop Grumman 6; Boeing 7. None showed Self Identify.
- Steps are saved as you go (**Save and Continue**); unfinished drafts stay in Candidate Home as "Not Submitted" (Employer guides; Community). UW–Madison quotes 20–30 minutes per application.

## Accounts and sign-in

- **Primary:** "Require Candidate Home Account" is a tenant setting that Workday recommends. When off, a candidate verification email restricts access to the application instead, and an account can be created after submitting. All four observed tenants required an account at step 1.
- Each tenant identifies candidates by email (Primary), so accounts are per employer; one login does not span employers (**Inference**, consistent with community guidance).
- Create Account (Direct observation): `email`, `password`, `verifyPassword`, consent checkbox `createAccountCheckbox` (employer-written text; absent on some tenants), `createAccountSubmitButton`.
- Password rules are tenant-set (Primary); NVIDIA, Salesforce and Boeing listed the same ones: at least 8 characters with uppercase, lowercase, numeric, special and alphabetic characters.
- New accounts must be verified by email within 24 hours at CMU (Employer guide); link or code is **Unverified**.
- Sign In: `email`, `password`, `signInSubmitButton`, `createAccountLink`, `forgotPasswordLink`. Forgot-password is the only self-service recovery; lockouts happen (thresholds unknown).
- Social sign-in with Google or Apple is a tenant switch; Workday shares only the email, and Apple "Hide My Email" blocks employer mail (Primary). NVIDIA offered Google and LinkedIn; the other three opened straight to Create Account.
- Duplicate profiles: Workday auto-merges some matching candidates; NVIDIA warns duplicates may be disqualified.

## Documents and parsing

- Parsing ("Quick Apply") fills contact information, work experience, education and languages from a résumé, CV or prior application (Primary). `includeResumeParsing` in CXS likely signals whether autofill is offered (**Inference**).
- Parse quality drops with columns and tables; parsed or earlier panels stay on the form and can duplicate entries (Community; **Inference**).
- Uploads sit in My Experience (résumé and cover letter together). Limits are employer-set: 5 MB per file (North Carolina, Miami), up to five files (Miami); types vary (pdf, doc, docx, txt, images; some allow xls, ppt, mp4). Attachments cannot be changed after applying (Ohio State). Uploads are virus-scanned (Primary).
- Community IDs: `file-upload-input-ref`, `file-upload-successful`, `delete-file`.

## Questions and widgets

- My Information: "How did you hear about us?" is a nested, searchable prompt, hidden when the apply URL carries a configured source (Primary); `previousWorker` radio; `legalNameSection_firstName`, `_lastName`; `addressSection_addressLine1`, `_city`, `_postalCode`, `_countryRegion`; `phone-device-type`, `phone-number` with a country-code pill.
- My Experience: `workExperienceSection` and `educationSection` with **Add** / **Add Another**; panels hold `jobTitle`, `company`, `location`, `description`, `formField-startDate` / `formField-endDate`; school, degree, field of study, GPA; skills prompt; websites.
- Application Questions: employer questionnaires (`questionnaireId`, `secondaryQuestionnaireId`).
- Voluntary Disclosures: `gender`, `hispanicOrLatino`, `ethnicityDropdown`, `veteranStatus`, terms `agreementCheckbox`. Which fields appear (also date of birth, national ID, nationality) depends on the job's country (Primary).
- Self Identify: the disability form (name, date, choice). A US Labor Department (OFCCP) rule published 2026-08-21 retires form CC-305 around 2026-09-20 (law-firm and association alerts; **Unverified** against the Federal Register). Do not assume this step exists.
- Prompts: a button with `aria-haspopup="listbox"` opens `promptOption` items (label in `data-automation-label`), leaves `promptLeafNode`; picks show as `selectedItem` pills; `multiSelectContainer` for multi-select.
- Dates: segmented `dateSectionMonth-input`, `dateSectionDay`, `dateSectionYear` inside `dateInputWrapper`; older tenants use a picker (`dateIcon`).
- Inputs often lack `name`; some tenants wrap fields in `formField-<name>`. Errors: `errorBanner`, `errorMessage`, `inputAlert`.
- Navigation IDs differ by UI generation: `pageFooterNextButton` or `bottom-navigation-next-button`; the submit id is reported as both `pageFooterSubmitButton` and `pageFooterNextButton`.

## Verification and anti-bot

- **Honeypot (Direct observation, all four tenants):** input `data-automation-id="beecatcher"`, `name="website"`, clipped to 1 px, with screen-reader text saying it is for robots only.
- **Click filter (Direct observation):** buttons sit under `div[role="button"][data-automation-id="click_filter"]`; the real `<button>` is `aria-hidden` with `tabindex="-2"`.
- `noCaptchaWrapper` wraps the submit area, but no CAPTCHA script or frame loaded on the observed pages. Workday's docs do not describe one; whether tenants add one is **Unverified**.
- Sessions: North Carolina logs candidates out after 30 idle minutes; saving counts as activity, typing does not (Employer guide).
- Rate limits are undocumented; community scrapers report HTTP 400, 403, 422 and 500 from CXS.

## Submission and proof

- Review → **Submit** → on-screen confirmation ("Application Submitted" at CMU; the text is admin-configurable). Community reports conflict on whether Submit lands on `/userHome` or a congratulations page.
- Candidate Home statuses are tenant-specific (CMU: Not Submitted / Submitted; UW: In Progress, Sent to dept, Not selected, Withdrew).
- The posting later shows "You applied for this job on <date>" (Community).
- Confirmation emails come from the tenant (UW: `uw@myworkday.com`); subjects are unknown.
- One application per opening; no resubmission after submit or withdrawal (North Carolina, Ohio State).

## Known quirks

- Tenant variation is the norm: sign-in options, consent text, steps, questions and country-specific disclosures differ even on one Workday release.
- Two UI generations of IDs coexist; keep both behind the adapter.
- Prompt searches must stay inside the open popup; a page-wide search also matches progress-bar text.
- The browser Back button loses unsaved data (North Carolina). Applying through the wrong flow (internal vs external) can void an application (Ohio State).
- **Open question:** whether the page URL changes between steps; RoleDawn's step policy matches URL plus a ready selector.

## RoleDawn status and gaps

- **Unsupported.** Workday is absent from `ATS_DELIVERY_CAPABILITIES`; a pasted link fails intake with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`).
- Current guards stop at step 1: any password field → `APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER`; a one-time-code field → `APPLICATION_FILL_OTP_MFA_TAKEOVER` (`src/server/workers/agents-browser-tools.ts`).
- The generic observer drops only hidden or zero-size controls, so the 1-px honeypot would appear as a field; an adapter must exclude `beecatcher` by id.
- Code that fits: `DeliverySitePolicy` allows up to 12 steps with forward/back rules; `career-profile` (D-089) holds exact employers, titles and dates; saved voluntary answers (D-091).
- Missing: tenant allowlist; per-tenant accounts with a generated password vault ([playbook](../execution/application-playbook.md), D-031); a Workday verification-email parser (Gmail parsing handles only Greenhouse codes today); prompt and segmented-date drivers; a receipt contract; approval that covers per-step saves, which reach the employer before Submit (**Inference**).

## Agent guidance

Do:
- Preflight by reading the posting once (the CXS detail JSON is undocumented: read-only, never at volume); stop if `canApply` is false.
- Once an adapter exists and the candidate has authorized it (**Recommendation**; not built): create the tenant account with the candidate's application email and a unique generated password, stored encrypted and visible to the candidate.
- Prefer **Apply Manually**. If autofill runs, verify every parsed value against approved facts and delete unapproved panels.
- Enter employers, titles and month/year dates only from the career profile; read back each segmented date and `selectedItem` pill.
- Click through `click_filter`; save well inside the idle timeout; treat each save as a disclosure.
- Confirm "Submitted" in Candidate Home (or "You applied…" on the posting) before marking Applied.

Don't:
- Fill `beecatcher` or any robots-only field; solve or wait out a CAPTCHA.
- Reuse one password across tenants, create a second account on a tenant, or use Google, Apple or LinkedIn sign-in.
- Tick terms or consent boxes, or answer disclosures, without candidate authority; use only saved voluntary answers (D-091).
- Resubmit after "already applied" or a withdrawal.

## Sources

- Direct observation (read-only), 2026-09-30: nvidia.wd5, salesforce.wd12, boeing.wd1, ngc.wd1 career sites, `/apply` pages, CXS responses, NVIDIA `robots.txt` and `siteMap.xml`
- https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/career-sites/gtv1538650489786.html — Candidate Home account setting (Primary), accessed 2026-09-30
- https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/career-sites/ddo1548786792678.html — social sign-in, Quick Apply, LinkedIn/SEEK (Primary), accessed 2026-09-30
- https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/career-sites/san1394588983205.html — career sites, site id, embed (Primary), accessed 2026-09-30
- https://doc.workday.com/workday-education/en-us/course-manuals/recruiting-for-administrators/career-sites.html and /prospects-and-candidates.html — sections, parsing, accounts by email (Primary), accessed 2026-09-30
- https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/candidates/candidate-personal-information/qae1605872030805.html — country-dependent disclosures (Primary), accessed 2026-09-30
- https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/candidates/duplicate-candidate-merging/kfk1502452337000.html — duplicate merging (Primary), accessed 2026-09-30
- https://community.workday.com/sites/default/files/file-hosting/productionapi/Recruiting/v32.2/Recruiting.html — SOAP Recruiting operations (Primary), accessed 2026-09-30
- https://www.cmu.edu/jobs/apply.html, https://hr.osu.edu/careers/faq/, https://www.hr.miami.edu/careers/recruiting/workday-faq.html, https://oshr.nc.gov/work-nc/state-government-application-resources/north-carolina-job-application-frequently-asked-questions, https://jobs.wisc.edu/faq-workday, https://kb.wisconsin.edu/workday/152462, https://www.washington.edu/jobs/after-applying/ — employer guides (Employer guide), accessed 2026-09-30
- https://forums.developer.nvidia.com/t/my-nvidia-careers-account-associated-with-my-asu-email-address-appears-to-be-locked/360624 — account lockout report (Community), accessed 2026-09-30
- https://dev.to/dododata/scraping-workday-career-sites-without-a-browser-and-the-2000-job-ceiling-h2e, https://dev.to/juancarlosguti/ask-workdays-public-api-for-100-jobs-and-you-get-zero-with-no-error-54b2, https://dev.to/glitchbound/workday-says-the-board-has-2000-jobs-target-has-12525-reading-the-rest-7c9 — CXS limits (Community), accessed 2026-09-30
- https://raw.githubusercontent.com/markshield07/AI-Agent-Jobs-/main/src/jobagent/apply/browser/js/workday_widgets.js, https://raw.githubusercontent.com/ubangura/Workday-Application-Automator/master/apply.js, https://github.com/Jamalfox85/application-autofiller/pull/30 — widget and field IDs (Community), accessed 2026-09-30
- https://www.dlapiper.com/en-us/insights/publications/2026/09/ofccp-eliminates-disability-self-identification-requirement-what-federal-contractors-need-to-know, https://directemployers.org/2026/08/21/ofccp-section-503-final-rule-disability-self-id-utilization-goal/ — CC-305 retirement (Community: law-firm and association alerts), accessed 2026-09-30
