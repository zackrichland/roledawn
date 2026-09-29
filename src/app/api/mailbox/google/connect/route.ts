import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { getAuthRedirectOrigin } from "@/server/auth/auth-redirect-policy";
import { getOptionalActor } from "@/server/auth/session";
import { googleMailboxAuthorizationUrl, readGoogleMailboxConfig } from "@/server/mailbox/google-mailbox";
import { MAILBOX_STATE_COOKIE, MAILBOX_STATE_PATH, signMailboxState } from "@/server/mailbox/oauth-state";
import { readMailboxTokenKey } from "@/server/mailbox/token-crypto";

export const dynamic = "force-dynamic";

/** Starts read-only Gmail access for employer verification codes. */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = getAuthRedirectOrigin(request.url, process.env);
  const actor = await getOptionalActor();
  if (!actor) return NextResponse.redirect(new URL("/login?next=/vault/preferences", origin), 303);
  const config = readGoogleMailboxConfig();
  const key = readMailboxTokenKey();
  if (!config || !key) return NextResponse.redirect(new URL("/vault/preferences?mailbox=unavailable", origin), 303);
  const nonce = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(googleMailboxAuthorizationUrl(config, { state: nonce, loginHint: actor.email }), 303);
  response.cookies.set(MAILBOX_STATE_COOKIE, signMailboxState({ nonce, userId: actor.userId, expiresAt: Date.now() + 600_000 }, key), {
    httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: MAILBOX_STATE_PATH, maxAge: 600,
  });
  return response;
}
