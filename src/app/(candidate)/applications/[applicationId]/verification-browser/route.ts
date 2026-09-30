import Browserbase from "@browserbasehq/sdk";
import { getOptionalActor } from "@/server/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AUTOPILOT_UUID } from "@/domain/application-autopilot";
import { applicationBrowserCheckUrl, browserCheckHtml } from "@/server/applications/browser-verification";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
function unavailable(status = 409) {
  return new Response("Verification is no longer open. Close this panel and check the application’s current status.", { status, headers });
}
export async function GET(_request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const actor = await getOptionalActor();
  if (!actor) return unavailable(401);
  const { applicationId } = await params;
  if (!AUTOPILOT_UUID.test(applicationId)) return unavailable(404);
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!apiKey || process.env.ROLEDAWN_BROWSERBASE_ENABLED !== "true") return unavailable(503);
  try {
    const admin = createSupabaseAdminClient("candidate-browser-verification/1");
    const { data, error } = await admin.rpc("get_application_browser_check_binding", { p_application_id: applicationId, p_auth_user_id: actor.userId });
    if (error || data?.length !== 1) return unavailable();
    const binding = data[0];
    const sdk = new Browserbase({ apiKey, maxRetries: 0, timeout: 10_000 });
    const session = await sdk.sessions.retrieve(binding.provider_session_ref);
    if (session.id !== binding.provider_session_ref || session.status !== "RUNNING" ||
        Date.parse(session.expiresAt) <= Date.now() || Date.parse(binding.expires_at) <= Date.now()) return unavailable();
    const debug = await sdk.sessions.debug(binding.provider_session_ref);
    // Recheck the lease after provider I/O, including candidate pause/cancel.
    const current = await admin.rpc("get_application_browser_check_binding", { p_application_id: applicationId, p_auth_user_id: actor.userId });
    if (current.error || current.data?.length !== 1 || current.data[0].provider_session_ref !== binding.provider_session_ref) return unavailable();
    const url = applicationBrowserCheckUrl(debug.pages, binding.destination_url);
    return new Response(browserCheckHtml(url), { headers: { ...headers, "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; frame-src ${new URL(url).origin}; frame-ancestors 'self'` } });
  } catch { return unavailable(503); }
}
