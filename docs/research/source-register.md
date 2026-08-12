---
title: Research source register
status: active evidence index
last_updated: 2026-08-12
accessed_at: 2026-08-06 unless otherwise stated; backend architecture, Supabase, and ATS endpoint sources refreshed 2026-08-12
---

# Source register

## How to use this file

This register records the sources behind the founder plan. It is not a bibliography that makes every claim equally reliable.

Evidence classes:

- **Primary documentation:** official API, legal, regulatory, or product documentation.
- **Direct observation:** unauthenticated public page, response header, store page, or client asset inspected live.
- **Company claim:** marketing, founder, vendor, or company-profile statement; useful but not independently audited.
- **Research/report:** named methodology or sample, still subject to population and survey limitations.
- **User report:** anecdotal review or discussion; a hypothesis source, not prevalence evidence.
- **Historical mirror:** volatile or noncanonical copy; corroborate before relying on it.

Recheck product features, prices, model names, policies, domains, and APIs before shipping or publishing.

## Tsenta product, company, and stack

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| T01 | [Tsenta homepage](https://tsenta.com/) | Direct observation / company claim | Hero, workflow, 50,000+ pages, channels, ATS breadth, logo wall, pricing | Feature/traction/outcome claims are first-party |
| T02 | [Messaging](https://tsenta.com/messaging) | Direct observation / company claim | iMessage and WhatsApp positioning | Does not identify provider |
| T03 | [Start](https://tsenta.com/start) | Direct observation | Public messaging entry | Phone numbers and flow may change |
| T04 | [Mobile](https://tsenta.com/mobile) | Company claim | Cloud execution after app closes; review/autopilot | Marketing claim |
| T05 | [MCP](https://tsenta.com/mcp) | Direct observation | Remote MCP/OAuth and client setup | MCP access does not establish ATS submission rights |
| T06 | [AI disclosure](https://tsenta.com/ai-disclosure) | Primary company disclosure | ATS list, workflow, channels, pricing, AI uses | Company-maintained disclosure |
| T07 | [Privacy policy](https://tsenta.com/privacy) | Primary company legal page | Fly.io/Postgres, Cloudflare, Firebase, OpenAI/Anthropic, PostHog/Sentry, email/OTP, payments, data categories | Describes stated policy, not an audit |
| T08 | [Terms](https://tsenta.com/terms) | Primary company legal page | User responsibility, third-party ATS, no employment guarantee | Recheck effective date |
| T09 | [Changelog](https://tsenta.com/changelog) | Direct observation / company claim | Review Before Submit rollout | Volatile product state |
| T10 | [LLM-readable product summary](https://tsenta.com/llms-full.txt) | Company claim | Workflow and GEO strategy | Marketing corpus |
| T11 | [Dashboard login](https://dashboard.tsenta.com/login) | Direct observation | Google/email/messaging sign-in | Walkthrough stopped before account creation |
| T12 | [Resume onboarding client asset](https://dashboard.tsenta.com/assets/page-DAR5C0Zr.js) | Direct observation | PDF limit, parse/draft/match behavior | Hashed asset is volatile |
| T13 | [Additional onboarding client asset](https://dashboard.tsenta.com/assets/page-CpATaclr.js) | Direct observation | Profile fields and approval/optimization settings | Hashed asset is volatile; code presence is not proof every path is active |
| T14 | [YC company profile](https://www.ycombinator.com/companies/tsenta) | Company claim hosted by YC | Founders, origin, batch, self-reported users/interviews | Traction numbers are company-supplied, not audited YC measurements |
| T15 | [Chrome Web Store](https://chromewebstore.google.com/detail/tsenta/momaobilceffibifldnhndcehhdjgaob) | Direct observation | Visible distribution/rating signal | User count is rounded and changed across crawls |
| T16 | [Apple App Store](https://apps.apple.com/us/app/tsenta/id6760728258) | Direct observation / user reports | Rating, reviews, privacy-label comparison | Reviews are anecdotal; store values drift |
| T17 | [Tsenta founding engineer role](https://jobs.ashbyhq.com/Tsenta/6f260369-fb1b-4025-abd3-ec48c2087c14) | Primary company recruiting page | TypeScript/Node and 19+ ATS browser-automation work | Hiring needs do not prove every current implementation detail |
| T18 | [Historical Tsenta engineering role mirror](https://www.hireskys.com/jobs/software-engineering-intern-ai-automation-961) | Historical mirror | Playwright/CDP, AdonisJS, Prisma, BullMQ, Redis, Mastra, DeepSeek, pgvector leads | Medium confidence; original page was unavailable |
| T19 | [Founder retrospective](https://www.linkedin.com/posts/agnay_it-looks-like-a-virus-is-what-one-activity-7436761488599433217-KucT) | Founder claim | Pivot from distrusted local browser to visible controls | Anecdotal founder framing |
| T20 | [Tsenta user: honest/aggressive behavior](https://www.reddit.com/r/Tsenta/comments/1vdxo9n/honest_or_aggressive_application/) | User report | Fabrication/correction risk hypothesis | Anecdote; verify through product tests |
| T21 | [Tsenta user: cancel queued applications](https://www.reddit.com/r/Tsenta/comments/1uk8uqo/feature_request_cancelling_applications_halfway/) | User report | Queue cancellation need | Anecdote and time-sensitive response |
| T22 | [Tsenta user: email connection feedback](https://www.reddit.com/r/Tsenta/comments/1uei1vw/love_the_idea_some_feedbacks/) | User report | Dedicated inbox/forwarding hypothesis | Anecdote |
| T23 | [Main dashboard client bundle](https://dashboard.tsenta.com/assets/index-B-f0vzcm.js) | Direct observation | Application state strings, `ELECTRON`/`CLOUD` target strings, dashboard-library signals | Hashed asset is volatile; exposed strings do not prove every path is currently active |
| T24 | [Tsenta homepage](https://tsenta.com/) and [dashboard login](https://dashboard.tsenta.com/login) response headers captured 2026-08-06 | Direct observation | Vercel/Next.js marketing and Vercel/Vite dashboard delivery signals | Header snapshots were inspected live but are not archived in this repository |
| T25 | [Founder-provided authenticated onboarding screenshot manifest](evidence-manifests/tsenta-authenticated-onboarding-2026-08-11.md) | Direct observation | Six-step post-resume intake, completion offer, and first signed-in dashboard observed 2026-08-11 | Authenticated screenshots are not published; visible selections may reflect user choices, parser output, or defaults |

## Market and behavior

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| M01 | [LinkedIn 2026 talent/job-search research](https://news.linkedin.com/en-us/2026/LinkedIn-Research-Talent-2026) | Company research | Looking-for-role, AI intent/use, preparedness | Review methodology/population before quoting in marketing |
| M02 | [Employ candidate survey release](https://www.globenewswire.com/news-release/2025/06/24/3104152/0/en/Report-Reveals-Candidates-Perspectives-on-Using-AI-in-the-Hiring-Process.html) | Company research, 1,500-person survey | Burnout and AI-use signals | Press release; consult underlying report for publication |
| M03 | [Gartner candidate AI trust research](https://www.gartner.com/en/newsroom/press-releases/2025-07-31-gartner-survey-shows-just-26-percent-of-job-applicants-trust-ai-will-fairly-evaluate-them) | Research press release | 26% trust and AI application use | Survey context matters; not job-agent-specific |
| M04 | [Howdy job-hunter survey](https://www.howdy.com/blog/job-hunter-survey) | Company research, 812-person survey | Agent use and motivations | Vendor study; read methodology before external publication |
| M05 | [Handshake Class of 2025](https://joinhandshake.com/network-trends/class-of-2025-graduation/) | Platform research | Entry-level postings and applications-per-role pressure | Handshake network population |
| M06 | [Handshake Class of 2026 AI outlook](https://joinhandshake.com/research/economic-research/class-of-2026-ai-outlook/) | Platform research | Senior AI-use behavior | Student population and platform methodology |
| M07 | [Handshake Class of 2026 outlook](https://joinhandshake.com/network-trends/class-of-2026-outlook/) | Platform research | AI/job-market context | Confirm exact statistics in report before marketing use |
| M08 | [NACE Class of 2026 offer data](https://www.naceweb.org/about-us/press/2026/more-than-two-out-of-five-of-college-class-of-2026-had-a-job-offer-in-hand-by-graduation) | Research association release | 44% with at least one offer | Graduate population/sample definition applies |
| M09 | [New York Fed college labor market](https://www.newyorkfed.org/research/college-labor-market) | Primary economic research dashboard | Recent-graduate labor-market context | Time series updates; cite retrieval date |
| M10 | [Pew mobile fact sheet](https://www.pewresearch.org/internet/fact-sheet/mobile/) | Research | U.S. smartphone ownership by age | Smartphone ownership is not iMessage preference |
| M11 | [Piper Sandler teen survey](https://www.pipersandler.com/teens) | Company research | iPhone share in teen sample | Teen/investor sample; not launch-ICP proof |
| M12 | [Handshake job-search resource study](https://joinhandshake.com/blog/network-trends/trends-in-resources-gen-z-uses-for-job-hunting/) | Platform research | Network/community versus social channel hypothesis | Older study and student population; recheck before planning spend |

## Competitors

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| C01 | [Simplify Copilot](https://simplify.jobs/copilot) | Company claim | Autofill/tracking archetype | Recheck current compatibility and pricing |
| C02 | [Simplify feature/pricing help](https://help.simplify.jobs/en/help/articles/5623502-whats-included-in-simplify-features-and-pricing) | Company documentation | Simplify+ comparison | Volatile pricing |
| C03 | [Sorce pricing](https://www.sorce.jobs/articles/sorce-pricing) | Company claim | Swipe/auto-apply archetype | Traction claims first-party |
| C04 | [LoopCV pricing](https://www.loopcv.pro/pricing/index.html) | Company claim | Continuous-search pricing | Volatile pricing |
| C05 | [JobCopilot](https://www.jobscopilot.ai/) | Company claim | Set-and-forget agent archetype | Marketing behavior, not independent reliability evidence |
| C06 | [Sonara](https://www.sonara.ai/) | Company claim | Continuous matching/volume story | Marketing claim |
| C07 | [Scale.jobs pricing](https://scale.jobs/pricing) | Company claim | Human-managed application service | Volatile package details |
| C08 | [Teal](https://join.tealhq.com/) | Company claim | Career workspace archetype | Recheck current product surface |
| C09 | [LazyApply](https://lazyapply.com/) | Company claim | Volume-oriented automation archetype | Recheck platform behavior and terms |

## Product and design references

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| V01 | [Viktor homepage](https://viktor.com/) | Direct observation / company claim | Oversized headline hierarchy, finished-output proof, product scenes, comparison states, repeated calls to action | Visual reference only; do not copy assets, trade dress, claims, or “AI hire” framing |
| V02 | [Viktor brand guidelines](https://viktor.com/brand) | Primary company brand documentation | Verified official palette, typography, logo, mockup, and voice boundaries | Defines Viktor's identity, not a RoleDawn design license |
| CL01 | [Clay homepage](https://www.clay.com/) | Direct observation / company claim | Floating navigation, tactile full-bleed two-column hero, early proof mosaic, use-case tabs, 1,216 px-wide rounded feature chapters, infrastructure/case-study proof, learning/community mosaic, and final landscape CTA observed 2026-08-06 | Visual reference only; computed styles and observed structure are a point-in-time page state, not permission to copy trade dress, artwork, customer marks, or claims |
| CL02 | [Displaay: Roobert](https://displaay.net/typeface/roobert/) | Primary type-foundry documentation | Confirms Roobert as the commercial family corresponding to the inspected `Roobertvf` page styles and establishes the licensing boundary | Do not copy or ship font files without the appropriate license; RoleDawn uses Manrope through `next/font` unless a later recorded decision changes the token |
| X01 | User-provided `agent-platform-handoff-spec.md`, SHA-256 `1d1eb03f9d6cdc196d103536900b6b8ea0cfc1360264cd795dc5dfcbd4ac51a3` | External advisory artifact | Multi-tenancy, messaging, MCP, OAuth, model, discovery, and sequencing proposals | Reconciled claim by claim; not authoritative and not independently sourced; original file is intentionally not published |

## Messaging and agent-runtime options

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| I01 | [Apple iMessage developer overview](https://developer.apple.com/imessage/) | Primary platform documentation | Distinguish Messages extensions/business features | Does not provide a general server-side personal-agent API |
| I02 | [Apple Messages for Business support](https://support.apple.com/en-sg/102053) | Primary platform documentation | User-initiated branded business channel behavior | Regional page; platform policy may change |
| I03 | [Apple Messages for Business privacy](https://www.apple.com/ca/legal/privacy/data/en/messages-for-business/) | Primary legal/platform documentation | Privacy behavior | Regional legal page |
| I04 | [Apple `MSConversation`](https://developer.apple.com/documentation/messages/msconversation) | Primary platform documentation | Messages extension boundary | App extension is not background server API |
| I05 | [Photon](https://photon.codes/) | Vendor claim | Managed iMessage pilot option | New/vendor-dependent product; diligence required |
| I06 | [Photon pricing](https://photon.codes/pricing) | Vendor claim | Alpha/business cost hypothesis; page observed 2026-08-06 described a $250/month Business dedicated line serving one project and its users | Volatile vendor quote; capacity, fees, number model, ownership, and platform status require written confirmation |
| I07 | [Photon iMessage chat adapter](https://www.npmjs.com/package/@photon-ai/chat-adapter-imessage) | Vendor package documentation | Unified adapter integration | Verify package maintenance and security |
| I08 | [Photon architecture article](https://photon.codes/blog/how-photon-built-one-of-the-most-stable-and-enterprise-ready-imessage-apis) | Vendor claim | Device/EKS architecture and scale claims | Not independently verified |
| I09 | [BlueBubbles server architecture](https://docs.bluebubbles.app/server) | Project documentation | Self-hosting/Mac dependency | Not recommended for multi-tenant production |
| I10 | [BlueBubbles private API installation](https://docs.bluebubbles.app/private-api/installation) | Project documentation | SIP/library injection risk | High operational/platform risk |
| H01 | [Hermes Agent](https://hermes-agent.ai/) | Project/vendor documentation | Prototype runtime capabilities | Does not establish production multi-tenant suitability |
| H02 | [Hermes Agent GitHub](https://github.com/hermes-agent-org/hermes) | Primary open-source repository | Memory/tools/browser/channels/cron/sandbox evaluation | Pin and audit exact commit before use |

## Brand screening

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| N01 | [USPTO Trademark Search](https://tmsearch.uspto.gov/) | Primary government search tool | Exact `ROLEDAWN` wordmark query performed 2026-08-06 returned no result; the search tool exposes no stable result URL | No exact result is not legal clearance; similar/common-law/state/international marks still require counsel |
| N02 | [Verisign RDAP: `roledawn.com`](https://rdap.verisign.com/com/v1/domain/roledawn.com) | Primary registry response | Returned HTTP 404/no domain object on 2026-08-06 | Not a reservation or legal right; status can change immediately |
| N03 | [Identity Digital RDAP: `roledawn.ai`](https://rdap.identitydigital.services/rdap/domain/roledawn.ai) | Primary registry response | Returned HTTP 404/no domain object on 2026-08-06 | Not a reservation or legal right; registry/operator behavior can change |
| N04 | [Google Registry RDAP: `roledawn.app`](https://pubapi.registry.google/rdap/domain/roledawn.app) | Primary registry response | Returned HTTP 404/no domain object on 2026-08-06 | Not a reservation or legal right; status can change immediately |
| N05 | [Identity Digital RDAP: `roledawn.co`](https://rdap.identitydigital.services/rdap/domain/roledawn.co) | Primary registry response | Returned HTTP 404/no domain object on 2026-08-06 | Not a reservation or legal right; registry/operator behavior can change |

## ATS APIs and partnerships

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| A01 | [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html), verified 2026-08-11 | Primary API docs | Public unauthenticated `GET /v1/boards/{board_token}/jobs`; `content=true` adds full description, departments, and offices; job-post `id` is the application target | The employer-key requirement applies to POST, not GET; public discovery does not grant RoleDawn submission authority |
| A02 | [Greenhouse Candidate Ingestion API](https://developers.greenhouse.io/candidate-ingestion.html) | Primary API docs | Approved sourcing partner path | Not universal candidate submission |
| A03 | [Greenhouse MCP](https://www.greenhouse.com/product-features/greenhouse-mcp) | Primary product page | Employer-governed MCP | MCP does not confer arbitrary-employer permission |
| A04 | [Lever Postings API](https://github.com/lever/postings-api), verified 2026-08-11 | Primary API docs | Global/EU `GET /v0/postings/{site}` discovery, `mode=json`, `skip`/`limit`, provider IDs, hosted/apply URLs, workplace fields, and optional salary fields | Only published postings are exposed; internal postings are excluded; POST requires an employer API key and is a separate authorization boundary |
| A05 | [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api), verified 2026-08-11 | Primary API docs | `GET /posting-api/job-board/{board}` for currently published jobs; optional `includeCompensation`; hosted/apply URLs; `isListed=false` means direct-link-only | The public field table does not document a stable job ID; public discovery is not candidate submit authority |
| A06 | [Ashby application submit](https://developers.ashbyhq.com/reference/applicationformsubmit-1) | Primary API docs | Employer-credential submit constraint | Intended for authorized careers experiences |
| A07 | [Ashby MCP](https://docs.ashbyhq.com/ashby-mcp-server-beta) | Primary product docs | Organization-permission MCP | Not arbitrary candidate access |
| A08 | [Workday authentication](https://developer.workday.com/documentation/zwx1518028675482) | Primary API docs | Tenant-scoped integration model | Login may be required; recheck before partnership work |
| A09 | [iCIMS partner process](https://developer-community.icims.com/getting-started/partner-application-process) | Primary partner docs | Formal integration route | Program requirements change |
| A10 | [iCIMS Profiles API](https://developer-community.icims.com/applications/applicant-tracking/profiles-api) | Primary API docs | Customer/permission-scoped access | Not universal candidate submit |
| A11 | [Oracle Taleo API](https://docs.oracle.com/en/cloud/saas/taleo-enterprise/otwsu/c-taleoapi.html) | Primary API docs | Organization-specific API | Legacy/product variants apply |
| A12 | [Oracle Direct Apply](https://docs.oracle.com/en/cloud/saas/human-resources/farws/api-direct-apply-job-applications.html) | Primary API docs | Approved-partner direct-apply route | Marketplace/authorization constraints apply |
| A13 | [Workable public jobs](https://workable.readme.io/reference/jobs-1) | Primary API docs | Employer-scoped public job ingestion | Candidate creation and richer SPI access require employer authorization |
| A14 | [Workable candidate creation](https://workable.readme.io/reference/job-candidates-create) | Primary API docs | Employer-authorized submission constraint | Not a universal candidate-side API |
| A15 | [Workday API overview](https://developer.workday.com/api-overview) | Primary API docs | Tenant-authenticated API model | No official public cross-tenant job-search or candidate-submit API was verified |
| A16 | [Schema.org `JobPosting`](https://schema.org/JobPosting) and [Google job structured-data guidance](https://developers.google.com/search/docs/appearance/structured-data/job-posting) | Primary standards/platform docs | Structured-data path for permitted employer pages and pasted links | Structured data does not itself grant commercial storage or automation rights |
| A17 | [LinkedIn Job Posting API](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview?view=li-lts-2026-03) and [prohibited software policy](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions) | Primary platform docs | Exclude unauthorized LinkedIn scraping/automation from ingestion plan | Partner and policy terms are volatile; recheck before any integration |
| A18 | [Indeed Job Sync API](https://docs.indeed.com/job-sync-api) and [Indeed legal terms](https://www.indeed.com/legal?hl=en) | Primary platform docs | Distinguish ATS-to-Indeed job sync from a public search/apply API | Contract and automation restrictions require formal access review |
| A19 | [Adzuna API](https://developer.adzuna.com/overview) and [terms](https://developer.adzuna.com/docs/terms_of_service) | Primary vendor docs | Licensed-aggregation bakeoff candidate | Rate, attribution, storage, redisplay, and commercial rights require contract review |
| A20 | [Lightcast Global Job Postings API](https://docs.lightcast.io/lightcast-api/reference/overview-global-job-postings) | Primary vendor docs | Licensed normalized job-data candidate | Commercial contract and coverage evaluation required |
| A21 | [LinkUp job data](https://www.linkup.com/products) | Vendor product documentation | Licensed active-job-feed candidate | Vendor claims and contract terms require diligence |

## OpenAI, workflow, browser, and cloud guidance

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| O01 | [OpenAI latest model guide](https://developers.openai.com/api/docs/guides/latest-model.md) | Primary documentation | Sol/Terra/Luna roles and Responses API guidance | Model names, aliases, prices, and availability are volatile |
| O02 | [OpenAI Agents guide](https://developers.openai.com/api/docs/guides/agents#agents-sdk-vs-responses-api) | Primary documentation | Agents SDK versus owned Responses loop | Recheck SDK/API evolution |
| O03 | [OpenAI computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) | Primary documentation | Isolation and human review for high-impact actions | Follow current safety guidance at implementation time |
| O04 | [OpenAI file search](https://developers.openai.com/api/docs/guides/tools-file-search) | Primary documentation | Retrieval/vector-store capabilities | RoleDawn exact facts remain outside similarity-only retrieval |
| O05 | [OpenAI background mode](https://developers.openai.com/api/docs/guides/background) | Primary documentation | Async model operations | Temporal remains business-workflow source of truth |
| O06 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) | Primary documentation | Cost modeling | Recheck on implementation/pricing dates |
| O07 | [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | Primary documentation | Strict typed task outputs | Schema validity does not prove factual correctness or permission |
| O08 | [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling#strict-mode) | Primary documentation | Strict function/tool schemas | Tool availability remains RoleDawn policy |
| O09 | [OpenAI Agents observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability) | Primary documentation | Bounded agent tracing and diagnostics | Vendor traces are not the domain audit; redact candidate data |
| O10 | [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) | Primary documentation | Model storage/retention design inputs | Recheck provider plan, region, ZDR, and endpoint behavior before production |
| W01 | [Temporal documentation](https://docs.temporal.io/) | Primary documentation | Durable workflows, retries, signals | Validate exact Cloud plan/features |
| W02 | [Temporal AI workflows](https://go.temporal.io/platform-hub/ai-engineering) | Vendor documentation | Human-in-loop/agent workflow patterns | Vendor framing |
| W03 | [Temporal workflow definition](https://docs.temporal.io/workflow-definition) | Primary documentation | Deterministic workflow boundary | Network, database, browser, and model calls belong in activities |
| W04 | [Temporal activities](https://docs.temporal.io/activities) | Primary documentation | Typed retryable external work | Activity idempotency and retry behavior remain application responsibilities |
| B01 | [Browserbase pricing](https://www.browserbase.com/pricing) | Vendor documentation | Managed-browser evaluation | Benchmark product behavior and total cost |
| B02 | [Browser Use pricing](https://browser-use.com/pricing) | Vendor documentation | Managed-browser alternative | Benchmark product behavior and total cost |
| B03 | [Browserbase sessions](https://docs.browserbase.com/platform/browser/getting-started/using-browser-session), [contexts](https://docs.browserbase.com/platform/browser/core-features/contexts), and [Live View](https://docs.browserbase.com/platform/browser/observability/session-live-view) | Vendor documentation | Browserbase/Playwright connection, persistent profiles, observability, and takeover benchmark | Capabilities and pricing require live evaluation; no ATS-success guarantee |
| B04 | [Stagehand observe](https://docs.stagehand.dev/v3/basics/observe) | Vendor documentation | Constrained DOM observe/validate/act fallback | Keep final submission outside agent authority |
| B05 | [Browser Use Cloud authentication](https://docs.browser-use.com/cloud/guides/authentication) and [live preview](https://docs.browser-use.com/cloud/browser/live-preview) | Vendor documentation | Second managed-agent/browser benchmark | Greater runtime coupling; disable automated CAPTCHA behavior for RoleDawn |
| B06 | [Orgo introduction](https://docs.orgo.ai/introduction) and [model integrations](https://docs.orgo.ai/guides/models) | Vendor documentation | Full cloud-desktop fallback evaluation | Heavier and more visually brittle than DOM-first browser execution |
| B07 | [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype), [authentication](https://playwright.dev/docs/auth), and [`page.pdf`](https://playwright.dev/docs/api/class-page#page-pdf) | Primary project documentation | Primary browser-driver contract, profile state, tracing, and deterministic PDF rendering | Prefer native Playwright provider connections; validate generated document layout separately |
| B08 | [Cua Sandbox SDK reference](https://cua.ai/docs/reference/sandbox-sdk), accessed 2026-08-11 | Primary vendor documentation | Cua benchmark input for ephemeral and persistent sandbox lifecycle plus screen, mouse, keyboard, clipboard, shell, terminal, window, and tunnel interfaces | Documented capability is not measured RoleDawn isolation, takeover, concurrency, reliability, regional coverage, or ATS success; Cua is not selected |
| B09 | [Cua computer-use concept](https://cua.ai/docs/concepts/what-is-computer-use) and [official `trycua/cua` repository](https://github.com/trycua/cua), accessed 2026-08-11 | Primary vendor documentation / primary open-source repository | Model-versus-computer boundary, least-privilege guidance, disposable sandbox framing, license and implementation diligence | Vendor framing and repository activity are not an audit; pin and review an exact release, security posture, telemetry, privacy, support, and cloud terms before use |
| AWS01 | [AWS ECS standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html) | Primary documentation | On-demand Fargate execution | Architecture may change after benchmark |
| AWS02 | [AWS KMS cryptography](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html) | Primary documentation | Envelope-encryption design | Implementation requires key-policy review |
| AWS03 | [GuardDuty malware protection for S3](https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html) | Primary documentation | Upload malware-scanning option | Verify regions, latency, and pricing |

## Database, model, OAuth, and connector guidance

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| DB01 | [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api), refreshed 2026-08-11 | Primary documentation | Private schemas, exposed-schema control, grants, and RLS defense in depth | RoleDawn now uses the founder-owned HireWire project for the alpha data foundation; policy tests and advisors remain required |
| DB02 | [Supabase breaking-change changelog](https://supabase.com/changelog?types=breaking-change), refreshed 2026-08-12 | Primary documentation | Current platform breaking changes, including extension-version pinning deprecation and the staged default-deny treatment of new Data API tables | Recheck before every dependency, migration, or platform upgrade; this repository uses explicit grants and does not enable legacy auto-exposure |
| DB03 | [Supabase server-side auth clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client) and [package guidance](https://supabase.com/docs/guides/auth/choosing-a-server-package), refreshed 2026-08-11 | Primary documentation | `@supabase/ssr` browser/server clients, cookie-backed sessions, and server claim validation | Auth callback URLs and production email templates still require deployment-specific configuration and acceptance tests |
| DB04 | [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), refreshed 2026-08-11 | Primary documentation | `auth.uid()` tenant policies, role-scoped policies, security-definer helper placement, and indexed RLS columns | Database grants, RPC authorization, and cross-tenant tests remain application responsibilities |
| DB05 | [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), refreshed 2026-08-12 | Primary documentation | Storage RLS policies for authenticated object insert/select and path ownership | RLS and grants remain application responsibilities; the service role bypasses ordinary Storage RLS and must stay server-only |
| DB06 | [Supabase local development](https://supabase.com/docs/guides/local-development/overview) and [CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows), refreshed 2026-08-11 | Primary documentation | Versioned migrations, generated types, and local/linked validation workflow | Full local database lint requires Docker or another running local Postgres instance |
| DB07 | [Supabase Admin generate link](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) and [verify OTP/token hash](https://supabase.com/docs/reference/javascript/auth-verifyotp), refreshed 2026-08-12 | Primary documentation | Development-only test-account login that bypasses email delivery but still establishes a normal cookie-backed session before RLS-scoped access | Admin link generation requires the server secret and must remain unavailable to browsers and production test shortcuts |
| DB08 | [Supabase Storage bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals), refreshed 2026-08-12 | Primary documentation | Private bucket behavior and authenticated access through RLS or signed URLs | A private bucket does not replace correct object policies, lifecycle controls, or application authorization |
| DB09 | [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), refreshed 2026-08-12 | Primary documentation | Non-upsert upload behavior and the recommendation to use resumable uploads above roughly 6 MB | RoleDawn currently accepts files up to 10 MB; benchmark resumable upload or lower the cap before production traffic |
| DB10 | [Supabase delete objects](https://supabase.com/docs/guides/storage/management/delete-objects), refreshed 2026-08-12 | Primary documentation | Remove objects through the Storage API before purging document metadata | Direct SQL deletion can orphan Storage data; RoleDawn's service deletion checks that referenced objects are gone before evidence purge |
| DB11 | [PostgREST errors](https://docs.postgrest.org/en/v14/references/errors.html), refreshed 2026-08-12 | Primary documentation | `PT409` custom SQLSTATE for a non-retryable stale résumé review conflict | The application still maps database errors to candidate-safe copy; custom codes are part of the versioned RPC contract |
| AI01 | [Anthropic tool runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner) | Primary documentation | Current tool-loop and client helper behavior for provider benchmark design | A tool runner is not a workflow engine or authorization boundary |
| AI02 | [Anthropic Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) | Primary documentation | Agent-runtime benchmark candidate | Do not settle production control plane without identical-task safety, quality, latency, and cost tests |
| AI03 | [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview) | Primary documentation | Current model capabilities and routing benchmark inputs | Model names, pricing, limits, and availability change |
| G01 | [Gmail OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) | Primary documentation | Sensitive versus restricted Gmail scope classification | Recheck immediately before OAuth implementation |
| G02 | [Google restricted-scope verification requirements](https://support.google.com/cloud/answer/13464321) | Primary platform guidance | Verification and security-assessment planning | Requirements, exceptions, timing, and cost change; obtain current review |
| NG01 | [Nango authorization guide](https://nango.dev/docs/guides/auth/auth-guide) | Vendor documentation | Managed OAuth/token-broker benchmark and connection ownership model | Vendor is not selected; verify security, DPA, regions, export, revocation, and incident controls |

## Security, privacy, and claims

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| S01 | [OWASP LLM excessive agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) | Security guidance | Least authority, mediated side effects, bounded tools | Apply through threat model and tests |
| S02 | [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | Security guidance | Treat external content as untrusted | Keep guidance current |
| S03 | [GDPR Article 5](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679) | Primary law | Purpose limitation, minimization, storage limitation | Counsel determines applicability and implementation |
| S04 | [California Privacy Protection Agency FAQ](https://cppa.ca.gov/faq) | Primary regulator guidance | Sensitive-data context | Counsel determines duties and thresholds |
| S05 | [FTC endorsement guidance](https://www.ftc.gov/news-events/topics/truth-advertising/advertisement-endorsements) | Primary regulator guidance | Logo/testimonial/outcome proof | Legal review required for final presentation |
| S06 | [EEOC preemployment disability-question guidance](https://www.eeoc.gov/laws/guidance/enforcement-guidance-preemployment-disability-related-questions-and-medical) | Primary regulator guidance | Separate hiring-process accommodations, job accommodations, disability questions, and voluntary self-identification | Guidance predates the ADAAA and is not legal advice; counsel must review current application behavior |
| S07 | [DOJ Immigrant and Employee Rights Section](https://www.justice.gov/crt/immigrant-and-employee-rights-section) | Primary regulator guidance | Citizenship-status and national-origin discrimination context | Counsel determines exact authorization wording and product obligations |
| S08 | [FTC personal-information security guidance](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business) | Primary regulator guidance | Data minimization, access limitation, retention, and credential-security baseline | General guidance; implementation requires a threat model, testing, and counsel review |

## Research gaps

- The first signed-in Tsenta dashboard is now documented through a founder-provided screenshot set. A real review diff, browser takeover, cancellation, billing transaction, employer submission, and recruiter-inbox flow remain untested.
- Tsenta's iMessage provider, browser provider, current detailed backend, tenant isolation, and real cost per application remain unverified.
- RoleDawn domain/trademark screens are preliminary, not a legal opinion or reservation.
- Candidate preference for iMessage over push/email is a hypothesis; no cited study proves it.
- Managed-browser and Photon security/reliability claims require written diligence and tests.
- ATS terms and candidate attestation implications require counsel, not inference from API docs.
- Market willingness to pay, best first role family, actual support cost, and interview lift require alpha data.
