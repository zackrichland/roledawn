import assert from "node:assert/strict";
import test from "node:test";

import { hashNormalizedJobVersion } from "./canonical.ts";
import type { LoadedSourceSnapshot, NormalizedSourceJob } from "./contracts.ts";
import {
  canonicalizeSourceSnapshot,
  serializeSourceSnapshot,
  type JobSourceClaim,
} from "./source-snapshot.ts";

const observedAt = "2026-08-16T20:00:00.000Z";

const claim: JobSourceClaim = {
  sourceId: "10000000-0000-4000-a000-000000000001",
  ingestionRunId: "20000000-0000-4000-a000-000000000002",
  provider: "GREENHOUSE",
  tenantKey: "example",
  adapterRelease: "greenhouse/0.1",
  etag: null,
  sourceOptions: {},
};

function normalizedJob(externalJobId: string, title: string): NormalizedSourceJob {
  return {
    sourceId: claim.sourceId,
    provider: claim.provider,
    tenantKey: claim.tenantKey,
    externalJobId,
    externalJobIdBasis: "PROVIDER_ID",
    title,
    canonicalJobUrl: `https://job-boards.greenhouse.io/example/jobs/${externalJobId}`,
    applyUrl: `https://job-boards.greenhouse.io/example/jobs/${externalJobId}`,
    descriptionText: "Build reliable software.",
    descriptionHtml: "<p>Build reliable software.</p>",
    locations: [
      { label: "New York, NY", countryCode: "US" },
      { label: "Remote", countryCode: null },
    ],
    department: "Engineering",
    team: "Platform",
    workplaceType: "ON_SITE",
    employmentType: "FULL_TIME",
    requisitionId: `REQ-${externalJobId}`,
    language: "en",
    sourcePostedAt: "2026-08-15T12:00:00.000Z",
    postedAtConfidence: "PROVIDER_ASSERTED",
    sourceUpdatedAt: "2026-08-16T12:00:00.000Z",
    listed: true,
    compensation: [{
      kind: "Salary",
      currencyCode: "USD",
      interval: "year",
      minimum: 150_000,
      maximum: 190_000,
      summary: "$150K-$190K",
    }],
    observedAt,
  };
}

function loaded(jobs: readonly NormalizedSourceJob[]): LoadedSourceSnapshot {
  return {
    kind: "LOADED",
    endpoint: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
    responseStatus: 200,
    observedAt,
    etag: 'W/"catalog-v1"',
    rawSha256: "a".repeat(64),
    rawBytes: 2_048,
    snapshot: {
      provider: claim.provider,
      sourceId: claim.sourceId,
      tenantKey: claim.tenantKey,
      complete: true,
      jobs,
      issues: [],
    },
  };
}

test("source snapshot serialization is stable, bounded, and SQL-shaped", () => {
  const first = serializeSourceSnapshot(claim, loaded([
    normalizedJob("2", "Infrastructure Engineer"),
    normalizedJob("1", "Product Engineer"),
  ]));
  const second = serializeSourceSnapshot(claim, loaded([
    normalizedJob("1", "Product Engineer"),
    normalizedJob("2", "Infrastructure Engineer"),
  ]));

  assert.equal(canonicalizeSourceSnapshot(first), canonicalizeSourceSnapshot(second));
  assert.deepEqual(first.jobs.map((job) => job.external_job_id), ["1", "2"]);
  assert.equal(first.schema_version, 1);
  assert.equal(first.complete, true);
  assert.equal(first.observed_at, observedAt);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.jobs[0].locations, [
    { label: "New York, NY", country_code: "US" },
    { label: "Remote", country_code: null },
  ]);
  assert.equal(first.jobs[0].work_mode, "ONSITE");
  assert.match(first.jobs[0].content_hash, /^[0-9a-f]{64}$/);
  assert.equal(first.jobs[0].normalized_data.provider, "GREENHOUSE");
  assert.equal("description_html" in first.jobs[0], false);
});

test("source snapshot serialization rejects incomplete or cross-source data", () => {
  const incomplete = loaded([normalizedJob("1", "Product Engineer")]);
  assert.throws(
    () => serializeSourceSnapshot(claim, {
      ...incomplete,
      snapshot: {
        ...incomplete.snapshot,
        complete: false,
        issues: [{ recordIndex: 1, code: "RECORD_INVALID", message: "bad record" }],
      },
    }),
    /JOB_SOURCE_SNAPSHOT_INCOMPLETE/,
  );

  assert.throws(
    () => serializeSourceSnapshot(claim, loaded([{
      ...normalizedJob("1", "Product Engineer"),
      sourceId: "30000000-0000-4000-a000-000000000003",
    }])),
    /JOB_SOURCE_JOB_IDENTITY_MISMATCH/,
  );
});

test("source snapshot serialization rejects duplicate provider identities", () => {
  assert.throws(
    () => serializeSourceSnapshot(claim, loaded([
      normalizedJob("1", "Product Engineer"),
      normalizedJob("1", "Product Engineer II"),
    ])),
    /JOB_SOURCE_DUPLICATE_EXTERNAL_JOB_ID/,
  );
});

test("source snapshot serialization preserves provider-owned application fragments", () => {
  const job = normalizedJob("1", "Product Engineer");
  const snapshot = serializeSourceSnapshot(claim, loaded([{
    ...job,
    canonicalJobUrl: `${job.canonicalJobUrl}#apply`,
    applyUrl: `${job.applyUrl}#apply`,
  }]));
  assert.equal(snapshot.jobs[0].canonical_job_url.endsWith("#apply"), true);
  assert.equal(snapshot.jobs[0].apply_url.endsWith("#apply"), true);
});

test("source snapshots stay compact without losing version fidelity", () => {
  const job = normalizedJob("1", "Product Engineer");
  const snapshot = serializeSourceSnapshot(claim, loaded([job]));
  // Plain text is the catalog description; provider HTML never crosses the RPC.
  assert.equal("description_html" in snapshot.jobs[0].normalized_data, false);
  assert.equal(JSON.stringify(snapshot).includes("<p>"), false);
  assert.equal(snapshot.jobs[0].description_text, "Build reliable software.");
  // The content hash still covers the HTML, so a formatting-only provider
  // change remains a new version and existing hashes are unchanged.
  assert.equal(snapshot.jobs[0].content_hash, hashNormalizedJobVersion(job));
  const reformatted = serializeSourceSnapshot(claim, loaded([{ ...job, descriptionHtml: "<div>Build reliable software.</div>" }]));
  assert.notEqual(reformatted.jobs[0].content_hash, snapshot.jobs[0].content_hash);
});
