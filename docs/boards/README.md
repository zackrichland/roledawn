---
title: ATS board templates
status: active
last_updated: 2026-09-30
---

# ATS board templates

One file per applicant tracking system (ATS). Each file tells the form agent how to recognize the board, how its application works, where automation breaks, and what RoleDawn may do there. The database, worker code and delivery policies are the source of truth. When a template and the code disagree, the code wins and the template gets corrected.

## Index

| Board | Recognize it by | RoleDawn status | Difficulty | File |
|---|---|---|---|---|
| Greenhouse | `job-boards.greenhouse.io/<board>/jobs/<id>`, `boards.greenhouse.io`, `?gh_jid=`, `#grnhse_app` | supported (US) | medium | [greenhouse.md](greenhouse.md) |
| Lever | `jobs.lever.co/<site>/<uuid>/apply`, `#application-form` | fills-only | medium | [lever.md](lever.md) |
| Ashby | `jobs.ashbyhq.com/<org>/<uuid>/application`, `?ashby_jid=` | fills-only | medium | [ashby.md](ashby.md) |
| Workday | `<tenant>.wd<N>.myworkdayjobs.com/<site>/job/...`, `data-automation-id` | unsupported | hard | [workday.md](workday.md) |
| iCIMS | `<prefix>-<company>.icims.com/jobs/<id>/<slug>/job`, `in_iframe=1` | unsupported | hard | [icims.md](icims.md) |
| SmartRecruiters | `jobs.smartrecruiters.com/<Company>/<id>-<slug>`, "I'm interested" | unsupported | medium | [smartrecruiters.md](smartrecruiters.md) |
| Jobvite | `jobs.jobvite.com/<company>/job/<id>`, `app.jobvite.com/j?cj=` | unsupported | medium | [jobvite.md](jobvite.md) |
| BambooHR | `<company>.bamboohr.com/careers/<id>` | unsupported | easy | [bamboohr.md](bamboohr.md) |
| Oracle Recruiting Cloud and Taleo | `*/hcmUI/CandidateExperience/...`, `*.taleo.net/careersection/...`, `*.tbe.taleo.net` | unsupported | hard | [oracle-recruiting-cloud.md](oracle-recruiting-cloud.md) |
| SAP SuccessFactors | `rmkcdn.successfactors.com` assets, apply on `career<N>.sapsf.com/careers?company=` | unsupported | hard | [successfactors.md](successfactors.md) |
| Workable | `apply.workable.com/<account>/j/<shortcode>/` | unsupported | medium | [workable.md](workable.md) |

## Status values

| Value | Meaning |
|---|---|
| `supported` | A delivery adapter fills, submits once, and has at least one live, employer-confirmed receipt. |
| `fills-only` | An adapter exists, but no live confirmed submission. Treat any submit on this board as unproven. |
| `prep-only` | RoleDawn prepares documents and answers; the candidate submits on the employer's site. |
| `unsupported` | No intake and no adapter. A pasted link is refused with `ATS_UNSUPPORTED` (`src/server/ingestion/job-reference.ts`), so nothing is prepared. Never open the form with candidate data. |

The status is documentation, not permission. Delivery authority comes from `ATS_DELIVERY_CAPABILITIES` and `parseAutopilotDestination` in `src/domain/application-autopilot-eligibility.ts` plus the database's single-use submit approval.

**Difficulty** is an engineering estimate (Inference), not a measurement: `easy` = one page, no account, native controls; `medium` = one page with custom widgets, parser side effects, or a passive CAPTCHA or emailed code; `hard` = per-employer accounts, email verification, multi-step wizards, repeating sections, or heavy tenant variation.

## How an agent uses a template

1. Match the final URL (after redirects) against `url_patterns`, then confirm with the page markers under **Recognize it**. If nothing matches, or two boards match, stop and report the board as unrecognized.
2. Read `status`. Only `supported` and `fills-only` boards have a delivery adapter; `prep-only` stops after documents; `unsupported` boards are templates for future adapters, not permission to act.
3. Read **Agent guidance**, **Known quirks** and **RoleDawn status and gaps** before touching the page. The gaps list the controls that stop a send. The form agent's prompt carries a short extract of them ([compact agent context](#compact-agent-context)); the template stays the full reference.
4. Treat every fact as dated (`last_verified`). Vendor claims are claims. If the live page contradicts the template, trust the page, stop before any side effect, and record the drift.
5. Apply the rules below on every board, whatever the template says.

## Rules on every board

- Never solve, click, refresh or wait out a CAPTCHA. Stop on any visible challenge and hand over.
- Never invent an answer. Names, contact details, employers, titles, dates, authorization and demographic answers come only from approved candidate records. Other questions come from the candidate's remembered or standing answers (D-112, D-117). Anything they don't cover goes to the candidate.
- Use the candidate's application email; employer codes and verification links go there.
- One sealed submission per named application. Reconcile an unknown outcome before any retry.
- Only the employer's own response is a receipt. A model never decides that an application went through.
- Never fill a honeypot field (for example Workday's `beecatcher` input).
- Never accept terms, privacy statements, legal disclaimers or data-consent gates for the candidate; present them and record the candidate's own decision. Decline non-essential cookies.
- Never use the candidate's social sign-in (Google, Apple, LinkedIn, Microsoft) or a vendor's employer API; those APIs need the employer's key.
- A draft, a profile, a talent-network sign-up or an unconfirmed application is not an application.
- Account-based boards (Workday, iCIMS, Oracle/Taleo, SuccessFactors): use the candidate's application email. Passwords are open decision O-012: the founder asked for one shared password, and the recommendation on record is a unique generated password per employer site, stored encrypted and viewable by the candidate ([decision log](../execution/decision-log.md)). **Not built:** today any password field hands over with `APPLICATION_FILL_ACCOUNT_LOGIN_TAKEOVER` (`src/server/workers/agents-browser-tools.ts`).

## Compact agent context

The templates are long. The form agent gets a short, reviewed extract of them on every send, so it stops repeating mistakes a board has already taught us ([founder directive 13](../execution/founder-directives.md)).

| Question | Answer |
|---|---|
| Where | `BOARD_CONTEXT`, typed constants keyed by board id, in [`src/domain/board-agent-context.ts`](../../src/domain/board-agent-context.ts). Not read from these files at run time, so Netlify bundling needs no `included_files`. |
| Size | At most 10 bullets and 900 characters (about 225 tokens) per board. One line per lesson. |
| Which boards reach a live prompt | Only boards with an entry in `ATS_DELIVERY_CAPABILITIES` (`greenhouse`, `lever`, `ashby`), when the send's destination passes `parseAutopilotDestination`. `deliveryStepInstructions` in `application-delivery-driver.ts` appends the section "What we've learned about <Board>". |
| Other boards | Each has an entry too, marked `unverified` and taken from its template, as the context path for a future adapter. It is never sent to a live prompt and never authorizes acting on an unsupported board. |
| Picking a board | `selectBoardContext(url)` maps a posting or apply URL to one board id (the shapes in each template's `url_patterns`). Delivery destinations reuse `parseAutopilotDestination`. Nothing or two matches returns null. |
| Authority | Advisory only. The notes never authorize a fill, upload, answer, click or submission, never change policy or approved facts, and lose to the live page: on any conflict the agent trusts the page and stops before any side effect. |

The notes are compiled-in constants, not a learned or database memory, so no employer page, model output or candidate value can write into a prompt, and every change is a reviewed diff.

## How to add a lesson

1. **Log it** as one dated line in the board file's **Known quirks**: `YYYY-MM-DD: <what the page did>; <what the agent should do> (evidence: <decision ID, test, or worker-event code>)`. Full detail stays here.
2. **Promote it** into `BOARD_CONTEXT` only if all hold: the agent can act on it at the field or widget level; it stopped or misled a real run, or repeated on a second application; it is **Verified** (a repo test, a live run or a decision row, not a vendor claim); it is not already a rule in [Rules on every board](#rules-on-every-board) or the base prompt; and it carries no values, candidate data, secrets or employer text.
3. **Fit the cap.** Add the bullet, then shorten or drop the least useful one. `src/domain/board-agent-context.test.ts` fails on more than 10 bullets or 900 characters, a missing or extra board file, a status that differs from the template's front matter, and secret or personal-data patterns. A section that breaks the cap is left out of the prompt rather than truncated.
4. **Retire it** in the same change that removes the cause (for example, a widget the driver now supports).
5. **Record it.** Add a [decision-log](../execution/decision-log.md) row when the lesson changes behavior or policy; the context itself never carries policy. Update `last_verified` and `reviewed`.

Worker stop reasons are lesson candidates. Each send records a static code and stage (D-116); read them with `npm run ops:status -- --app <id>`. When the same code appears twice on one board and the cause is page behavior, copy the code, board and date (never form values) into a Known quirks line and apply step 2.

When a board gains an adapter, change its `status` here, in its front matter, in `ATS_DELIVERY_CAPABILITIES` and in `BOARD_CONTEXT` together (the test compares them), then re-verify its bullets against the first live run.

## Maintaining these files

- Start from [_template.md](_template.md). Keep each file between 80 and 180 lines, bullets over prose.
- Label statements **Verified**, **Inference**, **Recommendation**, **Hypothesis**, **Open question**, **Vendor claim**, **Community** or **Unverified** when their status is not obvious ([AGENTS.md](../../AGENTS.md)).
- Cite primary URLs with access dates; add dated external claims to the [source register](../research/source-register.md).
- Update `last_verified` when facts are rechecked. Record a status change in the [decision log](../execution/decision-log.md).

Related: [application playbook](../execution/application-playbook.md), [ATS API and ingestion matrix](../research/ats-api-ingestion-matrix.md), [ATS automation](../architecture/ats-automation.md).
