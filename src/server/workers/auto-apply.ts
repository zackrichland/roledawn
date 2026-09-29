import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { AutoApplyError } from "../../domain/account-auto-apply.ts";
import { autoApplyRpc } from "../auto-apply/state.ts";
import { loadCandidateRecommendations } from "../opportunities/candidate-recommendations.ts";

type Claim = Readonly<{ candidate_id: string; workspace_id: string; consent_version: number; candidate_input_version: number; search_profile_version: number; lease_token: string }>;
type Summary = Readonly<{ claimed: number; prepared: number; delegated: number; idle: number; failed: number }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function parseAutoApplyClaim(value: unknown): Claim | null {
  if (value === null) return null;
  if (!object(value) || ![value.candidate_id, value.workspace_id, value.lease_token].every(item => typeof item === "string" && uuid.test(item))
    || ![value.consent_version, value.candidate_input_version, value.search_profile_version].every(item => Number.isSafeInteger(item) && Number(item) > 0)) {
    throw new AutoApplyError("AUTO_APPLY_CLAIM_INVALID");
  }
  return Object.freeze(value) as Claim;
}
function outcome(value: unknown): string {
  if (!object(value) || typeof value.outcome !== "string") throw new AutoApplyError("AUTO_APPLY_RESULT_INVALID");
  return value.outcome;
}
export type AutoApplyWorkerDependencies = Readonly<{
  client: unknown;
  recommendations: typeof loadCandidateRecommendations;
  workerId?: string;
}>;
/** A bounded candidate lease keeps one candidate's missing data from stalling others. */
export async function runAutoApplyWorkerWithDependencies(deps: AutoApplyWorkerDependencies): Promise<Summary> {
  const claim = parseAutoApplyClaim(await autoApplyRpc(deps.client, "claim_auto_apply_candidate", { p_worker_id: deps.workerId ?? `auto-apply/${randomUUID()}` }));
  if (!claim) return { claimed: 0, prepared: 0, delegated: 0, idle: 0, failed: 0 };
  const args = { p_candidate: claim.candidate_id, p_token: claim.lease_token, p_version: claim.consent_version };
  let completion = "CHECK_FAILED";
  try {
    completion = outcome(await autoApplyRpc(deps.client, "advance_auto_apply_candidate", args));
    if (completion === "SELECT_MATCH") {
      const ranked = await deps.recommendations(deps.client as Parameters<typeof loadCandidateRecommendations>[0], { candidateId: claim.candidate_id, workspaceId: claim.workspace_id }, { limit: 100, useCatalogCache: false, automaticSelection: true });
      if (ranked.candidateInputEpoch !== claim.candidate_input_version) throw new AutoApplyError("AUTO_APPLY_PROFILE_STALE");
      completion = ranked.complete ? "NO_MATCHES" : "RANKING_INCOMPLETE";
      if (ranked.complete) {
        for (const job of ranked.items.filter(item => item.matching.autoApplyEligible)) {
          const queued = outcome(await autoApplyRpc(deps.client, "enqueue_auto_apply_match", { ...args,
            p_job: job.jobId, p_job_version: job.jobVersionId, p_profile_hash: ranked.profileHash,
            p_policy: ranked.policyVersion, p_decision: job.matching,
          }));
          if (queued === "ALREADY_EXISTS") continue;
          if (queued !== "PREPARED") throw new AutoApplyError("AUTO_APPLY_RESULT_INVALID");
          completion = "PREPARED";
          break;
        }
      }
    }
    if (!["PREPARED", "DELEGATED", "WAITING_APPLICATION", "NO_MATCHES", "RANKING_INCOMPLETE", "RATE_LIMITED"].includes(completion)) throw new AutoApplyError("AUTO_APPLY_RESULT_INVALID");
  } catch { completion = "CHECK_FAILED"; }
  const acknowledged = await autoApplyRpc(deps.client, "finish_auto_apply_check", { p_candidate: claim.candidate_id, p_token: claim.lease_token, p_outcome: completion });
  // Consent changes invalidate the lease; never report completion for lost ownership.
  if (acknowledged !== true) return { claimed: 1, prepared: 0, delegated: 0, idle: 0, failed: 1 };
  return { claimed: 1, prepared: Number(completion === "PREPARED"), delegated: Number(completion === "DELEGATED"),
    idle: Number(!["PREPARED", "DELEGATED", "CHECK_FAILED"].includes(completion)), failed: Number(completion === "CHECK_FAILED") };
}
export async function runAutoApplyWorkerOnce(environment: NodeJS.ProcessEnv = process.env): Promise<Summary> {
  const client = createSupabaseAdminClient("account-auto-apply/1", environment);
  return runAutoApplyWorkerWithDependencies({ client, recommendations: loadCandidateRecommendations });
}
