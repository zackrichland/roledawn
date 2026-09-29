import assert from "node:assert/strict";
import test from "node:test";

import type { DraftingContextV2, EmployerResearch } from "../../domain/application-drafting-v2.ts";
import { emptyCareerProfile } from "../../domain/career-profile.ts";
import { buildEmployerResearchBundle } from "./employer-research.ts";

const context = {
  binding: {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    candidateId: "00000000-0000-4000-8000-000000000002",
    applicationId: "00000000-0000-4000-8000-000000000003",
    inputSnapshotId: "00000000-0000-4000-8000-000000000004",
    snapshotHash: "a".repeat(64),
    capturedAt: "2026-09-28T19:00:00.000Z",
    jobId: "00000000-0000-4000-8000-000000000005",
    jobVersionId: "00000000-0000-4000-8000-000000000006",
    jobContentSha256: "b".repeat(64),
    resumeReviewedTextSha256: "c".repeat(64),
  },
  job: {
    employerName: "GitLab",
    title: "Staff Forward Deployed Engineer",
    description: "Synthetic posting.",
    location: "Remote, US",
    employmentType: null,
    workMode: "REMOTE",
    applyUrl: "https://job-boards.greenhouse.io/gitlab/jobs/8512432002",
  },
  tailoringMode: "REWRITE_FROM_VERIFIED_FACTS",
  career: emptyCareerProfile(),
  careerVersionId: null,
  evidence: [],
  stories: [],
  voice: null,
  voiceVersionId: null,
  recentOpenings: [],
  targetRoles: [],
} as unknown as DraftingContextV2;

test("lists each research page once and cites the posting for facts read from it", () => {
  const research = {
    coverage: "MULTI_PRIMARY_SOURCE",
    model: "test-model",
    brief: {} as EmployerResearch["brief"],
    facts: [
      { id: "f1", kind: "COMPANY", text: "GitLab ships a DevSecOps platform.", url: "https://about.gitlab.com/company/#mission", sourceTitle: "About GitLab", published: null },
      { id: "f2", kind: "PRODUCT", text: "GitLab Duo adds AI features across the lifecycle.", url: "https://about.gitlab.com/company/", sourceTitle: "About GitLab", published: null },
      { id: "f3", kind: "COMPANY", text: "The role partners with customers on AI adoption.", url: "https://job-boards.greenhouse.io/gitlab/jobs/8512432002", sourceTitle: "Posting", published: null },
    ],
  } as unknown as EmployerResearch;
  const { manifest } = buildEmployerResearchBundle(context, research, "2026-09-28T19:05:00.000Z");
  const urls = manifest.research.sources.map((source) => source.url);
  assert.equal(new Set(urls).size, urls.length, "each page appears once");
  assert.deepEqual(urls.sort(), ["https://about.gitlab.com/company/", "https://job-boards.greenhouse.io/gitlab/jobs/8512432002"]);
  const citation = (claimId: string) => manifest.research.claims.find((claim) => claim.claim_id === claimId)?.citations[0]?.source_id;
  assert.equal(citation("f1"), citation("f2"), "facts from one page share its source");
  assert.equal(citation("f3"), "job-version:00000000-0000-4000-8000-000000000006", "a fact from the posting cites the posting");
});
