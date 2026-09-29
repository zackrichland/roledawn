import { ashbyAdapter } from "./adapters/ashby.ts";
import { greenhouseAdapter } from "./adapters/greenhouse.ts";
import { leverAdapter } from "./adapters/lever.ts";
import { sha256Text } from "./canonical.ts";
import type {
  NormalizationContext,
  NormalizedSourceSnapshot,
  RegisteredJobSource,
  SourceFetchPort,
  SourceLoadResult,
} from "./contracts.ts";
import { SourceEndpointError } from "./endpoints.ts";

export const DEFAULT_MAX_SOURCE_RESPONSE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_SOURCE_RECORDS = 5_000;

function buildEndpoint(source: RegisteredJobSource): string {
  switch (source.provider) {
    case "GREENHOUSE": return greenhouseAdapter.buildEndpoint(source);
    case "LEVER": return leverAdapter.buildEndpoint(source);
    case "ASHBY": return ashbyAdapter.buildEndpoint(source);
  }
}

function normalizePayload(
  source: RegisteredJobSource,
  payload: unknown,
  context: NormalizationContext,
): NormalizedSourceSnapshot {
  switch (source.provider) {
    case "GREENHOUSE": return greenhouseAdapter.normalize(payload, context);
    case "LEVER": return leverAdapter.normalize(payload, context);
    case "ASHBY": return ashbyAdapter.normalize(payload, context);
  }
}

/**
 * Transport failures are not all alike: a streamed body over the cap is a
 * property of the board (retrying soon cannot help), a deadline is a slow
 * provider, and everything else is a network failure.
 */
function fetchFailure(
  endpoint: string,
  error: unknown,
  maxResponseBytes: number,
): Extract<SourceLoadResult, { kind: "FAILED" }> {
  const message = error instanceof Error ? error.message : "The source request failed.";
  if (message === "JOB_API_RESPONSE_TOO_LARGE") {
    return {
      kind: "FAILED",
      endpoint,
      code: "BODY_TOO_LARGE",
      message: `The source response exceeded the ${maxResponseBytes}-byte limit.`,
      retryable: false,
      status: null,
    };
  }
  if (message === "JOB_API_TIMEOUT" || (error instanceof Error && error.name === "TimeoutError")) {
    return {
      kind: "FAILED",
      endpoint,
      code: "FETCH_TIMEOUT",
      message: "The source did not finish responding before the request deadline.",
      retryable: true,
      status: null,
    };
  }
  return { kind: "FAILED", endpoint, code: "FETCH_FAILED", message, retryable: true, status: null };
}

function etagFrom(headers: Readonly<Record<string, string | undefined>>): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "etag") return value?.trim() || null;
  }
  return null;
}

export async function loadRegisteredJobSource(
  source: RegisteredJobSource,
  fetchPort: SourceFetchPort,
  options: Readonly<{
    ifNoneMatch?: string;
    maxResponseBytes?: number;
    maxRecords?: number;
    signal?: AbortSignal;
  }> = {},
): Promise<SourceLoadResult> {
  let endpoint: string;
  try {
    endpoint = buildEndpoint(source);
  } catch (error) {
    return {
      kind: "FAILED",
      endpoint: null,
      code: "ENDPOINT_INVALID",
      message: error instanceof SourceEndpointError ? error.message : "The source endpoint is invalid.",
      retryable: false,
      status: null,
    };
  }

  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_SOURCE_RESPONSE_BYTES;
  let response;
  try {
    response = await fetchPort.fetch({
      sourceId: source.sourceId,
      provider: source.provider,
      url: endpoint,
      ifNoneMatch: options.ifNoneMatch,
      maxResponseBytes,
      signal: options.signal,
    });
  } catch (error) {
    return fetchFailure(endpoint, error, maxResponseBytes);
  }

  const etag = etagFrom(response.headers);
  if (response.status === 304) {
    if (!options.ifNoneMatch) return {
      kind: "FAILED", endpoint, code: "NOT_MODIFIED_UNEXPECTED",
      message: "The source returned not-modified without a prior conditional request.", retryable: true, status: 304,
    };
    return {
      kind: "NOT_MODIFIED",
      endpoint,
      responseStatus: 304,
      etag,
      observedAt: response.observedAt,
    };
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      kind: "FAILED",
      endpoint,
      code: "HTTP_ERROR",
      message: `The source returned HTTP ${response.status}.`,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      status: response.status,
    };
  }

  const rawBytes = Buffer.byteLength(response.body, "utf8");
  if (rawBytes > maxResponseBytes) {
    return {
      kind: "FAILED",
      endpoint,
      code: "BODY_TOO_LARGE",
      message: `The source response exceeded the ${maxResponseBytes}-byte limit.`,
      retryable: false,
      status: response.status,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    return {
      kind: "FAILED",
      endpoint,
      code: "JSON_INVALID",
      message: "The source returned invalid JSON.",
      retryable: false,
      status: response.status,
    };
  }

  const snapshot = normalizePayload(source, payload, {
    sourceId: source.sourceId,
    tenantKey: source.tenantKey,
    observedAt: response.observedAt,
  });
  if (source.provider === "LEVER" && source.page) {
    return { kind: "LOADED", endpoint, responseStatus: response.status, observedAt: response.observedAt,
      etag, rawSha256: sha256Text(response.body), rawBytes,
      snapshot: { ...snapshot, complete: false, issues: [...snapshot.issues, { recordIndex: null, code: "PAYLOAD_INVALID", message: "A single Lever page cannot establish a complete board snapshot." }] } };
  }
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_SOURCE_RECORDS;
  if (snapshot.jobs.length > maxRecords) {
    return {
      kind: "FAILED",
      endpoint,
      code: "TOO_MANY_RECORDS",
      message: `The normalized snapshot exceeded the ${maxRecords}-record limit.`,
      retryable: false,
      status: response.status,
    };
  }

  return {
    kind: "LOADED",
    endpoint,
    responseStatus: response.status,
    observedAt: response.observedAt,
    etag,
    rawSha256: sha256Text(response.body),
    rawBytes,
    snapshot,
  };
}
