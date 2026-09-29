---
title: Candidate matching acceptance
status: implemented and read-only hosted checks passed
last_updated: 2026-09-16
---

# Candidate matching acceptance

## Behavior

**Verified:** Applications recommendations scan the fresh, allowlisted shared catalog instead of ranking the first 24 visible jobs. Jobs remains the complete browsable inventory. Recommendations exclude prior applications and active passes; both history collections use cursor pagination rather than stopping at the API's first page.

The `roledawn-candidate-matching/1` policy uses saved target roles, countries, locations, work modes and employment types, plus current approved résumé evidence. It binds the candidate input epoch, search-profile version, reviewed résumé hash, approved evidence-version hashes and reviewed authorization versions into a reproducible profile hash. Selected decisions are persisted by the account auto-apply worker; advisory page reads are recomputed.

The matcher recognizes profession and title relationships, explicit skills and transferable work such as building applications, preparing a product roadmap and mapping a workflow. It returns reasons and `STRONG` / `POSSIBLE` bands. Its internal ordering points are not a calibrated percentage, hiring probability or proof of every job qualification. A candidate's name, demographics and contact details are not matching features.

Known preference contradictions and explicit sponsorship conflicts exclude a job from recommendations. Missing sensitive answers stay unknown. Stated clearance, unsupported mandatory credentials, uncertain work location and unsupported delivery destinations remain review items. Registered nursing does not imply advanced-practice or nursing-assistant qualifications. Saved targets take precedence over an older profession when a candidate changes direction.

Automatic selection additionally requires a strong, supported match and an implemented delivery destination. It filters eligible jobs **before** applying the result limit, so an Ashby or review-only result cannot starve a lower-ranked Greenhouse/Lever match. An incomplete catalog scan or a profile change during matching disables automatic eligibility. The enqueue transaction separately rechecks the current job version, content hash, freshness, profile epoch and active delegation.

## Acceptance on 2026-09-16

| Check | Measured result |
|---|---|
| Current shared catalog | All 5,879 fresh jobs scanned; complete result |
| Current candidate inputs | Reviewed résumé and 12 approved, current evidence passages read; no profile changes |
| Relevant recommendations | FDE and product-management roles; unrelated nurse, teacher and retail roles excluded |
| Transferable experience | Existing app-shipping and product-roadmap passages support the AI-product target without inventing a previous PM title |
| Strong supported result | Aledade: Senior Technical Product Manager (AI Data Platform), Remote |
| Strong preparation-only result | OpenAI: Forward Deployed Engineer, Gov; Ashby remains ineligible for automatic delivery |
| Warm read | 1.67 seconds locally against hosted Supabase, including fresh private-input reads |
| Cold read | 7.2 seconds locally against hosted Supabase for the full catalog |
| Authorization | Anonymous execute denied; authenticated workspace member reads 500-row page; nonmember denied; mismatched private workspace rejected |
| Side effects | No applications created, employer requests sent, candidate inputs changed or model calls made by matching acceptance |

The cold/warm measurements are one observed local run, not a service-level guarantee. Public job content alone is cached for up to 60 seconds. Private profile inputs and candidate history are freshly scoped on each read. Candidate features are compiled once per pass, role and work-mode mismatches are rejected before expensive description extraction, and skill expressions are precompiled.

Tests cover FDE, teaching, nursing, finance, career pivots, unrelated industry keywords, target changes, remote country/region restrictions, legacy comma-split locations, sponsorship alternatives, clearance, expired credentials, advanced-practice nursing, seniority, prior applications, provenance changes, catalog read failure, multi-page candidate history and more than 100 unsupported high-ranking jobs preceding a supported match.

```sh
node --test --experimental-strip-types src/domain/candidate-matching.test.ts src/server/opportunities/candidate-recommendations.test.ts
```

## Remaining limits

**Recommendation:** move shared inventory features and candidate recommendation runs into a durable read model as catalog/account volume grows. The current scan stops safely at 25,000 jobs; a partial scan cannot authorize automatic selection. Candidate history stops safely at 50,000 records per collection. Neither bound is advertised as unlimited coverage.

The deterministic vocabulary is deliberately finite and may miss transferable work expressed differently. Country/location normalization and credential interpretation are bounded; unknowns need review. Matching does not replace per-application factual checks, form eligibility, privacy policy, disclosure authorization or receipt evidence. Real-employer delivery acceptance remains separate from this read-only matching proof.

See [the catalog and hosting acceptance](catalog-and-hosted-workers-acceptance.md) and [the execution decision log](decision-log.md).
