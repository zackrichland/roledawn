---
title: Application Kit hosted acceptance
status: verified development evidence
owner: engineering
last_updated: 2026-08-16
environment: founder-owned HireWire development project
---

# Application Kit hosted acceptance

## Accepted outcome

**Verified live on 2026-08-16:** RoleDawn consumed one existing
`application.drafting_requested` message and committed one reviewable,
no-submit Application Kit for application
`681215c7-0d80-4420-ba13-c4af20296c0d`.

The accepted run is bounded to research, drafting, validation, rendering,
private persistence, and candidate download. It did not open an employer form,
create or consume approval, launch a browser/CUA session, upload to an ATS, or
submit an application.

Hosted migrations are recorded as
`20260817044053_harden_resume_candidate_scope` and
`20260817044103_application_kit_runtime`. Foreign-key and default-privilege
hardening followed in `20260817050040_cover_remaining_candidate_evidence_foreign_keys`
and `20260817050057_harden_default_database_privileges`. The 33-migration hosted
ledger and checked-in filenames align through `20260817050057`.

The performance advisor reports zero unindexed foreign keys. Its remaining
findings are 53 unused-index informational notices plus one Auth connection-
strategy informational notice. The security advisor reports eight intentional
RLS-enabled, no-policy service tables and 14 bounded authenticated
`SECURITY DEFINER` commands; leaked-password protection remains a pre-public-
signup platform setting. `commit_application_kit` runs as security invoker,
executes as `service_role`, and grants execution only to `service_role`.

## Hosted evidence

| Evidence | Accepted value |
|---|---|
| Preparation run | `559ec07c-5193-4fda-b3a7-a68be103095b`; `SUCCEEDED / COMPLETE` |
| Frozen input snapshot | `a6a98e45-305b-496f-bd46-754b870a2a4b`; 12 approved narrative-evidence refs and one exact-fact ref |
| Research bundle | `40df390d-2d4b-44bf-829f-f4d8b58ddf98`; official-job-posting research only |
| Current revision | `8e3c1680-39f7-4211-9157-f04582bdeaed`; application state `READY` |
| Revision provenance | Exactly 12 revision-evidence references and one revision exact-fact reference |
| Candidate artifacts | Exactly four private artifacts: tailored résumé PDF and DOCX plus cover-letter PDF and DOCX |
| Artifact QA | All four stored artifacts are `PASSED`; downloaded bytes matched stored size and SHA-256 values |
| Outbox | Published after two delivery attempts; `attempt_count = 2` and no retained error |
| Consequential side effects | Zero approval challenges, approval consumptions, application attempts, and receipts; no employer submission |

The application detail route exposes candidate-authorized downloads through a
short-lived signed URL after Auth, application ownership, current-revision, and
artifact checks. The Storage bucket remains private.

**Verified in the local authenticated browser:** application detail rendered
all four download links and the explicit text **No application has been
submitted.** with zero console errors. Reloading `/vault` showed the same
reviewed v1 résumé filename and text, confirming the current candidate read
path survives a fresh page load.

## Failure and replay proof

The first worker attempt failed closed before any revision or artifact was
committed because a PostgreSQL timestamp contained five fractional-second
digits and the strict RFC 3339 parser rejected it. The durable outbox retained
the message and recorded the failed attempt.

The timestamp was canonicalized at the server boundary and the same message was
retried. The second attempt recomputed the frozen input, research, citations,
semantic checks, rendered bytes, and hashes; then the service-only atomic
commit succeeded and the outbox message was published. The final hosted state
contains one research bundle, one revision, and four artifacts, not duplicate
rows from the retry.

**Accepted inference:** this demonstrates fail-closed replay for the observed
parser failure. It is not a general claim that every provider, renderer,
database, or network failure has been exercised.

## Validation boundary

The accepted worker path:

1. reloaded and hash-verified one immutable Application Input Snapshot;
2. produced a bounded research bundle from the official job posting;
3. called the server-only Terra drafting adapter with minimized, approved
   narrative evidence;
4. parsed strict structured output and ran deterministic writing checks;
5. ran the separate semantic-entailment gate;
6. merged candidate-attested exact facts outside the model boundary;
7. rendered PDF and DOCX bytes deterministically;
8. checked extraction, byte size, and SHA-256 for all four artifacts;
9. staged the bytes in private Storage; and
10. atomically committed the research bundle, revision, evidence/fact
    provenance, and artifact rows before acknowledging the event.

The accepted research release is limited to the official job posting. It does
not establish broader company research or current-company claims.

## Résumé persistence recheck

**Verified live on 2026-08-16:** after deployment of hosted migration
`20260817044053_harden_resume_candidate_scope`, the founder workspace contained
one candidate, one logical résumé, and one immutable source version. The
integrity audit found zero duplicate logical résumés, orphaned versions, broken
current-version selections, missing candidate review, missing Storage objects,
or inconsistent finalization state.

Candidate-facing reads for the logical source and source versions now require
both active workspace membership and the candidate's own `auth.uid()` identity.
Server queries also scope Career Vault reads and deletion preflight by workspace
and candidate. This preserves a successful parsed résumé across sessions until
the candidate explicitly replaces or deletes it.

This acceptance does not cover public hostile-file handling. Uploaded versions
remain truthfully marked `NOT_SCANNED`; public activation still requires
quarantine, malware scanning, isolated parsing, and recovery monitoring.

## Remaining boundary

- No recurring drafting scheduler or always-on consumer is deployed; the
  accepted worker is operator-invoked.
- No browser/CUA driver, ATS fill, upload, takeover, CAPTCHA flow, approval
  consumption, submit, reconciliation, or external receipt is connected.
- No eligibility or match engine admitted this role; this acceptance began
  from an already queued founder application.
- PDF and DOCX are usable, one-page, unclipped outputs, but their typography and
  spacing are not yet one shared visual system. Treat that as renderer v2
  polish, not an accepted design-fidelity claim.
- No public candidate should upload a résumé until quarantine, malware scanning,
  isolated parsing, retention, and operational recovery are deployed.

An application row, a `READY` revision, and downloadable files are preparation
evidence only. They are not proof that an employer received an application.
