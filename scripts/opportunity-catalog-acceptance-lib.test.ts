import assert from "node:assert/strict";
import test from "node:test";

import { AcceptanceFailure } from "./milestone-zero-acceptance-lib.ts";
import {
  OPPORTUNITY_CATALOG_ACCEPTANCE_ACKNOWLEDGEMENT,
  OPPORTUNITY_CATALOG_CLEANUP_ACKNOWLEDGEMENT,
  OPPORTUNITY_CATALOG_PROJECT_REF,
  assertOpportunityCatalogAcceptanceEmail,
  createOpportunityCatalogAcceptancePassword,
  createOpportunityCatalogCleanupRecord,
  opportunityCatalogAcceptanceEmail,
  opportunityCatalogWorkspaceName,
  requireOpportunityCatalogAcceptanceConfig,
  requireOpportunityCatalogCleanupAcknowledgement,
  safeOpportunityCatalogErrorCode,
  validateOpportunityCatalogCleanupRecord,
} from "./opportunity-catalog-acceptance-lib.ts";

const validEnvironment = {
  RUN_HOSTED_OPPORTUNITY_CATALOG_ACCEPTANCE:
    OPPORTUNITY_CATALOG_ACCEPTANCE_ACKNOWLEDGEMENT,
  NEXT_PUBLIC_SUPABASE_URL: `https://${OPPORTUNITY_CATALOG_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  SUPABASE_SECRET_KEY: "server-secret",
  ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF: OPPORTUNITY_CATALOG_PROJECT_REF,
  ACCEPTANCE_CATALOG_SOURCE_TENANT: "Anthropic",
  ACCEPTANCE_RUN_ID: "Opportunity Run 2026/08/16",
} as unknown as NodeJS.ProcessEnv;

const alphaIdentity = Object.freeze({
  label: "alpha" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  candidateId: "20000000-0000-4000-8000-000000000001",
  email:
    "roledawn-opportunity-acceptance-opportunity-run-2026-08-16-alpha@acceptance.invalid",
  workspaceName:
    "RoleDawn Opportunity opportunity-run-2026-08-16 alpha workspace",
});

test("opportunity acceptance is inert without the exact mutation acknowledgement", () => {
  assert.throws(
    () =>
      requireOpportunityCatalogAcceptanceConfig({
        ...validEnvironment,
        RUN_HOSTED_OPPORTUNITY_CATALOG_ACCEPTANCE: undefined,
      }),
    /REFUSING_TO_RUN/,
  );
});

test("opportunity acceptance is pinned to hosted HireWire", () => {
  assert.throws(
    () =>
      requireOpportunityCatalogAcceptanceConfig({
        ...validEnvironment,
        ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      }),
    /HIREWIRE_PROJECT_REF_REQUIRED/,
  );
  assert.throws(
    () =>
      requireOpportunityCatalogAcceptanceConfig({
        ...validEnvironment,
        NEXT_PUBLIC_SUPABASE_URL:
          "https://abcdefghijklmnopqrst.supabase.co",
      }),
    /SUPABASE_PROJECT_MISMATCH/,
  );
  assert.throws(
    () =>
      requireOpportunityCatalogAcceptanceConfig({
        ...validEnvironment,
        SUPABASE_SECRET_KEY: "your-server-only-supabase-secret-key",
      }),
    /SUPABASE_SECRET_KEY_IS_PLACEHOLDER/,
  );
});

test("source tenant is normalized and constrained", () => {
  const config = requireOpportunityCatalogAcceptanceConfig(validEnvironment);
  assert.equal(config.sourceTenant, "anthropic");
  assert.throws(
    () =>
      requireOpportunityCatalogAcceptanceConfig({
        ...validEnvironment,
        ACCEPTANCE_CATALOG_SOURCE_TENANT: "../../not-a-source",
      }),
    /CATALOG_SOURCE_TENANT_INVALID/,
  );
});

test("opportunity identities are unmistakably synthetic and cleanup-safe", () => {
  const config = requireOpportunityCatalogAcceptanceConfig(validEnvironment);
  assert.equal(config.runId, "opportunity-run-2026-08-16");
  assert.equal(
    opportunityCatalogAcceptanceEmail(config.runId, "alpha"),
    alphaIdentity.email,
  );
  assert.equal(
    `${opportunityCatalogWorkspaceName(config.runId, "alpha")} workspace`,
    alphaIdentity.workspaceName,
  );
  assert.doesNotThrow(() =>
    assertOpportunityCatalogAcceptanceEmail(alphaIdentity.email),
  );
  assert.throws(
    () => assertOpportunityCatalogAcceptanceEmail("candidate@example.com"),
    AcceptanceFailure,
  );
});

test("opportunity acceptance passwords stay inside hosted Auth bounds", () => {
  const first = createOpportunityCatalogAcceptancePassword();
  const second = createOpportunityCatalogAcceptancePassword();
  assert.match(first, /^[0-9a-f-]{36}-Aa1!$/);
  assert.ok(first.length >= 40 && first.length <= 72);
  assert.notEqual(first, second);
});

test("recovery cleanup requires a separate permanent-delete acknowledgement", () => {
  assert.throws(
    () =>
      requireOpportunityCatalogCleanupAcknowledgement({
        ...validEnvironment,
        RUN_HOSTED_OPPORTUNITY_CATALOG_CLEANUP: undefined,
      }),
    /REFUSING_TO_CLEAN/,
  );
  assert.doesNotThrow(() =>
    requireOpportunityCatalogCleanupAcknowledgement({
      ...validEnvironment,
      RUN_HOSTED_OPPORTUNITY_CATALOG_CLEANUP:
        OPPORTUNITY_CATALOG_CLEANUP_ACKNOWLEDGEMENT,
    }),
  );
});

test("cleanup records bind exact synthetic identity and project metadata", () => {
  const config = requireOpportunityCatalogAcceptanceConfig(validEnvironment);
  const record = createOpportunityCatalogCleanupRecord(config, [alphaIdentity]);
  assert.deepEqual(validateOpportunityCatalogCleanupRecord(record), record);

  assert.throws(
    () =>
      validateOpportunityCatalogCleanupRecord({
        ...record,
        identities: [{ ...alphaIdentity, email: "candidate@example.com" }],
      }),
    /CLEANUP_RECORD_IDENTITY_INVALID/,
  );
  assert.throws(
    () =>
      validateOpportunityCatalogCleanupRecord({
        ...record,
        projectRef: "abcdefghijklmnopqrst",
      }),
    /CLEANUP_RECORD_INVALID/,
  );
});

test("cleanup records exclude runtime-only state", () => {
  const config = requireOpportunityCatalogAcceptanceConfig(validEnvironment);
  const identityWithRuntimeOnlyState = {
    ...alphaIdentity,
    client: { mustNotBePersisted: true },
  };
  const record = createOpportunityCatalogCleanupRecord(config, [
    identityWithRuntimeOnlyState,
  ]);

  assert.equal("client" in record.identities[0], false);
  assert.doesNotThrow(() => JSON.stringify(record));
});

test("error extraction preserves catalog domain codes and SQLSTATE", () => {
  assert.equal(
    safeOpportunityCatalogErrorCode({ message: "CATALOG_JOB_NOT_AVAILABLE" }),
    "CATALOG_JOB_NOT_AVAILABLE",
  );
  assert.equal(safeOpportunityCatalogErrorCode({ code: "42501" }), "42501");
  assert.equal(
    safeOpportunityCatalogErrorCode({ message: "ACTIVE_CANDIDATE_NOT_FOUND" }),
    "ACTIVE_CANDIDATE_NOT_FOUND",
  );
});
