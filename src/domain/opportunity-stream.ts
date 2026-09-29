import type { OpportunityCatalogItem } from "./opportunity-catalog.ts";

/** Keep already-read cards in place when a daily refresh overlaps page boundaries. */
export function mergeOpportunityPages(pages: readonly (readonly OpportunityCatalogItem[])[]): readonly OpportunityCatalogItem[] {
  const seen = new Set<string>();
  return pages.flatMap(page => page.filter(item => {
    if (seen.has(item.jobId)) return false;
    seen.add(item.jobId);
    return true;
  }));
}

export type CatalogRefreshStats = Readonly<{
  openJobCount: number;
  employerCount: number;
  activeSourceCount: number;
  lastCompletedRefreshAt: string | null;
  oldestSourceRefreshAt: string | null;
  overdueSourceCount: number;
  failingSourceCount: number;
  staleSourceCount: number;
}>;

export function parseCatalogRefreshStats(value: unknown): CatalogRefreshStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CATALOG_STATS_INVALID");
  const row = value as Record<string, unknown>;
  const count = (key: string): number => {
    const n = row[key];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new Error("CATALOG_STATS_INVALID");
    return n;
  };
  const date = (key: string): string | null => {
    const text = row[key];
    if (text === null) return null;
    if (typeof text !== "string" || !Number.isFinite(Date.parse(text))) throw new Error("CATALOG_STATS_INVALID");
    return text;
  };
  return {
    openJobCount: count("open_job_count"), employerCount: count("employer_count"),
    activeSourceCount: count("active_source_count"), lastCompletedRefreshAt: date("last_completed_refresh_at"),
    oldestSourceRefreshAt: date("oldest_source_refresh_at"), overdueSourceCount: count("overdue_source_count"),
    failingSourceCount: count("failing_source_count"), staleSourceCount: count("stale_source_count"),
  };
}
