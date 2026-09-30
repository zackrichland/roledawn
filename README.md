# RoleDawn

<p align="center">
  <img src="public/brand/roledawn-night-shift-machine.png" alt="RoleDawn night-shift application machine moving from night into dawn" width="100%" />
</p>

RoleDawn prepares and delivers job applications for one candidate. It uses the
candidate's approved facts and stories to write a résumé and cover letter,
fills the employer's form, and counts only the employer's confirmation as an
application receipt.

This is a private, single-account pilot. The existing acceptance record reports
two confirmed Greenhouse applications at one employer on 2026-09-30 UTC.
Lever has fixture coverage; Ashby prepares documents only. These records do
not establish support for every form or readiness for other users. Read the
[current state](docs/execution/current-state.md) and
[independent review](docs/execution/codex-review-2026-09-30.md) for the evidence,
local changes, and remaining rollout work.

## Home, Jobs, Profile

- **Home:** paste a job link, follow application progress, and resolve questions
  or emailed-code requests.
- **Jobs:** browse ranked catalog jobs, save a role, or start one named application.
- **Profile:** review résumé text, structured experience, stories, routine answers,
  preferences, and the optional read-only Gmail connection.

A named application's page shows its documents, research, progress, and next
action. Auto-apply chooses jobs under standing consent; autopilot delivers one
named application. The candidate can choose to review documents before sending.

## Architecture and authority

Next.js runs the web app on Netlify. Supabase Postgres owns candidate records,
immutable application inputs, approvals, workflow state, and receipts. Netlify
background lanes prepare documents and deliver applications. Browserbase hosts
the browser; the form agent operates through fixed, guarded tools.

Exact identity, employment, eligibility, and demographic answers come from the
candidate's structured records. Models draft prose and map eligible routine
questions to saved answers. They cannot grant submission permission or decide
that a side effect happened. Each attempt needs one sealed, single-use submit
permission tied to its exact answers and files. An uncertain submission must be
reconciled before another attempt. See the
[application playbook](docs/execution/application-playbook.md) and
[agent guide](AGENTS.md).

## Local development

Use Node.js 22 or newer and configure an ignored `.env.local` from
[`.env.example`](.env.example).

```bash
npm install
npm run dev -- --port 3001 --hostname 127.0.0.1
```

The local environment may point at the hosted database. `dev:full` and
`worker:*` consume real queued work and can send applications; keep
`ROLEDAWN_AUTOPILOT_ENABLED=false` locally unless a live send is intended.
Public Supabase configuration may reach the browser; secret keys and provider
credentials stay server-side.

New single-account sessions require the private access key. Ordinary Supabase
sessions and ownership checks still apply. The older automatic-login behavior
was removed; see [current state](docs/execution/current-state.md).

## Validation

```bash
npm test
npm run typecheck
npm run lint
npm run check:docs
node scripts/migration-harness.mjs supabase/checks/*.sql
npm run build
git diff --check
```

Stop the local development server before building. The SQL harness runs only
in local PGlite. Tests and a successful build establish local mechanics;
production deployment, account health, and employer acceptance require their
own evidence. [AGENTS.md](AGENTS.md) contains the migration and deployment
procedures, including the required `--build` deployment flag.

## Repository map

| Path | Purpose |
|---|---|
| `src/app/`, `src/components/` | Routes, actions, and product UI |
| `src/domain/` | Pure rules and typed contracts |
| `src/server/` | Database commands, writing, catalog, mailbox, browser adapters, and workers |
| `src/lib/supabase/` | Clients, session proxy support, and generated database types |
| `netlify/functions/` | Scheduled dispatch, background lanes, and worker health |
| `supabase/migrations/`, `supabase/checks/` | Forward-only database changes and local checks |
| `policies/application-writing/` | Owned writing policies read by the live writer |
| `scripts/` | Operator commands and scoped acceptance tools |
| `docs/` | Operating guides, decisions, architecture, and dated evidence |

Start with [founder directives](docs/execution/founder-directives.md), the
[playbook](docs/execution/application-playbook.md), and
[current state](docs/execution/current-state.md). The
[documentation map](docs/README.md) distinguishes active guidance from historical
acceptance. [CONTRIBUTING.md](CONTRIBUTING.md) covers changes and
[SECURITY.md](SECURITY.md) covers reporting a security issue.
