import assert from "node:assert/strict";
import test from "node:test";

import type { SourceFetchPort, SourceFetchRequest, SourceFetchResponse } from "./contracts.ts";
import { createNativeJobApiFetchPort } from "./fetch-port.ts";
import { loadRegisteredJobSource } from "./load-source.ts";

const source = { sourceId: "gh-1", provider: "GREENHOUSE", tenantKey: "example", includeContent: true } as const;

function throwingPort(error: unknown): SourceFetchPort {
  return {
    async fetch(): Promise<SourceFetchResponse> {
      throw error;
    },
  };
}

test("source loader separates deadlines and oversized streams from network failures", async () => {
  const timeout = await loadRegisteredJobSource(source, throwingPort(new Error("JOB_API_TIMEOUT")));
  assert.equal(timeout.kind, "FAILED");
  if (timeout.kind === "FAILED") {
    assert.equal(timeout.code, "FETCH_TIMEOUT");
    assert.equal(timeout.retryable, true);
  }

  // Ports that surface the platform's TimeoutError are classified the same way.
  const platformTimeout = await loadRegisteredJobSource(
    source,
    throwingPort(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
  );
  assert.equal(platformTimeout.kind === "FAILED" && platformTimeout.code, "FETCH_TIMEOUT");

  // A streamed body over the cap is a property of the board, not a blip.
  const tooLarge = await loadRegisteredJobSource(
    source,
    throwingPort(new Error("JOB_API_RESPONSE_TOO_LARGE")),
    { maxResponseBytes: 1_024 },
  );
  assert.equal(tooLarge.kind, "FAILED");
  if (tooLarge.kind === "FAILED") {
    assert.equal(tooLarge.code, "BODY_TOO_LARGE");
    assert.equal(tooLarge.retryable, false);
    assert.match(tooLarge.message, /1024-byte limit/);
  }

  const network = await loadRegisteredJobSource(source, throwingPort(new TypeError("fetch failed")));
  assert.equal(network.kind, "FAILED");
  if (network.kind === "FAILED") {
    assert.equal(network.code, "FETCH_FAILED");
    assert.equal(network.retryable, true);
  }
});

test("native fetch port names its own deadline but not a caller cancellation", async (context) => {
  const originalFetch = globalThis.fetch;
  // AbortSignal.timeout's timer is unref'd; keep the loop alive until it fires.
  const keepAlive = setInterval(() => undefined, 1_000);
  context.after(() => {
    globalThis.fetch = originalFetch;
    clearInterval(keepAlive);
  });
  // A provider that never answers until the request is aborted.
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;

  const request: SourceFetchRequest = {
    sourceId: "greenhouse:test",
    provider: "GREENHOUSE",
    url: "https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true",
    maxResponseBytes: 1_024,
  };
  await assert.rejects(
    createNativeJobApiFetchPort({ timeoutMilliseconds: 20 }).fetch(request),
    /JOB_API_TIMEOUT/,
  );

  const controller = new AbortController();
  const pending = createNativeJobApiFetchPort({ timeoutMilliseconds: 60_000 }).fetch({ ...request, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message !== "JOB_API_TIMEOUT");
});
