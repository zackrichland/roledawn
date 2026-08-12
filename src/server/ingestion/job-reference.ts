import { normalizePublicJobUrl } from "../../domain/job-url.ts";
import type { SupportedJobReference } from "./contracts.ts";

export type ParseJobReferenceResult =
  | Readonly<{ ok: true; value: SupportedJobReference }>
  | Readonly<{
      ok: false;
      code: "ATS_UNSUPPORTED" | "JOB_URL_SHAPE_UNSUPPORTED";
      message: string;
    }>;

function cleanSegments(pathname: string): string[] | null {
  try {
    return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
}

function lastGreenhouseJobId(url: URL, segments: readonly string[]): string | null {
  const jobsIndex = segments.findIndex((segment) => segment.toLowerCase() === "jobs");
  const fromPath = jobsIndex >= 0 ? segments[jobsIndex + 1] : null;
  return fromPath ?? url.searchParams.get("gh_jid");
}

function canonicalPostingUrl(
  host: string,
  tenantKey: string,
  externalJobId: string,
): string {
  const encodedTenant = encodeURIComponent(tenantKey);
  const encodedJobId = encodeURIComponent(externalJobId);
  return `https://${host}/${encodedTenant}/jobs/${encodedJobId}`;
}

function canonicalPathPostingUrl(
  host: string,
  tenantKey: string,
  externalJobId: string,
): string {
  return `https://${host}/${encodeURIComponent(tenantKey)}/${encodeURIComponent(externalJobId)}`;
}

export function parseSupportedJobReference(rawUrl: string): ParseJobReferenceResult {
  const normalized = normalizePublicJobUrl(rawUrl);
  if (!normalized.ok) {
    return {
      ok: false,
      code: "JOB_URL_SHAPE_UNSUPPORTED",
      message: normalized.error.message,
    };
  }

  const url = new URL(normalized.value);
  const host = url.hostname.toLowerCase();
  const segments = cleanSegments(url.pathname);
  if (!segments) {
    return {
      ok: false,
      code: "JOB_URL_SHAPE_UNSUPPORTED",
      message: "That job link contains an invalid encoded path.",
    };
  }

  if (
    host === "boards.greenhouse.io" ||
    host === "job-boards.greenhouse.io" ||
    host === "boards.eu.greenhouse.io" ||
    host === "job-boards.eu.greenhouse.io"
  ) {
    const tenantKey = segments[0];
    const externalJobId = lastGreenhouseJobId(url, segments);
    if (!tenantKey || !externalJobId) {
      return {
        ok: false,
        code: "JOB_URL_SHAPE_UNSUPPORTED",
        message: "That Greenhouse link does not include both a board and job ID.",
      };
    }
    return {
      ok: true,
      value: {
        provider: "GREENHOUSE",
        tenantKey,
        externalJobId,
        canonicalInputUrl: canonicalPostingUrl(
          host,
          tenantKey,
          externalJobId,
        ),
      },
    };
  }

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const [tenantKey, externalJobId] = segments;
    if (!tenantKey || !externalJobId) {
      return {
        ok: false,
        code: "JOB_URL_SHAPE_UNSUPPORTED",
        message: "That Lever link does not include both a site and posting ID.",
      };
    }
    return {
      ok: true,
      value: {
        provider: "LEVER",
        tenantKey,
        externalJobId,
        region: host === "jobs.eu.lever.co" ? "EU" : "GLOBAL",
        canonicalInputUrl: canonicalPathPostingUrl(host, tenantKey, externalJobId),
      },
    };
  }

  if (host === "jobs.ashbyhq.com") {
    const [tenantKey, externalJobId] = segments;
    if (!tenantKey || !externalJobId) {
      return {
        ok: false,
        code: "JOB_URL_SHAPE_UNSUPPORTED",
        message: "That Ashby link does not include both a board and job ID.",
      };
    }
    return {
      ok: true,
      value: {
        provider: "ASHBY",
        tenantKey,
        externalJobId,
        canonicalInputUrl: canonicalPathPostingUrl(host, tenantKey, externalJobId),
      },
    };
  }

  return {
    ok: false,
    code: "ATS_UNSUPPORTED",
    message: "Direct preparation currently supports official Greenhouse, Lever, and Ashby job links.",
  };
}
