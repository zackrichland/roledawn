---
board: <id>                 # lowercase file name without .md
status: unsupported         # supported | fills-only | prep-only | unsupported (see README)
difficulty: medium          # easy | medium | hard (see README)
last_verified: YYYY-MM-DD   # date the facts below were last checked
url_patterns:
  - <host>/<path pattern that identifies this board>
---

# <Board name>

Compact agent context: `BOARD_CONTEXT.<id>` in [board-agent-context.ts](../../src/domain/board-agent-context.ts). Add the board there (unverified until an adapter exists) in the same change as this file.

<!--
Rules for filling this template (from AGENTS.md):
- Label anything not obvious as Verified, Inference, Recommendation, Hypothesis,
  Open question, Vendor claim, Community or Unverified.
- Every external claim needs a primary URL in Sources with an access date.
- Never invent market share, customers, limits, capabilities or outcomes.
- Keep 80-180 lines. Bullets over prose.
-->

## Recognize it

- URL patterns, hosts and redirects:
- Embed patterns on employer career sites:
- Page markers (DOM ids, data attributes, script hosts):
- Public job APIs (documented or not; say which):

## Application flow

1. <first step a person sees>
2. ...
- Single page or multi-step:

## Accounts and sign-in

- Account required:
- Per-employer (tenant) accounts:
- Email verification or one-time codes:
- SSO / "Apply with LinkedIn/Indeed":

## Documents and parsing

- Résumé upload and accepted types/size:
- Parse-and-autofill behavior:
- Cover letter:

## Questions and widgets

- Typical custom questions:
- EEO / voluntary self-identification:
- Dropdown, multi-select, date and typeahead widgets:
- Repeating sections (work history, education):

## Verification and anti-bot

- CAPTCHA provider and when it appears:
- Emailed codes, rate limits, bot detection, honeypots:
- RoleDawn never solves CAPTCHAs.

## Submission and proof

- Final request and response that prove submission:
- Confirmation page:
- Confirmation email (subject/sender, if known):

## Known quirks

- One dated line per lesson: `YYYY-MM-DD: <what the page did>; <what the agent should do> (evidence: ...)`. Promotion rules: [README](README.md#how-to-add-a-lesson).

## RoleDawn status and gaps

- Status today, with repository evidence (file paths, decision IDs):
- Gaps:

## Agent guidance

Do:
-

Don't:
- Solve, click or wait out a CAPTCHA; stop on any visible challenge.
- Invent an answer, date, employer, title or sensitive fact.

## Sources

- <URL> — <what it supports> (Primary / Vendor claim / Community / Direct observation), accessed YYYY-MM-DD
