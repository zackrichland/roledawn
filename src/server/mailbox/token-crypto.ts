import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Mailbox refresh tokens are sealed with AES-256-GCM before they reach the
 * database. The candidate ID is the associated data, so a sealed token copied
 * to another candidate's row fails to open.
 */
export const MAILBOX_TOKEN_KEY_ID = "v1";

export function readMailboxTokenKey(environment: Readonly<Record<string, string | undefined>> = process.env): Buffer | null {
  const raw = environment.ROLEDAWN_MAILBOX_TOKEN_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MAILBOX_TOKEN_KEY_INVALID");
  return key;
}

export function sealMailboxToken(token: string, key: Buffer, candidateId: string): string {
  if (!token || token.length > 4_000) throw new Error("MAILBOX_TOKEN_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(candidateId, "utf8"));
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [MAILBOX_TOKEN_KEY_ID, iv.toString("base64url"), data.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openMailboxToken(sealed: string, key: Buffer, candidateId: string): string {
  const [version, iv, data, tag, ...rest] = sealed.split(".");
  if (version !== MAILBOX_TOKEN_KEY_ID || !iv || !data || !tag || rest.length) throw new Error("MAILBOX_TOKEN_FORMAT_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(candidateId, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("MAILBOX_TOKEN_UNREADABLE"); }
}
