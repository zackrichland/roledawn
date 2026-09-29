---
title: Candidate-profile hosted acceptance
status: verified live in HireWire development
owner: engineering
last_updated: 2026-08-12
---

# Candidate-profile hosted acceptance

## Verified run

**Verified live:** run `20260812195628` completed against the HireWire
development project on 2026-08-12 after all 21 forward migrations through
`20260812190000` were present in the remote ledger. All 13 required checkpoints
passed, and cleanup removed both ephemeral Auth users and their cascading
tenant data.

| Check | Preserved result |
|---|---|
| Anonymous denial | `PASS` — anonymous fact reads and profile commands were rejected |
| Two ordinary candidates | `PASS` — two normal sessions had separate personal workspaces |
| Create and replay | `PASS` — one command created one immutable version and replayed stable IDs |
| Payload mismatch | `PASS` — a reused command ID could not carry different input |
| Canonical policy | `PASS` — PostgreSQL owned sensitivity, exact-field policy, review, and verification metadata |
| Direct authenticated writes | `PASS` — ordinary sessions could not bypass the command |
| Candidate-self RLS | `PASS` — the owner read the exact fact and version |
| Cross-tenant denial | `PASS` — the second candidate read zero fact, version, or source rows |
| Append-only update | `PASS` — an edit appended a version and advanced the aggregate pointer |
| Stale write | `PASS` — a stale aggregate version returned non-retryable `PT409` |
| Unresolved sensitive answer | `PASS` — **I'm not sure** remained `NEEDS_REVIEW` and was not guessed |
| Version immutability | `PASS` — even the service role could not update or directly delete evidence versions |
| Service accounting | `PASS` — the service boundary accounted for exactly the two synthetic tenants |
| Cleanup | `PASS` — ephemeral users and cascading tenant data were removed |

This run verifies the current candidate-reviewed application-answer persistence
boundary: authenticated command authority, canonical policy, immutable versions,
RLS isolation, replay, optimistic concurrency, unresolved sensitive answers,
and cleanup. It does not verify résumé fact extraction, model drafting,
rendering, packet persistence, browser/CUA form fill, approval consumption,
employer submission, or receipts.

## Corrections made before the accepted run

Earlier harness-only attempts exposed three test-path defects. They did not
produce a passing result and are not product evidence.

- Workspace-name accounting used a synthetic label that did not match the
  bootstrap output. The assertion now checks the actual deterministic prefix.
- The recovery record crossed a serialization boundary with a non-serializable
  client field. Cleanup records now contain plain identifiers only.
- Stale candidate-fact input was reported as PostgreSQL `40001`, which can imply
  a retryable transaction conflict. Migration `20260812190000` returns explicit
  non-retryable `PT409` for stale versions and incomplete duplicate commands.

Run `20260812195628` is the preserved accepted result after those corrections.

## Safety gates and commands

The harness refuses to mutate unless the operator supplies the exact
acknowledgement, a project ref matching the configured Supabase hostname, real
public/server credentials, and prefix-constrained `acceptance.invalid` test
identities. Secrets remain in ignored `.env.local`.

```bash
RUN_HOSTED_CANDIDATE_PROFILE_ACCEPTANCE=I_UNDERSTAND_THIS_CREATES_TEST_DATA \
ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF=<exact-project-ref> \
npm run acceptance:profile
```

The run writes a mode-`0600` recovery record under ignored
`artifacts/acceptance/`. If normal cleanup cannot finish, use the exact record:

```bash
npm run acceptance:profile:cleanup -- \
  artifacts/acceptance/profile-<run>-cleanup.json
```

## Rerun triggers

Rerun this acceptance after changes to candidate-fact RLS, the key allowlist,
canonical sensitivity or usage policy, value normalization, review metadata,
command deduplication, optimistic versioning, append-only triggers, or tenant
cleanup.
