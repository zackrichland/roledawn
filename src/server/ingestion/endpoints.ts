import type {
  AshbySource,
  GreenhouseSource,
  LeverSource,
  SupportedJobReference,
} from "./contracts.ts";

const TENANT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class SourceEndpointError extends Error {
  readonly code = "ENDPOINT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "SourceEndpointError";
  }
}

function requireTenantKey(value: string): string {
  if (!TENANT_KEY_PATTERN.test(value)) {
    throw new SourceEndpointError(
      "ATS tenant keys must use 1-128 letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return value;
}

function requirePageInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SourceEndpointError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

/** Fixed origin and escaped tenant segment prevent caller-controlled SSRF targets. */
export function buildGreenhouseJobsEndpoint(source: GreenhouseSource): string {
  const boardToken = requireTenantKey(source.tenantKey);
  const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs`);
  if (source.includeContent) url.searchParams.set("content", "true");
  return url.toString();
}

/** Fixed global/EU origins and bounded pagination prevent arbitrary targets or query injection. */
export function buildLeverPostingsEndpoint(source: LeverSource): string {
  const site = requireTenantKey(source.tenantKey);
  const origin = source.region === "EU" ? "https://api.eu.lever.co" : "https://api.lever.co";
  const url = new URL(`/v0/postings/${encodeURIComponent(site)}`, origin);
  url.searchParams.set("mode", "json");
  if (source.page) {
    url.searchParams.set("skip", String(requirePageInteger(source.page.skip, "Lever skip", 0, 1_000_000)));
    url.searchParams.set("limit", String(requirePageInteger(source.page.limit, "Lever limit", 1, 1_000)));
  }
  return url.toString();
}

/** Fixed origin and escaped board name prevent caller-controlled SSRF targets. */
export function buildAshbyJobBoardEndpoint(source: AshbySource): string {
  const boardName = requireTenantKey(source.tenantKey);
  const url = new URL(
    `/posting-api/job-board/${encodeURIComponent(boardName)}`,
    "https://api.ashbyhq.com",
  );
  url.searchParams.set("includeCompensation", source.includeCompensation ? "true" : "false");
  return url.toString();
}

function requireExternalJobId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new SourceEndpointError("ATS job IDs must use 1-128 letters, numbers, underscores, or hyphens.");
  }
  return value;
}

/** Fixed origins only; no caller-controlled hostname is ever fetched. */
export function buildSingleJobEndpoint(reference: SupportedJobReference): string {
  const tenantKey = requireTenantKey(reference.tenantKey);
  const externalJobId = requireExternalJobId(reference.externalJobId);

  switch (reference.provider) {
    case "GREENHOUSE": {
      const url = new URL(
        `/v1/boards/${encodeURIComponent(tenantKey)}/jobs/${encodeURIComponent(externalJobId)}`,
        "https://boards-api.greenhouse.io",
      );
      url.searchParams.set("questions", "true");
      url.searchParams.set("pay_transparency", "true");
      return url.toString();
    }
    case "LEVER": {
      const origin = reference.region === "EU" ? "https://api.eu.lever.co" : "https://api.lever.co";
      const url = new URL(
        `/v0/postings/${encodeURIComponent(tenantKey)}/${encodeURIComponent(externalJobId)}`,
        origin,
      );
      url.searchParams.set("mode", "json");
      return url.toString();
    }
    case "ASHBY":
      return buildAshbyJobBoardEndpoint({
        sourceId: `direct:${tenantKey}`,
        provider: "ASHBY",
        tenantKey,
        includeCompensation: true,
      });
  }
}
