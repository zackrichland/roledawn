import type {
  AshbySource,
  JobSourceAdapter,
  NormalizationContext,
  NormalizationIssue,
  NormalizedSourceJob,
  NormalizedSourceSnapshot,
} from "../contracts.ts";
import { buildAshbyJobBoardEndpoint } from "../endpoints.ts";
import {
  isRecord,
  isoTimestamp,
  normalizeCompensation,
  normalizeEmployment,
  normalizeLocations,
  normalizeLongText,
  normalizeWorkplace,
  publicHttpsUrl,
  requiredRecordFields,
  stringValue,
  urlDerivedExternalId,
} from "../normalize.ts";

function countryFromAddress(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const postal = isRecord(value.postalAddress) ? value.postalAddress : value;
  return stringValue(postal.addressCountry);
}

function compensationFrom(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.summaryComponents)) return [];
  const summary = stringValue(value.compensationTierSummary) ?? stringValue(value.scrapeableCompensationSalarySummary);
  return value.summaryComponents.filter(isRecord).map((component) => normalizeCompensation({
    kind: component.compensationType,
    currencyCode: component.currencyCode,
    interval: component.interval,
    minimum: component.minValue,
    maximum: component.maxValue,
    summary,
  }));
}

export const ashbyAdapter: JobSourceAdapter<AshbySource> = {
  provider: "ASHBY",
  buildEndpoint: buildAshbyJobBoardEndpoint,
  normalize(payload: unknown, context: NormalizationContext): NormalizedSourceSnapshot {
    if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
      return {
        provider: this.provider,
        sourceId: context.sourceId,
        tenantKey: context.tenantKey,
        complete: false,
        jobs: [],
        issues: [{ recordIndex: null, code: "PAYLOAD_INVALID", message: "Ashby payload must contain a jobs array." }],
      };
    }

    const jobs: NormalizedSourceJob[] = [];
    const issues: NormalizationIssue[] = [];
    payload.jobs.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        issues.push({ recordIndex: index, code: "RECORD_INVALID", message: "Ashby job must be an object." });
        return;
      }
      const title = stringValue(candidate.title);
      const canonicalJobUrl = publicHttpsUrl(candidate.jobUrl);
      const applyUrl = publicHttpsUrl(candidate.applyUrl);
      // The live API currently returns `id`, but the public field table does not
      // document it. A URL-derived identity preserves correctness if it vanishes.
      const providerId = stringValue(candidate.id);
      const externalJobId = providerId ?? (canonicalJobUrl ? urlDerivedExternalId(canonicalJobUrl) : null);
      const invalid = requiredRecordFields(index, { title, canonicalJobUrl, applyUrl, externalJobId });
      if (invalid || !title || !canonicalJobUrl || !applyUrl || !externalJobId) {
        issues.push(invalid ?? { recordIndex: index, code: "RECORD_INVALID", message: "Invalid Ashby job." });
        return;
      }
      const primaryLocation = stringValue(candidate.location);
      const secondary = Array.isArray(candidate.secondaryLocations) ? candidate.secondaryLocations.filter(isRecord) : [];
      const primaryCountry = countryFromAddress(candidate.address);
      jobs.push({
        sourceId: context.sourceId,
        provider: "ASHBY",
        tenantKey: context.tenantKey,
        externalJobId,
        externalJobIdBasis: providerId ? "PROVIDER_ID" : "CANONICAL_URL_HASH",
        title,
        canonicalJobUrl,
        applyUrl,
        descriptionText: normalizeLongText(candidate.descriptionPlain),
        descriptionHtml: normalizeLongText(candidate.descriptionHtml),
        locations: normalizeLocations([
          ...(primaryLocation ? [{ label: primaryLocation, countryCode: primaryCountry }] : []),
          ...secondary.map((location) => ({
            label: location.location,
            countryCode: countryFromAddress(location.address),
          })),
        ]),
        department: stringValue(candidate.department),
        team: stringValue(candidate.team),
        workplaceType: normalizeWorkplace(candidate.workplaceType, primaryLocation),
        employmentType: normalizeEmployment(candidate.employmentType),
        requisitionId: null,
        language: null,
        sourcePostedAt: isoTimestamp(candidate.publishedAt),
        postedAtConfidence: isoTimestamp(candidate.publishedAt) ? "PROVIDER_ASSERTED" : "UNKNOWN",
        sourceUpdatedAt: null,
        listed: candidate.isListed !== false,
        compensation: compensationFrom(candidate.compensation),
        observedAt: context.observedAt,
      });
    });

    return {
      provider: this.provider,
      sourceId: context.sourceId,
      tenantKey: context.tenantKey,
      complete: issues.length === 0,
      jobs,
      issues,
    };
  },
};
