import { createHash } from "node:crypto";

import type {
  ApplicationDraftingContext,
  ApplicationDraftingEvidenceUsage,
  ApplicationDraftingTailoringMode,
} from "../../domain/application-drafting.ts";
import type { ApplicationInputSnapshotManifest, ApplicationProfileContextManifest } from "../../domain/application-input-snapshot.ts";
import { normalizePublicJobUrl } from "../../domain/job-url.ts";

export type ApplicationDraftingContextLocator = Readonly<{
  inputSnapshotId: string;
  applicationId: string;
  preparationRunId: string;
}>;

export type ApplicationDraftingSnapshotRow = Readonly<{
  id: string;
  workspaceId: string;
  applicationId: string;
  preparationRunId: string;
  candidateId: string;
  jobId: string;
  jobVersionId: string;
  sourceDocumentId: string | null;
  sourceDocumentVersionId: string | null;
  sourceTextReviewId: string | null;
  readiness: string;
  blockers: unknown;
  tailoringMode: string;
  submissionMode: string;
  assemblerRelease: string;
  policyRelease: string;
  snapshotManifest: unknown;
  snapshotHash: string;
  createdAt: string;
}>;

export type ApplicationDraftingJobVersionRow = Readonly<{
  jobId: string;
  jobVersionId: string;
  contentSha256: string;
  employerName: string;
  title: string;
  description: string;
  location: string | null;
  employmentType: string | null;
  workMode: string | null;
  applyUrl: string;
}>;

export type ApplicationDraftingResumeReviewRow = Readonly<{
  workspaceId: string;
  candidateId: string;
  documentId: string;
  documentVersionId: string;
  textReviewId: string;
  sourceSha256: string;
  reviewedTextSha256: string;
  reviewedText: string;
}>;

export type ApplicationDraftingEvidenceVersionRow = Readonly<{
  workspaceId: string;
  candidateId: string;
  documentId: string;
  textReviewId: string;
  evidenceVersionId: string;
  claimSha256: string;
  claimText: string;
  usagePolicy: string;
  candidateDisposition: string;
  reviewStatus: string;
  reviewedAt: string | null;
}>;

/**
 * The persistence adapter must perform exact-ID lookups. It intentionally has
 * no "current" or "latest" methods, and it exposes no candidate fact values.
 */
export interface ApplicationDraftingContextReader {
  readInputSnapshot(
    locator: ApplicationDraftingContextLocator,
  ): Promise<ApplicationDraftingSnapshotRow | null>;
  readJobVersion(input: Readonly<{
    jobId: string;
    jobVersionId: string;
  }>): Promise<ApplicationDraftingJobVersionRow | null>;
  readResumeReview(input: Readonly<{
    workspaceId: string;
    candidateId: string;
    documentId: string;
    documentVersionId: string;
    textReviewId: string;
  }>): Promise<ApplicationDraftingResumeReviewRow | null>;
  readEvidenceVersions(input: Readonly<{
    workspaceId: string;
    candidateId: string;
    evidenceVersionIds: readonly string[];
  }>): Promise<readonly ApplicationDraftingEvidenceVersionRow[]>;
}

export type ApplicationDraftingContextErrorCode =
  | "DRAFTING_CONTEXT_INPUT_INVALID"
  | "DRAFTING_SNAPSHOT_NOT_FOUND"
  | "DRAFTING_SNAPSHOT_NOT_READY"
  | "DRAFTING_SNAPSHOT_PROTOCOL_INVALID"
  | "DRAFTING_SNAPSHOT_HASH_MISMATCH"
  | "DRAFTING_JOB_VERSION_NOT_FOUND"
  | "DRAFTING_JOB_VERSION_MISMATCH"
  | "DRAFTING_RESUME_REVIEW_NOT_FOUND"
  | "DRAFTING_RESUME_REVIEW_MISMATCH"
  | "DRAFTING_EVIDENCE_NOT_FOUND"
  | "DRAFTING_EVIDENCE_MISMATCH";

export class ApplicationDraftingContextError extends Error {
  readonly code: ApplicationDraftingContextErrorCode;

  constructor(code: ApplicationDraftingContextErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ApplicationDraftingContextError";
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON numbers must be finite.");
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
  throw new TypeError("Canonical JSON cannot contain functions, symbols, bigint, or undefined array members.");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return value.trim();
}

function sha256String(value: unknown, label: string): string {
  const normalized = stableString(value, label);
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hash.`);
  }
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function asTailoringMode(value: unknown): ApplicationDraftingTailoringMode {
  if (
    value !== "AS_UPLOADED" &&
    value !== "REORDER_AND_TIGHTEN" &&
    value !== "REWRITE_FROM_VERIFIED_FACTS"
  ) {
    throw new TypeError("Snapshot tailoring mode is invalid.");
  }
  return value;
}

function asEvidenceUsage(value: unknown): ApplicationDraftingEvidenceUsage {
  if (value !== "RESUME_AND_COVER_LETTER" && value !== "COVER_LETTER_ONLY") {
    throw new TypeError("Snapshot evidence usage policy is invalid.");
  }
  return value;
}

function parseApplicationInputSnapshotManifest(value: unknown): ApplicationInputSnapshotManifest {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new TypeError("Input snapshot manifest schema is invalid.");
  }
  const application = value.application;
  const job = value.job;
  const candidate = value.candidate;
  const policy = value.policy;
  if (!isRecord(application) || !isRecord(job) || !isRecord(candidate) || !isRecord(policy)) {
    throw new TypeError("Input snapshot manifest sections are invalid.");
  }
  const sourceResume = candidate.source_resume;
  if (!isRecord(sourceResume)) throw new TypeError("A reviewed source résumé is required for drafting.");
  if (!Array.isArray(candidate.narrative_evidence) || !Array.isArray(candidate.exact_facts)) {
    throw new TypeError("Input snapshot evidence references are invalid.");
  }

  const narrativeEvidence = candidate.narrative_evidence.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`Evidence reference ${index} is invalid.`);
    return {
      evidence_version_id: stableString(entry.evidence_version_id, "Evidence version ID"),
      document_id: stableString(entry.document_id, "Evidence document ID"),
      claim_sha256: sha256String(entry.claim_sha256, "Evidence claim hash"),
      usage_policy: asEvidenceUsage(entry.usage_policy),
    };
  });
  const exactFacts = candidate.exact_facts.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`Exact fact reference ${index} is invalid.`);
    return { fact_version_id: stableString(entry.fact_version_id, "Exact fact version ID") };
  });
  const evidenceIds = narrativeEvidence.map((entry) => entry.evidence_version_id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new TypeError("Input snapshot evidence references must be unique.");
  }
  const factIds = exactFacts.map((entry) => entry.fact_version_id);
  if (new Set(factIds).size !== factIds.length) {
    throw new TypeError("Input snapshot exact fact references must be unique.");
  }
  if (policy.exact_facts_allowed_in_narrative_context !== false) {
    throw new TypeError("Input snapshot policy must exclude exact facts from narrative context.");
  }
  let profileContext: ApplicationProfileContextManifest | undefined;
  if (candidate.profile_context !== undefined) {
    const context = candidate.profile_context;
    if (!isRecord(context) || !Array.isArray(context.stories)) throw new TypeError("Input snapshot profile context is invalid.");
    const optionalId = (value: unknown, label: string) => value === null ? null : stableString(value, label);
    const optionalSha = (value: unknown, label: string) => value === null ? null : sha256String(value, label);
    profileContext = {
      career_profile_version_id: optionalId(context.career_profile_version_id, "Career profile version ID"),
      career_profile_sha256: optionalSha(context.career_profile_sha256, "Career profile hash"),
      voice_profile_version_id: optionalId(context.voice_profile_version_id, "Voice profile version ID"),
      voice_profile_sha256: optionalSha(context.voice_profile_sha256, "Voice profile hash"),
      stories: context.stories.map((entry, index) => {
        if (!isRecord(entry)) throw new TypeError(`Story reference ${index} is invalid.`);
        return {
          story_version_id: stableString(entry.story_version_id, "Story version ID"),
          story_sha256: sha256String(entry.story_sha256, "Story hash"),
          usage_policy: asEvidenceUsage(entry.usage_policy),
        };
      }),
    };
  }
  if (candidate.submission_mode !== "DRAFT_ONLY" && candidate.submission_mode !== "PER_APPLICATION_APPROVAL") {
    throw new TypeError("Input snapshot submission mode is invalid.");
  }

  return {
    schema_version: 1,
    application: {
      application_id: stableString(application.application_id, "Application ID"),
      candidate_id: stableString(application.candidate_id, "Candidate ID"),
    },
    job: {
      job_id: stableString(job.job_id, "Job ID"),
      job_version_id: stableString(job.job_version_id, "Job version ID"),
      content_sha256: sha256String(job.content_sha256, "Job content hash"),
    },
    candidate: {
      application_input_version: positiveInteger(candidate.application_input_version, "Candidate input version"),
      tailoring_mode: asTailoringMode(candidate.tailoring_mode),
      submission_mode: candidate.submission_mode,
      source_resume: {
        document_id: stableString(sourceResume.document_id, "Résumé document ID"),
        document_version_id: stableString(sourceResume.document_version_id, "Résumé document version ID"),
        text_review_id: stableString(sourceResume.text_review_id, "Résumé text review ID"),
        source_sha256: sha256String(sourceResume.source_sha256, "Résumé source hash"),
        reviewed_text_sha256: sha256String(sourceResume.reviewed_text_sha256, "Reviewed résumé text hash"),
      },
      narrative_evidence: narrativeEvidence,
      exact_facts: exactFacts,
      ...(profileContext ? { profile_context: profileContext } : {}),
    },
    policy: {
      writing_policy_release: stableString(policy.writing_policy_release, "Writing policy release"),
      assembler_release: stableString(policy.assembler_release, "Assembler release"),
      exact_facts_allowed_in_narrative_context: false,
    },
  };
}

function protocolError(message: string): ApplicationDraftingContextError {
  return new ApplicationDraftingContextError("DRAFTING_SNAPSHOT_PROTOCOL_INVALID", message);
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw protocolError(message);
}

export async function loadApplicationDraftingContext(
  reader: ApplicationDraftingContextReader,
  locator: ApplicationDraftingContextLocator,
): Promise<ApplicationDraftingContext> {
  let normalizedLocator: ApplicationDraftingContextLocator;
  try {
    normalizedLocator = {
      inputSnapshotId: stableString(locator.inputSnapshotId, "Input snapshot ID"),
      applicationId: stableString(locator.applicationId, "Application ID"),
      preparationRunId: stableString(locator.preparationRunId, "Preparation run ID"),
    };
  } catch (error) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_CONTEXT_INPUT_INVALID",
      error instanceof Error ? error.message : "Drafting context locator is invalid.",
    );
  }

  const snapshot = await reader.readInputSnapshot(normalizedLocator);
  if (!snapshot) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_SNAPSHOT_NOT_FOUND",
      "The named application input snapshot does not exist.",
    );
  }
  if (
    snapshot.id !== normalizedLocator.inputSnapshotId ||
    snapshot.applicationId !== normalizedLocator.applicationId ||
    snapshot.preparationRunId !== normalizedLocator.preparationRunId
  ) {
    throw protocolError("Snapshot lookup returned a different application input.");
  }
  if (snapshot.readiness !== "READY_FOR_DRAFTING") {
    throw new ApplicationDraftingContextError(
      "DRAFTING_SNAPSHOT_NOT_READY",
      "Only a READY_FOR_DRAFTING snapshot may create narrative materials.",
    );
  }
  if (!Array.isArray(snapshot.blockers) || snapshot.blockers.length !== 0) {
    throw protocolError("A ready snapshot cannot retain preparation blockers.");
  }

  let manifest: ApplicationInputSnapshotManifest;
  try {
    manifest = parseApplicationInputSnapshotManifest(snapshot.snapshotManifest);
  } catch (error) {
    throw protocolError(error instanceof Error ? error.message : "Snapshot manifest is invalid.");
  }

  assertSame(manifest.application.application_id, snapshot.applicationId, "Snapshot application ID does not match its manifest.");
  assertSame(manifest.application.candidate_id, snapshot.candidateId, "Snapshot candidate ID does not match its manifest.");
  assertSame(manifest.job.job_id, snapshot.jobId, "Snapshot job ID does not match its manifest.");
  assertSame(manifest.job.job_version_id, snapshot.jobVersionId, "Snapshot job version does not match its manifest.");
  assertSame(manifest.candidate.tailoring_mode, snapshot.tailoringMode, "Snapshot tailoring mode does not match its manifest.");
  assertSame(manifest.candidate.submission_mode, snapshot.submissionMode, "Snapshot submission mode does not match its manifest.");
  assertSame(manifest.policy.assembler_release, snapshot.assemblerRelease, "Snapshot assembler release does not match its manifest.");
  assertSame(manifest.policy.writing_policy_release, snapshot.policyRelease, "Snapshot writing policy does not match its manifest.");

  const sourceResume = manifest.candidate.source_resume;
  if (!sourceResume) {
    throw protocolError("A ready snapshot must reference one reviewed source résumé.");
  }
  assertSame(sourceResume.document_id, snapshot.sourceDocumentId, "Snapshot résumé document does not match its manifest.");
  assertSame(sourceResume.document_version_id, snapshot.sourceDocumentVersionId, "Snapshot résumé version does not match its manifest.");
  assertSame(sourceResume.text_review_id, snapshot.sourceTextReviewId, "Snapshot résumé review does not match its manifest.");

  if (!/^[0-9a-f]{64}$/u.test(snapshot.snapshotHash)) {
    throw protocolError("Snapshot hash is not a lowercase SHA-256 hash.");
  }
  const expectedSnapshotHash = sha256Json({
    readiness: snapshot.readiness,
    blockers: snapshot.blockers,
    manifest,
  });
  if (snapshot.snapshotHash !== expectedSnapshotHash) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_SNAPSHOT_HASH_MISMATCH",
      "The immutable application input snapshot failed its integrity check.",
    );
  }

  const job = await reader.readJobVersion({
    jobId: manifest.job.job_id,
    jobVersionId: manifest.job.job_version_id,
  });
  if (!job) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_JOB_VERSION_NOT_FOUND",
      "The exact job version frozen by the snapshot is unavailable.",
    );
  }
  if (
    job.jobId !== manifest.job.job_id ||
    job.jobVersionId !== manifest.job.job_version_id ||
    job.contentSha256 !== manifest.job.content_sha256
  ) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_JOB_VERSION_MISMATCH",
      "The loaded job version does not match the immutable snapshot.",
    );
  }
  if (!job.employerName.trim() || !job.title.trim() || !job.description.trim()) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_JOB_VERSION_MISMATCH",
      "The frozen job version is missing drafting context.",
    );
  }
  const applyUrl = normalizePublicJobUrl(job.applyUrl);
  if (!applyUrl.ok) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_JOB_VERSION_MISMATCH",
      "The frozen job version has an invalid public application URL.",
    );
  }

  const resume = await reader.readResumeReview({
    workspaceId: snapshot.workspaceId,
    candidateId: snapshot.candidateId,
    documentId: sourceResume.document_id,
    documentVersionId: sourceResume.document_version_id,
    textReviewId: sourceResume.text_review_id,
  });
  if (!resume) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_RESUME_REVIEW_NOT_FOUND",
      "The exact reviewed résumé frozen by the snapshot is unavailable.",
    );
  }
  if (
    resume.workspaceId !== snapshot.workspaceId ||
    resume.candidateId !== snapshot.candidateId ||
    resume.documentId !== sourceResume.document_id ||
    resume.documentVersionId !== sourceResume.document_version_id ||
    resume.textReviewId !== sourceResume.text_review_id ||
    resume.sourceSha256 !== sourceResume.source_sha256 ||
    resume.reviewedTextSha256 !== sourceResume.reviewed_text_sha256 ||
    sha256Text(resume.reviewedText) !== sourceResume.reviewed_text_sha256
  ) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_RESUME_REVIEW_MISMATCH",
      "The loaded résumé review does not match the immutable snapshot.",
    );
  }

  const evidenceIds = manifest.candidate.narrative_evidence.map((entry) => entry.evidence_version_id);
  const evidenceRows = await reader.readEvidenceVersions({
    workspaceId: snapshot.workspaceId,
    candidateId: snapshot.candidateId,
    evidenceVersionIds: evidenceIds,
  });
  const evidenceById = new Map<string, ApplicationDraftingEvidenceVersionRow>();
  for (const evidence of evidenceRows) {
    if (!evidenceIds.includes(evidence.evidenceVersionId)) {
      throw new ApplicationDraftingContextError(
        "DRAFTING_EVIDENCE_MISMATCH",
        "The evidence loader returned a version outside the immutable snapshot.",
      );
    }
    if (evidenceById.has(evidence.evidenceVersionId)) {
      throw new ApplicationDraftingContextError(
        "DRAFTING_EVIDENCE_MISMATCH",
        "The evidence loader returned a duplicate version.",
      );
    }
    evidenceById.set(evidence.evidenceVersionId, evidence);
  }
  if (evidenceById.size < evidenceIds.length) {
    throw new ApplicationDraftingContextError(
      "DRAFTING_EVIDENCE_NOT_FOUND",
      "One or more evidence versions frozen by the snapshot are unavailable.",
    );
  }

  const narrativeEvidence = manifest.candidate.narrative_evidence.map((reference) => {
    const evidence = evidenceById.get(reference.evidence_version_id);
    if (!evidence) {
      throw new ApplicationDraftingContextError(
        "DRAFTING_EVIDENCE_NOT_FOUND",
        "A frozen evidence version is unavailable.",
      );
    }
    if (
      evidence.workspaceId !== snapshot.workspaceId ||
      evidence.candidateId !== snapshot.candidateId ||
      evidence.documentId !== reference.document_id ||
      evidence.textReviewId !== sourceResume.text_review_id ||
      evidence.claimSha256 !== reference.claim_sha256 ||
      evidence.usagePolicy !== reference.usage_policy ||
      evidence.candidateDisposition !== "APPROVED" ||
      evidence.reviewStatus !== "VERIFIED" ||
      evidence.reviewedAt === null ||
      sha256Text(evidence.claimText) !== reference.claim_sha256
    ) {
      throw new ApplicationDraftingContextError(
        "DRAFTING_EVIDENCE_MISMATCH",
        `Evidence version ${reference.evidence_version_id} does not match the immutable snapshot.`,
      );
    }
    return {
      evidenceVersionId: evidence.evidenceVersionId,
      documentId: evidence.documentId,
      claimSha256: evidence.claimSha256,
      claimText: evidence.claimText,
      usagePolicy: reference.usage_policy,
    };
  });

  return deepFreeze({
    schemaVersion: 1 as const,
    source: {
      inputSnapshotId: snapshot.id,
      snapshotHash: snapshot.snapshotHash,
      capturedAt: snapshot.createdAt,
    },
    application: {
      workspaceId: snapshot.workspaceId,
      applicationId: snapshot.applicationId,
      candidateId: snapshot.candidateId,
    },
    policy: {
      tailoringMode: manifest.candidate.tailoring_mode,
      writingPolicyRelease: manifest.policy.writing_policy_release,
      assemblerRelease: manifest.policy.assembler_release,
      exactFactsAllowedInNarrativeContext: false as const,
    },
    job: {
      jobId: job.jobId,
      jobVersionId: job.jobVersionId,
      contentSha256: job.contentSha256,
      employerName: job.employerName.trim(),
      title: job.title.trim(),
      description: job.description.trim(),
      location: job.location?.trim() || null,
      employmentType: job.employmentType?.trim() || null,
      workMode: job.workMode?.trim() || null,
      applyUrl: applyUrl.value,
    },
    sourceResume: {
      documentId: resume.documentId,
      documentVersionId: resume.documentVersionId,
      textReviewId: resume.textReviewId,
      sourceSha256: resume.sourceSha256,
      reviewedTextSha256: resume.reviewedTextSha256,
      reviewedText: resume.reviewedText,
    },
    approvedNarrativeEvidence: narrativeEvidence,
    excludedExactFactCount: manifest.candidate.exact_facts.length,
    profileContext: manifest.candidate.profile_context ?? null,
  }) as ApplicationDraftingContext;
}
