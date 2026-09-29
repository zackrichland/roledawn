import assert from "node:assert/strict";
import test from "node:test";

import {
  HIREWIRE_PROJECT_REF,
  PROFILE_ACCEPTANCE_ACKNOWLEDGEMENT,
  PROFILE_CLEANUP_ACKNOWLEDGEMENT,
  assertProfileAcceptanceEmail,
  createCandidateProfileCleanupRecord,
  createProfileAcceptancePassword,
  profileAcceptanceEmail,
  profileWorkspaceName,
  requireCandidateProfileAcceptanceConfig,
  requireCandidateProfileCleanupAcknowledgement,
  safeProfileErrorCode,
  validateCandidateProfileCleanupRecord,
} from "./candidate-profile-acceptance-lib.ts";
import { AcceptanceFailure } from "./milestone-zero-acceptance-lib.ts";

const validEnvironment = {
  RUN_HOSTED_CANDIDATE_PROFILE_ACCEPTANCE:
    PROFILE_ACCEPTANCE_ACKNOWLEDGEMENT,
  NEXT_PUBLIC_SUPABASE_URL: `https://${HIREWIRE_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  SUPABASE_SECRET_KEY: "server-secret",
  ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF: HIREWIRE_PROJECT_REF,
  ACCEPTANCE_RUN_ID: "Profile Run 2026/08/12",
} as unknown as NodeJS.ProcessEnv;

const alphaIdentity = Object.freeze({
  label: "alpha" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  candidateId: "20000000-0000-4000-8000-000000000001",
  email:
    "roledawn-profile-acceptance-profile-run-2026-08-12-alpha@acceptance.invalid",
  workspaceName: "RoleDawn Profile profile-run-2026-08-12 alpha workspace",
});

test("profile acceptance is inert without the exact mutation acknowledgement", () => {
  assert.throws(
    () =>
      requireCandidateProfileAcceptanceConfig({
        ...validEnvironment,
        RUN_HOSTED_CANDIDATE_PROFILE_ACCEPTANCE: undefined,
      }),
    /REFUSING_TO_RUN/,
  );
});

test("profile acceptance is pinned to the one hosted HireWire project", () => {
  assert.throws(
    () =>
      requireCandidateProfileAcceptanceConfig({
        ...validEnvironment,
        ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      }),
    /HIREWIRE_PROJECT_REF_REQUIRED/,
  );
  assert.throws(
    () =>
      requireCandidateProfileAcceptanceConfig({
        ...validEnvironment,
        NEXT_PUBLIC_SUPABASE_URL:
          "https://abcdefghijklmnopqrst.supabase.co",
      }),
    /SUPABASE_PROJECT_MISMATCH/,
  );
  assert.throws(
    () =>
      requireCandidateProfileAcceptanceConfig({
        ...validEnvironment,
        SUPABASE_SECRET_KEY: "your-server-only-supabase-secret-key",
      }),
    /SUPABASE_SECRET_KEY_IS_PLACEHOLDER/,
  );
});

test("profile identities are unmistakably synthetic and cleanup-safe", () => {
  const config = requireCandidateProfileAcceptanceConfig(validEnvironment);
  assert.equal(config.runId, "profile-run-2026-08-12");
  assert.equal(profileAcceptanceEmail(config.runId, "alpha"), alphaIdentity.email);
  assert.equal(
    `${profileWorkspaceName(config.runId, "alpha")} workspace`,
    alphaIdentity.workspaceName,
  );
  assert.doesNotThrow(() => assertProfileAcceptanceEmail(alphaIdentity.email));
  assert.throws(
    () => assertProfileAcceptanceEmail("candidate@example.com"),
    AcceptanceFailure,
  );
});

test("profile passwords remain high entropy and inside hosted Auth bounds", () => {
  const first = createProfileAcceptancePassword();
  const second = createProfileAcceptancePassword();
  assert.match(first, /^[0-9a-f-]{36}-Aa1!$/);
  assert.ok(first.length >= 40 && first.length <= 72);
  assert.notEqual(first, second);
});

test("cleanup requires its own permanent-delete acknowledgement", () => {
  assert.throws(
    () =>
      requireCandidateProfileCleanupAcknowledgement({
        ...validEnvironment,
        RUN_HOSTED_CANDIDATE_PROFILE_CLEANUP: undefined,
      }),
    /REFUSING_TO_CLEAN/,
  );
  assert.doesNotThrow(() =>
    requireCandidateProfileCleanupAcknowledgement({
      ...validEnvironment,
      RUN_HOSTED_CANDIDATE_PROFILE_CLEANUP:
        PROFILE_CLEANUP_ACKNOWLEDGEMENT,
    }),
  );
});

test("cleanup records bind exact synthetic identity and project metadata", () => {
  const config = requireCandidateProfileAcceptanceConfig(validEnvironment);
  const record = createCandidateProfileCleanupRecord(config, [alphaIdentity]);
  assert.deepEqual(validateCandidateProfileCleanupRecord(record), record);

  assert.throws(
    () =>
      validateCandidateProfileCleanupRecord({
        ...record,
        identities: [
          {
            ...alphaIdentity,
            email: "candidate@example.com",
          },
        ],
      }),
    /CLEANUP_RECORD_IDENTITY_INVALID/,
  );
  assert.throws(
    () =>
      validateCandidateProfileCleanupRecord({
        ...record,
        projectRef: "abcdefghijklmnopqrst",
      }),
    /CLEANUP_RECORD_INVALID/,
  );
});

test("cleanup records copy only the allowlisted cleanup identity fields", () => {
  const config = requireCandidateProfileAcceptanceConfig(validEnvironment);
  const identityWithRuntimeOnlyState = {
    ...alphaIdentity,
    client: { mustNotBePersisted: true },
  };
  const record = createCandidateProfileCleanupRecord(config, [
    identityWithRuntimeOnlyState,
  ]);

  assert.equal("client" in record.identities[0], false);
  assert.doesNotThrow(() => JSON.stringify(record));
});

test("profile error extraction preserves domain and SQLSTATE evidence", () => {
  assert.equal(
    safeProfileErrorCode({ message: "CANDIDATE_FACT_VERSION_MISMATCH" }),
    "CANDIDATE_FACT_VERSION_MISMATCH",
  );
  assert.equal(safeProfileErrorCode({ code: "PT409" }), "PT409");
  assert.equal(safeProfileErrorCode({ code: "40001" }), "40001");
});
