import assert from "node:assert/strict";
import test from "node:test";
import { readHostedTraceSummaries, summarizeHostedTracePage } from "./openai-hosted-browser-traces.ts";

const sensitive = "private applicant content and provider secret";
const trace = (id: string, session = "sess_fixture") => ({ id, session_id: session, object: "agent.session.trace",
  otlp: { resourceSpans: [{ attributes: [sensitive], scopeSpans: [{ spans: [
    { name: sensitive, attributes: [sensitive], events: [sensitive], status: { code: 2, message: sensitive } },
    { status: { code: 1 } }, {},
  ] }] }] } });
const page = (id: string, more = false) => ({ object: "list", data: [trace(id)], has_more: more, last_id: id });

test("published traces correlate by root turn and discard all model/tool content", () => {
  const result = summarizeHostedTracePage(page("turn_fixture"), "sess_fixture", { turn_fixture: "VERIFICATION" });
  assert.deepEqual({ ...result.traces[0], sessionHash: "hash", turnHash: "hash" }, {
    sessionHash: "hash", turnHash: "hash", stage: "VERIFICATION", spanCount: 3, failedSpanCount: 1, unsetStatusCount: 1,
  });
  assert.equal(JSON.stringify(result.traces).includes(sensitive), false);
  assert.equal(JSON.stringify(result.traces).includes("sess_fixture"), false);
  assert.equal(summarizeHostedTracePage(page("turn_other"), "sess_fixture", {}).traces[0].stage, "UNMAPPED");
  assert.throws(() => summarizeHostedTracePage({ ...page("turn_fixture"), data: [trace("turn_fixture", "sess_other")] }, "sess_fixture", {}), /SESSION_MISMATCH/);
});

test("trace reader uses GET and pagination without exposing payloads or treating usage as billing", async () => {
  const urls: string[] = [];
  const result = await readHostedTraceSummaries({ apiKey: "fixture-key", sessionId: "sess_fixture", stages: { turn_1: "SETUP", turn_2: "INSPECTION" },
    fetch: async (url, init) => {
      urls.push(String(url)); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
      return Response.json(page(urls.length === 1 ? "turn_1" : "turn_2", urls.length === 1));
    } });
  assert.match(urls[1], /after=turn_1/);
  assert.equal(result.truncated, false); assert.equal(result.billingComplete, false);
  assert.deepEqual(result.traces.map(t => t.stage), ["SETUP", "INSPECTION"]);
});

test("access denial and oversized responses remain redacted; empty traces are not proof of zero work", async () => {
  for (const response of [new Response(sensitive, { status: 403 }), new Response(sensitive.repeat(100_000))]) {
    await assert.rejects(readHostedTraceSummaries({ apiKey: "fixture", sessionId: "sess_fixture", stages: {}, fetch: async () => response }),
      error => error instanceof Error && error.message.startsWith("HOSTED_TRACE_") && !error.message.includes(sensitive));
  }
  const empty = await readHostedTraceSummaries({ apiKey: "fixture", sessionId: "sess_fixture", stages: {},
    fetch: async () => Response.json({ object: "list", data: [], has_more: false, last_id: null }) });
  assert.deepEqual(empty, { traces: [], truncated: false, billingComplete: false });
  await assert.rejects(readHostedTraceSummaries({ apiKey: "fixture", sessionId: "sess_fixture", stages: {},
    fetch: async () => new Response(sensitive, { status: 404 }) }), /HOSTED_TRACE_SESSION_NOT_FOUND/u);
});

test("bad local correlation performs no request; repeated cursor cannot loop", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json(page("turn_1", true)); };
  await assert.rejects(readHostedTraceSummaries({ apiKey: "fixture", sessionId: "sess_fixture", stages: { "bad/id": "SETUP" }, fetch: fetcher }), /INVALID_ID/);
  assert.equal(calls, 0);
  await assert.rejects(readHostedTraceSummaries({ apiKey: "fixture", sessionId: "sess_fixture", stages: {}, fetch: fetcher }), /CURSOR_REPEATED/);
  assert.equal(calls, 2);
});

test("trace pagination stops at five pages and reports incomplete coverage", async () => {
  let calls = 0;
  const result = await readHostedTraceSummaries({ apiKey: "fixture", sessionId: "sess_fixture", stages: {},
    fetch: async () => Response.json(page(`turn_${++calls}`, true)) });
  assert.equal(calls, 5); assert.equal(result.truncated, true); assert.equal(result.traces.length, 5);
});
