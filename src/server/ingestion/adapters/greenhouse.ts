import type {
  GreenhouseSource,
  JobSourceAdapter,
  NormalizationContext,
  NormalizationIssue,
  NormalizedSourceJob,
  NormalizedSourceSnapshot,
} from "../contracts.ts";
import { buildGreenhouseJobsEndpoint } from "../endpoints.ts";
import {
  htmlToPlainText,
  isRecord,
  isoTimestamp,
  normalizeEmployment,
  normalizeLocations,
  normalizeLongText,
  normalizeWorkplace,
  publicHttpsUrl,
  requiredRecordFields,
  stringValue,
} from "../normalize.ts";

function namesFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((member) => isRecord(member) ? stringValue(member.name) : null).filter((name): name is string => Boolean(name));
}

export const greenhouseAdapter: JobSourceAdapter<GreenhouseSource> = {
  provider: "GREENHOUSE",
  buildEndpoint: buildGreenhouseJobsEndpoint,
  normalize(payload: unknown, context: NormalizationContext): NormalizedSourceSnapshot {
    if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
      return {
        provider: this.provider,
        sourceId: context.sourceId,
        tenantKey: context.tenantKey,
        complete: false,
        jobs: [],
        issues: [{ recordIndex: null, code: "PAYLOAD_INVALID", message: "Greenhouse payload must contain a jobs array." }],
      };
    }

    const jobs: NormalizedSourceJob[] = [];
    const issues: NormalizationIssue[] = [];
    payload.jobs.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        issues.push({ recordIndex: index, code: "RECORD_INVALID", message: "Greenhouse job must be an object." });
        return;
      }
      const externalJobId = typeof candidate.id === "number" || typeof candidate.id === "string"
        ? String(candidate.id)
        : null;
      const title = stringValue(candidate.title);
      const canonicalJobUrl = publicHttpsUrl(candidate.absolute_url);
      const applyUrl = canonicalJobUrl;
      const invalid = requiredRecordFields(index, { title, canonicalJobUrl, applyUrl, externalJobId });
      if (invalid || !title || !canonicalJobUrl || !applyUrl || !externalJobId) {
        issues.push(invalid ?? { recordIndex: index, code: "RECORD_INVALID", message: "Invalid Greenhouse job." });
        return;
      }
      const location = isRecord(candidate.location) ? stringValue(candidate.location.name) : null;
      const departments = namesFromArray(candidate.departments);
      const offices = namesFromArray(candidate.offices);
      const descriptionHtml = normalizeLongText(candidate.content);
      jobs.push({
        sourceId: context.sourceId,
        provider: "GREENHOUSE",
        tenantKey: context.tenantKey,
        externalJobId,
        externalJobIdBasis: "PROVIDER_ID",
        title,
        canonicalJobUrl,
        applyUrl,
        descriptionText: htmlToPlainText(descriptionHtml),
        descriptionHtml,
        locations: normalizeLocations([
          ...(location ? [{ label: location }] : []),
          ...offices.map((label) => ({ label })),
        ]),
        department: departments[0] ?? null,
        team: null,
        workplaceType: normalizeWorkplace(null, location),
        employmentType: normalizeEmployment(null),
        requisitionId: stringValue(candidate.requisition_id),
        language: stringValue(candidate.language),
        sourcePostedAt: isoTimestamp(candidate.first_published),
        postedAtConfidence: isoTimestamp(candidate.first_published) ? "PROVIDER_ASSERTED" : "UNKNOWN",
        sourceUpdatedAt: isoTimestamp(candidate.updated_at),
        listed: true,
        compensation: [],
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
