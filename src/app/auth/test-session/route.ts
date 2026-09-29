import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthRedirectOrigin } from "@/server/auth/auth-redirect-policy";
import { singleAccountAccessKeyMatches } from "@/server/auth/single-account-access";
import { getSingleAccountNextPath, readSingleAccountConfig } from "@/server/auth/single-account-policy";
import { establishSingleAccountSession } from "@/server/auth/single-account-session";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: NextRequest) {
  try {
    const config = readSingleAccountConfig();
    if (!config) return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
    const next = getSingleAccountNextPath(request.nextUrl.searchParams.get("next"));
    const destination = new URL(next, getAuthRedirectOrigin(request.url, process.env));
    const client = await createSupabaseServerClient();
    const claims = await client.auth.getClaims();
    if (claims.error || claims.data?.claims.sub !== config.userId) {
      // A new session needs the private access key; the URL alone opens nothing.
      if (!singleAccountAccessKeyMatches(request.nextUrl.searchParams.get("key"))) {
        return new Response("This RoleDawn workspace is private.", { status: 404, headers: PRIVATE_HEADERS });
      }
      const admin = createSupabaseAdminClient("single-account-test-session/1");
      await establishSingleAccountSession(config.userId, {
        getUser: userId => admin.auth.admin.getUserById(userId),
        generateLink: email => admin.auth.admin.generateLink({ type: "magiclink", email }),
        verify: tokenHash => client.auth.verifyOtp({ type: "email", token_hash: tokenHash }),
        clearLocalSession: () => client.auth.signOut({ scope: "local" }),
      });
    }
    const response = NextResponse.redirect(destination, 303);
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
    return response;
  } catch {
    // No provider details, account identifiers, or tokens in the public error.
    return new Response("The test workspace is temporarily unavailable. Please reload to try again.", {
      status: 503, headers: PRIVATE_HEADERS,
    });
  }
}
