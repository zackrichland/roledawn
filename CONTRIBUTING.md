# Contributing to RoleDawn

RoleDawn is currently a founder-led architecture and product prototype. Contributions should increase clarity, safety, or testable product value without making the repository look more complete than the system actually is.

## Before changing anything

Read these in order:

1. [`AGENTS.md`](AGENTS.md) for evidence and safety rules.
2. [`docs/00-founder-brief.md`](docs/00-founder-brief.md) for the current product decision.
3. [`docs/execution/decision-log.md`](docs/execution/decision-log.md) for accepted and rejected choices.
4. The specialized product or architecture document for the area being changed.

The newest accepted decision wins when documents conflict. Research informs decisions; it does not silently override them.

## Local setup

```bash
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run lint
npm run build
```

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

