import { createHash } from "node:crypto";

// Read-only companion to the hosted probe. Never imports a submit or receipt writer.
// https://developers.openai.com/api/docs/guides/agents-api/tracing
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const STAGES = ["SETUP", "INSPECTION", "FILL", "READBACK", "VERIFICATION", "SUBMISSION", "RECONCILIATION"] as const;
export type HostedTraceStage = typeof STAGES[number];
const MAX_BYTES = 2 * 1024 * 1024;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function record(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("HOSTED_TRACE_INVALID_RESPONSE");
  return x as Record<string, unknown>;
}
function identifier(x: unknown): string {
  if (typeof x !== "string" || !ID.test(x)) throw new Error("HOSTED_TRACE_INVALID_ID");
  return x;
}
function list(x: unknown): unknown[] {
  if (!Array.isArray(x) || x.length > 10_000) throw new Error("HOSTED_TRACE_INVALID_RESPONSE");
  return x;
}

/** Discards span names, attributes, events, links, error messages and all model/tool content. */
export function summarizeHostedTracePage(value: unknown, sessionId: string, stages: Readonly<Record<string, HostedTraceStage>>) {
  identifier(sessionId);
  for (const [turn, stage] of Object.entries(stages)) {
    identifier(turn);
    if (!STAGES.includes(stage)) throw new Error("HOSTED_TRACE_INVALID_STAGE");
  }
  const page = record(value);
  if (page.object !== "list" || typeof page.has_more !== "boolean") throw new Error("HOSTED_TRACE_INVALID_RESPONSE");
  const traces = list(page.data).map(item => {
    const trace = record(item);
    const turnId = identifier(trace.id);
    if (trace.object !== "agent.session.trace" || trace.session_id !== sessionId) throw new Error("HOSTED_TRACE_SESSION_MISMATCH");
    let spanCount = 0, failedSpanCount = 0, unsetStatusCount = 0;
    for (const resource of list(record(trace.otlp).resourceSpans)) {
      for (const scope of list(record(resource).scopeSpans)) {
        for (const raw of list(record(scope).spans)) {
          if (++spanCount > 10_000) throw new Error("HOSTED_TRACE_TOO_MANY_SPANS");
          const span = record(raw);
          const code = span.status == null ? 0 : record(span.status).code;
          if (code === 2 || code === "STATUS_CODE_ERROR") failedSpanCount++;
          else if (code !== 1 && code !== "STATUS_CODE_OK") unsetStatusCount++;
        }
      }
    }
    return { sessionHash: digest(sessionId), turnHash: digest(turnId),
      stage: Object.hasOwn(stages, turnId) ? stages[turnId] : "UNMAPPED" as const,
      spanCount, failedSpanCount, unsetStatusCount };
  });
  const lastId = page.last_id === null ? null : identifier(page.last_id);
  if (page.has_more && (!traces.length || lastId !== record(list(page.data).at(-1)).id)) throw new Error("HOSTED_TRACE_INVALID_CURSOR");
  return { traces, hasMore: page.has_more, lastId };
}

/** GET only; bounded pages/body/time; no retries or raw provider errors escape. */
export async function readHostedTraceSummaries(options: Readonly<{
  apiKey: string;
  sessionId: string;
  stages: Readonly<Record<string, HostedTraceStage>>;
  fetch?: typeof fetch;
}>) {
  identifier(options.sessionId);
  if (!options.apiKey.trim() || /\s/u.test(options.apiKey)) throw new Error("HOSTED_TRACE_CREDENTIAL_REQUIRED");
  const stages = Object.freeze({ ...options.stages });
  // Validate local correlation before the first network request.
  summarizeHostedTracePage({ object: "list", data: [], has_more: false, last_id: null }, options.sessionId, stages);
  const summaries: ReturnType<typeof summarizeHostedTracePage>["traces"] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
    const query = new URLSearchParams({ limit: "1", order: "asc" });
    if (cursor) query.set("after", cursor);
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`https://api.openai.com/v1/agents/sessions/${options.sessionId}/traces?${query}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${options.apiKey}`, "OpenAI-Beta": "agents=v1" },
      });
    } catch { throw new Error("HOSTED_TRACE_TRANSPORT_FAILED"); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(response.status === 403 ? "HOSTED_TRACE_ACCESS_DENIED" : "HOSTED_TRACE_HTTP_FAILED");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("HOSTED_TRACE_INVALID_RESPONSE");
    const chunks: Uint8Array[] = [];
    let size = 0;
    let value: unknown;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BYTES) throw new Error("HOSTED_TRACE_BODY_TOO_LARGE");
        chunks.push(next.value);
      }
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { throw new Error("HOSTED_TRACE_BODY_INVALID_OR_TOO_LARGE"); }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const page = summarizeHostedTracePage(value, options.sessionId, stages);
    for (const trace of page.traces) {
      if (seen.has(trace.turnHash)) throw new Error("HOSTED_TRACE_CURSOR_REPEATED");
      seen.add(trace.turnHash); summaries.push(trace);
    }
    if (!page.hasMore) return { traces: summaries, truncated: false, billingComplete: false as const };
    cursor = page.lastId;
  }
  return { traces: summaries, truncated: true, billingComplete: false as const };
}
