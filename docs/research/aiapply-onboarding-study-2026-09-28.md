---
title: AIApply onboarding and RoleDawn comparison
status: direct browser observations plus attributed product documentation
last_updated: 2026-09-28
accessed_at: 2026-09-28
---

# AIApply onboarding and RoleDawn comparison

## Scope and evidence rules

**Verified:** inspected AIApply in Chrome from its [homepage](https://aiapply.co/) through the public [product chooser](https://aiapply.co/product) and [Auto Apply questionnaire](https://aiapply.co/product/auto-apply/form). Read the rendered accessibility tree and screenshots. Used ordinary sample preferences to inspect branching. The questionnaire initially resumed around work type; Back navigation exposed earlier screens, then a forward walkthrough covered the no-CV/remote branch.

Step numbers changed across branches: the CV question and later goals acknowledgment both appeared at `step=5`, and the remote branch skipped `step=13`. Therefore the table below records the sequence of observed screens, not a claim that URL numbers form a stable universal questionnaire. Unseen branches are not verified.

**Boundary:** browser traversal stopped at mandatory country-specific work authorization, with Continue disabled until an answer was supplied. No real authorization answer, résumé, personal contact details, account credentials or payment information was entered. Permission to use fictional sensitive answers was requested; the remainder of the live questionnaire and authenticated app was not inspected in this pass. The study includes official help documentation to cover the remaining product structure, clearly separated from live UI observations.

**Verified local comparison:** opened RoleDawn's current app at `http://127.0.0.1:3001/dashboard`, `/search`, and one existing application detail. Read onboarding components without resetting the active candidate. No app code, settings, consent, application records or database schema was changed by this research. No Apply or auto-apply activation was performed.

The accompanying [implementation plan](../product/aiapply-inspired-simplification-plan.md) is a recommendation. Neither AIApply marketing claims nor repository implementation alone establishes real-employer delivery success.

## Live AIApply screen inventory

The following prompts and choices were read directly from the rendered public interface on September 28, 2026. They are recorded as research evidence, not recommended RoleDawn copy.

| Observed screen | Question or purpose | Controls/choices observed | RoleDawn implication |
|---|---|---|---|
| Product chooser | What would you like to do? | Three illustrated cards: automatic applications, résumé/cover letters, live interview help; auto-apply selected; comparison disclosure; Continue | Omit product choice for this release; RoleDawn has one core task. |
| Search approach | How are you approaching your job search right now? | Actively searching; open to opportunities; exploring. Large single-choice buttons advance the flow. | Optional business context; not needed to execute our requested workflow. |
| Search duration | How long have you been job hunting? | Just started, 1–3 months, 3–6 months, 6+ months, not actively looking | Omit unless there is a concrete personalization decision. |
| Outcome interstitial | Claim about members finding work during the first month | Chart and Continue | First-party marketing, not independently verified. Do not reuse the claim. |
| Product interstitial | Job-search puzzle explanation | Continue | Omit to shorten setup. |
| CV availability | Got a CV handy? | Have a CV / do not have a CV | No-CV branch was inspected. Upload branch was not completed. RoleDawn currently requires a reviewed résumé. |
| Motivation | What are you looking for? | Seven multi-select goals: urgent income, first job, extra income, work-life balance, long-term job, advancement, career switch | Omit motivational segmentation from minimum setup. |
| Acknowledgment | Thanks for sharing your goals | Continue | Avoid adding a whole screen for acknowledgment. |
| AI experience | Have you used AI-like tools in a job search? | Yes / Not sure / No | Omit; does not change our execution contract. |
| Product interstitial | AI job-search benefits | Claimed automatic applications, ATS benefits, hidden jobs and time savings | Vendor claims only. Avoid copying these promises. |
| Employment type | What type of work are you open to? | Full-time, part-time, contract, internship; multi-select; Continue disabled without a selection | Directly maps to existing employment-type preferences. |
| Pay | Desired minimum annual salary | Slider, value bubble, currency selector. USD/GBP/EUR/CAD/AUD/INR observed. Screenshot showed USD 120,000 and range from 0 to 5,000,000+ | Add a structured search floor only with matching support; a number field is more precise and accessible than a slider alone. Values shown are UI observations, not recommended defaults. |
| Work arrangement | What type of jobs do you prefer? | Fully remote, hybrid, in-office; multi-select | Reuse RoleDawn work modes. |
| Remote motivation | What do you like most about working remotely? | No commute, flexible schedule, work from anywhere, focus, family time | Branching demonstrates personalization; these answers have no current matching use for us. |
| Remote countries | Where would you like to work remotely? | Searchable countries, selected-country cards, remove controls, whole-region shortcuts and Worldwide | Use clear country chips within supported scope. Do not copy Worldwide without actual catalog and eligibility semantics. |
| Country authorization | What's your work authorization status? | US-specific dropdown including citizenship, residency, visa categories, authorized without sponsorship, not yet authorized; Continue required a choice | Collect only candidate-attested answers needed by our existing country/sponsorship contract; retain Not sure/skip. This was the stopping point. |

**Open questions:** remaining screens after work authorization, differences in CV-upload/hybrid/on-site branches, signup/payment sequence, final onboarding summary, actual application-volume control, authenticated mobile behavior, and authenticated job-feed appearance were not personally traversed. Do not describe this as a completed end-to-end account onboarding.

## Visual observations

**Verified:** public question screens use a very light gray canvas with subtle colored corner washes, a centered brand mark, Back at upper left, and a segmented purple progress indicator. A section label appears under the progress bar. The question and controls occupy a narrow centered column with substantial surrounding space.

Single-choice answers are large white rounded rectangles. Selected answers get a purple border; multi-select answers also show checkmarks. A wide rounded purple Continue action sits near the bottom of the viewport. It turns gray when requirements are unmet. Salary and country selection sit inside a white card. The authorization screen adds a short explanatory callout directly beneath its field.

**Inference:** answer controls appear approachable because the page has one decision, one selected-state treatment, and one obvious next action. RoleDawn can copy that interaction structure while keeping its own visual identity.

**Recommendation:** borrow the pacing, focused column, large targets, selection feedback and consistent action location. Reduce RoleDawn's large grouped forms, separate Save/Continue controls, mixed heading fonts and competing dashboard sections. Do not replicate the long motivational funnel.

Screenshots were visually inspected during this task; this document does not claim pixel measurements or a downloaded screenshot archive. Tokens and dimensions in the implementation plan are original recommendations.

## AIApply's documented authenticated product

These are **first-party product descriptions**, not authenticated browser verification or independent evidence that submissions succeed.

| Source | Documented behavior | Useful adaptation |
|---|---|---|
| [Application monitoring and credits](https://support.aiapply.co/en/articles/15555591-how-can-i-monitor-my-applications-and-credits) | Your Jobs with an Applied filter; opening a job exposes overview, fit and review areas; files/answers and posting link are available; Applied and Failed are distinct | Feed → detail → files/answers/receipt maps well to RoleDawn's existing data. |
| [How Auto Apply works](https://support.aiapply.co/en/articles/15692829-how-auto-apply-works) | Auto, Hybrid and Review modes; application-volume preference; pending/applying/done/paused queue labels | Keep our main switch simple. Put quantity and optional review-first in secondary settings. |
| [Profile and job preferences](https://intercom.help/aiapply/en/articles/14218613-auto-apply-settings-setting-up-your-profile-and-job-preferences) | Quick Settings, Job Preferences, Answer Library and rejection-reason areas; detailed targeting, candidate history/contact, résumé and reusable answers | Maintain RoleDawn's profile behind a secondary menu. Consider seniority, compensation and company exclusions later. |
| [Job matching and control](https://support.aiapply.co/en/articles/15692841-job-matching-control) | Target titles, company exclusions and rejection reasons including title/location/pay/seniority/skills; claims feedback improves matching | Store explicit feedback if introduced. Do not let inferred feedback silently change sending scope. |
| [Public Auto Apply illustration](https://aiapply.co/auto-apply) | Promotional application summary/status/counters/table illustration | Design reference only; not a real customer activity feed or proof of outcomes. |

**Documentation discrepancy:** the detailed Auto Apply article describes a selectable 10–100 per day range, while a [FAQ collection](https://support.aiapply.co/en/collections/18314774-faqs) summary describes a 70/day limit. Both were first-party descriptions encountered during the review. Neither figure is a measured capacity or a RoleDawn requirement. Our current database's 24/day maximum and hourly pacing must govern the implementation until deliberately changed and tested.

## RoleDawn observed in the browser

| Surface | Observation | Design consequence |
|---|---|---|
| Home, first viewport | Compact header with Home/Jobs/Profile and autopilot indicator; large serif greeting/date; paste-link; review checkbox; Needs-you list; large dark profile checklist begins below | The actual feed is pushed down. Put Applications first and collapse the controls. |
| Home, lower section | Large autopilot card with explanatory text and three counters, then application filters/rows and a Top matches section | Move matching to Browse; eliminate the large control panel and duplicated status indicator. |
| Application rows | Company initials, title/location, status badge, small process rail, date | Keep identifying content and status; move process rail into detail or remove it. |
| Jobs | All/Saved views; title/location/setup/type search; review-first checkbox; repeated Apply/save controls | Consolidate discovery here, include For you, and move persistent manual mode to settings. |
| Job expansion | A short excerpt and fit reasons; title links externally | Add full in-app detail with a secondary official link. |
| Application detail | Role/company/location, process rail, status, Apply-for-me card, document tabs, download, collapsed description/activity | Reuse content in an expandable drawer with clear status and action priority. |

This was a visual/UI check of the running local app. No independent live database health, receipt authenticity, employer delivery, or hosted-deployment verification was performed. Catalog counts seen in the UI are unnecessary to this design decision and are not promoted to verified inventory measurements.

## Current repository evidence map

| Evidence | Files |
|---|---|
| Standing consent and latest surface decisions | [Decision log](../execution/decision-log.md), especially D-078, D-085, D-086, D-091, D-092, D-096 and D-097 |
| Active shell/dashboard | [AuthenticatedAppShell](../../src/components/ui/AuthenticatedAppShell.tsx), [dashboard route](../../src/app/%28candidate%29/dashboard/page.tsx), [HomeView](../../src/components/home/HomeView.tsx), [home data](../../src/server/home/home-data.ts) |
| Browse and Apply | [JobsView](../../src/components/jobs/JobsView.tsx) (replaced OpportunityCatalog on 2026-09-28), [Apply actions](../../src/app/%28candidate%29/apply-actions.ts), [opportunity catalog reader](../../src/server/opportunities/catalog.ts) |
| Feed and display state | [queue reader](../../src/server/dashboard/queue.ts), [presentation mapper](../../src/domain/application-presentation.ts), [queue domain](../../src/domain/dashboard-queue.ts) |
| Exact onboarding/facts | [onboarding page](../../src/app/onboarding/page.tsx), [onboarding domain](../../src/domain/candidate-onboarding.ts), [onboarding server](../../src/server/candidate/onboarding.ts), [fact definitions](../../src/domain/candidate-profile.ts), [AnswersForm](../../src/components/profile/AnswersForm.tsx), [SearchGoals](../../src/components/onboarding/SearchGoals.tsx) |
| Auto-apply capacity/authority | [account domain](../../src/domain/account-auto-apply.ts), [settings/enrollment migration](../../supabase/migrations/20260917011226_account_auto_apply.sql), [advance-past-waiting migration](../../supabase/migrations/20260928200000_auto_apply_advance_past_waiting.sql), [worker](../../src/server/workers/auto-apply.ts) |
| Per-job send intent | [send-intent migration](../../supabase/migrations/20260928130000_application_send_intents.sql), [local-only review preference](../../src/components/app/useReviewFirst.ts) |
| Delivery scope | [capability registry](../../src/domain/application-autopilot-eligibility.ts) |
| Existing style tokens | [global CSS](../../src/app/globals.css), [shared app CSS](../../src/components/app/ui.module.css) |

**Verified gaps:** ignored send-intent failure, 100-row application limit, local-only review-first preference, no candidate quantity input, inconsistent feed/detail state, closed enrollment treated as active selection, hidden mobile filters, limited Browse detail, and mixed/stale support copy. These are specified with recovery and test requirements in the implementation plan.

**Recommendation:** implement the focused Applications/Browse surface and its truthful data contracts first. Add targeting fields only when they influence matching. Keep work authorization, voluntary data, consent and submission proof grounded in the existing candidate-owned records.
