/**
 * Worker events (D-116): why and how long, for lane failures and every send.
 * Written best-effort: an event that cannot be stored never changes the
 * outcome of the work it describes. Details carry an error's class, provider
 * status, and a code-like message only, never form values, answers, documents,
 * or raw provider text.
 */
import { createHash } from "node:crypto";

type EventDatabase = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}>;

export type WorkerEventOutcome = "OK" | "FAILED" | "SKIPPED" | "INFO";
export type WorkerEvent = Readonly<{
  lane: string;
  stage: string;
  outcome: WorkerEventOutcome;
  code?: string | null;
  detail?: Readonly<Record<string, unknown>>;
  durationMs?: number | null;
  applicationId?: string | null;
  autopilotId?: string | null;
}>;

const CODE = /^[A-Z][A-Z0-9_]{2,119}$/u;
const LANE = /^[a-z][a-z-]{1,39}$/u;
const MAX_DETAIL_BYTES = 3_500;

/**
 * An error's class, provider status, and message only when the message is a
 * stable code or a browser timeout/network code. Other messages can carry
 * provider bodies or candidate text, so they are reduced to a short hash and
 * a length: identical failures still group together, and nothing leaks.
 */
export function errorDetail(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { error: typeof error };
  const status = (error as { status?: unknown }).status;
  const firstLine = error.message.split("\n")[0]!.trim();
  const timeout = /^((?:page|locator|frame|browserContext|browser|elementHandle)\.[A-Za-z]+): (Timeout \d+ms exceeded)/u.exec(firstLine);
  const network = /\bnet::ERR_[A-Z_]+/u.exec(firstLine);
  const safe = /^[A-Z][A-Z0-9_]{2,119}$/u.test(firstLine) ? firstLine : timeout ? `${timeout[1]}: ${timeout[2]}` : network ? network[0] : null;
  return {
    error: (error.name || "Error").slice(0, 60),
    ...(safe ? { message: safe } : { messageSha256: createHash("sha256").update(error.message).digest("hex").slice(0, 12), messageLength: String(error.message.length) }),
    ...(typeof status === "number" ? { status: String(status) } : {}),
  };
}

export async function recordWorkerEvent(database: EventDatabase, event: WorkerEvent): Promise<void> {
  if (!LANE.test(event.lane)) return;
  try {
    const detail = event.detail ?? {};
    const bounded = Buffer.byteLength(JSON.stringify(detail)) <= MAX_DETAIL_BYTES ? detail : { truncated: true };
    await database.rpc("record_worker_event", {
      p_lane: event.lane,
      p_stage: event.stage.slice(0, 80) || "unknown",
      p_outcome: event.outcome,
      p_code: event.code && CODE.test(event.code) ? event.code : null,
      p_detail: bounded,
      p_duration_ms: typeof event.durationMs === "number" && Number.isFinite(event.durationMs)
        ? Math.max(0, Math.min(86_400_000, Math.round(event.durationMs))) : null,
      p_application_id: event.applicationId ?? null,
      p_autopilot_id: event.autopilotId ?? null,
    });
  } catch {
    // Observability never breaks the work it observes.
  }
}
