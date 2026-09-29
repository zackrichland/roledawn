---
title: Agents application execution acceptance
status: live synthetic API and hosted runtime accepted; real employer delivery pending
last_updated: 2026-09-16
---

# Agents application execution acceptance

## Verified evidence

| Check | Observed result |
|---|---|
| Existing OpenAI key | Listed sessions, created a managed Codex-harness session, executed a synthetic function, verified completed turn, deleted session |
| Live form reasoning | Final run: two managed sessions, nine tool actions; verified static ARIA country selection and preserved candidate content; filled known fields, selected a generated PDF, used supported narrative text, requested missing consent, continued the same browser after a synthetic candidate answer |
| External side effects | Zero outbound submission requests; no employer application submitted; both provider sessions deleted |
| Runtime database | Four new/forward migrations deployed to the existing JobAgent Supabase project; 17 hosted runtime assertions passed with fixture mutations rolled back |
| Question database | 11 hosted rollback checks passed, covering owner isolation, direct-write denial, stale and expired rollback, explicit false, replay, one resume/outbox and empty-batch question supersession; additional typed-answer cases passed in isolated PostgreSQL/PGlite |
| Candidate UX | Browser-rendered at 390px and 1280px; no horizontal overflow, labelled controls, no default consent, one Save and continue button |
| Browser tests | Local Chromium checks varied labels, native controls, static ARIA selections, file-byte integrity, saved answers, cancellation, stale fingerprints and independent readback |

The live model test uses an explicit synthetic in-memory ledger/repository. The hosted SQL test separately verifies persistence and authority against the real schema. This is not a combined live API + Browserbase + candidate UI + hosted database employer run.

The final staged-session integration passed after correcting the observed beta initial-input requirement. Provider IDs were persisted in the explicit synthetic test store before form context was sent. Both API sessions returned deletion acknowledgements.

## Current repository checks

The final full suite passed 405 tests with zero failures or skips. Typecheck, ESLint, production build, Markdown link checks and diff whitespace checks passed. The final browser suite includes native controls, static ARIA selection, malformed-choice fallback, preserved candidate input and compound/negative sensitive-question guards.

## Fixes discovered by validation

- The existing resume SQL had an ambiguous `aggregate_version` reference. A separate forward migration qualifies only that UPDATE/RETURNING expression.
- A generated answer that is a literal substring can remove negation; all drafted prose now passes independent entailment.
- An empty missing-question set must supersede older open questions, or a completed form can continue displaying an obsolete candidate prompt.
- Custom combobox search text cannot serve as selected-option evidence.
- Resume timeouts must fit inside the five-minute database lease.
- The live beta API requires initial input for conversation-only sessions although the creation reference marks input optional. The final adapter uses a generic bootstrap turn before sending form context after durable binding.

## Reproduction

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run check:docs`
- `RUN_AGENTS_FORM_ACCEPTANCE=true npm run acceptance:agents`
- Wrap `scripts/application-agent-questions-acceptance.sql` separately in `BEGIN; ... ROLLBACK;` to verify candidate questions and atomic continuation.
- Wrap `scripts/application-agents-runtime-acceptance.sql` in `BEGIN; ... ROLLBACK;` against the migrated schema. It also rolls its own fixture state back internally. No provider calls occur.

## Local activation

`ROLEDAWN_FORM_DRIVER=agents` is configured in the ignored local environment, reusing the existing OpenAI and Browserbase credentials. The factory resolves `agents-adaptive-fill/1`. Start both app and long-running worker with `npm run dev:full` to exercise an authorized application. The temporary UI preview route and preview server used for screenshot validation were removed/stopped. The hosted web/worker deployment was not changed.

## Boundaries

No final submit capability was added. The existing independent browser network guard remains active. File selection is not employer upload acknowledgement. Login, CAPTCHA, remote option menus, multi-page navigation, generalized answer reuse and submission receipts remain open work in the [execution design](../architecture/agents-application-execution.md).
