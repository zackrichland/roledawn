---
title: Career Vault hosted acceptance
status: verified live in HireWire development
owner: engineering
last_updated: 2026-08-12
---

# Career Vault hosted acceptance

## Verified run

**Verified live:** run `20260812170337` completed against the HireWire
development project on 2026-08-12 after all 18 forward migrations through
`20260812182500` were present in the remote ledger. Every required checkpoint
passed and cleanup removed both ephemeral Auth users, their tenant data, and the
tracked private Storage objects.

| Check | Preserved result |
|---|---|
| Two ordinary Auth users | `PASS` — isolated candidate sessions |
| Exact upload reservation | `PASS` — one replay-safe tenant path |
| Pre-upload isolation | `PASS` — second user could not read or use the path |
| Upload and finalization | `PASS` — byte size and source hash bound; scan truth remained `NOT_SCANNED` |
| Post-upload isolation | `PASS` — second user read neither rows nor original bytes |
| Deterministic extraction | `PASS` — parser provenance and reviewable text recorded |
| Candidate review | `PASS` — exact version promoted to `READY` |
| Optimistic lock | `PASS` — stale review rejected |
| Failed replacement | `PASS` — reviewed current version remained selected |
| Complete tenant isolation | `PASS` — zero cross-tenant document, version, extraction, or review rows |
| Deletion-pending uniqueness | `PASS` — a second résumé reservation was rejected during deletion |
| Deletion lifecycle | `PASS` — Storage removal and service purge removed the résumé |
| Cleanup | `PASS` — test users, tenant data, and tracked objects removed |

This run verifies the current Career Vault data lifecycle. It does not verify a
malware scan, parser process isolation, OCR, structured candidate facts, model
drafting, artifact rendering, browser/CUA form fill, employer submission, or an
employer receipt.

## Safety gates and command

The harness refuses to mutate unless the operator supplies the exact
acknowledgement, a project ref matching the configured Supabase hostname, real
public/server credentials, and prefix-constrained `acceptance.invalid` test
identities. Secrets remain in ignored `.env.local`.

```bash
RUN_HOSTED_CAREER_VAULT_ACCEPTANCE=I_UNDERSTAND_THIS_CREATES_TEST_DATA \
ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF=<exact-project-ref> \
npm run acceptance:vault
```

The run writes a mode-`0600` recovery record under ignored
`artifacts/acceptance/`. When normal cleanup cannot finish, the bounded recovery
command accepts only that exact record:

```bash
npm run acceptance:vault:cleanup -- \
  artifacts/acceptance/vault-<run>-cleanup.json
```

## Remaining boundary

PDF and DOCX parsing currently executes in the Next.js process. Input, archive,
page, text, decompression-ratio, and timeout limits reduce alpha risk but cannot
kill parser CPU or memory work. Before public upload traffic, move source bytes
through quarantine and malware scanning into a no-network, no-credential parser
process/container with enforced memory, CPU, and wall-clock limits and forced
teardown. Candidate review remains mandatory after extraction.
