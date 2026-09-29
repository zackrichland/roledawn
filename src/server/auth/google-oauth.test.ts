import assert from "node:assert/strict";
import test from "node:test";

import { hasEnabledGoogleProvider } from "./google-oauth-policy.ts";

test("recognizes Google only when the hosted provider is explicitly enabled", () => {
  assert.equal(hasEnabledGoogleProvider({ external: { google: true } }), true);

  for (const settings of [
    null,
    undefined,
    {},
    { external: null },
    { external: {} },
    { external: { google: false } },
    { external: { google: "true" } },
  ]) {
    assert.equal(hasEnabledGoogleProvider(settings), false);
  }
});
