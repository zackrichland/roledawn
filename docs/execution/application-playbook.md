---
title: Application playbook
status: canonical operating guide
owner: founder and engineering
last_updated: 2026-09-30
scope: how one application moves from a job link to a confirmed receipt, what each Home status means, how to operate RoleDawn, and what comes next
---

# Application playbook

This page explains how RoleDawn applies to a job from start to finish, what every status on Home means, how to run the system, and what to build next. The database and the worker code are the source of truth. When this page and the code disagree, the code wins and this page gets corrected.

Status labels follow the repository convention: **Verified** (seen in code, data, or a live run), **Inference**, **Recommendation**, and **Proposed** (built or designed, not yet approved).

## The path of one application

```mermaid
sequenceDiagram
  participant You
  participant App as RoleDawn web (Netlify)
  participant DB as Supabase (source of truth)
  participant Worker as Background worker (Netlify)
  participant AI as OpenAI models
  participant Browser as Browserbase cloud Chrome
  participant ATS as Employer site
  participant Gmail as Your Gmail (read-only)
  You->>App: Paste a job link, or turn on Autopilot
  App->>DB: Import the posting and create the application
  Worker->>AI: Research the employer; draft résumé, letter, answers
  Worker->>AI: Check every sentence against its sources
  Worker->>DB: Render and store five files; status Ready
  Worker->>Browser: Open a clean browser
  Worker->>ATS: Fill fields, upload the exact files, read everything back
  Worker->>DB: Seal the exact answers; one-time permission to submit
  Worker->>ATS: Submit once
  ATS-->>Worker: Confirmation, or "enter the code we emailed you"
  Worker->>Gmail: Find the employer's security code
  Worker->>ATS: Type the code; the page resends the same application
  ATS-->>Worker: Confirmation response
  Worker->>DB: Save the receipt; Home shows Applied
```

The diagram is a summary; the table below is authoritative.

| Step | What happens | Main code |
|---|---|---|
| 1. Intake | A pasted link (Home) or a match (Jobs, Autopilot) creates an application. After the durable command commits, the hosted web app wakes due workers. Completed stages wake their queued successors; the minute schedule remains recovery. The official posting is fetched and parsed. | `src/server/dashboard/queue.ts`, ingestion workers |
| 2. Prepare | Your approved résumé facts, stories, profile, and answers are frozen into a hashed snapshot for this application. | `src/server/workers/application-preparation.ts` |
| 3. Write | Research (GPT-6 Sol with web search), then drafting (GPT-6 Astra) under the five writing rules, up to three write-check-repair rounds. An independent model (GPT-5.6 Terra) checks each sentence against its cited sources, and a writing lint blocks banned and self-undercutting phrasing. | `src/server/applications/application-writing-pipeline.ts`, `policies/application-writing/` |
| 4. Render and store | Five files: résumé and cover letter as PDF and DOCX, plus one combined PDF. Text is read back out of each file. Files go to the private `application-artifacts` bucket under a content-addressed path, with SHA-256 hashes; rows are append-only. | `src/server/applications/application-document-renderer.ts`, `src/server/workers/application-kit.ts` |
| 5. Send | With "Let me review before it's sent" off (the default), sending starts by itself. A fresh Browserbase session opens; the form agent (GPT-6.1 Sol) maps each field; RoleDawn types exact values from your profile, uploads byte-checked files, and reads every field back. | `src/server/workers/application-autopilot.ts`, `application-delivery-driver.ts`, `application-delivery-browser.ts` |
| 6. Questions | Answers come from four places, in order. (1) Profile facts matched by exact label rules. (2) Earlier candidate answers to the same wording. D-122 requires current candidate inputs; explicit GPA/degree questions may cross jobs, while other answers require the same frozen job; its migration is applied and read back. (3) Standing answers: a required question nothing else covers is matched by one model call to the candidate's saved answers ("GPA: 3.5") and filled in the same pass. Code checks the chosen options, and the answer is labeled `STANDING` with what it rests on (D-117). (4) Only what is left appears on Home as "Answer N questions". Optional fields never block a send. Explicit saved delegation maps consent, terms, application-information attestations and signature fields without a model or repeated candidate acknowledgement (D-136). The full employer descriptor and authorization basis are stored; signatures use the approved identity frozen for that send. Demographic and qualification answers require candidate facts or answers. Security-clearance questions also need the candidate, except an explicitly saved answer to the exact active TS/SCI-with-FSP-or-CI question (D-125): code and SQL map its literal Yes/No directly and exclude it from model inference. | `src/server/workers/standing-answers.ts`, `application-autopilot-worker.ts`, `application-delivery-driver.ts` |
| 7. Submit | The exact answers and files are sealed; the database grants one permission for one network submission, and records the request and response. | `begin_application_autopilot_submit` |
| 8. Employer code | Greenhouse answers a cloud-browser submission with HTTP 428 and emails you an 8-character code. RoleDawn polls your Gmail every 5 seconds for up to 8 minutes, takes only a "Security code for your application to <Company>" email from Greenhouse whose company matches this job, types it into the page, and lets the page resend. Without Gmail, Home shows "Enter code". | `src/server/mailbox/google-mailbox.ts`, `createAutopilotVerificationRelay` |
| 9. Confirm | Only the employer's own response counts as a receipt. A model never decides that an application went through. | `receiptEvidence` in `application-autopilot-worker.ts` |

## Site support

| Site | Today | Evidence |
|---|---|---|
| Greenhouse | Fills, submits, and confirms | **Verified** end to end twice on 2026-09-30: Carvana Specialist, Inventory Quality (code read from Gmail 7 s after the request), and Carvana Strategy Analyst with a required GPA multi-select (code read in 6 s; final pass 262 s). The required "Location (City)" typeahead is filled from your city, confirmed by region and country (D-118). See the [Greenhouse template](../boards/greenhouse.md). |
| Lever | Fills and submits | Fixture tests only; **not yet proven live**. Passive hCaptcha is allowed; a visible challenge stops for you. |
| Ashby | Hosted-form delivery adapter | Named draft saves, location lookups, uploads and final submission share the existing approval and receipt controls. Public-client observation and fixture checks are separate from live employer acceptance; see the [Ashby template](../boards/ashby.md). |
| Workday, iCIMS, SmartRecruiters, others | Not supported | Per-board templates for the agent: [docs/boards/](../boards/README.md). See [Next: any site](#next-any-site-including-workday). |

## What Home tells you

| Label | Meaning | What to do |
|---|---|---|
| Reading the job, Preparing, Researching, Writing, Finishing | Documents are being made. | Nothing. |
| Ready to send | Documents are ready and "Let me review" is on. | Review, then Apply for me. |
| Queued to apply | The saved send request is waiting for a worker. | Nothing; no second approval is needed. |
| Applying | The browser is filling the employer's form. | Nothing. |
| Send stopped | The earlier send request closed because the board was unsupported. | Retry sending when the new adapter is available. |
| Answer N questions | The form asked something only you can answer. | Click the row and answer. |
| Enter code | The employer emailed a code and Gmail didn't supply it. | Click the row and type the newest code. |
| Confirming | Submitted; RoleDawn is checking the employer's response. | Nothing, unless it stays for hours (see known gaps). |
| Applied | The employer's response confirmed it. | Nothing. |
| Trying again | A temporary provider problem stopped the send before anything was submitted; RoleDawn retries by itself (try 2 of 3). | Nothing. |
| Stopped | The application stopped. The row explains why and whether the employer refused it. | Click the row; Try again is offered only when it can help. |
| Finish on their site | RoleDawn can't complete this form itself: a verification challenge, a sign-in, an unsupported field or board, or an answer the form refused (D-133). | Open the employer's page from the row. |
| Couldn't start | RoleDawn's browser time or capacity ran out before the form opened; nothing was sent. | Open the employer's page, or Try again later. |
| Not confirmed yet | The employer's response hasn't shown the application was received, and the outcome is unknown. Nothing is sent again until it is reconciled (D-124). | Nothing; there is no Try again. |
| Posting closed | The employer took the posting down. | Nothing. |
| Writing stopped | The documents couldn't be finished: missing profile detail, a busy writing service or checks that failed. | Open Profile, or Try again when offered. |
| Couldn't read job | The posting couldn't be imported. | Check the link or skip it. |

## When something fails

- **Before any submission** (model or network timeout, full browser pool, unknown worker error): the send runs again by itself, 1 and then 5 minutes later, before it waits for the candidate (D-114).
- **Employer refused the code**: one automatic retry, then Try again (D-111).
- **Retry classes (D-133):** *automatic* (six pre-submit provider codes, twice), *manual* (Try again shown), *after a change* (a verification challenge, sign-in, unsupported field or board, refused answer or browser quota: the row says what would change the outcome and offers the employer's page), and *never* (an unknown outcome is reconciled first, so no Try again). `src/domain/application-stop-guidance.ts` owns every state's copy and action; add a stop code there, never inline.
- **Open (needs a migration):** manual Try again and re-claimed expired-lease fill runs have no database cap, and browser-quota stops have no backoff. Proposed: `fill_claims` (park at 6), `manual_retries` (deny at 3) and a 30-minute quota backoff, three times.
- **Unknown outcome after submitting**: RoleDawn reconciles before anything else is sent.
- **Where to look**: `npm run ops:status` lists live applications, lanes, and recent failures with their cause; add `-- --app <id>` for one application's timeline and `-- --watch` to refresh (D-116).
- **Works locally, fails in production**: the hosted browser is Linux Chrome on Browserbase. Page scripts can behave differently by platform. React Select, for example, marks options `aria-selected` everywhere except on Apple devices, and that difference hid the GPA field on 2026-09-30. Reproduce with a Linux user agent and `navigator.platform` before concluding a form works.

## Rules that never change

- Only the employer's own response proves an application was received.
- One permission per submission, tied to the exact answers and files that were checked.
- An uncertain result is reconciled before anything is sent again.
- No CAPTCHA solving. A visible challenge stops the send.
- Your name, contact details, employers, titles, and dates always come from your profile, never from a model.

## Operating RoleDawn

### Deploy

Run from the repository root, with no local dev server running:

```bash
npm run deploy
```

`npm run deploy` sets a fresh Next.js deployment ID and runs `netlify deploy --build --prod`. Never deploy without `--build`. On 2026-09-29 a deploy without it published the raw `.next` folder: every script and stylesheet returned 404 for new visitors, and build files were publicly readable (no secrets were in them). Netlify reads new environment variables only after a deploy.

### Database changes

Never use `supabase db push`; eight 2026-08-19 migrations are recorded remotely under different versions. For each new migration: wrap it in `begin; … commit;`, run `npx supabase db query --linked -f <file>`, then `npx supabase migration repair --status applied <version> --linked`, and read the result back. Check locally first with `node scripts/migration-harness.mjs supabase/checks/*.sql`.

### Settings (Netlify production)

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | All models. |
| `ROLEDAWN_APPLICATION_AGENT_MODEL` | Form agent; `gpt-6.1-sol` since 2026-09-29. |
| `ROLEDAWN_DRAFTING_MODEL`, `ROLEDAWN_RESEARCH_MODEL`, `ROLEDAWN_VERIFICATION_MODEL` | Optional overrides; defaults are GPT-6 Astra, GPT-6 Sol, and GPT-5.6 Terra. |
| `BROWSERBASE_API_KEY`, `ROLEDAWN_BROWSERBASE_ENABLED` | Cloud browser. The code requires exactly one Browserbase project. |
| `ROLEDAWN_FORM_DRIVER=agents`, `ROLEDAWN_AUTOPILOT_ENABLED=true` | Sending. |
| `ROLEDAWN_HOSTED_WORKERS_ENABLED`, `ROLEDAWN_WORKER_DISPATCH_SECRET`, `APP_BASE_URL` | Background workers. |
| `ROLEDAWN_MAILBOX_TOKEN_KEY`, `GOOGLE_MAILBOX_CLIENT_ID`, `GOOGLE_MAILBOX_CLIENT_SECRET` | Gmail code reading. |
| `ROLEDAWN_SINGLE_ACCOUNT_MODE`, `ROLEDAWN_TEST_ACCOUNT_ID`, `ROLEDAWN_TEST_ACCESS_KEY` | Single-account sign-in (below). |

Background workers see only the variables listed in `src/server/workers/hosted-worker-environment.ts`. Immediate web wake-ups require Netlify’s runtime request context to identify the current published production deploy, enabled hosted workers and the dispatch secret. Build-only `CONTEXT` is not used; local and preview runtimes cannot wake workers. Local web-only development still waits for the initial hosted schedule; it never starts competing local workers.

### Signing in

While single-account mode is on, open `https://roledawn.netlify.app/auth/test-session?key=<ROLEDAWN_TEST_ACCESS_KEY>` once per browser. Anyone without the key sees "This RoleDawn workspace is private." Before 2026-09-29, `/login` signed every visitor into the account.

### Gmail

Connect under Profile → Preferences. The connection is read-only (`gmail.readonly`) and used only to find employer security codes while a send waits. **Inference:** while Google's consent screen is in Testing, the connection expires about weekly; reconnect when Preferences says so. When Gmail can't supply the code, Home shows "Enter code".

### Browserbase

Developer plan since 2026-09-29: 25 browsers at once and 100 browser hours a month ([source register](../research/source-register.md)). One application uses about 3 to 14 browser minutes. Browserbase's own "Agents" feature is not used: RoleDawn's steps are fixed code, and Browserbase only supplies the browser.

## Known gaps (2026-09-30)

| Gap | Effect | Status |
|---|---|---|
| A no-build deploy was live | New visitors got pages with no scripts. | Fixed 2026-09-29 (`6abc4897`). |
| Open sign-in | Anyone with the URL was signed into the founder's account. | Fixed 2026-09-29 (D-109). |
| Code timeout left an application "Confirming" | The job could never be sent again. | Fixed 2026-09-29 (D-111); see below. |
| Employer logo cache not applied | Migration `20260930143000_employer_logos.sql` is written and tested locally; until it is applied, logos are fetched live each time (D-134). | Open: apply by the hosted-migration steps, regenerate types, deploy. |
| Archive has no button yet | Archiving is a database update (`applications.archived_at`). | Open. |
| Standing answers have no page yet | They are saved with `save_candidate_standing_answer` (the founder's ten are in). | Open: an onboarding step and a Profile → Answers list to add, edit and remove them. |
| Automatic answers aren't shown on the application page | Each is recorded with its source (`CANDIDATE`, `REMEMBERED`, `STANDING`) and basis, and `ops:status --app` shows the step. | Open: list "Answered from your saved answers" on the application page. |
| Consent and attestation checkboxes stop a send | They always go to the candidate. | Open decision O-013. |
| Profile, story, and voice edits did not mark documents out of date | Documents made before an edit could still be sent. | Applied and read back (D-121, migration `20260930080000`). Published content changes invalidate old packets and pause auto-apply. A first résumé-derived career profile preserves its own preparation only when no current snapshot exists; extraction metadata alone does not invalidate inputs. |
| Remembered answers could cross employer or role context | An earlier employment or motivation answer could be wrong for the next job. | Applied and read back (D-122); migration `20260930090000` requires current candidate inputs for all recall; only a narrow education-question list may cross jobs. |
| Private agent replay can retain extracted document text | Provider cleanup does not remove all document-bearing replay results. | Open; clear only after exact-session deletion is confirmed, preserving active and uncertain recovery. |
| No notifications | Nothing outside the app tells you when a send needs you. | Open. |
| No export or delete-account | Required by RoleDawn's own rules and by Google for wider Gmail access. | Open. |
| One send at a time for all users | About 4–5 sends an hour. | Open; matters once others use RoleDawn. |

### A missed code never blocks a job (D-111)

When Greenhouse's code never arrives, or every code is refused, the employer has explicitly not accepted the application. That attempt closes as `NOT_ACCEPTED`, the send runs once more by itself (a new code email arrives, and Gmail supplies it), and after a second refusal Home offers Try again. Attempts whose outcome is unknown still block new sends until reconciled. Each new attempt gets its own submit key (`autopilot:<id>:<n>`) and its own one-time permission.

## Next: any site, including Workday

**Later phase; not MVP.**

- **Recommendation:** add a general form path that uses the same guards (exact values, byte-checked uploads, readback, one sealed submission) on sites without a dedicated adapter, and accept a confirmation page or a confirmation email as the receipt.
- **Accounts (Workday and similar):** use the candidate's application email and a unique, generated password per site, stored encrypted like the Gmail token and viewable by the candidate in RoleDawn. One password reused across every employer site would expose all of them after a single breach. Email verification links would come through the same Gmail connection.
- **Out of scope:** CAPTCHA solving, and inventing answers to sensitive questions.

### Diagnosing stops (2026-09-30)

`npm run ops:status -- --app <id>` reads the hosted timeline. `agent-turn` records the terminal provider status, a fixed failure category and action count; `writing-check` records each repair attempt and unsupported-segment counts without document text. `failure-release` includes the SQLSTATE when a terminal writing failure cannot be released. Unknown submission outcomes remain unretryable. A failed model turn can resume filling once within the original action budget; thrown or uncertain actions, cancellation and credit exhaustion do not resume there.

The daily UTC cap counts all actual candidate attempts, including pasted links. Confirmed sends contribute to the displayed sent count; uncertain attempts still consume capacity. Preparation and employer draft saves do not consume a submission slot.
