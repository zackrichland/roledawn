/** Separate REST transport for the disabled canary. No automatic HTTP retries. */
const ORIGIN = "https://api.openai.com/v1/agents/sessions";
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const LIMIT = 2 * 1024 * 1024;
const safeId = (id: string) => { if (!ID.test(id)) throw new Error("HOSTED_CANARY_INVALID_ID"); return id; };
export interface HostedCanaryTransport {
  create(body: unknown, signal: AbortSignal): Promise<unknown>;
  turns(sessionId: string, signal: AbortSignal): Promise<unknown>;
  retrieve(sessionId: string, signal: AbortSignal): Promise<unknown>;
  post(sessionId: string, body: unknown, key: string | null, signal: AbortSignal): Promise<void>;
  stream(sessionId: string, signal: AbortSignal): Promise<{ events: AsyncIterable<unknown>; close(): Promise<void> }>;
  remove(sessionId: string, signal: AbortSignal): Promise<void>;
}
export function createHostedCanaryTransport(apiKey: string, fetcher: typeof fetch = fetch): HostedCanaryTransport {
  if (!apiKey || /\s/u.test(apiKey)) throw new Error("HOSTED_CANARY_CREDENTIAL_REQUIRED");
  async function request(method: string, suffix: string, body: unknown, signal: AbortSignal, key?: string | null, stream = false) {
    let response: Response;
    try {
      response = await fetcher(ORIGIN + suffix, { method, redirect: "error", signal,
        headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "agents=v1",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { "Idempotency-Key": safeId(key) } : {}), ...(stream ? { Accept: "text/event-stream" } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new Error("HOSTED_CANARY_TRANSPORT_FAILED"); }
    if (!response.ok && !(method === "DELETE" && response.status === 404)) { await response.body?.cancel().catch(() => undefined); throw new Error("HOSTED_CANARY_HTTP_FAILED"); }
    return response;
  }
  async function json(response: Response) {
    const reader = response.body?.getReader(); if (!reader) throw new Error("HOSTED_CANARY_EMPTY_RESPONSE");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > LIMIT) throw new Error(); chunks.push(part.value); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch { throw new Error("HOSTED_CANARY_INVALID_RESPONSE"); }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  return {
    create: async (body, signal) => json(await request("POST", "", body, signal)),
    turns: async (id, signal) => json(await request("GET", `/${safeId(id)}/turns?limit=20&order=desc`, undefined, signal)),
    retrieve: async (id, signal) => json(await request("GET", `/${safeId(id)}`, undefined, signal)),
    post: async (id, body, key, signal) => { const r = await request("POST", `/${safeId(id)}/events`, body, signal, key); await r.body?.cancel(); },
    remove: async (id, signal) => { const r = await request("DELETE", `/${safeId(id)}`, undefined, signal); await r.body?.cancel(); },
    stream: async (id, signal) => {
      const r = await request("GET", `/${safeId(id)}/events`, undefined, signal, null, true);
      if (!r.headers.get("content-type")?.startsWith("text/event-stream") || !r.body) {
        await r.body?.cancel(); throw new Error("HOSTED_CANARY_INVALID_STREAM");
      }
      const reader = r.body.getReader();
      return { close: async () => { await reader.cancel().catch(() => undefined); },
        events: (async function* () {
          const decoder = new TextDecoder(); let buffer = "", data: string[] = [], dataBytes = 0;
          try {
            while (true) {
              const part = await reader.read(); if (part.done) break;
              buffer += decoder.decode(part.value, { stream: true });
              if (Buffer.byteLength(buffer) + dataBytes > LIMIT) throw new Error("HOSTED_CANARY_STREAM_TOO_LARGE");
              let end: number;
              while ((end = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, end).replace(/\r$/u, ""); buffer = buffer.slice(end + 1);
                if (line.startsWith("data:")) { const text = line.slice(5).replace(/^ /u, ""); data.push(text); dataBytes += Buffer.byteLength(text); }
                if (line === "" && data.length) {
                  const raw = data.join("\n"); data = []; dataBytes = 0;
                  if (raw === "[DONE]") return;
                  let event: unknown;
                  try { event = JSON.parse(raw); } catch { throw new Error("HOSTED_CANARY_MALFORMED_EVENT"); }
                  yield event;
                }
              }
            }
            if (buffer.trim() || data.length) throw new Error("HOSTED_CANARY_TRUNCATED_EVENT");
          } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        })(),
      };
    },
  };
}
