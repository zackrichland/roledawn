import assert from "node:assert/strict";
import test from "node:test";
import { createHostedCanaryTransport } from "./openai-hosted-canary-transport.ts";
const signal = () => AbortSignal.timeout(5000);

test("REST transport uses documented routes, admission key and empty 204 responses", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = createHostedCanaryTransport("synthetic-test-credential", async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return calls.length === 1 ? Response.json({ id: "s1" }) : new Response(null, { status: 204 });
  });
  await transport.create({ environment: { type: "openai_hosted" } }, signal());
  await transport.post("s1", { events: [] }, "same-key", signal()); await transport.remove("s1", signal());
  assert.deepEqual(calls.map(c => [c.init.method, c.url]), [
    ["POST", "https://api.openai.com/v1/agents/sessions"], ["POST", "https://api.openai.com/v1/agents/sessions/s1/events"], ["DELETE", "https://api.openai.com/v1/agents/sessions/s1"]]);
  assert.equal(new Headers(calls[1].init.headers).get("Idempotency-Key"), "same-key");
  assert.equal(calls[0].init.redirect, "error");
});
test("transport errors do not include upstream body or URL query values and do not retry", async () => {
  let n = 0; const t = createHostedCanaryTransport("synthetic", async () => { n++; return new Response("private upstream diagnostics", { status: 403 }); });
  await assert.rejects(t.retrieve("s1", signal()), { message: "HOSTED_CANARY_HTTP_FORBIDDEN" }); assert.equal(n, 1);
  await assert.rejects(t.retrieve("../bad?secret=value", signal()), /INVALID_ID/); assert.equal(n, 1);
});
test("SSE supports split chunks, CRLF, comments and multiline data", async () => {
  const pieces = [': keepalive\r\nda', 'ta: {"type":\r\n', 'data: "sample"}\r\n\r\ndata: [DONE]\n\n'];
  const t = createHostedCanaryTransport("synthetic", async () => new Response(new ReadableStream({ start(c) {
    for (const p of pieces) c.enqueue(new TextEncoder().encode(p)); c.close();
  } }), { headers: { "Content-Type": "text/event-stream" } }));
  const stream = await t.stream("s1", signal()); const events = []; for await (const e of stream.events) events.push(e);
  assert.deepEqual(events, [{ type: "sample" }]); await stream.close();
});
test("SSE rejects malformed, truncated and oversized events", async () => {
  for (const body of ['data: {bad}\n\n', 'data: {"type":"sample"}', 'data: ' + 'x'.repeat(2 * 1024 * 1024)]) {
    const t = createHostedCanaryTransport("synthetic", async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
    const stream = await t.stream("s1", signal());
    await assert.rejects(async () => { for await (const event of stream.events) void event; }, /HOSTED_CANARY_(MALFORMED_EVENT|TRUNCATED_EVENT|STREAM_TOO_LARGE)/);
  }
});
test("recovery reads saved turns and deletion treats an already absent session as cleaned", async () => {
  const urls: string[] = [];
  const t = createHostedCanaryTransport("synthetic", async (url,init) => {
    urls.push(String(url)); return init?.method === "DELETE" ? new Response(null,{ status: 404 }) : Response.json({ data: [],has_more: false });
  });
  assert.deepEqual(await t.turns("s1",signal()),{ data: [],has_more: false });
  await t.remove("s1",signal()); assert.ok(urls[0].endsWith("/s1/turns?limit=20&order=desc"));
});
test("saved items and artifact retrieval use fixed official paths and preserve binary bytes", async () => {
  const urls: string[] = [];
  const t = createHostedCanaryTransport("synthetic",async url => {
    urls.push(String(url)); return String(url).endsWith("/content") ? new Response(new Uint8Array([0,1,255])) : Response.json({ object:"list",data:[],has_more:false });
  });
  await t.items("s1",signal()); await t.artifacts("s1",signal());
  assert.deepEqual(Array.from(await t.artifactContent("s1","artifact_1",signal())),[0,1,255]);
  assert.deepEqual(urls.map(u=>u.replace("https://api.openai.com/v1/agents/sessions", "")),["/s1/items?limit=5&order=asc","/s1/artifacts?limit=20&order=asc","/s1/artifacts/artifact_1/content"]);
});
