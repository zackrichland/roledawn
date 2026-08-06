---
title: Dashboard and responsive experience
status: implementation specification
owner: product and design
last_updated: 2026-08-06
decision_state: recommended MVP information architecture
---

# Dashboard and responsive experience

## Product job

The dashboard answers four questions:

1. What needs me now?
2. What is RoleDawn working on?
3. What changed in each application?
4. What was confirmed?

The interface should reduce uncertainty, not reward application volume. This document expands the dashboard requirements in the [PRD](prd.md) and the trust behavior in [onboarding and messaging](onboarding-and-messaging.md).

## Reference status

### User-provided observation

The user supplied a Tsenta dashboard screenshot captured on 2026-08-06 as a visual reference. The screenshot shows:

- A left sidebar with Dashboard, Browse jobs, Applications, Inbox, Tracker, Profile, and Settings.
- A global search field.
- Four top-match cards with circular percentage scores and Apply buttons.
- An application table with resume, cover-letter, status, and applied columns.
- Filters for all, in flight, needs you, failed, and skipped.
- Open Tracker and Submit all controls.
- A credit balance in the account panel.

The screenshot records one visible interface state. It does not verify current Tsenta behavior, underlying logic, accessibility, or submission semantics.

### Recommendation

Keep the useful operational visibility. Replace opaque scoring, ambiguous bulk submission, billing prominence, and mixed job/application concepts with RoleDawn's authority, evidence, and receipt model.

## Experience principles

1. Needs You appears before new matches.
2. Every application has one clear state and next action.
3. Authority is visible at all times.
4. Match explanations show rules and evidence, not a decorative percentage alone.
5. A receipt requires confirmation evidence.
6. Pause is always available.
7. Mobile shows the same authority and workflow, not a reduced-permission version.
8. The database and workflow state determine the interface. Chat text does not.

## Information architecture

### Desktop navigation

~~~text
Today
Approval Queue
Search
Applications
Inbox
──────────────
Career Vault
Rules
──────────────
Settings
~~~

Do not create a separate Tracker page in MVP. Applications already own pipeline, events, outcomes, and receipts.

Suggested routes:

| Route | Purpose |
|---|---|
| <code>/app/today</code> | Morning brief, attention queue, working items, recent receipts |
| <code>/app/queue</code> | Ready, Needs You, and takeover work |
| <code>/app/search</code> | Active searches, new matches, and exclusions |
| <code>/app/applications</code> | Full pipeline, history, and outcomes |
| <code>/app/applications/:id</code> | Match, materials, answers, activity, and receipt |
| <code>/app/inbox</code> | Recruiter messages and response state |
| <code>/app/vault</code> | Facts, sources, answer policies, and profile versions |
| <code>/app/rules</code> | Search constraints, authority, caps, and quiet hours |
| <code>/app/settings</code> | Security, channels, billing, export, deletion, and support |

Receipts belong to application records. Recent Receipts can be a dashboard module without becoming a separate primary route.

### Mobile navigation

~~~text
Today · Queue · Search · Inbox · More
~~~

More contains Applications, Career Vault, Rules, Settings, export, and deletion. Deep links from iMessage may open any application directly.

## Desktop shell

At 1200 px and above:

- Sidebar width: 240–256 px.
- Header height: 64–72 px.
- Main content maximum width: 1440 px.
- Main gutters: 24–32 px.
- Use a twelve-column content grid.
- Keep the sidebar and authority bar stable while the application list scrolls.
- Open application details in a right panel only when at least 520 px remains for the list.
- Use a full application route at narrower widths.

### Header

Include:

- Current page title.
- Global search by role, company, requisition, and application ID.
- Current authority label.
- Pause control.
- Notifications.
- Help.
- Account menu.

Do not show a credit balance as a primary operating control.

### Authority bar

The authority bar stays visible at the top of Today, Queue, and Applications:

~~~text
Agent active · Per-application approval · Quiet hours 10 PM–7 AM
[Pause all]
~~~

States:

- Draft-only.
- Per-application approval.
- Narrow standing authorization, future.
- Paused by user.
- Paused by security.
- Channel disconnected.

The bar must explain what the agent may do now. A model cannot change this state.

## Today

### Page order

1. Authority bar.
2. Morning brief.
3. Needs You.
4. Approval Queue.
5. Working.
6. Recent Receipts.
7. New matches.

Actionable uncertainty stays above discovery content.

### Morning brief

Use actual account data:

~~~text
Good morning, Alex.
RoleDawn prepared 2 applications overnight.
1 needs your travel answer. 1 is ready for review.
~~~

Do not show a number when its source state is stale or unknown.

Summary cards:

- Ready for approval.
- Needs You.
- Working.
- Confirmed in the selected period.

Each count links to a filtered list. Confirmed must mean portal or email evidence exists.

### Needs You

Rank by expiry and consequence:

1. Security or credential event.
2. Live takeover in progress.
3. Expiring named approval.
4. Login, OTP, or CAPTCHA.
5. Sensitive or legal question.
6. Missing exact fact.
7. Preference outside the user's current rules.

Each item must state:

- Role and company.
- Why work stopped.
- What has been saved.
- What action resumes it.
- Whether anything was submitted.

### Approval Queue

Each item shows:

- Company, role, location, requisition, and canonical source.
- Posting age and source freshness.
- Passed hard rules and unresolved gap.
- Changed resume fields and generated answers.
- Artifact and fact-set versions.
- Approval expiration.
- Review, edit, skip, and pause controls.

There is no Submit all control in MVP.

### Working

Use user-facing workflow terms and the last meaningful event:

~~~text
Preparing materials
Mapped 14 of 17 fields · waiting on no one
Last update 2 minutes ago
~~~

Do not expose model chain-of-thought, internal retries, or noisy tool logs.

### Recent Receipts

Show:

- Company and role.
- Confirmed timestamp.
- ATS family.
- Receipt evidence type.
- Resume and answer-set versions.
- Open receipt action.

If the outcome is uncertain, place the item under Checking submission instead.

## Search

Search separates jobs from applications.

### Match card

Show:

- Company, role, location, work mode, and posting age.
- Source and requisition.
- Hard-rule result.
- Supporting evidence.
- Gaps.
- Save, skip, explain, or prepare actions.

Replace a circular score such as “71%” with an explanation such as:

~~~text
8 of 10 rules passed
Strong evidence: healthcare rollout, multi-site operations
Gaps: payments experience, weekly travel
~~~

A numeric model score may appear as supporting detail after calibration, never as the only explanation.

Company artwork inside the authenticated product is context, not outcome proof. Treat it as decorative when the company name is already visible. Do not reuse it in marketing as an endorsement.

## Applications

### Desktop table

Use a semantic table with these columns:

| Column | Content |
|---|---|
| Application | Company, role, location, requisition |
| Search | Source, posting age, rule version |
| Match | Rule result and open explanation |
| Materials | Resume, letter, answers, material change count |
| Status | Text, icon, last meaningful event |
| Next action | One contextual action |
| Updated | Absolute time available with relative label |

The row opens application details. Every inline control remains independently keyboard accessible.

### Mobile card

Use this vertical order:

1. Status and posting age.
2. Company and role.
3. Rule result.
4. Material changes.
5. Missing decision or next workflow event.
6. Primary and secondary actions.

Do not force the desktop table into a horizontal scroller.

## Application detail

Use a right panel on wide desktop and a full route on tablet and mobile.

Tabs:

- Overview.
- Match.
- Materials.
- Answers.
- Activity.
- Receipt.

### Overview

- Immutable job snapshot.
- Current workflow state.
- Current authority.
- Next action.
- Supporting and missing evidence.
- Application owner and source.

### Match

- Hard constraints first.
- Preferences second.
- Evidence references.
- Missing qualifications.
- User feedback action for future ranking.

### Materials

- Resume and cover-letter versions.
- Unified or side-by-side diff.
- Source chips beside material claims.
- Allowed-use state.
- Edit history.

### Answers

- Exact prompt snapshot.
- Proposed answer.
- Source and answer-policy references.
- Sensitive classification.
- User approval state.

Sensitive answers must come from structured approved records or live user input. Do not present embedding retrieval as authority.

### Activity

Show a redacted, user-meaningful event timeline:

- Job captured.
- Fit checked.
- Materials prepared.
- Approval requested.
- Approval consumed.
- Applying.
- Takeover requested.
- Checking submission.
- Confirmed.
- Corrected or reconciled.

Do not show secrets, OTP values, hidden form values, raw model reasoning, or unredacted screenshots.

### Receipt

Minimum fields:

- Company, role, location, requisition, and canonical URL.
- Submission and confirmation timestamps.
- Confirmation evidence type and reference.
- Final field values and exact filenames.
- Resume, letter, answer-set, fact-set, policy, and adapter versions.
- Approval reference and approved material diff.
- Reconciliation or correction events.

## Action rail

For a pending application, keep a compact action rail visible:

~~~text
Example Co.
Customer Success Manager · Req 1842

3 material changes
1 travel decision
Approval expires in 20 minutes

[Review and approve]
[Edit]
[Skip]
~~~

The approval flow must:

1. Refresh the application version.
2. Verify the immutable diff hash.
3. Name the company, role, and requisition.
4. Show unresolved decisions.
5. Confirm expiration.
6. Consume one single-use approval.

Any material change invalidates the approval and returns the item to review.

## User-facing workflow language

| Internal state | User-facing label | Required supporting text |
|---|---|---|
| Discovered or FitScored | New match | Why it passed or failed rules |
| Drafting | Preparing | Current bounded task |
| NeedsFacts | Needs You | Exact missing fact |
| NeedsReview | Ready for review | Change count and gaps |
| Ready | Approved | Named scope and expiration |
| Applying | Applying | Last meaningful portal step |
| NeedsUser | Needs You | Login, OTP, CAPTCHA, certification, or answer |
| Reconciling | Checking submission | Why retry is paused |
| Confirmed | Confirmed | Evidence type and timestamp |
| Response | Recruiter replied | Message source and action |
| Interview | Interview | User-entered or confirmed event |
| Offer | Offer | User-entered or confirmed event |
| Rejected | Closed | Source and date |
| Failed | Failed | Reason and recovery |
| Canceled | Canceled | Actor, time, and retained state |

Status uses an icon, label, and next action. Color is supporting information.

## Visual tokens

Use the [brand kit](../brand/brand-kit.md):

- Cloud page background.
- White working surfaces.
- Midnight text and primary controls.
- First Light for the main candidate action.
- Signal Mint only for safe or confirmed states.
- Dawn Coral for focused attention.
- Error Rose for destructive or blocked states.
- Slate for neutral history.

Suggested support colors must be checked before shipping:

~~~css
--rd-surface: #ffffff;
--rd-border: #dde2ec;
--rd-working-bg: #eef3ff;
--rd-working-fg: #214da6;
--rd-warning-bg: #fff3cc;
--rd-warning-fg: #664900;
--rd-confirmed-bg: #dff8ef;
--rd-confirmed-fg: #075b46;
--rd-error-bg: #fde8ed;
--rd-error-fg: #8c1d3d;
~~~

Keep product controls flat. The marketing sky gradient should not enter tables, forms, or receipts.

## Responsive behavior

### Wide desktop, 1440 px and above

- Full sidebar.
- Table and application detail may share the viewport.
- Four summary cards fit in one row.
- Material diff may use side-by-side columns.

### Desktop, 1024–1439 px

- Full or condensed sidebar based on available content width.
- Three summary cards plus wrapping fourth card.
- Application detail opens as a route if the list would fall below 520 px.
- Use a unified diff when either diff column falls below 360 px.

### Tablet, 768–1023 px

- Collapsed navigation rail or drawer.
- Two summary cards per row.
- Application list uses cards.
- Detail uses a full route.
- Filters wrap into a disclosure control.

### Mobile, below 768 px

- Bottom navigation.
- One summary card per row or a compact two-column grid when labels fit.
- No horizontally scrolling match carousel.
- Application cards replace tables.
- Detail and takeover use full-screen routes.
- Approval uses a safe-area-aware sticky action bar.
- Cached offline views are read-only.

### Compact mobile, below 480 px

- 20 px page gutters.
- 16–20 px card radius.
- Unified diffs.
- Definition lists for receipt metadata.
- Full-width primary actions.
- Minimum 44 by 44 CSS-pixel touch targets.

Use container queries for reusable modules. Breakpoints are fallbacks, not a reason to truncate essential information.

## Mobile approval pattern

The sticky bar must name the target:

~~~text
Example Co. · Customer Success Manager
[Review and approve]
~~~

The confirmation sheet shows:

- Company, role, and requisition.
- Changed field and file count.
- Missing decisions.
- Approval expiration.
- A plain statement that one approval affects one application.

If the device is offline, disable approval and explain that RoleDawn must verify the latest application version first.

## Component inventory

### Shared with marketing

- <code>MessageBubble</code>
- <code>StoryTimestamp</code>
- <code>RuleResultChip</code>
- <code>EvidenceSourceChip</code>
- <code>MaterialDiff</code>
- <code>ApprovalPrompt</code>
- <code>ApplicationReceipt</code>
- <code>StatusBadge</code>
- <code>EventTimeline</code>

### Product shell

- <code>AppShell</code>
- <code>DesktopSidebar</code>
- <code>MobileTabBar</code>
- <code>AppHeader</code>
- <code>AuthorityBar</code>
- <code>PauseAllControl</code>
- <code>MorningBrief</code>
- <code>QueueSummary</code>
- <code>ApplicationTable</code>
- <code>ApplicationCard</code>
- <code>ApplicationDetailPanel</code>
- <code>NeedsUserPanel</code>
- <code>TakeoverLauncher</code>
- <code>CareerVaultFactRow</code>
- <code>ReceiptViewer</code>
- <code>OfflineReadOnlyBanner</code>

Every data component requires loading, empty, stale, blocked, permission-denied, and error states.

## View-model contract

The interface should consume a stable server view model instead of rebuilding workflow meaning from event text:

~~~typescript
interface ApplicationListItem {
  applicationId: string;
  version: number;
  company: string;
  role: string;
  location: string | null;
  requisition: string | null;
  source: {
    family: string;
    canonicalUrl: string;
    postedAt: string | null;
    checkedAt: string;
  };
  match: {
    hardRulesPassed: number;
    hardRulesTotal: number;
    explanationAvailable: boolean;
    unresolvedGapCount: number;
  };
  materials: {
    resumeVersion: string | null;
    answerSetVersion: string | null;
    materialChangeCount: number;
  };
  status: {
    code: string;
    label: string;
    nextAction: string | null;
    updatedAt: string;
  };
  approval: {
    state: "none" | "pending" | "approved" | "expired" | "invalidated";
    expiresAt: string | null;
  };
  receipt: {
    state: "none" | "reconciling" | "confirmed";
    confirmedAt: string | null;
  };
}
~~~

The server supplies labels and allowed actions from policy. The browser may format them but cannot invent authority.

## Empty, stale, and failure states

### Empty Today

~~~text
Nothing needs you right now.
RoleDawn is checking the searches you left active.
~~~

Show the next scheduled check and a link to Search.

### Stale source

~~~text
This posting has not been rechecked in 9 hours.
RoleDawn will not prepare or submit it until the source is fresh.
~~~

### Checking submission

~~~text
The connection dropped after Submit.
RoleDawn is checking the portal and confirmation inbox before any retry.
~~~

### CAPTCHA

~~~text
The portal asked for a CAPTCHA.
Twenty-three fields and both files are saved. Nothing was submitted.
~~~

### Expired approval

~~~text
This approval expired. Review the latest application before approving again.
~~~

## Accessibility

- Meet WCAG 2.2 AA.
- Add a skip link and semantic landmarks.
- Keep focus indicators at least 3:1 against adjacent colors.
- Use actual table markup on desktop.
- Keep row actions as named buttons, not clickable rows alone.
- Pair status color with icon and text.
- Give circular or numeric scores a complete textual explanation.
- Expose absolute timestamps alongside relative time.
- Trap focus inside dialogs and return it to the triggering control.
- Announce one meaningful state change through a polite live region. Do not stream internal activity.
- Support 200 percent zoom and 320 CSS-pixel reflow.
- Keep sticky controls clear of browser and PWA safe-area insets.
- Respect reduced motion.
- Do not autoplay a dashboard theme based on local time. The authenticated product follows the user's system theme or explicit setting.

## Motion and perceived speed

- Use 120–200 ms transitions for filters, panels, and status updates.
- Skeletons should preserve final layout.
- Do not animate rows into new positions while the user is reviewing an approval.
- When a state changes, preserve the row position and announce the update.
- Use a quiet progress indicator for Applying.
- Use a static label for Checking submission. Avoid a spinner that implies retry.
- Never pulse Confirmed.

## Instrumentation

Record workflow events by internal IDs without application answers or resume text:

- <code>dashboard_viewed</code>
- <code>attention_item_opened</code>
- <code>application_diff_opened</code>
- <code>approval_review_started</code>
- <code>approval_confirmed</code>
- <code>approval_expired</code>
- <code>takeover_started</code>
- <code>receipt_opened</code>
- <code>pause_all_used</code>
- <code>match_explanation_opened</code>

Measure whether users resolve Needs You items, inspect diffs, approve applications, and open receipts. Do not optimize the dashboard for raw time spent.

## Acceptance criteria

- Needs You appears above new matches.
- Authority and Pause are visible on every operating page.
- No bulk submission control exists.
- Match UI names passed rules and gaps.
- A confirmed state always links to receipt evidence.
- Reconciling never appears as failed or confirmed.
- Sensitive answers display structured source or live-user provenance.
- Desktop tables become semantic mobile cards.
- Approval names one company, role, and requisition.
- Offline views cannot approve.
- Every status includes text, icon, and next action.
- All components define empty, stale, blocked, and failure states.
- Marketing and product reuse the same approval, diff, and receipt components.
