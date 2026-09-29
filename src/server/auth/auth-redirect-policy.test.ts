import assert from "node:assert/strict";
import test from "node:test";

import { getAuthRedirectOrigin, getSafeAuthNextPath } from "./auth-redirect-policy.ts";

test("preserves an in-app deep link including query and fragment", () => {
  assert.equal(
    getSafeAuthNextPath("/applications/application-123?view=review#approval"),
    "/applications/application-123?view=review#approval",
  );
  assert.equal(getSafeAuthNextPath("/"), "/");
});

test("hosted auth retains the permanent origin behind a deploy proxy", () => {
  assert.equal(getAuthRedirectOrigin("https://deploy-id--roledawn.netlify.app/auth/confirm", { NODE_ENV: "production", APP_BASE_URL: "https://roledawn.netlify.app" }), "https://roledawn.netlify.app");
  assert.throws(() => getAuthRedirectOrigin("https://untrusted.example", { NODE_ENV: "production" }));
  assert.throws(() => getAuthRedirectOrigin("https://untrusted.example", { NODE_ENV: "production", APP_BASE_URL: "http://roledawn.netlify.app" }));
  assert.throws(() => getAuthRedirectOrigin("https://untrusted.example", { NODE_ENV: "production", APP_BASE_URL: "https://secret@roledawn.netlify.app" }));
  assert.equal(getAuthRedirectOrigin("http://localhost:3001/auth/confirm", { NODE_ENV: "development" }), "http://localhost:3001");
});

test("falls back for missing, external, scheme-relative, or malformed destinations", () => {
  for (const value of [
    null,
    undefined,
    "",
    "dashboard",
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "/safe\nSet-Cookie: forged=true",
    42,
  ]) {
    assert.equal(getSafeAuthNextPath(value), "/dashboard");
  }
});

test("rejects encoded scheme-relative and backslash destinations after query decoding", () => {
  const schemeRelative = new URLSearchParams("next=%2F%2Fattacker.example").get(
    "next",
  );
  const backslash = new URLSearchParams("next=%2F%5Cattacker.example").get(
    "next",
  );

  assert.equal(getSafeAuthNextPath(schemeRelative), "/dashboard");
  assert.equal(getSafeAuthNextPath(backslash), "/dashboard");
});
