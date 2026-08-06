---
title: Night-shift landing storyboard
status: superseded interaction study
owner: product and design
last_updated: 2026-08-06
decision_state: superseded by D-026 single-screen hero
---

# Night-shift landing storyboard

## Scope

This document records the earlier interactive day-to-night-to-day sequence. It is retained as workflow-story reference, but it no longer specifies the landing-page interaction.

> **Superseded on 2026-08-06:** Do not implement the sticky multi-screen stage, beat triggers, or 220-viewport-height scroll. D-026 compresses the same product truth into one original tactile panorama, one copy field, and a direct transition into the trust panel. The current specification is the [landing-page blueprint](landing-page-blueprint.md).

The sequence must make four facts clear:

1. The candidate sets the facts and rules.
2. RoleDawn prepares work in the cloud.
3. The candidate approves one named application.
4. RoleDawn shows a receipt only after confirmation.

The story is an explanation of the real workflow. It is not a claim that MVP applications submit while the candidate sleeps.

## Message hierarchy

### Stable semantic heading

Use one page-level heading:

> Your job search has a night shift.

Do not replace this heading in the accessibility tree as the scroll position changes.

### Visual story lines

The changing display copy is supporting text:

| Beat | Visual line | Product truth |
|---|---|---|
| Day | Set the rules. Keep your name in your hands. | The user controls facts, constraints, and authority |
| Night | A fresh role appeared. RoleDawn checked the fit. | Discovery and eligibility run in the cloud |
| Late night | The repeat work is done. Nothing has been sent. | Materials are prepared before approval |
| Dawn | Wake up to decisions, not tabs. | The queue brings the user only material decisions |
| Morning | Reply yes. Get the receipt. | Approval precedes submission and confirmation |

Apply the repository's evidence-bound writing policy to every future variation. Do not add “applies while you sleep” until the shipped authority model makes that statement accurate.

## Story arc

~~~mermaid
sequenceDiagram
    participant U as Candidate
    participant R as RoleDawn
    participant W as Workflow
    participant A as ATS

    U->>R: Set facts, search rules, and draft-only authority
    R->>W: Start continuous discovery
    W->>W: Find role, test rules, prepare evidence-bound materials
    W-->>R: Ready for review
    R-->>U: Morning approval request
    U->>R: Approve one named immutable application
    R->>W: Consume single-use approval
    W->>A: Fill and submit
    A-->>W: Confirmation evidence
    W-->>R: Confirmed receipt
    R-->>U: Receipt saved
~~~

## Beat specification

All role and company content in the prototype must carry an <code>Illustrative application</code> label. Use neutral fictional data until permissioned proof exists.

### Beat 1: Day

**Time:** 7:18 PM  
**Theme:** Cloud  
**Workflow state:** search active, draft-only  
**User question answered:** What do I give it?

Visual content:

- Search rule summary: role family, location, work mode, minimum salary, and daily cap.
- Career Vault source chips for the facts that may be used.
- Authority label: <code>Draft-only. Nothing can be submitted.</code>
- A short user message that starts the search.

Primary copy:

> Set the rules. Keep your name in your hands.

Supporting copy:

> RoleDawn uses the facts you approved and stops when a decision needs you.

Transition trigger: the rule summary locks, the message-thread line bends toward the horizon, and the page begins to darken.

### Beat 2: Night

**Time:** 11:47 PM  
**Theme:** Midnight  
**Workflow state:** discovered and fit scored  
**User question answered:** What happens after I leave?

Visual content:

- One role card enters from the horizon.
- Hard rules show explicit pass, fail, or needs-answer states.
- The posting time and source are visible.
- Match evidence lists supporting facts and gaps.

Primary copy:

> A fresh role appeared. RoleDawn checked the fit.

Example state:

~~~text
Customer Success Manager
Posted 8 minutes ago
Location: passed
Salary: passed
Level: passed
Travel: needs your call
~~~

Do not animate a fabricated count of scanned jobs or supported companies.

### Beat 3: Late night

**Time:** 12:03 AM  
**Theme:** Midnight with a coral horizon  
**Workflow state:** needs review  
**User question answered:** What work did it complete?

Visual content:

- A resume diff forms from Career Vault source chips.
- A short-answer draft appears beside its evidence.
- The application state reads <code>Ready for review</code>.
- A policy line states that nothing has been sent.

Primary copy:

> The repeat work is done. Nothing has been sent.

Trust line:

> Nothing invented. Nothing outside your rules.

The visual must not show a green success mark, receipt, or ATS confirmation in this beat.

### Beat 4: Dawn

**Time:** 7:05 AM  
**Theme:** Dawn Coral warming into First Light  
**Workflow state:** waiting for candidate approval  
**User question answered:** What needs me?

Visual content:

- A morning digest arrives in a message surface.
- The card names the company, role, requisition, changed fields, and unresolved travel answer.
- Actions are <code>Review</code>, <code>Edit</code>, and <code>Skip</code>.
- The detailed view shows the immutable pre-submit diff.

Primary copy:

> Wake up to decisions, not tabs.

Approval prompt:

~~~text
Approve Example Co. · Customer Success Manager,
requisition 1842, using Resume v7 and Answer Set v3?
This approval expires in 20 minutes.
~~~

The final approval control must name the application. A generic “Approve” button without nearby application context is insufficient.

### Beat 5: Morning

**Time:** 7:08 AM  
**Theme:** Cloud returns  
**Workflow state:** confirmed  
**User question answered:** How do I know it went out?

Visual content:

- The illustrative candidate approves the named application.
- The workflow advances through Applying and Checking submission.
- The receipt appears only after portal or email evidence exists.
- Signal Mint marks confirmation.

Primary copy:

> Reply yes. Get the receipt.

Receipt minimum:

~~~text
Confirmed
Example Co. · Customer Success Manager
Submitted at 7:08 AM
Seven fields · two files
Confirmation saved
Resume v7 · Answer Set v3 · Policy v2
~~~

The page returns to a stable day theme before the next landing section.

## Archived desktop stage

**Rejected implementation reference**

Everything in the archived desktop, mobile, component, and motion sections below describes the retired prototype. It is preserved only so the workflow narrative and accessibility lessons remain traceable. Do not turn these instructions into production tickets or code.

- The rejected prototype gave the story additional scroll distance.
- It kept one <code>100dvh</code> stage sticky while five beat triggers moved through normal flow.
- Use a twelve-column grid inside a 1280–1320 px container.
- Place the stable heading across seven columns and the application scene across five at entry.
- Let the application scene expand during the night beats while the supporting copy moves to the upper-left.
- Keep the primary and secondary calls to action in a stable location. Do not move them with every beat.
- Release the sticky stage after the morning receipt. The rest of the page uses normal document flow.

Suggested checkpoints:

| Scroll progress | Active beat |
|---:|---|
| 0–18% | Day |
| 18–42% | Night |
| 42–64% | Late night |
| 64–84% | Dawn |
| 84–100% | Morning |

Treat the percentages as prototype values. Tune them through user testing without changing the workflow order.

## Archived mobile stage

At widths below 768 px:

- Keep the semantic heading above the story.
- Use a vertical message-thread line as the timeline.
- Show one full-width scene at a time.
- Limit sticky behavior to a short sequence. If browser chrome or viewport changes cause jumps, render the beats as normal stacked cards.
- Keep the action area above the safe-area inset.
- Do not use horizontal scroll to move between story beats.
- Keep the source chips and diff readable without pinching or zooming.

At widths below 480 px:

- Use 20 px page gutters.
- Reduce scene radius to 20 px.
- Use a unified diff rather than side-by-side columns.
- Place receipt metadata in a definition list.
- Keep all actions at least 44 by 44 CSS pixels.

## Theme tokens

The story uses [RoleDawn brand tokens](../brand/brand-kit.md). Add neutral support tokens during implementation:

~~~css
--rd-surface: #ffffff;
--rd-border: #dde2ec;
--rd-night-surface: #151c33;
--rd-night-muted: #aeb7cc;
--rd-focus: #2f6fed;
~~~

Use two complete, contrast-safe foreground layers during the day-to-night transition. Crossfade the layers. Do not continuously interpolate one text color through an unsafe middle value.

Atmospheric gradients belong on the page background and horizon only. Buttons, chips, status badges, receipts, and form controls remain flat.

## Archived component composition

Build the sequence from reusable product components:

| Component | Required states |
|---|---|
| <code>NightShiftStory</code> | day, night, late-night, dawn, morning, reduced-motion |
| <code>StoryBeat</code> | inactive, entering, active, leaving |
| <code>StoryTimestamp</code> | absolute time plus accessible full date |
| <code>AuthorityBadge</code> | draft-only, per-application approval |
| <code>RuleResultChip</code> | passed, failed, needs answer |
| <code>EvidenceSourceChip</code> | verified, user-entered, restricted |
| <code>MaterialDiff</code> | loading, ready, invalidated |
| <code>ApprovalPrompt</code> | pending, expired, consumed, invalidated |
| <code>ApplicationReceipt</code> | reconciling, confirmed, corrected |
| <code>IllustrativeBadge</code> | always visible on fictional content |

Suggested state shape:

~~~typescript
type StoryBeatId = "day" | "night" | "late-night" | "dawn" | "morning";

interface NightShiftStoryState {
  activeBeat: StoryBeatId;
  reducedMotion: boolean;
  applicationState:
    | "draft-only"
    | "fit-scored"
    | "needs-review"
    | "awaiting-approval"
    | "applying"
    | "reconciling"
    | "confirmed";
  approvalVisible: boolean;
  receiptVisible: boolean;
}
~~~

The presentation state may animate. The application state must still follow the product state machine.

## Archived motion

- Interaction feedback: 120–200 ms.
- Story transitions: 500–800 ms.
- Move content no more than 16 px during a crossfade.
- Advance the displayed timeline once. Stop after the receipt appears.
- Animate opacity, transform, SVG horizon position, and a bounded color-layer crossfade.
- Avoid autoplay video, canvas, scroll hijacking, parallax depth, and continuous floating objects.
- Pause animation when the document is hidden.
- Never pulse Confirmed, Needs you, or Failed indefinitely.

### Reduced motion

When <code>prefers-reduced-motion: reduce</code> is active:

- Remove sticky positioning.
- Render all five beats as a chronological static list.
- Disable headline crossfades, horizon movement, timestamp animation, and automatic status progression.
- Preserve every fact and action in the same order.

## Accessibility

- Keep one stable <code>h1</code>.
- Mark decorative visual copy changes <code>aria-hidden="true"</code>.
- Provide a screen-reader-only static summary of the five beats.
- Do not attach <code>aria-live</code> to the marketing story.
- Use a semantic ordered list for the reduced-motion timeline.
- Give tabs, dialogs, and approval controls complete keyboard behavior.
- Do not use color alone for rule or workflow state.
- Keep text contrast at WCAG 2.2 AA throughout each transition frame.
- Reflow without two-dimensional page scrolling at 320 CSS px and 200 percent zoom.
- Label product figures and fictional data clearly.

## Performance budget

These are implementation requirements, not market claims:

- Render the heading, subhead, and calls to action without waiting for story JavaScript.
- Keep story-specific client JavaScript below 45 KB compressed where practical.
- Use HTML, CSS, and SVG instead of a background video.
- Reserve the scene's dimensions to prevent layout shift.
- Load below-fold sections with <code>content-visibility: auto</code>.
- Use <code>will-change</code> only while a beat is active.
- Avoid large animated blur filters.

## Analytics

Record product-learning events without message text, resume content, or candidate facts:

- <code>landing_story_started</code>
- <code>landing_story_beat_viewed</code> with beat ID
- <code>landing_story_completed</code>
- <code>landing_story_reduced_motion</code>
- <code>landing_primary_cta_clicked</code>
- <code>landing_application_demo_opened</code>
- <code>landing_receipt_inspected</code>

Do not treat scroll completion as buying intent. The meaningful event is whether the visitor opens the application demo or starts the onboarding flow.

## Acceptance criteria

- The story remains accurate under the MVP approval policy.
- A reviewer can identify the workflow state in every beat.
- No receipt appears before confirmation evidence.
- No generic approval can affect multiple applications.
- All fictional content is labeled illustrative.
- The page completes the same narrative without motion.
- Day and night states pass contrast checks.
- The stage releases cleanly on desktop and does not trap mobile scrolling.
- The reusable components match their product counterparts.
- The page returns to Cloud before the next landing section.
