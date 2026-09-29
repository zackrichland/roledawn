import { createHash } from "node:crypto";

export const APPLICATION_INPUT_ASSEMBLER_RELEASE = "application-input-snapshot/1";
export const APPLICATION_WRITING_POLICY_RELEASE = "roledawn-writing-policy/4";

export type ApplicationInputBlockerCode =
  | "RESUME_REQUIRED"
  | "RESUME_REVIEW_REQUIRED"
  | "EVIDENCE_REVIEW_REQUIRED"
  | "CAREER_PROFILE_REQUIRED";

export type ApplicationPreparationReadiness = "BLOCKED" | "READY_FOR_DRAFTING";

export type ApplicationPreparationStage =
  | "QUEUED"
  | "FREEZING_INPUTS"
  | "INPUTS_READY"
  | "BLOCKED"
  | "RESEARCHING"
  | "DRAFTING"
  | "VALIDATING"
  | "RENDERING"
  | "COMPLETE";

export type ApplicationInputBlocker = Readonly<{
  code: ApplicationInputBlockerCode;
  title: string;
  detail: string;
  actionLabel: string;
  actionHref: "/vault" | "/vault/facts" | "/vault/experience";
}>;

export type ApplicationResumeReference = Readonly<{
  documentId: string;
  documentVersionId: string;
  textReviewId: string;
  sourceSha256: string;
  reviewedTextSha256: string;
}>;

export type ApplicationEvidenceReference = Readonly<{
  evidenceVersionId: string;
  documentId: string;
  claimSha256: string;
  usagePolicy: "RESUME_AND_COVER_LETTER" | "COVER_LETTER_ONLY";
}>;

export type ApplicationExactFactReference = Readonly<{
  factVersionId: string;
}>;

/** Career profile, stories, and voice frozen by version and content hash. */
export type ApplicationProfileContextReference = Readonly<{
  careerProfileVersionId: string | null;
  careerProfileSha256: string | null;
  voiceProfileVersionId: string | null;
  voiceProfileSha256: string | null;
  stories: readonly Readonly<{
    storyVersionId: string;
    storySha256: string;
    usagePolicy: "RESUME_AND_COVER_LETTER" | "COVER_LETTER_ONLY";
  }>[];
}>;

export type ApplicationProfileContextManifest = Readonly<{
  career_profile_version_id: string | null;
  career_profile_sha256: string | null;
  voice_profile_version_id: string | null;
  voice_profile_sha256: string | null;
  stories: readonly Readonly<{
    story_version_id: string;
    story_sha256: string;
    usage_policy: "RESUME_AND_COVER_LETTER" | "COVER_LETTER_ONLY";
  }>[];
}>;

export type ApplicationInputSnapshotBuildInput = Readonly<{
  applicationId: string;
  candidateId: string;
  candidateInputVersion: number;
  jobId: string;
  jobVersionId: string;
  jobContentSha256: string;
  tailoringMode: "AS_UPLOADED" | "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS";
  submissionMode: "DRAFT_ONLY" | "PER_APPLICATION_APPROVAL";
  resumeState: "MISSING" | "NEEDS_REVIEW" | "READY";
  resume: ApplicationResumeReference | null;
  narrativeEvidence: readonly ApplicationEvidenceReference[];
  exactFacts: readonly ApplicationExactFactReference[];
  /** Absent for snapshots assembled before profile context existed. */
  profileContext?: ApplicationProfileContextReference | null;
  /** The worker could not organize the résumé into a career profile. */
  careerProfileUnavailable?: boolean;
}>;

export type ApplicationInputSnapshotManifest = Readonly<{
  schema_version: 1;
  application: Readonly<{
    application_id: string;
    candidate_id: string;
  }>;
  job: Readonly<{
    job_id: string;
    job_version_id: string;
    content_sha256: string;
  }>;
  candidate: Readonly<{
    application_input_version: number;
    tailoring_mode: ApplicationInputSnapshotBuildInput["tailoringMode"];
    submission_mode: ApplicationInputSnapshotBuildInput["submissionMode"];
    source_resume: Readonly<{
      document_id: string;
      document_version_id: string;
      text_review_id: string;
      source_sha256: string;
      reviewed_text_sha256: string;
    }> | null;
    narrative_evidence: readonly Readonly<{
      evidence_version_id: string;
      document_id: string;
      claim_sha256: string;
      usage_policy: ApplicationEvidenceReference["usagePolicy"];
    }>[];
    exact_facts: readonly Readonly<{
      fact_version_id: string;
    }>[];
    profile_context?: ApplicationProfileContextManifest;
  }>;
  policy: Readonly<{
    writing_policy_release: string;
    assembler_release: string;
    exact_facts_allowed_in_narrative_context: false;
  }>;
}>;

export type BuiltApplicationInputSnapshot = Readonly<{
  readiness: ApplicationPreparationReadiness;
  blockers: readonly ApplicationInputBlocker[];
  manifest: ApplicationInputSnapshotManifest;
  snapshotHash: string;
  evidenceVersionIds: readonly string[];
  factVersionIds: readonly string[];
}>;

const APPLICATION_PREPARATION_STAGES = new Set<ApplicationPreparationStage>([
  "QUEUED",
  "FREEZING_INPUTS",
  "INPUTS_READY",
  "BLOCKED",
  "RESEARCHING",
  "DRAFTING",
  "VALIDATING",
  "RENDERING",
  "COMPLETE",
]);

export function isApplicationPreparationReadiness(
  value: unknown,
): value is ApplicationPreparationReadiness {
  return value === "BLOCKED" || value === "READY_FOR_DRAFTING";
}

export function isApplicationPreparationStage(value: unknown): value is ApplicationPreparationStage {
  return typeof value === "string" && APPLICATION_PREPARATION_STAGES.has(value as ApplicationPreparationStage);
}

export function parseApplicationInputBlockers(value: unknown): readonly ApplicationInputBlocker[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const blockers: ApplicationInputBlocker[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    if (
      (row.code !== "RESUME_REQUIRED" && row.code !== "RESUME_REVIEW_REQUIRED" && row.code !== "EVIDENCE_REVIEW_REQUIRED" && row.code !== "CAREER_PROFILE_REQUIRED") ||
      typeof row.title !== "string" || row.title.length === 0 || row.title.length > 160 ||
      typeof row.detail !== "string" || row.detail.length === 0 || row.detail.length > 500 ||
      typeof row.actionLabel !== "string" || row.actionLabel.length === 0 || row.actionLabel.length > 80 ||
      (row.actionHref !== "/vault" && row.actionHref !== "/vault/facts" && row.actionHref !== "/vault/experience")
    ) continue;
    blockers.push(Object.freeze({
      code: row.code,
      title: row.title,
      detail: row.detail,
      actionLabel: row.actionLabel,
      actionHref: row.actionHref,
    }));
  }
  return Object.freeze(blockers);
}

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };

function canonicalize(value: unknown): Canonical {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Snapshot numbers must be finite.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new TypeError("Snapshot values must be JSON-compatible.");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function assertStableId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function assertSha256(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 hash.`);
  return value;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function uniqueById<T>(values: readonly T[], id: (value: T) => string, label: string): readonly T[] {
  const sorted = [...values].sort((left, right) => id(left).localeCompare(id(right)));
  sorted.forEach((value, index) => {
    const current = id(value);
    if (!current || (index > 0 && current === id(sorted[index - 1]!))) {
      throw new TypeError(`${label} references must have unique stable IDs.`);
    }
  });
  return Object.freeze(sorted);
}

export function profileContextManifest(reference: ApplicationProfileContextReference): ApplicationProfileContextManifest {
  const optionalSha = (value: string | null, label: string) => value === null ? null : assertSha256(value, label);
  const stories = uniqueById(
    reference.stories.map((story) => Object.freeze({
      story_version_id: assertStableId(story.storyVersionId, "Story version ID"),
      story_sha256: assertSha256(story.storySha256, "Story hash"),
      usage_policy: story.usagePolicy,
    })),
    (story) => story.story_version_id,
    "Story",
  );
  return Object.freeze({
    career_profile_version_id: reference.careerProfileVersionId,
    career_profile_sha256: optionalSha(reference.careerProfileSha256, "Career profile hash"),
    voice_profile_version_id: reference.voiceProfileVersionId,
    voice_profile_sha256: optionalSha(reference.voiceProfileSha256, "Voice profile hash"),
    stories,
  });
}

export function buildApplicationInputSnapshot(
  input: ApplicationInputSnapshotBuildInput,
): BuiltApplicationInputSnapshot {
  const applicationId = assertStableId(input.applicationId, "Application ID");
  const candidateId = assertStableId(input.candidateId, "Candidate ID");
  const candidateInputVersion = assertPositiveInteger(
    input.candidateInputVersion,
    "Candidate input version",
  );
  const jobId = assertStableId(input.jobId, "Job ID");
  const jobVersionId = assertStableId(input.jobVersionId, "Job version ID");
  const jobContentSha256 = assertSha256(input.jobContentSha256, "Job content hash");

  const narrativeEvidence = uniqueById(
    input.narrativeEvidence.map((reference) => Object.freeze({
      evidenceVersionId: assertStableId(reference.evidenceVersionId, "Evidence version ID"),
      documentId: assertStableId(reference.documentId, "Evidence document ID"),
      claimSha256: assertSha256(reference.claimSha256, "Evidence claim hash"),
      usagePolicy: reference.usagePolicy,
    })),
    (reference) => reference.evidenceVersionId,
    "Evidence",
  );
  const exactFacts = uniqueById(
    input.exactFacts.map((reference) => Object.freeze({
      factVersionId: assertStableId(reference.factVersionId, "Fact version ID"),
    })),
    (reference) => reference.factVersionId,
    "Exact fact",
  );

  let resume: ApplicationResumeReference | null = null;
  if (input.resume) {
    resume = Object.freeze({
      documentId: assertStableId(input.resume.documentId, "Résumé document ID"),
      documentVersionId: assertStableId(input.resume.documentVersionId, "Résumé document version ID"),
      textReviewId: assertStableId(input.resume.textReviewId, "Résumé text review ID"),
      sourceSha256: assertSha256(input.resume.sourceSha256, "Résumé source hash"),
      reviewedTextSha256: assertSha256(input.resume.reviewedTextSha256, "Reviewed résumé text hash"),
    });
  }

  const blockers: ApplicationInputBlocker[] = [];
  if (input.resumeState === "MISSING") {
    blockers.push({
      code: "RESUME_REQUIRED",
      title: "Add your résumé",
      detail: "RoleDawn needs a résumé before it can prepare this application.",
      actionLabel: "Open résumé",
      actionHref: "/vault",
    });
  } else if (input.resumeState === "NEEDS_REVIEW" || !resume) {
    blockers.push({
      code: "RESUME_REVIEW_REQUIRED",
      title: "Review your résumé",
      detail: "Confirm the extracted text before RoleDawn uses it in application materials.",
      actionLabel: "Review résumé",
      actionHref: "/vault",
    });
  } else if (narrativeEvidence.length === 0 && (input.profileContext?.stories.length ?? 0) === 0) {
    blockers.push({
      code: "EVIDENCE_REVIEW_REQUIRED",
      title: "Confirm your résumé",
      detail: "Confirm that the text RoleDawn read from your résumé is accurate so it can be used in your applications.",
      actionLabel: "Confirm résumé",
      actionHref: "/vault",
    });
  } else if (input.careerProfileUnavailable) {
    blockers.push({
      code: "CAREER_PROFILE_REQUIRED",
      title: "Check your work history",
      detail: "RoleDawn could not organize your résumé into roles and dates. Check your experience so it can build an accurate résumé.",
      actionLabel: "Check experience",
      actionHref: "/vault/experience",
    });
  }

  const manifest: ApplicationInputSnapshotManifest = Object.freeze({
    schema_version: 1,
    application: Object.freeze({ application_id: applicationId, candidate_id: candidateId }),
    job: Object.freeze({
      job_id: jobId,
      job_version_id: jobVersionId,
      content_sha256: jobContentSha256,
    }),
    candidate: Object.freeze({
      application_input_version: candidateInputVersion,
      tailoring_mode: input.tailoringMode,
      submission_mode: input.submissionMode,
      source_resume: resume
        ? Object.freeze({
            document_id: resume.documentId,
            document_version_id: resume.documentVersionId,
            text_review_id: resume.textReviewId,
            source_sha256: resume.sourceSha256,
            reviewed_text_sha256: resume.reviewedTextSha256,
          })
        : null,
      narrative_evidence: Object.freeze(narrativeEvidence.map((reference) => Object.freeze({
        evidence_version_id: reference.evidenceVersionId,
        document_id: reference.documentId,
        claim_sha256: reference.claimSha256,
        usage_policy: reference.usagePolicy,
      }))),
      exact_facts: Object.freeze(exactFacts.map((reference) => Object.freeze({
        fact_version_id: reference.factVersionId,
      }))),
      ...(input.profileContext ? { profile_context: profileContextManifest(input.profileContext) } : {}),
    }),
    policy: Object.freeze({
      writing_policy_release: APPLICATION_WRITING_POLICY_RELEASE,
      assembler_release: APPLICATION_INPUT_ASSEMBLER_RELEASE,
      exact_facts_allowed_in_narrative_context: false as const,
    }),
  });

  return Object.freeze({
    readiness: blockers.length > 0 ? "BLOCKED" : "READY_FOR_DRAFTING",
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze(blocker))),
    manifest,
    snapshotHash: sha256({
      readiness: blockers.length > 0 ? "BLOCKED" : "READY_FOR_DRAFTING",
      blockers,
      manifest,
    }),
    evidenceVersionIds: Object.freeze(narrativeEvidence.map((reference) => reference.evidenceVersionId)),
    factVersionIds: Object.freeze(exactFacts.map((reference) => reference.factVersionId)),
  });
}
