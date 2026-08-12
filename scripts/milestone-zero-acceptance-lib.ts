import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";
import { normalizePublicJobUrl } from "../src/domain/job-url.ts";

export const ACCEPTANCE_PREFIX = "roledawn-m0-";
export const ACCEPTANCE_EMAIL_DOMAIN = "acceptance.invalid";
export const DEFAULT_ACCEPTANCE_JOB_URL =
  "https://job-boards.greenhouse.io/anthropic/jobs/5101378008";

const EXPECTED_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const SECRET_PLACEHOLDERS = new Set([
  "your-server-only-supabase-secret-key",
  "your-supabase-secret-key",
]);

export type AcceptanceConfig = Readonly<{
  url: string;
  publishableKey: string;
  secretKey: string;
  expectedProjectRef: string;
  runId: string;
  jobUrl: string;
  runWorker: boolean;
  keepArtifacts: boolean;
}>;

export type AcceptanceCandidate = Readonly<{
  label: "alpha" | "beta";
  email: string;
  password: string;
  userId: string;
  workspaceId: string;
  candidateId: string;
  client: SupabaseClient<Database>;
  accessToken: string;
}>;

export type CleanupRecord = Readonly<{
  runId: string;
  projectRef: string;
  createdAt: string;
  userIds: readonly string[];
  emails: readonly string[];
  workspaceIds: readonly string[];
}>;

export class AcceptanceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceFailure";
  }
}

export function requireAcceptanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AcceptanceConfig {
  if (environment.RUN_HOSTED_MILESTONE_ZERO_ACCEPTANCE !== "I_UNDERSTAND_THIS_CREATES_TEST_DATA") {
    throw new AcceptanceFailure(
      "REFUSING_TO_RUN: set RUN_HOSTED_MILESTONE_ZERO_ACCEPTANCE=I_UNDERSTAND_THIS_CREATES_TEST_DATA",
    );
  }

  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey =
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim() ?? "";
  const expectedProjectRef =
    environment.ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF?.trim().toLowerCase() ?? "";

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

  const suppliedJobUrl =
    environment.ACCEPTANCE_JOB_URL?.trim() || DEFAULT_ACCEPTANCE_JOB_URL;
  const normalizedJobUrl = normalizePublicJobUrl(suppliedJobUrl);
  if (!normalizedJobUrl.ok) {
    throw new AcceptanceFailure("ACCEPTANCE_JOB_URL_INVALID");
  }

  const runId = createAcceptanceRunId(environment.ACCEPTANCE_RUN_ID);
  return Object.freeze({
    url: parsedUrl.toString().replace(/\/$/, ""),
    publishableKey,
    secretKey,
    expectedProjectRef,
    runId,
    jobUrl: normalizedJobUrl.value,
    runWorker: environment.ACCEPTANCE_RUN_WORKER === "true",
    keepArtifacts: environment.ACCEPTANCE_KEEP_ARTIFACTS === "true",
  });
}

export function createAcceptanceRunId(supplied: string | undefined): string {
  const generated = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const value = (supplied?.trim().toLowerCase() || generated).replace(
    /[^a-z0-9-]/g,
    "-",
  );
  const compact = value.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  if (!compact) throw new AcceptanceFailure("ACCEPTANCE_RUN_ID_INVALID");
  return compact;
}

export function acceptanceEmail(
  runId: string,
  label: AcceptanceCandidate["label"],
): string {
  return `${ACCEPTANCE_PREFIX}${runId}-${label}@${ACCEPTANCE_EMAIL_DOMAIN}`;
}

export function createAcceptancePassword(): string {
  // GoTrue rejects oversized passwords with an opaque 500 on this hosted
  // project. One UUID plus mixed required character classes is high-entropy
  // and stays comfortably within the accepted bound.
  return `${crypto.randomUUID()}-Aa1!`;
}

export function createAdminClient(config: AcceptanceConfig) {
  return createClient<Database>(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { "x-roledawn-runtime": "milestone-zero-acceptance/0.1" } },
  });
}

export function createCandidateClient(config: AcceptanceConfig) {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { "x-roledawn-runtime": "milestone-zero-acceptance/0.1" } },
  });
}

export function assertAcceptanceEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (
    !normalized.startsWith(ACCEPTANCE_PREFIX) ||
    !normalized.endsWith(`@${ACCEPTANCE_EMAIL_DOMAIN}`)
  ) {
    throw new AcceptanceFailure(
      "CLEANUP_REFUSED: identity is not a RoleDawn Milestone 0 acceptance user",
    );
  }
}

export function createCleanupRecord(
  config: AcceptanceConfig,
  candidates: readonly AcceptanceCandidate[],
): CleanupRecord {
  return Object.freeze({
    runId: config.runId,
    projectRef: config.expectedProjectRef,
    createdAt: new Date().toISOString(),
    userIds: Object.freeze(candidates.map((candidate) => candidate.userId)),
    emails: Object.freeze(candidates.map((candidate) => candidate.email)),
    workspaceIds: Object.freeze(
      candidates.map((candidate) => candidate.workspaceId),
    ),
  });
}

export function validateCleanupRecord(value: unknown): CleanupRecord {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new AcceptanceFailure("CLEANUP_RECORD_INVALID");
  }
  const record = value as Partial<CleanupRecord>;
  if (
    typeof record.runId !== "string" ||
    typeof record.projectRef !== "string" ||
    typeof record.createdAt !== "string" ||
    !Array.isArray(record.userIds) ||
    !Array.isArray(record.emails) ||
    !Array.isArray(record.workspaceIds) ||
    record.userIds.length !== record.emails.length ||
    record.userIds.length !== record.workspaceIds.length ||
    !record.userIds.every((entry) => typeof entry === "string") ||
    !record.workspaceIds.every((entry) => typeof entry === "string") ||
    !record.emails.every((entry) => typeof entry === "string")
  ) {
    throw new AcceptanceFailure("CLEANUP_RECORD_INVALID");
  }
  for (const email of record.emails) assertAcceptanceEmail(email);
  return Object.freeze({
    runId: record.runId,
    projectRef: record.projectRef,
    createdAt: record.createdAt,
    userIds: Object.freeze([...record.userIds]),
    emails: Object.freeze([...record.emails]),
    workspaceIds: Object.freeze([...record.workspaceIds]),
  });
}

export function firstRpcRow<T>(value: T | readonly T[] | null): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T | null;
}

export function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string" && candidate.code) return candidate.code;
  if (typeof candidate.message === "string" && candidate.message) {
    const known = candidate.message.match(
      /AUTHENTICATION_REQUIRED|COMMAND_ID_PAYLOAD_MISMATCH|ACTIVE_CANDIDATE_NOT_FOUND|PGRST\d+/,
    );
    return known?.[0] ?? "REMOTE_ERROR";
  }
  return "UNKNOWN";
}

export function assertRemoteOk(
  error: unknown,
  code: string,
): asserts error is null {
  if (error) {
    throw new AcceptanceFailure(`${code}:${safeErrorCode(error)}`);
  }
}
