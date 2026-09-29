import assert from "node:assert/strict";
import test from "node:test";

import { resilientFetch } from "./resilient-fetch.ts";

function withFetch(responses: readonly (Response | Error | "hang")[], run: () => Promise<void>) {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (next === "hang") {
      // AbortSignal.timeout is unref'd; hold the loop open until it fires.
      const keepAlive = setTimeout(() => undefined, 5_000);
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        reject(new Error("aborted"));
      }));
    }
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; }).then(() => call);
}

test("retries a hung read once and returns the second response", async () => {
  const calls = await withFetch(["hang", new Response("ok", { status: 200 })], async () => {
    const response = await resilientFetch(20, 20)("https://example.supabase.co/rest/v1/jobs?select=id");
    assert.equal(response.status, 200);
  });
  assert.equal(calls, 2);
});

test("treats an edge 525 on an idempotent RPC as retryable", async () => {
  const calls = await withFetch([new Response("", { status: 525 }), new Response("[]", { status: 200 })], async () => {
    const response = await resilientFetch(1_000, 1_000)("https://example.supabase.co/rest/v1/rpc/search_catalog_jobs_ranked", { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
  });
  assert.equal(calls, 2);
});

test("never retries a write, even when it times out", async () => {
  const calls = await withFetch(["hang", new Response("ok", { status: 200 })], async () => {
    await assert.rejects(resilientFetch(20, 20)("https://example.supabase.co/rest/v1/rpc/request_application_send", { method: "POST", body: "{}" }));
  });
  assert.equal(calls, 1);
});
