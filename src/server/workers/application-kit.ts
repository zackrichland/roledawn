import { StructuredResponseError } from "../ai/structured-response.ts";
import { errorDetail, recordWorkerEvent } from "./worker-events.ts";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  APPLICATION_DRAFTING_RELEASE,
  APPLICATION_WRITING_POLICY_RELEASE_V4,
  assembleCoverLetterModel,
  assembleResumeModel,
  buildDraftingSources,
  coverLetterPlainText,
  resumePlainText,
} from "../../domain/application-drafting-v2.ts";
import { buildApplicationKitManifestV4 } from "../../domain/application-kit.ts";
import { validateApplicationResearchBundle } from "../../domain/application-research.ts";
import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import type { Database, Json } from "../../lib/supabase/database.types.ts";
import { renderApplicationDocuments } from "../applications/application-documents-render.ts";
import { loadApplicationKitExactFacts } from "../applications/application-kit-facts.ts";
import { verifyApplicationDraft, writeApplicationDraft } from "../applications/application-writer.ts";
import { ApplicationWritingError, generateApplicationWriting } from "../applications/application-writing-pipeline.ts";
import { DraftingContextV2Error, loadDraftingContextV2 } from "../applications/drafting-context-v2.ts";
import { buildEmployerResearchBundle, RESEARCH_FRESHNESS_POLICY_RELEASE, researchEmployer } from "../applications/employer-research.ts";
import { lintApplicationStyle, withResumeAsWritten } from "../applications/style-lint.ts";
import { decideOutboxFailureDisposition } from "./outbox-retry-policy.ts";
import { runSendIntentSweep } from "./send-intents.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ARTIFACT_BUCKET = "application-artifacts";

type DraftingPayload = Readonly<{
  applicationId: string;
  preparationRunId: string;
  inputSnapshotId: string;
  snapshotHash: string;
}>;

type OutboxMessage = Readonly<{
  outbox_id: string;
  payload: Json;
  attempt_count: number;
}>;

type UntypedRpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}>;

function asUntyped(client: unknown): UntypedRpcClient {
  return client as UntypedRpcClient;
}

export function parseApplicationDraftingPayload(value: Json): DraftingPayload | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const record = value as Record<string, Json | undefined>;
  const applicationId = record.application_id;
  const preparationRunId = record.preparation_run_id;
  const inputSnapshotId = record.input_snapshot_id;
  const snapshotHash = record.snapshot_hash;
  if (
    typeof applicationId !== "string" || !UUID_PATTERN.test(applicationId) ||
    typeof preparationRunId !== "string" || !UUID_PATTERN.test(preparationRunId) ||
    typeof inputSnapshotId !== "string" || !UUID_PATTERN.test(inputSnapshotId) ||
    typeof snapshotHash !== "string" || !SHA256_PATTERN.test(snapshotHash)
  ) return null;
  return { applicationId, preparationRunId, inputSnapshotId, snapshotHash };
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function stageArtifact(
  supabase: SupabaseClient<Database>,
  input: Readonly<{
    path: string;
    bytes: Uint8Array;
    mimeType: string;
    sha256: string;
  }>,
): Promise<void> {
  const uploaded = await supabase.storage.from(ARTIFACT_BUCKET).upload(input.path, input.bytes, {
    cacheControl: "31536000",
    contentType: input.mimeType,
    upsert: false,
  });
  if (!uploaded.error) return;

  // A prior attempt may have committed the immutable object but lost its
  // response. Reuse it only after comparing the exact bytes; never overwrite.
  const existing = await supabase.storage.from(ARTIFACT_BUCKET).download(input.path);
  if (existing.error) throw new Error("APPLICATION_ARTIFACT_STAGE_FAILED");
  const bytes = new Uint8Array(await existing.data.arrayBuffer());
  if (hashBytes(bytes) !== input.sha256) {
    throw new Error("APPLICATION_ARTIFACT_STAGE_HASH_CONFLICT");
  }
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") return null;
  return value[0] as Record<string, unknown>;
}

export async function handleApplicationDraftingRequested(
  supabase: SupabaseClient<Database>,
  message: Readonly<{ outboxId: string; payload: Json }>,
  workerId: string,
  options: Readonly<{ environment?: NodeJS.ProcessEnv }> = {},
): Promise<Readonly<{ revisionId: string; replayed: boolean }>> {
  const environment = options.environment ?? process.env;
  const payload = parseApplicationDraftingPayload(message.payload);
  if (!payload) throw new Error("DRAFTING_OUTBOX_PAYLOAD_INVALID");
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");

  const context = await loadDraftingContextV2(supabase, {
    inputSnapshotId: payload.inputSnapshotId,
    applicationId: payload.applicationId,
    preparationRunId: payload.preparationRunId,
  });
  if (context.binding.snapshotHash !== payload.snapshotHash) throw new Error("DRAFTING_OUTBOX_SNAPSHOT_HASH_MISMATCH");

  // 1. Research the employer (web, with a posting-only fallback).
  const research = await researchEmployer(context, { apiKey, environment });
  const completedAt = new Date().toISOString();
  const bundle = buildEmployerResearchBundle(context, research, completedAt);
  const researchValidation = validateApplicationResearchBundle(bundle, {
    inputSnapshotId: context.binding.inputSnapshotId,
    inputSnapshotHash: context.binding.snapshotHash,
    applicationId: context.binding.applicationId,
    jobVersionId: context.binding.jobVersionId,
    jobContentSha256: context.binding.jobContentSha256,
  }, RESEARCH_FRESHNESS_POLICY_RELEASE, completedAt);
  if (!researchValidation.valid || !researchValidation.fresh) throw new Error("APPLICATION_RESEARCH_VALIDATION_FAILED");

  // 2. Write, check, and repair.
  const sources = buildDraftingSources(context, research);
  const writing = await generateApplicationWriting(
    { context, research, sources, policyRelease: APPLICATION_WRITING_POLICY_RELEASE_V4 },
    {
      write: ({ revision }) => writeApplicationDraft({ context, research, sources, revision, apiKey, environment }),
      verify: (segments) => verifyApplicationDraft({ segments, sources, apiKey, environment }),
      lintStyle: lintApplicationStyle,
      onAttempt: async (attempt) => {
        await recordWorkerEvent(supabase as never, { lane: "kit", stage: "writing-check", outcome: "INFO",
          applicationId: payload.applicationId, detail: {
            attempt: attempt.attempt, outcome: attempt.outcome,
            deterministicCodes: attempt.deterministicCodes, styleCodes: attempt.styleCodes,
            unsupportedSegments: attempt.unsupportedSegments.length, coverLetterWords: attempt.coverLetterWords,
          } });
      },
    },
  );
  if (!writing.quality.readyForCandidateReview) {
    const failure = writing.quality.issues.find((issue) => issue.severity === "BLOCKING")?.code ?? "APPLICATION_WRITING_QUALITY_BLOCKED";
    throw new ApplicationWritingError(failure, false, writing.attempts);
  }
  const proposal = context.tailoringMode === "AS_UPLOADED"
    ? withResumeAsWritten(context, writing.proposal, sources)
    : writing.proposal;

  // 3. Assemble and render the exact documents, then check the bytes.
  const exactFacts = await loadApplicationKitExactFacts(supabase, {
    workspaceId: context.binding.workspaceId,
    candidateId: context.binding.candidateId,
    applicationId: context.binding.applicationId,
    inputSnapshotId: context.binding.inputSnapshotId,
  });
  const facts = exactFacts.document;
  if (!facts?.legalName) throw new Error("APPLICATION_KIT_NAME_REQUIRED");
  const resumeModel = assembleResumeModel(context, proposal, facts);
  const letterModel = assembleCoverLetterModel(context, proposal, facts, new Date(completedAt));
  const artifacts = await renderApplicationDocuments({ resume: resumeModel, coverLetter: letterModel, employerName: context.job.employerName });
  const resumeText = resumePlainText(resumeModel);
  const coverLetterText = coverLetterPlainText(letterModel);

  const kit = buildApplicationKitManifestV4({
    binding: {
      applicationId: context.binding.applicationId,
      candidateId: context.binding.candidateId,
      jobId: context.binding.jobId,
      jobVersionId: context.binding.jobVersionId,
      jobContentSha256: context.binding.jobContentSha256,
      inputSnapshotId: context.binding.inputSnapshotId,
      inputSnapshotHash: context.binding.snapshotHash,
      researchBundleHash: bundle.bundleHash,
    },
    drafting: {
      release: APPLICATION_DRAFTING_RELEASE,
      proposal,
      writerModel: writing.writer.model,
      writerRequestId: writing.writer.requestId,
      writingPolicyRelease: APPLICATION_WRITING_POLICY_RELEASE_V4,
      writingPolicy: writing.writer.policy,
      attempts: writing.attempts,
      researchBrief: research.brief,
      researchFacts: research.facts,
      profileContext: {
        careerProfileVersionId: context.careerVersionId,
        voiceProfileVersionId: context.voiceVersionId,
        storyVersionIds: context.stories.map((story) => story.storyVersionId),
      },
    },
    validation: { quality: writing.quality, verification: writing.verification },
    documents: { resume: resumeModel, coverLetter: letterModel, answers: proposal.answers, resumeText, coverLetterText },
    exactFactVersionIds: exactFacts.factVersionIds,
    artifacts,
    tailoringMode: context.tailoringMode,
    sourceReviewedTextSha256: context.binding.resumeReviewedTextSha256,
  });

  const prefix = `${context.binding.workspaceId}/${context.binding.candidateId}/${context.binding.applicationId}/${kit.packetHash}`;
  const persistedArtifacts = artifacts.map((artifact) => Object.freeze({
    kind: artifact.kind,
    variant: artifact.variant,
    display_name: artifact.displayName,
    storage_bucket: ARTIFACT_BUCKET,
    storage_object_path: `${prefix}/${artifact.variant.toLocaleLowerCase("en-US")}.${artifact.mimeType === "application/pdf" ? "pdf" : "docx"}`,
    mime_type: artifact.mimeType,
    byte_size: artifact.byteSize,
    sha256: artifact.sha256,
    renderer_release: artifact.rendererRelease,
    qa_status: artifact.qaStatus,
    bytes: artifact.bytes,
  }));
  for (const artifact of persistedArtifacts) {
    await stageArtifact(supabase, { path: artifact.storage_object_path, bytes: artifact.bytes, mimeType: artifact.mime_type, sha256: artifact.sha256 });
  }

  const committed = await asUntyped(supabase).rpc("commit_application_kit", {
    p_outbox_id: message.outboxId,
    p_worker_id: workerId,
    p_application_id: context.binding.applicationId,
    p_preparation_run_id: payload.preparationRunId,
    p_input_snapshot_id: context.binding.inputSnapshotId,
    p_input_snapshot_hash: context.binding.snapshotHash,
    p_research_manifest: bundle.manifest,
    p_research_hash: bundle.bundleHash,
    p_researcher_release: bundle.researcherRelease,
    p_freshness_policy_release: bundle.freshnessPolicyRelease,
    p_freshness_expires_at: bundle.freshnessExpiresAt,
    p_revision_manifest: kit.manifest,
    p_material_diff: kit.materialDiff,
    p_packet_hash: kit.packetHash,
    p_evidence_refs: context.evidence.map((evidence) => ({
      evidence_version_id: evidence.evidenceVersionId,
      document_id: evidence.documentId,
      evidence_hash: evidence.claimSha256,
    })),
    p_fact_version_ids: [...exactFacts.factVersionIds],
    p_artifacts: persistedArtifacts.map((artifact) => ({
      kind: artifact.kind,
      variant: artifact.variant,
      display_name: artifact.display_name,
      storage_bucket: artifact.storage_bucket,
      storage_object_path: artifact.storage_object_path,
      mime_type: artifact.mime_type,
      byte_size: artifact.byte_size,
      sha256: artifact.sha256,
      renderer_release: artifact.renderer_release,
      qa_status: artifact.qa_status,
    })),
  });
  if (committed.error) {
    const code = committed.error.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? committed.error.code;
    throw new Error(code ?? "APPLICATION_KIT_COMMIT_FAILED");
  }
  const row = firstRow(committed.data);
  if (!row || typeof row.revision_id !== "string" || typeof row.replayed !== "boolean") {
    throw new Error("APPLICATION_KIT_COMMIT_PROTOCOL_INVALID");
  }
  return Object.freeze({ revisionId: row.revision_id, replayed: row.replayed });
}

/** Redacted, SQL-validated history for a terminal drafting failure. */
export function terminalAttemptHistory(error: unknown): Readonly<Record<string, unknown>> {
  const attempts = error instanceof ApplicationWritingError ? error.attempts : [];
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/u.test(error.message) ? error.message : "APPLICATION_DRAFTING_FAILED";
  return Object.freeze({
    release: "application-drafting-repair/2",
    attempts: attempts.slice(0, 3).map((attempt, index) => ({
      attempt: index + 1,
      outcome: attempt.outcome,
      deterministicCodes: attempt.deterministicCodes.filter((entry) => /^[A-Z][A-Z0-9_]{2,63}$/u.test(entry)).slice(0, 40),
      styleCodes: attempt.styleCodes.filter((entry) => /^[A-Z][A-Z0-9_]{2,63}$/u.test(entry)).slice(0, 40),
      unsupportedSegments: attempt.unsupportedSegments.length,
      coverLetterWords: Math.min(99_999, attempt.coverLetterWords),
    })),
    failure: code,
  });
}

function firstBoolean(value: unknown): boolean {
  if (Array.isArray(value)) return value[0] === true;
  return value === true;
}

export function decideApplicationKitFailureDisposition(attemptCount: number, error: unknown) {
  const errorCode = error instanceof Error && /^[A-Z][A-Z0-9_]{3,99}(?::ATTEMPTS_[0-2])?$/u.test(error.message)
    ? error.message : "WORKER_UNEXPECTED_FAILURE";
  const permanent = (error instanceof StructuredResponseError && !error.retryable)
    || (error instanceof ApplicationWritingError && !error.retryable)
    || (error instanceof DraftingContextV2Error && !error.retryable)
    || errorCode.startsWith("DRAFTING_") || errorCode === "APPLICATION_KIT_NAME_REQUIRED";
  return permanent
    ? { action: "DEAD_LETTER" as const, errorCode }
    : decideOutboxFailureDisposition(attemptCount, errorCode);
}

export async function runApplicationKitWorkerOnce(environment: NodeJS.ProcessEnv = process.env): Promise<Readonly<{
  claimed: number;
  completed: number;
  failed: number;
}>> {
  const supabase = createSupabaseAdminClient("application-kit-worker/0.1", environment);
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 120);
  const { data, error } = await supabase.rpc("claim_outbox_batch", {
    p_worker_id: workerId,
    p_limit: 1,
    p_lease_seconds: 900,
    p_topics: ["application.drafting_requested"],
  });
  if (error) throw new Error("OUTBOX_CLAIM_FAILED");

  const messages = (data ?? []) as OutboxMessage[];
  let completed = 0;
  let failed = 0;
  for (const message of messages) {
    try {
      const committed = await handleApplicationDraftingRequested(
        supabase,
        { outboxId: message.outbox_id, payload: message.payload },
        workerId,
        { environment },
      );
      // If the candidate already pressed Apply, send as soon as files are ready.
      const payload = parseApplicationDraftingPayload(message.payload);
      if (payload && !committed.replayed) {
        await runSendIntentSweep(environment, payload.applicationId).catch(() => undefined);
      }
      // commit_application_kit publishes the outbox row in the same transaction
      // as the revision. A separate ack would weaken that boundary.
      completed += 1;
    } catch (error) {
      const disposition = decideApplicationKitFailureDisposition(message.attempt_count, error);
      const payload = parseApplicationDraftingPayload(message.payload);
      await recordWorkerEvent(supabase as never, { lane: "kit", stage: "kit", outcome: "FAILED", code: disposition.errorCode,
        detail: { ...errorDetail(error), attempt: String(message.attempt_count), action: disposition.action }, applicationId: payload?.applicationId ?? null });
      const { data: released, error: releaseError } = disposition.action === "DEAD_LETTER"
        ? payload ? await asUntyped(supabase).rpc("fail_application_drafting_terminal", {
            p_outbox_id: message.outbox_id, p_worker_id: workerId, p_application_id: payload.applicationId,
            p_preparation_run_id: payload.preparationRunId, p_input_snapshot_id: payload.inputSnapshotId,
            p_error_code: disposition.errorCode,
            p_attempt_history: terminalAttemptHistory(error),
          }) : await supabase.rpc("dead_letter_outbox_message", {
            p_worker_id: workerId,
            p_outbox_id: message.outbox_id,
            p_error_code: disposition.errorCode,
          })
        : await supabase.rpc("fail_outbox_message", {
            p_worker_id: workerId,
            p_outbox_id: message.outbox_id,
            p_error_code: disposition.errorCode,
            p_retry_after_seconds: disposition.retryAfterSeconds,
          });
      if (releaseError || !firstBoolean(released)) {
        const databaseCode = releaseError && typeof releaseError.code === "string" && /^[0-9A-Z]{5}$/u.test(releaseError.code)
          ? releaseError.code : "UNKNOWN";
        await recordWorkerEvent(supabase as never, { lane: "kit", stage: "failure-release", outcome: "FAILED",
          code: "OUTBOX_FAILURE_RELEASE_FAILED", applicationId: payload?.applicationId ?? null,
          detail: { databaseCode, originalCode: disposition.errorCode } });
        throw new Error("OUTBOX_FAILURE_RELEASE_FAILED", { cause: error });
      }
      failed += 1;
    }
  }
  return Object.freeze({ claimed: messages.length, completed, failed });
}
