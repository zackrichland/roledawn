import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";
import {
  AcceptanceFailure,
  safeErrorCode,
} from "./milestone-zero-acceptance-lib.ts";

const ACCEPTANCE_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_CREATES_TEST_DATA";
const CLEANUP_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_PERMANENTLY_DELETES_ACCEPTANCE_DATA";
const ACCEPTANCE_EMAIL_PREFIX = "roledawn-vault-acceptance-";
const ACCEPTANCE_EMAIL_DOMAIN = "acceptance.invalid";
const WORKSPACE_NAME_PREFIX = "RoleDawn Vault ";
const VAULT_BUCKET = "career-vault";
const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");
const REQUEST_TIMEOUT_MS = 20_000;
const STAGE_TIMEOUT_MS = 90_000;
const MAX_TRACKED_PATHS = 16;
const MAX_STORAGE_OBJECTS = 32;
const MAX_STORAGE_DEPTH = 8;
const STORAGE_PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const SECRET_PLACEHOLDERS = new Set([
  "your-server-only-supabase-secret-key",
  "your-supabase-secret-key",
]);

type CandidateLabel = "alpha" | "beta";

type CleanupIdentity = Readonly<{
  label: CandidateLabel;
  userId: string;
  email: string;
  workspaceId: string;
}>;

type CleanupRecord = Readonly<{
  runId: string;
  projectRef: string;
  createdAt: string;
  identities: readonly CleanupIdentity[];
  storageObjectPaths: readonly string[];
}>;

type CleanupConfig = Readonly<{
  url: string;
  secretKey: string;
  expectedProjectRef: string;
}>;

type ParsedStoragePath = Readonly<{
  path: string;
  workspaceId: string;
  candidateId: string;
  documentId: string;
  versionId: string;
}>;

type PreflightIdentity = Readonly<{
  identity: CleanupIdentity;
  user: User | null;
  workspaceExists: boolean;
  candidateId: string | null;
  documentIds: readonly string[];
  existingPaths: readonly string[];
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  failureCode: string,
): T {
  if (result.status === "rejected") {
    throw new AcceptanceFailure(failureCode);
  }
  return result.value;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function expectedEmail(runId: string, label: CandidateLabel): string {
  return `${ACCEPTANCE_EMAIL_PREFIX}${runId}-${label}@${ACCEPTANCE_EMAIL_DOMAIN}`;
}

function expectedDisplayName(runId: string, label: CandidateLabel): string {
  return `${WORKSPACE_NAME_PREFIX}${runId} ${label}`;
}

function expectedWorkspaceName(runId: string, label: CandidateLabel): string {
  return `${expectedDisplayName(runId, label)} workspace`;
}

function validateStoragePath(
  value: string,
  allowedWorkspaceIds: ReadonlySet<string>,
): ParsedStoragePath {
  if (
    value.includes("\\") ||
    value.includes("%") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new AcceptanceFailure("CLEANUP_RECORD_STORAGE_PATH_INVALID");
  }
  const match = value.match(
    /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/resumes\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(?:pdf|docx)$/,
  );
  if (
    !match ||
    !UUID_PATTERN.test(match[1]!) ||
    !UUID_PATTERN.test(match[2]!) ||
    !UUID_PATTERN.test(match[3]!) ||
    !UUID_PATTERN.test(match[4]!) ||
    !allowedWorkspaceIds.has(match[1]!)
  ) {
    throw new AcceptanceFailure("CLEANUP_RECORD_STORAGE_PATH_INVALID");
  }
  return Object.freeze({
    path: value,
    workspaceId: match[1]!,
    candidateId: match[2]!,
    documentId: match[3]!,
    versionId: match[4]!,
  });
}

function validateRecord(value: unknown, filename: string): CleanupRecord {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "runId",
      "projectRef",
      "createdAt",
      "identities",
      "storageObjectPaths",
    ]) ||
    typeof value.runId !== "string" ||
    !RUN_ID_PATTERN.test(value.runId) ||
    filename !== `vault-${value.runId}-cleanup.json` ||
    typeof value.projectRef !== "string" ||
    !PROJECT_REF_PATTERN.test(value.projectRef) ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    !Array.isArray(value.identities) ||
    value.identities.length < 1 ||
    value.identities.length > 2 ||
    !Array.isArray(value.storageObjectPaths) ||
    value.storageObjectPaths.length > MAX_TRACKED_PATHS
  ) {
    throw new AcceptanceFailure("CLEANUP_RECORD_INVALID");
  }

  const labels = new Set<string>();
  const userIds = new Set<string>();
  const workspaceIds = new Set<string>();
  const identities = value.identities.map((entry): CleanupIdentity => {
    if (
      !isPlainObject(entry) ||
      !hasExactKeys(entry, ["label", "userId", "email", "workspaceId"]) ||
      (entry.label !== "alpha" && entry.label !== "beta") ||
      typeof entry.userId !== "string" ||
      !UUID_PATTERN.test(entry.userId) ||
      typeof entry.workspaceId !== "string" ||
      !UUID_PATTERN.test(entry.workspaceId) ||
      typeof entry.email !== "string" ||
      entry.email !== expectedEmail(value.runId as string, entry.label) ||
      labels.has(entry.label) ||
      userIds.has(entry.userId) ||
      workspaceIds.has(entry.workspaceId)
    ) {
      throw new AcceptanceFailure("CLEANUP_RECORD_IDENTITY_INVALID");
    }
    labels.add(entry.label);
    userIds.add(entry.userId);
    workspaceIds.add(entry.workspaceId);
    return Object.freeze({
      label: entry.label,
      userId: entry.userId,
      email: entry.email,
      workspaceId: entry.workspaceId,
    });
  });

  const pathSet = new Set<string>();
  const storageObjectPaths = value.storageObjectPaths.map((entry) => {
    if (typeof entry !== "string" || pathSet.has(entry)) {
      throw new AcceptanceFailure("CLEANUP_RECORD_STORAGE_PATH_INVALID");
    }
    pathSet.add(entry);
    validateStoragePath(entry, workspaceIds);
    return entry;
  });

  return Object.freeze({
    runId: value.runId,
    projectRef: value.projectRef,
    createdAt: value.createdAt,
    identities: Object.freeze(identities),
    storageObjectPaths: Object.freeze(storageObjectPaths),
  });
}

function requireConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CleanupConfig {
  if (
    environment.RUN_HOSTED_CAREER_VAULT_ACCEPTANCE !==
      ACCEPTANCE_ACKNOWLEDGEMENT ||
    environment.RUN_HOSTED_CAREER_VAULT_CLEANUP !== CLEANUP_ACKNOWLEDGEMENT
  ) {
    throw new AcceptanceFailure("REFUSING_TO_RUN_CAREER_VAULT_CLEANUP");
  }
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim() ?? "";
  const expectedProjectRef =
    environment.ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase() ??
    "";
  if (
    !url ||
    !secretKey ||
    SECRET_PLACEHOLDERS.has(secretKey) ||
    !PROJECT_REF_PATTERN.test(expectedProjectRef)
  ) {
    throw new AcceptanceFailure("CLEANUP_CONFIG_INVALID");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AcceptanceFailure("CLEANUP_CONFIG_INVALID");
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== `${expectedProjectRef}.supabase.co`
  ) {
    throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
  }
  return Object.freeze({
    url: parsedUrl.toString().replace(/\/$/, ""),
    secretKey,
    expectedProjectRef,
  });
}

function createAdminClient(config: CleanupConfig): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    db: { retry: false, timeout: REQUEST_TIMEOUT_MS },
    global: {
      fetch: fetchWithDeadline,
      headers: { "x-roledawn-runtime": "career-vault-cleanup/0.1" },
    },
  });
}

function isUserMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  return (
    candidate.code === "user_not_found" ||
    candidate.status === 404 ||
    (typeof candidate.message === "string" &&
      candidate.message.toLowerCase().includes("user not found"))
  );
}

async function listStorageObjects(
  admin: SupabaseClient<Database>,
  prefix: string,
  depth = 0,
  found: string[] = [],
): Promise<string[]> {
  if (depth > MAX_STORAGE_DEPTH) {
    throw new AcceptanceFailure("CLEANUP_STORAGE_DEPTH_EXCEEDED");
  }
  let offset = 0;
  while (true) {
    const listed = await admin.storage.from(VAULT_BUCKET).list(prefix, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (listed.error) {
      throw new AcceptanceFailure(
        `CLEANUP_STORAGE_LIST_FAILED:${safeErrorCode(listed.error)}`,
      );
    }
    const entries = listed.data ?? [];
    for (const entry of entries) {
      const fullPath = `${prefix}/${entry.name}`;
      if (entry.id) {
        found.push(fullPath);
        if (found.length > MAX_STORAGE_OBJECTS) {
          throw new AcceptanceFailure("CLEANUP_STORAGE_OBJECT_LIMIT_EXCEEDED");
        }
      } else {
        await listStorageObjects(admin, fullPath, depth + 1, found);
      }
    }
    if (entries.length < STORAGE_PAGE_SIZE) break;
    offset += STORAGE_PAGE_SIZE;
  }
  return found;
}

async function assertPathEvidence(
  admin: SupabaseClient<Database>,
  identity: CleanupIdentity,
  candidateId: string | null,
  parsed: ParsedStoragePath,
  objectExists: boolean,
): Promise<void> {
  if (candidateId && parsed.candidateId !== candidateId) {
    throw new AcceptanceFailure(
      `CLEANUP_PATH_CANDIDATE_MISMATCH:${identity.label}`,
    );
  }
  const [reservation, version] = await Promise.all([
    admin
      .from("source_document_upload_reservations")
      .select(
        "workspace_id, candidate_id, document_id, document_version_id, storage_bucket, storage_object_path, reserved_by, status",
      )
      .eq("storage_bucket", VAULT_BUCKET)
      .eq("storage_object_path", parsed.path)
      .maybeSingle(),
    admin
      .from("source_document_versions")
      .select(
        "id, workspace_id, candidate_id, document_id, storage_bucket, storage_object_path, created_by",
      )
      .eq("storage_bucket", VAULT_BUCKET)
      .eq("storage_object_path", parsed.path)
      .maybeSingle(),
  ]);
  if (reservation.error || version.error) {
    throw new AcceptanceFailure(
      `CLEANUP_PATH_EVIDENCE_LOOKUP_FAILED:${identity.label}`,
    );
  }
  const reservationMatches =
    !reservation.data ||
    (reservation.data.workspace_id === identity.workspaceId &&
      reservation.data.candidate_id === parsed.candidateId &&
      reservation.data.document_id === parsed.documentId &&
      reservation.data.document_version_id === parsed.versionId &&
      reservation.data.storage_bucket === VAULT_BUCKET &&
      reservation.data.storage_object_path === parsed.path &&
      reservation.data.reserved_by === identity.userId);
  const versionMatches =
    !version.data ||
    (version.data.id === parsed.versionId &&
      version.data.workspace_id === identity.workspaceId &&
      version.data.candidate_id === parsed.candidateId &&
      version.data.document_id === parsed.documentId &&
      version.data.storage_bucket === VAULT_BUCKET &&
      version.data.storage_object_path === parsed.path &&
      version.data.created_by === identity.userId);
  if (!reservationMatches || !versionMatches) {
    throw new AcceptanceFailure(
      `CLEANUP_PATH_EVIDENCE_MISMATCH:${identity.label}`,
    );
  }
  if (
    (version.data && !reservation.data) ||
    (reservation.data?.status === "FINALIZED" && !version.data) ||
    (objectExists && !reservation.data && !version.data)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_PATH_EVIDENCE_INCOMPLETE:${identity.label}`,
    );
  }
}

async function preflightIdentity(
  admin: SupabaseClient<Database>,
  record: CleanupRecord,
  identity: CleanupIdentity,
): Promise<PreflightIdentity> {
  const expectedName = expectedDisplayName(record.runId, identity.label);
  const expectedTenantName = expectedWorkspaceName(
    record.runId,
    identity.label,
  );
  const results = await Promise.allSettled([
      admin.auth.admin.getUserById(identity.userId),
      admin
        .from("workspaces")
        .select("id, name, kind, status, personal_owner_auth_user_id")
        .eq("id", identity.workspaceId)
        .maybeSingle(),
      admin
        .from("workspace_memberships")
        .select("auth_user_id, role, status")
        .eq("workspace_id", identity.workspaceId),
      admin
        .from("candidates")
        .select("id, auth_user_id, display_name")
        .eq("workspace_id", identity.workspaceId),
      admin
        .from("source_documents")
        .select("id, candidate_id")
        .eq("workspace_id", identity.workspaceId),
      listStorageObjects(admin, identity.workspaceId),
    ] as const);
  const failureCode =
    `CLEANUP_IDENTITY_PREFLIGHT_REQUEST_FAILED:${identity.label}`;
  const fetched = settledValue(results[0], failureCode);
  const workspace = settledValue(results[1], failureCode);
  const memberships = settledValue(results[2], failureCode);
  const candidates = settledValue(results[3], failureCode);
  const documents = settledValue(results[4], failureCode);
  const storagePaths = settledValue(results[5], failureCode);

  if (
    workspace.error ||
    memberships.error ||
    candidates.error ||
    documents.error
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_IDENTITY_PREFLIGHT_QUERY_FAILED:${identity.label}`,
    );
  }
  const user = fetched.error ? null : fetched.data.user;
  if (fetched.error && !isUserMissing(fetched.error)) {
    throw new AcceptanceFailure(
      `CLEANUP_AUTH_PREFLIGHT_FAILED:${identity.label}:${safeErrorCode(fetched.error)}`,
    );
  }
  if (
    user &&
    (user.email?.toLowerCase() !== identity.email ||
      user.app_metadata.roledawn_acceptance_run_id !== record.runId ||
      user.user_metadata.acceptance_run_id !== record.runId ||
      user.user_metadata.display_name !== expectedName)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_AUTH_IDENTITY_MISMATCH:${identity.label}`,
    );
  }

  const membershipRows = memberships.data ?? [];
  const candidateRows = candidates.data ?? [];
  const documentRows = documents.data ?? [];
  const workspaceExists = workspace.data !== null;
  if (
    workspace.data &&
    (workspace.data.name !== expectedTenantName ||
      workspace.data.kind !== "PERSONAL" ||
      workspace.data.personal_owner_auth_user_id !== identity.userId)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_WORKSPACE_IDENTITY_MISMATCH:${identity.label}`,
    );
  }
  if (workspaceExists && !user) {
    throw new AcceptanceFailure(
      `CLEANUP_INCONSISTENT_WORKSPACE_WITHOUT_USER:${identity.label}`,
    );
  }
  if (
    workspaceExists &&
    (membershipRows.length !== 1 ||
      membershipRows[0]?.auth_user_id !== identity.userId ||
      membershipRows[0]?.role !== "OWNER" ||
      membershipRows[0]?.status !== "ACTIVE" ||
      candidateRows.length !== 1 ||
      candidateRows[0]?.auth_user_id !== identity.userId ||
      candidateRows[0]?.display_name !== expectedName)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_WORKSPACE_SCOPE_MISMATCH:${identity.label}`,
    );
  }
  if (
    !workspaceExists &&
    (membershipRows.length !== 0 || candidateRows.length !== 0)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_ORPHAN_TENANT_ROWS:${identity.label}`,
    );
  }

  const trackedForWorkspace = record.storageObjectPaths.filter((path) =>
    path.startsWith(`${identity.workspaceId}/`),
  );
  const trackedSet = new Set(trackedForWorkspace);
  const untracked = storagePaths.filter((path) => !trackedSet.has(path));
  if (untracked.length > 0) {
    throw new AcceptanceFailure(
      `CLEANUP_UNTRACKED_STORAGE_OBJECTS:${identity.label}`,
    );
  }
  if (!workspaceExists && storagePaths.length > 0) {
    throw new AcceptanceFailure(
      `CLEANUP_INCONSISTENT_ORPHAN_STORAGE:${identity.label}`,
    );
  }

  const candidateId = candidateRows[0]?.id ?? null;
  if (
    documentRows.some((document) => document.candidate_id !== candidateId)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_DOCUMENT_SCOPE_MISMATCH:${identity.label}`,
    );
  }
  for (const path of trackedForWorkspace) {
    const parsed = validateStoragePath(path, new Set([identity.workspaceId]));
    await assertPathEvidence(
      admin,
      identity,
      candidateId,
      parsed,
      storagePaths.includes(path),
    );
  }

  return Object.freeze({
    identity,
    user,
    workspaceExists,
    candidateId,
    documentIds: Object.freeze(documentRows.map((document) => document.id)),
    existingPaths: Object.freeze(storagePaths),
  });
}

async function validateRecordFile(recordPath: string): Promise<CleanupRecord> {
  const resolvedPath = resolve(recordPath);
  const [artifactDirectory, recordRealPath, stats] = await Promise.all([
    realpath(ARTIFACT_DIRECTORY),
    realpath(resolvedPath),
    lstat(resolvedPath),
  ]);
  if (
    dirname(recordRealPath) !== artifactDirectory ||
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    (stats.mode & 0o022) !== 0
  ) {
    throw new AcceptanceFailure("CLEANUP_RECORD_FILE_UNSAFE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(recordRealPath, "utf8"));
  } catch {
    throw new AcceptanceFailure("CLEANUP_RECORD_UNREADABLE");
  }
  return validateRecord(parsed, basename(recordRealPath));
}

async function main(): Promise<void> {
  const recordPath = process.argv[2];
  if (!recordPath || process.argv.length !== 3) {
    throw new AcceptanceFailure(
      "USAGE: npm run acceptance:vault:cleanup -- artifacts/acceptance/vault-<run>-cleanup.json",
    );
  }
  const config = requireConfig();
  const record = await runStage("cleanup-record", () =>
    validateRecordFile(recordPath),
  );
  if (record.projectRef !== config.expectedProjectRef) {
    throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
  }
  process.stdout.write(
    `PASS cleanup-record — project=${record.projectRef} run=${record.runId} identities=${record.identities.length} tracked=${record.storageObjectPaths.length}\n`,
  );

  const admin = createAdminClient(config);
  const preflight = await runStage("cleanup-preflight", () =>
    Promise.all(
      record.identities.map((identity) =>
        preflightIdentity(admin, record, identity),
      ),
    ),
  );
  const existingPaths = preflight.flatMap((entry) => entry.existingPaths);
  process.stdout.write(
    `PASS cleanup-preflight — identities=${preflight.length} existing-storage=${existingPaths.length}\n`,
  );

  await runStage("cleanup-storage", async () => {
    if (existingPaths.length > 0) {
      const removed = await admin.storage
        .from(VAULT_BUCKET)
        .remove(existingPaths);
      if (removed.error) {
        throw new AcceptanceFailure(
          `CLEANUP_STORAGE_REMOVE_FAILED:${safeErrorCode(removed.error)}`,
        );
      }
    }
    for (const entry of preflight) {
      const remaining = await listStorageObjects(
        admin,
        entry.identity.workspaceId,
      );
      if (remaining.length > 0) {
        throw new AcceptanceFailure(
          `CLEANUP_STORAGE_POSTCHECK_FAILED:${entry.identity.label}`,
        );
      }
    }
  });
  process.stdout.write(
    `PASS cleanup-storage — removed=${existingPaths.length} remaining=0\n`,
  );

  for (const entry of preflight) {
    await runStage(`cleanup-documents-${entry.identity.label}`, async () => {
      for (const documentId of entry.documentIds) {
        const document = await admin
          .from("source_documents")
          .select("status, aggregate_version")
          .eq("id", documentId)
          .eq("workspace_id", entry.identity.workspaceId)
          .single();
        if (document.error) {
          throw new AcceptanceFailure(
            `CLEANUP_DOCUMENT_LOOKUP_FAILED:${entry.identity.label}:${safeErrorCode(document.error)}`,
          );
        }
        if (document.data.status !== "DELETION_PENDING") {
          if (!entry.user) {
            throw new AcceptanceFailure(
              `CLEANUP_DOCUMENT_OWNER_MISSING:${entry.identity.label}`,
            );
          }
          const actorClient = createClient<Database>(
            config.url,
            config.secretKey,
            {
              auth: {
                autoRefreshToken: false,
                detectSessionInUrl: false,
                persistSession: false,
              },
              db: { retry: false, timeout: REQUEST_TIMEOUT_MS },
              global: { fetch: fetchWithDeadline },
            },
          );
          const passwordless = await admin.auth.admin.generateLink({
            type: "magiclink",
            email: entry.identity.email,
          });
          if (passwordless.error || !passwordless.data.properties?.hashed_token) {
            throw new AcceptanceFailure(
              `CLEANUP_ACTOR_SESSION_CREATE_FAILED:${entry.identity.label}:${safeErrorCode(passwordless.error)}`,
            );
          }
          const verified = await actorClient.auth.verifyOtp({
            type: "magiclink",
            token_hash: passwordless.data.properties.hashed_token,
          });
          if (verified.error || verified.data.user?.id !== entry.identity.userId) {
            throw new AcceptanceFailure(
              `CLEANUP_ACTOR_SESSION_FAILED:${entry.identity.label}:${safeErrorCode(verified.error)}`,
            );
          }
          const requested = await actorClient.rpc(
            "request_source_document_deletion",
            {
              p_command_id: crypto.randomUUID(),
              p_document_id: documentId,
              p_expected_aggregate_version: document.data.aggregate_version,
            },
          );
          if (requested.error) {
            throw new AcceptanceFailure(
              `CLEANUP_DOCUMENT_REQUEST_FAILED:${entry.identity.label}:${safeErrorCode(requested.error)}`,
            );
          }
          await actorClient.auth.signOut();
        }
        const completed = await admin.rpc(
          "complete_source_document_deletion",
          { p_document_id: documentId },
        );
        if (completed.error || completed.data !== true) {
          throw new AcceptanceFailure(
            `CLEANUP_DOCUMENT_PURGE_FAILED:${entry.identity.label}:${safeErrorCode(completed.error)}`,
          );
        }
      }
      const remaining = await admin
        .from("source_documents")
        .select("id")
        .eq("workspace_id", entry.identity.workspaceId);
      if (remaining.error || remaining.data.length !== 0) {
        throw new AcceptanceFailure(
          `CLEANUP_DOCUMENT_POSTCHECK_FAILED:${entry.identity.label}`,
        );
      }
    });
    process.stdout.write(
      `PASS cleanup-documents-${entry.identity.label} — removed=${entry.documentIds.length}\n`,
    );

    await runStage(`cleanup-workspace-${entry.identity.label}`, async () => {
      if (!entry.workspaceExists) return;
      const removed = await admin
        .from("workspaces")
        .delete()
        .eq("id", entry.identity.workspaceId)
        .eq("personal_owner_auth_user_id", entry.identity.userId)
        .eq("kind", "PERSONAL")
        .eq(
          "name",
          expectedWorkspaceName(record.runId, entry.identity.label),
        )
        .select("id");
      if (removed.error || removed.data.length !== 1) {
        throw new AcceptanceFailure(
          `CLEANUP_WORKSPACE_DELETE_FAILED:${entry.identity.label}:${safeErrorCode(removed.error)}`,
        );
      }
      const remaining = await admin
        .from("workspaces")
        .select("id")
        .eq("id", entry.identity.workspaceId)
        .maybeSingle();
      if (remaining.error || remaining.data) {
        throw new AcceptanceFailure(
          `CLEANUP_WORKSPACE_POSTCHECK_FAILED:${entry.identity.label}`,
        );
      }
    });
    process.stdout.write(
      `PASS cleanup-workspace-${entry.identity.label} — ${entry.workspaceExists ? "removed" : "already-absent"}\n`,
    );

    await runStage(`cleanup-auth-${entry.identity.label}`, async () => {
      if (entry.user) {
        const deleted = await admin.auth.admin.deleteUser(
          entry.identity.userId,
          false,
        );
        if (deleted.error) {
          throw new AcceptanceFailure(
            `CLEANUP_AUTH_DELETE_FAILED:${entry.identity.label}:${safeErrorCode(deleted.error)}`,
          );
        }
      }
      const remaining = await admin.auth.admin.getUserById(
        entry.identity.userId,
      );
      if (!remaining.error || !isUserMissing(remaining.error)) {
        throw new AcceptanceFailure(
          `CLEANUP_AUTH_POSTCHECK_FAILED:${entry.identity.label}`,
        );
      }
    });
    process.stdout.write(
      `PASS cleanup-auth-${entry.identity.label} — ${entry.user ? "removed" : "already-absent"}\n`,
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        projectRef: record.projectRef,
        runId: record.runId,
        identities: preflight.map((entry) => ({
          label: entry.identity.label,
          workspace: entry.workspaceExists ? "removed" : "already-absent",
          auth: entry.user ? "removed" : "already-absent",
        })),
        storage: { removed: existingPaths.length, remaining: 0 },
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof AcceptanceFailure
      ? error.message
      : "UNEXPECTED_CAREER_VAULT_CLEANUP_FAILURE";
  process.stderr.write(`FAIL ${message}\n`);
  process.exitCode = 1;
}
