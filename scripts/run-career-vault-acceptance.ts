import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";
import {
  extractResumeText,
  PDF_MEDIA_TYPE,
} from "../src/server/resume/extract-resume.ts";
import {
  AcceptanceFailure,
  assertRemoteOk,
  createAcceptancePassword,
  createAcceptanceRunId,
  firstRpcRow,
  safeErrorCode,
} from "./milestone-zero-acceptance-lib.ts";

const ACCEPTANCE_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_CREATES_TEST_DATA";
const ACCEPTANCE_EMAIL_PREFIX = "roledawn-vault-acceptance-";
const ACCEPTANCE_EMAIL_DOMAIN = "acceptance.invalid";
const EXPECTED_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");
const VAULT_BUCKET = "career-vault";
const WORKSPACE_NAME_PREFIX = "RoleDawn Vault ";
const OUTPUT_SCHEMA_VERSION = "resume-text-artifact/v1";
const REQUEST_TIMEOUT_MS = 20_000;
const STAGE_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 90_000;
const REQUIRED_CHECKPOINTS = Object.freeze([
  "two-real-auth-users",
  "exact-upload-reservation",
  "cross-tenant-denial-before-upload",
  "ordinary-upload-finalize",
  "cross-tenant-denial-after-upload",
  "service-extraction",
  "candidate-review",
  "optimistic-lock",
  "failed-replacement-safety",
  "complete-tenant-isolation",
  "deletion-pending-reserve-denial",
  "deletion-lifecycle",
] as const);
const SECRET_PLACEHOLDERS = new Set([
  "your-server-only-supabase-secret-key",
  "your-supabase-secret-key",
]);

type ReserveRow = Readonly<{
  document_id: string;
  document_version_id: string;
  storage_bucket: string;
  storage_object_path: string;
  version_number: number;
  replayed: boolean;
}>;

type FinalizeRow = Readonly<{
  document_id: string;
  document_version_id: string;
  document_status: string;
  scan_status: string;
  replayed: boolean;
}>;

type ExtractionRow = Readonly<{
  document_id: string;
  document_version_id: string;
  extraction_id: string;
  document_status: string;
  aggregate_version: number;
  replayed: boolean;
}>;

type ReviewRow = Readonly<{
  document_id: string;
  document_version_id: string;
  extraction_id: string;
  review_id: string;
  review_version_number: number;
  document_status: string;
  aggregate_version: number;
  replayed: boolean;
}>;

type DeletionRequestRow = Readonly<{
  document_id: string;
  document_status: string;
  aggregate_version: number;
  replayed: boolean;
}>;

type VaultDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Omit<Database["public"]["Functions"], "record_resume_extraction"> & {
      reserve_resume_upload: {
        Args: {
          p_command_id: string;
          p_display_name: string;
          p_mime_type: string;
          p_byte_size: number;
        };
        Returns: ReserveRow[];
      };
      finalize_resume_upload: {
        Args: {
          p_actor_id: string;
          p_command_id: string;
          p_document_version_id: string;
          p_sha256: string;
          p_byte_size: number;
        };
        Returns: FinalizeRow[];
      };
      record_resume_extraction: {
        Args: {
          p_document_version_id: string;
          p_attempt_number: number;
          p_status: string;
          p_extractor_kind: string;
          p_extractor_release: string;
          p_output_schema_version: string;
          p_source_sha256: string;
          p_extracted_text: string | null;
          p_text_sha256: string | null;
          p_page_count: number | null;
          p_language_code: string | null;
          p_warnings: Database["public"]["Tables"]["domain_events"]["Row"]["payload"];
          p_failure_code: string | null;
          p_started_at: string;
        };
        Returns: ExtractionRow[];
      };
      review_resume_text: {
        Args: {
          p_command_id: string;
          p_document_id: string;
          p_extraction_id: string;
          p_expected_aggregate_version: number;
          p_reviewed_text: string;
          p_text_sha256: string;
        };
        Returns: ReviewRow[];
      };
      request_source_document_deletion: {
        Args: {
          p_command_id: string;
          p_document_id: string;
          p_expected_aggregate_version: number;
        };
        Returns: DeletionRequestRow[];
      };
      complete_source_document_deletion: {
        Args: { p_document_id: string };
        Returns: boolean;
      };
    };
  };
};

type VaultConfig = Readonly<{
  url: string;
  publishableKey: string;
  secretKey: string;
  expectedProjectRef: string;
  runId: string;
  keepArtifacts: boolean;
}>;

type CandidateLabel = "alpha" | "beta";

type VaultCandidate = Readonly<{
  label: CandidateLabel;
  email: string;
  password: string;
  userId: string;
  workspaceId: string;
  candidateId: string;
  client: SupabaseClient<VaultDatabase>;
}>;

type CleanupIdentity = Readonly<{
  label: CandidateLabel;
  userId: string;
  email: string;
  workspaceId: string;
}>;

type VaultCleanupRecord = Readonly<{
  runId: string;
  projectRef: string;
  createdAt: string;
  identities: readonly CleanupIdentity[];
  storageObjectPaths: readonly string[];
}>;

type AcceptanceCheck = Readonly<{
  name: string;
  status: "PASS";
  detail: string;
}>;

type ReviewedText = Readonly<{
  row: ReviewRow;
  reviewedText: string;
  reviewedTextSha256: string;
}>;

function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  failureCode: string,
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new AcceptanceFailure(failureCode));
    }, timeoutMs);
    // Deliberately keep this timer referenced. A pending promise alone does not
    // keep Node alive; the acceptance runner must fail rather than disappear.
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

const nativeFetch = globalThis.fetch.bind(globalThis);

function fetchWithDeadline(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("HOSTED_REQUEST_TIMEOUT"));
  }, REQUEST_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  return nativeFetch(input, { ...init, signal }).finally(() => {
    clearTimeout(timer);
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
  name: string,
  detail: string,
): void {
  if (checks.some((check) => check.name === name)) {
    throw new AcceptanceFailure(`DUPLICATE_CHECKPOINT:${name}`);
  }
  checks.push({ name, status: "PASS", detail });
  process.stdout.write(`PASS ${name} — ${detail}\n`);
}

function requireVaultConfig(
  environment: NodeJS.ProcessEnv = process.env,
): VaultConfig {
  if (
    environment.RUN_HOSTED_CAREER_VAULT_ACCEPTANCE !==
    ACCEPTANCE_ACKNOWLEDGEMENT
  ) {
    throw new AcceptanceFailure(
      `REFUSING_TO_RUN: set RUN_HOSTED_CAREER_VAULT_ACCEPTANCE=${ACCEPTANCE_ACKNOWLEDGEMENT}`,
    );
  }

  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey =
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim() ?? "";
  const expectedProjectRef =
    environment.ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase() ??
    "";

  if (!url || !publishableKey || !secretKey) {
    throw new AcceptanceFailure(
      "SUPABASE_ACCEPTANCE_CONFIG_REQUIRED: public URL, publishable key, and server-only secret are required",
    );
  }
  if (SECRET_PLACEHOLDERS.has(secretKey)) {
    throw new AcceptanceFailure("SUPABASE_SECRET_KEY_IS_PLACEHOLDER");
  }
  if (!EXPECTED_PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    throw new AcceptanceFailure(
      "ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF_REQUIRED: use the exact hosted project ref",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AcceptanceFailure("SUPABASE_URL_INVALID");
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== `${expectedProjectRef}.supabase.co`
  ) {
    throw new AcceptanceFailure(
      "SUPABASE_PROJECT_MISMATCH: URL does not match ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF",
    );
  }

  return Object.freeze({
    url: parsedUrl.toString().replace(/\/$/, ""),
    publishableKey,
    secretKey,
    expectedProjectRef,
    runId: createAcceptanceRunId(environment.ACCEPTANCE_RUN_ID),
    keepArtifacts: environment.ACCEPTANCE_KEEP_ARTIFACTS === "true",
  });
}

function createVaultClient(config: VaultConfig, key: string) {
  return createClient<VaultDatabase>(config.url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    db: { retry: false, timeout: REQUEST_TIMEOUT_MS },
    global: {
      fetch: fetchWithDeadline,
      headers: { "x-roledawn-runtime": "career-vault-acceptance/0.1" },
    },
  });
}

function acceptanceEmail(runId: string, label: CandidateLabel): string {
  return `${ACCEPTANCE_EMAIL_PREFIX}${runId}-${label}@${ACCEPTANCE_EMAIL_DOMAIN}`;
}

function assertVaultAcceptanceEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (
    !normalized.startsWith(ACCEPTANCE_EMAIL_PREFIX) ||
    !normalized.endsWith(`@${ACCEPTANCE_EMAIL_DOMAIN}`)
  ) {
    throw new AcceptanceFailure(
      "CLEANUP_REFUSED: identity is not a RoleDawn Career Vault acceptance user",
    );
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
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

  let body = "%PDF-1.7\n% RoleDawn deterministic acceptance fixture\n";
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
  config: VaultConfig,
  label: CandidateLabel,
): Promise<VaultCandidate> {
  const admin = createVaultClient(config, config.secretKey);
  const email = acceptanceEmail(config.runId, label);
  const password = createAcceptancePassword();
  const displayName = `${WORKSPACE_NAME_PREFIX}${config.runId} ${label}`;
  assertVaultAcceptanceEmail(email);
  let createdUserId: string | null = null;

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
        `AUTH_USER_CREATE_FAILED_${label}:${safeErrorCode(created.error)}`,
      );
    }
    createdUserId = created.data.user.id;

    const client = createVaultClient(config, config.publishableKey);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (
      signedIn.error ||
      !signedIn.data.user ||
      !signedIn.data.session ||
      signedIn.data.user.id !== createdUserId
    ) {
      throw new AcceptanceFailure(
        `AUTH_PASSWORD_SESSION_FAILED_${label}:${safeErrorCode(signedIn.error)}`,
      );
    }

    const bootstrapped = await client.rpc("bootstrap_personal_workspace", {
      p_display_name: displayName,
    });
    assertRemoteOk(bootstrapped.error, `BOOTSTRAP_FAILED_${label}`);
    const row = firstRpcRow(bootstrapped.data);
    if (!row || row.replayed) {
      throw new AcceptanceFailure(`BOOTSTRAP_FIRST_CALL_INVALID_${label}`);
    }

    return Object.freeze({
      label,
      email,
      password,
      userId: createdUserId,
      workspaceId: row.workspace_id,
      candidateId: row.candidate_id,
      client,
    });
  } catch (error) {
    if (createdUserId) {
      const workspace = await admin
        .from("workspaces")
        .select("id")
        .eq("personal_owner_auth_user_id", createdUserId)
        .maybeSingle();
      if (!workspace.error && workspace.data) {
        await admin
          .from("workspaces")
          .delete()
          .eq("id", workspace.data.id)
          .eq("personal_owner_auth_user_id", createdUserId);
      }
      await admin.auth.admin.deleteUser(createdUserId, false);
    }
    throw error;
  }
}

function createCleanupRecord(
  config: VaultConfig,
  candidates: readonly VaultCandidate[],
  storageObjectPaths: ReadonlySet<string>,
): VaultCleanupRecord {
  return Object.freeze({
    runId: config.runId,
    projectRef: config.expectedProjectRef,
    createdAt: new Date().toISOString(),
    identities: Object.freeze(
      candidates.map((candidate) =>
        Object.freeze({
          label: candidate.label,
          userId: candidate.userId,
          email: candidate.email,
          workspaceId: candidate.workspaceId,
        }),
      ),
    ),
    storageObjectPaths: Object.freeze([...storageObjectPaths]),
  });
}

async function preserveCleanupRecord(
  record: VaultCleanupRecord,
): Promise<string> {
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
  const target = resolve(
    ARTIFACT_DIRECTORY,
    `vault-${record.runId}-cleanup.json`,
  );
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return target;
}

async function reserveExactPdf(
  candidate: VaultCandidate,
  byteSize: number,
): Promise<ReserveRow> {
  const commandId = randomUUID();
  const args = {
    p_command_id: commandId,
    p_display_name: "Acceptance resume.pdf",
    p_mime_type: PDF_MEDIA_TYPE,
    p_byte_size: byteSize,
  };
  const first = await candidate.client.rpc("reserve_resume_upload", args);
  assertRemoteOk(first.error, "RESUME_RESERVE_FAILED");
  const row = firstRpcRow(first.data);
  if (!row || row.replayed || row.storage_bucket !== VAULT_BUCKET) {
    throw new AcceptanceFailure("RESUME_RESERVE_FIRST_CALL_INVALID");
  }

  const expectedPath =
    `${candidate.workspaceId}/${candidate.candidateId}/resumes/` +
    `${row.document_id}/${row.document_version_id}.pdf`;
  if (row.storage_object_path !== expectedPath) {
    throw new AcceptanceFailure("RESUME_RESERVE_PATH_NOT_EXACT");
  }

  const replay = await candidate.client.rpc("reserve_resume_upload", args);
  assertRemoteOk(replay.error, "RESUME_RESERVE_REPLAY_FAILED");
  const replayRow = firstRpcRow(replay.data);
  if (
    !replayRow?.replayed ||
    replayRow.document_id !== row.document_id ||
    replayRow.document_version_id !== row.document_version_id ||
    replayRow.storage_object_path !== row.storage_object_path ||
    replayRow.version_number !== row.version_number
  ) {
    throw new AcceptanceFailure("RESUME_RESERVE_REPLAY_INVALID");
  }
  return row;
}

async function expectNoRows(
  result: Readonly<{ data: readonly unknown[] | null; error: unknown }>,
  failureCode: string,
): Promise<void> {
  assertRemoteOk(result.error, `${failureCode}_QUERY_FAILED`);
  if (!result.data || result.data.length !== 0) {
    throw new AcceptanceFailure(failureCode);
  }
}

async function verifyCrossTenantReads(
  other: VaultCandidate,
  documentId: string,
  documentVersionId: string,
): Promise<void> {
  const results = await Promise.all([
    other.client.from("source_documents").select("id").eq("id", documentId),
    other.client
      .from("source_document_versions")
      .select("id")
      .eq("id", documentVersionId),
    other.client
      .from("source_document_upload_reservations")
      .select("id")
      .eq("document_version_id", documentVersionId),
    other.client
      .from("source_document_extractions")
      .select("id")
      .eq("document_version_id", documentVersionId),
    other.client
      .from("source_document_text_reviews")
      .select("id")
      .eq("document_version_id", documentVersionId),
  ]);
  for (const [index, result] of results.entries()) {
    await expectNoRows(result, `CROSS_TENANT_RESUME_READ_${index}`);
  }
}

async function verifyCrossTenantStorageDenied(
  other: VaultCandidate,
  reservation: ReserveRow,
  fixture: Uint8Array,
): Promise<void> {
  const attemptedUpload = await other.client.storage
    .from(reservation.storage_bucket)
    .upload(reservation.storage_object_path, fixture, {
      contentType: PDF_MEDIA_TYPE,
      upsert: false,
    });
  if (!attemptedUpload.error || attemptedUpload.data) {
    throw new AcceptanceFailure("CROSS_TENANT_STORAGE_UPLOAD_NOT_REJECTED");
  }

  const attemptedDownload = await other.client.storage
    .from(reservation.storage_bucket)
    .download(reservation.storage_object_path);
  if (!attemptedDownload.error || attemptedDownload.data) {
    throw new AcceptanceFailure("CROSS_TENANT_STORAGE_DOWNLOAD_NOT_REJECTED");
  }
}

async function uploadAndFinalize(
  candidate: VaultCandidate,
  admin: SupabaseClient<VaultDatabase>,
  reservation: ReserveRow,
  fixture: Uint8Array,
): Promise<FinalizeRow> {
  const upload = await candidate.client.storage
    .from(reservation.storage_bucket)
    .upload(reservation.storage_object_path, fixture, {
      contentType: PDF_MEDIA_TYPE,
      upsert: false,
    });
  if (upload.error || upload.data?.path !== reservation.storage_object_path) {
    throw new AcceptanceFailure(
      `RESUME_STORAGE_UPLOAD_FAILED:${safeErrorCode(upload.error)}`,
    );
  }

  const candidateFinalize = await candidate.client.rpc(
    "finalize_resume_upload",
    {
      p_actor_id: candidate.userId,
      p_command_id: randomUUID(),
      p_document_version_id: reservation.document_version_id,
      p_sha256: sha256(fixture),
      p_byte_size: fixture.byteLength,
    },
  );
  if (
    !candidateFinalize.error ||
    safeErrorCode(candidateFinalize.error) !== "42501"
  ) {
    throw new AcceptanceFailure(
      `CLIENT_RESUME_FINALIZE_NOT_REJECTED:${safeErrorCode(candidateFinalize.error)}`,
    );
  }

  const finalized = await admin.rpc("finalize_resume_upload", {
    p_actor_id: candidate.userId,
    p_command_id: randomUUID(),
    p_document_version_id: reservation.document_version_id,
    p_sha256: sha256(fixture),
    p_byte_size: fixture.byteLength,
  });
  assertRemoteOk(finalized.error, "RESUME_FINALIZE_FAILED");
  const row = firstRpcRow(finalized.data);
  if (
    !row ||
    row.replayed ||
    row.document_id !== reservation.document_id ||
    row.document_version_id !== reservation.document_version_id ||
    row.scan_status !== "NOT_SCANNED"
  ) {
    throw new AcceptanceFailure("RESUME_FINALIZE_INVARIANT_FAILED");
  }
  return row;
}

async function verifyOwnedStorageDownload(
  candidate: VaultCandidate,
  reservation: ReserveRow,
  expectedSha256: string,
): Promise<void> {
  const downloaded = await candidate.client.storage
    .from(reservation.storage_bucket)
    .download(reservation.storage_object_path);
  if (downloaded.error || !downloaded.data) {
    throw new AcceptanceFailure(
      `OWN_RESUME_STORAGE_DOWNLOAD_FAILED:${safeErrorCode(downloaded.error)}`,
    );
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (sha256(bytes) !== expectedSha256) {
    throw new AcceptanceFailure("OWN_RESUME_STORAGE_HASH_MISMATCH");
  }
}

async function recordSuccessfulExtraction(
  admin: SupabaseClient<VaultDatabase>,
  reservation: ReserveRow,
  fixture: Uint8Array,
): Promise<ExtractionRow> {
  const localExtraction = await extractResumeText({
    bytes: fixture,
    filename: "acceptance-resume.pdf",
    declaredMediaType: PDF_MEDIA_TYPE,
  });
  if (!localExtraction.ok) {
    throw new AcceptanceFailure(
      `LOCAL_RESUME_EXTRACTION_FAILED:${localExtraction.error.code}`,
    );
  }
  if (
    localExtraction.value.source.sha256 !== sha256(fixture) ||
    localExtraction.value.extraction.pageCount !== 1
  ) {
    throw new AcceptanceFailure("LOCAL_RESUME_EXTRACTION_INVARIANT_FAILED");
  }

  const recorded = await admin.rpc("record_resume_extraction", {
    p_document_version_id: reservation.document_version_id,
    p_attempt_number: 1,
    p_status: "SUCCEEDED",
    p_extractor_kind: "LOCAL_DETERMINISTIC",
    p_extractor_release: localExtraction.value.extraction.parserRelease,
    p_output_schema_version: OUTPUT_SCHEMA_VERSION,
    p_source_sha256: localExtraction.value.source.sha256,
    p_extracted_text: localExtraction.value.extraction.normalizedText,
    p_text_sha256: localExtraction.value.extraction.sha256,
    p_page_count: localExtraction.value.extraction.pageCount,
    p_language_code: null,
    p_warnings: [...localExtraction.value.extraction.warnings],
    p_failure_code: null,
    p_started_at: new Date(Date.now() - 1_000).toISOString(),
  });
  assertRemoteOk(recorded.error, "RESUME_EXTRACTION_RECORD_FAILED");
  const row = firstRpcRow(recorded.data);
  if (
    !row ||
    row.replayed ||
    row.document_id !== reservation.document_id ||
    row.document_version_id !== reservation.document_version_id ||
    row.document_status !== "NEEDS_REVIEW"
  ) {
    throw new AcceptanceFailure("RESUME_EXTRACTION_RECORD_INVARIANT_FAILED");
  }
  return row;
}

async function reviewExtractedText(
  candidate: VaultCandidate,
  extraction: ExtractionRow,
): Promise<ReviewedText> {
  const ownExtraction = await candidate.client
    .from("source_document_extractions")
    .select("extracted_text, text_sha256")
    .eq("id", extraction.extraction_id)
    .single();
  assertRemoteOk(ownExtraction.error, "OWN_EXTRACTION_READ_FAILED");
  if (!ownExtraction.data.extracted_text || !ownExtraction.data.text_sha256) {
    throw new AcceptanceFailure("OWN_EXTRACTION_TEXT_MISSING");
  }

  const reviewedText = ownExtraction.data.extracted_text;
  const reviewedTextSha256 = sha256(reviewedText);
  if (reviewedTextSha256 !== ownExtraction.data.text_sha256) {
    throw new AcceptanceFailure("OWN_EXTRACTION_TEXT_HASH_MISMATCH");
  }

  const reviewed = await candidate.client.rpc("review_resume_text", {
    p_command_id: randomUUID(),
    p_document_id: extraction.document_id,
    p_extraction_id: extraction.extraction_id,
    p_expected_aggregate_version: extraction.aggregate_version,
    p_reviewed_text: reviewedText,
    p_text_sha256: reviewedTextSha256,
  });
  assertRemoteOk(reviewed.error, "RESUME_REVIEW_FAILED");
  const row = firstRpcRow(reviewed.data);
  if (
    !row ||
    row.replayed ||
    row.document_status !== "READY" ||
    row.aggregate_version !== extraction.aggregate_version + 1 ||
    row.extraction_id !== extraction.extraction_id
  ) {
    throw new AcceptanceFailure("RESUME_REVIEW_INVARIANT_FAILED");
  }

  return Object.freeze({ row, reviewedText, reviewedTextSha256 });
}

async function verifyStaleReviewRejected(
  candidate: VaultCandidate,
  extraction: ExtractionRow,
  reviewed: ReviewedText,
): Promise<void> {
  const stale = await candidate.client.rpc("review_resume_text", {
    p_command_id: randomUUID(),
    p_document_id: extraction.document_id,
    p_extraction_id: extraction.extraction_id,
    p_expected_aggregate_version: extraction.aggregate_version,
    p_reviewed_text: reviewed.reviewedText,
    p_text_sha256: reviewed.reviewedTextSha256,
  });
  if (!stale.error || safeErrorCode(stale.error) !== "PT409") {
    throw new AcceptanceFailure(
      `STALE_RESUME_REVIEW_NOT_REJECTED:${safeErrorCode(stale.error)}`,
    );
  }
}

async function recordFailedReplacement(
  admin: SupabaseClient<VaultDatabase>,
  reservation: ReserveRow,
  fixture: Uint8Array,
  reviewed: ReviewRow,
): Promise<void> {
  const failed = await admin.rpc("record_resume_extraction", {
    p_document_version_id: reservation.document_version_id,
    p_attempt_number: 1,
    p_status: "FAILED",
    p_extractor_kind: "LOCAL_DETERMINISTIC",
    p_extractor_release: "career-vault-acceptance/0.1",
    p_output_schema_version: OUTPUT_SCHEMA_VERSION,
    p_source_sha256: sha256(fixture),
    p_extracted_text: null,
    p_text_sha256: null,
    p_page_count: null,
    p_language_code: null,
    p_warnings: [],
    p_failure_code: "ACCEPTANCE_REPLACEMENT_PARSE_FAILED",
    p_started_at: new Date(Date.now() - 1_000).toISOString(),
  });
  assertRemoteOk(failed.error, "REPLACEMENT_FAILURE_RECORD_FAILED");
  const row = firstRpcRow(failed.data);
  if (
    !row ||
    row.replayed ||
    row.document_id !== reviewed.document_id ||
    row.document_status !== "READY" ||
    row.aggregate_version !== reviewed.aggregate_version
  ) {
    throw new AcceptanceFailure("REPLACEMENT_FAILURE_DID_NOT_PRESERVE_READY");
  }

  const document = await admin
    .from("source_documents")
    .select("status, current_version_number, aggregate_version")
    .eq("id", reviewed.document_id)
    .single();
  assertRemoteOk(document.error, "REPLACEMENT_DOCUMENT_READ_FAILED");
  if (
    document.data.status !== "READY" ||
    document.data.current_version_number !== 1 ||
    document.data.aggregate_version !== reviewed.aggregate_version
  ) {
    throw new AcceptanceFailure("REPLACEMENT_CURRENT_VERSION_CHANGED");
  }
}

async function requestDocumentDeletion(
  candidate: VaultCandidate,
  reviewed: ReviewRow,
): Promise<DeletionRequestRow> {
  const requested = await candidate.client.rpc(
    "request_source_document_deletion",
    {
      p_command_id: randomUUID(),
      p_document_id: reviewed.document_id,
      p_expected_aggregate_version: reviewed.aggregate_version,
    },
  );
  assertRemoteOk(requested.error, "RESUME_DELETE_REQUEST_FAILED");
  const row = firstRpcRow(requested.data);
  if (
    !row ||
    row.replayed ||
    row.document_status !== "DELETION_PENDING" ||
    row.aggregate_version !== reviewed.aggregate_version + 1
  ) {
    throw new AcceptanceFailure("RESUME_DELETE_REQUEST_INVARIANT_FAILED");
  }

  const pendingDocument = await candidate.client
    .from("source_documents")
    .select("status, aggregate_version")
    .eq("id", reviewed.document_id)
    .single();
  assertRemoteOk(
    pendingDocument.error,
    "DELETION_PENDING_DOCUMENT_READ_FAILED",
  );
  if (
    pendingDocument.data.status !== "DELETION_PENDING" ||
    pendingDocument.data.aggregate_version !== reviewed.aggregate_version + 1
  ) {
    throw new AcceptanceFailure("DELETION_PENDING_DOCUMENT_STATE_INVALID");
  }

  return row;
}

function remoteErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

async function verifyDeletionPendingReserveRejected(
  candidate: VaultCandidate,
  admin: SupabaseClient<VaultDatabase>,
  pending: DeletionRequestRow,
  byteSize: number,
): Promise<void> {
  const before = await admin
    .from("source_document_upload_reservations")
    .select("id")
    .eq("document_id", pending.document_id);
  assertRemoteOk(before.error, "DELETION_PENDING_RESERVATIONS_BEFORE_READ_FAILED");

  const attempted = await candidate.client.rpc("reserve_resume_upload", {
    p_command_id: randomUUID(),
    p_display_name: "Acceptance blocked during deletion.pdf",
    p_mime_type: PDF_MEDIA_TYPE,
    p_byte_size: byteSize,
  });
  if (
    !attempted.error ||
    attempted.data !== null ||
    safeErrorCode(attempted.error) !== "55000" ||
    remoteErrorMessage(attempted.error) !== "DOCUMENT_ALREADY_DELETION_PENDING"
  ) {
    throw new AcceptanceFailure(
      `DELETION_PENDING_RESERVE_NOT_REJECTED:${safeErrorCode(attempted.error)}`,
    );
  }

  const [after, document] = await Promise.all([
    admin
      .from("source_document_upload_reservations")
      .select("id")
      .eq("document_id", pending.document_id),
    candidate.client
      .from("source_documents")
      .select("status, aggregate_version")
      .eq("id", pending.document_id)
      .single(),
  ]);
  assertRemoteOk(after.error, "DELETION_PENDING_RESERVATIONS_AFTER_READ_FAILED");
  assertRemoteOk(document.error, "DELETION_PENDING_DOCUMENT_AFTER_RESERVE_READ_FAILED");
  if (after.data.length !== before.data.length) {
    throw new AcceptanceFailure("DELETION_PENDING_RESERVE_CREATED_RESERVATION");
  }
  if (
    document.data.status !== "DELETION_PENDING" ||
    document.data.aggregate_version !== pending.aggregate_version
  ) {
    throw new AcceptanceFailure("DELETION_PENDING_RESERVE_CHANGED_DOCUMENT");
  }
}

async function completeDocumentDeletion(
  admin: SupabaseClient<VaultDatabase>,
  documentId: string,
  storageObjectPaths: readonly string[],
): Promise<void> {
  const removed = await admin.storage
    .from(VAULT_BUCKET)
    .remove([...storageObjectPaths]);
  if (removed.error) {
    throw new AcceptanceFailure(
      `RESUME_STORAGE_DELETE_FAILED:${safeErrorCode(removed.error)}`,
    );
  }
  for (const path of storageObjectPaths) {
    const remaining = await admin.storage.from(VAULT_BUCKET).download(path);
    if (!remaining.error || remaining.data) {
      throw new AcceptanceFailure("RESUME_STORAGE_OBJECT_REMAINS");
    }
  }

  const completed = await admin.rpc("complete_source_document_deletion", {
    p_document_id: documentId,
  });
  assertRemoteOk(completed.error, "RESUME_DELETE_COMPLETION_FAILED");
  if (completed.data !== true) {
    throw new AcceptanceFailure("RESUME_DELETE_COMPLETION_INVALID");
  }

  const remainingRows = await Promise.all([
    admin.from("source_documents").select("id").eq("id", documentId),
    admin
      .from("source_document_versions")
      .select("id")
      .eq("document_id", documentId),
    admin
      .from("source_document_upload_reservations")
      .select("id")
      .eq("document_id", documentId),
    admin
      .from("source_document_extractions")
      .select("id")
      .eq("document_id", documentId),
    admin
      .from("source_document_text_reviews")
      .select("id")
      .eq("document_id", documentId),
  ]);
  for (const [index, result] of remainingRows.entries()) {
    await expectNoRows(result, `RESUME_DELETE_CASCADE_${index}`);
  }
}

async function cleanup(
  config: VaultConfig,
  record: VaultCleanupRecord,
  candidates: readonly VaultCandidate[],
): Promise<string[]> {
  if (record.projectRef !== config.expectedProjectRef) {
    throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
  }
  const admin = createVaultClient(config, config.secretKey);
  const errors: string[] = [];

  const allowedWorkspaceIds = new Set(
    record.identities.map((identity) => identity.workspaceId),
  );
  const unsafeStoragePath = record.storageObjectPaths.find((path) => {
    const workspaceId = path.split("/", 1)[0];
    return !workspaceId || !allowedWorkspaceIds.has(workspaceId);
  });
  if (unsafeStoragePath) {
    throw new AcceptanceFailure("CLEANUP_REFUSED: unrecognized Storage path");
  }
  if (record.storageObjectPaths.length > 0) {
    const removed = await admin.storage
      .from(VAULT_BUCKET)
      .remove([...record.storageObjectPaths]);
    if (removed.error) {
      errors.push(`storage:REMOVE_FAILED:${safeErrorCode(removed.error)}`);
    }
  }

  for (const identity of record.identities) {
    assertVaultAcceptanceEmail(identity.email);
    const workspace = await admin
      .from("workspaces")
      .select("id, name, kind, personal_owner_auth_user_id")
      .eq("id", identity.workspaceId)
      .maybeSingle();
    if (workspace.error) {
      errors.push(
        `${identity.label}:WORKSPACE_LOOKUP_FAILED:${safeErrorCode(workspace.error)}`,
      );
      continue;
    }
    if (
      workspace.data &&
      (workspace.data.kind !== "PERSONAL" ||
        workspace.data.personal_owner_auth_user_id !== identity.userId ||
        !workspace.data.name.startsWith(WORKSPACE_NAME_PREFIX))
    ) {
      errors.push(`${identity.label}:WORKSPACE_IDENTITY_MISMATCH`);
      continue;
    }

    const fetched = await admin.auth.admin.getUserById(identity.userId);
    if (
      !fetched.error &&
      fetched.data.user.email?.toLowerCase() !== identity.email.toLowerCase()
    ) {
      errors.push(`${identity.label}:AUTH_USER_EMAIL_MISMATCH`);
      continue;
    }
    if (
      fetched.error &&
      safeErrorCode(fetched.error) !== "user_not_found"
    ) {
      errors.push(
        `${identity.label}:AUTH_USER_LOOKUP_FAILED:${safeErrorCode(fetched.error)}`,
      );
      continue;
    }

    if (workspace.data) {
      const documents = await admin
        .from("source_documents")
        .select("id, status, aggregate_version")
        .eq("workspace_id", identity.workspaceId);
      if (documents.error) {
        errors.push(
          `${identity.label}:DOCUMENT_LOOKUP_FAILED:${safeErrorCode(documents.error)}`,
        );
        continue;
      }
      const actor = candidates.find(
        (candidate) =>
          candidate.label === identity.label &&
          candidate.userId === identity.userId,
      );
      for (const document of documents.data) {
        if (document.status !== "DELETION_PENDING") {
          if (!actor) {
            errors.push(`${identity.label}:DOCUMENT_ACTOR_SESSION_MISSING`);
            continue;
          }
          const requested = await actor.client.rpc(
            "request_source_document_deletion",
            {
              p_command_id: randomUUID(),
              p_document_id: document.id,
              p_expected_aggregate_version: document.aggregate_version,
            },
          );
          if (requested.error) {
            errors.push(
              `${identity.label}:DOCUMENT_DELETE_REQUEST_FAILED:${safeErrorCode(requested.error)}`,
            );
            continue;
          }
        }
        const completed = await admin.rpc(
          "complete_source_document_deletion",
          { p_document_id: document.id },
        );
        if (completed.error || completed.data !== true) {
          errors.push(
            `${identity.label}:DOCUMENT_PURGE_FAILED:${safeErrorCode(completed.error)}`,
          );
        }
      }
      if (errors.some((error) => error.startsWith(`${identity.label}:`))) {
        continue;
      }
    }

    if (workspace.data) {
      const removedWorkspace = await admin
        .from("workspaces")
        .delete()
        .eq("id", identity.workspaceId)
        .eq("personal_owner_auth_user_id", identity.userId);
      if (removedWorkspace.error) {
        errors.push(
          `${identity.label}:WORKSPACE_DELETE_FAILED:${safeErrorCode(removedWorkspace.error)}`,
        );
        continue;
      }
    }
    if (!fetched.error) {
      const deleted = await admin.auth.admin.deleteUser(identity.userId, false);
      if (deleted.error) {
        errors.push(
          `${identity.label}:AUTH_USER_DELETE_FAILED:${safeErrorCode(deleted.error)}`,
        );
      }
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const config = requireVaultConfig();
  const checks: AcceptanceCheck[] = [];
  const candidates: VaultCandidate[] = [];
  const storageObjectPaths = new Set<string>();
  let record: VaultCleanupRecord | null = null;
  let cleanupArtifact: string | null = null;
  let runFailure: string | null = null;
  let cleanupStatus: "NOT_NEEDED" | "KEPT" | "PASS" | "FAIL" =
    "NOT_NEEDED";

  const persistRecoveryRecord = async (): Promise<void> => {
    if (candidates.length === 0) return;
    record = createCleanupRecord(config, candidates, storageObjectPaths);
    cleanupArtifact = await preserveCleanupRecord(record);
  };

  process.stdout.write(
    `RoleDawn Career Vault hosted acceptance\nproject=${config.expectedProjectRef}\nrun=${config.runId}\n`,
  );

  try {
    const admin = createVaultClient(config, config.secretKey);
    const { alpha, beta } = await runStage("two-real-auth-users", async () => {
      const createdAlpha = await createCandidate(config, "alpha");
      candidates.push(createdAlpha);
      await persistRecoveryRecord();
      const createdBeta = await createCandidate(config, "beta");
      candidates.push(createdBeta);
      await persistRecoveryRecord();
      return { alpha: createdAlpha, beta: createdBeta };
    });
    report(
      checks,
      "two-real-auth-users",
      "two ordinary authenticated candidate sessions are isolated",
    );

    const primaryFixture = createPdfFixture(
      "RoleDawn Acceptance Candidate\nSoftware Engineer\nBuilt deterministic test systems.",
    );
    if (
      sha256(primaryFixture) !==
      sha256(
        createPdfFixture(
          "RoleDawn Acceptance Candidate\nSoftware Engineer\nBuilt deterministic test systems.",
        ),
      )
    ) {
      throw new AcceptanceFailure("PDF_FIXTURE_NOT_DETERMINISTIC");
    }

    const firstReservation = await runStage(
      "exact-upload-reservation",
      async () => {
        const reservation = await reserveExactPdf(
          alpha,
          primaryFixture.byteLength,
        );
        storageObjectPaths.add(reservation.storage_object_path);
        await persistRecoveryRecord();
        if (reservation.version_number !== 1) {
          throw new AcceptanceFailure("FIRST_RESUME_VERSION_NOT_ONE");
        }
        return reservation;
      },
    );
    report(
      checks,
      "exact-upload-reservation",
      "candidate receives one replay-safe, exact private PDF path",
    );

    await runStage("cross-tenant-denial-before-upload", async () => {
      await verifyCrossTenantReads(
        beta,
        firstReservation.document_id,
        firstReservation.document_version_id,
      );
      await verifyCrossTenantStorageDenied(
        beta,
        firstReservation,
        primaryFixture,
      );
    });
    report(
      checks,
      "cross-tenant-denial-before-upload",
      "the second user cannot read the reservation or use its Storage path",
    );

    await runStage("ordinary-upload-finalize", async () => {
      const firstFinalize = await uploadAndFinalize(
        alpha,
        admin,
        firstReservation,
        primaryFixture,
      );
      if (firstFinalize.document_status !== "PARSING") {
        throw new AcceptanceFailure("FIRST_FINALIZE_STATUS_INVALID");
      }
      await verifyOwnedStorageDownload(
        alpha,
        firstReservation,
        sha256(primaryFixture),
      );
    });
    report(
      checks,
      "ordinary-upload-finalize",
      "ordinary client upload is hash-verified and finalized without claiming a malware scan",
    );
    await runStage("cross-tenant-denial-after-upload", async () => {
      await verifyCrossTenantReads(
        beta,
        firstReservation.document_id,
        firstReservation.document_version_id,
      );
      await verifyCrossTenantStorageDenied(
        beta,
        firstReservation,
        primaryFixture,
      );
    });
    report(
      checks,
      "cross-tenant-denial-after-upload",
      "the second user reads neither resume rows nor original bytes",
    );

    const extraction = await runStage("service-extraction", () =>
      recordSuccessfulExtraction(admin, firstReservation, primaryFixture),
    );
    report(
      checks,
      "service-extraction",
      "service records deterministic parser provenance and reviewable text",
    );

    const reviewed = await runStage(
      "candidate-review",
      () => reviewExtractedText(alpha, extraction),
    );
    report(
      checks,
      "candidate-review",
      "candidate review promotes the exact version to READY",
    );
    await runStage("optimistic-lock", () =>
      verifyStaleReviewRejected(alpha, extraction, reviewed),
    );
    report(
      checks,
      "optimistic-lock",
      "a stale review command is rejected",
    );

    const replacementFixture = createPdfFixture(
      "RoleDawn Acceptance Replacement\nThis version intentionally enters the failure path.",
    );
    await runStage("failed-replacement-safety", async () => {
      const replacement = await reserveExactPdf(
        alpha,
        replacementFixture.byteLength,
      );
      storageObjectPaths.add(replacement.storage_object_path);
      await persistRecoveryRecord();
      if (
        replacement.document_id !== firstReservation.document_id ||
        replacement.version_number !== firstReservation.version_number + 1
      ) {
        throw new AcceptanceFailure("REPLACEMENT_VERSION_INVARIANT_FAILED");
      }
      const replacementFinalize = await uploadAndFinalize(
        alpha,
        admin,
        replacement,
        replacementFixture,
      );
      if (replacementFinalize.document_status !== "READY") {
        throw new AcceptanceFailure("REPLACEMENT_FINALIZE_DISPLACED_READY");
      }
      await recordFailedReplacement(
        admin,
        replacement,
        replacementFixture,
        reviewed.row,
      );
    });
    report(
      checks,
      "failed-replacement-safety",
      "failed replacement preserves the reviewed current version",
    );

    await runStage("complete-tenant-isolation", () =>
      verifyCrossTenantReads(
        beta,
        firstReservation.document_id,
        firstReservation.document_version_id,
      ),
    );
    report(
      checks,
      "complete-tenant-isolation",
      "the second user reads zero documents, versions, extractions, or reviews",
    );

    const pendingDeletion = await runStage(
      "deletion-pending-reserve-denial",
      async () => {
        const pending = await requestDocumentDeletion(alpha, reviewed.row);
        await verifyDeletionPendingReserveRejected(
          alpha,
          admin,
          pending,
          primaryFixture.byteLength,
        );
        return pending;
      },
    );
    report(
      checks,
      "deletion-pending-reserve-denial",
      "a new upload reservation is rejected while the resume awaits deletion",
    );

    await runStage("deletion-lifecycle", () =>
      completeDocumentDeletion(
        admin,
        pendingDeletion.document_id,
        [...storageObjectPaths],
      ),
    );
    report(
      checks,
      "deletion-lifecycle",
      "Storage API removal and service purge complete the candidate-requested deletion",
    );
    const actual = new Set(checks.map((check) => check.name));
    const missing = REQUIRED_CHECKPOINTS.filter((name) => !actual.has(name));
    const unexpected = [...actual].filter(
      (name) => !REQUIRED_CHECKPOINTS.includes(
        name as (typeof REQUIRED_CHECKPOINTS)[number],
      ),
    );
    if (
      missing.length > 0 ||
      unexpected.length > 0 ||
      checks.length !== REQUIRED_CHECKPOINTS.length
    ) {
      throw new AcceptanceFailure(
        `INCOMPLETE_CHECKPOINTS:${missing.join(",") || unexpected.join(",")}`,
      );
    }
  } catch (error) {
    runFailure =
      error instanceof AcceptanceFailure
        ? error.message
        : "UNEXPECTED_CAREER_VAULT_ACCEPTANCE_FAILURE";
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
            "PASS cleanup — acceptance users, tenant data, and tracked Storage objects removed\n",
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
      runFailure ?? "CAREER_VAULT_ACCEPTANCE_CLEANUP_FAILED",
    );
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof AcceptanceFailure)) {
    process.stderr.write("FAIL UNEXPECTED_CAREER_VAULT_ACCEPTANCE_FAILURE\n");
  }
  process.exitCode = 1;
}
