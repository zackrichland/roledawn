import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthRedirectOrigin } from "@/server/auth/auth-redirect-policy";
import { getOptionalActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import { exchangeGoogleMailboxCode, googleMailboxAddress, readGoogleMailboxConfig, revokeGoogleMailboxToken } from "@/server/mailbox/google-mailbox";
import { saveCandidateMailboxConnection } from "@/server/mailbox/mailbox-connections";
import { MAILBOX_STATE_COOKIE, MAILBOX_STATE_PATH, verifyMailboxState } from "@/server/mailbox/oauth-state";
import { MAILBOX_TOKEN_KEY_ID, readMailboxTokenKey, sealMailboxToken } from "@/server/mailbox/token-crypto";

export const dynamic = "force-dynamic";

/** Finishes the Gmail connection started by the same signed-in user. */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = getAuthRedirectOrigin(request.url, process.env);
  const back = (status: string) => {
    const response = NextResponse.redirect(new URL(`/vault/preferences?mailbox=${status}`, origin), 303);
    response.cookies.set(MAILBOX_STATE_COOKIE, "", { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: MAILBOX_STATE_PATH, maxAge: 0 });
    return response;
  };
  const actor = await getOptionalActor();
  if (!actor) return NextResponse.redirect(new URL("/login?next=/vault/preferences", origin), 303);
  const config = readGoogleMailboxConfig();
  const key = readMailboxTokenKey();
  if (!config || !key) return back("unavailable");
  const params = request.nextUrl.searchParams;
  const state = verifyMailboxState(request.cookies.get(MAILBOX_STATE_COOKIE)?.value, key);
  if (!state || state.userId !== actor.userId || params.get("state") !== state.nonce) return back("failed");
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code || code.length > 2_000) return back("failed");
  let refreshToken: string | null = null;
  try {
    const tokens = await exchangeGoogleMailboxCode(config, code);
    refreshToken = tokens.refreshToken;
    const emailAddress = await googleMailboxAddress(tokens.accessToken);
    const client = await createSupabaseServerClient();
    const scope = await bootstrapPersonalWorkspace(client, actor, actor.email?.split("@")[0] ?? "");
    await saveCandidateMailboxConnection(client, { candidateId: scope.candidateId, emailAddress,
      encryptedToken: sealMailboxToken(tokens.refreshToken, key, scope.candidateId), keyId: MAILBOX_TOKEN_KEY_ID, scopes: tokens.scopes });
    return back("connected");
  } catch (error) {
    // Nothing was stored: give the provider its grant back.
    if (refreshToken) await revokeGoogleMailboxToken(refreshToken);
    return back(error instanceof Error && error.message === "MAILBOX_SCOPE_MISSING" ? "scope" : "failed");
  }
}
