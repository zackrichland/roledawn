---
title: Research source register
status: active evidence index
last_updated: 2026-08-06
accessed_at: 2026-08-06 unless otherwise stated
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
| A01 | [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) | Primary API docs | Public jobs/questions; employer key for POST | Recheck auth and terms |
| A02 | [Greenhouse Candidate Ingestion API](https://developers.greenhouse.io/candidate-ingestion.html) | Primary API docs | Approved sourcing partner path | Not universal candidate submission |
| A03 | [Greenhouse MCP](https://www.greenhouse.com/product-features/greenhouse-mcp) | Primary product page | Employer-governed MCP | MCP does not confer arbitrary-employer permission |
| A04 | [Lever Postings API](https://github.com/lever/postings-api) | Primary API docs | Public postings and employer-key submission constraints | Recheck hosted-form recommendation and rate limits |
| A05 | [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api) | Primary API docs | Public discovery | Not candidate submit authority |
| A06 | [Ashby application submit](https://developers.ashbyhq.com/reference/applicationformsubmit-1) | Primary API docs | Employer-credential submit constraint | Intended for authorized careers experiences |
| A07 | [Ashby MCP](https://docs.ashbyhq.com/ashby-mcp-server-beta) | Primary product docs | Organization-permission MCP | Not arbitrary candidate access |
| A08 | [Workday authentication](https://developer.workday.com/documentation/zwx1518028675482) | Primary API docs | Tenant-scoped integration model | Login may be required; recheck before partnership work |
| A09 | [iCIMS partner process](https://developer-community.icims.com/getting-started/partner-application-process) | Primary partner docs | Formal integration route | Program requirements change |
| A10 | [iCIMS Profiles API](https://developer-community.icims.com/applications/applicant-tracking/profiles-api) | Primary API docs | Customer/permission-scoped access | Not universal candidate submit |
| A11 | [Oracle Taleo API](https://docs.oracle.com/en/cloud/saas/taleo-enterprise/otwsu/c-taleoapi.html) | Primary API docs | Organization-specific API | Legacy/product variants apply |
| A12 | [Oracle Direct Apply](https://docs.oracle.com/en/cloud/saas/human-resources/farws/api-direct-apply-job-applications.html) | Primary API docs | Approved-partner direct-apply route | Marketplace/authorization constraints apply |

## OpenAI, workflow, browser, and cloud guidance

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| O01 | [OpenAI latest model guide](https://developers.openai.com/api/docs/guides/latest-model.md) | Primary documentation | Sol/Terra/Luna roles and Responses API guidance | Model names, aliases, prices, and availability are volatile |
| O02 | [OpenAI Agents guide](https://developers.openai.com/api/docs/guides/agents#agents-sdk-vs-responses-api) | Primary documentation | Agents SDK versus owned Responses loop | Recheck SDK/API evolution |
| O03 | [OpenAI computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) | Primary documentation | Isolation and human review for high-impact actions | Follow current safety guidance at implementation time |
| O04 | [OpenAI file search](https://developers.openai.com/api/docs/guides/tools-file-search) | Primary documentation | Retrieval/vector-store capabilities | RoleDawn exact facts remain outside similarity-only retrieval |
| O05 | [OpenAI background mode](https://developers.openai.com/api/docs/guides/background) | Primary documentation | Async model operations | Temporal remains business-workflow source of truth |
| O06 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) | Primary documentation | Cost modeling | Recheck on implementation/pricing dates |
| W01 | [Temporal documentation](https://docs.temporal.io/) | Primary documentation | Durable workflows, retries, signals | Validate exact Cloud plan/features |
| W02 | [Temporal AI workflows](https://go.temporal.io/platform-hub/ai-engineering) | Vendor documentation | Human-in-loop/agent workflow patterns | Vendor framing |
| B01 | [Browserbase pricing](https://www.browserbase.com/pricing) | Vendor documentation | Managed-browser evaluation | Benchmark product behavior and total cost |
| B02 | [Browser Use pricing](https://browser-use.com/pricing) | Vendor documentation | Managed-browser alternative | Benchmark product behavior and total cost |
| AWS01 | [AWS ECS standalone tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/standalone-tasks.html) | Primary documentation | On-demand Fargate execution | Architecture may change after benchmark |
| AWS02 | [AWS KMS cryptography](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html) | Primary documentation | Envelope-encryption design | Implementation requires key-policy review |
| AWS03 | [GuardDuty malware protection for S3](https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html) | Primary documentation | Upload malware-scanning option | Verify regions, latency, and pricing |

## Database, model, OAuth, and connector guidance

| ID | Source | Class | Used for | Caveat |
|---|---|---|---|---|
| DB01 | [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api) | Primary documentation | Private schemas, exposed-schema control, grants, and RLS defense in depth | Supabase remains a candidate under O-003; follow current project defaults and test policies |
| DB02 | [Supabase changelog](https://supabase.com/changelog.md) | Primary documentation | Current platform and client breaking-change review, including Data API exposure defaults | Recheck before every dependency or platform upgrade |
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

## Research gaps

- Signed-in Tsenta dashboard, first-run result, real review diff, browser takeover, cancellation, billing, and recruiter-inbox flow were not tested.
- Tsenta's iMessage provider, browser provider, current detailed backend, tenant isolation, and real cost per application remain unverified.
- RoleDawn domain/trademark screens are preliminary, not a legal opinion or reservation.
- Candidate preference for iMessage over push/email is a hypothesis; no cited study proves it.
- Managed-browser and Photon security/reliability claims require written diligence and tests.
- ATS terms and candidate attestation implications require counsel, not inference from API docs.
- Market willingness to pay, best first role family, actual support cost, and interview lift require alpha data.
