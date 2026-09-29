import "server-only";

import Browserbase from "@browserbasehq/sdk";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { createBrowserbaseLiveViewProvider } from "./browserbase-live-view";
import {
  BROWSER_LIVE_VIEW_RELEASE,
  CandidateLiveViewError,
  issueCandidateApplicationLiveView,
  type CandidateLiveView,
  type CandidateLiveViewSessionReader,
  type ComputerSessionProviderBinding,
} from "./live-view";

type ProviderBindingRpcRow = Readonly<{
  provider_adapter: string;
  provider_session_ref: string;
}>;

function oneBinding(value: unknown): ProviderBindingRpcRow | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const candidate = row as Record<string, unknown>;
  if (
    typeof candidate.provider_adapter !== "string" ||
    typeof candidate.provider_session_ref !== "string"
  ) return null;
  return Object.freeze({
    provider_adapter: candidate.provider_adapter,
    provider_session_ref: candidate.provider_session_ref,
  });
}

export async function getCandidateApplicationLiveView(
  actor: AuthenticatedActor,
  applicationId: string,
): Promise<CandidateLiveView> {
  const candidateSupabase = await createSupabaseServerClient();
  const adminSupabase = createSupabaseAdminClient(BROWSER_LIVE_VIEW_RELEASE);
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (process.env.ROLEDAWN_BROWSERBASE_ENABLED !== "true" || !apiKey) {
    throw new CandidateLiveViewError(
      "LIVE_VIEW_PROVIDER_FAILED",
      "The secure browser is not configured yet.",
    );
  }

  const browserbase = new Browserbase({
    apiKey,
    maxRetries: 0,
    timeout: 10_000,
  });
  const browserbaseProvider = createBrowserbaseLiveViewProvider({
    async retrieveSession(providerSessionRef) {
      const session = await browserbase.sessions.retrieve(providerSessionRef);
      return Object.freeze({
        id: session.id,
        status: session.status,
        expiresAt: session.expiresAt,
      });
    },
    async debugSession(providerSessionRef) {
      const debug = await browserbase.sessions.debug(providerSessionRef);
      return Object.freeze({
        debuggerFullscreenUrl: debug.debuggerFullscreenUrl,
      });
    },
  });

  return issueCandidateApplicationLiveView(
    { authUserId: actor.userId, applicationId },
    {
      sessions: Object.freeze({
        async findOwnedLiveSession(
          input: Parameters<CandidateLiveViewSessionReader["findOwnedLiveSession"]>[0],
        ) {
          const { data: candidates, error: candidateError } = await candidateSupabase
            .from("candidates")
            .select("id")
            .eq("auth_user_id", input.authUserId)
            .in("status", ["ONBOARDING", "ACTIVE", "PAUSED"]);
          if (candidateError) throw new Error("LIVE_VIEW_CANDIDATE_SCOPE_FAILED");
          const candidateIds = candidates.map((candidate) => candidate.id);
          if (candidateIds.length === 0) return null;

          const { data: session, error: sessionError } = await candidateSupabase
            .from("computer_sessions")
            .select("id, state, expires_at")
            .eq("application_id", input.applicationId)
            .in("candidate_id", candidateIds)
            .in("state", ["ACTIVE", "PAUSED_FOR_REVIEW"])
            .gt("expires_at", input.nowIso)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (sessionError) throw new Error("LIVE_VIEW_SESSION_SCOPE_FAILED");
          if (!session) return null;
          if (session.state !== "ACTIVE" && session.state !== "PAUSED_FOR_REVIEW") {
            return null;
          }
          return Object.freeze({
            computerSessionId: session.id,
            state: session.state,
            expiresAt: session.expires_at,
          });
        },
      }),
      providerBindings: Object.freeze({
        async findActiveBinding(
          computerSessionId: string,
        ): Promise<ComputerSessionProviderBinding | null> {
          const { data, error } = await adminSupabase.rpc(
            "get_active_computer_session_provider_binding",
            { p_computer_session_id: computerSessionId },
          );
          if (error) throw new Error("LIVE_VIEW_PROVIDER_BINDING_FAILED");
          const binding = oneBinding(data);
          return binding
            ? Object.freeze({
                providerAdapter: binding.provider_adapter,
                providerSessionRef: binding.provider_session_ref,
              })
            : null;
        },
      }),
      providers: Object.freeze({ browserbase: browserbaseProvider }),
    },
  );
}
