import { createHash } from "node:crypto";

import type { ApplicationSemanticValidationReport } from "./application-entailment.ts";
import type {
  ApplicationDraftingContext,
  ApplicationDraftingProposal,
  ApplicationDraftingValidationReport,
  ApplicationDraftingAttemptHistory,
} from "./application-drafting.ts";
import type { ApplicationQualityReport } from "./application-quality.ts";
import type { BuiltApplicationResearchBundle } from "./application-research.ts";
import type { ApplicationWritingPolicyProvenance } from "./application-writing-policy.ts";
export const APPLICATION_KIT_MANIFEST_RELEASE = "application-kit/3";

export type ApplicationArtifactVariant =
  | "RESUME_PDF"
  | "RESUME_DOCX"
  | "COVER_LETTER_PDF"
  | "COVER_LETTER_DOCX"
  | "APPLICATION_PDF";

type ApplicationKitArtifactMetadata = Readonly<{
  kind: "RESUME" | "COVER_LETTER" | "OTHER";
  variant: ApplicationArtifactVariant;
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  rendererRelease: string;
  qaStatus: "PASSED";
}>;

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };

function canonicalize(value: unknown): Canonical {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Application kit manifest numbers must be finite.");
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
  throw new TypeError("Application kit manifest values must be JSON-compatible.");
}

export function hashApplicationKitValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export type ApplicationKitManifest = Readonly<{
  schema_version: 1;
  release: typeof APPLICATION_KIT_MANIFEST_RELEASE;
  authority: Readonly<{
    state: "CANDIDATE_REVIEW_REQUIRED";
    application_submitted: false;
  }>;
  binding: Readonly<{
    application_id: string;
    candidate_id: string;
    job_id: string;
    job_version_id: string;
    job_content_sha256: string;
    input_snapshot_id: string;
    input_snapshot_hash: string;
    research_bundle_hash: string;
  }>;
  drafting: Readonly<{
    proposal: ApplicationDraftingProposal;
    adapter_release: string;
    model_release: string;
    request_id: string | null;
    writing_policy_release: string;
    writing_policy: ApplicationWritingPolicyProvenance;
    repair?: ApplicationDraftingAttemptHistory;
  }>;
  validation: Readonly<{
    deterministic: ApplicationDraftingValidationReport;
    semantic: ApplicationSemanticValidationReport;
    quality: ApplicationQualityReport;
    entailment_adapter_release: string;
    entailment_model_release: string;
    entailment_request_id: string | null;
  }>;
  exact_fact_version_ids: readonly string[];
  artifacts: readonly Readonly<{
    variant: ApplicationArtifactVariant;
    kind: "RESUME" | "COVER_LETTER" | "OTHER";
    display_name: string;
    mime_type: string;
    byte_size: number;
    sha256: string;
    renderer_release: string;
    qa_status: "PASSED";
  }>[];
}>;

export function buildApplicationKitManifest(input: Readonly<{
  context: ApplicationDraftingContext;
  research: BuiltApplicationResearchBundle;
  proposal: ApplicationDraftingProposal;
  draftingExecution: Readonly<{
    adapterRelease: string;
    modelRelease: string;
    requestId: string | null;
    writingPolicy?: ApplicationWritingPolicyProvenance;
  }>;
  draftingAttempts?: ApplicationDraftingAttemptHistory;
  deterministicValidation: ApplicationDraftingValidationReport;
  semanticValidation: ApplicationSemanticValidationReport;
  qualityValidation: ApplicationQualityReport;
  entailmentExecution: Readonly<{
    adapterRelease: string;
    modelRelease: string;
    requestId: string | null;
  }>;
  exactFactVersionIds: readonly string[];
  artifacts: readonly ApplicationKitArtifactMetadata[];
}>): Readonly<{
  manifest: ApplicationKitManifest;
  packetHash: string;
  materialDiff: Readonly<Record<string, unknown>>;
}> {
  if (!input.deterministicValidation.deterministicChecksPassed) {
    throw new Error("APPLICATION_KIT_DETERMINISTIC_VALIDATION_FAILED");
  }
  if (!input.semanticValidation.semanticChecksPassed) {
    throw new Error("APPLICATION_KIT_SEMANTIC_VALIDATION_FAILED");
  }
  if (!input.qualityValidation.readyForCandidateReview) {
    throw new Error("APPLICATION_KIT_QUALITY_VALIDATION_FAILED");
  }
  const variants = input.artifacts.map((artifact) => artifact.variant).sort();
  const required = ["APPLICATION_PDF", "COVER_LETTER_DOCX", "COVER_LETTER_PDF", "RESUME_DOCX", "RESUME_PDF"];
  if (JSON.stringify(variants) !== JSON.stringify(required)) {
    throw new Error("APPLICATION_KIT_ARTIFACT_SET_INVALID");
  }
  if (!input.draftingExecution.writingPolicy || !/^[0-9a-f]{64}$/u.test(input.draftingExecution.writingPolicy.sha256)) {
    throw new Error("APPLICATION_KIT_WRITING_POLICY_PROVENANCE_REQUIRED");
  }

  const manifest: ApplicationKitManifest = Object.freeze({
    schema_version: 1 as const,
    release: APPLICATION_KIT_MANIFEST_RELEASE,
    authority: Object.freeze({
      state: "CANDIDATE_REVIEW_REQUIRED" as const,
      application_submitted: false as const,
    }),
    binding: Object.freeze({
      application_id: input.context.application.applicationId,
      candidate_id: input.context.application.candidateId,
      job_id: input.context.job.jobId,
      job_version_id: input.context.job.jobVersionId,
      job_content_sha256: input.context.job.contentSha256,
      input_snapshot_id: input.context.source.inputSnapshotId,
      input_snapshot_hash: input.context.source.snapshotHash,
      research_bundle_hash: input.research.bundleHash,
    }),
    drafting: Object.freeze({
      proposal: input.proposal,
      adapter_release: input.draftingExecution.adapterRelease,
      model_release: input.draftingExecution.modelRelease,
      request_id: input.draftingExecution.requestId,
      writing_policy_release: input.context.policy.writingPolicyRelease,
      writing_policy: input.draftingExecution.writingPolicy,
      ...(input.draftingAttempts ? { repair: input.draftingAttempts } : {}),
    }),
    validation: Object.freeze({
      deterministic: input.deterministicValidation,
      semantic: input.semanticValidation,
      quality: input.qualityValidation,
      entailment_adapter_release: input.entailmentExecution.adapterRelease,
      entailment_model_release: input.entailmentExecution.modelRelease,
      entailment_request_id: input.entailmentExecution.requestId,
    }),
    exact_fact_version_ids: Object.freeze([...input.exactFactVersionIds].sort()),
    artifacts: Object.freeze(input.artifacts
      .map((artifact) => Object.freeze({
        variant: artifact.variant,
        kind: artifact.kind,
        display_name: artifact.displayName,
        mime_type: artifact.mimeType,
        byte_size: artifact.byteSize,
        sha256: artifact.sha256,
        renderer_release: artifact.rendererRelease,
        qa_status: artifact.qaStatus,
      }))
      .sort((left, right) => left.variant.localeCompare(right.variant))),
  });
  const materialDiff = Object.freeze({
    resume: Object.freeze({
      mode: input.proposal.resume.mode,
      source_reviewed_text_sha256: input.context.sourceResume.reviewedTextSha256,
      generated_text_sha256: input.proposal.resume.text === null
        ? input.context.sourceResume.reviewedTextSha256
        : hashApplicationKitValue(input.proposal.resume.text),
    }),
    cover_letter: Object.freeze({
      kind: "CREATED",
      paragraph_count: input.proposal.coverLetter.paragraphs.length,
      content_sha256: hashApplicationKitValue(input.proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text)),
    }),
  });
  return Object.freeze({
    manifest,
    packetHash: hashApplicationKitValue(manifest),
    materialDiff,
  });
}

// ---------------------------------------------------------------------------
// application-kit/4: per-segment sources, research brief, stories, and the
// exact document models that were rendered.
// ---------------------------------------------------------------------------
export const APPLICATION_KIT_MANIFEST_RELEASE_V4 = "application-kit/4";

export type ApplicationKitManifestV4Input = Readonly<{
  binding: Readonly<{
    applicationId: string;
    candidateId: string;
    jobId: string;
    jobVersionId: string;
    jobContentSha256: string;
    inputSnapshotId: string;
    inputSnapshotHash: string;
    researchBundleHash: string;
  }>;
  drafting: Readonly<{
    release: string;
    proposal: unknown;
    writerModel: string;
    writerRequestId: string | null;
    writingPolicyRelease: string;
    writingPolicy: ApplicationWritingPolicyProvenance;
    attempts: unknown;
    researchBrief: unknown;
    researchFacts: unknown;
    profileContext: Readonly<{ careerProfileVersionId: string | null; voiceProfileVersionId: string | null; storyVersionIds: readonly string[] }>;
  }>;
  validation: Readonly<{
    quality: Readonly<{ readyForCandidateReview: boolean; status: string } & Record<string, unknown>>;
    verification: unknown;
  }>;
  documents: Readonly<{ resume: unknown; coverLetter: unknown; answers: unknown; resumeText: string; coverLetterText: string }>;
  exactFactVersionIds: readonly string[];
  artifacts: readonly ApplicationKitArtifactMetadata[];
  tailoringMode: string;
  sourceReviewedTextSha256: string;
}>;

export function buildApplicationKitManifestV4(input: ApplicationKitManifestV4Input): Readonly<{
  manifest: Readonly<Record<string, unknown>>;
  packetHash: string;
  materialDiff: Readonly<Record<string, unknown>>;
}> {
  if (!input.validation.quality.readyForCandidateReview) throw new Error("APPLICATION_KIT_QUALITY_VALIDATION_FAILED");
  const variants = input.artifacts.map((artifact) => artifact.variant).sort();
  if (JSON.stringify(variants) !== JSON.stringify(["APPLICATION_PDF", "COVER_LETTER_DOCX", "COVER_LETTER_PDF", "RESUME_DOCX", "RESUME_PDF"])) {
    throw new Error("APPLICATION_KIT_ARTIFACT_SET_INVALID");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.drafting.writingPolicy.sha256)) throw new Error("APPLICATION_KIT_WRITING_POLICY_PROVENANCE_REQUIRED");
  const manifest = Object.freeze({
    schema_version: 1 as const,
    release: APPLICATION_KIT_MANIFEST_RELEASE_V4,
    authority: Object.freeze({ state: "CANDIDATE_REVIEW_REQUIRED" as const, application_submitted: false as const }),
    binding: Object.freeze({
      application_id: input.binding.applicationId,
      candidate_id: input.binding.candidateId,
      job_id: input.binding.jobId,
      job_version_id: input.binding.jobVersionId,
      job_content_sha256: input.binding.jobContentSha256,
      input_snapshot_id: input.binding.inputSnapshotId,
      input_snapshot_hash: input.binding.inputSnapshotHash,
      research_bundle_hash: input.binding.researchBundleHash,
    }),
    drafting: Object.freeze({
      release: input.drafting.release,
      proposal: input.drafting.proposal,
      adapter_release: "roledawn-writer/1",
      model_release: input.drafting.writerModel,
      request_id: input.drafting.writerRequestId,
      writing_policy_release: input.drafting.writingPolicyRelease,
      writing_policy: input.drafting.writingPolicy,
      attempts: input.drafting.attempts,
      research_brief: input.drafting.researchBrief,
      research_facts: input.drafting.researchFacts,
      profile_context: Object.freeze({
        career_profile_version_id: input.drafting.profileContext.careerProfileVersionId,
        voice_profile_version_id: input.drafting.profileContext.voiceProfileVersionId,
        story_version_ids: Object.freeze([...input.drafting.profileContext.storyVersionIds].sort()),
      }),
    }),
    validation: Object.freeze({
      quality: input.validation.quality,
      verification: input.validation.verification,
    }),
    documents: Object.freeze({
      resume: input.documents.resume,
      cover_letter: input.documents.coverLetter,
      answers: input.documents.answers,
    }),
    exact_fact_version_ids: Object.freeze([...input.exactFactVersionIds].sort()),
    artifacts: Object.freeze(input.artifacts.map((artifact) => Object.freeze({
      variant: artifact.variant,
      kind: artifact.kind,
      display_name: artifact.displayName,
      mime_type: artifact.mimeType,
      byte_size: artifact.byteSize,
      sha256: artifact.sha256,
      renderer_release: artifact.rendererRelease,
      qa_status: artifact.qaStatus,
    })).sort((left, right) => left.variant.localeCompare(right.variant))),
  });
  const materialDiff = Object.freeze({
    resume: Object.freeze({
      mode: input.tailoringMode,
      source_reviewed_text_sha256: input.sourceReviewedTextSha256,
      generated_text_sha256: hashApplicationKitValue(input.documents.resumeText),
    }),
    cover_letter: Object.freeze({
      kind: "CREATED",
      paragraph_count: (input.documents.coverLetter as { paragraphs?: unknown[] } | null)?.paragraphs?.length ?? 0,
      content_sha256: hashApplicationKitValue(input.documents.coverLetterText),
    }),
  });
  return Object.freeze({ manifest, packetHash: hashApplicationKitValue(manifest), materialDiff });
}
