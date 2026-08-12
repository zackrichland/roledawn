---
title: RoleDawn documentation map
status: active
last_updated: 2026-08-12
---

# Documentation map

Start with current evidence, then read only the specification relevant to the
decision at hand. Research and vendor material inform decisions; they never
override accepted product or safety contracts.

## Required reading paths

### Founder or investor

1. [Current state](execution/current-state.md)
2. [Founder brief](00-founder-brief.md)
3. [Positioning and ICP](strategy/positioning-and-icp.md)
4. [Roadmap](execution/roadmap.md)

### Product or design

1. [Current state](execution/current-state.md)
2. [PRD](product/prd.md)
3. [Dashboard and responsive experience](product/dashboard-and-responsive-experience.md)
4. [Onboarding and messaging](product/onboarding-and-messaging.md)
5. [Brand kit](brand/brand-kit.md)

### Engineering

1. [Current state](execution/current-state.md)
2. [Backend build status](execution/backend-build-status.md)
3. [Implementation handoff](execution/implementation-handoff.md)
4. [Backend architecture operating model](architecture/backend-operating-model.md)
5. [Frontend-to-backend contract](architecture/frontend-backend-contract.md)

Use these routed references when working on a subsystem:

| Subsystem | Specification |
|---|---|
| Pasted-link product slice | [Pasted-link application engine](architecture/pasted-link-application-engine.md) |
| Current resolver/worker | [Job-ingestion runtime](architecture/job-ingestion-runtime.md) |
| Discovery and catalog | [Job discovery](architecture/job-discovery.md) |
| Evidence and models | [Model routing and evals](architecture/model-routing-and-evals.md) |
| Browser and submit | [ATS automation](architecture/ats-automation.md) |
| Security and data | [Data, security, and trust](architecture/data-security-and-trust.md) |
| Channels and OAuth | [Integrations and OAuth](architecture/integrations-and-oauth.md) |
| Scale and cost | [Scale, cost, and capacity](architecture/scale-cost-and-capacity.md) |
| Full trust-zone map | [System architecture](architecture/system-architecture.md) |

### Evidence and research

1. [Source register](research/source-register.md)
2. [Tsenta teardown](research/tsenta-teardown.md)
3. [Market and competitors](research/market-and-competitors.md)
4. [Claude handoff reconciliation](research/claude-handoff-reconciliation.md)
5. [Clay design study](research/clay-design-study.md)
6. [Viktor design study](research/viktor-design-study.md)

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
