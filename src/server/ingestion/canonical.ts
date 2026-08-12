import { createHash } from "node:crypto";
import type { NormalizedSourceJob } from "./contracts.ts";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function toCanonicalValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalValue);
  if (typeof value === "object") {
    const output: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) output[key] = toCanonicalValue(member);
    }
    return output;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value} values.`);
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Hashes only fields whose change can alter candidate understanding, matching,
 * preparation, or the application target. Observation timestamps are excluded.
 */
export function hashNormalizedJobVersion(job: NormalizedSourceJob): string {
  const projection = {
    schemaVersion: 1,
    title: job.title,
    canonicalJobUrl: job.canonicalJobUrl,
    applyUrl: job.applyUrl,
    descriptionText: job.descriptionText,
    descriptionHtml: job.descriptionHtml,
    locations: [...job.locations]
      .map((location) => ({ label: location.label, countryCode: location.countryCode }))
      .sort((left, right) => `${left.countryCode}:${left.label}`.localeCompare(`${right.countryCode}:${right.label}`)),
    department: job.department,
    team: job.team,
    workplaceType: job.workplaceType,
    employmentType: job.employmentType,
    requisitionId: job.requisitionId,
    language: job.language,
    compensation: [...job.compensation].sort((left, right) =>
      canonicalizeJson(left).localeCompare(canonicalizeJson(right)),
    ),
    providerIdentity: sortedUnique([job.provider, job.tenantKey, job.externalJobId]),
  };
  return sha256Text(canonicalizeJson(projection));
}

export function hashSourceListingIdentity(job: NormalizedSourceJob): string {
  return sha256Text(canonicalizeJson({
    provider: job.provider,
    tenantKey: job.tenantKey,
    externalJobId: job.externalJobId,
  }));
}
