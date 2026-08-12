import type {
  JobSourceAdapter,
  LeverSource,
  NormalizationContext,
  NormalizationIssue,
  NormalizedSourceJob,
  NormalizedSourceSnapshot,
} from "../contracts.ts";
import { buildLeverPostingsEndpoint } from "../endpoints.ts";
import {
  isRecord,
  normalizeCompensation,
  normalizeEmployment,
  normalizeLocations,
  normalizeLongText,
  normalizeWorkplace,
  publicHttpsUrl,
  requiredRecordFields,
  stringValue,
  unixMillisecondsTimestamp,
} from "../normalize.ts";

export const leverAdapter: JobSourceAdapter<LeverSource> = {
  provider: "LEVER",
  buildEndpoint: buildLeverPostingsEndpoint,
  normalize(payload: unknown, context: NormalizationContext): NormalizedSourceSnapshot {
    if (!Array.isArray(payload)) {
      return {
        provider: this.provider,
        sourceId: context.sourceId,
        tenantKey: context.tenantKey,
        complete: false,
        jobs: [],
        issues: [{ recordIndex: null, code: "PAYLOAD_INVALID", message: "Lever payload must be an array." }],
      };
    }

    const jobs: NormalizedSourceJob[] = [];
    const issues: NormalizationIssue[] = [];
    payload.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        issues.push({ recordIndex: index, code: "RECORD_INVALID", message: "Lever posting must be an object." });
        return;
      }
      const categories = isRecord(candidate.categories) ? candidate.categories : {};
      const externalJobId = stringValue(candidate.id);
      const title = stringValue(candidate.text);
      const canonicalJobUrl = publicHttpsUrl(candidate.hostedUrl);
      const applyUrl = publicHttpsUrl(candidate.applyUrl);
      const invalid = requiredRecordFields(index, { title, canonicalJobUrl, applyUrl, externalJobId });
      if (invalid || !title || !canonicalJobUrl || !applyUrl || !externalJobId) {
        issues.push(invalid ?? { recordIndex: index, code: "RECORD_INVALID", message: "Invalid Lever posting." });
        return;
      }
      const primaryLocation = stringValue(categories.location);
      const allLocations = Array.isArray(categories.allLocations) ? categories.allLocations : [];
      const countryCode = stringValue(candidate.country);
      const salary = isRecord(candidate.salaryRange) ? candidate.salaryRange : null;
      jobs.push({
        sourceId: context.sourceId,
        provider: "LEVER",
        tenantKey: context.tenantKey,
        externalJobId,
        externalJobIdBasis: "PROVIDER_ID",
        title,
        canonicalJobUrl,
        applyUrl,
        descriptionText: normalizeLongText(candidate.descriptionPlain),
        descriptionHtml: normalizeLongText(candidate.description),
        locations: normalizeLocations([
          ...(primaryLocation ? [{ label: primaryLocation, countryCode }] : []),
          ...allLocations.map((label) => ({ label, countryCode })),
        ]),
        department: stringValue(categories.department),
        team: stringValue(categories.team),
        workplaceType: normalizeWorkplace(candidate.workplaceType, primaryLocation),
        employmentType: normalizeEmployment(categories.commitment),
        requisitionId: null,
        language: null,
        sourcePostedAt: unixMillisecondsTimestamp(candidate.createdAt),
        postedAtConfidence: unixMillisecondsTimestamp(candidate.createdAt) ? "OBSERVED_UNDOCUMENTED" : "UNKNOWN",
        sourceUpdatedAt: null,
        listed: true,
        compensation: salary ? [normalizeCompensation({
          currencyCode: salary.currency,
          interval: salary.interval,
          minimum: salary.min,
          maximum: salary.max,
          summary: candidate.salaryDescriptionPlain,
          kind: "Salary",
        })] : [],
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
