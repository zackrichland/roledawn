import { getOptionalActor } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };

export async function GET(_request: Request, { params }: { params: Promise<{ applicationId: string }> }): Promise<Response> {
  const actor = await getOptionalActor();
  if (!actor) return new Response("Sign in to download your receipt.", { status: 401, headers });
  const { applicationId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(applicationId)) {
    return new Response("Receipt not found.", { status: 404, headers });
  }
  const client = await createSupabaseServerClient();
  // Candidate ownership and workspace membership are checked by the same RLS
  // boundary used for the application workspace. No service key is needed.
  const { data, error } = await client.from("receipts")
    .select("application_id,confirmation_kind,confirmation_reference,evidence_manifest,receipt_hash,confirmed_at")
    .eq("application_id", applicationId).order("confirmed_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return new Response("The receipt could not be loaded.", { status: 503, headers });
  if (!data) return new Response("Receipt not found.", { status: 404, headers });
  return new Response(JSON.stringify({ schemaRelease: "application-receipt-export/1", ...data }, null, 2), {
    headers: { ...headers, "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="Application-Receipt.json"' },
  });
}
