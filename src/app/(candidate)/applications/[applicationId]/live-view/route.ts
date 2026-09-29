import { getOptionalActor } from "@/server/auth/session";
import {
  CandidateLiveViewError,
} from "@/server/applications/live-view";
import { getCandidateApplicationLiveView } from "@/server/applications/live-view.server";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function messageResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  const actor = await getOptionalActor();
  if (!actor) return messageResponse(401, "Sign in to open this secure browser.");

  const { applicationId } = await params;
  if (!UUID_PATTERN.test(applicationId)) {
    return messageResponse(404, "The secure browser is not available.");
  }

  try {
    const liveView = await getCandidateApplicationLiveView(actor, applicationId);
    return new Response(null, {
      status: 302,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        location: liveView.url,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CandidateLiveViewError) {
      const status = error.code === "LIVE_VIEW_REQUEST_INVALID"
        ? 404
        : error.code === "LIVE_VIEW_NOT_AVAILABLE"
          ? 409
          : 503;
      return messageResponse(status, error.message);
    }
    return messageResponse(503, "The secure browser could not be opened right now.");
  }
}
