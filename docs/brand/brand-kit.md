---
title: RoleDawn brand kit
status: working brand, pending legal clearance and user testing
last_updated: 2026-08-11
---

# RoleDawn brand kit

Working visual board: [editable SVG](../../assets/brand/role-dawn-brand-board.svg) · [PNG preview](../../assets/brand/role-dawn-brand-board.png)

Implementation references: [Clay design study](../research/clay-design-study.md) · [Viktor design study](../research/viktor-design-study.md) · [landing-page blueprint](../product/landing-page-blueprint.md) · [dashboard and responsive experience](../product/dashboard-and-responsive-experience.md).

**Verified:** Clay and Viktor provide useful public references for hierarchy, proof, pacing, and finished product scenes.

**Recommendation:** Treat both as principle references only. RoleDawn retains its own palette, type implementation, compositions, tactile objects, language, and authority-centered product grammar. Do not reuse their artwork, customer marks, typography files, or trade dress.

## Name

**RoleDawn** is the recommended working name.

It makes the mechanism legible: progress begins before the candidate wakes. It can grow beyond application submission into recruiter replies, interview preparation, and career operations without becoming a generic “hire” or “apply” utility.

### Preliminary clearance snapshot

On 2026-08-06, exact-name web and USPTO searches found no obvious commercial or exact federal wordmark match, and `.com`, `.ai`, `.app`, and `.co` returned no RDAP registration record. This is not legal clearance or a reservation. Domain status can change immediately. Counsel should search confusingly similar marks, common-law use, state records, app stores, and likely classes including 9, 35, and 42 before use.

## Verbal system

- **Tagline:** Your job search has a night shift.
- **One-line pitch:** RoleDawn finds fresh roles, builds evidence-backed applications, asks for your approval by text, and shows exactly what went out.
- **Durable trust line:** Nothing invented. Nothing outside your rules.
- **Launch-only approval line:** Nothing submitted without your approval.
- **Category:** Career agent or job-application agent.

## Product language

| Product concept | Customer-facing name |
|---|---|
| Canonical evidence store | Career Vault |
| Human-in-the-loop worklist | Queue |
| Verified record of a submission | Application Receipt |
| Recruiter correspondence | Inbox |
| Preferences, constraints, and authority | Rules |
| Aggregate research product | RoleDawn Pulse |

Keep internal specialist agents invisible. The user deals with one accountable operator.

## Personality

RoleDawn is a calm operator, sharp editor, and source of dry relief. It is awake, precise, and respectful of the candidate's name.

It sounds like:

- “Stripe posted a Solutions Engineer role 11 minutes ago. It matches 8 of your 10 rules. The gaps are payments experience and weekly travel.”
- “I changed three resume bullets. Every claim came from your Career Vault. Reply YES, EDIT, or SKIP.”
- “Workday asked for a CAPTCHA. Your answers and files are saved.”
- “No reply after ten days. Want me to draft a follow-up?”

It does not sound like:

- “Revolutionize your career journey.”
- “Unlock your dream job with cutting-edge AI.”
- “Sit back while our magic agent guarantees interviews.”
- A human pretending to feel emotions it cannot feel.

## Voice rules

1. Start with the fact or decision.
2. Name the role, company, time, constraint, or changed field.
3. Say what is known, what is uncertain, and what needs the user.
4. Prefer one useful sentence to three atmospheric ones.
5. Never hide failure behind “still working.”
6. Never add invented specificity to sound human.
7. Use “AI” only when the technology itself is the subject.

The customer-facing writing pipeline should apply an internally implemented no-slop policy: preserve genuine voice and concrete evidence, remove generic filler and fake-profound conclusions, and stop when evidence runs out. The product must not redistribute an external skill verbatim without permission.

## Color

| Token | Hex | Role |
|---|---|---|
| Midnight | `#0B1020` | Primary dark field, wordmark, high-contrast text |
| Cloud | `#F7F8FC` | Main light background |
| Dawn Coral | `#FF6B5F` | Warm accent, sunrise moments, progress |
| First Light | `#FFD166` | Primary CTA background with Midnight text |
| Signal Mint | `#85E0C5` | Confirmed, safe, receipt, success |
| Slate | `#667085` | Secondary text and neutral status |
| Error Rose | `#E0526F` | Blocked, destructive, or error states |

Accessibility rules:

- Use First Light with Midnight text, not white.
- Keep Dawn Coral out of small body copy.
- Do not rely on color alone for application status.
- Validate every shipped pair against WCAG AA.

## Typography

- **Manrope through `next/font`:** display, body, interface, and marketing copy.
- **IBM Plex Mono:** timestamps, field diffs, receipts, IDs, and status logs.

**Verified:** The inspected Clay desktop page used computed `Roobertvf` styles at 88/88 for H1, 72/72 for H2, 48/48 for H3, 24/31.2 for its hero paragraph, and 16/24 for body text. [Displaay identifies Roobert as a commercial typeface](https://displaay.net/typeface/roobert/).

**Recommendation:** Do not copy or ship Roobert without a license that covers RoleDawn's intended use. Manrope is the licensed-safe near-match for the current implementation. Keep the family tokenized as `--font-sans` so a properly licensed face can be tested later without rewriting components.

| Token | Desktop target | Responsive rule |
|---|---:|---|
| Display 1 | 88/88, weight 575, tracking -0.04em | Clamp from 52 px to 88 px |
| Display 2 | 72/72, weight 500, tracking -0.03em | Clamp from 44 px to 72 px |
| Display 3 | 48/48, weight 500, tracking -0.04em | Clamp from 32 px to 48 px |
| Lead | 24/31.2, weight 400 | Clamp from 19 px to 24 px |
| Body | 16/24, weight 400 | Keep at 16 px minimum |

Use generous line height, sentence-case labels, and a restrained weight range. The design should feel fast because the hierarchy is clear, not because everything is bold. Protect heading wrap at 320 CSS px and 200 percent text zoom.

## Reference translation

**Inference:** Clay's page feels confident because a human aspiration appears before the mechanism, tactile proof arrives early, and later chapters repeat one stable geometry. The effect comes from hierarchy and pacing, not any one decorative object.

**Recommendation:** Translate that principle into RoleDawn as follows:

- Use a compact floating navigation rather than Clay's exact shell.
- Lead the hero with the candidate's desired morning, then explain the verified queue and single-application approval.
- Repeat proof in the hero, an early mosaic, and the feature chapters.
- Give Career Vault, Queue, and Application Receipt separate chapters up to 1,216 px wide with 48 px desktop radii.
- Use two or three technical breadcrumbs about provenance, approval scope, and confirmation evidence. Keep infrastructure names in technical documentation.
- End with a quiet RoleDawn dawn landscape and one call to action, not Clay's scenery or composition.

## Visual grammar

- A dark page warming toward dawn as the user scrolls.
- Timestamps moving from late night to morning.
- A message-thread line bending into a horizon or sunrise arc.
- Crisp receipts, before/after diffs, source chips, and status labels.
- Real product surfaces with redacted or illustrative data clearly labeled.
- A tactile, full-bleed hero built from RoleDawn evidence, approval, queue, and receipt objects.
- An early rounded proof mosaic followed by a small set of large feature chapters.

Avoid robot mascots, briefcases, floating orbs, glassmorphism, galaxies, neon “AI” gradients, and generic stock photos of relieved candidates.

## Tactile object world

**Recommendation:** Use a small original vocabulary instead of borrowed illustrations:

- **Evidence card:** matte index-card slab with a visible source edge and allowed-use chip.
- **Approval seal:** coral `YES / EDIT / SKIP` control bound to one named role.
- **State rail:** midnight track with one First Light bead moving toward confirmation.
- **Receipt ribbon:** mint strip with company, role, timestamp, filenames, and confirmation mark.
- **Safe-pause block:** neutral raised object labeled `Needs you` for CAPTCHA or a sensitive answer.
- **Morning queue:** shallow tray holding a bounded set of verified applications.

Use restrained physical depth and quiet shadows. Do not recreate Clay's objects, landscape, screenshots, tab styling, or customer proof.

## Logo direction

The wordmark remains primary. The icon is a single continuous form: a message-bubble tail becomes a horizon line, with a small rising dot. It should still read at 16 px and in one color. Do not use a literal sun with rays, owl, robot, or suitcase.

## Motion

- Status transitions should be immediate and quiet.
- The hero timeline may advance from 11:47 p.m. to 12:03 a.m. once, then stop.
- Use a soft horizon reveal, not a continuous glow or parallax spectacle.
- Honor reduced-motion preferences.

## Brand proof standard

Employer social proof is divided into:

- **Interviewed at**
- **Offered by**
- **Hired at**

Each logo requires candidate consent, outcome evidence, and a non-endorsement presentation. Before those records exist, use operating metrics—submission confirmation rate, median time from posting to approval, edit rate—with sample size and date.

## Alternate-name fallback

If RoleDawn fails legal or customer testing, reopen the shortlist in this order: RoleNest, CandidLane, ApplyDawn, RoleWake. Do not commit money to visual identity before clearance.
