---
title: Viktor design study
status: research snapshot and transfer guidance
owner: product and design
last_updated: 2026-08-11
decision_state: use as visual reference, not as a template
---

# Viktor design study

## Purpose

This study explains why Viktor's landing page feels polished, which principles can transfer to RoleDawn, and which visual and verbal signatures must remain Viktor's.

The page implementation should use RoleDawn's [brand kit](../brand/brand-kit.md), [landing-page blueprint](../product/landing-page-blueprint.md), and [dashboard specification](../product/dashboard-and-responsive-experience.md). This document does not authorize copying Viktor's assets, layouts, language, or identity.

## Evidence status

### Verified official sources

As reviewed on 2026-08-06:

- The [official Viktor homepage](https://viktor.com/) presents Viktor through oversized declarative headlines, messaging-workspace demonstrations, saturated product scenes, step cards, comparison states, proof bands, and repeated calls to action.
- The [official Viktor brand guidelines](https://viktor.com/brand) publish the logo rules, brand palette, typography, voice, and mockup guidance. The official colors are Peach <code>#FFBD9E</code>, Lilac <code>#947FFF</code>, Violet <code>#6748FD</code>, Navy <code>#150079</code>, Soft-black <code>#1B182A</code>, and White <code>#FFFFFF</code>. The listed typefaces are Ulm Grotesk Bold for display work and Gellix Medium for body copy.

These are Viktor's published choices. They are not RoleDawn tokens.

### User-provided observations

The user supplied five Viktor screenshots captured on 2026-08-06:

- <code>Screenshot 2026-08-06 at 1.40.15 PM.png</code>
- <code>Screenshot 2026-08-06 at 1.40.22 PM.png</code>
- <code>Screenshot 2026-08-06 at 1.40.29 PM.png</code>
- <code>Screenshot 2026-08-06 at 1.40.33 PM.png</code>
- <code>Screenshot 2026-08-06 at 1.40.37 PM.png</code>

The screenshots are visual references supplied by the user. They do not establish Viktor's implementation details, conversion performance, or current behavior beyond the captured page state.

## What is visible

### Hero and navigation

**Observed**

- A warm, nearly white page supports a floating navigation shell with broad spacing and rounded lower corners.
- The first headline is very large and short. A saturated gradient marks the second phrase.
- The hero splits its argument across two columns: category claim on the left, explanation and calls to action on the right.
- A messaging-workspace simulation begins inside an oversized rounded frame below the copy.
- Product proof appears in the first viewport rather than after a long explanation.

**Inference**

- The scale makes the company feel confident before the reader evaluates the details.
- The workspace scene makes a broad agent claim concrete.
- The quiet background gives the saturated product frame more weight.

### Section rhythm

**Observed**

- The page alternates large editorial statements with product demonstrations.
- A dark navy proof band creates a strong visual break between cream sections.
- Feature cards repeat a two-part structure: a vivid scene above concise copy.
- Small eyebrow labels orient the reader without competing with the headline.
- Generous vertical spacing keeps dense product claims from feeling crowded.

**Inference**

- Repeated geometry creates consistency while the content changes.
- Each section answers one question, which reduces the effort needed to scan the page.
- The dark band resets attention and makes the next light section feel new.

### Product scenes

**Observed**

- The scenes use familiar software surfaces, file outputs, status marks, and connected-tool icons.
- Saturated violet-to-navy fields hold the visual action.
- The product appears to deliver an artifact or finished result, not a conversational paragraph.
- Rounded white objects float over the gradient field with restrained shadows.

**Inference**

- Finished artifacts carry more commercial weight than abstract agent diagrams.
- Familiar interface fragments shorten the time required to understand the product.
- The scenes work because each shows one completed job rather than a collage of capabilities.

### Comparison and onboarding

**Observed**

- A tab row changes the use case shown in a side-by-side comparison.
- The comparison contrasts a short description with a finished output.
- Onboarding is reduced to three visual steps.
- Each step uses the same card anatomy and a numbered marker.

**Inference**

- The comparison supports category creation by showing the behavioral difference.
- The onboarding cards lower perceived setup cost.
- A repeated visual grammar makes the sequence feel operational instead of conceptual.

## Why the design works

**Recommendation:** Transfer these principles.

1. Put a real product state in the first screen.
2. Keep one argument per section.
3. Show output, state, and proof rather than decorative agent imagery.
4. Use large type for the main idea and quiet copy for the mechanism.
5. Repeat a small component vocabulary across marketing and product.
6. Create one or two strong visual transitions instead of animating every section.
7. Show how the user starts, what the system does, where the user decides, and what proof remains.

## What belongs to Viktor

RoleDawn should not reproduce:

- Viktor's official peach, lilac, violet, and navy gradient.
- Its wordmark, avatar, typography, logo treatment, or rounded navigation shell.
- The human-replacement category language built around an AI employee or hire.
- The same hero split, four-card grid, comparison composition, or three-card onboarding layout.
- Its messaging mockups, icon arrangements, screenshots, illustrations, or written examples.
- Its rating, customer-logo, integration, adoption, or outcome claims.
- Its exact call-to-action phrasing or section headlines.

The [official brand guidelines](https://viktor.com/brand) explicitly define Viktor's palette, typography, avatar, wordmark, and usage rules. Those details provide a clear boundary for independent RoleDawn work.

## RoleDawn transfer map

| Viktor principle | RoleDawn interpretation | Required difference |
|---|---|---|
| Oversized category headline | “Your job search has a night shift.” | Use Instrument Sans and RoleDawn's own time-based story |
| Product in the hero | One application moves from match to receipt | Show evidence, approval, and confirmation rather than a workspace chat |
| Saturated product scenes | Midnight field warming into dawn | Use Midnight, Dawn Coral, First Light, and Signal Mint |
| Finished output | Application Receipt | Show field, file, version, timestamp, and confirmation evidence |
| Simple onboarding | Truth, rules, queue, receipt | Use four steps because approval is a separate product promise |
| Use-case tabs | Fresh match, resume change, needs your answer, confirmed | Use accessible tabs and application-specific states |
| Dark proof band | Night-work sequence | Do not place unverified employer logos in the band |
| Human approval | Single-use application approval | Name the role, immutable diff, expiration, and authority |

## RoleDawn's visual position

**Recommendation**

RoleDawn should feel like a calm operator at dawn:

- Editorial enough to make the promise memorable.
- Operational enough to make each state believable.
- Warm enough for a stressful consumer decision.
- Precise enough to protect the candidate's name.

The design should not look like a student job board, enterprise ATS, chatbot, or neon agent demo.

## Palette boundary

Viktor's official system runs from warm peach through violet into navy. RoleDawn uses a different story and a different set of colors:

| RoleDawn token | Value | Use |
|---|---:|---|
| Midnight | <code>#0B1020</code> | Night field, primary text, dark controls |
| Cloud | <code>#F7F8FC</code> | Day canvas |
| Dawn Coral | <code>#FF6B5F</code> | Horizon and focused emphasis |
| First Light | <code>#FFD166</code> | Primary CTA with Midnight text |
| Signal Mint | <code>#85E0C5</code> | Confirmed and safe states |
| Slate | <code>#667085</code> | Secondary text and neutral states |
| Error Rose | <code>#E0526F</code> | Blocked and destructive states |

Use gradients only for large atmosphere. Keep controls, receipts, diffs, and status surfaces flat.

## Composition guidance

### Marketing

- Use a simple edge-to-edge header rather than a rounded floating container.
- Let the first application story span the full hero instead of copying a static left-right split.
- Use asymmetric grids for evidence, approvals, and receipts.
- Keep cards at 20–24 px radius. Reserve larger radii for framed product scenes.
- Use quiet one-pixel borders and restrained shadows.
- Treat IBM Plex Mono timestamps and evidence references as a recognizable product texture.

### Product

- Reuse the actual message, diff, status, and receipt components inside marketing scenes.
- Label fictional states as illustrative.
- Avoid decorative charts when the product cannot support the number shown.
- Show one named decision and one next action at a time.

## Accessibility risks seen in the references

**Observed risks**

- Small pale text appears over saturated gradients.
- Some visual states rely heavily on color.
- Very large headlines could overflow under text zoom.
- Tab controls require complete keyboard and screen-reader behavior.
- Product screenshots can become inaccessible if shipped as unlabeled images.

**Recommendation**

- Test every transition frame against WCAG 2.2 AA.
- Use text and icons alongside color for status.
- Keep the semantic page heading stable while decorative story text changes.
- Build product scenes from HTML and SVG where practical.
- Provide a static chronological alternative for reduced motion.
- Ensure the layout reflows at 320 CSS px and 200 percent zoom.

## Design review checklist

- The page is recognizable without Viktor's colors, typography, layout, avatar, or words.
- The first screen shows an application state, not a decorative agent.
- Every fictional company, role, metric, and receipt is labeled illustrative.
- Employer proof is absent until consent and evidence exist.
- The night sequence stops before submission unless a user approval is shown.
- Status, approval, and confirmation use the same terms as the product state machine.
- Product components remain legible in day and night themes.
- The page still explains the product when motion is disabled.
