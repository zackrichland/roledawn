---
title: Model routing, prompts, tools, and evaluation
status: durable Terra drafting and entailment runtime plus deterministic quality gate implemented; broader research and blind evals pending
last_updated: 2026-08-16
---

# Model routing and evaluation

The [backend operating model](backend-operating-model.md) is the canonical end-to-end context. This document owns task routing, prompts, tools, customization, evaluation, and release behavior.

## Operating principle

Use deterministic software for state, identity, deduplication, permissions, exact facts, final validation, and side effects. Use models where language or unfamiliar terrain requires judgment.

The durable system is the workflow plus typed tools. The model is a replaceable worker selected for one task.

## Current implementation boundary

OpenAI is now the initial drafting benchmark behind the provider-neutral seam,
not a production-wide provider selection. The server-only adapter uses the
Responses API with `gpt-5.6-terra`, medium reasoning, strict Structured Outputs,
`store: false`, explicit refusal/incomplete handling, and no SDK-owned retries.
The credential is local and Git-ignored. The leased Application Kit worker now
calls the drafting and entailment adapters, but no model output can authorize
itself or persist without every server-owned gate:

| Boundary | Status | What is true now |
|---|---|---|
| Exact-snapshot context loader | **Implemented and tested** | Reads only named snapshot/job/résumé/evidence versions, rechecks hashes, and has no `latest` lookup |
| Provider-safe drafting request | **Implemented and tested** | Excludes candidate identity, exact facts, raw document IDs, and raw reviewed résumé text; generated modes receive approved narrative evidence only |
| Drafting adapter output parser | **Implemented and tested** | Treats provider output as `unknown`, rejects unknown/malformed/unbounded structures, and preserves refusal/incomplete states |
| Cited research proposal and bundle | **Implemented and tested** | Requires approved source classes, citations, conflicts, freshness, exact snapshot/job binding, and deterministic hashes |
| Hosted provenance schema | **Deployed and rollback-accepted** | Research bundles and revision evidence references are append-only; revisions require matching input and research provenance |
| Research and drafting consumer | **Implemented and founder-dogfooded** | The leased `application.drafting_requested` consumer revalidates one exact snapshot and commits the complete kit atomically |
| Terra drafting adapter | **Implemented and founder-dogfooded** | Strict Structured Outputs remain an untrusted proposal behind provider-neutral contracts |
| Research provider | **Narrow implementation only** | The official posting becomes a cited, fresh bundle; broader primary-source company research is not connected and is explicitly warned as limited |
| Semantic entailment | **Implemented and required** | A separate adapter receives only each generated claim and its cited frozen source text; every claim must be entailed |
| Quality policy and review gate | **Implemented for new snapshots** | `roledawn-writing-policy/2` and `roledawn-application-quality-evaluator/1` enforce role specificity, proof, candidate-facing hygiene, and auditable warnings before rendering |
| Renderer | **Implemented with bounded text QA** | Four PDF/DOCX artifacts are re-extracted, coverage-checked, hashed, and persisted; page-image visual inspection remains pending |

### Provider-selection recommendation

Keep routing task-based and benchmark candidates behind the existing contracts.
Do not put provider IDs in domain state beyond immutable execution provenance.
Terra is accepted for founder dogfood drafting only. A production route still
requires a fixed fixture set measuring factual support, abstention, schema
validity, latency, and accepted-output cost.

| Task | Initial route | Escalation rule |
|---|---|---|
| Job normalization and hard eligibility | Deterministic code | A model may explain ambiguous text, but code owns the rule and outcome |
| Cited company/role research | One bounded research adapter | Reject output without valid primary-source citations, binding, and freshness |
| Evidence selection and résumé/letter drafting | One bounded drafting adapter | Retry or escalate only for typed refusal, incompleteness, or failed quality gates |
| Semantic entailment | Separate constrained validator | Human review on conflict or uncertain material claim |
| Known-ATS field mapping | Deterministic adapter first | Bounded planner or human takeover for unfamiliar terrain |
| Final permission and submit | Deterministic code only | Candidate approval; never a model decision |

**Recommendation:** begin with one focused provider call per bounded research,
drafting, or validation task. Add a manager/specialist loop only when evaluation
evidence proves a focused call is insufficient. A future workflow coordinator
may own retries and waits; PostgreSQL remains the source of domain authority.

## Tool design

The following are target tools, not a description of a connected model runtime:

```text
get_application_input_snapshot(input_snapshot_id)
get_approved_narrative_evidence(input_snapshot_id)
get_application_research_bundle(input_snapshot_id)
draft_application_materials(input_snapshot_id, research_bundle_id, policy_release)
validate_semantic_claims(drafting_proposal_id)
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

The implemented drafting-context builder begins with the immutable Application
Input Snapshot named by the event. Its reader exposes exact-ID methods only and
revalidates the snapshot hash, job-version hash, reviewed-résumé hashes, and
approved evidence versions before constructing context.

The trusted server may read reviewed résumé text to validate the frozen input.
The provider request is smaller:

- exact input-snapshot ID and hash;
- the bound employer, title, description, and normalized job context;
- tailoring mode and versioned writing-policy limits;
- approved narrative-evidence text and immutable evidence-version IDs; and
- a résumé-handling directive.

For `AS_UPLOADED`, that directive is `PRESERVE_SERVER_SIDE`; the model receives
the reviewed-text hash but does not receive or recreate the résumé text. For
`REORDER_AND_TIGHTEN` and `REWRITE_FROM_VERIFIED_FACTS`, generated résumé prose
may use only approved narrative evidence permitted for the résumé.

Candidate identity, candidate/workspace IDs, exact fact values, raw document
IDs, passwords, OTPs, cookies, unrelated private messages, voluntary
demographic data, and full account history stay out of narrative provider
context. Exact facts remain available only to deterministic field handling under
their allowed-use policy.

Treat résumés, job pages, recruiter messages, citations, and uploaded files as
untrusted content delimited from system instructions.

## Writing pipeline

All eight stages below are connected for the official-posting-only Application
Kit path. The broader primary-source researcher, iterative revision loop,
candidate voice profile, long-form application-answer evaluator, visual page
inspection, and blind evaluation corpus remain open. See the
[application quality system](application-quality-system.md) for that boundary.

1. Load and revalidate the named immutable Application Input Snapshot.
2. Build a provider-safe request from the exact job version and approved
   narrative-evidence versions. Preserve `AS_UPLOADED` server-side.
3. Parse all provider output from `unknown` through the strict bounded schema.
4. Run bounded cited research and persist a fresh snapshot-bound research
   bundle.
5. Draft with immutable evidence IDs or job/research citations attached to each
   material claim; apply the versioned writing policy.
6. Run deterministic checks, then a distinct semantic-entailment validator.
   Deterministic success while entailment is `REQUIRED_NOT_RUN` is not a pass.
7. Run the versioned quality evaluator. Block missing proof, role specificity,
   unresolved placeholders, internal metadata, or policy drift; preserve
   non-blocking writing and research-depth warnings in the packet manifest.
8. Render artifact bytes, hash them in the trusted finalizer, bind the revision
   to its input snapshot, research bundle, evidence references, and policy, then
   persist once.

Expose three editing strengths: `AS_UPLOADED`, `REORDER_AND_TIGHTEN`, and `REWRITE_FROM_VERIFIED_FACTS`. The strongest mode may rewrite structure and bullets from supported evidence, but no mode can relax factual validation.

## Personalization and later customization

Candidate-specific quality should initially come from evidence packets, exact answer policies, approved voice examples, prompt/tool releases, and deterministic validators—not one trained model per candidate.

Consider fine-tuning or distillation only after:

1. the bounded task is stable;
2. a consented labeled corpus and separate holdout set exist;
3. prompt, evidence, tool, and routing improvements have plateaued;
4. training retention/deletion consent is separate from inference consent; and
5. the route improves safety, accepted-output quality, latency, and cost under the same contract.

Fine-tuning is not a way to inject current company knowledge, repair weak evidence, or make final submission autonomous.

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

Vendor traces and evaluation systems are debugging aids, not the application audit ledger. Redact or suppress raw candidate content until retention, region, DPA, and zero-data-retention choices are documented. Keep an owned checked-in evaluation harness even when vendor datasets or trace graders are used.

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
- Quality-escalation budget per application.
- Batch discovery and parsing.
- Cache stable profile/job context with version keys.
- Stop unknown terrain instead of spending through it.
- Record cost by candidate, application, ATS, adapter version, and outcome.

Do not price “unlimited” until measured cost and failure distribution support it.

## Human review sampling

Review 100% of alpha artifacts and pre-submit packages, even when the candidate has approved them. Reduce internal sampling only after every safety metric and adapter gate passes. Keep random audits and targeted audits for new models, role families, form types, and high-risk answer classes.

## Provider abstraction

Define task contracts independent of a provider. Maintain a small alternative-provider evaluation set for resilience, but do not build an elaborate multi-provider platform before real need. Provider fallback must never change safety policy, source requirements, or approval behavior.
