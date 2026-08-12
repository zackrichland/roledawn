export const MAX_OUTBOX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

export type OutboxFailureDisposition =
  | Readonly<{ action: "DEAD_LETTER"; errorCode: string }>
  | Readonly<{ action: "RETRY"; errorCode: string; retryAfterSeconds: number }>;

function boundedErrorCode(value: string): string {
  const normalized = value.trim().replace(/\s+/g, "_").slice(0, 120);
  return normalized || "WORKER_UNEXPECTED_FAILURE";
}

export function decideOutboxFailureDisposition(
  attemptCount: number,
  rawErrorCode: string,
): OutboxFailureDisposition {
  const errorCode = boundedErrorCode(rawErrorCode);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    return { action: "DEAD_LETTER", errorCode: "WORKER_ATTEMPT_COUNT_INVALID" };
  }
  if (attemptCount >= MAX_OUTBOX_ATTEMPTS) {
    return { action: "DEAD_LETTER", errorCode };
  }
  return {
    action: "RETRY",
    errorCode,
    retryAfterSeconds: Math.min(
      60 * 2 ** (attemptCount - 1),
      MAX_RETRY_DELAY_SECONDS,
    ),
  };
}
