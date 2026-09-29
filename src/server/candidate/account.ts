import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";

export function candidateFallbackLabel(actor: AuthenticatedActor): string {
  return actor.email?.split("@")[0]?.trim().slice(0, 80) || "Signed-in candidate";
}

export type CandidateAccountState = Readonly<{
  displayName: string;
  status: "ONBOARDING" | "ACTIVE" | "PAUSED";
}>;

export async function readCandidateAccountState(
  actor: AuthenticatedActor,
): Promise<CandidateAccountState | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("candidates")
    .select("display_name, status")
    .eq("auth_user_id", actor.userId)
    .in("status", ["ONBOARDING", "ACTIVE", "PAUSED"])
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "ONBOARDING" && data.status !== "ACTIVE" && data.status !== "PAUSED") return null;
  const displayName = data.display_name.trim().replace(/\s+/gu, " ").slice(0, 80) || candidateFallbackLabel(actor);
  return Object.freeze({ displayName, status: data.status });
}

/**
 * Reads the candidate-owned display label through the normal authenticated RLS
 * boundary. This label is presentation-only; exact legal identity continues to
 * live in the versioned candidate-fact ledger.
 */
export async function readCandidateDisplayName(
  actor: AuthenticatedActor,
): Promise<string> {
  return (await readCandidateAccountState(actor))?.displayName ?? candidateFallbackLabel(actor);
}
