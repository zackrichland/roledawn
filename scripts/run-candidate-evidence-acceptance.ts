import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../src/lib/supabase/database.types.ts";
import {
  type CandidateEvidenceAcceptanceConfig,
  type CandidateEvidenceCleanupIdentity,
  type CandidateEvidenceCleanupRecord,
  type CandidateEvidenceDatabase,
  type CandidateEvidenceLabel,
  type EvidenceProposalPassage,
  assertCandidateEvidenceAcceptanceEmail,
  buildEvidenceProposalPassage,
  candidateEvidenceAcceptanceEmail,
  candidateEvidenceWorkspaceName,
  createCandidateEvidenceAcceptancePassword,
  createCandidateEvidenceCleanupRecord,
  createCandidateEvidenceClient,
  requireCandidateEvidenceAcceptanceConfig,
  safeCandidateEvidenceErrorCode,
  sha256Hex,
} from "./candidate-evidence-acceptance-lib.ts";
import {
  AcceptanceFailure,
  assertRemoteOk,
  firstRpcRow,
} from "./milestone-zero-acceptance-lib.ts";

type BootstrapRow =
  Database["public"]["Functions"]["bootstrap_personal_workspace"]["Returns"][number];
type ReserveRow =
  Database["public"]["Functions"]["reserve_resume_upload"]["Returns"][number];
type ExtractionRow =
  Database["public"]["Functions"]["record_resume_extraction"]["Returns"][number];
type ReviewTextRow =
  Database["public"]["Functions"]["review_resume_text"]["Returns"][number];
type IngestRow =
  CandidateEvidenceDatabase["public"]["Functions"]["ingest_resume_evidence_proposals"]["Returns"][number];
type ReviewEvidenceRow =
  CandidateEvidenceDatabase["public"]["Functions"]["review_candidate_evidence_item"]["Returns"][number];

type Candidate = CandidateEvidenceCleanupIdentity &
  Readonly<{ client: SupabaseClient<CandidateEvidenceDatabase> }>;

type AcceptanceCheck = Readonly<{
  name: string;
  status: "PASS";
  detail: string;
}>;

type ReviewedResume = Readonly<{
  documentId: string;
  documentVersionId: string;
  textReviewId: string;
  aggregateVersion: number;
  reviewedText: string;
  storageObjectPath: string;
}>;

type SeededEvidence = Readonly<{
  passages: readonly EvidenceProposalPassage[];
  items: readonly Readonly<{
    id: string;
    primary_source_passage_id: string;
    evidence_key: string;
    evidence_category: string;
    review_status: string;
    current_version_number: number | null;
    aggregate_version: number;
  }>[];
}>;

const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");
const VAULT_BUCKET = "career-vault";
const PDF_MEDIA_TYPE = "application/pdf";
const STAGE_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 90_000;
const REVIEWED_TEXT = [
  "RoleDawn Acceptance Candidate",
  "Experience",
  "Built deterministic intake systems for regulated workflows.",
  "Achievement",
  "Reduced manual review time by 35 percent.",
].join("\n");
const EXPERIENCE_EXCERPT =
  "Built deterministic intake systems for regulated workflows.";
const ACHIEVEMENT_EXCERPT = "Reduced manual review time by 35 percent.";
const REQUIRED_CHECKPOINTS = Object.freeze([
  "two-real-candidates",
  "reviewed-resume-source",
  "deterministic-proposal-ingest",
  "command-replay",
  "two-user-isolation",
  "direct-write-denial",
  "candidate-review",
  "edit-attestation",
  "stale-write-denial",
  "immutable-history-and-citations",
] as const);

function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  failureCode: string,
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new AcceptanceFailure(failureCode));
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

async function runStage<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  process.stdout.write(`START ${name}\n`);
  return withDeadline(
    operation(),
    STAGE_TIMEOUT_MS,
    `STAGE_TIMEOUT:${name}`,
  );
}

function report(
  checks: AcceptanceCheck[],
  name: (typeof REQUIRED_CHECKPOINTS)[number],
  detail: string,
): void {
  if (checks.some((check) => check.name === name)) {
    throw new AcceptanceFailure(`DUPLICATE_CHECKPOINT:${name}`);
  }
  checks.push({ name, status: "PASS", detail });
  process.stdout.write(`PASS ${name} — ${detail}\n`);
}

function remoteErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { message?: unknown; details?: unknown };
  return [candidate.message, candidate.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function safeUnexpectedFailure(error: unknown): string {
  if (!(error instanceof Error)) return "UNEXPECTED_CANDIDATE_EVIDENCE_ACCEPTANCE_FAILURE";
  const redacted = `${error.name}:${error.message}`
    .replace(/sb_secret_[A-Za-z0-9_-]+/gu, "[REDACTED_SECRET]")
    .replace(/eyJ[A-Za-z0-9._-]+/gu, "[REDACTED_TOKEN]")
    .slice(0, 600);
  return `UNEXPECTED_CANDIDATE_EVIDENCE_ACCEPTANCE_FAILURE:${redacted}`;
}

function assertExpectedError(
  error: unknown,
  expectedCode: string | null,
  expectedMessage: string | null,
  failureCode: string,
): void {
  if (!error) {
    throw new AcceptanceFailure(`${failureCode}:MUTATION_SUCCEEDED`);
  }
  if (
    expectedCode &&
    safeCandidateEvidenceErrorCode(error) !== expectedCode
  ) {
    throw new AcceptanceFailure(
      `${failureCode}:UNEXPECTED_CODE_${safeCandidateEvidenceErrorCode(error)}`,
    );
  }
  if (expectedMessage && !remoteErrorText(error).includes(expectedMessage)) {
    throw new AcceptanceFailure(`${failureCode}:DOMAIN_ERROR_MISSING`);
  }
}

function pdfString(value: string): string {
  return value.replace(/([\\()])/g, "\\$1").replace(/\n/g, ") Tj T* (");
}

function createPdfFixture(text: string): Uint8Array {
  const content = `BT /F1 12 Tf 14 TL 72 720 Td (${pdfString(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.7\n% RoleDawn candidate evidence acceptance\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${offsets[index]!.toString().padStart(10, "0")} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "ascii"));
}

async function createCandidate(
  config: CandidateEvidenceAcceptanceConfig,
  label: CandidateEvidenceLabel,
): Promise<Candidate> {
  const admin = createCandidateEvidenceClient(config, config.secretKey);
  const email = candidateEvidenceAcceptanceEmail(config.runId, label);
  const password = createCandidateEvidenceAcceptancePassword();
  const displayName = `RoleDawn Evidence ${config.runId} ${label}`;
  const workspaceName = candidateEvidenceWorkspaceName(config.runId, label);
  assertCandidateEvidenceAcceptanceEmail(email);
  let userId: string | null = null;
  let workspaceId: string | null = null;

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        acceptance_run_id: config.runId,
      },
      app_metadata: { roledawn_acceptance_run_id: config.runId },
    });
    if (created.error || !created.data.user) {
      throw new AcceptanceFailure(
        `AUTH_USER_CREATE_FAILED_${label}:${safeCandidateEvidenceErrorCode(created.error)}`,
      );
    }
    userId = created.data.user.id;

    const client = createCandidateEvidenceClient(config, config.publishableKey);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (
      signedIn.error ||
      !signedIn.data.user ||
      !signedIn.data.session ||
      signedIn.data.user.id !== userId
    ) {
      throw new AcceptanceFailure(
        `AUTH_PASSWORD_SESSION_FAILED_${label}:${safeCandidateEvidenceErrorCode(signedIn.error)}`,
      );
    }

    const bootstrapped = await client.rpc("bootstrap_personal_workspace", {
      p_display_name: displayName,
    });
    assertRemoteOk(bootstrapped.error, `BOOTSTRAP_FAILED_${label}`);
    const row = firstRpcRow(bootstrapped.data) as BootstrapRow | null;
    if (!row || row.replayed) {
      throw new AcceptanceFailure(`BOOTSTRAP_FIRST_CALL_INVALID_${label}`);
    }
    workspaceId = row.workspace_id;

    return Object.freeze({
      label,
      userId,
      email,
      workspaceId: row.workspace_id,
      candidateId: row.candidate_id,
      workspaceName,
      client,
    });
  } catch (error) {
    if (workspaceId && userId) {
      await admin
        .from("workspaces")
        .delete()
        .eq("id", workspaceId)
        .eq("personal_owner_auth_user_id", userId);
    }
    if (userId) await admin.auth.admin.deleteUser(userId, false);
    throw error;
  }
}

async function preserveCleanupRecord(
  record: CandidateEvidenceCleanupRecord,
): Promise<string> {
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
  const target = resolve(
    ARTIFACT_DIRECTORY,
    `evidence-${record.runId}-cleanup.json`,
  );
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return target;
}

async function createReviewedResume(
  candidate: Candidate,
  admin: SupabaseClient<CandidateEvidenceDatabase>,
  fixture: Uint8Array,
  onReservedPath: (path: string) => Promise<void>,
): Promise<ReviewedResume> {
  const reserved = await candidate.client.rpc("reserve_resume_upload", {
    p_command_id: randomUUID(),
    p_display_name: "Candidate evidence acceptance resume.pdf",
    p_mime_type: PDF_MEDIA_TYPE,
    p_byte_size: fixture.byteLength,
  });
  assertRemoteOk(reserved.error, "EVIDENCE_RESUME_RESERVE_FAILED");
  const reservation = firstRpcRow(reserved.data) as ReserveRow | null;
  if (!reservation || reservation.replayed || reservation.version_number !== 1) {
    throw new AcceptanceFailure("EVIDENCE_RESUME_RESERVATION_INVALID");
  }
  await onReservedPath(reservation.storage_object_path);

  const upload = await candidate.client.storage
    .from(reservation.storage_bucket)
    .upload(reservation.storage_object_path, fixture, {
      contentType: PDF_MEDIA_TYPE,
      upsert: false,
    });
  if (upload.error || upload.data?.path !== reservation.storage_object_path) {
    throw new AcceptanceFailure(
      `EVIDENCE_RESUME_UPLOAD_FAILED:${safeCandidateEvidenceErrorCode(upload.error)}`,
    );
  }

  const finalized = await admin.rpc("finalize_resume_upload", {
    p_actor_id: candidate.userId,
    p_command_id: randomUUID(),
    p_document_version_id: reservation.document_version_id,
    p_sha256: sha256Hex(fixture),
    p_byte_size: fixture.byteLength,
  });
  assertRemoteOk(finalized.error, "EVIDENCE_RESUME_FINALIZE_FAILED");

  const extraction = await admin.rpc("record_resume_extraction", {
    p_document_version_id: reservation.document_version_id,
    p_attempt_number: 1,
    p_status: "SUCCEEDED",
    p_extractor_kind: "LOCAL_DETERMINISTIC",
    p_extractor_release: "candidate-evidence-acceptance/0.1",
    p_output_schema_version: "resume-text-artifact/v1",
    p_source_sha256: sha256Hex(fixture),
    p_extracted_text: REVIEWED_TEXT,
    p_text_sha256: sha256Hex(REVIEWED_TEXT),
    p_page_count: 1,
    p_language_code: "en",
    p_warnings: [] as Json,
    p_failure_code: null,
    p_started_at: new Date(Date.now() - 1_000).toISOString(),
  });
  assertRemoteOk(extraction.error, "EVIDENCE_RESUME_EXTRACTION_FAILED");
  const extractionRow = firstRpcRow(extraction.data) as ExtractionRow | null;
  if (
    !extractionRow ||
    extractionRow.replayed ||
    extractionRow.document_status !== "NEEDS_REVIEW"
  ) {
    throw new AcceptanceFailure("EVIDENCE_RESUME_EXTRACTION_INVALID");
  }

  const reviewed = await candidate.client.rpc("review_resume_text", {
    p_command_id: randomUUID(),
    p_document_id: extractionRow.document_id,
    p_extraction_id: extractionRow.extraction_id,
    p_expected_aggregate_version: extractionRow.aggregate_version,
    p_reviewed_text: REVIEWED_TEXT,
    p_text_sha256: sha256Hex(REVIEWED_TEXT),
  });
  assertRemoteOk(reviewed.error, "EVIDENCE_RESUME_REVIEW_FAILED");
  const review = firstRpcRow(reviewed.data) as ReviewTextRow | null;
  if (!review || review.replayed || review.document_status !== "READY") {
    throw new AcceptanceFailure("EVIDENCE_RESUME_REVIEW_INVALID");
  }

  return Object.freeze({
    documentId: review.document_id,
    documentVersionId: review.document_version_id,
    textReviewId: review.review_id,
    aggregateVersion: review.aggregate_version,
    reviewedText: REVIEWED_TEXT,
    storageObjectPath: reservation.storage_object_path,
  });
}

function createEvidencePassages(resume: ReviewedResume): readonly EvidenceProposalPassage[] {
  return Object.freeze([
    buildEvidenceProposalPassage({
      textReviewId: resume.textReviewId,
      ordinal: 0,
      category: "EXPERIENCE",
      reviewedText: resume.reviewedText,
      excerpt: EXPERIENCE_EXCERPT,
    }),
    buildEvidenceProposalPassage({
      textReviewId: resume.textReviewId,
      ordinal: 1,
      category: "ACHIEVEMENT",
      reviewedText: resume.reviewedText,
      excerpt: ACHIEVEMENT_EXCERPT,
    }),
  ]);
}

async function ingestEvidence(
  candidate: Candidate,
  resume: ReviewedResume,
): Promise<Readonly<{
  commandId: string;
  passages: readonly EvidenceProposalPassage[];
  first: IngestRow;
}>> {
  const commandId = randomUUID();
  const passages = createEvidencePassages(resume);
  const response = await candidate.client.rpc(
    "ingest_resume_evidence_proposals",
    {
      p_command_id: commandId,
      p_text_review_id: resume.textReviewId,
      p_segmenter_release: "resume-passages/1",
      p_passages: passages as unknown as Json,
    },
  );
  assertRemoteOk(response.error, "EVIDENCE_PROPOSAL_INGEST_FAILED");
  const first = firstRpcRow(response.data) as IngestRow | null;
  if (
    !first ||
    first.replayed ||
    first.proposal_count !== passages.length ||
    first.total_count !== passages.length
  ) {
    throw new AcceptanceFailure("EVIDENCE_PROPOSAL_INGEST_INVALID");
  }
  return Object.freeze({ commandId, passages, first });
}

async function verifyReplayAndDeterminism(
  candidate: Candidate,
  resume: ReviewedResume,
  seeded: Readonly<{
    commandId: string;
    passages: readonly EvidenceProposalPassage[];
  }>,
): Promise<void> {
  const args = {
    p_command_id: seeded.commandId,
    p_text_review_id: resume.textReviewId,
    p_segmenter_release: "resume-passages/1",
    p_passages: seeded.passages as unknown as Json,
  };
  const replayed = await candidate.client.rpc(
    "ingest_resume_evidence_proposals",
    args,
  );
  assertRemoteOk(replayed.error, "EVIDENCE_PROPOSAL_REPLAY_FAILED");
  const replay = firstRpcRow(replayed.data) as IngestRow | null;
  if (
    !replay?.replayed ||
    replay.proposal_count !== seeded.passages.length ||
    replay.total_count !== seeded.passages.length
  ) {
    throw new AcceptanceFailure("EVIDENCE_PROPOSAL_REPLAY_INVALID");
  }

  const reseeded = await candidate.client.rpc(
    "ingest_resume_evidence_proposals",
    { ...args, p_command_id: randomUUID() },
  );
  assertRemoteOk(reseeded.error, "EVIDENCE_PROPOSAL_RESEED_FAILED");
  const deterministic = firstRpcRow(reseeded.data) as IngestRow | null;
  if (
    !deterministic ||
    deterministic.replayed ||
    deterministic.proposal_count !== 0 ||
    deterministic.total_count !== seeded.passages.length
  ) {
    throw new AcceptanceFailure("EVIDENCE_PROPOSAL_RESEED_INVALID");
  }
}

async function readSeededEvidence(
  candidate: Candidate,
  passages: readonly EvidenceProposalPassage[],
): Promise<SeededEvidence> {
  const [passageRows, itemRows, versionRows, citationRows] = await Promise.all([
    candidate.client
      .from("source_evidence_passages")
      .select(
        "id, stable_key, ordinal, evidence_category, start_offset, end_offset, excerpt, excerpt_sha256, segmenter_release",
      )
      .eq("candidate_id", candidate.candidateId)
      .order("ordinal"),
    candidate.client
      .from("candidate_evidence_items")
      .select(
        "id, primary_source_passage_id, evidence_key, evidence_category, review_status, current_version_number, aggregate_version",
      )
      .eq("candidate_id", candidate.candidateId)
      .order("evidence_category"),
    candidate.client
      .from("candidate_evidence_versions")
      .select(
        "id, evidence_item_id, version_number, claim_text, candidate_disposition, review_kind, candidate_attested",
      )
      .eq("candidate_id", candidate.candidateId),
    candidate.client
      .from("candidate_evidence_citations")
      .select("id, evidence_version_id, passage_id")
      .eq("candidate_id", candidate.candidateId),
  ]);
  assertRemoteOk(passageRows.error, "EVIDENCE_PASSAGE_READ_FAILED");
  assertRemoteOk(itemRows.error, "EVIDENCE_ITEM_READ_FAILED");
  assertRemoteOk(versionRows.error, "EVIDENCE_VERSION_READ_FAILED");
  assertRemoteOk(citationRows.error, "EVIDENCE_CITATION_READ_FAILED");

  if (
    passageRows.data.length !== passages.length ||
    itemRows.data.length !== passages.length ||
    versionRows.data.length !== passages.length ||
    citationRows.data.length !== passages.length
  ) {
    throw new AcceptanceFailure("EVIDENCE_SEED_COUNTS_INVALID");
  }
  for (const expected of passages) {
    const passage = passageRows.data.find(
      (candidatePassage) => candidatePassage.stable_key === expected.stable_key,
    );
    if (
      !passage ||
      passage.ordinal !== expected.ordinal ||
      passage.evidence_category !== expected.category ||
      passage.start_offset !== expected.start_offset ||
      passage.end_offset !== expected.end_offset ||
      passage.excerpt !== expected.excerpt ||
      passage.excerpt_sha256 !== expected.excerpt_sha256 ||
      passage.segmenter_release !== "resume-passages/1"
    ) {
      throw new AcceptanceFailure("EVIDENCE_PASSAGE_PROVENANCE_INVALID");
    }
    const item = itemRows.data.find(
      (candidateItem) => candidateItem.evidence_key === expected.stable_key,
    );
    if (
      !item ||
      item.primary_source_passage_id !== passage.id ||
      item.review_status !== "NEEDS_REVIEW" ||
      item.current_version_number !== 1 ||
      item.aggregate_version !== 1
    ) {
      throw new AcceptanceFailure("EVIDENCE_ITEM_PROPOSAL_INVALID");
    }
    const version = versionRows.data.find(
      (candidateVersion) => candidateVersion.evidence_item_id === item.id,
    );
    if (
      !version ||
      version.version_number !== 1 ||
      version.claim_text !== expected.excerpt ||
      version.candidate_disposition !== "PROPOSED" ||
      version.review_kind !== "PROPOSAL" ||
      version.candidate_attested
    ) {
      throw new AcceptanceFailure("EVIDENCE_PROPOSAL_VERSION_INVALID");
    }
    const citation = citationRows.data.find(
      (candidateCitation) =>
        candidateCitation.evidence_version_id === version.id,
    );
    if (!citation || citation.passage_id !== passage.id) {
      throw new AcceptanceFailure("EVIDENCE_PROPOSAL_CITATION_INVALID");
    }
  }

  return Object.freeze({ passages, items: Object.freeze(itemRows.data) });
}

async function verifyTwoUserIsolation(
  alpha: Candidate,
  beta: Candidate,
  resume: ReviewedResume,
  evidence: SeededEvidence,
): Promise<void> {
  const reads = await Promise.all([
    beta.client
      .from("source_evidence_passages")
      .select("id")
      .eq("candidate_id", alpha.candidateId),
    beta.client
      .from("candidate_evidence_items")
      .select("id")
      .eq("candidate_id", alpha.candidateId),
    beta.client
      .from("candidate_evidence_versions")
      .select("id")
      .eq("candidate_id", alpha.candidateId),
    beta.client
      .from("candidate_evidence_citations")
      .select("id")
      .eq("candidate_id", alpha.candidateId),
  ]);
  for (const [index, result] of reads.entries()) {
    assertRemoteOk(result.error, `EVIDENCE_CROSS_TENANT_READ_${index}_FAILED`);
    if (result.data.length !== 0) {
      throw new AcceptanceFailure(`EVIDENCE_CROSS_TENANT_READ_${index}`);
    }
  }

  const ingest = await beta.client.rpc("ingest_resume_evidence_proposals", {
    p_command_id: randomUUID(),
    p_text_review_id: resume.textReviewId,
    p_segmenter_release: "resume-passages/1",
    p_passages: evidence.passages as unknown as Json,
  });
  assertExpectedError(
    ingest.error,
    null,
    null,
    "EVIDENCE_CROSS_TENANT_INGEST_NOT_DENIED",
  );

  const review = await beta.client.rpc("review_candidate_evidence_item", {
    p_command_id: randomUUID(),
    p_evidence_item_id: evidence.items[0]!.id,
    p_expected_aggregate_version: 1,
    p_disposition: "APPROVED",
    p_claim_text: EXPERIENCE_EXCERPT,
    p_usage_policy: "RESUME_AND_COVER_LETTER",
    p_candidate_attested: false,
  });
  assertExpectedError(
    review.error,
    null,
    null,
    "EVIDENCE_CROSS_TENANT_REVIEW_NOT_DENIED",
  );
}

async function verifyDirectWritesDenied(
  candidate: Candidate,
  resume: ReviewedResume,
  evidence: SeededEvidence,
): Promise<void> {
  const passage = await candidate.client
    .from("source_evidence_passages")
    .select("id")
    .eq("candidate_id", candidate.candidateId)
    .limit(1)
    .single();
  assertRemoteOk(passage.error, "DIRECT_WRITE_PASSAGE_READ_FAILED");

  const inserted = await candidate.client.from("source_evidence_passages").insert({
    workspace_id: candidate.workspaceId,
    candidate_id: candidate.candidateId,
    document_id: resume.documentId,
    document_version_id: resume.documentVersionId,
    text_review_id: resume.textReviewId,
    stable_key: sha256Hex("direct-write-probe"),
    ordinal: 99,
    evidence_category: "OTHER",
    start_offset: 0,
    end_offset: 1,
    excerpt: "R",
    excerpt_sha256: sha256Hex("R"),
    segmenter_release: "resume-passages/1",
  });
  assertExpectedError(
    inserted.error,
    null,
    null,
    "DIRECT_PASSAGE_INSERT_NOT_DENIED",
  );

  const itemId = evidence.items[0]!.id;
  const updated = await candidate.client
    .from("candidate_evidence_items")
    .update({ review_status: "VERIFIED" })
    .eq("id", itemId);
  assertExpectedError(
    updated.error,
    null,
    null,
    "DIRECT_ITEM_UPDATE_NOT_DENIED",
  );

  const version = await candidate.client
    .from("candidate_evidence_versions")
    .select("id")
    .eq("evidence_item_id", itemId)
    .single();
  assertRemoteOk(version.error, "DIRECT_WRITE_VERSION_READ_FAILED");
  const deletedVersion = await candidate.client
    .from("candidate_evidence_versions")
    .delete()
    .eq("id", version.data.id);
  assertExpectedError(
    deletedVersion.error,
    null,
    null,
    "DIRECT_VERSION_DELETE_NOT_DENIED",
  );

  const citation = await candidate.client
    .from("candidate_evidence_citations")
    .select("id")
    .eq("passage_id", passage.data.id)
    .single();
  assertRemoteOk(citation.error, "DIRECT_WRITE_CITATION_READ_FAILED");
  const deletedCitation = await candidate.client
    .from("candidate_evidence_citations")
    .delete()
    .eq("id", citation.data.id);
  assertExpectedError(
    deletedCitation.error,
    null,
    null,
    "DIRECT_CITATION_DELETE_NOT_DENIED",
  );
}

function evidenceItemForCategory(
  evidence: SeededEvidence,
  category: string,
): SeededEvidence["items"][number] {
  const item = evidence.items.find(
    (candidateItem) => candidateItem.evidence_category === category,
  );
  if (!item) throw new AcceptanceFailure(`EVIDENCE_ITEM_${category}_MISSING`);
  return item;
}

async function approveExactEvidence(
  candidate: Candidate,
  evidence: SeededEvidence,
): Promise<ReviewEvidenceRow> {
  const item = evidenceItemForCategory(evidence, "EXPERIENCE");
  const commandId = randomUUID();
  const args = {
    p_command_id: commandId,
    p_evidence_item_id: item.id,
    p_expected_aggregate_version: item.aggregate_version,
    p_disposition: "APPROVED",
    p_claim_text: EXPERIENCE_EXCERPT,
    p_usage_policy: "RESUME_AND_COVER_LETTER",
    p_candidate_attested: false,
  };
  const reviewed = await candidate.client.rpc(
    "review_candidate_evidence_item",
    args,
  );
  assertRemoteOk(reviewed.error, "EXACT_EVIDENCE_REVIEW_FAILED");
  const row = firstRpcRow(reviewed.data) as ReviewEvidenceRow | null;
  if (
    !row ||
    row.replayed ||
    row.evidence_version_number !== 2 ||
    row.aggregate_version !== 2
  ) {
    throw new AcceptanceFailure("EXACT_EVIDENCE_REVIEW_INVALID");
  }

  const replayed = await candidate.client.rpc(
    "review_candidate_evidence_item",
    args,
  );
  assertRemoteOk(replayed.error, "EXACT_EVIDENCE_REVIEW_REPLAY_FAILED");
  const replay = firstRpcRow(replayed.data) as ReviewEvidenceRow | null;
  if (
    !replay?.replayed ||
    replay.evidence_version_id !== row.evidence_version_id ||
    replay.aggregate_version !== row.aggregate_version
  ) {
    throw new AcceptanceFailure("EXACT_EVIDENCE_REVIEW_REPLAY_INVALID");
  }
  return row;
}

async function approveEditedEvidence(
  candidate: Candidate,
  evidence: SeededEvidence,
): Promise<ReviewEvidenceRow> {
  const item = evidenceItemForCategory(evidence, "ACHIEVEMENT");
  const editedClaim =
    "Reduced manual review time by 35 percent across the acceptance workflow.";
  const withoutAttestation = await candidate.client.rpc(
    "review_candidate_evidence_item",
    {
      p_command_id: randomUUID(),
      p_evidence_item_id: item.id,
      p_expected_aggregate_version: item.aggregate_version,
      p_disposition: "APPROVED",
      p_claim_text: editedClaim,
      p_usage_policy: "COVER_LETTER_ONLY",
      p_candidate_attested: false,
    },
  );
  assertExpectedError(
    withoutAttestation.error,
    "22023",
    "CANDIDATE_EVIDENCE_ATTESTATION_REQUIRED",
    "EDIT_WITHOUT_ATTESTATION_NOT_DENIED",
  );

  const reviewed = await candidate.client.rpc(
    "review_candidate_evidence_item",
    {
      p_command_id: randomUUID(),
      p_evidence_item_id: item.id,
      p_expected_aggregate_version: item.aggregate_version,
      p_disposition: "APPROVED",
      p_claim_text: editedClaim,
      p_usage_policy: "COVER_LETTER_ONLY",
      p_candidate_attested: true,
    },
  );
  assertRemoteOk(reviewed.error, "EDITED_EVIDENCE_REVIEW_FAILED");
  const row = firstRpcRow(reviewed.data) as ReviewEvidenceRow | null;
  if (
    !row ||
    row.replayed ||
    row.evidence_version_number !== 2 ||
    row.aggregate_version !== 2
  ) {
    throw new AcceptanceFailure("EDITED_EVIDENCE_REVIEW_INVALID");
  }

  const version = await candidate.client
    .from("candidate_evidence_versions")
    .select(
      "claim_text, usage_policy, candidate_disposition, review_kind, candidate_attested, reviewed_by",
    )
    .eq("id", row.evidence_version_id)
    .single();
  assertRemoteOk(version.error, "EDITED_EVIDENCE_VERSION_READ_FAILED");
  if (
    version.data.claim_text !== editedClaim ||
    version.data.usage_policy !== "COVER_LETTER_ONLY" ||
    version.data.candidate_disposition !== "APPROVED" ||
    version.data.review_kind !== "CANDIDATE_EDIT" ||
    !version.data.candidate_attested ||
    version.data.reviewed_by !== candidate.userId
  ) {
    throw new AcceptanceFailure("EDITED_EVIDENCE_ATTESTATION_NOT_RECORDED");
  }
  return row;
}

async function verifyStaleWriteDenied(
  candidate: Candidate,
  evidence: SeededEvidence,
): Promise<void> {
  const item = evidenceItemForCategory(evidence, "ACHIEVEMENT");
  const stale = await candidate.client.rpc("review_candidate_evidence_item", {
    p_command_id: randomUUID(),
    p_evidence_item_id: item.id,
    p_expected_aggregate_version: item.aggregate_version,
    p_disposition: "REJECTED",
    p_claim_text: ACHIEVEMENT_EXCERPT,
    p_usage_policy: "DO_NOT_USE",
    p_candidate_attested: false,
  });
  assertExpectedError(
    stale.error,
    "PT409",
    "CANDIDATE_EVIDENCE_VERSION_MISMATCH",
    "STALE_EVIDENCE_WRITE_NOT_DENIED",
  );
}

async function verifyImmutableHistoryAndCitations(
  candidate: Candidate,
  admin: SupabaseClient<CandidateEvidenceDatabase>,
  evidence: SeededEvidence,
): Promise<void> {
  const [passages, items, versions, citations] = await Promise.all([
    candidate.client
      .from("source_evidence_passages")
      .select("id, excerpt")
      .eq("candidate_id", candidate.candidateId),
    candidate.client
      .from("candidate_evidence_items")
      .select("id, primary_source_passage_id, review_status, current_version_number, aggregate_version")
      .eq("candidate_id", candidate.candidateId),
    candidate.client
      .from("candidate_evidence_versions")
      .select("id, evidence_item_id, version_number, candidate_disposition")
      .eq("candidate_id", candidate.candidateId),
    candidate.client
      .from("candidate_evidence_citations")
      .select("id, evidence_version_id, passage_id")
      .eq("candidate_id", candidate.candidateId),
  ]);
  assertRemoteOk(passages.error, "FINAL_PASSAGE_READ_FAILED");
  assertRemoteOk(items.error, "FINAL_ITEM_READ_FAILED");
  assertRemoteOk(versions.error, "FINAL_VERSION_READ_FAILED");
  assertRemoteOk(citations.error, "FINAL_CITATION_READ_FAILED");
  if (
    passages.data.length !== 2 ||
    items.data.length !== 2 ||
    versions.data.length !== 4 ||
    citations.data.length !== 4 ||
    items.data.some(
      (item) =>
        item.review_status !== "VERIFIED" ||
        item.current_version_number !== 2 ||
        item.aggregate_version !== 2,
    )
  ) {
    throw new AcceptanceFailure("FINAL_EVIDENCE_HISTORY_INVALID");
  }

  for (const version of versions.data) {
    const item = items.data.find(
      (candidateItem) => candidateItem.id === version.evidence_item_id,
    );
    if (!item) throw new AcceptanceFailure("VERSION_ITEM_LINK_MISSING");
    const citation = citations.data.find(
      (candidateCitation) =>
        candidateCitation.evidence_version_id === version.id,
    );
    if (!citation || citation.passage_id !== item.primary_source_passage_id) {
      throw new AcceptanceFailure("VERSION_SOURCE_CITATION_INVALID");
    }
  }

  const passageMutation = await admin
    .from("source_evidence_passages")
    .update({ excerpt: "tampered" })
    .eq("id", passages.data[0]!.id);
  assertExpectedError(
    passageMutation.error,
    "55000",
    "append-only",
    "SOURCE_PASSAGE_MUTATION_NOT_DENIED",
  );

  const versionMutation = await admin
    .from("candidate_evidence_versions")
    .update({ claim_text: "tampered" })
    .eq("id", versions.data[0]!.id);
  assertExpectedError(
    versionMutation.error,
    "55000",
    "append-only",
    "EVIDENCE_VERSION_MUTATION_NOT_DENIED",
  );

  const citationMutation = await admin
    .from("candidate_evidence_citations")
    .delete()
    .eq("id", citations.data[0]!.id);
  assertExpectedError(
    citationMutation.error,
    "55000",
    "append-only",
    "EVIDENCE_CITATION_MUTATION_NOT_DENIED",
  );

  const unchanged = await candidate.client
    .from("candidate_evidence_versions")
    .select("id")
    .eq("candidate_id", candidate.candidateId);
  assertRemoteOk(unchanged.error, "IMMUTABLE_HISTORY_RECHECK_FAILED");
  if (unchanged.data.length !== evidence.items.length * 2) {
    throw new AcceptanceFailure("IMMUTABLE_HISTORY_CHANGED");
  }
}

async function cleanup(
  config: CandidateEvidenceAcceptanceConfig,
  record: CandidateEvidenceCleanupRecord,
  candidates: readonly Candidate[],
): Promise<readonly string[]> {
  const admin = createCandidateEvidenceClient(config, config.secretKey);
  const errors: string[] = [];

  if (record.storageObjectPaths.length > 0) {
    const removed = await admin.storage
      .from(VAULT_BUCKET)
      .remove([...record.storageObjectPaths]);
    if (removed.error) {
      errors.push(
        `storage:REMOVE_FAILED:${safeCandidateEvidenceErrorCode(removed.error)}`,
      );
    }
  }

  for (const identity of record.identities) {
    assertCandidateEvidenceAcceptanceEmail(identity.email);
    const candidate = candidates.find(
      (entry) => entry.userId === identity.userId,
    );
    const documents = await admin
      .from("source_documents")
      .select("id, status, aggregate_version")
      .eq("workspace_id", identity.workspaceId);
    if (documents.error) {
      errors.push(
        `${identity.label}:DOCUMENT_LOOKUP_FAILED:${safeCandidateEvidenceErrorCode(documents.error)}`,
      );
      continue;
    }

    for (const document of documents.data) {
      if (document.status !== "DELETION_PENDING") {
        if (!candidate) {
          errors.push(`${identity.label}:CANDIDATE_SESSION_MISSING`);
          continue;
        }
        const requested = await candidate.client.rpc(
          "request_source_document_deletion",
          {
            p_command_id: randomUUID(),
            p_document_id: document.id,
            p_expected_aggregate_version: document.aggregate_version,
          },
        );
        if (requested.error) {
          errors.push(
            `${identity.label}:DOCUMENT_DELETE_REQUEST_FAILED:${safeCandidateEvidenceErrorCode(requested.error)}`,
          );
          continue;
        }
      }
      const completed = await admin.rpc("complete_source_document_deletion", {
        p_document_id: document.id,
      });
      if (completed.error || completed.data !== true) {
        errors.push(
          `${identity.label}:DOCUMENT_PURGE_FAILED:${safeCandidateEvidenceErrorCode(completed.error)}`,
        );
      }
    }
    if (errors.some((error) => error.startsWith(`${identity.label}:`))) {
      continue;
    }

    const remainingEvidence = await Promise.all([
      admin
        .from("source_evidence_passages")
        .select("id")
        .eq("workspace_id", identity.workspaceId),
      admin
        .from("candidate_evidence_items")
        .select("id")
        .eq("workspace_id", identity.workspaceId),
      admin
        .from("candidate_evidence_versions")
        .select("id")
        .eq("workspace_id", identity.workspaceId),
      admin
        .from("candidate_evidence_citations")
        .select("id")
        .eq("workspace_id", identity.workspaceId),
    ]);
    if (
      remainingEvidence.some(
        (result) => result.error || (result.data?.length ?? 0) !== 0,
      )
    ) {
      errors.push(`${identity.label}:EVIDENCE_PURGE_INCOMPLETE`);
      continue;
    }

    const workspace = await admin
      .from("workspaces")
      .select("id, name, kind, personal_owner_auth_user_id")
      .eq("id", identity.workspaceId)
      .maybeSingle();
    if (workspace.error) {
      errors.push(
        `${identity.label}:WORKSPACE_LOOKUP_FAILED:${safeCandidateEvidenceErrorCode(workspace.error)}`,
      );
      continue;
    }
    if (
      workspace.data &&
      (workspace.data.name !== identity.workspaceName ||
        workspace.data.kind !== "PERSONAL" ||
        workspace.data.personal_owner_auth_user_id !== identity.userId)
    ) {
      errors.push(`${identity.label}:WORKSPACE_IDENTITY_MISMATCH`);
      continue;
    }
    if (workspace.data) {
      const removedWorkspace = await admin
        .from("workspaces")
        .delete()
        .eq("id", identity.workspaceId)
        .eq("personal_owner_auth_user_id", identity.userId);
      if (removedWorkspace.error) {
        errors.push(
          `${identity.label}:WORKSPACE_DELETE_FAILED:${safeCandidateEvidenceErrorCode(removedWorkspace.error)}`,
        );
        continue;
      }
    }

    if (candidate) {
      const signedOut = await candidate.client.auth.signOut({ scope: "global" });
      if (signedOut.error) {
        errors.push(
          `${identity.label}:AUTH_SIGN_OUT_FAILED:${safeCandidateEvidenceErrorCode(signedOut.error)}`,
        );
        continue;
      }
    }

    const fetched = await admin.auth.admin.getUserById(identity.userId);
    if (
      !fetched.error &&
      fetched.data.user.email?.toLowerCase() !== identity.email.toLowerCase()
    ) {
      errors.push(`${identity.label}:AUTH_USER_EMAIL_MISMATCH`);
      continue;
    }
    if (!fetched.error) {
      const deleted = await admin.auth.admin.deleteUser(identity.userId, false);
      if (deleted.error) {
        errors.push(
          `${identity.label}:AUTH_USER_DELETE_FAILED:${safeCandidateEvidenceErrorCode(deleted.error)}`,
        );
      }
    } else if (safeCandidateEvidenceErrorCode(fetched.error) !== "user_not_found") {
      errors.push(
        `${identity.label}:AUTH_USER_LOOKUP_FAILED:${safeCandidateEvidenceErrorCode(fetched.error)}`,
      );
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const config = requireCandidateEvidenceAcceptanceConfig();
  const checks: AcceptanceCheck[] = [];
  const candidates: Candidate[] = [];
  const storageObjectPaths = new Set<string>();
  let record: CandidateEvidenceCleanupRecord | null = null;
  let cleanupArtifact: string | null = null;
  let runFailure: string | null = null;
  let cleanupStatus: "NOT_NEEDED" | "KEPT" | "PASS" | "FAIL" =
    "NOT_NEEDED";

  const persistRecoveryRecord = async (): Promise<void> => {
    if (candidates.length === 0) return;
    record = createCandidateEvidenceCleanupRecord(
      config,
      candidates,
      [...storageObjectPaths],
    );
    cleanupArtifact = await preserveCleanupRecord(record);
  };

  process.stdout.write(
    `RoleDawn candidate evidence hosted acceptance\nproject=${config.expectedProjectRef}\nrun=${config.runId}\n`,
  );

  try {
    const admin = createCandidateEvidenceClient(config, config.secretKey);
    const { alpha, beta } = await runStage("two-real-candidates", async () => {
      const alphaCandidate = await createCandidate(config, "alpha");
      candidates.push(alphaCandidate);
      await persistRecoveryRecord();
      const betaCandidate = await createCandidate(config, "beta");
      candidates.push(betaCandidate);
      await persistRecoveryRecord();
      return { alpha: alphaCandidate, beta: betaCandidate };
    });
    report(
      checks,
      "two-real-candidates",
      "two temporary ordinary candidate sessions own separate personal workspaces",
    );

    const fixture = createPdfFixture(REVIEWED_TEXT);
    if (sha256Hex(fixture) !== sha256Hex(createPdfFixture(REVIEWED_TEXT))) {
      throw new AcceptanceFailure("EVIDENCE_PDF_FIXTURE_NOT_DETERMINISTIC");
    }
    const resume = await runStage("reviewed-resume-source", async () => {
      return createReviewedResume(alpha, admin, fixture, async (path) => {
        storageObjectPaths.add(path);
        await persistRecoveryRecord();
      });
    });
    report(
      checks,
      "reviewed-resume-source",
      "candidate evidence is anchored to one hash-checked, candidate-reviewed résumé text",
    );

    const ingested = await runStage("deterministic-proposal-ingest", () =>
      ingestEvidence(alpha, resume),
    );
    const evidence = await readSeededEvidence(alpha, ingested.passages);
    report(
      checks,
      "deterministic-proposal-ingest",
      "deterministic locators create two source-cited proposals with exact hashes",
    );

    await runStage("command-replay", () =>
      verifyReplayAndDeterminism(alpha, resume, ingested),
    );
    report(
      checks,
      "command-replay",
      "same-command replay is stable and a new command cannot duplicate deterministic evidence",
    );

    await runStage("two-user-isolation", () =>
      verifyTwoUserIsolation(alpha, beta, resume, evidence),
    );
    report(
      checks,
      "two-user-isolation",
      "the second candidate reads no evidence and cannot invoke commands against it",
    );

    await runStage("direct-write-denial", () =>
      verifyDirectWritesDenied(alpha, resume, evidence),
    );
    report(
      checks,
      "direct-write-denial",
      "ordinary candidates can read evidence but cannot write its tables directly",
    );

    await runStage("candidate-review", () =>
      approveExactEvidence(alpha, evidence),
    );
    report(
      checks,
      "candidate-review",
      "an exact-source approval appends a replay-safe verified version",
    );

    await runStage("edit-attestation", () =>
      approveEditedEvidence(alpha, evidence),
    );
    report(
      checks,
      "edit-attestation",
      "edited claims fail without attestation and preserve the candidate's attested edit",
    );

    await runStage("stale-write-denial", () =>
      verifyStaleWriteDenied(alpha, evidence),
    );
    report(
      checks,
      "stale-write-denial",
      "an outdated aggregate version is rejected with PT409",
    );

    await runStage("immutable-history-and-citations", () =>
      verifyImmutableHistoryAndCitations(alpha, admin, evidence),
    );
    report(
      checks,
      "immutable-history-and-citations",
      "proposal and review history retain one immutable source citation per version",
    );

    const actual = new Set(checks.map((check) => check.name));
    const missing = REQUIRED_CHECKPOINTS.filter((name) => !actual.has(name));
    if (missing.length > 0 || checks.length !== REQUIRED_CHECKPOINTS.length) {
      throw new AcceptanceFailure(`INCOMPLETE_CHECKPOINTS:${missing.join(",")}`);
    }
  } catch (error) {
    runFailure =
      error instanceof AcceptanceFailure
        ? error.message
        : safeUnexpectedFailure(error);
    process.stderr.write(`FAIL ${runFailure}\n`);
  } finally {
    if (record && !config.keepArtifacts) {
      try {
        process.stdout.write("START cleanup\n");
        const cleanupErrors = await withDeadline(
          cleanup(config, record, candidates),
          CLEANUP_TIMEOUT_MS,
          "CLEANUP_TIMEOUT",
        );
        if (cleanupErrors.length === 0) {
          cleanupStatus = "PASS";
          process.stdout.write(
            "PASS cleanup — candidate evidence, source documents, workspaces, Storage objects, and Auth users removed\n",
          );
        } else {
          cleanupStatus = "FAIL";
          process.stderr.write(
            `FAIL cleanup incomplete; use ${cleanupArtifact}\n${cleanupErrors.join("\n")}\n`,
          );
        }
      } catch (error) {
        cleanupStatus = "FAIL";
        const message =
          error instanceof AcceptanceFailure
            ? error.message
            : "UNKNOWN_CLEANUP_FAILURE";
        process.stderr.write(
          `FAIL cleanup:${message}; use ${cleanupArtifact ?? "local cleanup record"}\n`,
        );
      }
    } else if (record) {
      cleanupStatus = "KEPT";
      process.stdout.write(
        `KEEP acceptance artifacts; cleanup record: ${cleanupArtifact}\n`,
      );
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        runId: config.runId,
        projectRef: config.expectedProjectRef,
        status:
          !runFailure && cleanupStatus !== "FAIL" ? "PASS" : "FAIL",
        cleanup: cleanupStatus,
        checks,
      },
      null,
      2,
    )}\n`,
  );
  if (runFailure || cleanupStatus === "FAIL") {
    throw new AcceptanceFailure(
      runFailure ?? "CANDIDATE_EVIDENCE_ACCEPTANCE_CLEANUP_FAILED",
    );
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof AcceptanceFailure)) {
    process.stderr.write(
      "FAIL UNEXPECTED_CANDIDATE_EVIDENCE_ACCEPTANCE_FAILURE\n",
    );
  }
  process.exitCode = 1;
}
