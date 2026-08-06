---
title: Claude architecture handoff reconciliation
status: reviewed input; current RoleDawn decisions remain authoritative
owner: founder and engineering
last_updated: 2026-08-06
source_artifact: user-provided agent-platform-handoff-spec.md
source_sha256: 1d1eb03f9d6cdc196d103536900b6b8ea0cfc1360264cd795dc5dfcbd4ac51a3
evidence_status: external advisory artifact; vendor and technical claims require primary-source verification
---

# Claude architecture handoff reconciliation

## Purpose

This document reconciles the external multi-tenant agent-platform handoff with RoleDawn's current product, safety, and architecture decisions. It does not make the external handoff authoritative. The [founder brief](../00-founder-brief.md), [decision log](../execution/decision-log.md), and approved architecture documents remain the source of truth.

Disposition labels:

- **Accept:** incorporate without changing the current invariant.
- **Modify:** retain the useful direction but replace unsafe, inaccurate, or overbroad implementation detail.
- **Reject:** do not carry the proposal into the build.
- **Open:** benchmark, verify, or obtain counsel/vendor evidence before deciding.

## Executive disposition

The handoff is directionally right that RoleDawn should be one multi-tenant product with durable user state and replaceable channels, not one Hermes-like deployment per candidate. Its strongest additions are the explicit two-way MCP distinction, OAuth/token-vault framing, model-cost segmentation, and buy-versus-build prompt for discovery.

It becomes unsafe when it treats a conversational agent loop as the product runtime, makes policy editable tenant configuration, gives a model side-effectful tools after a conversational confirmation, scores every job against every tenant, provisions one iMessage line per candidate, or moves Gmail ahead of the evidence, approval, receipt, and recovery system.

## Decision matrix

### Multi-tenancy and state

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| One shared multi-tenant product, not one agent deployment per candidate | **Accept** | One product and logical agent per user; on-demand workers execute durable work. |
| One repo and one deployed service | **Modify** | One repo may produce several process types: API/channel ingress, Temporal workers, parser workers, browser workers, and reconcilers. |
| The product is one stateless agent loop | **Modify** | Workers may be stateless. Each application is a durable workflow; model loops are bounded activities inside it. |
| Onboarding is a tenant insert plus line provisioning | **Reject** | Onboarding creates account/workspace, user, candidate profile, consent, search policy, channel binding, and audit records. |
| Prompt, allowed tools, and raw model name live on the tenant row | **Reject** | Store bounded preferences by tenant. Store prompts, tools, and model routes in centrally managed immutable versions promoted through eval and canary gates. |
| Dashboard and agent directly read/write one database | **Modify** | Surfaces share one domain model through APIs. PostgreSQL, Temporal, the audit ledger, and derived read models retain their documented ownership boundaries. |

### Messaging

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| Apple offers no arbitrary personal-agent server API | **Modify** | Use the precise constraint in [channel strategy](../product/channel-strategy.md); Apple exposes other constrained Messages surfaces. |
| Use a managed relay | **Accept for alpha; open for production** | Keep the relay behind `ChannelAdapter` and require platform, DPA, portability, security, delivery, and incident diligence. |
| Give every candidate a dedicated iMessage line | **Reject** | Provider line resources and user bindings are different objects. One project line or small pool can serve many verified user bindings. |
| Photon is the production default | **Open** | Photon remains the recommended bounded alpha experiment under D-005, not a permanent platform assumption. |
| BlueBubbles or Messages.app puppeting is production infrastructure | **Reject** | Keep these to local prototypes, if used at all. |
| Webhook handler runs the agent before replying | **Reject** | Verify, deduplicate, persist, acknowledge, and dispatch asynchronously into a typed command or workflow signal. |

### Agent runtime, workflow, and MCP

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| Claude Agent SDK is the settled harness | **Open** | Evaluate it against the current OpenAI Responses/Agents route using identical typed tasks and safety gates. |
| Consuming MCP and exposing RoleDawn through MCP are different concerns | **Accept** | Internal tool consumption may be useful; external RoleDawn MCP remains later and read-only first. |
| Every internal tool should be MCP | **Modify** | MCP is an interoperability envelope, not a trust boundary. Prefer ordinary typed service methods unless MCP provides measured value. |
| `allowed_tools` plus a chat confirmation authorizes writes | **Reject** | Tool availability is not authorization. A deterministic service consumes one single-use approval bound to one immutable application diff. |
| Long work should not run in short request handlers | **Accept** | API and webhook ingress stay short; workers handle model, browser, and reconciliation work. |
| A scheduler can start work with a synthetic task prompt | **Reject** | Schedules emit typed commands such as `PollSource`, `PrepareQueue`, or `ReconcileAttempt`. |
| Temporal, lightweight durable runners, and an always-on loop are equivalent starting points | **Modify** | Preserve D-008: Temporal is the recommendation until a benchmark proves a simpler engine satisfies the same recovery contract. |

### Database and dashboard

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| Supabase Postgres and Supabase Auth are settled | **Open** | Preserve O-003. Supabase is an alpha candidate subject to security, RLS, latency, pooling, PITR, portability, and cost review. |
| Encrypted refresh tokens live in `connected_accounts` | **Reject** | Domain rows store opaque credential references. Tokens remain in a dedicated secret or token broker. |
| `tenant_id` RLS is sufficient isolation | **Modify** | Use RLS as defense in depth with application authorization, tenant-aware foreign keys, private schemas, and principal/candidate ownership. |
| `agent_runs` is the customer activity feed | **Reject** | Agent runs are operational telemetry. Customer activity is a projection of meaningful domain events. |
| Sessions and messages own workflow state | **Reject** | Conversation history helps interpret commands; it cannot own application, policy, approval, or receipt state. |

### Discovery and matching

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| Official public ATS sources are the discovery foundation | **Accept** | Use the approved source registry and immutable job-version model. |
| Every named ATS has a stable public zero-auth JSON contract | **Open** | Greenhouse, Lever, and Ashby are documented. Verify every additional family independently before activation. |
| Workday CXS is equivalent to an official public API | **Reject unless verified** | Treat it as an experimental, undocumented interface pending terms and reliability review. |
| Registry, adapters, normalized jobs, and change events | **Accept** | This is already specified more completely in [job discovery](../architecture/job-discovery.md). |
| Match every new job against every tenant | **Reject** | Retrieve potentially eligible searches through indexed hard dimensions, then run exact filters and bounded reranking. |
| Matching is certainly the largest token cost | **Open hypothesis** | Measure model, browser, retry, and support cost by task and outcome. |
| No universal candidate-side submission API exists; browser execution is required | **Accept with narrower wording** | Partner and employer-authorized APIs exist; no verified universal candidate-authorized API spans arbitrary employers. |
| Rent commodity ingestion immediately | **Open** | A rented source may accelerate validation only behind `SourceAdapter`, with provenance and official snapshot resolution preserved. |

### Models and provider routing

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| Cheap models for bounded bulk work and stronger models for consequential work | **Accept** | Deterministic work runs first; provider privacy and quality gates still apply. |
| Benchmark tool fidelity on the actual task loop | **Accept** | Include schema validity, abstention, unsupported claims, retries, latency, and cost per accepted result. |
| Anthropic-compatible third-party endpoints are interchangeable | **Reject as an assumption** | Verify endpoint behavior, tool fidelity, retention, training, DPA, region, and model mapping separately. |
| Route every request through LiteLLM or OpenRouter from day one | **Reject as premature** | Start with a small provider interface and direct adapters. Add a gateway only after a benchmark proves its value. |
| A tenant can change its raw model configuration without release | **Reject** | Tenants may select an approved product tier; engineering promotes immutable `model_route_version` records. |

### Connections and Gmail

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| OAuth 2.0 plus a token vault is the primitive | **Accept** | Add purpose, scope, ownership, rotation, revocation, health, and audit. |
| Product connectors are simply MCP servers with OAuth | **Reject** | A connector can use a direct provider API, managed integration platform, or MCP. MCP does not remove credential obligations. |
| Nango or DIY is settled | **Open** | Evaluate build versus buy under the gates in [integrations and OAuth](../architecture/integrations-and-oauth.md). |
| Gmail belongs before the core application workflow | **Reject** | Start with portal evidence and user-controlled forwarding; mailbox access remains P1. |
| Gmail send and read are both restricted scopes | **Modify** | Google currently classifies `gmail.send` as sensitive and broad read/modify/metadata/compose scopes as restricted. Recheck before implementation. |

### Product surfaces and build order

| Proposal | Disposition | RoleDawn resolution |
|---|---|---|
| Next.js responsive dashboard first, native app later | **Accept** | Matches D-012. |
| Connections, activity, settings, matching, and approval pages are sufficient | **Modify** | Preserve the fuller Today, Needs You, Applications, Career Vault, Searches, Rules, Inbox, Receipts, Security, and Support information architecture. |
| Native mobile requires no new architecture | **Reject** | It adds device identity, push, secure local storage, biometric re-authentication, deep links, offline projection, and store disclosure requirements. |
| Build messaging and Gmail before the evidence and workflow core | **Reject** | Keep the sequenced roadmap: authority and evidence first, one controlled application next, messaging attached to working APIs, Gmail later. |

## Authoritative implementation corrections

### Tenant semantics

Do not flatten candidate, user, account, and tenant into one `tenants` row. Use:

```text
account              legal and billing relationship
workspace            tenant, security, and future regional boundary
principal            authenticated human or service actor
workspace_membership principal role inside a workspace
candidate_profile    subject whose evidence and applications are being used
```

The consumer alpha can enforce one owner and one candidate per workspace. The distinction preserves a safe path to coach, university, and outplacement workspaces without allowing an administrator to inherit candidate identity, mailbox access, or submission authority.

### Configuration semantics

Separate three classes:

- Candidate-owned preferences and answer policies.
- Plan or workspace entitlements selected from approved options.
- Engineering-owned agent, tool, prompt, adapter, and model-route versions.

Every model or tool run records the exact promoted versions. No model, tenant, webpage, or remote MCP server may mutate the promoted configuration.

### Runtime semantics

Temporal coordinates durable state. PostgreSQL commits domain transitions. Agent SDK loops execute as bounded activities and return typed proposals. The policy service authorizes, and the ATS adapter performs, any consequential action. This remains true regardless of model provider or SDK.

## Current factual corrections and verification queue

- **Photon number model:** the current vendor pricing page says a Business dedicated line is project-dedicated and serves all project users; it does not imply one line per candidate. The same page currently lists `$250/line/month`. Treat both as dated vendor claims under source-register entry I06, not permanent economics.
- **Gmail scopes:** Google's current scope table lists `gmail.send` as sensitive and several broad mailbox scopes as restricted. Restricted-scope data stored or transmitted server-side may trigger an annual security assessment. Add the [official scope page](https://developers.google.com/workspace/gmail/api/auth/scopes) and [verification requirements](https://support.google.com/cloud/answer/13464321) to the source register before implementation.
- **Composio incident:** a May 2026 security incident was disclosed, but the handoff's `5,242 connections` wording should not be reused without resolving which exposed resource that number describes. Add the [vendor incident page](https://composio.dev/blog/composio-may-2026-security-incident) to the source register and use its exact current language.
- **Claude Agent SDK and alternate endpoints:** verify current SDK, permission, provider-routing, and endpoint behavior against official Anthropic and provider documentation at implementation time.
- **Photon alternatives, ATS source families, Apify pricing, Nango/Arcade capability counts, and every provider price:** volatile vendor claims; register and date the primary source before using them.

## Build-order correction

1. Legal, provider diligence, design partners, 100-form benchmark, threat model, tenancy, state, and event contracts.
2. Authentication, consent, approval service, outbox/inbox, audit, pause, and cancellation.
3. Career Vault, evidence provenance, voice policy, claim validation, and artifact versions.
4. Official Greenhouse discovery, stable job identity, indexed candidate retrieval, hard filters, and top-K queue.
5. Temporal application workflow and responsive dashboard read models.
6. One controlled Greenhouse path from fixture through confirmed receipt and uncertain-submit reconciliation.
7. Photon attached to the same command and approval APIs already proven through the PWA.
8. Lever, Ashby, routing/cost benchmarks, and carefully bounded rented-ingestion tests.
9. Gmail/recruiter inbox, broader ATS coverage, standing authorization, native mobile, and external MCP only after their phase gates.

## Documents that implement the accepted additions

- [Scale, cost, and capacity](../architecture/scale-cost-and-capacity.md)
- [Integrations and OAuth](../architecture/integrations-and-oauth.md)
- [System architecture](../architecture/system-architecture.md)
- [Model routing and evals](../architecture/model-routing-and-evals.md)
- [Job discovery](../architecture/job-discovery.md)
- [Roadmap](../execution/roadmap.md)
