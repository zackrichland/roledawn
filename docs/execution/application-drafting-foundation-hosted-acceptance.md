---
title: Application drafting foundation hosted acceptance
status: accepted schema and provenance seam
owner: engineering
last_updated: 2026-08-16
---

# Application drafting foundation hosted acceptance

## Acceptance decision

**Accepted:** the hosted database can persist one application revision with its
exact input snapshot, research bundle, and cited evidence provenance. This is a
schema-level seam only; it does not accept a drafting or application-delivery
runtime.

## Hosted evidence

| Check | Result |
|---|---|
| Migration ledger | **Verified:** hosted migration `20260817025617_drafting_research_and_revision_provenance` is present. |
| Revision provenance | **Verified:** `application_revisions.input_snapshot_id`, `input_snapshot_hash`, `research_bundle_id`, and `research_bundle_hash` are all `NOT NULL`. |
| Valid transaction | **Verified:** one transaction inserted one research bundle for an exact input snapshot, one application revision, and 12 evidence references, then rolled back. |
| Invalid provenance | **Verified:** an insert with an invalid input-snapshot hash was rejected. |
| Cleanup | **Verified:** post-test counts were `0` research bundles, `0` revisions, and `0` revision evidence references. |
| Security advisor | **Verified:** 0 errors. |
| Performance advisor | **Verified:** 0 errors and 0 warnings. |
| Index information | **Expected:** unused-index informational findings remain while the new tables are empty; they are not evidence of a production performance defect. |

The rollback and zero post-test counts mean the acceptance test left no
drafting records behind.

## Boundary of this acceptance

This acceptance proves only that the hosted provenance contract accepts a
valid, exact-snapshot revision graph and rejects a mismatched snapshot hash. It
does **not** prove:

- model or research-provider output quality;
- semantic entailment between candidate evidence and generated claims;
- résumé or cover-letter rendering and byte finalization;
- candidate review or single-use approval;
- browser or CUA execution;
- employer submission, confirmation, reconciliation, or receipt evidence.

A production drafting consumer must earn separate acceptance for each of those
boundaries. Nothing in this record authorizes an employer-side effect.

## Code anchors

- Hosted schema: [drafting research and revision provenance migration](../../supabase/migrations/20260817025617_drafting_research_and_revision_provenance.sql)
- Frozen inputs: [application input snapshot domain](../../src/domain/application-input-snapshot.ts)
- Research contract: [application research domain](../../src/domain/application-research.ts)
- Revision contract: [application drafting domain](../../src/domain/application-drafting.ts)
- Server handoff: [drafting-context boundary](../../src/server/applications/drafting-context.ts)
- Hosted read adapter: [Supabase drafting-context reader](../../src/server/applications/supabase-drafting-context-reader.ts)
- Later, unaccepted artifact boundary: [application packet domain](../../src/domain/application-packet.ts)
