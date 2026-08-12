import type {
  SourceFetchPort,
  SourceFetchRequest,
  SourceFetchResponse,
} from "./contracts.ts";

const ALLOWED_JOB_API_ORIGINS = new Set([
  "https://boards-api.greenhouse.io",
  "https://api.lever.co",
  "https://api.eu.lever.co",
  "https://api.ashbyhq.com",
]);

const ALLOWED_JSON_MEDIA_TYPES = new Set([
  "application/json",
  "application/problem+json",
]);

export type NativeFetchPortOptions = Readonly<{
  timeoutMilliseconds?: number;
  userAgent?: string;
}>;

function allowedEndpoint(value: string): URL {
  const url = new URL(value);
  if (!ALLOWED_JOB_API_ORIGINS.has(url.origin) || url.username || url.password || url.hash) {
    throw new Error("JOB_API_ORIGIN_NOT_ALLOWED");
  }
  return url;
}

function isJsonMediaType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return ALLOWED_JSON_MEDIA_TYPES.has(mediaType) || mediaType.endsWith("+json");
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("JOB_API_RESPONSE_TOO_LARGE");
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let observedBytes = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      observedBytes += value.byteLength;
      if (observedBytes > maxBytes) throw new Error("JOB_API_RESPONSE_TOO_LARGE");
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

export function createNativeJobApiFetchPort(
  options: NativeFetchPortOptions = {},
): SourceFetchPort {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 12_000;
  const userAgent = options.userAgent ?? "RoleDawn-JobResolver/0.1";

  return {
    async fetch(request: SourceFetchRequest): Promise<SourceFetchResponse> {
      const url = allowedEndpoint(request.url);
      const timeout = AbortSignal.timeout(timeoutMilliseconds);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeout])
        : timeout;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": userAgent,
          ...(request.ifNoneMatch ? { "if-none-match": request.ifNoneMatch } : {}),
        },
        redirect: "error",
        signal,
        cache: "no-store",
      });

      if (
        response.status >= 200 &&
        response.status < 300 &&
        !isJsonMediaType(response.headers.get("content-type"))
      ) {
        await response.body?.cancel();
        throw new Error("JOB_API_RESPONSE_CONTENT_TYPE_INVALID");
      }

      const headers: Record<string, string> = {};
      for (const key of ["etag", "last-modified", "content-type"]) {
        const value = response.headers.get(key);
        if (value) headers[key] = value;
      }

      return {
        status: response.status,
        body: await readBoundedBody(response, request.maxResponseBytes),
        headers,
        observedAt: new Date().toISOString(),
      };
    },
  };
}
