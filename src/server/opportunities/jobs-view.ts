import "server-only";

import type { OpportunityCatalogItem } from "@/domain/opportunity-catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuthenticatedActor } from "@/server/auth/session";
import { bootstrapPersonalWorkspace } from "@/server/dashboard/queue";
import { loadCandidateRecommendations } from "@/server/opportunities/candidate-recommendations";

/** One row on the Jobs page, whether it came from matching or search. */
export type JobListItem = Readonly<{
  jobId: string;
  jobVersionId: string;
  title: string;
  employerName: string;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  postedAt: string;
  url: string;
  applicationId: string | null;
  saved: boolean;
  /** Plain-language reasons this job fits the candidate, when known. */
  reasons: readonly string[];
  strong: boolean;
  excerpt: string;
}>;

export type ForYouJobs = Readonly<{ items: readonly JobListItem[]; scannedJobs: number; complete: boolean }>;

const FOR_YOU_BUDGET_MS = 20_000;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= 240 ? flat : `${flat.slice(0, 237).trimEnd()}…`;
}

export function jobListItemFromCatalog(item: OpportunityCatalogItem, strong = false, reasons: readonly string[] = []): JobListItem {
  return Object.freeze({
    jobId: item.jobId,
    jobVersionId: item.jobVersionId,
    title: item.title,
    employerName: item.employerName,
    location: item.location,
    workMode: item.workMode,
    employmentType: item.employmentType,
    postedAt: item.publishedAt ?? item.observedAt,
    // The apply URL stays on the ATS host that identifies the employer's board (and its logo); the canonical URL can be an employer domain.
    url: item.applyUrl,
    applicationId: item.queuedApplicationId,
    saved: item.saved,
    // Catalog fit notes include caveats ("needs review", "outside your target
    // roles"); only a clear fit earns a reason line.
    reasons: Object.freeze([...(reasons.length ? reasons : item.fit?.decision === "ADMIT" ? item.fit.reasons : [])].slice(0, 3)),
    strong: strong || item.fit?.decision === "ADMIT",
    excerpt: excerpt(item.description),
  });
}

/** Jobs ranked against the candidate's résumé, target roles, and preferences. */
export async function loadForYouJobs(actor: AuthenticatedActor, limit = 40): Promise<ForYouJobs | null> {
  try {
    const client = await createSupabaseServerClient();
    const scope = await bootstrapPersonalWorkspace(client, actor, actor.email?.split("@")[0] ?? "");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recommendations = await Promise.race([
      loadCandidateRecommendations(client, scope, { limit }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("FOR_YOU_TIMEOUT")), FOR_YOU_BUDGET_MS); }),
    ]).finally(() => clearTimeout(timer));
    return Object.freeze({
      scannedJobs: recommendations.scannedJobs,
      complete: recommendations.complete,
      items: Object.freeze(recommendations.items.map((job) => jobListItemFromCatalog(job, job.matching.band === "STRONG", job.matching.reasons))),
    });
  } catch {
    return null;
  }
}

export type JobDetail = Readonly<{
  jobVersionId: string;
  title: string;
  employerName: string;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  description: string;
  applyUrl: string;
  postedAt: string | null;
}>;

/** Full posting text for the detail panel; RLS limits it to visible catalog jobs. */
export async function getJobDetail(jobVersionId: string): Promise<JobDetail | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("job_versions")
    .select("id, title, employer_name, location_text, work_mode, employment_type, description_text, apply_url, published_at")
    .eq("id", jobVersionId)
    .maybeSingle();
  if (error || !data) return null;
  return Object.freeze({
    jobVersionId: data.id,
    title: data.title,
    employerName: data.employer_name,
    location: data.location_text,
    workMode: data.work_mode,
    employmentType: data.employment_type,
    description: data.description_text,
    applyUrl: data.apply_url,
    postedAt: data.published_at,
  });
}
