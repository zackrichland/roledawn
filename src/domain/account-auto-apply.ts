export type AutoApplyState = Readonly<{
  enabled: boolean;
  status: "OFF" | "ACTIVE" | "PAUSED_PROFILE_CHANGED";
  version: number;
  intervalSeconds: number;
  dailyCap: number;
  attemptedToday: number;
  confirmedToday: number;
  nextSubmissionAt: string | null;
  lastCheckedAt: string | null;
  lastOutcome: string | null;
}>;
export type SetAutoApplyCommand = Readonly<{ commandId: string; expectedVersion: number; enabled: boolean }>;
export class AutoApplyError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "AutoApplyError"; }
}
const statuses = new Set(["OFF", "ACTIVE", "PAUSED_PROFILE_CHANGED"]);
const outcomes = new Set(["PREPARED", "DELEGATED", "WAITING_APPLICATION", "NO_MATCHES", "RANKING_INCOMPLETE", "RATE_LIMITED", "CHECK_FAILED", "PAUSED", "PROFILE_CHANGED"]);
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is string | null { return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value))); }
export function parseAutoApplyState(value: unknown): AutoApplyState {
  if (!record(value) || typeof value.enabled !== "boolean" || typeof value.status !== "string" || !statuses.has(value.status)
    || !integer(value.version) || !integer(value.interval_seconds) || value.interval_seconds < 3600
    || !integer(value.daily_cap) || value.daily_cap < 1 || value.daily_cap > 24
    || !integer(value.attempted_today) || !integer(value.confirmed_today) || value.confirmed_today > value.attempted_today
    || !timestamp(value.next_submission_at) || !timestamp(value.last_checked_at)
    || !(value.last_outcome === null || (typeof value.last_outcome === "string" && outcomes.has(value.last_outcome)))
    || value.enabled !== (value.status === "ACTIVE")) throw new AutoApplyError("AUTO_APPLY_STATE_INVALID");
  return Object.freeze({ enabled: value.enabled, status: value.status as AutoApplyState["status"], version: value.version,
    intervalSeconds: value.interval_seconds, dailyCap: value.daily_cap, attemptedToday: value.attempted_today,
    confirmedToday: value.confirmed_today, nextSubmissionAt: value.next_submission_at, lastCheckedAt: value.last_checked_at,
    lastOutcome: value.last_outcome as string | null });
}
export function validateSetAutoApplyCommand(command: SetAutoApplyCommand): void {
  if (!command || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.commandId)
    || !integer(command.expectedVersion) || typeof command.enabled !== "boolean") throw new AutoApplyError("AUTO_APPLY_COMMAND_INVALID");
}
