import assert from "node:assert/strict";
import test from "node:test";
import {
  getSingleAccountEntryPath,
  getSingleAccountNextPath,
  readSingleAccountConfig,
  singleAccountAcceptsUser,
} from "./single-account-policy.ts";
import {
  establishSingleAccountSession,
  type SingleAccountSessionPorts,
} from "./single-account-session.ts";
import { singleAccountAccessKeyMatches } from "./single-account-access.ts";

const fixedId = "3f5d6b83-a68d-4cd2-838d-281ff06d6709";
const otherId = "7733c6cd-6c46-4cbb-86d3-ad3bc9db7b34";
const fixedEmail = "fixed-test@local.invalid";
const enabled = { ROLEDAWN_SINGLE_ACCOUNT_MODE: "true", ROLEDAWN_TEST_ACCOUNT_ID: fixedId };
const user = { id: fixedId, email: fixedEmail };
const tokenHash = "synthetic-hashed-token";

type Calls = Array<Readonly<{ operation: string; value?: string }>>;
function fixture(overrides: Partial<SingleAccountSessionPorts> = {}) {
  const calls: Calls = [];
  const ports: SingleAccountSessionPorts = {
    async getUser(id) { calls.push({ operation: "lookup", value: id }); return { data: { user }, error: null }; },
    async generateLink(email) { calls.push({ operation: "generate", value: email }); return { data: { user, properties: { hashed_token: tokenHash } }, error: null }; },
    async verify(hash) { calls.push({ operation: "verify", value: hash }); return { data: { user }, error: null }; },
    async clearLocalSession() { calls.push({ operation: "clear-local" }); },
    ...overrides,
  };
  return { calls, ports };
}

test("single-account mode is explicitly opt-in and disabled mode preserves ordinary sessions", () => {
  for (const mode of [undefined, "", "false", "TRUE", "1"]) {
    const environment = { ROLEDAWN_SINGLE_ACCOUNT_MODE: mode, ROLEDAWN_TEST_ACCOUNT_ID: "misconfigured-but-disabled" };
    assert.equal(readSingleAccountConfig(environment), null);
    assert.equal(singleAccountAcceptsUser(otherId, environment), true);
  }
});

test("enabled mode requires a configured UUID and accepts only its normalized identity", () => {
  for (const id of [undefined, "", " ", "someone@example.com", "../../../other", `${fixedId},${otherId}`]) {
    const environment = { ROLEDAWN_SINGLE_ACCOUNT_MODE: "true", ROLEDAWN_TEST_ACCOUNT_ID: id };
    assert.throws(() => readSingleAccountConfig(environment), /SINGLE_ACCOUNT_ID_REQUIRED/u);
    assert.throws(() => singleAccountAcceptsUser(fixedId, environment), /SINGLE_ACCOUNT_ID_REQUIRED/u);
  }
  const config = readSingleAccountConfig({ ...enabled, ROLEDAWN_TEST_ACCOUNT_ID: ` ${fixedId.toUpperCase()} ` });
  assert.deepEqual(config, { userId: fixedId });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(singleAccountAcceptsUser(fixedId, enabled), true);
  assert.equal(singleAccountAcceptsUser(otherId, enabled), false);
  assert.equal(singleAccountAcceptsUser("", enabled), false);
});

test("single-account destinations preserve application links and exclude authentication loops", () => {
  for (const path of ["/dashboard", "/vault/answers", "/applications/123?view=review#files", "/search?q=teacher", "/saved", "/onboarding?step=goals"]) {
    assert.equal(getSingleAccountNextPath(path), path);
    const entry = new URL(getSingleAccountEntryPath(path), "https://roledawn.invalid");
    assert.equal(entry.pathname, "/auth/test-session");
    assert.equal(entry.searchParams.get("next"), path);
  }
  for (const path of [undefined, null, 42, "", "/", "/login", "/login?next=/dashboard", "/auth/confirm?code=external", "/auth/error", "/auth/test-session?next=/auth/test-session", "/api/opportunities", "/dashboard-other", "/dashboard/../auth/test-session", "/vault/%2e%2e/login", "https://attacker.example/dashboard", "//attacker.example", "/\\attacker.example", "/dashboard\nLocation: https://attacker.example"]) {
    assert.equal(getSingleAccountNextPath(path), "/dashboard", String(path));
    assert.equal(getSingleAccountEntryPath(path), "/auth/test-session?next=%2Fdashboard", String(path));
  }
});

test("an absent, mismatched or non-test account never reaches link generation", async () => {
  const lookups = [
    { data: { user: null }, error: null },
    { data: { user }, error: { message: "provider error" } },
    { data: { user: { ...user, id: otherId } }, error: null },
    { data: { user: { id: fixedId } }, error: null },
    { data: { user: { ...user, email: "real@example.com" } }, error: null },
    { data: { user: { ...user, email: "test@local.invalid.attacker.example" } }, error: null },
    { data: { user: { ...user, email: "test@other.invalid" } }, error: null },
  ];
  for (const lookup of lookups) {
    const { calls, ports } = fixture({ getUser: async (id) => { assert.equal(id, fixedId); return lookup; } });
    await assert.rejects(establishSingleAccountSession(fixedId, ports), /SINGLE_ACCOUNT_EXISTING_TEST_USER_REQUIRED/u);
    assert.deepEqual(calls, []);
  }
});

test("generated links must belong to the fixed account and carry a token before verification", async () => {
  const results = [
    { data: { user: null, properties: { hashed_token: tokenHash } }, error: null },
    { data: { user: { ...user, id: otherId }, properties: { hashed_token: tokenHash } }, error: null },
    { data: { user, properties: null }, error: null },
    { data: { user, properties: { hashed_token: "" } }, error: null },
    { data: { user, properties: { hashed_token: tokenHash } }, error: { message: "provider error" } },
  ];
  for (const result of results) {
    const { calls, ports } = fixture({ generateLink: async (email) => { assert.equal(email, fixedEmail); return result; } });
    await assert.rejects(establishSingleAccountSession(fixedId, ports), /SINGLE_ACCOUNT_LINK_FAILED/u);
    assert.deepEqual(calls, [{ operation: "lookup", value: fixedId }]);
  }
});

test("failed or mismatched verified identities clear the local session and never fall back", async () => {
  for (const result of [
    { data: { user: null }, error: null },
    { data: { user: { ...user, id: otherId } }, error: null },
    { data: { user }, error: { message: "verification failed" } },
  ]) {
    const { calls, ports } = fixture({ verify: async (hash) => { assert.equal(hash, tokenHash); return result; } });
    await assert.rejects(establishSingleAccountSession(fixedId, ports), /SINGLE_ACCOUNT_SESSION_FAILED/u);
    assert.deepEqual(calls, [
      { operation: "lookup", value: fixedId },
      { operation: "generate", value: fixedEmail },
      { operation: "clear-local" },
    ]);
  }
});

test("local-clear failure still rejects authentication without retrying verification", async () => {
  let verifications = 0;
  let clears = 0;
  const { ports } = fixture({
    verify: async () => { verifications++; return { data: { user: { ...user, id: otherId } }, error: null }; },
    clearLocalSession: async () => { clears++; throw new Error("synthetic cleanup failure"); },
  });
  await assert.rejects(establishSingleAccountSession(fixedId, ports));
  assert.equal(verifications, 1);
  assert.equal(clears, 1);
});

test("a verification transport exception clears any partially written local session", async () => {
  const { calls, ports } = fixture({ verify: async () => { throw new Error("synthetic verification failure"); } });
  await assert.rejects(establishSingleAccountSession(fixedId, ports), /SINGLE_ACCOUNT_SESSION_FAILED/u);
  assert.deepEqual(calls, [
    { operation: "lookup", value: fixedId },
    { operation: "generate", value: fixedEmail },
    { operation: "clear-local" },
  ]);
});

test("success uses the existing account email and verifies the exact generated token once", async () => {
  const { calls, ports } = fixture();
  await establishSingleAccountSession(fixedId, ports);
  assert.deepEqual(calls, [
    { operation: "lookup", value: fixedId },
    { operation: "generate", value: fixedEmail },
    { operation: "verify", value: tokenHash },
  ]);
});

test("lookup and link transport failures cannot advance to session verification", async () => {
  for (const stage of ["getUser", "generateLink"] as const) {
    const { calls, ports } = fixture({ [stage]: async () => { throw new Error("synthetic transport failure"); } });
    await assert.rejects(establishSingleAccountSession(fixedId, ports));
    assert.equal(calls.some(call => call.operation === "verify"), false);
    assert.equal(calls.some(call => call.operation === "clear-local"), false);
  }
});

test("a new shared session needs the private access key; an unset or short key opens nothing", () => {
  const key = "k".repeat(24) + "-private-access-key-0123456789";
  const environment = { ROLEDAWN_TEST_ACCESS_KEY: ` ${key} ` };
  assert.equal(singleAccountAccessKeyMatches(key, environment), true);
  for (const provided of [null, undefined, "", key.slice(0, -1), `${key}x`, key.toUpperCase(), ["k"], "x".repeat(300)]) {
    assert.equal(singleAccountAccessKeyMatches(provided, environment), false);
  }
  for (const configured of [undefined, "", "short-key"]) {
    assert.equal(singleAccountAccessKeyMatches(configured ?? "", { ROLEDAWN_TEST_ACCESS_KEY: configured }), false);
  }
});
