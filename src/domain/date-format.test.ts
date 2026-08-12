import assert from "node:assert/strict";
import test from "node:test";

import { formatUtcDateTime } from "./date-format.ts";

test("formats a valid timestamp with an explicit UTC label", () => {
  const rendered = formatUtcDateTime("2026-08-12T13:50:38.705Z");
  assert.match(rendered, /Aug 12, 2026/);
  assert.match(rendered, /UTC/);
});

test("fails closed for missing or invalid timestamps", () => {
  assert.equal(formatUtcDateTime(null), "Not recorded");
  assert.equal(formatUtcDateTime("not-a-date"), "Not recorded");
});
