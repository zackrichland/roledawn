---
title: Model routing, prompts, tools, and evaluation
status: current recommendation; model names and prices require launch-time verification
last_updated: 2026-08-06
---

# Model routing and evaluation

## Operating principle

Use deterministic software for state, identity, deduplication, permissions, exact facts, final validation, and side effects. Use models where language or unfamiliar terrain requires judgment.

The durable system is the workflow plus typed tools. The model is a replaceable worker selected for one task.

## Current OpenAI route

As of 2026-08-06, official OpenAI guidance identifies GPT-5.6 Sol as the flagship agentic/coding model, GPT-5.6 Terra as the balanced model, and GPT-5.6 Luna as the efficient high-volume model. Re-verify aliases, prices, latency, and availability before implementation.

| Task | Default | Escalation | Why |
|---|---|---|---|
| Job parsing, normalization, labels, simple extraction | GPT-5.6 Luna | Terra on schema/quality failure | High-volume, bounded, easily evaluated |
| Hard-rule eligibility | Deterministic code | Terra only to interpret ambiguous posting language | Exact user rules remain code-owned |
| Fit explanation and evidence selection | GPT-5.6 Terra | Sol for ambiguous/senior/high-stakes roles | Balance quality and operating cost |
| Resume/cover-letter/short-answer drafting | Terra | Sol for premium final QA or repeated factual/style failure | Most value comes from evidence packet and validation, not maximum model size |
| Known-ATS field mapping | Deterministic adapter + Terra | Sol when schema is unfamiliar | Structured route first |
| Unknown-page recovery and failure diagnosis | Sol | Human takeover | Demanding browser/tool reasoning |
| User conversation | Terra | Sol for consequential ambiguity | Natural interaction with bounded tools |
| Final permission and submit | Deterministic code only | Human | Models never grant authority |

Use the Responses API when RoleDawn owns the custom tool loop and state. Use Agents SDK capabilities when its sessions, traces, guardrails, and resumable human approvals reduce implementation burden. In either case, PostgreSQL remains authoritative for domain facts/policy/application records, Temporal for in-flight execution history, and the append-only ledger for consequential proof. Models own none of them.

## Tool design

Start with narrow typed tools:

```text
get_job_snapshot(job_id)
get_candidate_fact_packet(user_id, usage_context, role_family)
draft_artifact(job_snapshot_id, fact_packet_version, style_policy_version)
validate_claims(artifact_id)
get_form_schema(application_id)
propose_field_map(application_id, schema_version)
request_exact_fact(application_id, field_id)
create_pre_submit_diff(application_id)
request_approval(application_id, diff_hash)
```

The model does not receive `submit_application`, raw secrets, arbitrary shell, unrestricted browser, broad database queries, or policy mutation. A workflow activity invokes the adapter submit only after server-side approval validation.

Tools must be:

- Typed and schema-validated.
- Tenant-scoped.
- Idempotent where possible.
- Clear about read versus write behavior.
- Capped by time, calls, tokens, and dollars.
- Versioned with prompt/model/schema compatibility.

## Context construction

Send the smallest evidence packet required for the task:

- Authoritative job snapshot.
- Relevant verified facts and source passages.
- Exact answer policies for the current field class.
- Approved voice examples, not entire private history.
- Current artifact and requested edit.
- Explicit constraints and output schema.

Do not send passwords, OTPs, cookies, unrelated private messages, voluntary demographic data, or full account history.

Treat resumes, job pages, recruiter messages, and uploaded files as untrusted content delimited from system instructions.

## Writing pipeline

1. Select facts by role relevance and permitted usage.
2. Draft with fact IDs attached to material claims.
3. Apply voice policy and no-slop edit.
4. Extract claims deterministically or with a separate constrained pass.
5. Verify claims against the evidence ledger.
6. Reject, remove, or ask for any unsupported claim.
7. Render artifact and bind its hash/version to the application.

No “aggressive” mode can relax factual validation.

## Evaluation suite

Check in a versioned corpus before opening the alpha.

### Job understanding

- 50–100 postings across target roles and ATS families.
- Ground truth: employer, title, location, level, salary, work mode, authorization, requirements, preferences, and contradictions.
- Metrics: exact-field F1, hard-rule false-positive rate, evidence citation accuracy.

### Fit and ranking

- Pair jobs with candidate profiles and expert relevance labels.
- Measure ranking quality, calibration, hard-constraint violations, and reason usefulness.
- Compare approval and interview yield by score band after launch.

### Writing

- Fact-level entailment and unsupported-claim rate.
- Official title/date/employer/metric accuracy.
- Relevance coverage.
- Voice-preservation review.
- No-slop pattern rate.
- User edit distance and factual-correction rate.

Unsupported material claim is a hard failure, not an average score.

### Application questions

- Exact identity/eligibility fields.
- Semantically similar but legally different questions.
- Voluntary/protected fields.
- Salary/travel/relocation bounds.
- New attestations and trick wording.
- Metric: correct source route, abstention/escalation rate, zero inferred sensitive answers.

### Browser and adapters

- Form-field mapping accuracy.
- Successful fill without side effect.
- Correct blocker classification.
- Confirmation capture.
- Safe network-loss recovery.
- Duplicate prevention.
- Prompt-injection resistance.

### Messaging and approval

- Duplicate/out-of-order webhooks.
- Ambiguous `YES`.
- Expired or replayed token.
- Material change after approval.
- Wrong sender/binding.
- Opt-out and global pause.

## Release gates

For every prompt/model/tool/adapter change:

1. Run offline regression set.
2. Compare safety metrics before quality/cost metrics.
3. Shadow on live read-only traffic.
4. Canary to staff/design partners.
5. Promote through feature flag.
6. Monitor field corrections, takeovers, confirmation, cost, and support issues.
7. Roll back on any safety invariant breach.

Never silently change model aliases in a high-consequence path. Pin snapshots where available and record actual model ID per run.

## Online metrics

| Metric | Definition |
|---|---|
| Unsupported-claim rate | Submitted material claims without a resolvable approved source / all submitted material claims |
| Factual correction rate | Prepared applications where candidate corrects an exact fact / reviewed applications |
| Approval rate | Approved prepared applications / reviewed applications |
| Confirmed success rate | Confirmed submissions / authorized attempts |
| Reconciliation rate | Attempts entering uncertain state / submit attempts |
| Duplicate rate | Duplicate confirmed submissions / confirmed submissions |
| Takeover rate | Attempts needing human browser control / attempts |
| Interview yield | Applications leading to documented interview / eligible confirmed applications, cohort/date defined |
| Cost per confirmed application | All model, browser, proxy, workflow, and support cost / confirmed applications |

## Cost guardrails

Early cost estimates are uncertain; browser retries and support will dominate neat token math. Instrument from day one:

- Daily application and dollar cap per user.
- Browser-session maximum of roughly 15 minutes during alpha.
- Maximum three retries before any side-effect boundary; fewer for expensive unknown flows.
- Sol escalation budget per application.
- Batch discovery and parsing.
- Cache stable profile/job context with version keys.
- Stop unknown terrain instead of spending through it.
- Record cost by candidate, application, ATS, adapter version, and outcome.

Do not price “unlimited” until measured cost and failure distribution support it.

## Human review sampling

Review 100% of alpha artifacts and pre-submit packages, even when the candidate has approved them. Reduce internal sampling only after every safety metric and adapter gate passes. Keep random audits and targeted audits for new models, role families, form types, and high-risk answer classes.

## Provider abstraction

Define task contracts independent of a provider. Maintain a small alternative-provider evaluation set for resilience, but do not build an elaborate multi-provider platform before real need. Provider fallback must never change safety policy, source requirements, or approval behavior.
