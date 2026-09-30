---
title: Application playbook
status: canonical operating guide
owner: founder and engineering
last_updated: 2026-09-29
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
| 1. Intake | A pasted link (Home) or a match (Jobs, Autopilot) creates an application. The official posting is fetched and parsed. | `src/server/dashboard/queue.ts`, ingestion workers |
| 2. Prepare | Your approved résumé facts, stories, profile, and answers are frozen into a hashed snapshot for this application. | `src/server/workers/application-preparation.ts` |
| 3. Write | Research (GPT-6 Sol with web search), then drafting (GPT-6 Astra) under the five writing rules, up to three write-check-repair rounds. An independent model (GPT-5.6 Terra) checks each sentence against its cited sources, and a writing lint blocks banned and self-undercutting phrasing. | `src/server/applications/application-writing-pipeline.ts`, `policies/application-writing/` |
| 4. Render and store | Five files: résumé and cover letter as PDF and DOCX, plus one combined PDF. Text is read back out of each file. Files go to the private `application-artifacts` bucket under a content-addressed path, with SHA-256 hashes; rows are append-only. | `src/server/applications/application-document-renderer.ts`, `src/server/workers/application-kit.ts` |
| 5. Send | With "Let me review before it's sent" off (the default), sending starts by itself. A fresh Browserbase session opens; the form agent (GPT-6.1 Sol) maps each field; RoleDawn types exact values from your profile, uploads byte-checked files, and reads every field back. | `src/server/workers/application-autopilot.ts`, `application-delivery-driver.ts`, `application-delivery-browser.ts` |
| 6. Questions | A required question RoleDawn can't answer from your profile appears on Home as "Answer N questions". The send continues after you answer. | `src/server/applications/autopilot.ts` |
| 7. Submit | The exact answers and files are sealed; the database grants one permission for one network submission, and records the request and response. | `begin_application_autopilot_submit` |
| 8. Employer code | Greenhouse answers a cloud-browser submission with HTTP 428 and emails you an 8-character code. RoleDawn polls your Gmail every 5 seconds for up to 8 minutes, takes only a "Security code for your application to <Company>" email from Greenhouse whose company matches this job, types it into the page, and lets the page resend. Without Gmail, Home shows "Enter code". | `src/server/mailbox/google-mailbox.ts`, `createAutopilotVerificationRelay` |
| 9. Confirm | Only the employer's own response counts as a receipt. A model never decides that an application went through. | `receiptEvidence` in `application-autopilot-worker.ts` |

## Site support

| Site | Today | Evidence |
|---|---|---|
| Greenhouse | Fills, submits, and confirms | **Verified** end to end on 2026-09-30: Carvana Specialist, Inventory Quality was submitted, Greenhouse emailed its security code, RoleDawn read it from Gmail 7 seconds later, and Greenhouse confirmed. Multi-select questions such as GPA ranges are supported (D-113). |
| Lever | Fills and submits | Fixture tests only; **not yet proven live**. Passive hCaptcha is allowed; a visible challenge stops for you. |
| Ashby | Prepares documents | You submit on the employer's site. |
| Workday, iCIMS, SmartRecruiters, others | Not supported | See [Next: any site](#next-any-site-including-workday). |

## What Home tells you

| Label | Meaning | What to do |
|---|---|---|
| Reading the job, Preparing, Researching, Writing, Finishing | Documents are being made. | Nothing. |
| Ready to send | Documents are ready and "Let me review" is on. | Review, then Apply for me. |
| Sending soon, Applying | The browser is filling the employer's form. | Nothing. |
| Answer N questions | The form asked something only you can answer. | Click the row and answer. |
| Enter code | The employer emailed a code and Gmail didn't supply it. | Click the row and type the newest code. |
| Confirming | Submitted; RoleDawn is checking the employer's response. | Nothing, unless it stays for hours (see known gaps). |
| Applied | The employer's response confirmed it. | Nothing. |
| Stopped | RoleDawn stopped before sending. The row explains why. | Click the row; Try again when offered. |
| Couldn't read job | The posting couldn't be imported. | Check the link or skip it. |

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
npx --yes netlify-cli@latest deploy --build --prod
```

Never deploy without `--build`. On 2026-09-29 a deploy without it published the raw `.next` folder: every script and stylesheet returned 404 for new visitors, and build files were publicly readable (no secrets were in them). Netlify reads new environment variables only after a deploy.

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

Background workers see only the variables listed in `src/server/workers/hosted-worker-environment.ts`.

### Signing in

While single-account mode is on, open `https://roledawn.netlify.app/auth/test-session?key=<ROLEDAWN_TEST_ACCESS_KEY>` once per browser. Anyone without the key sees "This RoleDawn workspace is private." Before 2026-09-29, `/login` signed every visitor into the account.

### Gmail

Connect under Profile → Preferences. The connection is read-only (`gmail.readonly`) and used only to find employer security codes while a send waits. **Inference:** while Google's consent screen is in Testing, the connection expires about weekly; reconnect when Preferences says so. When Gmail can't supply the code, Home shows "Enter code".

### Browserbase

Developer plan since 2026-09-29: 25 browsers at once and 100 browser hours a month ([source register](../research/source-register.md)). One application uses about 3 to 14 browser minutes. Browserbase's own "Agents" feature is not used: RoleDawn's steps are fixed code, and Browserbase only supplies the browser.

## Known gaps (2026-09-29)

| Gap | Effect | Status |
|---|---|---|
| A no-build deploy was live | New visitors got pages with no scripts. | Fixed 2026-09-29 (`6abc4897`). |
| Open sign-in | Anyone with the URL was signed into the founder's account. | Fixed 2026-09-29 (D-109). |
| Code timeout left an application "Confirming" | The job could never be sent again. | Fixed 2026-09-29 (D-111); see below. |
| Archive has no button yet | Archiving is a database update (`applications.archived_at`). | Open. |
| GPA has no profile fact | The first GPA multi-select a candidate meets is asked once; later ones reuse the answer (D-112, D-113). | Open: add an `education.gpa` fact collected at onboarding. |
| Profile, story, and voice edits don't mark documents out of date | Documents made before an edit can still be sent. | Open. |
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
