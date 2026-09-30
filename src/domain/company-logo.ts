const ASHBY_BOARD_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u;

export function isAshbyBoardSlug(value: string): boolean {
  return ASHBY_BOARD_SLUG.test(value);
}

/** A board identity comes from the posting URL, never from a guessed company domain. */
export function companyLogoSource(postingUrl: string | null | undefined): string | null {
  if (!postingUrl) return null;
  try {
    const url = new URL(postingUrl);
    if (url.origin !== "https://jobs.ashbyhq.com" || url.username || url.password) return null;
    const board = url.pathname.split("/")[1];
    // Bump when the served format changes so browsers discard earlier misses or full-size assets.
    return board && isAshbyBoardSlug(board) ? `/api/company-logos/ashby/${board.toLowerCase()}.png?v=thumbnail-1` : null;
  } catch {
    return null;
  }
}
