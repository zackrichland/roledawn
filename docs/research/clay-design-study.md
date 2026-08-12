---
title: Clay design study
status: research snapshot and transfer guidance
owner: product and design
last_updated: 2026-08-11
decision_state: adapt principles, not trade dress
---

# Clay design study

## Purpose

This study records what was verified on Clay's public homepage, explains why the page works, and translates the useful principles into an original RoleDawn system.

Use it with the [brand kit](../brand/brand-kit.md), [landing-page blueprint](../product/landing-page-blueprint.md), and [decision log](../execution/decision-log.md). It does not authorize copying Clay's artwork, compositions, customer marks, wording, or typography.

## Evidence status

### Verified

The following findings were observed live on 2026-08-06:

- The [official Clay homepage](https://www.clay.com/) uses a floating navigation shell; a tactile, full-bleed hero; two-column hero copy and calls to action; an early rounded proof mosaic; use-case tabs; large feature chapters; infrastructure and case-study proof; a learning/community mosaic; and a centered final call to action over a playful landscape.
- The large feature chapters resolve to a maximum width of approximately 1,216 px on the inspected desktop viewport and use approximately 48 px corner radii.
- Computed desktop typography used a Roobert variable face for the inspected text styles. The measurements are recorded below.
- [Displaay's official Roobert page](https://displaay.net/typeface/roobert/) identifies Roobert as a commercial typeface available through paid licensing.

These observations describe the inspected page state. They do not establish Clay's conversion rate, internal design tokens, responsive rules at every breakpoint, or permission to reuse any protected asset.

### Inference

- The page creates confidence through scale, tactile specificity, and repeated proof rather than dense explanation.
- The early mosaic lets visitors understand breadth while the later chapters slow down to explain one capability at a time.
- The page moves from aspiration to mechanism to proof, so technical credibility supports the human promise instead of leading it.
- Large rounded chapters behave like distinct rooms in one story. The repeated container size makes a long page feel coherent.

### Recommendation

RoleDawn should borrow the hierarchy, pacing, proof repetition, and tactile confidence. It should keep its own day-to-night-to-dawn narrative, palette, product states, copy, and object world. RoleDawn's evidence, approval, and receipt invariants remain more important than resemblance to any reference site.

## Verified page sequence

| Order | Verified Clay pattern | What the pattern does |
|---:|---|---|
| 1 | Floating navigation | Keeps the next action available without visually filling the canvas |
| 2 | Full-bleed tactile hero with two-column copy and calls to action | Pairs an emotional category statement with a concise mechanism and immediate product feel |
| 3 | Early rounded proof mosaic | Repeats product and social proof before the reader reaches detailed features |
| 4 | Use-case tabs | Lets multiple customer intents share one stable interaction pattern |
| 5 | Large 1,216 px-wide, 48 px-radius feature chapters | Gives each major capability a memorable, self-contained scene |
| 6 | Infrastructure and case studies | Adds operational credibility after the product desire is established |
| 7 | Learning and community mosaic | Shows that the product belongs to a wider practice and gives visitors another entry point |
| 8 | Centered final call to action over a playful landscape | Returns to emotion and ends with one clear action |

## Verified desktop typography

The values below are computed styles observed on the inspected desktop page, not a published Clay design specification.

| Role | Family | Size / line height | Weight | Letter spacing |
|---|---|---:|---:|---:|
| Body | `Roobertvf` | 16 px / 24 px | 400 | Normal in the inspected style |
| H1 | `Roobertvf` | 88 px / 88 px | 575 | -3.52 px |
| H2 | `Roobertvf` | 72 px / 72 px | 500 | -2.16 px |
| H3 | `Roobertvf` | 48 px / 48 px | 500 | -1.92 px |
| Hero paragraph | `Roobertvf` | 24 px / 31.2 px | 400 | Normal in the inspected style |

### Licensing boundary

**Recommendation:** Do not copy, bundle, reference, or ship Roobert font files without a license that covers the intended web and product use.

RoleDawn should ship **Manrope through `next/font`** as the current licensed-safe near-match. Keep the family behind one token so a properly licensed Roobert build can be tested later without rewriting components.

```css
:root {
  --font-sans: var(--font-manrope);
  --font-mono: var(--font-plex-mono);
}
```

**Recommendation:** Preserve the observed hierarchy without treating desktop pixels as fixed across breakpoints:

| RoleDawn token | Desktop target | Responsive behavior |
|---|---:|---|
| Display 1 | 88/88, weight 575, tracking -0.04em | Clamp from 52 px to 88 px and protect 200% text zoom |
| Display 2 | 72/72, weight 500, tracking -0.03em | Clamp from 44 px to 72 px |
| Display 3 | 48/48, weight 500, tracking -0.04em | Clamp from 32 px to 48 px |
| Lead | 24/31.2, weight 400 | Clamp from 19 px to 24 px |
| Body | 16/24, weight 400 | Keep at 16 px minimum |

If RoleDawn later licenses Roobert, compare it with Manrope for readability, loading, language coverage, and conversion before changing the token. A license does not justify copying Clay's layout or identity.

## RoleDawn transfer map

| Clay principle | RoleDawn translation | Required difference |
|---|---|---|
| Floating navigation | Compact floating rail with brand, four anchors, sign-in, and `Text RoleDawn` | Use RoleDawn geometry, colors, type, and controls |
| Tactile full-bleed hero | A night-work landscape where evidence cards move toward the Queue at dawn | No Clay objects, artwork, background, or customer marks |
| Two-column hero copy | Human dream on the left; mechanism, calls to action, and launch guardrail on the right | Lead with the candidate's morning, not a generic growth claim |
| Early proof mosaic | Evidence source, immutable approval, safe pause, and confirmation tiles | Use illustrative product proof until real outcome evidence exists |
| Use-case tabs | `Wake to a ready queue`, `Approve by text`, `Know what went out` | Use accessible tabs tied to real RoleDawn states |
| Large feature chapters | Career Vault, Queue, and Application Receipt in 1,216 px max-width chapters with 48 px radii | Keep the midnight/coral/yellow/mint story and original compositions |
| Infrastructure proof | Three concrete breadcrumbs about provenance, approval scope, and ATS confirmation | Do not publish architecture theater or unsupported scale claims |
| Case studies | Consent-backed candidate stories labeled by application, reply, interview, offer, or hire | Never borrow company marks or blur outcome types |
| Learning/community mosaic | RoleDawn guides, office hours, safety notes, and Pulse research when those assets exist | Label planned content and do not invent a community |
| Playful final landscape | A quiet dawn horizon assembled from RoleDawn product objects | End with the user's next morning and one clear action |

## Original tactile object world

### Recommendation

Build a small object vocabulary from RoleDawn's product contract:

- **Evidence cards:** matte index-card slabs with a source edge, fact state, and allowed-use chip.
- **Approval seal:** a coral control with `YES`, `EDIT`, and `SKIP`; it is visibly bound to one named role.
- **State rail:** a midnight track with one First Light bead moving from match to approval to confirmation.
- **Receipt ribbon:** a mint confirmation strip carrying the company, role, timestamp, filenames, and evidence mark.
- **Safe-pause block:** a raised neutral object labeled `Needs you`, used for CAPTCHA, work authorization, or an unresolved field.
- **Morning queue:** a shallow tray that holds a small number of verified applications rather than an endless pile.

Use soft physical depth, quiet shadows, and clear material contrast. Do not use glassmorphism, floating AI orbs, robot mascots, Clay's object silhouettes, or decorative volume counters.

## Human-first copy grammar

### Recommendation

Each chapter should follow this sequence:

1. **Human dream:** Name the life or feeling the candidate wants.
2. **Current tension:** Name the repeated work or risk without dramatizing it.
3. **Product action:** State exactly what RoleDawn does.
4. **Visible proof:** Show the evidence, approval, state, or receipt.
5. **Candidate choice:** End with what the user can approve, edit, skip, pause, or inspect.

Example:

> **Wake up to applications you're proud to send.**
>
> RoleDawn turns your experience, rules, and fresh openings into a verified morning queue. Review by text, approve one role at a time, and keep the receipt.

The dream comes first, but it cannot outrun the product. Avoid “land your dream job,” guaranteed outcomes, passive autopilot claims, or invented relief.

## Technical breadcrumbs

### Recommendation

Use two or three of these on the landing page. Keep the architecture corpus for deeper detail.

1. **Provenance-linked Career Vault:** every material application claim resolves to an approved source.
2. **Single-use approval:** one approval is bound to one role and one immutable pre-submit diff; a changed application requires a new approval.
3. **Adapter plus receipt:** deterministic ATS adapters perform known steps, then portal or email evidence confirms the result before the application becomes `Confirmed`.

Do not lead the hero with Temporal, Fargate, PostgreSQL, model names, browser vendors, queues, or vector databases.

## Proof repetition plan

### Recommendation

Repeat the same trust contract at increasing depth:

| Placement | Proof shown | Claim limit |
|---|---|---|
| Hero | One source chip, one approval, one confirmation strip | Illustrative workflow only |
| Early mosaic | Evidence, safe pause, approval scope, receipt anatomy | Product behavior supported by the prototype/specification |
| Feature chapters | Reusable Career Vault, Queue, and Receipt components | No production performance claim without measured data |
| Infrastructure/case-study chapter | System breadcrumb or consent-backed outcome | Label source, sample, date, and outcome type |
| Final call to action | Draft-only start and candidate control | No unattended-submission promise during MVP |

Employer logos remain absent until the consent and evidence gate in the [brand kit](../brand/brand-kit.md) is operational.

## Responsive and accessibility guidance

### Recommendation

- Let the floating navigation become a compact bar or accessible menu; it must not cover headings at 200% zoom.
- Stack the hero copy before the tactile scene on narrow screens. Keep the primary call to action above the fold without hiding the launch guardrail.
- Reduce 48 px chapter radii below tablet widths rather than preserving oversized curves on a small canvas.
- Implement use-case tabs with complete keyboard behavior, visible focus, and a non-tab chronological fallback.
- Build product proof from HTML and SVG where practical. Provide text alternatives for any rendered object scene.
- Preserve the page meaning with motion disabled. The state rail can show all stages without animation.
- Keep First Light with Midnight text and validate every foreground/background pair against WCAG 2.2 AA.

## Trade-dress boundary

### Recommendation

RoleDawn must not reproduce:

- Clay's artwork, illustrations, tactile objects, landscapes, screenshots, or customer marks.
- Clay's exact navigation shell, hero composition, proof-mosaic layout, tab styling, chapter compositions, or final scene.
- Clay's copy, case studies, labels, claims, calls to action, or content order without independent RoleDawn rationale.
- Roobert font files or a Roobert-identical fallback stack without the required license.
- Color, motion, and geometry combinations that make the page plausibly mistaken for Clay.

The implementation should still read as RoleDawn if every reference to Clay is removed from the internal brief.

## Review checklist

- The hero leads with the candidate's desired morning and states the draft-only launch boundary.
- The first viewport contains a real RoleDawn product state, not an abstract agent claim.
- Proof appears in the hero, early mosaic, and feature chapters without inventing outcomes.
- Career Vault, Queue, and Application Receipt use the canonical product terms.
- The page contains only two or three technical breadcrumbs.
- Manrope is the shipped sans family unless a valid Roobert license and migration decision are recorded.
- The page remains recognizable without Clay's palette, objects, customer marks, copy, or compositions.
- Employer outcomes remain gated by consent, evidence, date, sample, and exact outcome type.
- Local links resolve and Markdown fences are balanced.
