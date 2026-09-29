import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  attachCatalogItemFit,
  candidateFitProfile,
  type CatalogFitCandidateInput,
  type CatalogFitJobVersionRow,
  type CatalogFitSearchProfileRow,
} from "@/domain/opportunity-fit-adapter";
import type { OpportunityCatalogItem } from "@/domain/opportunity-catalog";
import type { Database } from "@/lib/supabase/database.types";
import type { AuthenticatedActor } from "@/server/auth/session";
import { getCandidateProfile } from "@/server/vault/candidate-profile";

const CANDIDATE_STATUSES = ["ONBOARDING", "ACTIVE", "PAUSED"];

export async function attachCatalogFitAssessments(
  supabase: SupabaseClient<Database>,
  actor: AuthenticatedActor,
  items: readonly OpportunityCatalogItem[],
): Promise<readonly OpportunityCatalogItem[]> {
  if (items.length === 0) return Object.freeze([]);
  const { data: candidates, error: candidateError } = await supabase
    .from("candidates")
    .select("id, created_at")
    .eq("auth_user_id", actor.userId)
    .in("status", CANDIDATE_STATUSES)
    .limit(2);
  if (candidateError || candidates.length !== 1) throw new Error("CATALOG_FIT_CANDIDATE_READ_FAILED");
  const candidate = candidates[0];

  const [profileResult, jobVersionsResult, profileFacts] = await Promise.all([
    supabase
      .from("candidate_search_profiles")
      .select("candidate_id, aggregate_version, target_roles, preferred_locations, desired_country_codes, work_modes, employment_types, updated_at")
      .eq("candidate_id", candidate.id)
      .maybeSingle(),
    supabase
      .from("job_versions")
      .select("id, job_id, version_number, title, description_text, location_text, work_mode, employment_type, observed_at")
      .in("id", [...new Set(items.map((item) => item.jobVersionId))]),
    getCandidateProfile(actor),
  ]);
  if (profileResult.error || jobVersionsResult.error) throw new Error("CATALOG_FIT_INPUT_READ_FAILED");

  const searchProfile: CatalogFitSearchProfileRow | null = profileResult.data
    ? Object.freeze({
        candidateId: profileResult.data.candidate_id,
        aggregateVersion: profileResult.data.aggregate_version,
        targetRoles: Object.freeze(profileResult.data.target_roles),
        preferredLocations: Object.freeze(profileResult.data.preferred_locations),
        desiredCountryCodes: Object.freeze(profileResult.data.desired_country_codes),
        workModes: Object.freeze(profileResult.data.work_modes),
        employmentTypes: Object.freeze(profileResult.data.employment_types),
        updatedAt: profileResult.data.updated_at,
      })
    : null;
  const candidateInput: CatalogFitCandidateInput = Object.freeze({
    candidateId: candidate.id,
    candidateCreatedAt: candidate.created_at,
    searchProfile,
    facts: profileFacts.facts.filter((fact) => fact.key.startsWith("work_authorization.")),
  });
  const fitCandidate = candidateFitProfile(candidateInput);
  const versionRows = new Map(jobVersionsResult.data.map((row) => [row.id, Object.freeze({
    id: row.id,
    jobId: row.job_id,
    versionNumber: row.version_number,
    title: row.title,
    descriptionText: row.description_text,
    locationText: row.location_text,
    workMode: row.work_mode,
    employmentType: row.employment_type,
    observedAt: row.observed_at,
  }) satisfies CatalogFitJobVersionRow] as const));
  const evaluatedAt = new Date().toISOString();

  return Object.freeze(items.map((item) => {
    const row = versionRows.get(item.jobVersionId);
    if (!row) throw new Error("CATALOG_FIT_JOB_VERSION_READ_FAILED");
    return attachCatalogItemFit(item, fitCandidate, row, evaluatedAt);
  }));
}
