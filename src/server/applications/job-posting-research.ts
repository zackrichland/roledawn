import {
  buildApplicationResearchBundle,
  type BuiltApplicationResearchBundle,
} from "../../domain/application-research.ts";
import type {
  ApplicationDraftingContext,
  ApplicationDraftingResearchClaim,
} from "../../domain/application-drafting.ts";

export const JOB_POSTING_RESEARCHER_RELEASE = "official-job-posting-research/1";
export const APPLICATION_RESEARCH_FRESHNESS_POLICY_RELEASE = "application-research-freshness/1";

const MAX_RESEARCH_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

/**
 * The first released research adapter is deliberately narrow: it converts the
 * exact, already-imported official job posting into a cited research bundle.
 * Company-web search can be added behind the same domain contract without
 * weakening the source boundary or blocking a useful no-submit kit today.
 */
export function buildOfficialJobPostingResearch(
  context: ApplicationDraftingContext,
  completedAt: string,
): BuiltApplicationResearchBundle {
  const sourceId = `job-version:${context.job.jobVersionId}`;
  const claims = [
    {
      claimId: "official-role-target",
      claimType: "COMPANY_CONTEXT" as const,
      text: `${context.job.employerName} is hiring for the ${context.job.title} role.`,
      conflictStatus: "NO_CONFLICT" as const,
      conflictNote: null,
      citations: [{
        sourceId,
        locator: "Official posting: employer and title",
        excerpt: `${context.job.employerName}\n${context.job.title}`,
      }],
    },
    ...(context.job.location
      ? [{
          claimId: "official-role-location",
          claimType: "ROLE_CONSTRAINT" as const,
          text: `The official posting lists the role location as ${context.job.location}.`,
          conflictStatus: "NO_CONFLICT" as const,
          conflictNote: null,
          citations: [{
            sourceId,
            locator: "Official posting: location",
            excerpt: context.job.location,
          }],
        }]
      : []),
  ];

  const built = buildApplicationResearchBundle({
    binding: {
      inputSnapshotId: context.source.inputSnapshotId,
      inputSnapshotHash: context.source.snapshotHash,
      applicationId: context.application.applicationId,
      jobVersionId: context.job.jobVersionId,
      jobContentSha256: context.job.contentSha256,
    },
    freshnessPolicy: {
      policyRelease: APPLICATION_RESEARCH_FRESHNESS_POLICY_RELEASE,
      maxAgeMs: MAX_RESEARCH_AGE_MS,
      maxFutureSkewMs: MAX_FUTURE_SKEW_MS,
    },
    completedAt,
    proposal: {
      schemaVersion: 1,
      researcherRelease: JOB_POSTING_RESEARCHER_RELEASE,
      sources: [{
        sourceId,
        sourceType: "JOB_POSTING",
        url: context.job.applyUrl,
        title: `${context.job.employerName} — ${context.job.title}`,
        // Postgres may return more than three fractional-second digits. Store
        // the canonical RFC 3339 millisecond form required by the immutable
        // research contract.
        retrievedAt: new Date(context.source.capturedAt).toISOString(),
      }],
      claims,
    },
  });
  if (!built.ok) {
    const firstIssue = built.error.issues[0];
    throw new Error(firstIssue?.code ?? "APPLICATION_RESEARCH_INVALID");
  }
  return built.value;
}

export function draftingClaimsFromResearchBundle(
  bundle: BuiltApplicationResearchBundle,
): readonly ApplicationDraftingResearchClaim[] {
  return bundle.manifest.research.claims
    .filter((claim) => claim.conflict_status !== "UNRESOLVED")
    .map((claim) => Object.freeze({
      researchClaimId: claim.claim_id,
      text: claim.text,
    }));
}
