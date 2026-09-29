---
title: Reviewed job-source expansion
last_updated: 2026-09-16
status: verified-source-review-and-local-implementation
---

# Job-source expansion — September 16, 2026

## Evidence and scope

**Verified:** 25 public employer boards responded successfully and their complete JSON payloads normalized through the existing Greenhouse, Lever, and Ashby adapters without issues. These observations contain 5,881 listed postings. This is the summed source observation on this date, **not a production catalog count**, unique vacancy count, or a claim that every posting remains open. Counts include non-US postings. The registry covers teaching, clinical and mental healthcare, food service, retail, manufacturing, logistics, finance, operations, and technology; it is not representative of the entire labor market.

The [reviewed registry](../../data/job-sources/reviewed-2026-09-16.json) stores exact board identity, observation time, response size, and primary evidence URLs. Board ownership labels come from Greenhouse's board metadata or the provider-hosted board title. Only public GET endpoints were contacted. No candidate information, employer application, or hosted database write was involved in this verification.

## Verified public sources

| Employer / board label | Provider | Sector | Observed listed postings | Primary listing feed |
|---|---|---|---:|---|
| [Achievement First (Teaching)](https://job-boards.greenhouse.io/achievementfirst) | Greenhouse | K–12 education | 66 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/achievementfirst/jobs?content=true) |
| [Aledade PBC](https://jobs.lever.co/aledade) | Lever | Primary healthcare | 36 | [Public JSON](https://api.lever.co/v0/postings/aledade?mode=json) |
| [Anthropic](https://job-boards.greenhouse.io/anthropic) | Greenhouse | AI technology | 607 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true) |
| [Chime Financial, Inc](https://job-boards.greenhouse.io/chime) | Greenhouse | Financial services | 70 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/chime/jobs?content=true) |
| [CookUnity](https://job-boards.greenhouse.io/cookunity) | Greenhouse | Food production and culinary | 156 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/cookunity/jobs?content=true) |
| [DoorDash USA](https://job-boards.greenhouse.io/doordashusa) | Greenhouse | Local commerce and operations | 465 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/doordashusa/jobs?content=true) |
| [Duolingo](https://job-boards.greenhouse.io/duolingo) | Greenhouse | Education technology | 83 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/duolingo/jobs?content=true) |
| [Everlane](https://job-boards.greenhouse.io/everlane) | Greenhouse | Retail and apparel | 47 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/everlane/jobs?content=true) |
| [Figure](https://job-boards.greenhouse.io/figureai) | Greenhouse | Robotics and manufacturing | 103 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/figureai/jobs?content=true) |
| [HelloFresh](https://job-boards.greenhouse.io/hellofresh) | Greenhouse | Food production and logistics | 444 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/hellofresh/jobs?content=true) |
| [Included Health](https://jobs.lever.co/includedhealth) | Lever | Healthcare | 62 | [Public JSON](https://api.lever.co/v0/postings/includedhealth?mode=json) |
| [Instacart](https://job-boards.greenhouse.io/instacart) | Greenhouse | Grocery and commerce | 108 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=true) |
| [Lyra Health](https://jobs.lever.co/lyrahealth) | Lever | Mental healthcare | 558 | [Public JSON](https://api.lever.co/v0/postings/lyrahealth?mode=json) |
| [Notion](https://jobs.ashbyhq.com/notion) | Ashby | Workplace software | 128 | [Public JSON](https://api.ashbyhq.com/posting-api/job-board/notion?includeCompensation=true) |
| [OpenAI](https://jobs.ashbyhq.com/openai) | Ashby | AI technology | 818 | [Public JSON](https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true) |
| [Oscar Health](https://job-boards.greenhouse.io/oscar) | Greenhouse | Health insurance | 292 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/oscar/jobs?content=true) |
| [Palantir Technologies](https://jobs.lever.co/palantir) | Lever | Enterprise software | 313 | [Public JSON](https://api.lever.co/v0/postings/palantir?mode=json) |
| [Ramp](https://jobs.ashbyhq.com/ramp) | Ashby | Financial technology | 145 | [Public JSON](https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true) |
| [Rocket Lab Corporation](https://job-boards.greenhouse.io/rocketlab) | Greenhouse | Aerospace and manufacturing | 525 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/rocketlab/jobs?content=true) |
| [Spotify](https://jobs.lever.co/spotify) | Lever | Music and media | 69 | [Public JSON](https://api.lever.co/v0/postings/spotify?mode=json) |
| [sweetgreen](https://job-boards.greenhouse.io/sweetgreen) | Greenhouse | Food service | 63 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/sweetgreen/jobs?content=true) |
| [Talkspace](https://job-boards.greenhouse.io/talkspace) | Greenhouse | Mental healthcare | 19 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/talkspace/jobs?content=true) |
| [Toast](https://job-boards.greenhouse.io/toast) | Greenhouse | Hospitality technology | 325 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/toast/jobs?content=true) |
| [WelbeHealth](https://job-boards.greenhouse.io/welbehealth) | Greenhouse | Healthcare and elder care | 139 | [Public JSON](https://boards-api.greenhouse.io/v1/boards/welbehealth/jobs?content=true) |
| [Zoox](https://jobs.lever.co/zoox) | Lever | Transportation and robotics | 240 | [Public JSON](https://api.lever.co/v0/postings/zoox?mode=json) |

**Excluded:** SpaceX and Anduril had live feeds, but their full content responses exceeded the existing 20 MB source-safety limit. Brightwheel and Deel returned no postings during this check. Missing, empty, oversized, and unverified boards were not seeded. Resource limits protect one ingestion request; they do not impose a candidate browsing limit or truncate an accepted feed. A future larger-feed adapter must retrieve a provably complete snapshot before it can use absence as closure evidence.

## Primary API contracts checked

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): public GET endpoints expose board metadata and job posts; `content=true` includes description, department and office fields. The full-list response includes `meta.total`, which must match the received list when supplied.
- [Lever Postings API](https://github.com/lever/postings-api): global and EU public listing endpoints expose postings; `skip` and `limit` constrain a page. The catalog requests the unfiltered complete list. A caller-selected single page is never accepted as a complete snapshot.
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api): the board name comes from the hosted board URL; `isListed=false` postings must not appear in a public listing. The existing adapter preserves that flag, and the database excludes them from the open catalog.
- [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions): hosted Cron plus `pg_net` can invoke functions and Vault can retain their credentials. **Decision:** retain the existing Node ingestion runtime for this launch and invoke its batch from the separately configured Netlify scheduled/background worker. A second Deno ingestion implementation is unnecessary.

## Implemented behavior

- `register_reviewed_job_sources` is service-only, bounded, idempotent by provider/tenant, and preserves an existing source's paused, blocked, or review state. The local seed defaults to review-only. New reviewed sources poll daily; existing source settings stay intact.
- `runJobSourceBatchWorker` drains only due work through the existing row leases. Two concurrent polls and a ten-minute claim budget are defaults. Each source gets its own durable ingestion run. Successful boards commit despite another board's failure. Lost commit responses remain uncertain and are recovered through their durable run/lease.
- A scheduled sweep should wake every 15 minutes. The database's daily `next_poll_at` prevents unnecessary source requests, while transient failures use 15/30/60-minute exponential retry intervals capped at six hours. Nonretryable errors wait 24 hours. Scheduling and deployment are a separate operational step; local tests do not prove a hosted daily run.
- Reclaiming an expired source lease marks its abandoned `RUNNING` record failed before creating a replacement. A valid conditional 304 refreshes last-seen timestamps without creating job versions; an unsolicited 304 is rejected.
- Complete authoritative snapshots preserve stable listing identity and immutable content-version deduplication. Duplicate IDs, malformed records, mismatched Greenhouse totals, single Lever pages, non-authoritative responses, and partial snapshots cannot close jobs.
- A drop below half the previously open/stale set—including an empty board—marks missing rows stale, disables conditional caching for that source, and requires the same complete listing set at least six hours later before closure. Ordinary complete-snapshot removals close immediately. Explicit unlisted state remains nonpublic.
- A source outage never proves closure. Jobs not observed for seven days become stale. A fresh verified listing can reopen them. Candidate catalog statistics expose aggregate counts and refresh times only, after the same personal-workspace candidate authorization used by Search.

## Local validation and deployment seam

**Verified locally:** 44 ingestion/source-worker tests pass. The complete forward migration executes in PostgreSQL-compatible PGlite and [rollback acceptance](../../scripts/job-catalog-refresh-acceptance.sql) passes registry replay/pause preservation, exclusive leases and crash recovery, immutable version deduplication, stale/304 recovery, corroborated empty-board closure, incomplete snapshot rejection, retry backoff, and restricted grants. The acceptance uses synthetic rows and ends with `ROLLBACK`; this does not establish hosted behavior.

Review the registry with `node --experimental-strip-types scripts/seed-reviewed-job-sources.ts`. After the migration is applied to the verified project, seed with the same command plus `--env-file=.env.local` before the script path and `--apply` after it. The production batch entry point is `src/server/workers/job-source-batch-worker.ts`; the equivalent local command is `node --experimental-strip-types --env-file=.env.local scripts/run-daily-job-catalog.ts`. Secrets stay in the server environment. Neither seed nor batch has run against the hosted project as part of this source review.
