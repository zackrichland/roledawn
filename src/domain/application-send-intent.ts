export type SendIntentResult = Readonly<{ open: boolean; replayed: boolean }>;

/** Durable send intent, kept distinct from document readiness. */
export type ApplicationSendIntentState = "NONE" | "OPEN" | "DELEGATED" | "CANCELED" | "NOT_DELIVERABLE" | "APPLICATION_CLOSED" | "UNAVAILABLE";

export function applicationSendIntentState(row: Readonly<{ closed_at: string | null; close_reason: string | null }> | null): ApplicationSendIntentState {
  if (!row) return "NONE";
  if (row.closed_at === null) return row.close_reason === null ? "OPEN" : "UNAVAILABLE";
  switch (row.close_reason) {
    case "DELEGATED":
    case "CANCELED":
    case "NOT_DELIVERABLE":
    case "APPLICATION_CLOSED": return row.close_reason;
    default: return "UNAVAILABLE";
  }
}

/** Never ask for a second send while the existing request is open or unreadable. */
export function canOfferApplicationSend(state: ApplicationSendIntentState): boolean {
  return state === "NONE" || state === "CANCELED";
}

/** An accepted RPC request is not evidence that the durable intent is open. */
export function parseSendIntentResult(value: unknown, applicationId: string): SendIntentResult | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0] as Record<string, unknown> | null;
  if (!row || typeof row !== "object" || row.application_id !== applicationId
    || typeof row.intent_open !== "boolean" || typeof row.replayed !== "boolean") return null;
  return { open: row.intent_open, replayed: row.replayed };
}

/** Existing delivery, cancellation and outcome recovery have their own actions. */
export function mayRequestInitialSend(status: string): boolean {
  return !["CONFIRMED", "CANCELED", "SKIPPED", "EXECUTING", "RECONCILING", "AUTHORIZED"].includes(status);
}
