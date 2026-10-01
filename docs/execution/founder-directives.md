---
title: Founder directives
status: canonical; read before changing product behavior
owner: founder
last_updated: 2026-10-01
scope: standing instructions from the founder that every contributor and coding agent must follow
---

# Founder directives

These are the founder's standing instructions, recorded as he gave them. When one conflicts with an older document, this page wins. The [decision log](decision-log.md) says how each one was implemented.

## What RoleDawn is for

1. **Applications go out without the user.** The whole point is that the user doesn't have to see or click anything. Build full auto-apply first, then work backwards to add review for people who want it. "Let me review before it's sent" stays available but off by default. (2026-09-29)
2. **Nothing stops an application.** Emailed codes, repeat questions, and odd widgets (such as a GPA multi-select) must be handled automatically. When something truly can't be done, the Home row says exactly what's needed, and one click resolves it. (2026-09-29, 2026-09-30)
3. **Don't ask the founder routine application questions.** Use stored answers; for anything new, choose a reasonable, truthful answer and report it afterward. Never invent credentials, employers, or facts that contradict the profile. (2026-09-30)
4. **Quality is the mission.** Every application goes out with a high-quality, truthful résumé and cover letter written under RoleDawn's own writing rules (`policies/application-writing/`). (2026-09-29)

## Accounts and email

5. **Each user applies with their own email.** The selected address comes from the candidate's private profile. A read-only Gmail connection reads employer verification codes (D-106). (2026-09-29)
6. **Board accounts** (Workday and similar): use the user's application email. The founder asked for one shared, memorable password; the recommendation on record is a unique generated password per site, stored encrypted and viewable in RoleDawn. **Open decision** for the founder when account-based boards are built. (2026-09-29)
7. **Single account first.** Everything is tuned on the founder's account; sign-up for other people comes later. Single-account sign-in needs the private access key (D-109). (2026-09-29)

## Standing answers

The founder supplied routine answers on 2026-09-30. Exact values, employers,
contact details, education, GPA, and eligibility answers belong in the private
candidate records, not this public repository. Do not reconstruct answers from
this document or apply the founder's answers to another candidate. Profile
facts use anchored label rules; standing answers use the worker/database
eligibility rules in D-117. A future onboarding flow must collect each user's
own answers.

| Topic | Private source |
|---|---|
| Work authorization and sponsorship | Country-scoped `work_authorization.*` facts |
| Education | `education.highest_degree` and reviewed career profile |
| How the candidate heard about the job | `application.heard_about` and a candidate-approved option fallback |
| GPA and degree-specific follow-ups | Candidate standing answer |
| On-site work and commuting | Candidate standing answer |
| Previous or current employment with the employer | Candidate standing answer reconciled with structured work history |
| Referral, current employment and phone country | Candidate standing answers |
| Required compensation response | Candidate standing answer; optional fields follow the saved preference |
| Portfolio, preferred AI tool and minimum-age question | Candidate standing answers |

## Engineering

8. **Brute force, then refine.** Ship the working path end to end first, then optimize. Test applications don't matter; real submissions to real employers are acceptable for testing. (2026-09-29)
9. **Models:** the form-filling agent runs on GPT-6.1 Sol (cheaper, faster); document writing stays on GPT-6 Astra for quality (D-108). (2026-09-29)
10. **Browser:** Browserbase is the browser provider (Developer plan). OpenAI's hosted browser isn't used for submitting (no pre-submit gate); it may be used later for read-only work. (2026-09-29)
11. **No approvals needed from the founder** for deploys, migrations, or settings. Do the work, verify it, and report. (2026-09-29)
12. **Full observability.** It should always be possible to see exactly where an application is and why it stopped. Optimize for speed and remove leaks. (2026-09-30)
13. **Breadth next.** Every job board gets a template (`docs/boards/`) the agent can use, starting with the most popular (Workday), before building each adapter. (2026-09-30)
14. **Lean and modular.** Keep the repository easy for coding agents to read; keep AGENTS.md current with lessons learned. (2026-09-30)
15. **Push to GitHub once it works,** with documentation that explains how everything works. (2026-09-29)
16. **Remember everything.** Record every instruction here, in the decision log, and in agent memory. (2026-09-30)

17. **Delegate application acknowledgements.** The candidate authorizes RoleDawn to accept application terms, privacy notices, processing/screening consents and application-information attestations, and to enter the approved legal name in signature fields. Save that authority per candidate and record the exact employer wording on each send; no repeated candidate acknowledgement. This permission does not establish a qualification or personal-status fact. (2026-09-30, D-136)

18. **Write narrative form answers from the approved record.** The agent handles short written responses using the résumé and evidence. Ask only for missing factual details; never fabricate the requested example. Home's Answer panel must display the actual questions and save replies back to the same send. (2026-09-30, D-140)

19. **Finish inside RoleDawn.** Never send the candidate to an employer site to finish a stopped application. Any required human verification belongs in the application’s embedded browser, with RoleDawn continuing and tracking the result. Unsupported forms stay visibly stopped until their delivery path is repaired. (2026-09-30, D-144)

20. **CAPTCHAs never stop an application.** Turn on Browserbase's CAPTCHA solver for every board; RoleDawn ticks the "I'm not a robot" checkbox when shown and waits for the solve. The candidate's embedded-browser check (directive 19) is only the fallback when the solver fails. A solved CAPTCHA is never a receipt (D-146). (2026-10-01)
