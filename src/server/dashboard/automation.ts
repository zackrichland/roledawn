import "server-only";
import { randomUUID } from "node:crypto";

import type { AuthenticatedDashboardData } from "@/domain/dashboard-queue";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { readAutoApplyState } from "@/server/auto-apply/state";
import { getCandidateOnboarding } from "@/server/candidate/onboarding";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import { loadCandidateRecommendations } from "@/server/opportunities/candidate-recommendations";

export async function readDashboardAutomation(actor: AuthenticatedActor): Promise<Pick<AuthenticatedDashboardData, "autoApply" | "searchProfile" | "preferencesCommandId" | "recommendations">> {
  const client = await createSupabaseServerClient();
  const scope = await bootstrapPersonalWorkspace(client, actor, actor.email?.split("@")[0] ?? "");
  const [automation, onboarding, recommendations] = await Promise.allSettled([
    readAutoApplyState(client),
    getCandidateOnboarding(actor),
    loadCandidateRecommendations(client, scope, { limit: 6 }),
  ]);
  return {
    preferencesCommandId: randomUUID(),
    autoApply: automation.status === "fulfilled" ? automation.value : null,
    searchProfile: onboarding.status === "fulfilled" ? onboarding.value.searchProfile : null,
    // Keep full descriptions, candidate evidence and internal diagnostics on the server.
    recommendations: recommendations.status === "fulfilled" ? {
      scannedJobs: recommendations.value.scannedJobs,
      complete: recommendations.value.complete,
      items: recommendations.value.items.map(({ jobId, jobVersionId, title, employerName, location, canonicalUrl, queuedApplicationId, matching }) =>
        ({ jobId, jobVersionId, title, employerName, location, canonicalUrl, queuedApplicationId, matching })),
    } : null,
  };
}
