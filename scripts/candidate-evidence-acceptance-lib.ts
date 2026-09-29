import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../src/lib/supabase/database.types.ts";
import {
  AcceptanceFailure,
  createAcceptancePassword,
  createAcceptanceRunId,
} from "./milestone-zero-acceptance-lib.ts";

export const CANDIDATE_EVIDENCE_PROJECT_REF = "dxrrotrugwhquqxyoisk";
export const CANDIDATE_EVIDENCE_ACCEPTANCE_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_CREATES_TEST_DATA";
export const CANDIDATE_EVIDENCE_CLEANUP_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_PERMANENTLY_DELETES_ACCEPTANCE_DATA";
export const CANDIDATE_EVIDENCE_EMAIL_PREFIX =
  "roledawn-evidence-acceptance-";
export const CANDIDATE_EVIDENCE_EMAIL_DOMAIN = "acceptance.invalid";
export const CANDIDATE_EVIDENCE_WORKSPACE_PREFIX = "RoleDawn Evidence ";
export const CANDIDATE_EVIDENCE_CLEANUP_SCHEMA_VERSION =
  "candidate-evidence-acceptance/v1";

const REQUEST_TIMEOUT_MS = 20_000;
const SECRET_PLACEHOLDERS = new Set([
  "your-server-only-supabase-secret-key",
  "your-supabase-secret-key",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type CandidateEvidenceLabel = "alpha" | "beta";
export type CandidateEvidenceCategory =
  | "EXPERIENCE"
  | "PROJECT"
  | "ACHIEVEMENT"
  | "SKILL"
  | "EDUCATION"
  | "SUMMARY"
  | "OTHER";

export type EvidenceProposalPassage = Readonly<{
  stable_key: string;
  ordinal: number;
  category: CandidateEvidenceCategory;
  start_offset: number;
  end_offset: number;
  excerpt: string;
  excerpt_sha256: string;
}>;

type EvidenceTable<Row, Insert, Update> = Readonly<{
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
}>;

type SourceEvidencePassageRow = Readonly<{
  id: string;
  workspace_id: string;
  candidate_id: string;
  document_id: string;
  document_version_id: string;
  text_review_id: string;
  stable_key: string;
  ordinal: number;
  evidence_category: string;
  start_offset: number;
  end_offset: number;
  excerpt: string;
  excerpt_sha256: string;
  segmenter_release: string;
  created_at: string;
}>;

type CandidateEvidenceItemRow = Readonly<{
  id: string;
  workspace_id: string;
  candidate_id: string;
  document_id: string;
  text_review_id: string;
  primary_source_passage_id: string;
  evidence_key: string;
  evidence_category: string;
  review_status: string;
  current_version_number: number | null;
  aggregate_version: number;
  created_at: string;
  updated_at: string;
}>;

type CandidateEvidenceVersionRow = Readonly<{
  id: string;
  workspace_id: string;
  candidate_id: string;
  document_id: string;
  evidence_item_id: string;
  version_number: number;
  claim_text: string;
  claim_sha256: string;
  usage_policy: string;
  candidate_disposition: string;
  review_kind: string;
  candidate_attested: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_by: string;
  created_at: string;
}>;

type CandidateEvidenceCitationRow = Readonly<{
  id: string;
  workspace_id: string;
  candidate_id: string;
  document_id: string;
  evidence_version_id: string;
  passage_id: string;
  created_at: string;
}>;

type IngestEvidenceRow = Readonly<{
  proposal_count: number;
  total_count: number;
  replayed: boolean;
}>;

type ReviewEvidenceRow = Readonly<{
  evidence_item_id: string;
  evidence_version_id: string;
  evidence_version_number: number;
  aggregate_version: number;
  replayed: boolean;
}>;

export type CandidateEvidenceDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Omit<
      Database["public"]["Tables"],
      | "source_evidence_passages"
      | "candidate_evidence_items"
      | "candidate_evidence_versions"
      | "candidate_evidence_citations"
    > & {
      source_evidence_passages: EvidenceTable<
        SourceEvidencePassageRow,
        Partial<SourceEvidencePassageRow> &
          Pick<
            SourceEvidencePassageRow,
            | "workspace_id"
            | "candidate_id"
            | "document_id"
            | "document_version_id"
            | "text_review_id"
            | "stable_key"
            | "ordinal"
            | "evidence_category"
            | "start_offset"
            | "end_offset"
            | "excerpt"
            | "excerpt_sha256"
            | "segmenter_release"
          >,
        Partial<SourceEvidencePassageRow>
      >;
      candidate_evidence_items: EvidenceTable<
        CandidateEvidenceItemRow,
        Partial<CandidateEvidenceItemRow> &
          Pick<
            CandidateEvidenceItemRow,
            | "workspace_id"
            | "candidate_id"
            | "document_id"
            | "text_review_id"
            | "primary_source_passage_id"
            | "evidence_key"
            | "evidence_category"
          >,
        Partial<CandidateEvidenceItemRow>
      >;
      candidate_evidence_versions: EvidenceTable<
        CandidateEvidenceVersionRow,
        Partial<CandidateEvidenceVersionRow> &
          Pick<
            CandidateEvidenceVersionRow,
            | "workspace_id"
            | "candidate_id"
            | "document_id"
            | "evidence_item_id"
            | "version_number"
            | "claim_text"
            | "claim_sha256"
            | "usage_policy"
            | "candidate_disposition"
            | "review_kind"
            | "created_by"
          >,
        Partial<CandidateEvidenceVersionRow>
      >;
      candidate_evidence_citations: EvidenceTable<
        CandidateEvidenceCitationRow,
        Partial<CandidateEvidenceCitationRow> &
          Pick<
            CandidateEvidenceCitationRow,
            | "workspace_id"
            | "candidate_id"
            | "document_id"
            | "evidence_version_id"
            | "passage_id"
          >,
        Partial<CandidateEvidenceCitationRow>
      >;
    };
    Functions: Omit<
      Database["public"]["Functions"],
      | "ingest_resume_evidence_proposals"
      | "record_resume_extraction"
      | "review_candidate_evidence_item"
    > & {
      record_resume_extraction: {
        Args: {
          p_attempt_number: number;
          p_document_version_id: string;
          p_extracted_text: string | null;
          p_extractor_kind: string;
          p_extractor_release: string;
          p_failure_code: string | null;
          p_language_code: string | null;
          p_output_schema_version: string;
          p_page_count: number | null;
          p_source_sha256: string;
          p_started_at: string;
          p_status: string;
          p_text_sha256: string | null;
          p_warnings: Json;
        };
        Returns: Database["public"]["Functions"]["record_resume_extraction"]["Returns"];
      };
      ingest_resume_evidence_proposals: {
        Args: {
          p_command_id: string;
          p_text_review_id: string;
          p_segmenter_release: string;
          p_passages: Json;
        };
        Returns: IngestEvidenceRow[];
      };
      review_candidate_evidence_item: {
        Args: {
          p_command_id: string;
          p_evidence_item_id: string;
          p_expected_aggregate_version: number;
          p_disposition: string;
          p_claim_text: string;
          p_usage_policy: string;
          p_candidate_attested?: boolean;
        };
        Returns: ReviewEvidenceRow[];
      };
    };
  };
};

export type CandidateEvidenceAcceptanceConfig = Readonly<{
  url: string;
  publishableKey: string;
  secretKey: string;
  expectedProjectRef: typeof CANDIDATE_EVIDENCE_PROJECT_REF;
  runId: string;
  keepArtifacts: boolean;
}>;

export type CandidateEvidenceCleanupIdentity = Readonly<{
  label: CandidateEvidenceLabel;
  userId: string;
  email: string;
  workspaceId: string;
  candidateId: string;
  workspaceName: string;
}>;

export type CandidateEvidenceCleanupRecord = Readonly<{
  schemaVersion: typeof CANDIDATE_EVIDENCE_CLEANUP_SCHEMA_VERSION;
  runId: string;
  projectRef: typeof CANDIDATE_EVIDENCE_PROJECT_REF;
  createdAt: string;
  identities: readonly CandidateEvidenceCleanupIdentity[];
  storageObjectPaths: readonly string[];
}>;

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

function readCandidateEvidenceHostedConfig(
  environment: NodeJS.ProcessEnv,
): CandidateEvidenceAcceptanceConfig {
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
  if (expectedProjectRef !== CANDIDATE_EVIDENCE_PROJECT_REF) {
    throw new AcceptanceFailure(
      "HIREWIRE_PROJECT_REF_REQUIRED: pin the hosted HireWire project explicitly",
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
    parsedUrl.hostname !== `${CANDIDATE_EVIDENCE_PROJECT_REF}.supabase.co`
  ) {
    throw new AcceptanceFailure(
      "SUPABASE_PROJECT_MISMATCH: URL does not match the hosted HireWire project",
    );
  }

  return Object.freeze({
    url: parsedUrl.toString().replace(/\/$/, ""),
    publishableKey,
    secretKey,
    expectedProjectRef: CANDIDATE_EVIDENCE_PROJECT_REF,
    runId: createAcceptanceRunId(environment.ACCEPTANCE_RUN_ID),
    keepArtifacts: environment.ACCEPTANCE_KEEP_ARTIFACTS === "true",
  });
}

export function requireCandidateEvidenceAcceptanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CandidateEvidenceAcceptanceConfig {
  if (
    environment.RUN_HOSTED_CANDIDATE_EVIDENCE_ACCEPTANCE !==
    CANDIDATE_EVIDENCE_ACCEPTANCE_ACKNOWLEDGEMENT
  ) {
    throw new AcceptanceFailure(
      `REFUSING_TO_RUN: set RUN_HOSTED_CANDIDATE_EVIDENCE_ACCEPTANCE=${CANDIDATE_EVIDENCE_ACCEPTANCE_ACKNOWLEDGEMENT}`,
    );
  }
  return readCandidateEvidenceHostedConfig(environment);
}

export function requireCandidateEvidenceCleanupConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CandidateEvidenceAcceptanceConfig {
  requireCandidateEvidenceCleanupAcknowledgement(environment);
  return readCandidateEvidenceHostedConfig(environment);
}

export function requireCandidateEvidenceCleanupAcknowledgement(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (
    environment.RUN_HOSTED_CANDIDATE_EVIDENCE_CLEANUP !==
    CANDIDATE_EVIDENCE_CLEANUP_ACKNOWLEDGEMENT
  ) {
    throw new AcceptanceFailure(
      `REFUSING_TO_CLEAN: set RUN_HOSTED_CANDIDATE_EVIDENCE_CLEANUP=${CANDIDATE_EVIDENCE_CLEANUP_ACKNOWLEDGEMENT}`,
    );
  }
}

export function candidateEvidenceAcceptanceEmail(
  runId: string,
  label: CandidateEvidenceLabel,
): string {
  return `${CANDIDATE_EVIDENCE_EMAIL_PREFIX}${runId}-${label}@${CANDIDATE_EVIDENCE_EMAIL_DOMAIN}`;
}

export function candidateEvidenceWorkspaceName(
  runId: string,
  label: CandidateEvidenceLabel,
): string {
  return `${CANDIDATE_EVIDENCE_WORKSPACE_PREFIX}${runId} ${label} workspace`;
}

export function assertCandidateEvidenceAcceptanceEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (
    !normalized.startsWith(CANDIDATE_EVIDENCE_EMAIL_PREFIX) ||
    !normalized.endsWith(`@${CANDIDATE_EVIDENCE_EMAIL_DOMAIN}`)
  ) {
    throw new AcceptanceFailure(
      "CLEANUP_REFUSED: identity is not a candidate-evidence acceptance user",
    );
  }
}

export function createCandidateEvidenceAcceptancePassword(): string {
  return createAcceptancePassword();
}

export function createCandidateEvidenceClient(
  config: CandidateEvidenceAcceptanceConfig,
  key: string,
): SupabaseClient<CandidateEvidenceDatabase> {
  return createClient<CandidateEvidenceDatabase>(config.url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    db: { retry: false, timeout: REQUEST_TIMEOUT_MS },
    global: {
      fetch: fetchWithDeadline,
      headers: {
        "x-roledawn-runtime": "candidate-evidence-acceptance/0.1",
      },
    },
  });
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codePointIndexOf(haystack: string, needle: string): number {
  const haystackPoints = Array.from(haystack);
  const needlePoints = Array.from(needle);
  if (needlePoints.length === 0 || needlePoints.length > haystackPoints.length) {
    return -1;
  }
  for (
    let start = 0;
    start <= haystackPoints.length - needlePoints.length;
    start += 1
  ) {
    if (
      needlePoints.every(
        (point, index) => haystackPoints[start + index] === point,
      )
    ) {
      return start;
    }
  }
  return -1;
}

export function buildEvidenceProposalPassage(input: Readonly<{
  textReviewId: string;
  ordinal: number;
  category: CandidateEvidenceCategory;
  reviewedText: string;
  excerpt: string;
}>): EvidenceProposalPassage {
  if (!UUID_PATTERN.test(input.textReviewId)) {
    throw new AcceptanceFailure("EVIDENCE_FIXTURE_REVIEW_ID_INVALID");
  }
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0 || input.ordinal > 249) {
    throw new AcceptanceFailure("EVIDENCE_FIXTURE_ORDINAL_INVALID");
  }
  const startOffset = codePointIndexOf(input.reviewedText, input.excerpt);
  if (startOffset < 0 || input.excerpt.length === 0) {
    throw new AcceptanceFailure("EVIDENCE_FIXTURE_EXCERPT_NOT_FOUND");
  }
  const endOffset = startOffset + Array.from(input.excerpt).length;
  const excerptSha256 = sha256Hex(input.excerpt);
  const stableKey = sha256Hex(
    `${input.textReviewId}\n${startOffset}\n${endOffset}\n${excerptSha256}`,
  );
  if (!SHA256_PATTERN.test(stableKey)) {
    throw new AcceptanceFailure("EVIDENCE_FIXTURE_KEY_INVALID");
  }
  return Object.freeze({
    stable_key: stableKey,
    ordinal: input.ordinal,
    category: input.category,
    start_offset: startOffset,
    end_offset: endOffset,
    excerpt: input.excerpt,
    excerpt_sha256: excerptSha256,
  });
}

export function createCandidateEvidenceCleanupRecord(
  config: CandidateEvidenceAcceptanceConfig,
  identities: readonly CandidateEvidenceCleanupIdentity[],
  storageObjectPaths: readonly string[],
): CandidateEvidenceCleanupRecord {
  return Object.freeze({
    schemaVersion: CANDIDATE_EVIDENCE_CLEANUP_SCHEMA_VERSION,
    runId: config.runId,
    projectRef: CANDIDATE_EVIDENCE_PROJECT_REF,
    createdAt: new Date().toISOString(),
    identities: Object.freeze(identities.map((identity) => Object.freeze({
      label: identity.label,
      userId: identity.userId,
      email: identity.email,
      workspaceId: identity.workspaceId,
      candidateId: identity.candidateId,
      workspaceName: identity.workspaceName,
    }))),
    storageObjectPaths: Object.freeze([...storageObjectPaths]),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCandidateEvidenceCleanupRecord(
  value: unknown,
): CandidateEvidenceCleanupRecord {
  if (!isRecord(value)) {
    throw new AcceptanceFailure("CLEANUP_RECORD_INVALID");
  }
  const runId = typeof value.runId === "string" ? value.runId : "";
  if (
    value.schemaVersion !== CANDIDATE_EVIDENCE_CLEANUP_SCHEMA_VERSION ||
    value.projectRef !== CANDIDATE_EVIDENCE_PROJECT_REF ||
    !runId ||
    createAcceptanceRunId(runId) !== runId ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !Array.isArray(value.identities) ||
    value.identities.length < 1 ||
    value.identities.length > 2 ||
    !Array.isArray(value.storageObjectPaths) ||
    value.storageObjectPaths.length > 4
  ) {
    throw new AcceptanceFailure("CLEANUP_RECORD_INVALID");
  }

  const labels = new Set<string>();
  const workspaceIds = new Set<string>();
  const identities = value.identities.map((entry) => {
    if (
      !isRecord(entry) ||
      (entry.label !== "alpha" && entry.label !== "beta") ||
      labels.has(entry.label)
    ) {
      throw new AcceptanceFailure("CLEANUP_RECORD_IDENTITY_INVALID");
    }
    labels.add(entry.label);
    const expectedEmail = candidateEvidenceAcceptanceEmail(runId, entry.label);
    const expectedWorkspaceName = candidateEvidenceWorkspaceName(
      runId,
      entry.label,
    );
    if (
      typeof entry.userId !== "string" ||
      !UUID_PATTERN.test(entry.userId) ||
      typeof entry.workspaceId !== "string" ||
      !UUID_PATTERN.test(entry.workspaceId) ||
      typeof entry.candidateId !== "string" ||
      !UUID_PATTERN.test(entry.candidateId) ||
      entry.email !== expectedEmail ||
      entry.workspaceName !== expectedWorkspaceName ||
      workspaceIds.has(entry.workspaceId)
    ) {
      throw new AcceptanceFailure("CLEANUP_RECORD_IDENTITY_INVALID");
    }
    workspaceIds.add(entry.workspaceId);
    assertCandidateEvidenceAcceptanceEmail(entry.email);
    return Object.freeze({
      label: entry.label,
      userId: entry.userId,
      email: entry.email,
      workspaceId: entry.workspaceId,
      candidateId: entry.candidateId,
      workspaceName: entry.workspaceName,
    });
  });

  const pathSet = new Set<string>();
  const storageObjectPaths = value.storageObjectPaths.map((entry) => {
    if (
      typeof entry !== "string" ||
      pathSet.has(entry) ||
      entry.includes("\\") ||
      entry.includes("%") ||
      entry.startsWith("/") ||
      entry.endsWith("/") ||
      entry.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      throw new AcceptanceFailure("CLEANUP_RECORD_STORAGE_PATH_INVALID");
    }
    const match = entry.match(
      /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/resumes\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.pdf$/,
    );
    if (
      !match ||
      !UUID_PATTERN.test(match[1]!) ||
      !UUID_PATTERN.test(match[2]!) ||
      !UUID_PATTERN.test(match[3]!) ||
      !UUID_PATTERN.test(match[4]!) ||
      !workspaceIds.has(match[1]!)
    ) {
      throw new AcceptanceFailure("CLEANUP_RECORD_STORAGE_PATH_INVALID");
    }
    pathSet.add(entry);
    return entry;
  });

  return Object.freeze({
    schemaVersion: CANDIDATE_EVIDENCE_CLEANUP_SCHEMA_VERSION,
    runId,
    projectRef: CANDIDATE_EVIDENCE_PROJECT_REF,
    createdAt: value.createdAt,
    identities: Object.freeze(identities),
    storageObjectPaths: Object.freeze(storageObjectPaths),
  });
}

export function safeCandidateEvidenceErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string" && candidate.code) {
    return candidate.code;
  }
  if (typeof candidate.message === "string") {
    const known = candidate.message.match(
      /AUTHENTICATION_REQUIRED|COMMAND_ID_PAYLOAD_MISMATCH|EVIDENCE_[A-Z_]+|CANDIDATE_EVIDENCE_[A-Z_]+|SOURCE_DOCUMENT_[A-Z_]+|user_not_found|PGRST\d+/,
    );
    return known?.[0] ?? "REMOTE_ERROR";
  }
  return "UNKNOWN";
}
