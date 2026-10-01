---
title: RoleDawn documentation map
status: active
last_updated: 2026-10-01
---

# Documentation map

Start with current evidence, then read only the specification relevant to the
decision at hand. Research and vendor material inform decisions; they never
override accepted product or safety contracts.

## Required reading paths

### Founder or investor

1. [Reliability review, 2026-10-01](execution/reliability-review-2026-10-01.md): why sends stop, the pipeline diagram and decisions P1–P6
2. [Independent review and readiness](execution/codex-review-2026-09-30.md)
3. [Current state](execution/current-state.md)
4. [Application playbook](execution/application-playbook.md)
5. [Founder directives](execution/founder-directives.md)
6. [Founder brief](00-founder-brief.md)
7. [Positioning and ICP](strategy/positioning-and-icp.md)
8. [Roadmap](execution/roadmap.md)

### Product or design

1. [Independent review and readiness](execution/codex-review-2026-09-30.md)
2. [Current state](execution/current-state.md)
3. [Application playbook](execution/application-playbook.md)
4. [PRD](product/prd.md)
5. [Dashboard and responsive experience](product/dashboard-and-responsive-experience.md)
6. [Onboarding and messaging](product/onboarding-and-messaging.md)
7. [Brand kit](brand/brand-kit.md)

### Engineering

1. [AGENTS.md](../AGENTS.md): commands, repo map, invariants and gotchas
2. [Founder directives](execution/founder-directives.md)
3. [Application playbook](execution/application-playbook.md)
4. [Current state](execution/current-state.md)
5. [Reliability review, 2026-10-01](execution/reliability-review-2026-10-01.md): stop diagnosis, `ops:why`, guard proposals
6. [Independent review and readiness](execution/codex-review-2026-09-30.md)
7. [Decision log](execution/decision-log.md): read the latest rows
8. [ATS board templates](boards/README.md)
9. [Backend architecture operating model](architecture/backend-operating-model.md)
10. [Three-system product architecture](architecture/three-system-product-architecture.md)
11. [Application quality system](architecture/application-quality-system.md)
12. [Frontend-to-backend contract](architecture/frontend-backend-contract.md)

### Historical snapshots and acceptance

These retain the scope and dates of the original observations. They establish
past evidence, not current release state or current operating instructions.

- [Review brief, 2026-09-28 to 2026-09-30](execution/review-brief-2026-09-30.md)
- [State history through 2026-09-30](execution/state-history-through-2026-09-30.md)
- [Architecture snapshot, 2026-08-18](architecture/architecture-at-a-glance.md)
- [Product readiness assessment, 2026-09-16](execution/product-readiness-audit.md)
- [Backend build status](execution/backend-build-status.md)
- [Implementation handoff](execution/implementation-handoff.md)
- [Career Vault hosted acceptance](execution/career-vault-hosted-acceptance.md)
- [Candidate-profile hosted acceptance](execution/candidate-profile-hosted-acceptance.md)
- [Application drafting foundation hosted acceptance](execution/application-drafting-foundation-hosted-acceptance.md)
- [Live Terra drafting acceptance](execution/live-terra-drafting-acceptance.md)
- [Application Kit hosted acceptance](execution/application-kit-hosted-acceptance.md)
- [Application fill-to-review foundation acceptance](execution/application-fill-foundation-acceptance.md)
- [Browserbase live synthetic-session acceptance](execution/browserbase-live-acceptance.md)

Use these routed references when working on a subsystem:

| Subsystem | Specification |
|---|---|
| Current workflow, support and operating state | [Application playbook](execution/application-playbook.md), [current state](execution/current-state.md) |
| Candidate, opportunity, and application system boundaries | [Three-system product architecture](architecture/three-system-product-architecture.md) |
| Pasted-link product slice | [Pasted-link application engine](architecture/pasted-link-application-engine.md) |
| Current resolver/worker | [Job-ingestion runtime](architecture/job-ingestion-runtime.md) |
| Career Vault résumé intake | [Career Vault résumé intake](architecture/career-vault-resume-intake.md) |
| Discovery and catalog | [Job discovery](architecture/job-discovery.md) |
| Evidence and models | [Model routing and evals](architecture/model-routing-and-evals.md) |
| Application quality policy, current gates, and missing quality layers | [Application quality system](architecture/application-quality-system.md) |
| Browser and submit | [ATS automation](architecture/ats-automation.md) |
| Live managed-browser synthetic acceptance | [Browserbase live synthetic-session acceptance](execution/browserbase-live-acceptance.md) |
| Security and data | [Data, security, and trust](architecture/data-security-and-trust.md) |
| Channels and OAuth | [Integrations and OAuth](architecture/integrations-and-oauth.md) |
| Scale and cost | [Scale, cost, and capacity](architecture/scale-cost-and-capacity.md) |
| Full trust-zone map | [System architecture](architecture/system-architecture.md) |

### Evidence and research

1. [Source register](research/source-register.md)
2. [ATS API and ingestion matrix](research/ats-api-ingestion-matrix.md)
3. [Tsenta teardown](research/tsenta-teardown.md)
4. [Market and competitors](research/market-and-competitors.md)
5. [Claude handoff reconciliation](research/claude-handoff-reconciliation.md)
6. [Clay design study](research/clay-design-study.md)
7. [Viktor design study](research/viktor-design-study.md)

## Status, history, and authority

- [Current state](execution/current-state.md) is the dated project snapshot.
- [State history through 2026-09-30](execution/state-history-through-2026-09-30.md)
  preserves the older observations formerly accumulated in that snapshot;
  superseded statements there are not current instructions.
- [Backend build status](execution/backend-build-status.md) is the database and
  worker recovery record.
- [Decision log](execution/decision-log.md) records consequential choices and
  reversal triggers.
- The root [changelog](../CHANGELOG.md) records worktree/release history.
- Removed sample-runtime documents are preserved by Git history, not in the
  active documentation set.

If sources conflict, code and database establish what exists; founder directives
establish what should exist. Then follow the newest accepted decision, the
application playbook, current state, and other specifications, in that order.
Never turn a repository implementation or previous tool report into a claim of
current hosted deployment without fresh evidence.

## Agents API execution — 2026-09-16

- [Architecture, answer policy, configuration and remaining work](architecture/agents-application-execution.md)
- [Live API, hosted database and browser acceptance evidence](execution/agents-application-execution-acceptance.md)

## Named-job delivery and writing policies

- [Autopilot acceptance and coverage](execution/application-autopilot-acceptance.md)
- [Editable application writing policies](../policies/application-writing/README.md)
