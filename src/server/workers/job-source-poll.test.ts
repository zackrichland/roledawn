import assert from "node:assert/strict";
import test from "node:test";

import type {
  SourceFetchPort,
  SourceFetchRequest,
  SourceFetchResponse,
} from "../ingestion/contracts.ts";
import type { JobSourceClaim } from "../ingestion/source-snapshot.ts";
import {
  CATALOG_MAX_SOURCE_RESPONSE_BYTES,
  JobSourceCommitRejectedError,
  runJobSourcePollOnce,
  type JobSourcePollDatabasePort,
  type JobSourcePollFailureInput,
  type JobSourceSnapshotCommitInput,
} from "./job-source-poll.ts";

const observedAt = "2026-08-16T20:00:00.000Z";

const claim: JobSourceClaim = {
  sourceId: "10000000-0000-4000-a000-000000000001",
  ingestionRunId: "20000000-0000-4000-a000-000000000002",
  provider: "GREENHOUSE",
  tenantKey: "example",
  adapterRelease: "greenhouse/0.1",
  etag: 'W/"previous"',
  sourceOptions: { include_content: true },
};

const greenhouseJob = {
  id: 101,
  title: "Product Engineer",
  location: { name: "Remote" },
  absolute_url: "https://job-boards.greenhouse.io/example/jobs/101",
  content: "<p>Build reliable software.</p>",
};

class MemoryDatabase implements JobSourcePollDatabasePort {
  readonly commits: JobSourceSnapshotCommitInput[] = [];
  readonly failures: JobSourcePollFailureInput[] = [];
  private readonly claimedSource: JobSourceClaim | null;
  private readonly commitResult: boolean | Error;

  constructor(
    claim: JobSourceClaim | null,
    commitResult: boolean | Error = true,
  ) {
    this.claimedSource = claim;
    this.commitResult = commitResult;
  }

  async claimDueSource(): Promise<JobSourceClaim | null> {
    return this.claimedSource;
  }

  async commitSnapshot(input: JobSourceSnapshotCommitInput): Promise<boolean> {
    this.commits.push(input);
    if (this.commitResult instanceof Error) throw this.commitResult;
    return this.commitResult;
  }

  async failPoll(input: JobSourcePollFailureInput): Promise<boolean> {
    this.failures.push(input);
    return true;
  }
}

class FixtureFetch implements SourceFetchPort {
  readonly requests: SourceFetchRequest[] = [];
  private readonly response: SourceFetchResponse;

  constructor(response: SourceFetchResponse) {
    this.response = response;
  }

  async fetch(request: SourceFetchRequest): Promise<SourceFetchResponse> {
    this.requests.push(request);
    return this.response;
  }
}

test("one poll claims, conditionally fetches, serializes, and commits one complete source", async () => {
  const database = new MemoryDatabase(claim);
  const fetchPort = new FixtureFetch({
    status: 200,
    body: JSON.stringify({ jobs: [greenhouseJob] }),
    headers: { etag: 'W/"current"' },
    observedAt,
  });

  const result = await runJobSourcePollOnce(database, fetchPort, {
    workerId: "test-worker",
  });

  assert.deepEqual(result, {
    kind: "COMPLETED",
    claimed: 1,
    completed: 1,
    failed: 0,
    sourceId: claim.sourceId,
    ingestionRunId: claim.ingestionRunId,
    outcome: "LOADED",
    observedCount: 1,
  });
  assert.equal(fetchPort.requests.length, 1);
  assert.equal(fetchPort.requests[0].ifNoneMatch, 'W/"previous"');
  assert.equal(
    fetchPort.requests[0].url,
    "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
  );
  assert.equal(database.commits.length, 1);
  assert.equal(database.commits[0].snapshot?.jobs[0].title, "Product Engineer");
  assert.equal(database.commits[0].responseStatus, 200);
  assert.match(database.commits[0].rawSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(database.failures, []);
});

test("304 records source health without publishing or closing catalog jobs", async () => {
  const database = new MemoryDatabase(claim);
  const fetchPort = new FixtureFetch({
    status: 304,
    body: "",
    headers: { etag: 'W/"previous"' },
    observedAt,
  });

  const result = await runJobSourcePollOnce(database, fetchPort, {
    workerId: "test-worker",
  });

  assert.equal(result.kind, "COMPLETED");
  if (result.kind === "COMPLETED") {
    assert.equal(result.outcome, "NOT_MODIFIED");
    assert.equal(result.observedCount, 0);
  }
  assert.equal(database.commits[0].snapshot, null);
  assert.equal(database.commits[0].responseStatus, 304);
  assert.equal(database.commits[0].rawSha256, null);
  assert.deepEqual(database.failures, []);
});

test("incomplete normalization fails closed and cannot commit absence evidence", async () => {
  const database = new MemoryDatabase(claim);
  const fetchPort = new FixtureFetch({
    status: 200,
    body: JSON.stringify({
      jobs: [greenhouseJob, { id: 102, title: "Missing URL" }],
    }),
    headers: {},
    observedAt,
  });

  const result = await runJobSourcePollOnce(database, fetchPort, {
    workerId: "test-worker",
  });

  assert.equal(result.kind, "FAILED");
  if (result.kind === "FAILED") {
    assert.equal(result.errorCode, "JOB_SOURCE_SNAPSHOT_INCOMPLETE");
    assert.equal(result.retryable, false);
  }
  assert.deepEqual(database.commits, []);
  assert.equal(database.failures.length, 1);
  assert.equal(database.failures[0].responseStatus, 200);
});

test("retryable HTTP failures are recorded with no catalog commit", async () => {
  const database = new MemoryDatabase(claim);
  const fetchPort = new FixtureFetch({
    status: 503,
    body: "{}",
    headers: {},
    observedAt,
  });

  const result = await runJobSourcePollOnce(database, fetchPort, {
    workerId: "test-worker",
  });

  assert.equal(result.kind, "FAILED");
  if (result.kind === "FAILED") {
    assert.equal(result.errorCode, "JOB_SOURCE_HTTP_ERROR");
    assert.equal(result.retryable, true);
  }
  assert.deepEqual(database.commits, []);
  assert.equal(database.failures[0].responseStatus, 503);
});

test("a partial HTTP response cannot become authoritative absence evidence", async () => {
  const database = new MemoryDatabase(claim);
  const fetchPort = new FixtureFetch({
    status: 206,
    body: JSON.stringify({ jobs: [greenhouseJob] }),
    headers: {},
    observedAt,
  });

  const result = await runJobSourcePollOnce(database, fetchPort, {
    workerId: "test-worker",
  });
  assert.equal(result.kind, "FAILED");
  if (result.kind === "FAILED") {
    assert.equal(result.errorCode, "JOB_SOURCE_RESPONSE_NOT_AUTHORITATIVE");
    assert.equal(result.retryable, true);
  }
  assert.deepEqual(database.commits, []);
});

test("idle polls never fetch and uncertain commits are not relabeled as source failures", async () => {
  const idleDatabase = new MemoryDatabase(null);
  const idleFetch = new FixtureFetch({
    status: 500,
    body: "{}",
    headers: {},
    observedAt,
  });
  assert.deepEqual(
    await runJobSourcePollOnce(idleDatabase, idleFetch, { workerId: "test-worker" }),
    { kind: "IDLE", claimed: 0, completed: 0, failed: 0 },
  );
  assert.equal(idleFetch.requests.length, 0);

  const uncertainDatabase = new MemoryDatabase(
    claim,
    new Error("transport ended after commit"),
  );
  const successFetch = new FixtureFetch({
    status: 200,
    body: JSON.stringify({ jobs: [greenhouseJob] }),
    headers: {},
    observedAt,
  });
  await assert.rejects(
    runJobSourcePollOnce(uncertainDatabase, successFetch, { workerId: "test-worker" }),
    /transport ended after commit/,
  );
  assert.deepEqual(uncertainDatabase.failures, []);
});

test("invalid reviewed source options fail before network access", async () => {
  const database = new MemoryDatabase({
    ...claim,
    sourceOptions: { include_content: "yes" },
  });
  const fetchPort = new FixtureFetch({
    status: 200,
    body: JSON.stringify({ jobs: [greenhouseJob] }),
    headers: {},
    observedAt,
  });

  const result = await runJobSourcePollOnce(database, fetchPort, {
    workerId: "test-worker",
  });
  assert.equal(result.kind, "FAILED");
  if (result.kind === "FAILED") {
    assert.equal(result.errorCode, "JOB_SOURCE_CONFIGURATION_INVALID");
    assert.equal(result.retryable, false);
  }
  assert.equal(fetchPort.requests.length, 0);
  assert.deepEqual(database.commits, []);
});

test("a definite database rejection is recorded so the source backs off", async () => {
  const database = new MemoryDatabase(
    claim,
    new JobSourceCommitRejectedError("JOB_SOURCE_COMMIT_STATEMENT_TIMEOUT", true),
  );
  const fetchPort = new FixtureFetch({
    status: 200,
    body: JSON.stringify({ jobs: [greenhouseJob] }),
    headers: {},
    observedAt,
  });

  const result = await runJobSourcePollOnce(database, fetchPort, { workerId: "test-worker" });
  assert.equal(result.kind, "FAILED");
  if (result.kind === "FAILED") {
    assert.equal(result.errorCode, "JOB_SOURCE_COMMIT_STATEMENT_TIMEOUT");
    assert.equal(result.retryable, true);
  }
  assert.equal(database.commits.length, 1);
  assert.deepEqual(database.failures, [{
    workerId: "test-worker",
    sourceId: claim.sourceId,
    ingestionRunId: claim.ingestionRunId,
    errorCode: "JOB_SOURCE_COMMIT_STATEMENT_TIMEOUT",
    retryable: true,
    responseStatus: 200,
    endpoint: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
  }]);
});

test("a lost lease is never recorded over another worker's run", async () => {
  const database = new MemoryDatabase(claim, new Error("JOB_SOURCE_SNAPSHOT_COMMIT_LEASE_LOST"));
  const fetchPort = new FixtureFetch({
    status: 200,
    body: JSON.stringify({ jobs: [greenhouseJob] }),
    headers: {},
    observedAt,
  });
  await assert.rejects(
    runJobSourcePollOnce(database, fetchPort, { workerId: "test-worker" }),
    /JOB_SOURCE_SNAPSHOT_COMMIT_LEASE_LOST/,
  );
  assert.deepEqual(database.failures, []);
});

test("catalog polls use the catalog byte cap unless a caller narrows it", async () => {
  const response = { status: 200, body: JSON.stringify({ jobs: [greenhouseJob] }), headers: {}, observedAt };
  const catalogFetch = new FixtureFetch(response);
  await runJobSourcePollOnce(new MemoryDatabase(claim), catalogFetch, { workerId: "test-worker" });
  assert.equal(catalogFetch.requests[0].maxResponseBytes, CATALOG_MAX_SOURCE_RESPONSE_BYTES);
  assert.equal(CATALOG_MAX_SOURCE_RESPONSE_BYTES > 20 * 1024 * 1024, true);

  const narrowFetch = new FixtureFetch(response);
  const narrow = await runJobSourcePollOnce(new MemoryDatabase(claim), narrowFetch, {
    workerId: "test-worker",
    maxResponseBytes: 10,
  });
  assert.equal(narrowFetch.requests[0].maxResponseBytes, 10);
  assert.equal(narrow.kind === "FAILED" && narrow.errorCode, "JOB_SOURCE_BODY_TOO_LARGE");
});
