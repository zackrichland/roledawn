import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLocalTestLogin } from "./local-test-login-policy.ts";

const environment = {
  nodeEnv: "development",
  enabled: "true",
  appBaseUrl: "http://127.0.0.1:3001",
  testUserEmail: "roledawn-test@local.invalid",
  secretKey: "server-only-test-secret",
  supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "publishable-test-key",
} as const;

const request = {
  origin: "http://127.0.0.1:3001",
  host: "127.0.0.1:3001",
  forwardedHost: null,
  forwardedProto: null,
} as const;

test("local test login is allowed only for an explicitly configured loopback development request", () => {
  assert.deepEqual(evaluateLocalTestLogin(environment, request), {
    allowed: true,
    email: "roledawn-test@local.invalid",
  });
});

test("production ignores the local test-login flag", () => {
  assert.deepEqual(
    evaluateLocalTestLogin({ ...environment, nodeEnv: "production" }, request),
    { allowed: false },
  );
});

test("a remote origin, host, or forwarded host fails closed", () => {
  assert.deepEqual(
    evaluateLocalTestLogin(environment, {
      ...request,
      origin: "https://example.com",
    }),
    { allowed: false },
  );
  assert.deepEqual(
    evaluateLocalTestLogin(environment, { ...request, host: "example.com" }),
    { allowed: false },
  );
  assert.deepEqual(
    evaluateLocalTestLogin(environment, {
      ...request,
      forwardedHost: "example.com",
    }),
    { allowed: false },
  );
  assert.deepEqual(
    evaluateLocalTestLogin(environment, {
      ...request,
      origin: "http://127.0.0.1:3001/forged-path",
    }),
    { allowed: false },
  );
  assert.deepEqual(
    evaluateLocalTestLogin(
      { ...environment, appBaseUrl: "http://127.0.0.1:3001/forged-path" },
      request,
    ),
    { allowed: false },
  );
});

test("missing credentials, an unapproved email domain, or a disabled flag fails closed", () => {
  assert.deepEqual(
    evaluateLocalTestLogin({ ...environment, secretKey: undefined }, request),
    { allowed: false },
  );
  assert.deepEqual(
    evaluateLocalTestLogin(
      { ...environment, testUserEmail: "candidate@example.com" },
      request,
    ),
    { allowed: false },
  );
  assert.deepEqual(
    evaluateLocalTestLogin({ ...environment, enabled: "false" }, request),
    { allowed: false },
  );
});
