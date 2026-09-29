import { createHmac, timingSafeEqual } from "node:crypto";

/** Short-lived, signed OAuth state bound to the signed-in user who started the connection. */
export const MAILBOX_STATE_COOKIE = "rd_mailbox_oauth";
export const MAILBOX_STATE_PATH = "/api/mailbox";
type MailboxState = Readonly<{ nonce: string; userId: string; expiresAt: number }>;

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(`roledawn-mailbox-oauth-state:${payload}`).digest("base64url");
}

export function signMailboxState(state: MailboxState, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function verifyMailboxState(value: string | undefined, key: Buffer, now = Date.now()): MailboxState | null {
  const [payload, signature, ...rest] = (value ?? "").split(".");
  if (!payload || !signature || rest.length) return null;
  const expected = Buffer.from(sign(payload, key)); const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<MailboxState>;
    if (typeof state.nonce !== "string" || state.nonce.length < 16 || typeof state.userId !== "string" || typeof state.expiresAt !== "number" || state.expiresAt < now) return null;
    return Object.freeze({ nonce: state.nonce, userId: state.userId, expiresAt: state.expiresAt });
  } catch { return null; }
}
