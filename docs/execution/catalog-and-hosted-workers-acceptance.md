---
title: Catalog and Netlify worker acceptance
status: verified production-hosted pilot; wider launch acceptance remains open
last_updated: 2026-09-16
---

# Catalog and Netlify worker acceptance

## Product scope

RoleDawn now exposes a replenished catalog instead of a single fixed page. The main navigation is **Profile**, **Jobs**, and **Applications**. Jobs retains search and saved views, progressively fetches 24-card cursor pages, deduplicates overlap, supports explicit retry, and shows catalog size and freshness. A daily cohort uses stable job IDs so a large employer's latest import does not occupy every first-page slot.

**Verified in HireWire:** 25 reviewed employer boards, 5,879 open jobs, no active stuck imports, and no last-poll error across those sources after the initial expansion. Twenty-four new sources have daily polling intervals; the existing Anthropic source retained its prior six-hour configuration. Healthcare, education, finance, retail, food service, aerospace and technology roles are represented. Source-level volume is not evidence that every role matches a particular candidate or can be submitted by the current delivery adapter.

**Verified in the browser:** 24 → 48 distinct posting links; nursing search returns a full page; a 390 px viewport has no horizontal clipping. A SQL transaction confirmed 14 employers across the first 24 unfiltered jobs and no overlap with the next page. Freshness filtering requires an enabled source and a job seen within seven days. Saved decisions survive loading additional pages.

## Import behavior

The reviewed registry is [reviewed-2026-09-16.json](../../data/job-sources/reviewed-2026-09-16.json). Each entry records its official board and review provenance. Seeding preserves an existing source's pause, policy, and cadence. Add a reviewed source to this file, run `npm run catalog:seed` to inspect the plan, then `npm run catalog:seed -- --apply` to upsert it. The source register and [expansion research](../research/job-source-expansion-2026-09-16.md) document primary endpoints.

A worker batch claims at most 100 due sources, with two polls in parallel and a ten-minute budget. Database leases prevent duplicate ownership. Expired imports are recoverable, failures back off independently, and HTTP 304 refreshes source/job freshness. Incomplete feed reads never close missing jobs. A drop exceeding half the previous feed requires two matching complete snapshots at least six hours apart before closures; pending closure clears ETags so a subsequent 304 cannot stand in for confirmation.

The scheduled dispatcher checks every minute. The catalog lane wakes at most every 15 minutes to process sources whose own daily or existing shorter interval is due. This is recurring replenishment, not an infinite inventory guarantee.

## Netlify operation

Project: [roledawn.netlify.app](https://roledawn.netlify.app), site ID `eab49f07-8421-4a4c-9de1-713011fd3ab8`, team `zackrichland`. The web adapter is Next.js 16.3.5 with Netlify Next runtime 5.15.13. This deployment uses the current local working tree; it does not create a Git commit or configure automatic Git deploys.

| Component | Responsibility |
|---|---|
| `worker-dispatch` | Short scheduled due-work lookup; dispatch fixed lane names with a secret |
| `worker-background` | Claim one database lane lease and run bounded catalog, preparation, kit, autopilot or cleanup work |
| `worker-health` | Authenticated, no-store view of durable lane status, counters and redacted failures |
| `hosted_worker_lanes` | Shared lease, start/finish timestamps, completion counters and result authority |

Only production with `ROLEDAWN_HOSTED_WORKERS_ENABLED=true` dispatches work. Netlify restricts schedules to its published deploy; scheduled invocations were observed to report `context.deploy.published=false` even for that deploy, so the dispatcher checks the production context and flag. Its authenticated background receiver additionally requires `published=true` and receives requests at the permanent site URL. A build-only environment variable is not used as the runtime gate. The dispatcher URL is a validated HTTPS site origin; requests cannot supply candidate IDs, URLs, scripts or policy overrides. A 202 response means accepted for background handling, not completed work. Each lane holds a 15-minute database lease and must acknowledge completion under its own token. Existing outbox and application attempt leases still enforce domain-level ownership.

Cleanup isolates browser/runtime cleanup, old Agents sessions, and expired/cancelled résumé uploads so one provider failure does not block unrelated private-file removal. Uncertain results, invalid counters, provider errors and lost completion acknowledgments cannot report healthy completion.

## Runtime configuration and recovery

Public Supabase variables must exist during the Next build and use direct `process.env.NEXT_PUBLIC_*` references. Worker and app service keys remain server-only in application code: Supabase service key, OpenAI key, Browserbase key and the 64-hex dispatch secret. Do not place them in browser bundles, repository configuration, logs, or health responses. The current legacy Free Netlify account requires all-scope environment variables: granular scope selection and Secrets Controller options did not persist. Values are restricted to the production deploy context; they are available to trusted build/function infrastructure and must never use a NEXT_PUBLIC prefix. No paid plan upgrade was made. The deployed sign-in callback is allowlisted in Supabase alongside the existing localhost development callbacks.

For routine rollout, validate with `npm test`, `npm run typecheck`, `npm run lint`, `npm run check:docs`, `git diff --check`, and a Netlify build. Publish the checked working tree with the Netlify CLI. Runtime environment changes require a new deploy. Verify `/login`, an unauthenticated 401 on worker health, an authenticated health read, and durable worker completion after an actual scheduled tick.

To pause worker dispatch, set `ROLEDAWN_HOSTED_WORKERS_ENABLED=false` and deploy. Candidate pause/cancel remains application-scoped. Changing the flag stops future invocations; it does not undo a request already sent to an employer. Never reset an uncertain submission into the submit queue: inspect its attempt and receipt evidence and use reconciliation. A crashed worker's lease expires; normal claims recover eligible work. Inspect `last_error_code`, failed counts, queue lag and dead letters before retrying. Database/service credentials are required for operational inspection; candidate clients cannot read worker lanes.

## Acceptance evidence

- Hosted rollback SQL: source refresh/closure/retry rules, scoped autopilot claims, terminal drafting failures, direct-upload hash and ownership, worker lease collision and service-only ACLs.
- [Full-stack delivery](application-autopilot-acceptance.md): actual Agents API and Browserbase, saved missing answer, two acknowledged uploads, one synthetic submit, one hosted receipt, acknowledged provider cleanup and 20 zero-count tenant cleanup checks. No employer application was sent.
- [Writing evaluation](application-writing-repair-acceptance.md): teacher and nursing accepted by the frozen live evaluator; finance blocked on incomplete source attachment. This is a documented reliability limit, not a three-for-three quality claim.
- [Direct résumé upload](../research/direct-resume-upload-2026-09-16.md): real 7 MB DOCX uploaded through authenticated private Storage, cross-tenant read/write denied, hash/extraction/finalization/replay accepted, and both synthetic accounts and file cleaned up.
- Final automated snapshot: 508 tests passed; TypeScript and ESLint passed. Netlify production build and upload succeeded; the final auth/worker regression group passed 10 checks. The dependency audit reported zero known vulnerabilities.

**Verified hosted browser upload:** a disposable candidate signed in on `roledawn.netlify.app`, selected a 7,340,032-byte DOCX, uploaded directly to private Storage, saw 360 extracted characters and the `Needs review` state, then saved the review. Onboarding advanced to Job goals with the résumé step complete. The test then signed out; the source, private blob, workspace and Auth user were cleaned, with 20 scoped absence checks passing. A production-only callback-origin defect was found and fixed before this acceptance: successful auth now returns to the configured permanent origin rather than a temporary Netlify deploy hostname.

**Verified runtime configuration:** all 12 required production environment variables were independently read back; service-key and provider-key equality were checked without logging values. The authenticated health endpoint returned 200 and enabled=true; unauthenticated access returned 401. A manual catalog wake returned 202 and then persisted SUCCEEDED with a matching finished timestamp. The published browser assets (57 files) contained none of the four private keys checked. The first automatic scheduled tick on the corrected deployment dispatched cleanup at 2026-09-17 00:51:08 UTC, and its database lease recorded SUCCEEDED with zero failures. No manual cleanup invocation was used for this proof. The final published deployment is `6aab394fe2d64d70001b7328`; catalog refresh remains on its normal due-source cadence. This verifies scheduler-to-worker execution, while the next full daily source refresh occurs on its configured future schedule.

## Remaining pilot limits

The concrete employer delivery adapter targets US Greenhouse hosted boards. Lever and Ashby catalog ingestion does not imply their application forms are supported. Real-employer end-to-end acceptance, remote/virtualized custom menus, CAPTCHA/account handoff, broader reusable answer memory and explicit employer/task evidence relationships remain open. Ambiguous facts and unsupported citations can stop drafting; saved exact profile facts are reused.

The application has no evidence of a recruiter response, interview, offer or hire from these tests. Before public launch, add measured failure/latency/cost alerts, a larger representative form and writing corpus, malware isolation and external security review. Current Supabase advisors report intentionally restricted RLS tables and authenticated SECURITY DEFINER command surfaces, plus disabled leaked-password protection. These are recorded review items; an advisor scan is not a security certification. Unused indexes were retained because this pilot has little representative traffic.
