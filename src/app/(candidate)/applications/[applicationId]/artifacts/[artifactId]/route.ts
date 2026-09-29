import { getOptionalActor } from "@/server/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function response(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ applicationId: string; artifactId: string }> },
): Promise<Response> {
  const actor = await getOptionalActor();
  if (!actor) return response(401, "Sign in to download this file.");

  const { applicationId, artifactId } = await params;
  if (!UUID_PATTERN.test(applicationId) || !UUID_PATTERN.test(artifactId)) {
    return response(404, "File not found.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select("id, current_revision_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (applicationError) return response(500, "The file could not be authorized.");
  if (!application?.current_revision_id) return response(404, "File not found.");

  const { data: artifact, error: artifactError } = await supabase
    .from("artifact_versions")
    .select("id, application_revision_id, display_name, storage_bucket, storage_object_path")
    .eq("id", artifactId)
    .eq("application_revision_id", application.current_revision_id)
    .maybeSingle();
  if (artifactError) return response(500, "The file could not be authorized.");
  if (!artifact) return response(404, "File not found.");

  const admin = createSupabaseAdminClient("candidate-artifact-download/1");
  const { data: signed, error: signedError } = await admin.storage
    .from(artifact.storage_bucket)
    .createSignedUrl(artifact.storage_object_path, 60, {
      download: artifact.display_name,
    });
  if (signedError || !signed?.signedUrl) {
    return response(503, "The file is temporarily unavailable.");
  }

  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      location: signed.signedUrl,
      "referrer-policy": "no-referrer",
    },
  });
}
