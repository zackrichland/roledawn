---
title: Founder directives
status: canonical; read before changing product behavior
owner: founder
last_updated: 2026-09-30
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

5. **Each user applies with their own email.** The founder uses zackrichland@gmail.com. A read-only Gmail connection reads employer verification codes (D-106). (2026-09-29)
6. **Board accounts** (Workday and similar): use the user's application email. The founder asked for one shared, memorable password; the recommendation on record is a unique generated password per site, stored encrypted and viewable in RoleDawn. **Open decision** for the founder when account-based boards are built. (2026-09-29)
7. **Single account first.** Everything is tuned on the founder's account; sign-up for other people comes later. Single-account sign-in needs the private access key (D-109). (2026-09-29)

## Standing answers (saved in the database for the founder)

Saved as verified profile facts on 2026-09-30. A future onboarding flow must collect the same answers from every user.

| Question | Answer | Where it lives |
|---|---|---|
| Authorized to work in the US | Yes | `work_authorization.us.authorized` |
| Needs visa sponsorship now or later | No | `work_authorization.us.sponsorship_required` |
| Highest degree | Bachelor's degree (B.S. Business Management, Virginia Tech, 2017) | `education.highest_degree` |
| How did you hear about this job | The company's careers website | `application.heard_about` |
| Undergraduate GPA | 3.5 (range answers: "3.4 - 3.59") | Remembered answer once asked; no profile fact yet |
| On-site or commute questions | Yes | Remembered answers (D-112) |
| Ever worked for this employer / referred by an employee | No / No | Remembered answers |
| Phone country | United States +1 | Remembered answers |
| LinkedIn, compensation | Blank when optional; compensation "Open to discussion" when required | Remembered answers |
| Portfolio or website | None ("N/A" / No) | Remembered answers |
| Preferred AI tool | ChatGPT | Remembered answers |

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
