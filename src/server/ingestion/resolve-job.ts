import { ashbyAdapter } from "./adapters/ashby.ts";
import { greenhouseAdapter } from "./adapters/greenhouse.ts";
import { leverAdapter } from "./adapters/lever.ts";
import { sha256Text } from "./canonical.ts";
import type {
  NormalizedSourceSnapshot,
  PublicJobResolutionResult,
  SourceFetchPort,
  SupportedJobReference,
} from "./contracts.ts";
import { DEFAULT_MAX_SOURCE_RESPONSE_BYTES } from "./load-source.ts";
import { buildSingleJobEndpoint, SourceEndpointError } from "./endpoints.ts";
import { parseSupportedJobReference } from "./job-reference.ts";

function normalizeSinglePayload(
  reference: SupportedJobReference,
  payload: unknown,
  observedAt: string,
): NormalizedSourceSnapshot {
  const context = {
    sourceId: `direct:${reference.provider.toLowerCase()}:${reference.tenantKey}`,
    tenantKey: reference.tenantKey,
    observedAt,
  } as const;
  switch (reference.provider) {
    case "GREENHOUSE":
      return greenhouseAdapter.normalize({ jobs: [payload] }, context);
    case "LEVER":
      return leverAdapter.normalize([payload], context);
    case "ASHBY":
      return ashbyAdapter.normalize(payload, context);
  }
}

function selectRequestedJob(
  reference: SupportedJobReference,
  snapshot: NormalizedSourceSnapshot,
) {
  if (reference.provider !== "ASHBY") return snapshot.jobs[0] ?? null;

  const expectedUrl = new URL(reference.canonicalInputUrl);
  const expectedPath = expectedUrl.pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/$/, "");
  return snapshot.jobs.find((job) => {
    const canonicalPath = new URL(job.canonicalJobUrl).pathname.replace(/\/$/, "");
    const applyPath = new URL(job.applyUrl).pathname.replace(/\/(apply|application)\/?$/i, "").replace(/\/$/, "");
    return job.externalJobId === reference.externalJobId || canonicalPath === expectedPath || applyPath === expectedPath;
  }) ?? null;
}

export async function resolvePublicJobUrl(
  jobUrl: string,
  fetchPort: SourceFetchPort,
  options: Readonly<{ maxResponseBytes?: number; signal?: AbortSignal }> = {},
): Promise<PublicJobResolutionResult> {
  const parsed = parseSupportedJobReference(jobUrl);
  if (!parsed.ok) return { kind: "UNSUPPORTED", ...parsed };

  let endpoint: string;
  try {
    endpoint = buildSingleJobEndpoint(parsed.value);
  } catch (error) {
    return {
      kind: "UNSUPPORTED",
      code: "JOB_URL_SHAPE_UNSUPPORTED",
      message: error instanceof SourceEndpointError ? error.message : "The job reference is invalid.",
    };
  }

  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_SOURCE_RESPONSE_BYTES;
  let response;
  try {
    response = await fetchPort.fetch({
      sourceId: `direct:${parsed.value.provider.toLowerCase()}:${parsed.value.tenantKey}`,
      provider: parsed.value.provider,
      url: endpoint,
      maxResponseBytes,
      signal: options.signal,
    });
  } catch (error) {
    return {
      kind: "FAILED",
      code: "FETCH_FAILED",
      message: error instanceof Error ? error.message : "The official job endpoint could not be reached.",
      retryable: true,
      status: null,
    };
  }

  if (response.status < 200 || response.status >= 300) {
    return {
      kind: "FAILED",
      code: response.status === 404 ? "JOB_NOT_FOUND" : "HTTP_ERROR",
      message: response.status === 404 ? "The official ATS no longer lists that job." : `The official ATS returned HTTP ${response.status}.`,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      status: response.status,
    };
  }

  const rawBytes = Buffer.byteLength(response.body, "utf8");
  if (rawBytes > maxResponseBytes) {
    return {
      kind: "FAILED",
      code: "BODY_TOO_LARGE",
      message: `The official response exceeded the ${maxResponseBytes}-byte limit.`,
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
      code: "JSON_INVALID",
      message: "The official ATS returned invalid JSON.",
      retryable: false,
      status: response.status,
    };
  }

  const snapshot = normalizeSinglePayload(parsed.value, payload, response.observedAt);
  if (!snapshot.complete || snapshot.issues.length > 0) {
    return {
      kind: "FAILED",
      code: "PAYLOAD_INVALID",
      message: snapshot.issues[0]?.message ?? "The official job payload is incomplete.",
      retryable: false,
      status: response.status,
    };
  }

  const job = selectRequestedJob(parsed.value, snapshot);
  if (!job) {
    return {
      kind: "FAILED",
      code: "JOB_NOT_FOUND",
      message: "The official ATS no longer lists that job.",
      retryable: false,
      status: response.status,
    };
  }

  return {
    kind: "RESOLVED",
    value: {
      reference: parsed.value,
      endpoint,
      rawSha256: sha256Text(response.body),
      rawBytes,
      job,
    },
  };
}
