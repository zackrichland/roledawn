# Contributing to RoleDawn

RoleDawn is a private-account job-application tool with recorded Greenhouse delivery evidence. Contributions should increase clarity, safety, or testable product value without extending those claims beyond the verified path.

## Before changing anything

Start with [`AGENTS.md`](AGENTS.md), then follow its reading order and source-authority rules. It links the current founder directives, application playbook, state, decisions and board-specific guides. Research informs decisions; it does not silently override them.

## Local setup

```bash
npm install  # Node >= 22
npm run dev -- --port 3001 --hostname 127.0.0.1
```

Before opening a pull request:

```bash
npm test
npm run typecheck
npm run lint
npm run check:docs
node scripts/migration-harness.mjs supabase/checks/*.sql
npm run build
```

Stop the dev server before the build. Read the local-environment warning in
[`AGENTS.md`](AGENTS.md) before starting workers: `.env.local` points at the
hosted database, and local lanes can send real applications. The SQL harness
above runs in local PGlite without hosted access.

## Change standards

- Keep claims evidence-bound and put dated external claims in the source register.
- Label illustrative product data and distinguish prototypes from connected services.
- Preserve exact application facts; never manufacture experience or outcomes.
- Keep authorization deterministic and outside model or webpage control.
- Treat external submission as an idempotent, auditable, recoverable boundary.
- Put vendor behavior behind adapters and keep open vendor choices visibly open.
- Update the decision log when a change accepts, reverses, or materially narrows a consequential choice.
- Prefer compact Mermaid diagrams and repository-relative links.

## Commit and pull-request shape

Keep a change small enough to explain in one sentence and complete enough to verify. A pull request should state what changed, why, the user or developer impact, and the checks run. Architecture changes should name their failure behavior and reversal trigger, not only their happy path.

## Security issues

Do not open a public issue for a suspected vulnerability, exposed credential, privacy leak, or authorization bypass. Follow [`SECURITY.md`](SECURITY.md).
