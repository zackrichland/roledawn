import assert from "node:assert/strict";
import test from "node:test";

import {
  isUuid,
  normalizeOpportunityEmploymentType,
  normalizeOpportunityLocation,
  normalizeOpportunityQuery,
  normalizeOpportunityWorkMode,
  parseOpportunityCatalogFitSummary,
  parseOpportunityCatalogRows,
} from "./opportunity-catalog.ts";

const ROW = Object.freeze({
  job_id: "681215c7-0d80-4420-ba13-c4af20296c0d",
  job_version_id: "af0ac728-761f-43ac-9afc-dd82f8f26144",
  canonical_url: "https://boards.greenhouse.io/example/jobs/123",
  employer_name: "Northline Robotics",
  title: "Solutions Engineer",
  location_text: "Washington, DC",
  work_mode: "HYBRID",
  employment_type: "FULL_TIME",
  description_text: "Build implementation plans with customers.",
  apply_url: "https://boards.greenhouse.io/example/jobs/123",
  published_at: null,
  observed_at: "2026-08-16T20:00:00Z",
  source_provider: "GREENHOUSE",
  saved: false,
  queued_application_id: null,
});

test("normalizes catalog queries to one bounded line", () => {
  assert.equal(normalizeOpportunityQuery("  solutions   engineer\nremote  "), "solutions engineer remote");
  assert.equal(normalizeOpportunityQuery("x".repeat(200)).length, 120);
});

test("parses catalog rows without exposing provider identifiers as presentation data", () => {
  assert.deepEqual(parseOpportunityCatalogRows([ROW]), [{
    jobId: ROW.job_id,
    jobVersionId: ROW.job_version_id,
    canonicalUrl: ROW.canonical_url,
    employerName: ROW.employer_name,
    title: ROW.title,
    location: ROW.location_text,
    workMode: ROW.work_mode,
    employmentType: ROW.employment_type,
    description: ROW.description_text,
    applyUrl: ROW.apply_url,
    publishedAt: null,
    observedAt: ROW.observed_at,
    sourceProvider: ROW.source_provider,
    saved: false,
    queuedApplicationId: null,
    fit: null,
  }]);
});

test("parses a version-bound fit summary without accepting percentage scores", () => {
  const version = {
    entityId: ROW.job_id,
    versionId: ROW.job_version_id,
    versionNumber: 3,
    contentHash: "sha256:catalog-projection",
    capturedAt: ROW.observed_at,
  };
  const summary = {
    assessmentId: "catalog-read:abc",
    evaluatedAt: "2026-08-18T22:00:00Z",
    policyVersion: "roledawn-job-fit/1",
    decision: "REVIEW",
    matchedComponents: 3,
    reasons: ["Eligibility needs review because the employer's sponsorship policy is not known."],
    candidateProfileVersion: version,
    jobVersion: version,
  };

  assert.deepEqual(parseOpportunityCatalogFitSummary(summary), summary);
  assert.throws(
    () => parseOpportunityCatalogFitSummary({ ...summary, percentage: 82 }),
    /OPPORTUNITY_CATALOG_FIT_INVALID/u,
  );
  assert.throws(
    () => parseOpportunityCatalogFitSummary({ ...summary, reasons: ["one", "two", "three"] }),
    /OPPORTUNITY_CATALOG_FIT_INVALID/u,
  );
});

test("accepts only supported filter values", () => {
  assert.equal(normalizeOpportunityLocation("  Washington,   DC "), "Washington, DC");
  assert.equal(normalizeOpportunityWorkMode("REMOTE"), "REMOTE");
  assert.equal(normalizeOpportunityWorkMode("ANYWHERE"), "");
  assert.equal(normalizeOpportunityEmploymentType("CONTRACT"), "CONTRACT");
  assert.equal(normalizeOpportunityEmploymentType("PERMANENT"), "");
});

test("rejects malformed catalog rows before they reach the interface", () => {
  assert.throws(
    () => parseOpportunityCatalogRows([{ ...ROW, apply_url: "javascript:alert(1)" }]),
    /OPPORTUNITY_CATALOG_ROW_INVALID/,
  );
  assert.throws(
    () => parseOpportunityCatalogRows([{ ...ROW, saved: "false" }]),
    /OPPORTUNITY_CATALOG_ROW_INVALID/,
  );
});

test("validates public command identifiers", () => {
  assert.equal(isUuid(ROW.job_id), true);
  assert.equal(isUuid("FH208"), false);
});
