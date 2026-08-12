---
title: Landing-page blueprint and launch copy
status: future launch specification; not in the current runtime
last_updated: 2026-08-12
copy_standard: no-slop pass applied; claims remain gated by product evidence
---

# Landing-page blueprint

This document preserves the future landing specification. The executable landing
route and its sample product scenes were removed under D-044 so engineering can
finish one persistent application path first. The hierarchy, tactile-system
research, type measurements, and trade-dress boundary are in the [Clay design
study](../research/clay-design-study.md). Original RoleDawn artwork remains at
`public/brand/roledawn-night-shift-machine.png`; production claims remain gated
by measured evidence.

## Page objective

Convert a qualified active seeker into one of two actions:

1. Start a text conversation with RoleDawn.
2. Watch one complete, evidence-backed application flow.

The page must make the product concrete within one screen: it watches, prepares, asks, submits, and proves. Trust should appear in the hero, not in a privacy footer. The first emotional promise is a better morning; the first operational promise is a verified queue that still requires the candidate's approval.

## Copy grammar

**Recommendation:** Lead each major chapter in this order:

1. Human dream: the morning, time, relief, or confidence the candidate wants.
2. Current tension: the repeat work or reputational risk.
3. Product action: what RoleDawn does in plain language.
4. Visible proof: evidence, approval, state, or receipt.
5. Candidate choice: approve, edit, skip, pause, or inspect.

Keep the dream specific and bounded. Do not promise a job, interview, unattended submission, or emotional outcome the product cannot prove.

## Navigation

**Recommendation:** Use a compact floating navigation rail with:

`How it works · Proof · Safety · Pricing · Sign in · Text RoleDawn`

Keep the rail visually distinct from Clay's navigation shell. On mobile, it becomes an accessible compact bar or menu and must not obscure headings at 200 percent zoom.

## 1. Hero

**Eyebrow**  
The application agent you can text

**Headline**  
Your job search has a night shift.

**Subhead**  
RoleDawn watches fresh job pages, shapes each application from your real work, and brings you the final call. Approve one. Get the receipt.

**Primary CTA**  
Join the founding 50

**Secondary CTA**  
See the dashboard

**Microcopy**  
No card. Nothing submitted without your approval.

### Hero composition

**Verified reference:** Clay's inspected desktop hero used full-bleed tactile art with copy and actions split across two columns.

**Accepted implementation:** Use one continuous hero in normal document flow. The original RoleDawn night-work panorama fills the stage. A Midnight gradient turns the bottom of the art into a readable copy field. The headline anchors the lower-left; the mechanism, calls to action, and launch guardrail anchor the lower-right. The hero releases directly into the rounded trust panel.

The tactile scene uses RoleDawn objects only: discovery, evidence, tailoring, a visible human approval gate, ATS navigation, and confirmation. Do not use Clay's objects, artwork, landscape, screenshots, or customer marks.

The hero must not use sticky positioning, scroll-triggered chapters, or repeated wheel gestures. On phone widths, crop the panorama around the workflow stations, stack the two copy columns, use a roughly 2.6rem headline, and keep the hero near one viewport tall. A stronger vertical gradient protects contrast and creates the transition into Midnight.

### Hero product scene

The panorama communicates the workflow physically rather than embedding a dashboard or message demo in the first viewport. The product proof begins immediately below it: every claim has a source, one approval covers one application, a receipt follows confirmation, and the candidate can pause at any time.

## 2. Early proof mosaic

**Recommendation:** Place a rounded proof mosaic immediately after the hero. It should repeat the product contract before any long explanation.

Suggested illustrative tiles:

- `3 material changes · 3 approved sources`
- `One role · one approval · expires after change`
- `Sensitive answer missing · asked, not guessed`
- `CAPTCHA found · work saved · takeover ready`
- `Greenhouse confirmation · timestamp and files stored`
- A compact before/after with its Career Vault source chip

Every fictional role, company, metric, and receipt remains labeled **Illustrative**. This mosaic shows product behavior, not traction or employer endorsement.

## 3. Use-case tabs

**Headline**  
Meet RoleDawn where the search gets heavy.

Accessible tabs:

1. **Wake to a ready queue**  
   Fresh roles, fit gaps, and truthful drafts arrive organized before the candidate starts the day.
2. **Approve by text**  
   The user can ask why, inspect changes, answer one question, and approve one named application.
3. **Know what went out**  
   The confirmed state shows the exact fields, filenames, versions, time, and portal or email evidence.

Each tab uses a different composition of the same RoleDawn object vocabulary. Provide a chronological stacked version for reduced motion, narrow screens, and assistive technology.

## 4. Problem

**Headline**  
Get your evenings back without giving up the final say.

**Body**  
New tabs. The same address again. Another resume edit. Another portal password. Another spreadsheet that is already out of date. RoleDawn takes the repeat work and brings back the decisions that need your name.

Visual: late-night sequence of job tab → form → resume → tracker, collapsing into one morning Queue.

## 5. How it works

**Headline**  
Teach it once. Stay in control.

### Teach it your truth

Upload your resume and review the Career Vault. Every fact keeps its source, status, and allowed use.

### Set the rules

Choose roles, salary, location, work mode, sponsorship needs, dealbreakers, and a daily cap.

### Review by text

RoleDawn sends the fit, the gaps, and the material changes. Reply yes, edit, or skip. Open the dashboard when a decision needs more room.

### Get the receipt

After confirmation, see the exact answers, files, timestamp, and ATS evidence in one place.

## 6. Trust contract

**Headline**  
Nothing invented. Nothing outside your rules.

Three product cards:

- **Every material factual claim has a source.** See the resume line, project, or approved answer behind it.
- **Sensitive answers stay explicit.** RoleDawn does not guess work authorization, demographics, accommodations, or legal attestations.
- **Approval means one thing.** A yes applies to one named role and one unchanged application. It expires and cannot be reused.

## 7. Feature chapters

**Recommendation:** Give Career Vault, Queue, and Application Receipt separate full-width chapters. On large screens, each chapter uses a maximum content width of 1,216 px and a 48 px radius. Reduce the radius on smaller screens. Keep the geometry consistent while changing the scene and argument.

Each chapter follows the human-dream copy grammar and contains one real reusable product component. The chapter backgrounds remain RoleDawn Midnight, Cloud, Dawn Coral, First Light, or Signal Mint combinations; controls and receipts stay flat and legible.

### 7.1 Career Vault

**Headline**  
Bring your whole story. Keep every claim true.

Show a bullet in the application linked to a verified project fact and source passage. Include edit history and “allowed in applications” state. Avoid a decorative vector-database diagram.

Supporting copy:

> RoleDawn can emphasize what matters. It cannot create experience you did not have.

### 7.2 Queue

**Headline**  
Spend five minutes on the decisions that carry your name.

Show three rows:

- Ready to approve.
- Needs one salary/travel answer.
- Blocked by CAPTCHA, fields saved.

Demonstrate `YES`, `EDIT`, `SKIP`, `PAUSE`, and “Why this match?” with exact, calm responses.

### 7.3 Application Receipt

**Headline**  
Close the tab knowing exactly what happened.

Receipt fields:

- Company, role, location, and canonical source.
- Submission time and confirmation evidence.
- Answers and exact upload filenames.
- Resume, letter, fact-set, and policy versions.
- Changes approved by the candidate.
- Any unresolved or later-reconciled event.

End this chapter with the user's available action: inspect, export, report a problem, or open the application record.

## 8. Dashboard pipeline

**Headline**  
See the whole search without living in it.

Pipeline:

`New match → Queue → Preparing → Needs you → Applying → Confirmed → Recruiter replied → Interview`

Show cost/time only internally during alpha. Customer-facing counters should favor confirmed applications and outcomes, not activity volume.

## 9. Voice and writing

**Headline**  
It should still sound like you.

**Body**  
RoleDawn writes from your Career Vault and learns from approved edits. It cuts filler, keeps useful detail, and stops when the evidence runs out.

Show a before/after that removes generic cover-letter throat-clearing without inventing substance. Avoid claiming that the system “perfectly captures” voice.

## 10. Infrastructure and candidate stories

**Headline**  
Quiet underneath. Clear when it matters.

**Recommendation:** Use no more than three technical breadcrumbs on the landing page:

1. **Provenance-linked facts:** every material application claim resolves to an approved Career Vault source.
2. **Single-use approval:** one approval is bound to one named role and one immutable pre-submit diff; a change requires a new approval.
3. **Adapter plus confirmation:** known ATS steps run through deterministic adapters, and the application becomes `Confirmed` only after portal or email evidence is captured.

Do not lead with cloud vendors, workflow engines, databases, browser providers, or model names. Link to deeper safety and system material for readers who want it.

Candidate stories may enter this chapter only after consent and documented evidence. Label the exact outcome as application, recruiter response, interview, offer, or hire. Before then, use an **Illustrative workflow** or omit the story.

## 11. Comparison

**Headline**  
From form helper to accountable operator.

| Capability | Job board | Autofill extension | Black-box auto-apply | RoleDawn |
|---|---:|---:|---:|---:|
| Finds new roles continuously | Sometimes | No | Yes | Yes |
| Uses verified candidate facts | No | Saved fields | Unclear | Yes, with provenance |
| Explains material changes | No | N/A | Varies | Yes |
| Candidate controls final submission | Yes | Yes | Varies | Yes by default |
| Handles ATS form work | No | With user present | Yes | Yes |
| Produces a field-level receipt | No | No | Varies | Yes |
| Pauses safely for high-risk fields | N/A | User is present | Varies | Yes |

Do not name a competitor in the comparison until legal reviews the exact current claims.

## 12. Outcome proof

**Headline before real outcomes**  
Built to prove the work.

Show operating metrics only when real:

- Confirmed submission rate.
- Median approval-to-confirmation time.
- Percentage of applications edited before approval.
- Number of supported, currently tested ATS adapters.

Always include date range and sample size.

**Future headings:** `Interviewed at` and `Hired at`. Never merge the two. Obtain consent and evidence; state that employers do not endorse RoleDawn.

## 13. Learning and community mosaic

**Headline**  
The search gets easier when the playbook is shared.

**Recommendation:** Build this mosaic only from content or programs that exist. Candidate launch tiles may include:

- How to set useful search rules.
- What RoleDawn will never answer for you.
- A receipt-reading guide.
- Founder office hours.
- RoleDawn Pulse research with methodology and sample.
- Consent-backed candidate stories with exact outcome labels.

Mark future tiles **Planned** in internal designs and omit them from production until the destination exists. Do not invent a community, publication cadence, or dataset.

## 14. Pricing

**Headline**  
Pay for a search you can trust.

Run this after the concierge alpha as a pricing test, not a launch commitment:

| Plan | Hypothesis | Includes |
|---|---:|---|
| Founding | $99/month | 30 confirmed applications, all matches/drafts/tracking, founder onboarding |
| Pro | $149/month | 75 confirmed applications, recruiter-email routing when available, priority support |

The billable unit is `confirmed_application`: portal or email evidence tied to the correct candidate and requisition. Failed, canceled, uncertain, or duplicate attempts do not consume allowance. Avoid “unlimited.” Do not publish the grid until full-utilization cost passes the GTM margin gate.

## 15. FAQ

### Will RoleDawn make up experience?

No. Application claims must resolve to a fact or source you approved. If the evidence is missing, RoleDawn asks or leaves it out.

### Does it submit without me?

During launch, no. It builds the application and asks you to approve the final version. Narrow standing rules may come later, and you can revoke them.

### What happens with work authorization or voluntary demographic questions?

RoleDawn uses only an explicit saved answer or asks you. Optional demographic fields are left unanswered by default.

### What if a portal asks for a CAPTCHA or code?

It pauses, saves the work, and gives you a takeover link. It does not bypass the check.

### How do I stop it?

Reply `PAUSE ALL`, use the dashboard kill switch, or disconnect the channel. You can also export or delete your account data.

### How do I know an application was sent?

A confirmed application has a receipt with the fields, files, timestamp, and portal or email confirmation. Uncertain states are shown as reconciling.

### Can employers tell I used RoleDawn?

RoleDawn submits your approved materials and does not promise invisibility or evade employer rules. You remain responsible for the accuracy and attestations of your application.

## 16. Final CTA

**Headline**  
Tomorrow morning can start with progress.

**Button**  
Text RoleDawn

**Microcopy**  
Start in draft-only mode. Nothing goes out until you approve it.

### Final landscape

**Recommendation:** Center the final call to action over a quiet dawn landscape assembled from RoleDawn's evidence cards, state rail, bounded queue, approval seal, and receipt ribbon. Keep the composition original and calmer than the hero. The landscape is decorative support; the headline, button, and guardrail remain readable with images and motion disabled.

## Metadata

- Title: `RoleDawn | The job-application agent in your messages`
- Description: `Find fresh roles, review tailored applications by text, and approve every submission before it goes out.`
- Suggested social image: timestamped message thread bending into a sunrise line, plus one confirmed receipt.

## Accessibility and performance

- Keep one stable server-rendered H1 and call to action. Decorative day/night changes stay `aria-hidden`; do not announce the marketing sequence through a live region.
- Every tab, dialog, menu, and control must work by keyboard. Give dialogs an accessible name and description, return focus on close, and never use color as the only status signal.
- Meet WCAG AA contrast and preserve reading order at 320 CSS px and 200 percent text zoom.
- Label every fictional company, metric, message, and receipt as illustrative or sample data.
- Reserve hero media dimensions to prevent layout shift. Prefer still images and short CSS transitions over autoplay video, animated blur, or continuous parallax.
- Under `prefers-reduced-motion`, show the final static composition without crossfades, pinned scenes, or automatic timeline changes.

## Design handoff

Desktop artboard: 1440 px; mobile-first component behavior at 390 px. Use Manrope through `next/font` behind the [brand kit](../brand/brand-kit.md) sans token; do not ship Roobert without the required license. Build the hero, proof mosaic, use-case tabs, Career Vault provenance view, Queue, Receipt, and final landscape as original RoleDawn components. Use a 1,216 px maximum width and 48 px desktop radius for the major feature chapters, then reduce the radius responsively. Verify contrast, keyboard path, reduced motion, focus order, 200 percent text zoom, and message-demo labels.

## Launch-copy QA

- Replace illustrative company/role content with permissioned proof or keep the label.
- Re-verify supported ATS list and pricing on publish day.
- Do not show logos before proof governance is operational.
- Remove any guarantee, “all ATS,” “fully autonomous,” or quantity claim.
- Read every section aloud and delete any sentence that does not add a fact, decision, or useful feeling.
