import assert from "node:assert/strict";
import test from "node:test";
import { ashbyAdapter } from "./adapters/ashby.ts";
import { greenhouseAdapter } from "./adapters/greenhouse.ts";
import { leverAdapter } from "./adapters/lever.ts";
import { canonicalizeJson, hashNormalizedJobVersion, sha256Text } from "./canonical.ts";
import type { SourceFetchPort, SourceFetchRequest, SourceFetchResponse } from "./contracts.ts";
import {
  buildAshbyJobBoardEndpoint,
  buildGreenhouseJobsEndpoint,
  buildLeverPostingsEndpoint,
  buildSingleJobEndpoint,
  SourceEndpointError,
} from "./endpoints.ts";
import { parseSupportedJobReference } from "./job-reference.ts";
import { loadRegisteredJobSource } from "./load-source.ts";
import { resolvePublicJobUrl } from "./resolve-job.ts";
import { createNativeJobApiFetchPort } from "./fetch-port.ts";

const observedAt = "2026-08-12T01:00:00.000Z";

const greenhouseFixture = {
  jobs: [{
    id: 8017323,
    internal_job_id: 3475870,
    requisition_id: "2026 - 1986",
    title: " Data   Scientist ",
    updated_at: "2026-07-15T19:03:30-04:00",
    first_published: "2026-06-30T20:00:33-04:00",
    location: { name: "Ontario" },
    absolute_url: "https://job-boards.greenhouse.io/greenhouse/jobs/8017323?gh_jid=8017323#apply",
    language: "en",
    content: "&lt;p&gt;Build &amp;amp; test models.&lt;/p&gt;",
    departments: [{ id: 1, name: "Analytics" }],
    offices: [{ id: 2, name: "Canada" }],
  }],
};

const leverFixture = [{
  id: "ac978161-6f46-4f6b-ad9e-a258e642751c",
  text: "Administrative Business Partner",
  categories: {
    commitment: "Full-time",
    location: "London, United Kingdom",
    team: "Administrative",
    department: "Operations",
    allLocations: ["London, United Kingdom", "New York, NY"],
  },
  country: "GB",
  createdAt: 1711403416463,
  workplaceType: "hybrid",
  description: "<p>Partner with leaders.</p>",
  descriptionPlain: "Partner with leaders.",
  hostedUrl: "https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c",
  applyUrl: "https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c/apply",
  salaryRange: { currency: "GBP", interval: "year", min: 80000, max: 100000 },
  salaryDescriptionPlain: "Annual salary range",
}];

const ashbyFixture = {
  apiVersion: "1",
  jobs: [{
    id: "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
    title: "Engineering Manager - EU",
    location: "Remote - European Union",
    secondaryLocations: [{ location: "London", address: { addressCountry: "GB" } }],
    department: "Engineering",
    team: "EMEA Engineering",
    isListed: false,
    isRemote: true,
    workplaceType: "Remote",
    descriptionHtml: "<p>Lead a team.</p>",
    descriptionPlain: "Lead a team.",
    publishedAt: "2024-03-04T14:29:08.532+00:00",
    employmentType: "FullTime",
    address: { postalAddress: { addressCountry: "DE" } },
    jobUrl: "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
    applyUrl: "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application",
    compensation: {
      compensationTierSummary: "EUR 120K-150K",
      summaryComponents: [{
        compensationType: "Salary",
        interval: "1 YEAR",
        currencyCode: "EUR",
        minValue: 120000,
        maxValue: 150000,
      }],
    },
  }],
};

test("endpoint builders use fixed public ATS origins and bounded tenant keys", () => {
  assert.equal(
    buildGreenhouseJobsEndpoint({ sourceId: "gh-1", provider: "GREENHOUSE", tenantKey: "greenhouse", includeContent: true }),
    "https://boards-api.greenhouse.io/v1/boards/greenhouse/jobs?content=true",
  );
  assert.equal(
    buildLeverPostingsEndpoint({ sourceId: "lv-1", provider: "LEVER", tenantKey: "palantir", region: "EU", page: { skip: 10, limit: 50 } }),
    "https://api.eu.lever.co/v0/postings/palantir?mode=json&skip=10&limit=50",
  );
  assert.equal(
    buildAshbyJobBoardEndpoint({ sourceId: "as-1", provider: "ASHBY", tenantKey: "Ashby", includeCompensation: true }),
    "https://api.ashbyhq.com/posting-api/job-board/Ashby?includeCompensation=true",
  );
  assert.throws(
    () => buildGreenhouseJobsEndpoint({ sourceId: "bad", provider: "GREENHOUSE", tenantKey: "../../metadata" }),
    SourceEndpointError,
  );
  assert.throws(
    () => buildLeverPostingsEndpoint({ sourceId: "bad", provider: "LEVER", tenantKey: "evil.com/path" }),
    SourceEndpointError,
  );
});

test("official posting URLs parse to fixed-origin provider references", () => {
  assert.deepEqual(
    parseSupportedJobReference("https://job-boards.greenhouse.io/greenhouse/jobs/8017323?gh_jid=8017323"),
    {
      ok: true,
      value: {
        provider: "GREENHOUSE",
        tenantKey: "greenhouse",
        externalJobId: "8017323",
        canonicalInputUrl: "https://job-boards.greenhouse.io/greenhouse/jobs/8017323",
      },
    },
  );
  assert.deepEqual(
    parseSupportedJobReference("https://jobs.eu.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c/apply"),
    {
      ok: true,
      value: {
        provider: "LEVER",
        tenantKey: "palantir",
        externalJobId: "ac978161-6f46-4f6b-ad9e-a258e642751c",
        region: "EU",
        canonicalInputUrl: "https://jobs.eu.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c",
      },
    },
  );
  assert.deepEqual(
    parseSupportedJobReference("https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application"),
    {
      ok: true,
      value: {
        provider: "ASHBY",
        tenantKey: "Ashby",
        externalJobId: "7458d4e9-da2e-47bd-98cb-adfda43d42b2",
        canonicalInputUrl: "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
      },
    },
  );
  const unsupported = parseSupportedJobReference("https://careers.example.com/jobs/123");
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.code, "ATS_UNSUPPORTED");
  const malformed = parseSupportedJobReference("https://jobs.lever.co/example/%E0%A4%A");
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, "JOB_URL_SHAPE_UNSUPPORTED");
});

test("official posting variants collapse to one stable application identity", () => {
  const greenhouse = parseSupportedJobReference(
    "https://job-boards.greenhouse.io/greenhouse/jobs/8017323?gh_jid=8017323&utm_source=referral#apply",
  );
  assert.equal(greenhouse.ok, true);
  if (greenhouse.ok) {
    assert.equal(
      greenhouse.value.canonicalInputUrl,
      "https://job-boards.greenhouse.io/greenhouse/jobs/8017323",
    );
  }

  const lever = parseSupportedJobReference(
    "https://jobs.eu.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c/apply?lever-source=friend",
  );
  assert.equal(lever.ok, true);
  if (lever.ok) {
    assert.equal(
      lever.value.canonicalInputUrl,
      "https://jobs.eu.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c",
    );
  }

  const ashby = parseSupportedJobReference(
    "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application?utm_medium=share",
  );
  assert.equal(ashby.ok, true);
  if (ashby.ok) {
    assert.equal(
      ashby.value.canonicalInputUrl,
      "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2",
    );
  }
});

test("single-job endpoints preserve fixed public origins", () => {
  assert.equal(
    buildSingleJobEndpoint({
      provider: "GREENHOUSE",
      tenantKey: "greenhouse",
      externalJobId: "8017323",
      canonicalInputUrl: "https://job-boards.greenhouse.io/greenhouse/jobs/8017323",
    }),
    "https://boards-api.greenhouse.io/v1/boards/greenhouse/jobs/8017323?questions=true&pay_transparency=true",
  );
  assert.equal(
    buildSingleJobEndpoint({
      provider: "LEVER",
      tenantKey: "palantir",
      externalJobId: "ac978161-6f46-4f6b-ad9e-a258e642751c",
      region: "EU",
      canonicalInputUrl: "https://jobs.eu.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c",
    }),
    "https://api.eu.lever.co/v0/postings/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c?mode=json",
  );
  assert.throws(
    () => buildSingleJobEndpoint({
      provider: "LEVER",
      tenantKey: "palantir",
      externalJobId: "../metadata",
      canonicalInputUrl: "https://jobs.lever.co/palantir/metadata",
    }),
    SourceEndpointError,
  );
});

test("Greenhouse fixture normalizes provider identity, provenance, and text", () => {
  const snapshot = greenhouseAdapter.normalize(greenhouseFixture, { sourceId: "gh-1", tenantKey: "greenhouse", observedAt });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.jobs.length, 1);
  assert.deepEqual(snapshot.jobs[0], {
    sourceId: "gh-1",
    provider: "GREENHOUSE",
    tenantKey: "greenhouse",
    externalJobId: "8017323",
    externalJobIdBasis: "PROVIDER_ID",
    title: "Data Scientist",
    canonicalJobUrl: "https://job-boards.greenhouse.io/greenhouse/jobs/8017323?gh_jid=8017323",
    applyUrl: "https://job-boards.greenhouse.io/greenhouse/jobs/8017323?gh_jid=8017323",
    descriptionText: "Build & test models.",
    descriptionHtml: "&lt;p&gt;Build &amp;amp; test models.&lt;/p&gt;",
    locations: [{ label: "Canada", countryCode: null }, { label: "Ontario", countryCode: null }],
    department: "Analytics",
    team: null,
    workplaceType: "UNSPECIFIED",
    employmentType: "UNSPECIFIED",
    requisitionId: "2026 - 1986",
    language: "en",
    sourcePostedAt: "2026-07-01T00:00:33.000Z",
    postedAtConfidence: "PROVIDER_ASSERTED",
    sourceUpdatedAt: "2026-07-15T23:03:30.000Z",
    listed: true,
    compensation: [],
    observedAt,
  });
});

test("Lever fixture normalizes pagination-shaped posting fields deterministically", () => {
  const snapshot = leverAdapter.normalize(leverFixture, { sourceId: "lv-1", tenantKey: "palantir", observedAt });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.jobs[0].employmentType, "FULL_TIME");
  assert.equal(snapshot.jobs[0].workplaceType, "HYBRID");
  assert.equal(snapshot.jobs[0].sourcePostedAt, "2024-03-25T21:50:16.463Z");
  assert.equal(snapshot.jobs[0].postedAtConfidence, "OBSERVED_UNDOCUMENTED");
  assert.deepEqual(snapshot.jobs[0].locations, [
    { label: "London, United Kingdom", countryCode: "GB" },
    { label: "New York, NY", countryCode: "GB" },
  ]);
  assert.deepEqual(snapshot.jobs[0].compensation, [{
    kind: "Salary",
    currencyCode: "GBP",
    interval: "year",
    minimum: 80000,
    maximum: 100000,
    summary: "Annual salary range",
  }]);
});

test("Ashby honors unlisted state and falls back to a URL-derived identity", () => {
  const payloadWithoutObservedId = structuredClone(ashbyFixture);
  delete (payloadWithoutObservedId.jobs[0] as { id?: string }).id;
  const snapshot = ashbyAdapter.normalize(payloadWithoutObservedId, { sourceId: "as-1", tenantKey: "Ashby", observedAt });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.jobs[0].listed, false);
  assert.equal(snapshot.jobs[0].externalJobIdBasis, "CANONICAL_URL_HASH");
  assert.match(snapshot.jobs[0].externalJobId, /^url-[a-f0-9]{32}$/);
  assert.equal(snapshot.jobs[0].workplaceType, "REMOTE");
  assert.equal(snapshot.jobs[0].employmentType, "FULL_TIME");
  assert.equal(snapshot.jobs[0].compensation[0].currencyCode, "EUR");
});

test("malformed records make a snapshot incomplete and never publish partial required fields", () => {
  const payload = { jobs: [...greenhouseFixture.jobs, { id: 2, title: "Missing URL" }] };
  const snapshot = greenhouseAdapter.normalize(payload, { sourceId: "gh-1", tenantKey: "greenhouse", observedAt });
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.jobs.length, 1);
  assert.equal(snapshot.issues[0].recordIndex, 1);
  assert.equal(snapshot.issues[0].code, "URL_INVALID");
});

test("canonical JSON and job hashes do not depend on object key or location order", () => {
  assert.equal(canonicalizeJson({ z: 1, a: { y: true, x: null } }), '{"a":{"x":null,"y":true},"z":1}');
  const snapshot = leverAdapter.normalize(leverFixture, { sourceId: "lv-1", tenantKey: "palantir", observedAt });
  const job = snapshot.jobs[0];
  assert.equal(
    hashNormalizedJobVersion(job),
    hashNormalizedJobVersion({ ...job, observedAt: "2026-08-13T01:00:00.000Z", locations: [...job.locations].reverse() }),
  );
  assert.notEqual(hashNormalizedJobVersion(job), hashNormalizedJobVersion({ ...job, title: `${job.title} II` }));
});

class FixtureFetchPort implements SourceFetchPort {
  readonly requests: SourceFetchRequest[] = [];
  private readonly response: SourceFetchResponse | Error;

  constructor(response: SourceFetchResponse | Error) {
    this.response = response;
  }

  async fetch(request: SourceFetchRequest): Promise<SourceFetchResponse> {
    this.requests.push(request);
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

test("source loader injects fetch, propagates ETag, and hashes raw payload", async () => {
  const body = JSON.stringify(greenhouseFixture);
  const port = new FixtureFetchPort({ status: 200, body, headers: { ETag: 'W/"fixture"' }, observedAt });
  const result = await loadRegisteredJobSource(
    { sourceId: "gh-1", provider: "GREENHOUSE", tenantKey: "greenhouse", includeContent: true },
    port,
    { ifNoneMatch: 'W/"old"' },
  );
  assert.equal(result.kind, "LOADED");
  if (result.kind !== "LOADED") return;
  assert.equal(result.rawSha256, sha256Text(body));
  assert.equal(result.etag, 'W/"fixture"');
  assert.equal(port.requests[0].ifNoneMatch, 'W/"old"');
  assert.equal(port.requests[0].url, "https://boards-api.greenhouse.io/v1/boards/greenhouse/jobs?content=true");
});

test("source loader treats 304 as health success without normalization", async () => {
  const port = new FixtureFetchPort({ status: 304, body: "", headers: { etag: 'W/"same"' }, observedAt });
  const result = await loadRegisteredJobSource(
    { sourceId: "lv-1", provider: "LEVER", tenantKey: "palantir" },
    port,
  );
  assert.deepEqual(result, {
    kind: "NOT_MODIFIED",
    endpoint: "https://api.lever.co/v0/postings/palantir?mode=json",
    etag: 'W/"same"',
    observedAt,
  });
});

test("source loader classifies retries and enforces response and record budgets", async () => {
  const rateLimited = await loadRegisteredJobSource(
    { sourceId: "as-1", provider: "ASHBY", tenantKey: "Ashby" },
    new FixtureFetchPort({ status: 429, body: "{}", headers: {}, observedAt }),
  );
  assert.equal(rateLimited.kind, "FAILED");
  if (rateLimited.kind === "FAILED") assert.equal(rateLimited.retryable, true);

  const tooLarge = await loadRegisteredJobSource(
    { sourceId: "as-1", provider: "ASHBY", tenantKey: "Ashby" },
    new FixtureFetchPort({ status: 200, body: JSON.stringify(ashbyFixture), headers: {}, observedAt }),
    { maxResponseBytes: 10 },
  );
  assert.equal(tooLarge.kind, "FAILED");
  if (tooLarge.kind === "FAILED") assert.equal(tooLarge.code, "BODY_TOO_LARGE");

  const tooMany = await loadRegisteredJobSource(
    { sourceId: "gh-1", provider: "GREENHOUSE", tenantKey: "greenhouse" },
    new FixtureFetchPort({ status: 200, body: JSON.stringify(greenhouseFixture), headers: {}, observedAt }),
    { maxRecords: 0 },
  );
  assert.equal(tooMany.kind, "FAILED");
  if (tooMany.kind === "FAILED") assert.equal(tooMany.code, "TOO_MANY_RECORDS");
});

test("direct resolver selects one Greenhouse job and keeps official provenance", async () => {
  const singleJob = greenhouseFixture.jobs[0];
  const body = JSON.stringify(singleJob);
  const port = new FixtureFetchPort({ status: 200, body, headers: {}, observedAt });
  const result = await resolvePublicJobUrl(
    "https://job-boards.greenhouse.io/greenhouse/jobs/8017323?gh_jid=8017323",
    port,
  );
  assert.equal(result.kind, "RESOLVED");
  if (result.kind !== "RESOLVED") return;
  assert.equal(result.value.job.title, "Data Scientist");
  assert.equal(result.value.job.externalJobId, "8017323");
  assert.equal(result.value.rawSha256, sha256Text(body));
  assert.equal(port.requests[0].url, result.value.endpoint);
});

test("direct resolver filters an Ashby board to the requested job", async () => {
  const other = {
    ...ashbyFixture.jobs[0],
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Another Role",
    jobUrl: "https://jobs.ashbyhq.com/Ashby/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    applyUrl: "https://jobs.ashbyhq.com/Ashby/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/application",
  };
  const body = JSON.stringify({ ...ashbyFixture, jobs: [other, ...ashbyFixture.jobs] });
  const result = await resolvePublicJobUrl(
    "https://jobs.ashbyhq.com/Ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application",
    new FixtureFetchPort({ status: 200, body, headers: {}, observedAt }),
  );
  assert.equal(result.kind, "RESOLVED");
  if (result.kind === "RESOLVED") assert.equal(result.value.job.title, "Engineering Manager - EU");
});

test("direct resolver fails closed for unsupported and missing postings", async () => {
  const unsupported = await resolvePublicJobUrl(
    "https://careers.example.com/jobs/123",
    new FixtureFetchPort(new Error("must not fetch")),
  );
  assert.equal(unsupported.kind, "UNSUPPORTED");

  const missing = await resolvePublicJobUrl(
    "https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c",
    new FixtureFetchPort({ status: 404, body: "{}", headers: {}, observedAt }),
  );
  assert.equal(missing.kind, "FAILED");
  if (missing.kind === "FAILED") {
    assert.equal(missing.code, "JOB_NOT_FOUND");
    assert.equal(missing.retryable, false);
  }
});

test("native fetch port refuses caller-controlled origins before network access", async () => {
  const port = createNativeJobApiFetchPort();
  await assert.rejects(
    port.fetch({
      sourceId: "bad",
      provider: "GREENHOUSE",
      url: "https://example.com/latest/meta-data",
      maxResponseBytes: 1_024,
    }),
    /JOB_API_ORIGIN_NOT_ALLOWED/,
  );
});

test("native fetch port refuses successful non-JSON responses before parsing", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response("<html>not an API response</html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  const port = createNativeJobApiFetchPort();
  await assert.rejects(
    port.fetch({
      sourceId: "greenhouse:test",
      provider: "GREENHOUSE",
      url: "https://boards-api.greenhouse.io/v1/boards/example/jobs/123",
      maxResponseBytes: 1_024,
    }),
    /JOB_API_RESPONSE_CONTENT_TYPE_INVALID/,
  );
});
