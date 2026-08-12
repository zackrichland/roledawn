import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryComputerSessionBroker } from "../test-support/in-memory-computer-session-broker.ts";
import { isUrlAllowedByPolicy } from "./computer-session-broker.ts";
import type { InMemoryComputerSessionBrokerOptions } from "../test-support/in-memory-computer-session-broker.ts";
import type {
  AllowedDomainPolicy,
  ArtifactMountReference,
  ComputerSessionBinding,
} from "./computer-session-broker.ts";

const policy: AllowedDomainPolicy = {
  policyId: "destination-policy:v1",
  protocols: ["https:"],
  domains: [
    { hostname: "boards.greenhouse.io", includeSubdomains: false },
    { hostname: "example-ats.com", includeSubdomains: true },
  ],
};

const binding: ComputerSessionBinding = {
  candidateId: "candidate-1",
  applicationId: "application-1",
};

const artifact: ArtifactMountReference = {
  artifactRef: "artifact:application-1/resume-v2",
  artifactVersionId: "resume-v2",
  contentHash: `sha256:${"a".repeat(64)}`,
  filename: "sample-candidate-resume.pdf",
  mediaType: "application/pdf",
};

function sequential(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

function brokerOptions(now: () => number, supportsLiveView = true): InMemoryComputerSessionBrokerOptions {
  return {
    now,
    supportsLiveView,
    maximumTtlMs: 60_000,
    createSessionId: sequential("app-session"),
    createProviderId: sequential("private-provider"),
    createMountId: sequential("app-mount"),
    createLiveViewReference: sequential("app-live-view"),
  };
}

test("domain policy uses exact and dot-boundary subdomain matching", () => {
  assert.equal(isUrlAllowedByPolicy("https://boards.greenhouse.io/example/jobs/1", policy), true);
  assert.equal(isUrlAllowedByPolicy("https://tenant.example-ats.com/apply", policy), true);
  assert.equal(isUrlAllowedByPolicy("https://example-ats.com/apply", policy), true);
  assert.equal(isUrlAllowedByPolicy("https://evil-example-ats.com/apply", policy), false);
  assert.equal(isUrlAllowedByPolicy("https://foo.boards.greenhouse.io/apply", policy), false);
  assert.equal(isUrlAllowedByPolicy("http://boards.greenhouse.io/example/jobs/1", policy), false);
  assert.equal(isUrlAllowedByPolicy("https://user:password@boards.greenhouse.io/apply", policy), false);
  assert.equal(isUrlAllowedByPolicy("not a url", policy), false);
});

test("session creation binds one application, mounts references, and hides provider identifiers", async () => {
  let now = Date.parse("2026-08-11T18:00:00.000Z");
  const broker = new InMemoryComputerSessionBroker(brokerOptions(() => now));
  const created = await broker.createSession({
    binding,
    startUrl: "https://boards.greenhouse.io/example/jobs/1",
    allowedDomainPolicy: policy,
    ttlMs: 30_000,
    artifacts: [artifact],
    liveView: "PREFERRED",
  });

  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.state, "ACTIVE");
  assert.deepEqual(created.value.binding, binding);
  assert.equal(created.value.artifacts[0].artifactRef, artifact.artifactRef);
  assert.equal(created.value.artifacts[0].mountId, "app-mount-1");
  assert.equal(created.value.liveView?.reference, "app-live-view-1");

  const serialized = JSON.stringify(created.value);
  assert.equal(serialized.includes("private-provider"), false);
  assert.equal(serialized.includes("token"), false);
  assert.equal(serialized.includes("secret"), false);

  const wrongCandidate = await broker.getSession(created.value.sessionId, {
    ...binding,
    candidateId: "candidate-2",
  });
  assert.equal(wrongCandidate.ok, false);
  if (!wrongCandidate.ok) assert.equal(wrongCandidate.error.code, "SESSION_NOT_FOUND");

  now += 1;
  const correctCandidate = await broker.getSession(created.value.sessionId, binding);
  assert.equal(correctCandidate.ok, true);
});

test("start and subsequent navigation remain inside the immutable destination policy", async () => {
  const broker = new InMemoryComputerSessionBroker(brokerOptions(() => Date.parse("2026-08-11T18:00:00.000Z")));
  const rejected = await broker.createSession({
    binding,
    startUrl: "https://example.org/collect",
    allowedDomainPolicy: policy,
    ttlMs: 30_000,
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, "START_URL_NOT_ALLOWED");

  const created = await broker.createSession({
    binding,
    startUrl: "https://boards.greenhouse.io/example/jobs/1",
    allowedDomainPolicy: policy,
    ttlMs: 30_000,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const allowed = await broker.checkNavigation(
    created.value.sessionId,
    binding,
    "https://tenant.example-ats.com/step/2",
  );
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.value.policyId, policy.policyId);

  const denied = await broker.checkNavigation(created.value.sessionId, binding, "https://example.org/exfiltrate");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "NAVIGATION_NOT_ALLOWED");
});

test("live view is optional and a required unsupported view fails closed", async () => {
  const broker = new InMemoryComputerSessionBroker(
    brokerOptions(() => Date.parse("2026-08-11T18:00:00.000Z"), false),
  );
  const preferred = await broker.createSession({
    binding,
    startUrl: "https://boards.greenhouse.io/example/jobs/1",
    allowedDomainPolicy: policy,
    ttlMs: 30_000,
    liveView: "PREFERRED",
  });
  assert.equal(preferred.ok, true);
  if (preferred.ok) assert.equal(preferred.value.liveView, null);

  const required = await broker.createSession({
    binding: { ...binding, applicationId: "application-2" },
    startUrl: "https://boards.greenhouse.io/example/jobs/2",
    allowedDomainPolicy: policy,
    ttlMs: 30_000,
    liveView: "REQUIRED",
  });
  assert.equal(required.ok, false);
  if (!required.ok) assert.equal(required.error.code, "LIVE_VIEW_UNAVAILABLE");
});

test("artifact mounts reject URLs, incomplete hashes, and unsafe filenames", async () => {
  const broker = new InMemoryComputerSessionBroker(brokerOptions(() => Date.parse("2026-08-11T18:00:00.000Z")));
  for (const invalidArtifact of [
    { ...artifact, artifactRef: "https://signed.example/resume?token=secret" },
    { ...artifact, contentHash: "sha256:short" as `sha256:${string}` },
    { ...artifact, filename: "../resume.pdf" },
  ]) {
    const result = await broker.createSession({
      binding,
      startUrl: "https://boards.greenhouse.io/example/jobs/1",
      allowedDomainPolicy: policy,
      ttlMs: 30_000,
      artifacts: [invalidArtifact],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "ARTIFACT_REFERENCE_INVALID");
  }
});

test("close and destroy are idempotent, terminal, and scrub ephemeral references", async () => {
  let now = Date.parse("2026-08-11T18:00:00.000Z");
  const broker = new InMemoryComputerSessionBroker(brokerOptions(() => now));
  const created = await broker.createSession({
    binding,
    startUrl: "https://boards.greenhouse.io/example/jobs/1",
    allowedDomainPolicy: policy,
    ttlMs: 30_000,
    artifacts: [artifact],
    liveView: "REQUIRED",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  now += 1_000;
  const closed = await broker.closeSession(created.value.sessionId, binding);
  assert.equal(closed.ok, true);
  if (!closed.ok) return;
  assert.equal(closed.value.state, "CLOSED");
  assert.equal(closed.value.closedAt, "2026-08-11T18:00:01.000Z");
  assert.equal(closed.value.liveView, null);

  now += 1_000;
  const closeReplay = await broker.closeSession(created.value.sessionId, binding);
  assert.equal(closeReplay.ok, true);
  if (!closeReplay.ok) return;
  assert.equal(closeReplay.value.closedAt, closed.value.closedAt);

  const noNavigation = await broker.checkNavigation(
    created.value.sessionId,
    binding,
    "https://boards.greenhouse.io/example/jobs/1",
  );
  assert.equal(noNavigation.ok, false);
  if (!noNavigation.ok) assert.equal(noNavigation.error.code, "SESSION_NOT_ACTIVE");

  const destroyed = await broker.destroySession(created.value.sessionId, binding);
  assert.equal(destroyed.ok, true);
  if (!destroyed.ok) return;
  assert.equal(destroyed.value.state, "DESTROYED");
  assert.deepEqual(destroyed.value.artifacts, []);
  assert.equal(destroyed.value.liveView, null);

  now += 1_000;
  const destroyReplay = await broker.destroySession(created.value.sessionId, binding);
  assert.equal(destroyReplay.ok, true);
  if (!destroyReplay.ok) return;
  assert.equal(destroyReplay.value.destroyedAt, destroyed.value.destroyedAt);
});

test("active sessions expire and shed live-view and artifact references", async () => {
  let now = Date.parse("2026-08-11T18:00:00.000Z");
  const broker = new InMemoryComputerSessionBroker(brokerOptions(() => now));
  const created = await broker.createSession({
    binding,
    startUrl: "https://boards.greenhouse.io/example/jobs/1",
    allowedDomainPolicy: policy,
    ttlMs: 1_000,
    artifacts: [artifact],
    liveView: "PREFERRED",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  now += 1_000;
  const expired = await broker.getSession(created.value.sessionId, binding);
  assert.equal(expired.ok, true);
  if (!expired.ok) return;
  assert.equal(expired.value.state, "EXPIRED");
  assert.equal(expired.value.destroyedAt, expired.value.expiresAt);
  assert.deepEqual(expired.value.artifacts, []);
  assert.equal(expired.value.liveView, null);
});

test("the broker contract exposes lifecycle and policy checks, not submission authority", () => {
  const broker = new InMemoryComputerSessionBroker();
  const methods = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(broker)));
  assert.equal(methods.has("createSession"), true);
  assert.equal(methods.has("checkNavigation"), true);
  assert.equal(methods.has("closeSession"), true);
  assert.equal(methods.has("destroySession"), true);
  assert.equal(methods.has("submit"), false);
  assert.equal(methods.has("click"), false);
  assert.equal(methods.has("type"), false);
});
