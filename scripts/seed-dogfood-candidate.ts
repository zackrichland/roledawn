import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { Database, Json } from "../src/lib/supabase/database.types.ts";
import {
  PDF_MEDIA_TYPE,
  extractResumeText,
} from "../src/server/resume/extract-resume.ts";
import {
  RESUME_EVIDENCE_SEGMENTER_RELEASE,
  segmentReviewedResume,
} from "../src/server/resume/segment-reviewed-resume.ts";

const CONFIRMATION = "I_UNDERSTAND_THIS_UPDATES_THE_DOGFOOD_CANDIDATE";
const EXPECTED_PROJECT_REF = "dxrrotrugwhquqxyoisk";

type Row = Record<string, unknown>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function firstRow(value: unknown): Row {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") throw new Error("RPC_RESULT_INVALID");
  return candidate as Row;
}

function requiredString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`RPC_${key.toUpperCase()}_INVALID`);
  return value;
}

function requiredPositiveInteger(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`RPC_${key.toUpperCase()}_INVALID`);
  }
  return value;
}

function safeCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN_REMOTE_ERROR";
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.message === "string") {
    return candidate.message.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? "REMOTE_ERROR";
  }
  return typeof candidate.code === "string" ? candidate.code : "REMOTE_ERROR";
}

function assertRemote(error: unknown, code: string): void {
  if (error) throw new Error(`${code}:${safeCode(error)}`);
}

function passagePayload(
  passages: ReturnType<typeof segmentReviewedResume>,
): Json {
  return passages.map((passage) => ({
    stable_key: passage.stableKey,
    ordinal: passage.ordinal,
    category: passage.category,
    start_offset: passage.startOffset,
    end_offset: passage.endOffset,
    excerpt: passage.excerpt,
    excerpt_sha256: passage.excerptSha256,
  })) as Json;
}

function writeSafeSummary(
  legalNameVersionUpdated: boolean,
  passages: ReturnType<typeof segmentReviewedResume>,
  resumed: boolean,
): void {
  const categoryCounts = Object.fromEntries(
    [...new Set(passages.map((passage) => passage.category))]
      .map((category) => [category, passages.filter((passage) => passage.category === category).length]),
  );
  process.stdout.write(`${JSON.stringify({
    candidate: { displayName, legalNameVersionUpdated },
    resume: {
      status: "READY",
      filename,
      pageCount: artifact.extraction.pageCount,
      byteSize: artifact.source.byteSize,
      characterCount: artifact.extraction.characterCount,
      warningCount: artifact.extraction.warningCount,
      sourceSha256: artifact.source.sha256,
      textSha256: artifact.extraction.sha256,
      resumed,
    },
    evidence: {
      status: "NEEDS_CANDIDATE_REVIEW",
      segmenterRelease: RESUME_EVIDENCE_SEGMENTER_RELEASE,
      proposalCount: passages.length,
      categoryCounts,
    },
  }, null, 2)}\n`);
}

function parseArguments(): Readonly<{ resumePath: string; displayName: string }> {
  const [confirmation, resumePath, ...displayNameParts] = process.argv.slice(2);
  if (confirmation !== CONFIRMATION) throw new Error(`CONFIRMATION_REQUIRED:${CONFIRMATION}`);
  const displayName = displayNameParts.join(" ").trim().replace(/\s+/gu, " ");
  if (!resumePath || displayName.length < 1 || displayName.length > 120) {
    throw new Error("USAGE:seed-dogfood-candidate <confirmation> <resume-path> <display-name>");
  }
  return Object.freeze({ resumePath: resolve(resumePath), displayName });
}

const { resumePath, displayName } = parseArguments();
const url = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const secretKey = requiredEnvironment("SUPABASE_SECRET_KEY");
const email = requiredEnvironment("LOCAL_TEST_USER_EMAIL");
const projectRef = new URL(url).hostname.split(".")[0];
if (projectRef !== EXPECTED_PROJECT_REF) throw new Error("DOGFOOD_PROJECT_REF_MISMATCH");
if (!email.endsWith("@local.invalid")) throw new Error("DOGFOOD_EMAIL_INVALID");

const originalBytes = new Uint8Array(await readFile(resumePath));
const filename = basename(resumePath);
const extraction = await extractResumeText({
  bytes: originalBytes,
  filename,
  declaredMediaType: PDF_MEDIA_TYPE,
});
if (!extraction.ok) throw new Error(`RESUME_EXTRACTION_FAILED:${extraction.error.code}`);
const artifact = extraction.value;

const admin = createClient<Database>(url, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  global: { headers: { "x-roledawn-runtime": "dogfood-candidate-seed/0.1" } },
});
const candidate = createClient<Database>(url, publishableKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  global: { headers: { "x-roledawn-runtime": "dogfood-candidate-seed/0.1" } },
});

const generated = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { data: { display_name: displayName } },
});
assertRemote(generated.error, "DOGFOOD_LINK_FAILED");
const tokenHash = generated.data.properties?.hashed_token;
if (!tokenHash) throw new Error("DOGFOOD_LINK_TOKEN_MISSING");
const verified = await candidate.auth.verifyOtp({ type: "email", token_hash: tokenHash });
assertRemote(verified.error, "DOGFOOD_SESSION_FAILED");
const actorId = verified.data.user?.id;
if (!actorId) throw new Error("DOGFOOD_ACTOR_MISSING");

const bootstrapped = await candidate.rpc("bootstrap_personal_workspace", {
  p_display_name: displayName,
});
assertRemote(bootstrapped.error, "DOGFOOD_BOOTSTRAP_FAILED");
const identity = firstRow(bootstrapped.data);
const workspaceId = requiredString(identity, "workspace_id");
const candidateId = requiredString(identity, "candidate_id");

const currentResume = await candidate
  .from("source_documents")
  .select("id, status, current_version_number")
  .eq("candidate_id", candidateId)
  .eq("document_kind", "RESUME")
  .neq("status", "DELETED")
  .limit(1)
  .maybeSingle();
assertRemote(currentResume.error, "DOGFOOD_RESUME_CHECK_FAILED");

const currentFact = await candidate
  .from("candidate_facts")
  .select("id, aggregate_version, current_version_number")
  .eq("candidate_id", candidateId)
  .eq("fact_key", "identity.legal_name")
  .maybeSingle();
assertRemote(currentFact.error, "DOGFOOD_LEGAL_NAME_READ_FAILED");
const currentVersion = currentFact.data?.current_version_number;
let legalNameAlreadyCurrent = false;
if (currentFact.data && currentVersion) {
  const version = await candidate
    .from("candidate_fact_versions")
    .select("value_json")
    .eq("fact_id", currentFact.data.id)
    .eq("version_number", currentVersion)
    .maybeSingle();
  assertRemote(version.error, "DOGFOOD_LEGAL_NAME_VERSION_READ_FAILED");
  legalNameAlreadyCurrent = version.data?.value_json === displayName;
}
if (!legalNameAlreadyCurrent) {
  const saved = await candidate.rpc("save_candidate_fact", {
    p_command_id: randomUUID(),
    p_fact_key: "identity.legal_name",
    p_value_json: displayName,
    p_normalized_text: displayName,
    ...(currentFact.data
      ? { p_expected_aggregate_version: currentFact.data.aggregate_version }
      : {}),
  });
  assertRemote(saved.error, "DOGFOOD_LEGAL_NAME_SAVE_FAILED");
}

const renamedCandidate = await admin
  .from("candidates")
  .update({ display_name: displayName })
  .eq("id", candidateId)
  .eq("workspace_id", workspaceId)
  .eq("auth_user_id", actorId);
assertRemote(renamedCandidate.error, "DOGFOOD_CANDIDATE_RENAME_FAILED");
const renamedWorkspace = await admin
  .from("workspaces")
  .update({ name: `${displayName} workspace` })
  .eq("id", workspaceId)
  .eq("personal_owner_auth_user_id", actorId);
assertRemote(renamedWorkspace.error, "DOGFOOD_WORKSPACE_RENAME_FAILED");
const updatedAuth = await admin.auth.admin.updateUserById(actorId, {
  user_metadata: { ...(verified.data.user?.user_metadata ?? {}), display_name: displayName },
});
assertRemote(updatedAuth.error, "DOGFOOD_AUTH_LABEL_UPDATE_FAILED");

if (currentResume.data) {
  if (currentResume.data.status !== "READY" || !currentResume.data.current_version_number) {
    throw new Error("DOGFOOD_EXISTING_RESUME_NOT_READY");
  }
  const sourceVersion = await candidate
    .from("source_document_versions")
    .select("sha256")
    .eq("document_id", currentResume.data.id)
    .eq("version_number", currentResume.data.current_version_number)
    .maybeSingle();
  assertRemote(sourceVersion.error, "DOGFOOD_EXISTING_RESUME_VERSION_READ_FAILED");
  if (sourceVersion.data?.sha256 !== artifact.source.sha256) {
    throw new Error("DOGFOOD_EXISTING_RESUME_SOURCE_MISMATCH");
  }
  const textReview = await candidate
    .from("source_document_text_reviews")
    .select("id, reviewed_text, text_sha256")
    .eq("document_id", currentResume.data.id)
    .order("review_version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertRemote(textReview.error, "DOGFOOD_EXISTING_RESUME_REVIEW_READ_FAILED");
  if (
    !textReview.data ||
    textReview.data.text_sha256 !== artifact.extraction.sha256 ||
    textReview.data.reviewed_text !== artifact.extraction.normalizedText
  ) {
    throw new Error("DOGFOOD_EXISTING_RESUME_TEXT_MISMATCH");
  }
  const passages = segmentReviewedResume(
    textReview.data.id,
    artifact.extraction.normalizedText,
  );
  const ingested = await candidate.rpc("ingest_resume_evidence_proposals", {
    p_command_id: randomUUID(),
    p_text_review_id: textReview.data.id,
    p_segmenter_release: RESUME_EVIDENCE_SEGMENTER_RELEASE,
    p_passages: passagePayload(passages),
  });
  assertRemote(ingested.error, "DOGFOOD_EVIDENCE_INGEST_FAILED");
  writeSafeSummary(!legalNameAlreadyCurrent, passages, true);
  process.exit(0);
}

const reserved = await candidate.rpc("reserve_resume_upload", {
  p_command_id: randomUUID(),
  p_display_name: filename,
  p_mime_type: artifact.source.mediaType,
  p_byte_size: artifact.source.byteSize,
});
assertRemote(reserved.error, "DOGFOOD_RESUME_RESERVE_FAILED");
const reservation = firstRow(reserved.data);
const documentId = requiredString(reservation, "document_id");
const documentVersionId = requiredString(reservation, "document_version_id");
const storageBucket = requiredString(reservation, "storage_bucket");
const storagePath = requiredString(reservation, "storage_object_path");

let uploaded = false;
let finalized = false;
try {
  const upload = await candidate.storage.from(storageBucket).upload(storagePath, originalBytes, {
    cacheControl: "3600",
    contentType: artifact.source.mediaType,
    upsert: false,
  });
  assertRemote(upload.error, "DOGFOOD_RESUME_STORAGE_FAILED");
  uploaded = true;

  const finalize = await admin.rpc("finalize_resume_upload", {
    p_actor_id: actorId,
    p_command_id: randomUUID(),
    p_document_version_id: documentVersionId,
    p_sha256: artifact.source.sha256,
    p_byte_size: artifact.source.byteSize,
  });
  assertRemote(finalize.error, "DOGFOOD_RESUME_FINALIZE_FAILED");
  finalized = true;

  const startedAt = new Date().toISOString();
  const recorded = await admin.rpc("record_resume_extraction", {
    p_document_version_id: documentVersionId,
    p_attempt_number: 1,
    p_status: "SUCCEEDED",
    p_extractor_kind: "LOCAL_DETERMINISTIC",
    p_extractor_release: artifact.extraction.parserRelease,
    p_output_schema_version: `resume-text/${artifact.schemaVersion}`,
    p_source_sha256: artifact.source.sha256,
    p_extracted_text: artifact.extraction.normalizedText,
    p_text_sha256: artifact.extraction.sha256,
    p_page_count: artifact.extraction.pageCount ?? 1,
    p_language_code: null as unknown as string,
    p_warnings: [...artifact.extraction.warnings] as Json,
    p_failure_code: null as unknown as string,
    p_started_at: startedAt,
  });
  assertRemote(recorded.error, "DOGFOOD_EXTRACTION_RECORD_FAILED");
  const extractionRow = firstRow(recorded.data);
  const extractionId = requiredString(extractionRow, "extraction_id");
  const aggregateVersion = requiredPositiveInteger(extractionRow, "aggregate_version");

  const reviewed = await candidate.rpc("review_resume_text", {
    p_command_id: randomUUID(),
    p_document_id: documentId,
    p_extraction_id: extractionId,
    p_expected_aggregate_version: aggregateVersion,
    p_reviewed_text: artifact.extraction.normalizedText,
    p_text_sha256: artifact.extraction.sha256,
  });
  assertRemote(reviewed.error, "DOGFOOD_RESUME_REVIEW_FAILED");
  const review = firstRow(reviewed.data);
  const textReviewId = requiredString(review, "review_id");
  const passages = segmentReviewedResume(textReviewId, artifact.extraction.normalizedText);
  const ingested = await candidate.rpc("ingest_resume_evidence_proposals", {
    p_command_id: randomUUID(),
    p_text_review_id: textReviewId,
    p_segmenter_release: RESUME_EVIDENCE_SEGMENTER_RELEASE,
    p_passages: passagePayload(passages),
  });
  assertRemote(ingested.error, "DOGFOOD_EVIDENCE_INGEST_FAILED");
  writeSafeSummary(!legalNameAlreadyCurrent, passages, false);
} catch (error) {
  if (!finalized) {
    if (uploaded) await candidate.storage.from(storageBucket).remove([storagePath]);
    await candidate.rpc("cancel_resume_upload_reservation", {
      p_document_version_id: documentVersionId,
    });
  }
  throw error;
}
