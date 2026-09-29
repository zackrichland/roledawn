---
title: Application fill takeover continuation acceptance
status: repository accepted; hosted migration and controlled Browserbase acceptance pending
owner: engineering
last_updated: 2026-08-18
scope: candidate-controlled continuation of one retained no-submit fill after takeover
---

# Application fill takeover continuation acceptance

## Outcome

**Verified in the repository:** a candidate can confirm that required questions
were completed in the secure browser and queue a replay-safe continuation of
the exact retained fill attempt and computer session. The worker rematerializes
the original authorized package, resumes the same guarded runtime, preserves
candidate-entered values, and stops at review. It has no Submit interface.

**Verified with real Chromium:** two Greenhouse-shaped forms paused for a
protected or unknown required question. After the candidate entered the missing
answer, the same page continued to `FILLED_TO_REVIEW`. The driver did not
overwrite the candidate's answer. Submit remained disabled, and a deliberate
`requestSubmit()` produced no network request.

**Not yet verified:** the additive migration is not deployed to hosted
Supabase, and this continuation has not been exercised with a retained
Browserbase session through the hosted candidate UI. It has not submitted an
employer application.

## Invariants

| Boundary | Enforced behavior |
|---|---|
| Candidate control | An authenticated owner must explicitly confirm that required browser questions are complete. |
| Exact continuation | The command is bound to one application, revision, fill attempt, computer session, authority hash, and disclosure-manifest hash. |
| Replay safety | `command_dedup` makes a repeated candidate command return the original result; only one resume attempt may be queued per fill. |
| Retained runtime | The supervisor accepts only the exact fill/session pair, serializes callbacks, waits before TTL teardown, and rejects absent, expired, stopped, or busy runtimes. |
| Authority | Continuation retains `FILL_APPLICATION_ONCE` and `FILL_ONLY_NO_SUBMIT`; it cannot create `SUBMIT_APPLICATION_ONCE`. |
| Submission proof | Completion requires zero submission requests and `application_submitted: false`; any existing submit attempt or receipt is a state conflict. |
| Recovery | A missing runtime or execution failure records `FAILED_SAFE` on the resume attempt while preserving the original application in `TAKEOVER`. An unresolved form records another `TAKEOVER`. |
| Audit | Each continuation is immutable history with a redacted terminal summary and append-only checkpoint/event. Provider references and candidate values are not logged. |

## Hosted prerequisite

Apply, in order, the repository migrations through:

```text
supabase/migrations/20260819061711_resume_takeover_application_fill.sql
```

The candidate workspace now reads `application_fill_resume_attempts`. Until
that migration exists in the connected Supabase project, the read fails closed
with `APPLICATION_WORKSPACE_READ_FAILED`. This is an expected schema-version
mismatch, not a UI fallback case. Do not hide it by treating a missing table as
an empty continuation history.

After migration, restart both the Next.js app and the long-running worker so
their generated schema expectations and fill-resume lane are aligned. The
worker still requires the existing Supabase service credentials and Browserbase
environment gate documented in
[application-fill-foundation-acceptance.md](application-fill-foundation-acceptance.md).

## Acceptance gate

1. Create one controlled Greenhouse-shaped application that pauses at a known
   required protected question.
2. Verify the application detail shows the retained secure-browser control and
   no internal identifiers.
3. Complete the question in Live View, check the confirmation, and select
   **Continue filling** once.
4. Verify replay returns the same resume attempt and the worker uses the same
   computer session.
5. Verify the application reaches `PRE_SUBMIT_REVIEW`, the original fill reaches
   `FILLED_TO_REVIEW`, and the resume attempt reaches `FILLED_TO_REVIEW`.
6. Verify zero rows were added to `application_attempts` and `receipts`, and the
   redacted summary records zero submission requests.
7. Repeat with an unresolved question and an expired session; both must remain
   in `TAKEOVER` without disclosing or submitting anything.

Final employer submission, confirmation, and receipt creation remain a
separate authority milestone.
