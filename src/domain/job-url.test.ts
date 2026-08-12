import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublicJobUrl } from "./job-url.ts";

test("normalizes a public HTTPS posting and removes the fragment", () => {
  const result = normalizePublicJobUrl(
    " https://Jobs.Example.com/openings/123?source=career#apply ",
  );

  assert.deepEqual(result, {
    ok: true,
    value: "https://jobs.example.com/openings/123?source=career",
  });
});

test("rejects non-public, credentialed, and non-HTTPS URL shapes", () => {
  for (const value of [
    "http://jobs.example.com/role",
    "https://localhost/role",
    "https://jobs.internal.local/role",
    "https://127.0.0.1/role",
    "https://[::1]/role",
    "https://user:secret@jobs.example.com/role",
    "not a URL",
  ]) {
    const result = normalizePublicJobUrl(value);
    assert.equal(result.ok, false, value);
    if (!result.ok) assert.equal(result.error.code, "JOB_URL_INVALID");
  }
});
