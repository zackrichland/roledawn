import assert from "node:assert/strict";
import test from "node:test";

import {
  AcceptanceFailure,
  acceptanceEmail,
  assertAcceptanceEmail,
  createAcceptancePassword,
  createAcceptanceRunId,
  requireAcceptanceConfig,
  validateCleanupRecord,
} from "./milestone-zero-acceptance-lib.ts";

const validEnvironment = {
  RUN_HOSTED_MILESTONE_ZERO_ACCEPTANCE:
    "I_UNDERSTAND_THIS_CREATES_TEST_DATA",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  SUPABASE_SECRET_KEY: "server-secret",
  ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  ACCEPTANCE_RUN_ID: "Run 2026/08/12",
} as unknown as NodeJS.ProcessEnv;

test("acceptance configuration is inert without the exact mutation acknowledgement", () => {
  assert.throws(
    () => requireAcceptanceConfig({ ...validEnvironment, RUN_HOSTED_MILESTONE_ZERO_ACCEPTANCE: undefined }),
    /REFUSING_TO_RUN/,
  );
});

test("acceptance configuration pins the exact project host and rejects placeholders", () => {
  assert.throws(
    () => requireAcceptanceConfig({
      ...validEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: "https://wrongprojectref00000.supabase.co",
    }),
    /SUPABASE_PROJECT_MISMATCH/,
  );
  assert.throws(
    () => requireAcceptanceConfig({
      ...validEnvironment,
      SUPABASE_SECRET_KEY: "your-server-only-supabase-secret-key",
    }),
    /SUPABASE_SECRET_KEY_IS_PLACEHOLDER/,
  );
});

test("acceptance identities are obviously prefixed and use the reserved domain", () => {
  const runId = createAcceptanceRunId("Run 2026/08/12");
  assert.equal(runId, "run-2026-08-12");
  const email = acceptanceEmail(runId, "alpha");
  assert.equal(email, "roledawn-m0-run-2026-08-12-alpha@acceptance.invalid");
  assert.doesNotThrow(() => assertAcceptanceEmail(email));
  assert.throws(() => assertAcceptanceEmail("real-user@example.com"), AcceptanceFailure);
});

test("acceptance passwords are high entropy and within the hosted Auth bound", () => {
  const password = createAcceptancePassword();
  assert.match(password, /^[0-9a-f-]{36}-Aa1!$/);
  assert.ok(password.length >= 40 && password.length <= 72);
});

test("cleanup records reject unprefixed identities", () => {
  assert.throws(
    () => validateCleanupRecord({
      runId: "run",
      projectRef: "abcdefghijklmnopqrst",
      createdAt: "2026-08-12T00:00:00.000Z",
      userIds: ["00000000-0000-4000-8000-000000000000"],
      workspaceIds: ["10000000-0000-4000-8000-000000000000"],
      emails: ["founder@example.com"],
    }),
    /CLEANUP_REFUSED/,
  );
});

test("valid config canonicalizes the default official job URL", () => {
  const config = requireAcceptanceConfig(validEnvironment);
  assert.equal(config.expectedProjectRef, "abcdefghijklmnopqrst");
  assert.equal(config.runId, "run-2026-08-12");
  assert.equal(
    config.jobUrl,
    "https://job-boards.greenhouse.io/anthropic/jobs/5101378008",
  );
  assert.equal(config.runWorker, false);
  assert.equal(config.keepArtifacts, false);
});
