import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { PGlite } from "@electric-sql/pglite";

import {
  createCompanyLogoResolver, createSupabaseCompanyLogoStore, type CompanyLogoDatabaseClient,
} from "../src/server/opportunities/company-logo-cache.ts";
import type { CompanyLogoAsset, CompanyLogoFetchResult } from "../src/server/opportunities/company-logo.ts";

// The resolver and store run against the real migration in PGlite. PostgREST is emulated only where it matters
// here: a bytea column reads back as "\x<hex>", and a bytea RPC argument arrives as that same text.
let db: PGlite;
before(async () => {
  const harness = await import(new URL("./migration-harness.mjs", import.meta.url).href) as {
    createMigratedDatabase(): Promise<{ db: PGlite }>;
  };
  ({ db } = await harness.createMigratedDatabase());
});
after(async () => { await db?.close(); });

function pgliteClient(): CompanyLogoDatabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: (_c1: string, provider: string) => ({
          eq: (_c2: string, board: string) => ({
            abortSignal: () => ({
              maybeSingle: async () => {
                const result = await db.query(
                  `select status, content_type, '\\x' || encode(logo_bytes, 'hex') as logo_bytes,
                          to_json(checked_at) #>> '{}' as checked_at, to_json(attempted_at) #>> '{}' as attempted_at
                     from public.employer_logos where provider = $1 and board_slug = $2`, [provider, board]);
                return { data: result.rows[0] ?? null, error: null };
              },
            }),
          }),
        }),
      }),
    }),
    rpc: (_fn, args) => ({
      abortSignal: async () => {
        try {
          await db.query("select public.record_employer_logo_check($1, $2, $3, $4, $5::text::bytea)",
            [args.p_provider, args.p_board_slug, args.p_outcome, args.p_content_type, args.p_logo_bytes]);
          return { data: null, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
    }),
  };
}

const webp = (marker: number): CompanyLogoAsset => ({
  bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, marker]), contentType: "image/webp",
});

test("the resolver keeps a found logo through transient failures and definite misses, against the real table", async () => {
  let next: CompanyLogoFetchResult = { kind: "found", asset: webp(1) };
  let loads = 0;
  const clock = { now: Date.now() };
  const resolver = createCompanyLogoResolver({
    store: createSupabaseCompanyLogoStore(pgliteClient()), now: () => clock.now, report: () => undefined,
    load: async () => { loads += 1; return next; },
  });
  const rows = async () => (await db.query<{ status: string; miss_count: number; marker: string }>(
    "select status, miss_count, encode(logo_bytes, 'hex') as marker from public.employer_logos where provider = 'ashby' and board_slug = 'parity'")).rows;

  // First sight: read live, store, then serve from the table without another read.
  assert.deepEqual(await resolver.resolve("ashby", "parity"), { kind: "asset", asset: webp(1) });
  assert.equal(loads, 1);
  assert.deepEqual(await resolver.resolve("ashby", "parity"), { kind: "asset", asset: webp(1) });
  assert.equal(loads, 1);

  // A week on: stale but still served, with every revalidation outcome that is not a new logo leaving the bytes alone.
  const week = 7 * 86_400_000;
  for (const outcome of [{ kind: "error", reason: "BOARD_HTTP_503" }, { kind: "none", reason: "LOGO_NOT_LISTED" }, { kind: "none", reason: "LOGO_NOT_LISTED" }] as const) {
    clock.now += week + 3_600_000;
    next = outcome;
    assert.deepEqual(await resolver.warm("ashby", "parity"), "asset");
  }
  assert.deepEqual((await rows())[0].status, "FOUND");
  assert.deepEqual((await rows())[0].marker, "52494646000000005745425001");
  assert.equal((await rows())[0].miss_count, 2, "two definite misses are counted; the transient failure is not one");

  // A new logo replaces it and resets the count.
  clock.now += week + 3_600_000;
  next = { kind: "found", asset: webp(2) };
  await resolver.warm("ashby", "parity");
  assert.deepEqual(await rows(), [{ status: "FOUND", miss_count: 0, marker: "52494646000000005745425002" }]);
  assert.deepEqual(await resolver.resolve("ashby", "parity"), { kind: "asset", asset: webp(2) });
});

test("an unmigrated database (no table) reads as a store failure, so the route falls back to live reads", async () => {
  const missing: CompanyLogoDatabaseClient = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: async () => ({ data: null, error: { code: "PGRST205" } }) }) }) }) }) }),
    rpc: () => ({ abortSignal: async () => ({ data: null, error: { code: "PGRST202" } }) }),
  };
  const resolver = createCompanyLogoResolver({
    store: createSupabaseCompanyLogoStore(missing), report: () => undefined, load: async () => ({ kind: "found", asset: webp(3) }),
  });
  assert.deepEqual(await resolver.resolve("greenhouse", "no-table"), { kind: "asset", asset: webp(3) });
});
