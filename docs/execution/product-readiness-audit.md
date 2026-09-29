---
title: Product readiness audit
status: verified founder-alpha snapshot; not a production-readiness claim
owner: product and engineering
last_updated: 2026-09-16
---

# Product readiness audit

## Current assessment — 2026-09-16

**Verified:** the 25-source catalog holds 5,879 fresh open roles; stream pagination and mobile layout were checked in the browser. Hosted Supabase plus real OpenAI Agents and Browserbase completed one synthetic application, saved one receipt and acknowledged all test-session cleanup. The flow now includes missing-answer continuation, upload acknowledgment, multi-page navigation, single-use dispatch and receipt capture.

Netlify deployment, schedule activation and final checks are recorded in [hosting acceptance](catalog-and-hosted-workers-acceptance.md). Writing repair and actual prose verification are recorded in [writing acceptance](application-writing-repair-acceptance.md). Direct upload uses authenticated private Storage with an immutable selected-file hash.

**Recommendation:** treat this as a production-hosted pilot, not broad launch readiness. Real-employer completion, wider ATS coverage, calibrated ranking, malware isolation, latency/cost monitoring and external security review remain open. Missing candidate facts stay unresolved. No real employer submission occurred during these checks.

The August assessment below is historical. Its counts, ratings and statements that submission is unbuilt do not describe the current implementation.

## Historical founder-alpha assessment — 2026-08-18

RoleDawn now has a coherent founder-alpha foundation across Candidate
Intelligence, Opportunity Intelligence, and Application Delivery. A new user
can create an account, complete a gated profile, persist a reviewed résumé,
search a live catalog, see a plain-language fit assessment, start an
application, and enter the durable preparation pipeline.

The product still cannot send an employer application end to end. The worker
service is implemented and passed a live local health run against HireWire, but
it is not deployed. Browserbase has now passed a controlled eight-field/two-file
fill and the real Anthropic Greenhouse form reached a zero-disclosure
`TAKEOVER`. No candidate has completed that takeover, and Submit, employer
confirmation, and receipts remain unbuilt.

**Founder-alpha judgment on 2026-08-18: 7.5/10. Production judgment: 4/10.**
These are product judgments, not customer outcomes. A 10/10 score is the
release bar below, not a claim about the current product.

## What was verified on 2026-08-18

| Evidence | Result |
|---|---|
| Hosted schema | All 45 checked-in migrations are present in HireWire, including application-quality enforcement, onboarding/search profiles, Browserbase binding, retained-runtime release reconciliation, and stale-packet refresh |
| Guided onboarding | Desktop and 390 px browser checks passed; progress, résumé persistence, exact-answer collection, and the database completion gate render correctly |
| Current founder packet | A stale packet was rejected and refreshed; current revision v2 matches the candidate input epoch and has four private QA-passed artifacts |
| Catalog | The live worker refreshed 464 open jobs from one allowlisted Anthropic Greenhouse source; the catalog holds 480 jobs and 492 immutable versions |
| Fit explanation | Search and Saved use candidate preferences plus verified eligibility facts to return `Good fit`, `Needs review`, or `Eligibility issue`; no fabricated percentage is shown |
| Worker process | Catalog, preparation, kit, and fill lanes all reported ready; one catalog run completed with 464 observations; the other lanes were safely idle |
| Browser Live View | Candidate ownership, active-session state, provider binding, and Browserbase URL validation pass six focused tests; the hosted binding is service-role only |
| Controlled cloud fill | Eight reviewed ordinary fields read back and two private hash-verified PDFs uploaded; Submit stayed disabled and outbound submission requests stayed at zero |
| Real-form safety | The actual UI-to-database-to-Browserbase path opened the Anthropic Greenhouse form and stopped on two protected/legal fields before disclosure: 0 fields, 0 uploads, 0 outbound submission requests, no submission attempt, and no receipt |
| Repository acceptance | The integrated suite, TypeScript, ESLint, production build, Markdown links, and whitespace checks are release gates; this document records the final focused shutdown and documentation checks below rather than preserving an older test count |

Current hosted counts:

| Record | Count or state |
|---|---:|
| Candidates | 1 `ONBOARDING` |
| Résumé documents / versions | 1 / 1 |
| Evidence items | 17: 12 verified, 5 need review |
| Jobs / open jobs / job versions | 480 / 464 / 492 |
| Applications | 1 founder application with a current release-2 revision and retained takeover/fail-safe history |
| Research bundles / revisions / artifacts | Historical and refreshed immutable versions; current artifact set is 4 QA-passed files |
| Fill attempts / computer sessions | Durable history now exists for the real-form no-submit run |
| Submit attempts / receipts | 0 / 0 |
| Pending / dead-lettered outbox rows | 0 / 0 |

These counts prove persisted development state. They do not prove unattended
hosting, broad résumé compatibility, real ATS compatibility, submission, or
delivery.

## The 10/10 release bar

| Category | Current grade | A 10/10 requires | Release blocker |
|---|---:|---|---|
| Account and onboarding | 8/10 | Email and Google sign-in, preserved deep links, resumable setup, exact-answer completeness, accessibility acceptance, and recovery support | Google code is ready, but the hosted provider remains off until the founder accepts Google's User Data Policy and creates credentials; fresh-user acceptance remains open |
| Candidate Intelligence | 7.5/10 | Representative PDF/DOCX acceptance, OCR, malware quarantine, parser isolation, story/voice review, export, deletion, and retention controls | Scanned and hostile files stop; uploads remain `NOT_SCANNED` |
| Opportunity Intelligence | 7/10 | Several reviewed sources, scheduled freshness, closure alerts, watchlists, impressions/passes, transparent ranking, and measured recommendation quality | Only one company source is live; fit runs at read time and is not persisted |
| Application quality | 8.5/10 | Fresh release-2 hosted kits across a blind role corpus, cited company research beyond the posting, editable review, visual document QA, and measured unsupported-claim/edit rates | One refreshed release-2 kit passed after strict claim/citation consistency was fixed; a representative quality corpus is still missing |
| Worker automation | 7/10 in code; 3/10 in operations | Deployed consumers, queue-lag and stuck-work alerts, dead-letter controls, cost/latency metrics, safe rollouts, and runbooks | The long-running service has been proven locally but has no host |
| Employer-form fill | 6/10 | Real founder-owned ATS completion to review, deterministic read-back, exact upload hashes, guarded candidate intervention, TTL cleanup, and a representative failure fixture suite | Controlled fill passed and a real form failed closed correctly; candidate intervention and completed real-form fill remain open |
| Submit and proof | 1/10 | Immutable pre-submit diff, single-use candidate approval, idempotent submit, ambiguous-state reconciliation, employer confirmation evidence, and a trustworthy receipt | No submit authority or reconciliation worker exists |
| Trust, privacy, and security | 7/10 | Threat model, malware boundary, secret rotation, production RLS/RPC review, leaked-password protection, retention controls, incident response, and external testing | Current Supabase advisor warnings still need production disposition |
| Candidate UX | 8/10 | Full established-account route acceptance, compact mobile Search, useful progress, secure takeover, pre-submit review, and clear recovery for every failure | The onboarding gate is clean; the employer handoff is not yet usable |

No category should be labeled 10/10 until its acceptance evidence exists. Tests,
schemas, and diagrams do not replace candidate outcomes.

## Three-system status

### 1. Candidate Intelligence

Working now:

- Supabase Auth creates one personal workspace and one candidate record.
- First-run routing preserves the requested destination and sends incomplete
  candidates to `/onboarding`.
- A four-step setup collects the reviewed résumé, job goals, exact application
  answers, and a final readiness check.
- The database, not the page, decides whether onboarding is complete.
- PDF and DOCX source bytes, extracted text, candidate edits, facts, evidence,
  citations, and review history persist under candidate-scoped RLS.
- Missing or uncertain sensitive answers remain unresolved. The model cannot
  guess them.

Still weak:

- Scanned PDFs require OCR; hostile and complex documents need a larger
  acceptance corpus.
- Malware scanning, quarantine, isolated parsing, export, retention, and full
  deletion operations are not production-ready.
- Candidate stories and voice need an explicit review flow before models may
  use them.

### 2. Opportunity Intelligence

Working now:

- A long-running worker can lease and refresh reviewed sources independently
  from application work.
- One allowlisted Anthropic Greenhouse source produced 464 current open jobs in
  the latest live run.
- Canonical jobs, immutable versions, source observations, closure rules,
  ETags, Search, Saved, and replay-safe queueing are durable.
- Candidate search preferences and verified work-authorization facts feed a
  deterministic fit assessment.
- Fit labels use plain reasons. Missing facts become `Needs review`; only an
  explicit sponsorship or clearance conflict becomes `Eligibility issue`.

Still weak:

- Lever and Ashby adapters exist but have no live recurring source acceptance.
- The catalog is one company's board, not a market-wide feed.
- Fit is calculated at read time. Ranking, watchlists, impressions, passes,
  learning, and recommendation-quality measurement remain open.

### 3. Application Delivery

Working now:

- Preparation freezes one exact job version, reviewed résumé, approved
  evidence/fact versions, candidate input epoch, and policy releases.
- Drafting uses a server-only Responses adapter with strict structured output.
  Deterministic truth checks and a separate entailment pass run before files
  are persisted.
- Exact facts are merged outside the model. Four private PDF/DOCX artifacts,
  hashes, QA results, provenance, and material changes are durable.
- A single-use fill permission is bound to one immutable revision and cannot
  authorize Submit.
- The worker materializes only approved exact facts and verified private bytes.
- Browserbase runs through a provider adapter with exact-origin controls,
  CAPTCHA solving disabled, a DOM/network submit interlock, recovery leases,
  and redacted checkpoints.
- The candidate Live View route checks candidate ownership before a service-only
  provider lookup and exposes no provider ID or API key.

Still weak:

- One refreshed release-2 Application Kit is accepted in hosted HireWire, but
  only for the founder dogfood application.
- Company research is still mostly the official posting.
- The real Anthropic form reached the no-disclosure takeover boundary, not the
  completed fill-to-review boundary.
- The retained runtime and release reconciliation worked, but no candidate has
  completed the protected/legal takeover interaction.
- Submit, uncertain-state reconciliation, employer confirmation, and receipts
  do not exist.

## If a candidate signed up today

| Step | Candidate experience |
|---|---|
| Create account | Email magic link works and bootstraps durable candidate data. Google code is ready, but the button remains hidden until the founder completes Google's policy agreement, creates credentials, and enables the hosted provider. |
| Complete setup | The four-step onboarding flow resumes until the database says the profile is ready. |
| Upload résumé | A text PDF or DOCX persists and can be reviewed after reload. Scanned/image-only PDFs stop with a clear OCR requirement. |
| Find work | The candidate can search 464 current open jobs, save one, paste a supported link, and see transparent fit reasons. Coverage is narrow. |
| Start application | The application and work request are committed atomically. A deployed worker would then prepare it; no worker host exists yet. |
| Receive files | The refreshed founder pipeline produced a current release-2 revision with four private QA-passed files after strict claim/citation validation. Broader output-quality evidence is still needed. |
| Fill form | A controlled cloud form filled 8 fields and uploaded 2 verified PDFs. The real Anthropic form stopped safely at 2 protected/legal fields before disclosing anything; candidate takeover is not yet complete. |
| Submit | The product stops. The candidate cannot yet send or receive a submission receipt. |

The honest answer is that a new user can reach durable application intent and,
with an operator-run worker, a reviewable kit. They cannot turn on autopilot and
expect applications to reach employers today.

## Architecture choice

RoleDawn uses deterministic services for identity, exact facts, state,
idempotency, approvals, files, browser authority, and audit. Models handle
bounded interpretation, research, drafting, and semantic checks. This is the
right split.

The OpenAI Agents SDK is not required for the current single-call drafting
tasks. It becomes useful when company research and unfamiliar-form handling
need several specialists, typed handoffs, resumable sessions, and traces. Even
then, the agent must remain inside the durable workflow. It cannot become the
source of truth or grant itself authority.

## Next release sequence

1. Complete and accept the candidate takeover interaction for the two
   protected/legal fields that stopped the real Anthropic form, then resume the
   same attempt to the no-submit review boundary.
2. Deploy `worker:service` on a long-running host. Add queue lag, source
   freshness, stuck-work, failure, model-cost, and browser-minute alerts.
3. Expand the real-form fixture suite and run a founder-owned Greenhouse form
   with no protected/legal blocker to the no-submit review boundary. Record
   field read-back and exact uploaded-file hashes.
4. Exercise candidate close, TTL, worker-loss, and provider-telemetry failure
   paths against the deployed retained-runtime supervisor.
5. Add the separate pre-submit approval, idempotent submission, ambiguous-state
   reconciliation, confirmation evidence, and receipt state machine.
6. Add two more reviewed job sources, persist fit assessments, and measure the
   quality of ranking against candidate decisions.
7. Add OCR, malware scanning, isolated parsing, retention/export/delete, and a
   representative document fixture suite.

The first external release claim should be narrow:

> A candidate can set up a verified profile, choose a job, receive cited
> application materials, watch a temporary browser fill the employer form,
> take over when needed, and approve one exact submission.

Do not call the product autonomous until the separate Submit and reconciliation
path has passed live acceptance.

## Related documents

- [Architecture at a glance](../architecture/architecture-at-a-glance.md)
- [Three-system product architecture](../architecture/three-system-product-architecture.md)
- [Application quality system](../architecture/application-quality-system.md)
- [Backend build status](backend-build-status.md)
- [Current state](current-state.md)
- [Application fill foundation acceptance](application-fill-foundation-acceptance.md)
- [Browserbase live no-submit acceptance](browserbase-live-acceptance.md)
