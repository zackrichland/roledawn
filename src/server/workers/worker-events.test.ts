import assert from "node:assert/strict";
import test from "node:test";

import { errorDetail, recordWorkerEvent } from "./worker-events.ts";

test("event details keep codes and browser timeouts but never raw provider or candidate text", () => {
  assert.deepEqual(errorDetail(new Error("OPENAI_AGENTS_ABORTED")), { error: "Error", message: "OPENAI_AGENTS_ABORTED" });
  assert.equal(errorDetail(new Error("locator.click: Timeout 2000ms exceeded.\nCall log: waiting for 'Zack Richland'")).message, "locator.click: Timeout 2000ms exceeded");
  assert.equal(errorDetail(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.test/?email=a@b.c")).message, "net::ERR_NAME_NOT_RESOLVED");
  const leaky = errorDetail(new Error("provider error with private candidate text and credentials"));
  assert.equal("message" in leaky, false);
  assert.match(leaky.messageSha256 ?? "", /^[0-9a-f]{12}$/u);
  assert.equal(JSON.stringify(leaky).includes("candidate"), false);
});

test("recording is best effort and bounded", async () => {
  const calls: Record<string, unknown>[] = [];
  const database = { async rpc(_name: string, args: Record<string, unknown>) { calls.push(args); return { data: null, error: null }; } };
  await recordWorkerEvent(database, { lane: "autopilot", stage: "send", outcome: "FAILED", code: "not a code", detail: { big: "x".repeat(10_000) }, durationMs: -5 });
  assert.equal(calls[0]!.p_code, null);
  assert.deepEqual(calls[0]!.p_detail, { truncated: true });
  assert.equal(calls[0]!.p_duration_ms, 0);
  await recordWorkerEvent({ async rpc() { throw new Error("down"); } }, { lane: "kit", stage: "kit", outcome: "FAILED" });
  await recordWorkerEvent(database, { lane: "Bad Lane!", stage: "x", outcome: "INFO" });
  assert.equal(calls.length, 1);
});
