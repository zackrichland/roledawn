import assert from "node:assert/strict";
import test from "node:test";

import type { Database } from "../../lib/supabase/database.types.ts";
import type { NormalizedSourceJob } from "../ingestion/contracts.ts";
import { handleApplicationQueued } from "./application-queued.ts";

const intake = {
  id: "10000000-0000-4000-a000-000000000001",
  canonical_url: "https://jobs.lever.co/example/20000000-0000-4000-a000-000000000002",
  command_id: "30000000-0000-4000-a000-000000000003",
  workspace_id: "40000000-0000-4000-a000-000000000004",
  updated_at: "2026-08-12T04:00:00.000Z",
  status: "RESOLVING",
} as Database["public"]["Tables"]["job_intakes"]["Row"];

const applicationId = "50000000-0000-4000-a000-000000000005";

const normalizedJob: NormalizedSourceJob = {
  sourceId: "direct:lever:example",
  provider: "LEVER",
  tenantKey: "example",
  externalJobId: "20000000-0000-4000-a000-000000000002",
  externalJobIdBasis: "PROVIDER_ID",
  title: "Product Engineer",
  canonicalJobUrl: "https://jobs.lever.co/example/20000000-0000-4000-a000-000000000002",
  applyUrl: "https://jobs.lever.co/example/20000000-0000-4000-a000-000000000002/apply",
  descriptionText: "Build the product.",
  descriptionHtml: "<p>Build the product.</p>",
  locations: [{ label: "Remote", countryCode: null }],
  department: "Engineering",
  team: "Product",
  workplaceType: "REMOTE",
  employmentType: "FULL_TIME",
  requisitionId: null,
  language: null,
  sourcePostedAt: null,
  postedAtConfidence: "UNKNOWN",
  sourceUpdatedAt: null,
  listed: true,
  compensation: [],
  observedAt: "2026-08-12T04:00:00.000Z",
};

function chain(result: unknown) {
  const passthrough = (...args: unknown[]) => {
    void args;
    return value;
  };
  const value = {
    update: passthrough,
    upsert: passthrough,
    insert: passthrough,
    select: passthrough,
    eq: passthrough,
    in: passthrough,
    order: passthrough,
    limit: passthrough,
    single: async () => result,
    maybeSingle: async () => result,
  };
  return value;
}

test("unsupported direct links fail the intake safely without catalog writes", async () => {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      if (table === "applications") return chain({ data: { id: applicationId }, error: null });
      assert.equal(table, "job_intakes");
      return chain(results.shift() ?? { data: intake, error: null });
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(`rpc:${name}`);
      assert.equal(name, "fail_pasted_link_intake");
      assert.equal(args.p_failure_code, "ATS_UNSUPPORTED");
      return { data: null, error: null };
    },
  };

  const results = [
    { data: { ...intake, status: "PENDING" }, error: null },
    { data: intake, error: null },
  ];

  await handleApplicationQueued(
    client as never,
    { application_id: applicationId, job_intake_id: intake.id },
    { resolveJob: async () => ({ kind: "UNSUPPORTED", code: "ATS_UNSUPPORTED", message: "unsupported" }) },
  );
  assert.deepEqual(calls, ["from:applications", "from:job_intakes", "from:job_intakes", "rpc:fail_pasted_link_intake"]);
});

test("transient official API failures keep the intake retryable", async () => {
  const calls: string[] = [];
  const results = [
    { data: { ...intake, status: "PENDING" }, error: null },
    { data: intake, error: null },
  ];
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      if (table === "applications") return chain({ data: { id: applicationId }, error: null });
      assert.equal(table, "job_intakes");
      return chain(results.shift() ?? { data: intake, error: null });
    },
    async rpc(name: string) {
      calls.push(`rpc:${name}`);
      return { data: null, error: null };
    },
  };

  await assert.rejects(
    handleApplicationQueued(
      client as never,
      { application_id: applicationId, job_intake_id: intake.id },
      {
        resolveJob: async () => ({
          kind: "FAILED",
          code: "FETCH_FAILED",
          message: "temporary network error",
          retryable: true,
          status: null,
        }),
      },
    ),
    /JOB_RESOLUTION_RETRYABLE_FETCH_FAILED/,
  );
  assert.deepEqual(calls, ["from:applications", "from:job_intakes", "from:job_intakes"]);
});

test("terminal intake replays acknowledge without refetching or rewriting the catalog", async () => {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      if (table === "applications") return chain({ data: { id: applicationId }, error: null });
      assert.equal(table, "job_intakes");
      return chain({ data: { ...intake, status: "RESOLVED" }, error: null });
    },
    async rpc(name: string) {
      calls.push(`rpc:${name}`);
      assert.equal(name, "ack_terminal_pasted_link_intake");
      return { data: true, error: null };
    },
  };

  await handleApplicationQueued(
    client as never,
    { application_id: applicationId, job_intake_id: intake.id },
    { resolveJob: async () => { throw new Error("resolver must not run"); } },
  );
  assert.deepEqual(calls, ["from:applications", "from:job_intakes", "rpc:ack_terminal_pasted_link_intake"]);
});

test("resolved official jobs persist catalog rows then commit the intake", async () => {
  const calls: string[] = [];
  const results: Record<string, unknown[]> = {
    applications: [{ data: { id: applicationId }, error: null }],
    job_intakes: [
      { data: { ...intake, status: "PENDING" }, error: null },
      { data: intake, error: null },
    ],
    employers: [{ data: { id: "60000000-0000-4000-a000-000000000006" }, error: null }],
    job_sources: [{ data: { id: "70000000-0000-4000-a000-000000000007" }, error: null }],
    source_job_listings: [{ data: { id: "80000000-0000-4000-a000-000000000008" }, error: null }],
    jobs: [
      { data: { id: "90000000-0000-4000-a000-000000000009", current_version_id: null }, error: null },
      { data: null, error: null },
    ],
    job_versions: [
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "a0000000-0000-4000-a000-00000000000a" }, error: null },
    ],
  };
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      const result = results[table]?.shift();
      if (!result) throw new Error(`Unexpected table call: ${table}`);
      return chain(result);
    },
    async rpc(name: string) {
      calls.push(`rpc:${name}`);
      return { data: null, error: null };
    },
  };

  await handleApplicationQueued(
    client as never,
    { application_id: applicationId, job_intake_id: intake.id },
    {
      resolveJob: async () => ({
        kind: "RESOLVED",
        value: {
          reference: {
            provider: "LEVER",
            tenantKey: "example",
            externalJobId: normalizedJob.externalJobId,
            region: "GLOBAL",
            canonicalInputUrl: normalizedJob.canonicalJobUrl,
          },
          endpoint: "https://api.lever.co/v0/postings/example/20000000-0000-4000-a000-000000000002?mode=json",
          rawSha256: "b".repeat(64),
          rawBytes: 1_024,
          job: normalizedJob,
        },
      }),
    },
  );

  assert.equal(calls.at(-1), "rpc:resolve_pasted_link_intake");
  assert.equal(calls.includes("from:job_versions"), true);
});

test("an existing canonical job is reused only when it belongs to the same source listing", async () => {
  const calls: string[] = [];
  const listingId = "80000000-0000-4000-a000-000000000008";
  const results: Record<string, unknown[]> = {
    applications: [{ data: { id: applicationId }, error: null }],
    job_intakes: [
      { data: { ...intake, status: "PENDING" }, error: null },
      { data: intake, error: null },
    ],
    employers: [{ data: { id: "60000000-0000-4000-a000-000000000006" }, error: null }],
    job_sources: [{ data: { id: "70000000-0000-4000-a000-000000000007" }, error: null }],
    source_job_listings: [{ data: { id: listingId }, error: null }],
    jobs: [
      { data: null, error: { code: "23505" } },
      {
        data: {
          id: "90000000-0000-4000-a000-000000000009",
          current_version_id: null,
          source_listing_id: listingId,
        },
        error: null,
      },
      { data: null, error: null },
    ],
    job_versions: [
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "a0000000-0000-4000-a000-00000000000a" }, error: null },
    ],
  };
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      const result = results[table]?.shift();
      if (!result) throw new Error(`Unexpected table call: ${table}`);
      return chain(result);
    },
    async rpc(name: string) {
      calls.push(`rpc:${name}`);
      return { data: null, error: null };
    },
  };

  await handleApplicationQueued(
    client as never,
    { application_id: applicationId, job_intake_id: intake.id },
    {
      resolveJob: async () => ({
        kind: "RESOLVED",
        value: {
          reference: {
            provider: "LEVER",
            tenantKey: "example",
            externalJobId: normalizedJob.externalJobId,
            region: "GLOBAL",
            canonicalInputUrl: normalizedJob.canonicalJobUrl,
          },
          endpoint: "https://api.lever.co/v0/postings/example/20000000-0000-4000-a000-000000000002?mode=json",
          rawSha256: "b".repeat(64),
          rawBytes: 1_024,
          job: normalizedJob,
        },
      }),
    },
  );

  assert.equal(calls.filter((call) => call === "from:jobs").length, 3);
  assert.equal(calls.at(-1), "rpc:resolve_pasted_link_intake");
});

test("an unspecified provider work mode persists as the database UNKNOWN value", async () => {
  let insertedWorkMode: unknown;
  const results: Record<string, unknown[]> = {
    applications: [{ data: { id: applicationId }, error: null }],
    job_intakes: [
      { data: { ...intake, status: "PENDING" }, error: null },
      { data: intake, error: null },
    ],
    employers: [{ data: { id: "60000000-0000-4000-a000-000000000006" }, error: null }],
    job_sources: [{ data: { id: "70000000-0000-4000-a000-000000000007" }, error: null }],
    source_job_listings: [{ data: { id: "80000000-0000-4000-a000-000000000008" }, error: null }],
    jobs: [
      { data: { id: "90000000-0000-4000-a000-000000000009", current_version_id: null }, error: null },
      { data: null, error: null },
    ],
    job_versions: [
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "a0000000-0000-4000-a000-00000000000a" }, error: null },
    ],
  };
  const client = {
    from(table: string) {
      const result = results[table]?.shift();
      if (!result) throw new Error(`Unexpected table call: ${table}`);
      const value = chain(result);
      if (table === "job_versions") {
        const originalInsert = value.insert;
        value.insert = (payload: unknown) => {
          insertedWorkMode = (payload as { work_mode?: unknown }).work_mode;
          return originalInsert();
        };
      }
      return value;
    },
    async rpc() {
      return { data: null, error: null };
    },
  };

  await handleApplicationQueued(
    client as never,
    { application_id: applicationId, job_intake_id: intake.id },
    {
      resolveJob: async () => ({
        kind: "RESOLVED",
        value: {
          reference: {
            provider: "LEVER",
            tenantKey: "example",
            externalJobId: normalizedJob.externalJobId,
            region: "GLOBAL",
            canonicalInputUrl: normalizedJob.canonicalJobUrl,
          },
          endpoint: "https://api.lever.co/v0/postings/example/20000000-0000-4000-a000-000000000002?mode=json",
          rawSha256: "b".repeat(64),
          rawBytes: 1_024,
          job: { ...normalizedJob, workplaceType: "UNSPECIFIED" },
        },
      }),
    },
  );

  assert.equal(insertedWorkMode, "UNKNOWN");
});
