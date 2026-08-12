import { sha256Text } from "./canonical.ts";
import type {
  EmploymentType,
  NormalizationIssue,
  NormalizedCompensation,
  NormalizedJobLocation,
  WorkplaceType,
} from "./contracts.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeLongText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized || null;
}

function decodeHtmlEntities(value: string): string {
  const codePoint = (value: string, radix: number): string => {
    const parsed = Number.parseInt(value, radix);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff
      ? String.fromCodePoint(parsed)
      : "�";
  };

  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => codePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePoint(code, 16));
}

export function htmlToPlainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Greenhouse commonly entity-encodes its entire HTML fragment. Decode before
  // removing markup so candidate-facing snapshots never expose literal tags.
  const decoded = decodeHtmlEntities(decodeHtmlEntities(value));
  const withoutExecutableBlocks = decoded.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  return normalizeLongText(decodeHtmlEntities(withoutExecutableBlocks.replace(/<[^>]*>/g, " ")));
}

export function publicHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      isIpLiteral
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function unixMillisecondsTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return new Date(value).toISOString();
}

export function normalizeWorkplace(value: unknown, locationHint?: string | null): WorkplaceType {
  const normalized = stringValue(value)?.toLowerCase();
  if (normalized === "remote") return "REMOTE";
  if (normalized === "hybrid") return "HYBRID";
  if (normalized === "on-site" || normalized === "onsite" || normalized === "on site") return "ON_SITE";
  const hint = locationHint?.toLowerCase() ?? "";
  if (/\bremote\b/.test(hint)) return "REMOTE";
  if (/\bhybrid\b/.test(hint)) return "HYBRID";
  return "UNSPECIFIED";
}

export function normalizeEmployment(value: unknown): EmploymentType {
  const normalized = stringValue(value)?.toLowerCase().replace(/[ _-]/g, "");
  if (normalized === "fulltime") return "FULL_TIME";
  if (normalized === "parttime") return "PART_TIME";
  if (normalized === "contract" || normalized === "contractor") return "CONTRACT";
  if (normalized === "intern" || normalized === "internship") return "INTERN";
  if (normalized === "temporary" || normalized === "temp") return "TEMPORARY";
  return normalized ? "OTHER" : "UNSPECIFIED";
}

export function normalizeLocations(
  values: readonly Readonly<{ label: unknown; countryCode?: unknown }>[],
): readonly NormalizedJobLocation[] {
  const byKey = new Map<string, NormalizedJobLocation>();
  for (const value of values) {
    const label = stringValue(value.label);
    if (!label) continue;
    const country = stringValue(value.countryCode)?.toUpperCase() ?? null;
    const countryCode = country && /^[A-Z]{2}$/.test(country) ? country : null;
    const location = { label, countryCode } as const;
    byKey.set(`${countryCode ?? ""}\n${label.toLowerCase()}`, location);
  }
  return [...byKey.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function normalizeCompensation(
  value: Readonly<{
    kind?: unknown;
    currencyCode?: unknown;
    interval?: unknown;
    minimum?: unknown;
    maximum?: unknown;
    summary?: unknown;
  }>,
): NormalizedCompensation {
  return {
    kind: stringValue(value.kind),
    currencyCode: stringValue(value.currencyCode)?.toUpperCase() ?? null,
    interval: stringValue(value.interval),
    minimum: nullableNumber(value.minimum),
    maximum: nullableNumber(value.maximum),
    summary: stringValue(value.summary),
  };
}

export function requiredRecordFields(
  index: number,
  values: Readonly<{ title: string | null; canonicalJobUrl: string | null; applyUrl: string | null; externalJobId: string | null }>,
): NormalizationIssue | null {
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length === 0) return null;
  return {
    recordIndex: index,
    code: missing.some((field) => field.endsWith("Url")) ? "URL_INVALID" : "RECORD_INVALID",
    message: `Skipped record with invalid required fields: ${missing.join(", ")}.`,
  };
}

export function urlDerivedExternalId(url: string): string {
  return `url-${sha256Text(url).slice(0, 32)}`;
}
