import { companyLogoIdentity, isCompanyLogoBoardSlug, isCompanyLogoProvider, type CompanyLogoProvider } from "../../domain/company-logo.ts";
import type { Database } from "../../lib/supabase/database.types.ts";
import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import {
  fetchCompanyLogo, isServableLogoAsset,
  type CompanyLogoAsset, type CompanyLogoFetchResult, type CompanyLogoResolution,
} from "./company-logo.ts";

/**
 * Durable, employer-keyed logo cache (public.employer_logos, one row per provider and board slug).
 *
 * A logo is fetched from the employer's board once, then served from the table. Freshness rules:
 * - A found logo is fresh for 7 days. After that it is still served immediately while one background
 *   read revalidates it. A failed or transient read never replaces it; only a new logo does.
 * - "No logo" is remembered for 6 hours, then the next request looks again.
 * - Transient failures (timeouts, throttling, upstream 5xx) are not remembered as answers.
 * If the table is missing or the database is unreachable, every request falls back to a live read.
 */
export const FOUND_REFRESH_MS = 7 * 86_400_000;
export const NONE_RETRY_MS = 6 * 3_600_000;
/** Between upstream attempts for a board that has a row, whatever they returned. Shared across instances. */
export const ATTEMPT_COOLDOWN_MS = 15 * 60_000;
/** Between live attempts for a board with no row after a transient failure. Per instance. */
const LIVE_FAILURE_COOLDOWN_MS = 30_000;
/** After a store error, skip the store this long so a missing table costs one failed call, not one per image. */
const STORE_PAUSE_MS = 60_000;
const STORE_READ_TIMEOUT_MS = 3_000;
const STORE_WRITE_TIMEOUT_MS = 5_000;

export type StoredCompanyLogo =
  | Readonly<{ status: "FOUND"; asset: CompanyLogoAsset; checkedAt: number; attemptedAt: number }>
  | Readonly<{ status: "NONE"; checkedAt: number; attemptedAt: number }>;

export type CompanyLogoStore = Readonly<{
  /** Null when there is no row. Throws when the store cannot be read. */
  read(provider: CompanyLogoProvider, board: string): Promise<StoredCompanyLogo | null>;
  /** Applies one live outcome; the database decides what may replace what. Throws when it cannot be written. */
  record(provider: CompanyLogoProvider, board: string, outcome: CompanyLogoFetchResult): Promise<void>;
}>;

export type CompanyLogoReport = Readonly<{
  provider: CompanyLogoProvider;
  event: "live_found" | "live_none" | "live_error" | "store_read_failed" | "store_write_failed";
  reason?: string;
  ms?: number;
}>;

export function encodeBytea(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex")}`;
}

export function decodeBytea(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^\\x(?:[0-9a-f]{2})+$/iu.test(value)) return null;
  return new Uint8Array(Buffer.from(value.slice(2), "hex"));
}

type EmployerLogoRow = Pick<Database["public"]["Tables"]["employer_logos"]["Row"],
  "status" | "content_type" | "logo_bytes" | "checked_at" | "attempted_at">;

type QueryResult = PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
/** Just the calls this store makes, so tests can supply a bounded database adapter. */
export type CompanyLogoDatabaseClient = Readonly<{
  from(table: "employer_logos"): {
    select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): {
      abortSignal(signal: AbortSignal): { maybeSingle(): QueryResult };
    } } };
  };
  rpc(fn: "record_employer_logo_check", args: Record<string, unknown>): { abortSignal(signal: AbortSignal): QueryResult };
}>;

const ROW_COLUMNS = "status, content_type, logo_bytes, checked_at, attempted_at";

function parseRow(data: unknown): StoredCompanyLogo | null {
  if (data === null || typeof data !== "object") return null;
  const row = data as EmployerLogoRow;
  const checkedAt = Date.parse(row.checked_at);
  const attemptedAt = Date.parse(row.attempted_at);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(attemptedAt)) throw new Error("EMPLOYER_LOGO_ROW_INVALID");
  if (row.status === "NONE") return { status: "NONE", checkedAt, attemptedAt };
  const bytes = decodeBytea(row.logo_bytes);
  const asset = bytes && row.content_type ? { bytes, contentType: row.content_type } : null;
  // A row that does not look like what the table promises is a store fault, not a logo.
  if (row.status !== "FOUND" || !asset || !isServableLogoAsset(asset)) throw new Error("EMPLOYER_LOGO_ROW_INVALID");
  return { status: "FOUND", asset, checkedAt, attemptedAt };
}

export function createSupabaseCompanyLogoStore(client: CompanyLogoDatabaseClient): CompanyLogoStore {
  return {
    async read(provider, board) {
      const { data, error } = await client.from("employer_logos").select(ROW_COLUMNS)
        .eq("provider", provider).eq("board_slug", board)
        .abortSignal(AbortSignal.timeout(STORE_READ_TIMEOUT_MS)).maybeSingle();
      if (error) throw new Error("EMPLOYER_LOGO_READ_FAILED");
      return parseRow(data);
    },
    async record(provider, board, outcome) {
      const { error } = await client.rpc("record_employer_logo_check", {
        p_provider: provider, p_board_slug: board,
        p_outcome: outcome.kind === "found" ? "FOUND" : outcome.kind === "none" ? "NONE" : "ERROR",
        // SQL parameters without a default are typed non-null in the generated types; these two are nullable by design.
        p_content_type: outcome.kind === "found" ? outcome.asset.contentType : null,
        p_logo_bytes: outcome.kind === "found" ? encodeBytea(outcome.asset.bytes) : null,
      }).abortSignal(AbortSignal.timeout(STORE_WRITE_TIMEOUT_MS));
      if (error) throw new Error("EMPLOYER_LOGO_WRITE_FAILED");
    },
  };
}

/** Null when the deployment has no service-role access; callers then read the board live every time. */
export function createDefaultCompanyLogoStore(environment: Readonly<Record<string, string | undefined>> = process.env): CompanyLogoStore | null {
  if (!environment.SUPABASE_SECRET_KEY?.trim() || !environment.NEXT_PUBLIC_SUPABASE_URL?.trim()) return null;
  try {
    // Bound the generic Supabase client to this adapter interface; row fields come from generated Database types.
    return createSupabaseCompanyLogoStore(createSupabaseAdminClient("company-logos/1", environment as NodeJS.ProcessEnv) as unknown as CompanyLogoDatabaseClient);
  } catch {
    return null;
  }
}

export type CompanyLogoResolverOptions = Readonly<{
  store: CompanyLogoStore | null;
  fetcher?: typeof fetch;
  now?: () => number;
  /** Replace the live board read (tests). */
  load?: (provider: CompanyLogoProvider, board: string, fetcher: typeof fetch) => Promise<CompanyLogoFetchResult>;
  report?: (event: CompanyLogoReport) => void;
}>;

export type CompanyLogoResolveOptions = Readonly<{
  /** Runs work after the response (Next's `after`). Without it, revalidation is fire-and-forget. */
  defer?: (task: () => Promise<unknown>) => void;
}>;

/** Static codes only: no slugs, URLs or response text reach the logs. */
function logReport(event: CompanyLogoReport): void {
  (event.event === "live_found" ? console.info : console.warn)("company-logo", JSON.stringify(event));
}

export function createCompanyLogoResolver(options: CompanyLogoResolverOptions) {
  const { store } = options;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const load = options.load ?? ((provider, board, request) => fetchCompanyLogo(provider, board, request));
  const report = options.report ?? logReport;
  const inflight = new Map<string, Promise<CompanyLogoFetchResult>>();
  const failedAt = new Map<string, number>();
  let storePausedUntil = 0;

  const storeAvailable = () => store !== null && now() >= storePausedUntil;
  const pauseStore = (provider: CompanyLogoProvider, event: "store_read_failed" | "store_write_failed") => {
    storePausedUntil = now() + STORE_PAUSE_MS;
    report({ provider, event });
  };

  /**
   * One live read per board at a time on this instance; the result is recorded once. Never rejects.
   * `persist` is whether the store is usable; a transient failure is only worth recording when a row exists to touch.
   */
  function readLive(provider: CompanyLogoProvider, board: string, persist: boolean, rowExists: boolean): Promise<CompanyLogoFetchResult> {
    const key = `${provider}/${board}`;
    const running = inflight.get(key);
    if (running) return running;
    const started = now();
    const task = (async (): Promise<CompanyLogoFetchResult> => {
      let result: CompanyLogoFetchResult;
      try {
        result = await load(provider, board, fetcher);
      } catch {
        result = { kind: "error", reason: "LIVE_READ_FAILED" };
      }
      if (result.kind === "found" && !isServableLogoAsset(result.asset)) result = { kind: "none", reason: "ASSET_INVALID" };
      if (result.kind === "error") failedAt.set(key, now()); else failedAt.delete(key);
      report({ provider, event: `live_${result.kind}`, ...(result.kind === "found" ? {} : { reason: result.reason }), ms: now() - started });
      if (persist && store && (result.kind !== "error" || rowExists)) {
        try { await store.record(provider, board, result); } catch { pauseStore(provider, "store_write_failed"); }
      }
      return result;
    })().finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
  }

  async function resolve(providerInput: string, boardInput: string, resolveOptions: CompanyLogoResolveOptions = {}): Promise<CompanyLogoResolution> {
    if (!isCompanyLogoProvider(providerInput) || !isCompanyLogoBoardSlug(boardInput)) return { kind: "invalid" };
    const provider = providerInput;
    const board = boardInput.toLowerCase();
    const key = `${provider}/${board}`;

    let stored: StoredCompanyLogo | null = null;
    let persist = storeAvailable();
    if (persist && store) {
      try {
        stored = await store.read(provider, board);
      } catch {
        persist = false;
        pauseStore(provider, "store_read_failed");
      }
    }

    const t = now();
    if (stored?.status === "FOUND") {
      if (t - stored.checkedAt >= FOUND_REFRESH_MS && t - stored.attemptedAt >= ATTEMPT_COOLDOWN_MS) {
        // Serve what is stored; look again behind the response. Whatever comes back, a transient failure
        // records nothing that could replace this logo.
        const revalidate = () => readLive(provider, board, true, true);
        if (resolveOptions.defer) resolveOptions.defer(revalidate); else void revalidate();
      }
      return { kind: "asset", asset: stored.asset };
    }
    if (stored?.status === "NONE" && (t - stored.checkedAt < NONE_RETRY_MS || t - stored.attemptedAt < ATTEMPT_COOLDOWN_MS)) {
      return { kind: "none" };
    }

    // No row, an expired "no logo", or no usable store: read the board now.
    const recentFailure = failedAt.get(key);
    if (!stored && recentFailure !== undefined && t - recentFailure < LIVE_FAILURE_COOLDOWN_MS) return { kind: "unavailable" };
    const result = await readLive(provider, board, persist, stored !== null);
    if (result.kind === "found") return { kind: "asset", asset: result.asset };
    // An expired "no logo" that could not be rechecked is still the last known answer.
    if (result.kind === "none" || stored?.status === "NONE") return { kind: "none" };
    return { kind: "unavailable" };
  }

  /** Fill the cache ahead of the first page view. Best effort; never throws. */
  async function warm(providerInput: string, boardInput: string): Promise<CompanyLogoResolution["kind"]> {
    const pending: Promise<unknown>[] = [];
    try {
      const resolution = await resolve(providerInput, boardInput, { defer: (task) => { pending.push(task().catch(() => undefined)); } });
      await Promise.allSettled(pending);
      return resolution.kind;
    } catch {
      return "unavailable";
    }
  }

  return { resolve, warm };
}

export type CompanyLogoResolver = ReturnType<typeof createCompanyLogoResolver>;

let shared: CompanyLogoResolver | undefined;
/** One resolver per server instance, so concurrent requests for a board share a single live read. */
export function companyLogoResolver(): CompanyLogoResolver {
  return shared ??= createCompanyLogoResolver({ store: createDefaultCompanyLogoStore() });
}

/**
 * Warm the cache for the employer behind a posting URL, if it is a hosted Greenhouse, Lever or Ashby posting.
 * Call from a background path after an application is created or a board is first seen.
 */
export async function warmCompanyLogoForUrl(postingUrl: string | null | undefined): Promise<void> {
  const identity = companyLogoIdentity(postingUrl);
  if (identity) await companyLogoResolver().warm(identity.provider, identity.board);
}
