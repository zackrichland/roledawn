---
title: RoleDawn documentation map
status: active
last_updated: 2026-09-29
---

# Documentation map

Start with current evidence, then read only the specification relevant to the
decision at hand. Research and vendor material inform decisions; they never
override accepted product or safety contracts.

## Required reading paths

### Founder or investor

1. [Application playbook](execution/application-playbook.md)
1. [Architecture at a glance](architecture/architecture-at-a-glance.md)
2. [Product readiness audit](execution/product-readiness-audit.md)
3. [Current state](execution/current-state.md)
4. [Founder brief](00-founder-brief.md)
5. [Positioning and ICP](strategy/positioning-and-icp.md)
6. [Roadmap](execution/roadmap.md)

### Product or design

1. [Current state](execution/current-state.md)
2. [PRD](product/prd.md)
3. [Dashboard and responsive experience](product/dashboard-and-responsive-experience.md)
4. [Onboarding and messaging](product/onboarding-and-messaging.md)
5. [Brand kit](brand/brand-kit.md)

### Engineering

1. [Application playbook](execution/application-playbook.md)
1. [Architecture at a glance](architecture/architecture-at-a-glance.md)
2. [Product readiness audit](execution/product-readiness-audit.md)
3. [Current state](execution/current-state.md)
4. [Backend build status](execution/backend-build-status.md)
5. [Implementation handoff](execution/implementation-handoff.md)
6. [Career Vault hosted acceptance](execution/career-vault-hosted-acceptance.md)
7. [Candidate-profile hosted acceptance](execution/candidate-profile-hosted-acceptance.md)
8. [Application drafting foundation hosted acceptance](execution/application-drafting-foundation-hosted-acceptance.md)
9. [Live Terra drafting acceptance](execution/live-terra-drafting-acceptance.md)
10. [Application Kit hosted acceptance](execution/application-kit-hosted-acceptance.md)
11. [Application fill-to-review foundation acceptance](execution/application-fill-foundation-acceptance.md)
12. [Browserbase live synthetic-session acceptance](execution/browserbase-live-acceptance.md)
13. [Backend architecture operating model](architecture/backend-operating-model.md)
14. [Three-system product architecture](architecture/three-system-product-architecture.md)
15. [Application quality system](architecture/application-quality-system.md)
16. [Frontend-to-backend contract](architecture/frontend-backend-contract.md)

Use these routed references when working on a subsystem:

| Subsystem | Specification |
|---|---|
| Executive system, stack, data flow, status, assumptions, and build order | [Architecture at a glance](architecture/architecture-at-a-glance.md) |
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
- [Backend build status](execution/backend-build-status.md) is the database and
  worker recovery record.
- [Decision log](execution/decision-log.md) records consequential choices and
  reversal triggers.
- The root [changelog](../CHANGELOG.md) records worktree/release history.
- Removed sample-runtime documents are preserved by Git history, not in the
  active documentation set.

If documents conflict, follow the newest accepted decision, then current state,
then the implementation handoff, then the specialized specification. Never turn
a repository implementation or previous tool report into a claim of current
hosted deployment without fresh evidence.

## Agents API execution — 2026-09-16

- [Architecture, answer policy, configuration and remaining work](architecture/agents-application-execution.md)
- [Live API, hosted database and browser acceptance evidence](execution/agents-application-execution-acceptance.md)

## Named-job delivery and writing policies

- [Autopilot acceptance and coverage](execution/application-autopilot-acceptance.md)
- [Editable application writing policies](../policies/application-writing/README.md)
