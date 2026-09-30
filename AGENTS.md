# RoleDawn agent guide

RoleDawn applies to jobs for a candidate. A job arrives as a pasted link or a ranked match from the catalog (reviewed Greenhouse, Lever and Ashby boards). RoleDawn freezes the candidate's approved facts, writes a résumé and cover letter under `policies/application-writing/`, fills the employer's form in a Browserbase browser with a GPT form agent, submits once, and counts only the employer's own confirmation as a receipt. Next.js 16 runs on Netlify; Supabase Postgres is the source of truth; background lanes run as Netlify functions. **Verified:** Greenhouse works end to end (three confirmed applications across two employers, hosted readback 2026-09-30). Lever and Ashby have delivery adapters with fixture coverage; live employer acceptance remains unproven.

## Read first

1. [Founder directives](docs/execution/founder-directives.md): what the founder wants. Wins over older docs.
2. [Application playbook](docs/execution/application-playbook.md): the path of one application, Home statuses, operations, known gaps.
3. [Current state](docs/execution/current-state.md): what is live and what is broken.
4. [Decision log](docs/execution/decision-log.md): read the last 15 rows.
5. [Board templates](docs/boards/README.md) before touching any ATS's delivery.

When sources disagree: code and database (what is) > founder directives (what should be) > newest decision > playbook > current state > other docs. `CHANGELOG.md` and acceptance records are history, not instructions. [docs/README.md](docs/README.md) maps everything else.

## Commands

```bash
npm install                                   # Node >= 22
npm run dev -- --port 3001 --hostname 127.0.0.1   # web only; APP_BASE_URL expects 127.0.0.1:3001
npm test                                      # all unit tests; the script pins --test-concurrency=3
node --test --experimental-strip-types path/to/file.test.ts   # one file
npm run typecheck && npm run lint && npm run check:docs
npm run build                                 # stop the dev server first
node scripts/migration-harness.mjs supabase/checks/<name>.sql   # migrations + one SQL check in local PGlite
npm run ops:status                            # read-only production snapshot; -- --watch, -- --app <id>
npm run deploy                               # sets deployment ID, then deploy --build --prod; no dev server
```

`npm test -- --test-concurrency=3` does nothing: Node ignores test flags placed after the file list.

### Hosted migrations

1. Add `supabase/migrations/<UTC timestamp>_<name>.sql` and `supabase/checks/<name>.sql`; pass the harness.
2. Run a temporary copy wrapped in `begin;` … `commit;`: `npx supabase db query --linked -f <copy>`.
3. `npx supabase migration repair --status applied <version> --linked`.
4. Read it back with a read-only query (table, columns, functions, grants).
5. Regenerate types: `npx supabase gen types typescript --linked --schema public > src/lib/supabase/database.types.ts`. Never hand-edit that file. It marks every SQL parameter without a default as non-null, so assert nullable arguments at the call site with a comment.

Never run `npx supabase db push`: eight 2026-08-19 migrations are recorded remotely under different versions, so push misreads history. The CLI's temporary login role sometimes fails (status 544, 401); retry.

## Repo map

| Path | What lives there |
|---|---|
| `src/app/` | Routes. Home = `/dashboard`, Jobs = `/search` and `/saved`, Profile = `/vault/*`, one application = `/applications/[id]`. Signed-in pages sit in the `(candidate)` route group. |
| `src/components/` | UI by area: `home`, `jobs`, `profile`, `vault`, `applications`, `onboarding`, `opportunities`, `ui`, `app`. |
| `src/domain/` | Pure rules and types, no I/O: matching, writing lint, question and autopilot contracts. |
| `src/server/` | I/O: Supabase reads and commands, OpenAI, Browserbase, Gmail adapters. `applications/` writes and renders documents; `ingestion/` and `opportunities/` build the catalog; `vault/`, `candidate/`, `resume/` hold Profile data; `mailbox/` reads employer codes; `ai/models.ts` picks the model per task. |
| `src/server/workers/` | Background lanes (below). Delivery: `application-delivery-driver.ts` (one step at a time), `application-delivery-browser.ts` (network guard, uploads, submit, receipt), `agents-browser-tools.ts` and `agents-aria-combobox.ts` (read and fill controls), `standing-answers.ts`, `worker-events.ts`. |
| `src/lib/supabase/` | Clients and generated `database.types.ts`. |
| `src/proxy.ts` | Next 16 request proxy (formerly middleware): refreshes the Supabase session. |
| `netlify/functions/` | Durable commands and completed stages wake due lanes; `worker-dispatch` (every minute) recovers missed wakes; `worker-background` runs one leased lane. |
| `supabase/migrations/`, `supabase/checks/` | Forward-only SQL; SQL tests for the harness. |
| `policies/application-writing/` | The writing rules the drafting model reads. Change writing behavior here first. |
| `docs/boards/` | One template per ATS: how its form works and where automation breaks. |
| `scripts/` | Operational CLIs: ops status, migration harness, lane runners, catalog seeding, acceptance runs. |

| Lane | Entry in `src/server/workers/` | Job |
|---|---|---|
| catalog | `job-source-batch-worker.ts` | Poll reviewed boards |
| preparation | `outbox-worker.ts` | Import pasted links; freeze inputs |
| kit | `application-kit.ts` | Research, write, check, render five files |
| auto-apply | `auto-apply.ts` | Pick matches under the candidate's standing consent |
| autopilot | `application-autopilot.ts` | Fill, answer, submit once, emailed code, receipt |
| cleanup | `hosted-worker.ts` | Send intents, provider sessions, stale uploads |

Words: **auto-apply** chooses jobs; **autopilot** delivers one named application; a **send intent** is "send when ready", turned off by "Let me review before it's sent".

### Legacy: do not extend

- Legacy does not mean unused: `eval:writing`, full-stack acceptance, and `worker:service` still import these modules. Check scripts, tests, cleanup and recovery callers before deleting them.
- Scripts only, not reached from any production entry point: v1 drafting (`application-drafting-pipeline.ts`, `openai-drafting-adapter.ts`, `application-kit-renderer.ts`) and the no-submit fill runner (`application-fill-resume.ts`, `application-fill-runtime-supervisor.ts`, `browserbase-runtime.node.ts`, `npm run worker:fill`).
- Reachable but off in production (`ROLEDAWN_FORM_DRIVER=agents`): the deterministic no-submit fill path (`application-fill.ts`, `greenhouse-no-submit-driver.ts`, `ApplicationFillAuthorization`, `/applications/[id]/live-view`).
- Live writing path: `application-writing-pipeline.ts`, `application-writer.ts`, `drafting-context-v2.ts`, `application-documents-render.ts`.

## Where form answers come from

In order: (1) profile facts through anchored label rules (`application-field-facts.ts`); (2) remembered candidate answers to the same wording and candidate input version, bound to the same frozen job except explicit GPA/degree questions; fresh forms within the same send also recall original replies (D-122/D-143); (3) standing answers, the candidate's saved answers to routine questions, copied verbatim for an exact text question or mapped to new wordings in one model call (`standing-answers.ts`, table `candidate_standing_answers`, D-117/D-141); (4) the candidate, through "Answer N questions" on Home. Every stored answer is labeled `CANDIDATE`, `REMEMBERED` or `STANDING`, with its basis. Saving a standing answer (`save_candidate_standing_answer`) re-queues the candidate's sends that wait on questions. The worker and the database apply the same rule for which questions a standing answer may take; change them together. D-125 permits an explicitly saved yes/no answer only for the exact active TS/SCI-with-FSP-or-CI question; code and SQL match it directly, and its reserved basis never enters model inference.

## Invariants

- The database and workflow engine are the source of truth, not model memory or chat history.
- One sealed, single-use submit permission per attempt, bound to one named application and the exact answers and files that were read back (`begin_application_autopilot_submit`). A retry gets a new key (`autopilot:<id>:<n>`) and a new permission. Never loosen this.
- Reconcile an uncertain outcome before any new send. Unknown is not failed. Record `NOT_ACCEPTED` only when the employer explicitly refused (D-111).
- Only the employer's own response is a receipt. A model never decides that a submission or any other side effect happened.
- No CAPTCHA solving or evasion. A visible final-click check opens the guarded browser inside RoleDawn for the candidate, up to five minutes (D-144); the worker then rechecks exact values and files.
- Exact facts (name, contact, employers, titles, dates, work authorization, EEO answers) come from structured, provenance-linked candidate records, never from a model or an embedding. Vector retrieval supports narrative only.
- Models read forms, map questions to the candidate's own saved answers, and draft prose. They never authorize themselves, change policy, or infer a sensitive answer the candidate hasn't given. Demographic and qualification answers need candidate facts. Explicit saved delegation handles consent, terms, attestations and signatures deterministically (D-136); record exact employer wording.
- Answers belong to one candidate and are never shared or inferred across candidates.
- Keep pause, cancel, archive, export and delete paths working. Provider IDs and secrets stay server-side behind adapters.
- Every public table has RLS. `SECURITY DEFINER` functions set `search_path = ''` and use qualified names.
- Every external side effect has an approval, idempotency key, audit record and recovery path.

## Gotchas

- Board lessons: add one dated line to `docs/boards/<id>.md`, then promote it to `BOARD_CONTEXT` (`src/domain/board-agent-context.ts`, at most 10 bullets and 900 characters; only Greenhouse, Lever and Ashby reach a live prompt) by the README rules (D-132).
- Stop and retry copy comes from `src/domain/application-stop-guidance.ts`; add a stop code there instead of inline copy. Try again shows only for MANUAL classes; Verify here reopens a zero-attempt check inside RoleDawn. An unknown outcome never retries (D-133/D-144).
- Employer logos are cached per (provider, board) in `employer_logos`; pass the apply URL, not the canonical URL, to `CompanyLogo`. Until the migration is applied the route falls back to live fetching (D-134).
- Interface fonts are the SF system stack with Inter; the serif is only `--font-document` for the résumé preview. Use the tokens in `globals.css` and keep motion under `prefers-reduced-motion` (D-135).
- Never deploy without `--build`. On 2026-09-29 a no-build deploy served 404s for every script and exposed build files.
- Stop the dev server before `npm run build` or a deploy; the build corrupts `.next/dev`.
- Netlify reads changed environment variables only on the next deploy. Hosted workers see only `HOSTED_WORKER_ENVIRONMENT_KEYS` (`src/server/workers/hosted-worker-environment.ts`); files read at runtime also need `netlify.toml` `included_files` and `next.config.ts` `outputFileTracingIncludes`.
- Lanes run only on the published production deploy with `ROLEDAWN_HOSTED_WORKERS_ENABLED=true` and a 64-hex-character dispatch secret.
- Ashby autosaves approved fields before final submission; exact GraphQL operations and server echoes are part of the sealed review. A stopped run can leave an employer draft (D-123).
- Ashby may rotate its action ID after a verified save and refetch widget metadata. Admit only reviewed constants; nonempty location searches still need approved city text. Keep failure/response diagnostics to static codes and capped counts, never request or response values (D-126/D-131).
- Ashby's submit click disables inputs before dispatch. Final readback must still compare exact current values/files before permission; ordinary filling must refuse disabled controls. Replays must include the real pre-dispatch callback (D-130).
- Ashby's native Enterprise tokens use exact `ENT===` / `UNIVERSAL_ENT===` prefixes. Check images load during the unsent submit before Live View opens; challenge answers still require the candidate's bounded window (D-145).
- Playwright frame URLs can lag behind DOM iframe sources. Empty URLs grant no trust. Passive anchors need exact reviewed origin/path/key and invisible mode; idle challenge documents need exact origin/path/key and a hidden iframe. Recheck current visibility and URLs at final readback; visible challenges and unapproved frames stop (D-127/D-128/D-139).
- The hosted browser is Linux Chrome. Page scripts differ by platform: React Select marks options `aria-selected` on Linux but not on a Mac, which hid a required GPA field only in production (2026-09-30). Reproduce form bugs with a Linux user agent and a `navigator.platform` override.
- Read native `maxLength`; reject oversized text before writing and let the agent revise narrative prose. A changed limit changes the sealed field fingerprint (D-143).
- Existing question/code reads and recovery controls stay available when new sends are disabled; narrative questions receive approved document evidence before the form-agent turn. Lever omits only unverified parser values from initially empty optional company/location system slots (D-140).
- Greenhouse answers every cloud-browser submission with HTTP 428 and emails an 8-character code; the worker reads it from the candidate's read-only Gmail within about 8 minutes, or Home shows "Enter code". Testing-mode Google tokens expire about weekly (Inference).
- Opening React Select menus is slow (about 22 s per full inspection); menu reads are cached while a control's visible state is unchanged (D-104).
- Saving a candidate fact, résumé or evidence item bumps `candidates.application_input_version`, invalidates older sends and pauses auto-apply. D-121 includes published career/voice/story edits; extraction/interview metadata and standing answers do not bump it. Don't edit facts during a live run.
- Single-account sign-in: `https://roledawn.netlify.app/auth/test-session?key=<ROLEDAWN_TEST_ACCESS_KEY>`. Without the key: "This RoleDawn workspace is private."
- `.env.local` points at the hosted database. Local `dev:full` and `worker:*` compete with production lanes and can send real applications; keep `ROLEDAWN_AUTOPILOT_ENABLED=false` locally unless you mean to send.
- Workers, scripts and tests run under `node --experimental-strip-types`: use relative imports with `.ts` extensions there. `@/` imports and `import "server-only"` belong only in code that Next alone loads.
- OpenAI credit exhaustion is terminal (`MODEL_CREDITS_EXHAUSTED`); a 429 rate limit remains transient. Browserbase HTTP 402/429 appear as `DELIVERY_BROWSER_QUOTA_EXHAUSTED` / `DELIVERY_BROWSER_CONCURRENCY_LIMIT`.
- Tests are timing-sensitive under load. Keep concurrency at 3 and rerun a failing file alone before debugging it.
- The GitHub repository is public. Never commit secrets, tokens, personal data or the founder's private details (employers, answers); name variables, not values.
- Founder directive 11 pre-approves deploys, hosted migrations and settings. If your tool's permission mode still blocks one, say so in one line and stop; don't route around it.

## Verify a change end to end

1. Local: `npm test`, typecheck, lint, `check:docs`; the migration harness for SQL; `npm run build` with the dev server stopped.
2. Ship: apply migrations as above and read them back; regenerate types; deploy.
3. Watch one live run: paste a Greenhouse link on Home (or Try again), then `npm run ops:status -- --app <id>` until it reads Applied, Stopped, or needs you. Worker events show each send's duration and stop reason. Real employer submissions are acceptable tests (directive 8).
4. Ad hoc hosted reads: a file that starts `begin transaction read only;` and ends `rollback;`, run with `npx supabase db query --linked -f <file>`. Never select tokens, codes or document contents. Prefer a migration or an RPC over hand-written hosted writes; if you must write, wrap it in a transaction, scope it by id, and note it in current state.
5. Record: update the playbook or current state when behavior changes, and add a decision-log row (date, status, rationale, reversal trigger) for consequential changes.

## Evidence and writing

- Label claims **Verified** (seen in code, data or a live run), **Inference**, **Recommendation**, **Hypothesis** or **Open question** when status isn't obvious.
- Dated external claims and primary URLs go in `docs/research/source-register.md`. Vendor or founder claims, scraped client code, reviews and search snippets are not independent facts; treat volatile facts (prices, models, APIs, policies, market metrics) as stale until rechecked.
- Never invent traction, customer outcomes, logos, domain availability, pricing validation, security certifications, ATS support or partnerships. Name the outcome exactly: application, recruiter response, interview, offer, hire.
- No-slop pass for customer copy and generated materials: keep the writer's voice and strongest concrete facts; use direct verbs and stable nouns; cut throat-clearing, scene-setting, fake quotes, empty superlatives, excessive fragments, summaries and generic AI language; don't manufacture opinions, specificity or evidence; read it aloud.
- Don't copy or redistribute third-party skill text; recreate the behavior as an internal, licensed policy and evaluation suite before launch.
- Docs: descriptive headings and compact tables; Mermaid for systems and state machines, with prose authoritative; repository-relative links; update `last_updated`; keep MVP, later phase and out of scope distinct.

### Before you finish

- Check numeric and competitor claims against the source register.
- Search for unsupported guarantees: `guarantee`, `unlimited`, `fully autonomous`, `all ATS`, `zero risk`.
- Confirm no sensitive field can be generated from an embedding or guessed by a model.
- Confirm landing proof stays gated until real, consented evidence exists.
- Run `npm run check:docs` and eyeball Mermaid blocks you touched.

## Keeping this file useful

- Stay under 200 lines. Commands and gotchas come first; every line must be specific enough to act on or check.
- Link to the owning doc instead of copying it. If a fact lives in two places, delete one.
- Change this file in the same commit as the change that makes a line wrong. Add each lesson as one line with its date or decision ID; delete lines that stop being true.
- One file serves Codex and Claude Code. If a tool needs `CLAUDE.md`, make it the single line `@AGENTS.md`. Add a nested `AGENTS.md` only where a folder has different rules.
- Leave the generated Next.js block below unchanged; `next dev` rewrites it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
