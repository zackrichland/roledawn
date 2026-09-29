/**
 * Supabase requests from page renders fail fast instead of hanging on a
 * stalled gateway node (observed 2026-09-28: every other request took 40 s
 * and returned HTTP 525). Reads retry once. Writes never retry here: a
 * command whose response was lost is reconciled through its own command id,
 * not by sending it again from the transport.
 */
const IDEMPOTENT_RPCS = new Set([
  "bootstrap_personal_workspace",
  "search_catalog_jobs",
  "search_catalog_jobs_ranked",
  "matching_catalog_index_json",
  "matching_catalog_index_page",
  "matching_catalog_jobs",
]);

/** Reads that return large payloads (the whole matching index, 500 jobs). */
const HEAVY_READ_RPCS = new Set([
  "matching_catalog_index_json",
  "matching_catalog_index_page",
  "matching_catalog_jobs",
  "search_catalog_jobs",
  "search_catalog_jobs_ranked",
]);

function rpcName(url: string): string | null {
  return /\/rest\/v1\/rpc\/([a-z0-9_]+)(?:\?|$)/u.exec(url)?.[1] ?? null;
}

function retryable(method: string, url: string): boolean {
  if (method === "GET" || method === "HEAD") return true;
  if (method !== "POST") return false;
  const name = rpcName(url);
  return Boolean(name && IDEMPOTENT_RPCS.has(name));
}

/**
 * Reads normally answer in well under a second, so a stalled read is cut at
 * `readTimeoutMs` and retried once. Writes get `writeTimeoutMs` and no retry.
 */
export function resilientFetch(readTimeoutMs = 6_000, writeTimeoutMs = 20_000): typeof fetch {
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const name = rpcName(url);
    const timeoutMs = !retryable(method, url) ? writeTimeoutMs
      : name && HEAVY_READ_RPCS.has(name) ? Math.max(readTimeoutMs, 15_000) : readTimeoutMs;
    const attempt = async () => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      const response = await fetch(input, { ...init, signal });
      // 52x come from the edge when the gateway can't reach the API.
      if (response.status >= 520 && response.status <= 527) throw new Error(`SUPABASE_EDGE_${response.status}`);
      return response;
    };
    if (!retryable(method, url)) return attempt();
    try {
      return await attempt();
    } catch (error) {
      if (init.signal?.aborted) throw error;
      return attempt();
    }
  };
}
