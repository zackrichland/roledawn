const BOARD_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u;

export type CompanyLogoProvider = "ashby" | "greenhouse" | "lever";

export function isCompanyLogoProvider(value: string): value is CompanyLogoProvider {
  return value === "ashby" || value === "greenhouse" || value === "lever";
}

export function isCompanyLogoBoardSlug(value: string): boolean {
  return BOARD_SLUG.test(value);
}

/** A board identity comes from the posting URL, never from a guessed company domain. */
export function companyLogoSource(postingUrl: string | null | undefined): string | null {
  if (!postingUrl) return null;
  try {
    const url = new URL(postingUrl);
    if (url.username || url.password) return null;
    const provider = url.origin === "https://jobs.ashbyhq.com" ? "ashby"
      : url.origin === "https://jobs.lever.co" ? "lever"
      : ["https://job-boards.greenhouse.io", "https://boards.greenhouse.io"].includes(url.origin) ? "greenhouse" : null;
    if (!provider) return null;
    const board = url.pathname.split("/")[1];
    // Embedded Greenhouse forms identify employers in a different query contract.
    if (provider === "greenhouse" && board === "embed") return null;
    // Bump when the served format changes so browsers discard earlier misses or full-size assets.
    return board && isCompanyLogoBoardSlug(board) ? `/api/company-logos/${provider}/${board.toLowerCase()}.png?v=thumbnail-1` : null;
  } catch {
    return null;
  }
}
