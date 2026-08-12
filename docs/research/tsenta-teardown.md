---
title: Tsenta product and onboarding teardown
status: research snapshot
last_updated: 2026-08-11
method: live unauthenticated Browser walkthrough, public pages, headers, client bundles, legal pages, stores, company profiles, and a founder-provided authenticated screenshot walkthrough
---

# Tsenta product and onboarding teardown

## Executive read

Tsenta is not primarily an iMessage bot. It is a cloud job-application execution engine that exposes messaging, dashboard, mobile, extension, and MCP control surfaces.

Its public promise combines five things unusually well:

- **Speed:** be among the first applicants to a matching role.
- **Delegation:** let a cloud worker do the repetitive form work.
- **Breadth:** operate across many ATS families and client surfaces.
- **Trust signals:** show diffs, approval controls, receipts, replay, and status.
- **Aggressive value:** sell hundreds or thousands of application attempts per month at consumer-software prices.

The defensible work sits below the interface: career-page ingestion, a structured candidate profile, ATS-specific automation, credentials and OTP, state recovery, and proof of submission.

## What was directly observed

**Verified on 2026-08-06:**

| Surface | Finding |
|---|---|
| Homepage | “Be the first to apply to every job that fits you. Hands off.” Claims monitoring of 50,000+ career pages, tailored materials, and support for Workday, Greenhouse, Lever, Ashby, and 15+ other ATS products. |
| Core workflow | Find → prep → apply → track. Public copy covers form completion, uploads, open-ended answers, status, and recruiter-email routing. |
| Channels | Web, iOS, Android, desktop, iMessage, WhatsApp, Chrome extension, MCP/CLI, Claude, and Codex are represented. |
| Messaging entry | Publicly lists an iMessage number and WhatsApp number. Dashboard login offers Google, email, or “Sign in with messaging,” then accepts a phone number or iMessage email and offers to send a code. |
| Mobile claim | The application worker continues in Tsenta's cloud after the app closes; candidates can auto-apply or review. |
| MCP | Public remote endpoint at `https://api.autojobs.me/api/v1/mcp`, with OAuth examples for Claude and Codex clients. |
| Pricing | Free: 25 lifetime applications. Starter: $19 for 600 per 30 days. Pro: $39 for 1,500. Power: $99 for 4,500. Prices are a snapshot, not a recommendation. |
| Review control | Current changelog says Review Before Submit is live for Greenhouse, Workday, Ashby, Lever, Oracle, and SmartRecruiters; auto-approve remains available. |
| Proof | The page shows a large employer-logo wall and says users have been hired at major companies. These are unverified first-party claims. |
| ATS disclosure | Publicly lists 19 ATS families: Workday, Greenhouse, Lever, Ashby, Rippling, iCIMS, BambooHR, Workable, JazzHR, Jobvite, BreezyHR, Oracle Cloud, SmartRecruiters, Paylocity, UltiPro, ADP, Dover, Gem, and Zoho Recruit. |

The 2026-08-06 research walkthrough stopped before account creation and did not submit a phone number, create an account, accept terms, upload a resume, connect email, or apply to a job. On 2026-08-11, the founder supplied a separate authenticated screenshot sequence captured after uploading a resume. That sequence verifies the visible six-step intake and first dashboard described below. It does not prove an employer-side submission or any hidden security control.

## Authenticated walkthrough observed on 2026-08-11

**Verified from the founder-provided screenshots:**

| Stage | Visible behavior | Product implication |
|---|---|---|
| Resume upload | The sequence begins after the founder uploaded a resume. Parsing continues in a persistent side rail while the remaining questions are completed. | Waiting time is converted into bounded setup progress. |
| Step 1: location | Full address, city, ZIP/postal code, county/district, country, and state. | The product pre-collects reusable ATS identity fields before first value. |
| Step 2: contact | Phone and LinkedIn, with copy indicating parser-found values may be used when skipped. | Contact facts become reusable application inputs. |
| Step 3: work eligibility | Citizenship, target work countries, authorization, sponsorship need, and authorization basis per country. | Matching and later form completion become country-aware. |
| Step 4: quick checklist | In-person work, relocation, immediate start, transportation, accommodations, clearance, foreign-government ties, voluntary demographic fields, veteran/disability status, and notes. | A broad answer bank is built before the candidate reaches the dashboard. |
| Step 5: application password | One application password is requested for portals such as Workday, iCIMS, and Oracle, with a generator and an “Encrypted before save” statement. | The product attempts to remove account-creation handoffs. The screenshot does not verify reuse behavior or the underlying secret boundary. |
| Step 6: application settings | Resume optimization modes Off, Honest, and Aggressive; automatic cover-letter behavior; edit approval; and Review Before Submit. | Intake ends with an explicit autonomy configuration. |
| Completion | A modal grants 25 free applications with Browse jobs as the primary action and plans/wallet as the secondary action. | The user reaches value before payment and receives a visible consumable allowance. |
| First dashboard | Assistant chat, dense search filters, five recommended jobs, Apply/Pass actions, Apply to all 5, a tracker, and a remaining-credit count. | Recommendations, batch action, tracking, support, and upsell share one operating surface. |

The screenshots show selected factual and sensitive values, edit approval enabled, and review disabled. They do **not** establish whether those values were product defaults, parser output, or founder selections. Do not publish a claim about Tsenta's defaults without a controlled fresh-account test.

## Reconstructed onboarding

The following separates exact observed client behavior from inference.

### Pre-authentication

1. Choose Google, email, or messaging authentication.
2. For messaging, enter a phone number or iMessage email and request a verification code.

### Current public onboarding code, now corroborated by the signed-in walkthrough

1. Upload one PDF resume, up to 10 MB.
2. The service parses the resume, begins a cover-letter draft, and starts matching.
3. Complete profile gaps across approximately six additional steps:
   - Full address, city, state, ZIP/postal code, county/district, and country.
   - Phone and LinkedIn.
   - Work authorization and sponsorship by country.
   - In-person work, relocation, immediate start, transportation, accommodations, government clearance/ties, optional demographic information, and notes.
   - An application password for portals that require candidate accounts.
   - Resume optimization mode: off, honest, or aggressive.
   - Auto-approval, cover-letter generation, and Review Before Submit choices.
4. Continue to the dashboard while parsing and matching run asynchronously.

**Verified:** job filters are visible on the first signed-in dashboard, but they were not part of the six captured post-resume steps. The evidence does not prove whether a separate pre-upload screen collected initial targets.

## Conversion mechanics worth adapting

- Keep resume parsing visible and honest while the user completes other work.
- Make a long intake feel finite with one subject per screen, a persistent progress bar, Back controls, and keyboard support.
- Keep a plain-language “why we ask” explanation beside every question.
- End onboarding with an explicit permission summary before any agent work begins.
- Avoid a blank first session by landing on sourced recommendations and visible activity.

## Safety-critical differences for RoleDawn

- Collect city, region, and search radius first; request a street address only when a named application requires it.
- Ask work authorization as an exact per-country rule because it changes eligibility. Do not infer citizenship or sponsorship from a resume.
- Do not collect voluntary demographic, disability, veteran, accommodation, clearance, or family-tie answers globally. Leave voluntary fields unanswered by default and ask just in time when a named form requires a decision.
- Never store one reusable cross-ATS password. Create or capture unique site credentials behind the credential broker and keep them outside model context, ordinary domain rows, logs, screenshots, and analytics.
- Do not offer an evidence-free “aggressive” mode. Stronger framing remains bounded by verified Career Vault facts.
- Let discovery, eligibility checks, and drafting run unattended. Require one single-use approval tied to one immutable application revision before submission.
- Replace bulk apply with bulk preparation. The candidate can review a queue quickly without granting ambiguous authority over multiple applications.

## What Tsenta collects early

The flow is operationally comprehensive but trust-heavy. It may request address, work authorization, sponsorship, protected or sensitive answers, application credentials, optimization preferences, and authorization behavior before the user has experienced a successful application.

That creates an opening for progressive disclosure:

- Start with resume, target, location, and non-negotiables.
- Produce a first transparent match and draft.
- Ask for new facts only when a real application requires them.
- Explain why each sensitive fact is needed, where it will be used, and how to delete it.
- Separate optional demographic data from application-critical setup.

## Product architecture signals

### High-confidence, directly observed or officially disclosed

| Layer | Evidence |
|---|---|
| Marketing | Next.js/Turbopack assets and Vercel response headers. |
| Dashboard | Vite-built React PWA assets; public client references Firebase, Sentry, PostHog, Intercom, payments, Redux-style state, and Tailwind-style classes. |
| Backend/hosting | Privacy policy names Fly.io and managed PostgreSQL; MCP traffic also traversed Cloudflare and Fly.io. |
| Identity | Firebase Authentication and Google identity/session behavior. |
| AI | Privacy policy names Anthropic and OpenAI for tailoring, question generation, fit reasoning, and MCP usage. |
| Email/OTP | Privacy policy names Resend, AWS SES, and optional Composio access to Gmail/Outlook for OTP processing. |
| Payments | Dodo Payments. |
| Product analytics | PostHog; error monitoring through Sentry. |
| Execution core | Current engineering recruiting copy explicitly asks candidates to automate 19+ ATS products and values browser automation. |

### Medium-confidence historical signals

An archived/mirrored engineering post mentioned React 19, Tailwind, Redux Toolkit, Electron, Playwright, Chrome DevTools Protocol, AdonisJS, Prisma, BullMQ, Redis, Mastra, DeepSeek, pgvector, Vercel, Fly.io, Sentry, and PostHog. Because the original post was not live, treat this as a historical lead rather than current stack confirmation.

### Unknown

- The iMessage provider is not identified publicly. Do not attribute Photon, Sendblue, BlueBubbles, or another vendor to Tsenta.
- The exact browser-fleet provider, proxy design, adapter implementation, and tenant isolation model were not verified.
- Company-supplied user, interview, and hire claims were not independently audited.

## Public state-machine clues

The dashboard client exposes states such as `OPTIMIZING`, `PENDING_*_REVIEW`, `READY`, `RUNNING`, `COMPLETED`, `SKIPPED`, and `FAILED`, plus execution targets including `ELECTRON` and `CLOUD`.

This reinforces a central product lesson: the application is a durable stateful object. A chat transcript cannot be its source of truth.

## Strengths to learn from

1. Lead with a concrete operating outcome, not a model or agent framework.
2. Treat messaging as one member of a surface portfolio.
3. Make progress visible with queue states and receipts.
4. Cover the full workflow from discovery through recruiter response.
5. Publish a machine-readable product corpus (`llms.txt`, `llms-full.txt`, `ai.txt`) and comparison library for search and answer engines.
6. Make onboarding operationally complete enough to reduce later interruptions.

## Openings to exploit

1. **Truth by architecture:** reject unsupported claims rather than offering an “aggressive” rewrite mode.
2. **Progressive trust:** show a useful result before requesting the most sensitive data.
3. **Profile isolation:** bind every application to immutable fact, resume, letter, answer-policy, and consent versions.
4. **Failure honesty:** say precisely what stopped, what is saved, and what the user must do.
5. **Cancellation and recovery:** cancel queue items cleanly; reconcile uncertain submits before retry.
6. **Outcome quality:** optimize for qualified applications, recruiter response, and interview yield instead of raw count.
7. **Privacy consistency:** keep legal policy, app-store labels, onboarding, and product behavior aligned.
8. **Auditable proof:** distinguish interviewed from offered and hired; attach consent, cohort, and date.

## Direct product conclusion

Do not copy Tsenta's price-volume race or every surface at launch. Copy the operating discipline beneath its story, then counter-position on evidence, control, voice fidelity, and receipts.

See the [backend operating model](../architecture/backend-operating-model.md) for RoleDawn's evidence-labeled implementation response, plus the [source register](source-register.md), [market comparison](market-and-competitors.md), and [ATS automation](../architecture/ats-automation.md).
