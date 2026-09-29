import type { JobSourceProvider } from "./contracts.ts";
import { buildAshbyJobBoardEndpoint, buildGreenhouseJobsEndpoint, buildLeverPostingsEndpoint } from "./endpoints.ts";

export type ReviewedJobSource = Readonly<{
  employerName: string; provider: JobSourceProvider; tenantKey: string; publicBoardUrl: string;
  apiUrl: string; category: string; verifiedAt: string; observedJobs: number; observedBytes: number; evidenceUrls: readonly string[];
}>;
export type ReviewedJobSourceRegistry = Readonly<{ schemaVersion: 1; release: string; sources: readonly ReviewedJobSource[] }>;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function parseReviewedJobSourceRegistry(input: unknown): ReviewedJobSourceRegistry {
  if (!record(input) || input.schemaVersion !== 1 || typeof input.release !== "string" || !/^job-source-registry\/\d{4}-\d{2}-\d{2}$/u.test(input.release) ||
    !Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 100) throw new Error("SOURCE_REGISTRY_INVALID");
  const seen = new Set<string>();
  for (const source of input.sources) {
    if (!record(source) || !["GREENHOUSE","LEVER","ASHBY"].includes(String(source.provider)) ||
      typeof source.tenantKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(source.tenantKey) ||
      typeof source.employerName !== "string" || source.employerName.trim().length < 1 || source.employerName.length > 200 ||
      typeof source.category !== "string" || source.category.length < 1 || source.category.length > 120 ||
      typeof source.verifiedAt !== "string" || !Number.isFinite(Date.parse(source.verifiedAt)) ||
      !Number.isSafeInteger(source.observedJobs) || Number(source.observedJobs) < 1 || Number(source.observedJobs) > 5000 ||
      !Number.isSafeInteger(source.observedBytes) || Number(source.observedBytes) < 1 || Number(source.observedBytes) > 20 * 1024 * 1024 ||
      !Array.isArray(source.evidenceUrls) || source.evidenceUrls.length < 1 || source.evidenceUrls.length > 5) throw new Error("SOURCE_REGISTRY_ENTRY_INVALID");
    const provider = source.provider as JobSourceProvider;
    const sourceId = `registry:${provider}:${source.tenantKey}`;
    const apiUrl = provider === "GREENHOUSE" ? buildGreenhouseJobsEndpoint({ sourceId, provider, tenantKey: source.tenantKey, includeContent: true })
      : provider === "LEVER" ? buildLeverPostingsEndpoint({ sourceId, provider, tenantKey: source.tenantKey })
        : buildAshbyJobBoardEndpoint({ sourceId, provider, tenantKey: source.tenantKey, includeCompensation: true });
    const boardUrl = `${provider === "GREENHOUSE" ? "https://job-boards.greenhouse.io" : provider === "LEVER" ? "https://jobs.lever.co" : "https://jobs.ashbyhq.com"}/${source.tenantKey}`;
    if (source.apiUrl !== apiUrl || source.publicBoardUrl !== boardUrl || !source.evidenceUrls.includes(apiUrl) ||
      source.evidenceUrls.some(value => typeof value !== "string" || ![apiUrl,boardUrl,`https://boards-api.greenhouse.io/v1/boards/${source.tenantKey}`].includes(value)) ||
      seen.has(sourceId)) throw new Error("SOURCE_REGISTRY_IDENTITY_INVALID");
    seen.add(sourceId);
  }
  return input as unknown as ReviewedJobSourceRegistry;
}

export async function seedReviewedJobSources(client: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }, input: unknown) {
  const registry = parseReviewedJobSourceRegistry(input);
  const result = await client.rpc("register_reviewed_job_sources", { p_registry_release: registry.release, p_sources: registry.sources });
  if (result.error) throw new Error("SOURCE_REGISTRY_SEED_FAILED");
  if (!record(result.data) || !Number.isSafeInteger(result.data.created) || !Number.isSafeInteger(result.data.existing) ||
    result.data.registry_release !== registry.release || Number(result.data.created) + Number(result.data.existing) !== registry.sources.length) throw new Error("SOURCE_REGISTRY_SEED_RESULT_INVALID");
  return { created: Number(result.data.created), existing: Number(result.data.existing), release: registry.release };
}
