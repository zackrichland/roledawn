import assert from "node:assert/strict";
import test from "node:test";

import { decodeCatalogCursor, encodeCatalogCursor } from "./catalog-cursor.ts";

const CURSOR = Object.freeze({
  jobId: "681215c7-0d80-4420-ba13-c4af20296c0d",
  observedAt: "2026-08-16T20:00:00.000Z",
});

test("round-trips an opaque catalog cursor", () => {
  const token = encodeCatalogCursor(CURSOR);
  assert.doesNotMatch(token, /681215c7/u);
  assert.deepEqual(decodeCatalogCursor(token), CURSOR);
});

test("rejects malformed, partial, and invalid catalog cursors", () => {
  assert.equal(decodeCatalogCursor(""), null);
  assert.equal(decodeCatalogCursor("not valid base64"), null);
  assert.equal(decodeCatalogCursor(Buffer.from(JSON.stringify({ o: CURSOR.observedAt })).toString("base64url")), null);
  assert.equal(decodeCatalogCursor(Buffer.from(JSON.stringify({ ...CURSOR, j: "FH208" })).toString("base64url")), null);
});
