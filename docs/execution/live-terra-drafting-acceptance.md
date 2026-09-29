---
title: Live Terra drafting acceptance
status: local dogfood acceptance; not a durable application revision
last_updated: 2026-08-16
---

# Live Terra drafting acceptance

## Outcome

**Verified locally:** the exact founder Application Input Snapshot can now pass
through a server-only OpenAI Responses API adapter using `gpt-5.6-terra`. The
adapter sent only the existing provider-safe projection, received strict
structured output, parsed it through the fail-closed domain boundary, and
produced a résumé and cover-letter proposal with zero deterministic validation
issues.

The private acceptance output is stored locally at
`artifacts/acceptance/live-terra-drafting.json`. That directory is ignored by
Git. The artifact contains candidate material and is not a repository fixture.

## What the run proved

- The API credential is read server-side from the ignored local environment.
- The account exposes `gpt-5.6-terra` and the model accepts Responses API
  Structured Outputs with `store: false`.
- Candidate identity, exact application facts, internal document IDs, and raw
  reviewed résumé text were absent from the provider request.
- Model execution metadata is injected by the trusted adapter rather than
  accepted from model output.
- The first schema attempt failed before generation because `uniqueItems` is
  outside the supported Structured Outputs subset. The adapter removed that
  keyword and retained duplicate checking in deterministic code.
- The first generated proposal exposed a surface-citation prompt defect and a
  numeric-token punctuation defect. Neither proposal was persisted. The prompt
  now requires separate résumé and cover-letter claims, and numeric validation
  no longer treats sentence punctuation as part of a year.
- The second proposal passed strict parsing and all deterministic citation,
  mode, number, word-limit, and no-slop checks.

## Quality findings

**Recommendation:** do not promote the dogfood proposal as a real application
kit. The selected role is a public-sector account-executive position in
Australia and was retained as a plumbing proof, not a quality-fit target. The
output is coherent and source-grounded at the structural level, but it reveals
the next required controls:

1. Semantic entailment must detect tense or scope drift such as changing an
   ongoing responsibility into a completed one.
2. Candidate identity/contact fields must be merged server-side from exact
   facts after narrative validation; the model never receives them.
3. Résumé section ordering and the cover letter's final role argument still
   need quality evaluation and candidate review.
4. Eligibility and fit should block or deprioritize an unsuitable role before
   spending on drafting.
5. Company research cannot yet support generated text because the drafting
   citation contract has no research-claim source type.

## Authority boundary

The acceptance command intentionally left all external and durable authority
false:

| Authority | Result |
|---|---|
| Acknowledge `application.drafting_requested` | No |
| Persist a research bundle or application revision | No |
| Mark semantic validation passed | No; status remains `REQUIRED_NOT_RUN` |
| Render or upload application documents | No |
| Open or fill an employer form | No |
| Submit an application | No |

## Repeatable command

```bash
npm run acceptance:drafting:live
```

This command is a local diagnostic. The production milestone remains a leased,
replay-safe drafting consumer with research, semantic entailment, one atomic
commit, rendering, and candidate review.
