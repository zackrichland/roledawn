import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";
import {
  AcceptanceFailure,
  createAcceptancePassword,
  createAcceptanceRunId,
} from "./milestone-zero-acceptance-lib.ts";

export const HIREWIRE_PROJECT_REF = "dxrrotrugwhquqxyoisk";
export const PROFILE_ACCEPTANCE_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_CREATES_TEST_DATA";
export const PROFILE_CLEANUP_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_PERMANENTLY_DELETES_ACCEPTANCE_DATA";
export const PROFILE_ACCEPTANCE_EMAIL_PREFIX =
  "roledawn-profile-acceptance-";
export const PROFILE_ACCEPTANCE_EMAIL_DOMAIN = "acceptance.invalid";
export const PROFILE_WORKSPACE_NAME_PREFIX = "RoleDawn Profile ";
export const PROFILE_CLEANUP_SCHEMA_VERSION =
  "candidate-profile-acceptance/v1";

const REQUEST_TIMEOUT_MS = 20_000;
const SECRET_PLACEHOLDERS = new Set([
  "your-server-only-supabase-secret-key",
  "your-supabase-secret-key",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProfileAcceptanceLabel = "alpha" | "beta";

export type CandidateProfileAcceptanceConfig = Readonly<{
  url: string;
  publishableKey: string;
  secretKey: string;
  expectedProjectRef: typeof HIREWIRE_PROJECT_REF;
  runId: string;
  keepArtifacts: boolean;
}>;

export type ProfileCleanupIdentity = Readonly<{
  label: ProfileAcceptanceLabel;
  userId: string;
  email: string;
  workspaceId: string;
  candidateId: string;
  workspaceName: string;
}>;

export type CandidateProfileCleanupRecord = Readonly<{
  schemaVersion: typeof PROFILE_CLEANUP_SCHEMA_VERSION;
  runId: string;
  projectRef: typeof HIREWIRE_PROJECT_REF;
  createdAt: string;
  identities: readonly ProfileCleanupIdentity[];
}>;

type CleanupPreflight = Readonly<{
  identity: ProfileCleanupIdentity;
  authUserExists: boolean;
  workspaceExists: boolean;
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

export function requireCandidateProfileAcceptanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CandidateProfileAcceptanceConfig {
  if (
    environment.RUN_HOSTED_CANDIDATE_PROFILE_ACCEPTANCE !==
    PROFILE_ACCEPTANCE_ACKNOWLEDGEMENT
  ) {
    throw new AcceptanceFailure(
      `REFUSING_TO_RUN: set RUN_HOSTED_CANDIDATE_PROFILE_ACCEPTANCE=${PROFILE_ACCEPTANCE_ACKNOWLEDGEMENT}`,
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
  if (expectedProjectRef !== HIREWIRE_PROJECT_REF) {
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
    parsedUrl.hostname !== `${HIREWIRE_PROJECT_REF}.supabase.co`
  ) {
    throw new AcceptanceFailure(
      "SUPABASE_PROJECT_MISMATCH: URL does not match the hosted HireWire project",
    );
  }

  return Object.freeze({
    url: parsedUrl.toString().replace(/\/$/, ""),
    publishableKey,
    secretKey,
    expectedProjectRef: HIREWIRE_PROJECT_REF,
    runId: createAcceptanceRunId(environment.ACCEPTANCE_RUN_ID),
    keepArtifacts: environment.ACCEPTANCE_KEEP_ARTIFACTS === "true",
  });
}

export function requireCandidateProfileCleanupAcknowledgement(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (
    environment.RUN_HOSTED_CANDIDATE_PROFILE_CLEANUP !==
    PROFILE_CLEANUP_ACKNOWLEDGEMENT
  ) {
    throw new AcceptanceFailure(
      `REFUSING_TO_CLEAN: set RUN_HOSTED_CANDIDATE_PROFILE_CLEANUP=${PROFILE_CLEANUP_ACKNOWLEDGEMENT}`,
    );
  }
}

export function profileAcceptanceEmail(
  runId: string,
  label: ProfileAcceptanceLabel,
): string {
  return `${PROFILE_ACCEPTANCE_EMAIL_PREFIX}${runId}-${label}@${PROFILE_ACCEPTANCE_EMAIL_DOMAIN}`;
}

export function profileWorkspaceName(
  runId: string,
  label: ProfileAcceptanceLabel,
): string {
  return `${PROFILE_WORKSPACE_NAME_PREFIX}${runId} ${label}`;
}

export function assertProfileAcceptanceEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (
    !normalized.startsWith(PROFILE_ACCEPTANCE_EMAIL_PREFIX) ||
    !normalized.endsWith(`@${PROFILE_ACCEPTANCE_EMAIL_DOMAIN}`)
  ) {
    throw new AcceptanceFailure(
      "CLEANUP_REFUSED: identity is not a candidate-profile acceptance user",
    );
  }
}

export function createProfileAcceptancePassword(): string {
  return createAcceptancePassword();
}

export function createProfileClient(
  config: CandidateProfileAcceptanceConfig,
  key: string,
): SupabaseClient<Database> {
  return createClient<Database>(config.url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    db: { retry: false, timeout: REQUEST_TIMEOUT_MS },
    global: {
      fetch: fetchWithDeadline,
      headers: {
        "x-roledawn-runtime": "candidate-profile-acceptance/0.1",
      },
    },
  });
}

export function createCandidateProfileCleanupRecord(
  config: CandidateProfileAcceptanceConfig,
  identities: readonly ProfileCleanupIdentity[],
): CandidateProfileCleanupRecord {
  return Object.freeze({
    schemaVersion: PROFILE_CLEANUP_SCHEMA_VERSION,
    runId: config.runId,
    projectRef: HIREWIRE_PROJECT_REF,
    createdAt: new Date().toISOString(),
    identities: Object.freeze(
      identities.map((identity) =>
        Object.freeze({
          label: identity.label,
          userId: identity.userId,
          email: identity.email,
          workspaceId: identity.workspaceId,
          candidateId: identity.candidateId,
          workspaceName: identity.workspaceName,
        }),
      ),
    ),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCandidateProfileCleanupRecord(
  value: unknown,
): CandidateProfileCleanupRecord {
  if (!isRecord(value)) {
    throw new AcceptanceFailure("CLEANUP_RECORD_INVALID");
  }
  const runId = typeof value.runId === "string" ? value.runId : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : "";
  if (
    value.schemaVersion !== PROFILE_CLEANUP_SCHEMA_VERSION ||
    value.projectRef !== HIREWIRE_PROJECT_REF ||
    !runId ||
    createAcceptanceRunId(runId) !== runId ||
    !createdAt ||
    Number.isNaN(Date.parse(createdAt)) ||
    !Array.isArray(value.identities) ||
    value.identities.length < 1 ||
    value.identities.length > 2
  ) {
    throw new AcceptanceFailure("CLEANUP_RECORD_INVALID");
  }

  const seenLabels = new Set<string>();
  const identities = value.identities.map((entry) => {
    if (!isRecord(entry) || (entry.label !== "alpha" && entry.label !== "beta")) {
      throw new AcceptanceFailure("CLEANUP_RECORD_IDENTITY_INVALID");
    }
    if (seenLabels.has(entry.label)) {
      throw new AcceptanceFailure("CLEANUP_RECORD_IDENTITY_DUPLICATE");
    }
    seenLabels.add(entry.label);
    const label = entry.label;
    const expectedEmail = profileAcceptanceEmail(runId, label);
    const expectedWorkspaceName = `${profileWorkspaceName(runId, label)} workspace`;
    if (
      typeof entry.userId !== "string" ||
      !UUID_PATTERN.test(entry.userId) ||
      typeof entry.workspaceId !== "string" ||
      !UUID_PATTERN.test(entry.workspaceId) ||
      typeof entry.candidateId !== "string" ||
      !UUID_PATTERN.test(entry.candidateId) ||
      entry.email !== expectedEmail ||
      entry.workspaceName !== expectedWorkspaceName
    ) {
      throw new AcceptanceFailure("CLEANUP_RECORD_IDENTITY_INVALID");
    }
    assertProfileAcceptanceEmail(entry.email);
    return Object.freeze({
      label,
      userId: entry.userId,
      email: entry.email,
      workspaceId: entry.workspaceId,
      candidateId: entry.candidateId,
      workspaceName: entry.workspaceName,
    });
  });

  return Object.freeze({
    schemaVersion: PROFILE_CLEANUP_SCHEMA_VERSION,
    runId,
    projectRef: HIREWIRE_PROJECT_REF,
    createdAt,
    identities: Object.freeze(identities),
  });
}

export function safeProfileErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string" && candidate.code) {
    return candidate.code;
  }
  if (typeof candidate.message === "string") {
    const known = candidate.message.match(
      /AUTHENTICATION_REQUIRED|COMMAND_ID_PAYLOAD_MISMATCH|CANDIDATE_FACT_[A-Z_]+|ACTIVE_CANDIDATE_[A-Z_]+|user_not_found|PGRST\d+/,
    );
    return known?.[0] ?? "REMOTE_ERROR";
  }
  return "UNKNOWN";
}

function authMetadataMatches(
  value: unknown,
  runId: string,
): boolean {
  return (
    isRecord(value) && value.roledawn_acceptance_run_id === runId
  );
}

async function preflightCleanup(
  config: CandidateProfileAcceptanceConfig,
  record: CandidateProfileCleanupRecord,
): Promise<readonly CleanupPreflight[]> {
  const admin = createProfileClient(config, config.secretKey);
  const preflight: CleanupPreflight[] = [];

  for (const identity of record.identities) {
    const fetched = await admin.auth.admin.getUserById(identity.userId);
    const authUserExists = !fetched.error;
    if (
      fetched.error &&
      safeProfileErrorCode(fetched.error) !== "user_not_found"
    ) {
      throw new AcceptanceFailure(
        `CLEANUP_AUTH_LOOKUP_FAILED_${identity.label}`,
      );
    }
    if (
      authUserExists &&
      (fetched.data.user.email?.toLowerCase() !== identity.email.toLowerCase() ||
        !authMetadataMatches(fetched.data.user.app_metadata, record.runId))
    ) {
      throw new AcceptanceFailure(
        `CLEANUP_AUTH_IDENTITY_MISMATCH_${identity.label}`,
      );
    }

    const [workspaceById, ownedWorkspaces, candidateById, ownedCandidates] =
      await Promise.all([
        admin
          .from("workspaces")
          .select("id, name, kind, personal_owner_auth_user_id")
          .eq("id", identity.workspaceId)
          .maybeSingle(),
        admin
          .from("workspaces")
          .select("id")
          .eq("personal_owner_auth_user_id", identity.userId),
        admin
          .from("candidates")
          .select("id, workspace_id, auth_user_id")
          .eq("id", identity.candidateId)
          .maybeSingle(),
        admin
          .from("candidates")
          .select("id")
          .eq("auth_user_id", identity.userId),
      ]);
    for (const result of [
      workspaceById,
      ownedWorkspaces,
      candidateById,
      ownedCandidates,
    ]) {
      if (result.error) {
        throw new AcceptanceFailure(
          `CLEANUP_TENANT_LOOKUP_FAILED_${identity.label}`,
        );
      }
    }

    const workspace = workspaceById.data;
    if (
      workspace &&
      (workspace.name !== identity.workspaceName ||
        workspace.kind !== "PERSONAL" ||
        workspace.personal_owner_auth_user_id !== identity.userId)
    ) {
      throw new AcceptanceFailure(
        `CLEANUP_WORKSPACE_IDENTITY_MISMATCH_${identity.label}`,
      );
    }
    if (
      (ownedWorkspaces.data ?? []).some((row) => row.id !== identity.workspaceId) ||
      (ownedWorkspaces.data ?? []).length > 1
    ) {
      throw new AcceptanceFailure(
        `CLEANUP_UNKNOWN_WORKSPACE_${identity.label}`,
      );
    }

    const candidate = candidateById.data;
    if (
      candidate &&
      (candidate.workspace_id !== identity.workspaceId ||
        candidate.auth_user_id !== identity.userId)
    ) {
      throw new AcceptanceFailure(
        `CLEANUP_CANDIDATE_IDENTITY_MISMATCH_${identity.label}`,
      );
    }
    if (
      (ownedCandidates.data ?? []).some((row) => row.id !== identity.candidateId) ||
      (ownedCandidates.data ?? []).length > 1
    ) {
      throw new AcceptanceFailure(
        `CLEANUP_UNKNOWN_CANDIDATE_${identity.label}`,
      );
    }

    preflight.push(
      Object.freeze({
        identity,
        authUserExists,
        workspaceExists: Boolean(workspace),
      }),
    );
  }

  return Object.freeze(preflight);
}

export async function cleanupCandidateProfileAcceptance(
  config: CandidateProfileAcceptanceConfig,
  untrustedRecord: CandidateProfileCleanupRecord,
): Promise<readonly string[]> {
  const record = validateCandidateProfileCleanupRecord(untrustedRecord);
  if (record.projectRef !== config.expectedProjectRef) {
    throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
  }
  const admin = createProfileClient(config, config.secretKey);
  const preflight = await preflightCleanup(config, record);
  const errors: string[] = [];

  for (const entry of preflight) {
    const { identity } = entry;
    if (entry.workspaceExists) {
      const removed = await admin
        .from("workspaces")
        .delete()
        .eq("id", identity.workspaceId)
        .eq("personal_owner_auth_user_id", identity.userId)
        .eq("kind", "PERSONAL")
        .eq("name", identity.workspaceName)
        .select("id");
      if (removed.error || (removed.data ?? []).length !== 1) {
        errors.push(`${identity.label}:WORKSPACE_DELETE_FAILED`);
        continue;
      }
    }

    const [workspace, candidate, facts, versions] = await Promise.all([
      admin.from("workspaces").select("id").eq("id", identity.workspaceId),
      admin.from("candidates").select("id").eq("id", identity.candidateId),
      admin
        .from("candidate_facts")
        .select("id")
        .eq("workspace_id", identity.workspaceId),
      admin
        .from("candidate_fact_versions")
        .select("id")
        .eq("workspace_id", identity.workspaceId),
    ]);
    if (
      [workspace, candidate, facts, versions].some((result) => result.error) ||
      (workspace.data ?? []).length > 0 ||
      (candidate.data ?? []).length > 0 ||
      (facts.data ?? []).length > 0 ||
      (versions.data ?? []).length > 0
    ) {
      errors.push(`${identity.label}:TENANT_DELETE_POSTCHECK_FAILED`);
      continue;
    }

    if (entry.authUserExists) {
      const deleted = await admin.auth.admin.deleteUser(identity.userId, false);
      if (deleted.error) {
        errors.push(`${identity.label}:AUTH_USER_DELETE_FAILED`);
        continue;
      }
    }
    const postDeleteUser = await admin.auth.admin.getUserById(identity.userId);
    if (safeProfileErrorCode(postDeleteUser.error) !== "user_not_found") {
      errors.push(`${identity.label}:AUTH_USER_DELETE_POSTCHECK_FAILED`);
    }
  }

  return Object.freeze(errors);
}
