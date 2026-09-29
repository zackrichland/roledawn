import {
  buildApplicationResearchBundle,
  type BuiltApplicationResearchBundle,
} from "../../domain/application-research.ts";
import {
  RESEARCH_FACT_KINDS,
  WHY_NOW_TYPES,
  type DraftingContextV2,
  type EmployerResearch,
  type NeedsBrief,
  type ResearchFact,
} from "../../domain/application-drafting-v2.ts";
import { modelFor } from "../ai/models.ts";
import { structuredResponse, StructuredResponseError } from "../ai/structured-response.ts";

export const EMPLOYER_RESEARCHER_RELEASE = "employer-web-research/1";
export const RESEARCH_FRESHNESS_POLICY_RELEASE = "application-research-freshness/1";
const MAX_RESEARCH_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

const NULLABLE_STRING = { type: ["string", "null"] } as const;

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "brief"],
  properties: {
    facts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "url", "sourceTitle", "published"],
        properties: {
          kind: { type: "string", enum: [...RESEARCH_FACT_KINDS] },
          text: { type: "string", minLength: 1, maxLength: 320 },
          url: { type: "string", minLength: 1, maxLength: 600 },
          sourceTitle: { type: "string", minLength: 1, maxLength: 200 },
          published: NULLABLE_STRING,
        },
      },
    },
    brief: {
      type: "object",
      additionalProperties: false,
      required: ["roleSummary", "topRequirements", "theirLanguage", "whyNow", "sixMonthOutcome", "readerModel"],
      properties: {
        roleSummary: { type: "string", minLength: 1, maxLength: 300 },
        topRequirements: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 200 } },
        theirLanguage: { type: "array", maxItems: 12, items: { type: "string", maxLength: 60 } },
        whyNow: {
          type: "object",
          additionalProperties: false,
          required: ["type", "hypothesis", "basis"],
          properties: {
            type: { type: "string", enum: [...WHY_NOW_TYPES] },
            hypothesis: { type: "string", minLength: 1, maxLength: 300 },
            basis: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
        sixMonthOutcome: { type: "string", minLength: 1, maxLength: 300 },
        readerModel: { type: "string", minLength: 1, maxLength: 300 },
      },
    },
  },
} as const;

const RESEARCH_INSTRUCTIONS = `You research one employer and one job posting so an applicant can write to the real need behind the role. Work fast and cite everything.

Search a small, bounded set: the employer's own site (product pages, about, careers, newsroom, blog), recent news from the last 90 days, funding or earnings news, and public statements by executives or founders about the area this role works in. Skip job boards, review sites, and anything behind a login.

facts: up to eight short, specific, dated facts that would help this applicant connect their experience to this employer: what the company sells and to whom, recent launches, expansions, funding, leadership changes, stated goals, notable customers. One fact per item, under 300 characters, no opinions, no adjectives you cannot source. Put the exact page URL you read in url (a URL returned by your web search, never a guess) and the date in published (YYYY-MM-DD) when the page shows one. If you find nothing reliable, return an empty facts array.

brief (from the posting plus facts):
- roleSummary: what this person will actually do, in one plain sentence.
- topRequirements: the three to five things the posting weights most. Repetition, order, and "must" versus "nice to have" signal weight. Use the posting's own words.
- theirLanguage: concrete nouns and verbs from the posting or site worth mirroring (tools, customer types, deliverables, domains). Not buzzwords.
- whyNow: your best guess at why this role is open now, with type NEW_BET, SCALING, BACKFILL, TURNAROUND, COMPETITIVE, COMPLIANCE, COST, LEADERSHIP_GAP, or UNKNOWN, a one-sentence hypothesis, and the basis (which posting cues or facts support it). This is an inference and will be treated as one.
- sixMonthOutcome: what this hire must make true in six months, in one sentence.
- readerModel: who likely screens and who decides, and what the hiring manager needs to believe about the applicant.`;

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_/iu.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return null;
  }
}

function sameUrl(left: string, right: string): boolean {
  const a = normalizeUrl(left);
  const b = normalizeUrl(right);
  if (!a || !b) return false;
  const strip = (value: string) => value.replace(/^https:\/\/(www\.)?/u, "").replace(/\/+$/u, "").replace(/\?$/u, "");
  return strip(a) === strip(b);
}

function parseBrief(value: unknown, context: DraftingContextV2): NeedsBrief {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const whyNow = (record.whyNow && typeof record.whyNow === "object" ? record.whyNow : {}) as Record<string, unknown>;
  const list = (items: unknown, max: number, length: number) => (Array.isArray(items) ? items : [])
    .map((item) => cleanText(item, length)).filter(Boolean).slice(0, max);
  const type = WHY_NOW_TYPES.includes(whyNow.type as (typeof WHY_NOW_TYPES)[number]) ? whyNow.type as (typeof WHY_NOW_TYPES)[number] : "UNKNOWN";
  return Object.freeze({
    roleSummary: cleanText(record.roleSummary, 300) || `${context.job.title} at ${context.job.employerName}.`,
    topRequirements: Object.freeze(list(record.topRequirements, 5, 200)),
    theirLanguage: Object.freeze(list(record.theirLanguage, 12, 60)),
    whyNow: Object.freeze({
      type,
      hypothesis: cleanText(whyNow.hypothesis, 300) || "Unknown from available sources.",
      basis: cleanText(whyNow.basis, 300) || "Posting only.",
    }),
    sixMonthOutcome: cleanText(record.sixMonthOutcome, 300),
    readerModel: cleanText(record.readerModel, 300),
  });
}

/** Deterministic fallback when the research model is unavailable. */
export function postingOnlyBrief(context: DraftingContextV2): NeedsBrief {
  const lines = context.job.description.split(/\n+/u).map((line) => line.replace(/^[\s•*\-–]+/u, "").trim()).filter(Boolean);
  const requirementLines = lines.filter((line) => line.length > 30 && line.length < 220
    && /\b(?:experience|ability|proficien|knowledge|skill|track|degree|years?|you (?:have|bring|are))\b/iu.test(line)).slice(0, 5);
  return Object.freeze({
    roleSummary: `${context.job.title} at ${context.job.employerName}.`,
    topRequirements: Object.freeze(requirementLines),
    theirLanguage: Object.freeze([]),
    whyNow: Object.freeze({ type: "UNKNOWN" as const, hypothesis: "Unknown; research was unavailable.", basis: "Posting only." }),
    sixMonthOutcome: "",
    readerModel: "",
  });
}

export async function researchEmployer(
  context: DraftingContextV2,
  options: Readonly<{ apiKey?: string; environment?: NodeJS.ProcessEnv; webSearch?: boolean }> = {},
): Promise<EmployerResearch> {
  const environment = options.environment ?? process.env;
  const input = JSON.stringify({
    employer: context.job.employerName,
    role: context.job.title,
    location: context.job.location,
    workMode: context.job.workMode,
    postingUrl: context.job.applyUrl,
    posting: context.job.description.slice(0, 14_000),
  });
  const attempt = async (webSearch: boolean) => structuredResponse({
    apiKey: options.apiKey ?? environment.OPENAI_API_KEY,
    model: modelFor("RESEARCH", environment),
    instructions: webSearch ? RESEARCH_INSTRUCTIONS : `${RESEARCH_INSTRUCTIONS}\n\nWeb search is unavailable for this run: return an empty facts array and base the brief on the posting alone.`,
    input,
    schemaName: "roledawn_employer_research",
    schema: RESEARCH_SCHEMA as unknown as Record<string, unknown>,
    reasoningEffort: "low",
    maxOutputTokens: 9_000,
    timeoutMs: 150_000,
    ...(webSearch ? { tools: [{ type: "web_search" as const }] } : {}),
  });
  const debug = (error: unknown) => {
    if (environment.ROLEDAWN_DEBUG_RESEARCH === "true") console.error("research attempt failed", error instanceof Error ? error.message : error);
  };
  type Attempt = Awaited<ReturnType<typeof attempt>>;
  const verifiedFacts = (result: Attempt): ResearchFact[] => {
    const record = (result.value && typeof result.value === "object" ? result.value : {}) as Record<string, unknown>;
    const facts: ResearchFact[] = [];
    if (result.citedUrls.length === 0) return facts;
    for (const entry of Array.isArray(record.facts) ? record.facts.slice(0, 8) : []) {
      const fact = (entry ?? {}) as Record<string, unknown>;
      const url = typeof fact.url === "string" ? normalizeUrl(fact.url) : null;
      const text = cleanText(fact.text, 320);
      // Keep only facts whose page the search tool actually returned.
      if (!url || !text || !result.citedUrls.some((cited) => sameUrl(cited, url))) continue;
      const kind = RESEARCH_FACT_KINDS.includes(fact.kind as (typeof RESEARCH_FACT_KINDS)[number])
        ? fact.kind as (typeof RESEARCH_FACT_KINDS)[number] : "COMPANY";
      const published = typeof fact.published === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(fact.published) ? fact.published : null;
      facts.push(Object.freeze({
        id: `r${facts.length + 1}`,
        kind,
        text,
        url,
        sourceTitle: cleanText(fact.sourceTitle, 200) || new URL(url).hostname,
        published,
      }));
    }
    return facts;
  };

  // Web search sometimes times out, runs out of output budget, or returns
  // nothing verifiable. Search twice, keep the best result, and only fall
  // back to a posting-only brief when neither search produced anything.
  let best: Readonly<{ result: Attempt; facts: ResearchFact[] }> | null = null;
  if (options.webSearch !== false) {
    for (let round = 1; round <= 2; round += 1) {
      try {
        const result = await attempt(true);
        const facts = verifiedFacts(result);
        if (!best || facts.length > best.facts.length) best = { result, facts };
        if (facts.length > 0) break;
        console.warn(JSON.stringify({ event: "employer_research_unverified", round, citedUrls: result.citedUrls.length }));
      } catch (error) {
        console.warn(JSON.stringify({ event: "employer_research_failed", round, code: error instanceof StructuredResponseError ? error.code : "UNKNOWN" }));
        debug(error);
      }
    }
  }
  if (!best) {
    try {
      best = { result: await attempt(false), facts: [] };
    } catch (error) {
      debug(error);
      return Object.freeze({ coverage: "OFFICIAL_POSTING_ONLY", facts: Object.freeze([]), brief: postingOnlyBrief(context), model: null });
    }
  }
  const { result, facts } = best;
  const record = (result.value && typeof result.value === "object" ? result.value : {}) as Record<string, unknown>;
  return Object.freeze({
    coverage: facts.length > 0 ? "MULTI_PRIMARY_SOURCE" : "OFFICIAL_POSTING_ONLY",
    facts: Object.freeze(facts),
    brief: parseBrief(record.brief, context),
    model: result.model,
  });
}

function employerTokens(employer: string): string[] {
  return employer.toLocaleLowerCase("en-US").replace(/[^a-z0-9 ]+/gu, " ").split(/\s+/u)
    .filter((token) => token.length >= 4 && !["inc", "llc", "corp", "company", "technologies", "group", "health", "labs"].includes(token));
}

/** Builds the immutable research bundle recorded with the revision. */
export function buildEmployerResearchBundle(
  context: DraftingContextV2,
  research: EmployerResearch,
  completedAt: string,
): BuiltApplicationResearchBundle {
  const postingSourceId = `job-version:${context.binding.jobVersionId}`;
  const tokens = employerTokens(context.job.employerName);
  const retrievedAt = new Date(completedAt).toISOString();
  // The bundle lists each page once (the validator rejects repeated
  // canonical URLs); several facts from one page cite the same source, and a
  // fact read from the posting itself cites the posting.
  const canonical = (url: string) => {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  };
  const sourceIdByUrl = new Map<string, string>([[canonical(context.job.applyUrl), postingSourceId]]);
  const webSources: { sourceId: string; sourceType: "EMPLOYER_WEBSITE" | "PRIMARY_PUBLICATION"; url: string; title: string; retrievedAt: string }[] = [];
  const citedSourceByFact = new Map<string, string>();
  for (const fact of research.facts) {
    const url = canonical(fact.url);
    let sourceId = sourceIdByUrl.get(url);
    if (!sourceId) {
      sourceId = `web:${fact.id}`;
      const host = new URL(url).hostname.toLocaleLowerCase("en-US");
      webSources.push(Object.freeze({
        sourceId,
        sourceType: tokens.some((token) => host.includes(token)) ? "EMPLOYER_WEBSITE" as const : "PRIMARY_PUBLICATION" as const,
        url,
        title: fact.sourceTitle,
        retrievedAt,
      }));
      sourceIdByUrl.set(url, sourceId);
    }
    citedSourceByFact.set(fact.id, sourceId);
  }
  const built = buildApplicationResearchBundle({
    binding: {
      inputSnapshotId: context.binding.inputSnapshotId,
      inputSnapshotHash: context.binding.snapshotHash,
      applicationId: context.binding.applicationId,
      jobVersionId: context.binding.jobVersionId,
      jobContentSha256: context.binding.jobContentSha256,
    },
    freshnessPolicy: { policyRelease: RESEARCH_FRESHNESS_POLICY_RELEASE, maxAgeMs: MAX_RESEARCH_AGE_MS, maxFutureSkewMs: 5 * 60 * 1_000 },
    completedAt,
    proposal: {
      schemaVersion: 1,
      researcherRelease: research.model ? `${EMPLOYER_RESEARCHER_RELEASE}:${research.model}`.slice(0, 120) : "official-job-posting-research/1",
      sources: [
        { sourceId: postingSourceId, sourceType: "JOB_POSTING", url: context.job.applyUrl, title: `${context.job.employerName} — ${context.job.title}`, retrievedAt: new Date(context.binding.capturedAt).toISOString() },
        ...webSources,
      ],
      claims: [
        {
          claimId: "official-role-target",
          claimType: "COMPANY_CONTEXT",
          text: `${context.job.employerName} is hiring for the ${context.job.title} role.`,
          conflictStatus: "NO_CONFLICT",
          conflictNote: null,
          citations: [{ sourceId: postingSourceId, locator: "Official posting: employer and title", excerpt: `${context.job.employerName}\n${context.job.title}` }],
        },
        ...research.facts.map((fact) => ({
          claimId: fact.id,
          claimType: fact.kind === "FUNDING" || fact.kind === "LEADERSHIP" ? "HIRING_SIGNAL" as const : "COMPANY_CONTEXT" as const,
          text: fact.text,
          conflictStatus: "NO_CONFLICT" as const,
          conflictNote: null,
          citations: [{ sourceId: citedSourceByFact.get(fact.id) ?? `web:${fact.id}`, locator: fact.published ? `Published ${fact.published}` : "Web page", excerpt: null }],
        })),
      ],
    },
  });
  if (!built.ok) throw new Error(built.error.issues[0]?.code ?? "APPLICATION_RESEARCH_INVALID");
  return built.value;
}
