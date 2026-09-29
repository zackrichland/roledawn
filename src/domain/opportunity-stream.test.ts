import test from "node:test";
import assert from "node:assert/strict";
import type { OpportunityCatalogItem } from "./opportunity-catalog.ts";
import { mergeOpportunityPages, parseCatalogRefreshStats } from "./opportunity-stream.ts";

test("overlapping daily observations cannot duplicate cards across pages", () => {
  const item = (id: string, title: string) => ({ jobId: id, title }) as OpportunityCatalogItem;
  assert.deepEqual(mergeOpportunityPages([[item("a", "New title"), item("b", "B")], [item("a", "Old title"), item("c", "C")]]).map(row => row.title), ["New title", "B", "C"]);
});
test("bad freshness telemetry fails closed instead of showing invented counts", () => {
  assert.throws(() => parseCatalogRefreshStats({ open_job_count: "999" }));
  assert.throws(() => parseCatalogRefreshStats(null));
});
