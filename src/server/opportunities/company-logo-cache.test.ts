import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyLogoAsset, CompanyLogoFetchResult } from "./company-logo.ts";
import {
  ATTEMPT_COOLDOWN_MS, FOUND_REFRESH_MS, NONE_RETRY_MS, createCompanyLogoResolver, createDefaultCompanyLogoStore,
  createSupabaseCompanyLogoStore, decodeBytea, encodeBytea, warmCompanyLogoForUrl,
  type CompanyLogoDatabaseClient, type CompanyLogoReport, type CompanyLogoStore, type StoredCompanyLogo,
} from "./company-logo-cache.ts";

// RIFF....WEBP: enough of a header for the served-asset check; the bytes are never decoded here.
const webp = (marker: number): CompanyLogoAsset => ({
  bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, marker]), contentType: "image/webp",
});
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** In-memory stand-in for the table. Which outcomes may replace which is the database function's job, tested in SQL. */
function fakeStore(initial: StoredCompanyLogo | null = null) {
  const calls: { op: "read" | "record"; outcome?: CompanyLogoFetchResult["kind"] }[] = [];
  const state = { row: initial, readError: false, writeError: false };
  const store: CompanyLogoStore = {
    async read() {
      calls.push({ op: "read" });
      if (state.readError) throw new Error("EMPLOYER_LOGO_READ_FAILED");
      return state.row;
    },
    async record(_provider, _board, outcome) {
      calls.push({ op: "record", outcome: outcome.kind });
      if (state.writeError) throw new Error("EMPLOYER_LOGO_WRITE_FAILED");
    },
  };
  return { store, calls, state };
}

function harness(options: { row?: StoredCompanyLogo | null; result?: CompanyLogoFetchResult; store?: boolean } = {}) {
  const clock = { now: Date.UTC(2026, 8, 30, 12) };
  const fake = fakeStore(options.row ?? null);
  const loads: string[] = [];
  const reports: CompanyLogoReport[] = [];
  const deferred: (() => Promise<unknown>)[] = [];
  let result: CompanyLogoFetchResult = options.result ?? { kind: "found", asset: webp(1) };
  const resolver = createCompanyLogoResolver({
    store: options.store === false ? null : fake.store,
    now: () => clock.now,
    load: async (provider, board) => { loads.push(`${provider}/${board}`); return result; },
    report: (event) => reports.push(event),
  });
  return {
    resolver, clock, fake, loads, reports, deferred,
    defer: (task: () => Promise<unknown>) => { deferred.push(task); },
    setResult: (next: CompanyLogoFetchResult) => { result = next; },
    ago: (ms: number) => clock.now - ms,
  };
}

const found = (checkedAgo: number, attemptedAgo: number, ago: (ms: number) => number): StoredCompanyLogo =>
  ({ status: "FOUND", asset: webp(9), checkedAt: ago(checkedAgo), attemptedAt: ago(attemptedAgo) });

test("a stored logo is served without touching the board, whatever the upstream is doing", async () => {
  const h = harness();
  h.fake.state.row = found(2 * DAY, 2 * DAY, h.ago);
  h.setResult({ kind: "error", reason: "BOARD_HTTP_503" });
  const resolution = await h.resolver.resolve("ashby", "example", { defer: h.defer });
  assert.equal(resolution.kind, "asset");
  assert.deepEqual(h.loads, []);
  assert.equal(h.deferred.length, 0);
  assert.deepEqual(h.fake.calls, [{ op: "read" }]);
});

test("a week-old logo is served immediately and revalidated after the response", async () => {
  const h = harness();
  h.fake.state.row = found(FOUND_REFRESH_MS + HOUR, FOUND_REFRESH_MS + HOUR, h.ago);
  h.setResult({ kind: "found", asset: webp(2) });
  const resolution = await h.resolver.resolve("greenhouse", "Example", { defer: h.defer });
  assert.deepEqual(resolution, { kind: "asset", asset: webp(9) }, "the stored bytes are served, not the refreshed ones");
  assert.deepEqual(h.loads, [], "no upstream read has run yet");
  assert.equal(h.deferred.length, 1);
  await h.deferred[0]();
  assert.deepEqual(h.loads, ["greenhouse/example"]);
  assert.deepEqual(h.fake.calls.at(-1), { op: "record", outcome: "found" });
});

test("a transient failure while revalidating leaves the stored logo alone and only records an attempt", async () => {
  const h = harness({ result: { kind: "error", reason: "LOGO_HTTP_429" } });
  h.fake.state.row = found(30 * DAY, 30 * DAY, h.ago);
  const resolution = await h.resolver.resolve("ashby", "example", { defer: h.defer });
  assert.equal(resolution.kind, "asset");
  await h.deferred[0]();
  // The row exists, so the attempt is recorded (throttling) as an ERROR the database will not treat as an answer.
  assert.deepEqual(h.fake.calls.filter((call) => call.op === "record"), [{ op: "record", outcome: "error" }]);
  assert.deepEqual(h.reports.map((report) => [report.event, report.reason]), [["live_error", "LOGO_HTTP_429"]]);
});

test("a recent attempt, of any outcome, holds back the next revalidation", async () => {
  const h = harness();
  h.fake.state.row = found(30 * DAY, ATTEMPT_COOLDOWN_MS - 1, h.ago);
  await h.resolver.resolve("ashby", "example", { defer: h.defer });
  assert.equal(h.deferred.length, 0);
  h.clock.now += 2;
  await h.resolver.resolve("ashby", "example", { defer: h.defer });
  assert.equal(h.deferred.length, 1);
});

test("without a defer hook, revalidation still runs, just not awaited", async () => {
  const h = harness();
  h.fake.state.row = found(30 * DAY, 30 * DAY, h.ago);
  await h.resolver.resolve("ashby", "example");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.loads, ["ashby/example"]);
});

test("'no logo' is remembered for hours, then looked at again", async () => {
  const h = harness();
  h.fake.state.row = { status: "NONE", checkedAt: h.ago(NONE_RETRY_MS - HOUR), attemptedAt: h.ago(NONE_RETRY_MS - HOUR) };
  assert.deepEqual(await h.resolver.resolve("lever", "example"), { kind: "none" });
  assert.deepEqual(h.loads, []);

  h.fake.state.row = { status: "NONE", checkedAt: h.ago(NONE_RETRY_MS + HOUR), attemptedAt: h.ago(NONE_RETRY_MS + HOUR) };
  // The employer has since added a logo.
  const resolution = await h.resolver.resolve("lever", "example");
  assert.deepEqual(resolution, { kind: "asset", asset: webp(1) });
  assert.deepEqual(h.loads, ["lever/example"]);
  assert.deepEqual(h.fake.calls.at(-1), { op: "record", outcome: "found" });
});

test("an expired 'no logo' that cannot be rechecked is still 'no logo', not an error", async () => {
  const h = harness({ result: { kind: "error", reason: "BOARD_TIMEOUT" } });
  h.fake.state.row = { status: "NONE", checkedAt: h.ago(NONE_RETRY_MS + HOUR), attemptedAt: h.ago(NONE_RETRY_MS + HOUR) };
  assert.deepEqual(await h.resolver.resolve("lever", "example"), { kind: "none" });
  assert.deepEqual(h.fake.calls.at(-1), { op: "record", outcome: "error" });
});

test("a first sight of a board reads it once, stores the answer and serves it", async () => {
  const h = harness();
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "asset", asset: webp(1) });
  assert.deepEqual(h.fake.calls, [{ op: "read" }, { op: "record", outcome: "found" }]);

  const none = harness({ result: { kind: "none", reason: "LOGO_NOT_LISTED" } });
  assert.deepEqual(await none.resolver.resolve("ashby", "example"), { kind: "none" });
  assert.deepEqual(none.fake.calls, [{ op: "read" }, { op: "record", outcome: "none" }]);
});

test("a transient failure on a board with no row is 'unavailable', is not stored, and is not retried in a tight loop", async () => {
  const h = harness({ result: { kind: "error", reason: "BOARD_NETWORK" } });
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "unavailable" });
  assert.deepEqual(h.fake.calls.filter((call) => call.op === "record"), [], "no row to touch, and no negative answer to remember");
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "unavailable" });
  assert.equal(h.loads.length, 1, "a second request inside the cooldown does not hit the upstream again");
  h.clock.now += 31_000;
  h.setResult({ kind: "found", asset: webp(3) });
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "asset", asset: webp(3) });
  assert.equal(h.loads.length, 2);
});

test("concurrent requests for one board share a single upstream read and a single write", async () => {
  const h = harness();
  const resolutions = await Promise.all(Array.from({ length: 8 }, () => h.resolver.resolve("ashby", "example")));
  assert.ok(resolutions.every((resolution) => resolution.kind === "asset"));
  assert.equal(h.loads.length, 1);
  assert.equal(h.fake.calls.filter((call) => call.op === "record").length, 1);
});

test("when the table is missing or unreachable, every request falls back to a live read (deploy before migrate is safe)", async () => {
  const h = harness();
  h.fake.state.readError = true;
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "asset", asset: webp(1) });
  assert.deepEqual(h.fake.calls, [{ op: "read" }], "nothing is written to a store that could not be read");
  assert.deepEqual(h.reports.map((report) => report.event), ["store_read_failed", "live_found"]);
  // The store is skipped for a minute, so a missing table costs one failed call, not one per image.
  await h.resolver.resolve("ashby", "other");
  assert.deepEqual(h.fake.calls, [{ op: "read" }]);
  assert.deepEqual(h.loads, ["ashby/example", "ashby/other"]);
  h.clock.now += 61_000;
  h.fake.state.readError = false;
  await h.resolver.resolve("ashby", "third");
  assert.deepEqual(h.fake.calls.map((call) => call.op), ["read", "read", "record"]);
});

test("a failed write never costs the response", async () => {
  const h = harness();
  h.fake.state.writeError = true;
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "asset", asset: webp(1) });
  assert.deepEqual(h.reports.map((report) => report.event), ["live_found", "store_write_failed"]);
});

test("no store configured behaves like the old live-only route", async () => {
  const h = harness({ store: false });
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "asset", asset: webp(1) });
  assert.deepEqual(h.fake.calls, []);
});

test("bad input never reaches the store or the network; board case is normalized", async () => {
  const h = harness();
  for (const [provider, board] of [["evil", "example"], ["ashby", "../private"], ["ashby", ""], ["ashby", "a..b"], ["ASHBY", "example"]]) {
    assert.deepEqual(await h.resolver.resolve(provider, board), { kind: "invalid" }, `${provider}/${board}`);
  }
  assert.deepEqual([h.loads, h.fake.calls], [[], []]);
  await h.resolver.resolve("ashby", "EXAMPLE");
  assert.deepEqual(h.loads, ["ashby/example"]);
});

test("a stored image that does not look like an image is never served", async () => {
  const h = harness();
  h.setResult({ kind: "found", asset: { bytes: new TextEncoder().encode("<html>"), contentType: "text/html" } });
  assert.deepEqual(await h.resolver.resolve("ashby", "example"), { kind: "none" });
  assert.deepEqual(h.fake.calls.at(-1), { op: "record", outcome: "none" });
});

test("warming a board fills the cache and waits for a stale row's refresh", async () => {
  const h = harness();
  assert.equal(await h.resolver.warm("ashby", "example"), "asset");
  assert.deepEqual(h.fake.calls.at(-1), { op: "record", outcome: "found" });
  h.fake.state.row = found(30 * DAY, 30 * DAY, h.ago);
  h.setResult({ kind: "found", asset: webp(4) });
  assert.equal(await h.resolver.warm("ashby", "example"), "asset");
  assert.equal(h.loads.length, 2, "the stale row was refreshed before warm returned");
  assert.equal(await h.resolver.warm("nope", "example"), "invalid");
});

test("warming from a posting URL ignores employer-domain URLs and never throws", async () => {
  await warmCompanyLogoForUrl("https://careers.example.com/jobs?gh_jid=123");
  await warmCompanyLogoForUrl(null);
});

test("bytea values round-trip through PostgREST's hex form and nothing else is accepted", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  assert.equal(encodeBytea(bytes), "\\x000102faff");
  assert.deepEqual(decodeBytea("\\x000102faff"), bytes);
  assert.deepEqual(decodeBytea(encodeBytea(new Uint8Array(webp(1).bytes.buffer, 4, 4))), new Uint8Array([0, 0, 0, 0]));
  for (const value of [null, undefined, 5, "", "\\x", "\\xabc", "000102", "\\xzz"]) assert.equal(decodeBytea(value), null, String(value));
});

function fakeClient(row: unknown, error: unknown = null) {
  const seen: { table?: string; filters: [string, string][]; rpc?: { fn: string; args: Record<string, unknown> } } = { filters: [] };
  const client: CompanyLogoDatabaseClient = {
    from(table) {
      seen.table = table;
      const chain = {
        select: () => ({ eq: (column: string, value: string) => { seen.filters.push([column, value]); return { eq: (c2: string, v2: string) => { seen.filters.push([c2, v2]); return { abortSignal: () => ({ maybeSingle: async () => ({ data: row, error }) }) }; } }; } }),
      };
      return chain;
    },
    rpc(fn, args) { seen.rpc = { fn, args }; return { abortSignal: async () => ({ data: null, error }) }; },
  };
  return { client, seen };
}

test("the Supabase store reads by provider and slug and validates what it gets back", async () => {
  const at = new Date(Date.UTC(2026, 8, 1)).toISOString();
  const good = { status: "FOUND", content_type: "image/webp", logo_bytes: encodeBytea(webp(7).bytes), checked_at: at, attempted_at: at };
  const { client, seen } = fakeClient(good);
  const row = await createSupabaseCompanyLogoStore(client).read("ashby", "example");
  assert.deepEqual(seen.filters, [["provider", "ashby"], ["board_slug", "example"]]);
  assert.equal(seen.table, "employer_logos");
  assert.ok(row?.status === "FOUND");
  assert.deepEqual(row.asset, webp(7));
  assert.equal(row.checkedAt, Date.parse(at));

  assert.equal(await createSupabaseCompanyLogoStore(fakeClient(null).client).read("ashby", "example"), null);
  assert.deepEqual(await createSupabaseCompanyLogoStore(fakeClient({ status: "NONE", content_type: null, logo_bytes: null, checked_at: at, attempted_at: at }).client).read("ashby", "example"),
    { status: "NONE", checkedAt: Date.parse(at), attemptedAt: Date.parse(at) });

  for (const bad of [
    { ...good, content_type: "text/html" }, { ...good, logo_bytes: "\\x3c68313e" }, { ...good, logo_bytes: null },
    { ...good, status: "MAYBE" }, { ...good, checked_at: "not a date" },
  ]) await assert.rejects(createSupabaseCompanyLogoStore(fakeClient(bad).client).read("ashby", "example"), /EMPLOYER_LOGO_ROW_INVALID/u);
  await assert.rejects(createSupabaseCompanyLogoStore(fakeClient(null, { code: "PGRST205" }).client).read("ashby", "example"), /EMPLOYER_LOGO_READ_FAILED/u);
});

test("the Supabase store records each outcome through the one database function", async () => {
  for (const [outcome, expected] of [
    [{ kind: "found", asset: webp(5) }, { p_outcome: "FOUND", p_content_type: "image/webp", p_logo_bytes: encodeBytea(webp(5).bytes) }],
    [{ kind: "none", reason: "LOGO_NOT_LISTED" }, { p_outcome: "NONE", p_content_type: null, p_logo_bytes: null }],
    [{ kind: "error", reason: "BOARD_NETWORK" }, { p_outcome: "ERROR", p_content_type: null, p_logo_bytes: null }],
  ] as const) {
    const { client, seen } = fakeClient(null);
    await createSupabaseCompanyLogoStore(client).record("lever-eu", "example", outcome);
    assert.deepEqual(seen.rpc, { fn: "record_employer_logo_check", args: { p_provider: "lever-eu", p_board_slug: "example", ...expected } });
  }
  await assert.rejects(createSupabaseCompanyLogoStore(fakeClient(null, { code: "42883" }).client).record("ashby", "example", { kind: "none", reason: "X" }), /EMPLOYER_LOGO_WRITE_FAILED/u);
});

test("service-role access is required to use the store", () => {
  assert.equal(createDefaultCompanyLogoStore({}), null);
  assert.equal(createDefaultCompanyLogoStore({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }), null);
  assert.equal(createDefaultCompanyLogoStore({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret" }), null, "the publishable key is required too");
  assert.ok(createDefaultCompanyLogoStore({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable", SUPABASE_SECRET_KEY: "secret",
  }));
});

test("the store works through the real supabase-js client against a PostgREST-shaped endpoint", async () => {
  const { createServer } = await import("node:http");
  const { createSupabaseAdminClient } = await import("../../lib/supabase/admin.ts");
  const at = new Date(Date.UTC(2026, 8, 1)).toISOString();
  const seen: { method?: string; url?: string; body?: unknown; key?: string | string[] }[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      seen.push({ method: request.method, url: request.url, body: raw ? JSON.parse(raw) : undefined, key: request.headers.apikey });
      response.setHeader("content-type", "application/json");
      response.end(request.method === "GET"
        ? JSON.stringify([{ status: "FOUND", content_type: "image/webp", logo_bytes: encodeBytea(webp(6).bytes), checked_at: at, attempted_at: at }])
        : JSON.stringify("FOUND"));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const environment = { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable", SUPABASE_SECRET_KEY: "secret" } as unknown as NodeJS.ProcessEnv;
    const store = createSupabaseCompanyLogoStore(createSupabaseAdminClient("company-logos/test", environment) as unknown as CompanyLogoDatabaseClient);
    const row = await store.read("ashby", "example");
    assert.ok(row?.status === "FOUND");
    assert.deepEqual(row.asset, webp(6));
    await store.record("ashby", "example", { kind: "found", asset: webp(6) });
    const [read, write] = seen;
    assert.equal(read.method, "GET");
    assert.match(read.url ?? "", /^\/rest\/v1\/employer_logos\?select=status%2C(?:\+|%20)?content_type/u);
    assert.match(read.url ?? "", /provider=eq\.ashby/u);
    assert.match(read.url ?? "", /board_slug=eq\.example/u);
    assert.equal(read.key, "secret");
    assert.equal(write.method, "POST");
    assert.equal(write.url, "/rest/v1/rpc/record_employer_logo_check");
    assert.deepEqual(write.body, { p_provider: "ashby", p_board_slug: "example", p_outcome: "FOUND", p_content_type: "image/webp", p_logo_bytes: encodeBytea(webp(6).bytes) });
  } finally {
    server.close();
  }
});
