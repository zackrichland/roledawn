import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseReviewedJobSourceRegistry, seedReviewedJobSources } from "./source-registry.ts";

const registry = JSON.parse(await readFile(new URL("../../../data/job-sources/reviewed-2026-09-16.json", import.meta.url), "utf8"));
test("reviewed registry contains verified complete boards from all three providers and broad sectors", () => {
  const result = parseReviewedJobSourceRegistry(registry);
  assert.equal(result.sources.length, 25);
  assert.deepEqual(new Set(result.sources.map(s => s.provider)), new Set(["GREENHOUSE","LEVER","ASHBY"]));
  for (const sector of ["K–12 education","Food service","Healthcare","Retail and apparel","Aerospace and manufacturing"]) assert.ok(result.sources.some(s => s.category === sector));
});
test("registry rejects duplicate boards, arbitrary destinations, missing source evidence and oversized feeds", () => {
  const first = registry.sources[0];
  for (const sources of [[first,first], [{ ...first, apiUrl: "https://internal.example/secret" }], [{ ...first, evidenceUrls: [] }], [{ ...first, observedBytes: 30_000_000 }]]) {
    assert.throws(() => parseReviewedJobSourceRegistry({ ...registry, sources }), /SOURCE_REGISTRY/u);
  }
});
test("seed uses one authenticated service command and validates replay counts without logging provider errors", async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (name: string, args: Record<string,unknown>) => { calls.push([name,args]); return { data: { created: 24, existing: 1, registry_release: registry.release }, error: null }; } };
  assert.deepEqual(await seedReviewedJobSources(client, registry), { created: 24, existing: 1, release: registry.release });
  assert.equal(calls.length, 1);
  await assert.rejects(seedReviewedJobSources({ rpc: async () => ({ data: null, error: "private payload" }) }, registry), /^Error: SOURCE_REGISTRY_SEED_FAILED$/u);
});
