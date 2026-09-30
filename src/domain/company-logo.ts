// A logo is identified by the ATS board it was posted on: (provider, board slug), read from
// the posting URL. Never from a guessed company domain, favicon, platform logo or banner.
const BOARD_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;

/**
 * EU boards are separate namespaces: the same slug on `job-boards.eu.greenhouse.io` and
 * `job-boards.greenhouse.io` can be two different employers, so region is part of the provider.
 */
export const COMPANY_LOGO_PROVIDERS = ["ashby", "greenhouse", "greenhouse-eu", "lever", "lever-eu"] as const;
export type CompanyLogoProvider = (typeof COMPANY_LOGO_PROVIDERS)[number];

export function isCompanyLogoProvider(value: string): value is CompanyLogoProvider {
  return (COMPANY_LOGO_PROVIDERS as readonly string[]).includes(value);
}

/** Ingestion accepts dots in tenant keys (`TENANT_KEY_PATTERN`), so logo slugs do too, minus `..`. */
export function isCompanyLogoBoardSlug(value: string): boolean {
  return BOARD_SLUG.test(value) && !value.includes("..");
}

// Every host `parseSupportedJobReference` (pasted links) and the catalog can put in front of the queue.
const PROVIDER_BY_ORIGIN: Readonly<Record<string, CompanyLogoProvider>> = Object.freeze({
  "https://jobs.ashbyhq.com": "ashby",
  "https://jobs.lever.co": "lever",
  "https://jobs.eu.lever.co": "lever-eu",
  "https://job-boards.greenhouse.io": "greenhouse",
  "https://boards.greenhouse.io": "greenhouse",
  "https://job-boards.eu.greenhouse.io": "greenhouse-eu",
  "https://boards.eu.greenhouse.io": "greenhouse-eu",
});

export type CompanyLogoIdentity = Readonly<{ provider: CompanyLogoProvider; board: string }>;

/**
 * The employer identity of a posting URL, or null when the URL is not a hosted ATS posting
 * (employer-domain URLs such as `careers.example.com/...?gh_jid=1` carry no verifiable board).
 * Path suffixes (`/application`, `/apply`, `/jobs/123`) and query strings never matter; the board is
 * always the first path segment.
 */
export function companyLogoIdentity(postingUrl: string | null | undefined): CompanyLogoIdentity | null {
  if (!postingUrl) return null;
  try {
    const url = new URL(postingUrl);
    if (url.username || url.password) return null;
    const provider = PROVIDER_BY_ORIGIN[url.origin];
    if (!provider) return null;
    const board = url.pathname.split("/")[1];
    // Embedded Greenhouse forms identify employers in a different query contract.
    if (provider.startsWith("greenhouse") && board === "embed") return null;
    return board && isCompanyLogoBoardSlug(board) ? Object.freeze({ provider, board: board.toLowerCase() }) : null;
  } catch {
    return null;
  }
}

/** Bump `v` when the served format changes so browsers discard earlier misses or full-size assets. */
export function companyLogoSource(postingUrl: string | null | undefined): string | null {
  const identity = companyLogoIdentity(postingUrl);
  return identity ? `/api/company-logos/${identity.provider}/${identity.board}.png?v=thumbnail-1` : null;
}

/**
 * A failed load is retried a bounded number of times. Most failures are cold starts or a
 * momentary upstream problem; the server keeps the logo after its first success, so a retry a
 * few seconds later normally finds it. A retry needs a distinct URL to bypass a cached error.
 */
export const COMPANY_LOGO_RETRY_DELAYS_MS: readonly number[] = Object.freeze([2_000, 8_000, 30_000]);

/** Base delay with +/-25% jitter so rows on one page do not retry in lockstep; null when exhausted. */
export function companyLogoRetryDelay(attempt: number, random: () => number = Math.random): number | null {
  const base = COMPANY_LOGO_RETRY_DELAYS_MS[attempt];
  return base === undefined ? null : Math.round(base * (0.75 + 0.5 * random()));
}

export function companyLogoAttemptSource(source: string, attempt: number): string {
  return attempt <= 0 ? source : `${source}${source.includes("?") ? "&" : "?"}r=${attempt}`;
}

export type CompanyLogoLoad = Readonly<{
  /** loading: request in flight. loaded: visible. waiting: failed, retry scheduled. failed: retries used up. */
  phase: "loading" | "loaded" | "waiting" | "failed";
  attempt: number;
}>;
export type CompanyLogoLoadEvent = "loaded" | "errored" | "retry";

export const INITIAL_COMPANY_LOGO_LOAD: CompanyLogoLoad = Object.freeze({ phase: "loading", attempt: 0 });

export function nextCompanyLogoLoad(state: CompanyLogoLoad, event: CompanyLogoLoadEvent): CompanyLogoLoad {
  switch (event) {
    case "loaded":
      return state.phase === "loaded" ? state : { phase: "loaded", attempt: state.attempt };
    case "errored":
      // A logo that is already showing stays; only a load in flight can fail.
      if (state.phase !== "loading") return state;
      return { phase: state.attempt < COMPANY_LOGO_RETRY_DELAYS_MS.length ? "waiting" : "failed", attempt: state.attempt };
    case "retry":
      return state.phase === "waiting" ? { phase: "loading", attempt: state.attempt + 1 } : state;
  }
}
