import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";
import {
  AcceptanceFailure,
  assertRemoteOk,
  firstRpcRow,
} from "./milestone-zero-acceptance-lib.ts";
import {
  assertProfileAcceptanceEmail,
  cleanupCandidateProfileAcceptance,
  createCandidateProfileCleanupRecord,
  createProfileAcceptancePassword,
  createProfileClient,
  profileAcceptanceEmail,
  profileWorkspaceName,
  requireCandidateProfileAcceptanceConfig,
  safeProfileErrorCode,
  type CandidateProfileAcceptanceConfig,
  type CandidateProfileCleanupRecord,
  type ProfileAcceptanceLabel,
  type ProfileCleanupIdentity,
} from "./candidate-profile-acceptance-lib.ts";

type SaveFactRow =
  Database["public"]["Functions"]["save_candidate_fact"]["Returns"][number];

type ProfileCandidate = ProfileCleanupIdentity &
  Readonly<{ client: SupabaseClient<Database> }>;

type AcceptanceCheck = Readonly<{
  name: string;
  status: "PASS";
  detail: string;
}>;

const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");
const STAGE_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 90_000;
const REQUIRED_CHECKPOINTS = Object.freeze([
  "anonymous-denial",
  "two-real-candidates",
  "create-and-replay",
  "payload-mismatch",
  "canonical-policy",
  "direct-auth-write-denial",
  "candidate-self-rls",
  "cross-tenant-denial",
  "append-only-update",
  "stale-write-denial",
  "unsure-needs-review",
  "version-immutability",
  "service-accounting",
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

function assertExpectedError(
  error: unknown,
  expectedCode: string,
  expectedMessage: string | null,
  failureCode: string,
): void {
  if (!error) {
    throw new AcceptanceFailure(`${failureCode}:MUTATION_UNEXPECTEDLY_SUCCEEDED`);
  }
  if (safeProfileErrorCode(error) !== expectedCode) {
    throw new AcceptanceFailure(
      `${failureCode}:UNEXPECTED_CODE_${safeProfileErrorCode(error)}`,
    );
  }
  if (expectedMessage && !remoteErrorText(error).includes(expectedMessage)) {
    throw new AcceptanceFailure(`${failureCode}:DOMAIN_ERROR_MISSING`);
  }
}

async function preserveCleanupRecord(
  record: CandidateProfileCleanupRecord,
): Promise<string> {
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
  const target = resolve(
    ARTIFACT_DIRECTORY,
    `profile-${record.runId}-cleanup.json`,
  );
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return target;
}

async function createCandidate(
  config: CandidateProfileAcceptanceConfig,
  label: ProfileAcceptanceLabel,
): Promise<ProfileCandidate> {
  const admin = createProfileClient(config, config.secretKey);
  const email = profileAcceptanceEmail(config.runId, label);
  const password = createProfileAcceptancePassword();
  const displayName = profileWorkspaceName(config.runId, label);
  const workspaceName = `${displayName} workspace`;
  assertProfileAcceptanceEmail(email);
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
        `AUTH_USER_CREATE_FAILED_${label}:${safeProfileErrorCode(created.error)}`,
      );
    }
    userId = created.data.user.id;

    const client = createProfileClient(config, config.publishableKey);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (
      signedIn.error ||
      !signedIn.data.user ||
      !signedIn.data.session ||
      signedIn.data.user.id !== userId
    ) {
      throw new AcceptanceFailure(
        `AUTH_PASSWORD_SESSION_FAILED_${label}:${safeProfileErrorCode(signedIn.error)}`,
      );
    }

    const bootstrapped = await client.rpc("bootstrap_personal_workspace", {
      p_display_name: displayName,
    });
    assertRemoteOk(bootstrapped.error, `BOOTSTRAP_FAILED_${label}`);
    const bootstrap = firstRpcRow(bootstrapped.data);
    if (!bootstrap || bootstrap.replayed) {
      throw new AcceptanceFailure(`BOOTSTRAP_FIRST_CALL_INVALID_${label}`);
    }
    workspaceId = bootstrap.workspace_id;

    const [workspace, candidate] = await Promise.all([
      client
        .from("workspaces")
        .select("id, name, kind, personal_owner_auth_user_id")
        .eq("id", bootstrap.workspace_id)
        .single(),
      client
        .from("candidates")
        .select("id, workspace_id, auth_user_id, status")
        .eq("id", bootstrap.candidate_id)
        .single(),
    ]);
    assertRemoteOk(workspace.error, `WORKSPACE_SELF_READ_FAILED_${label}`);
    assertRemoteOk(candidate.error, `CANDIDATE_SELF_READ_FAILED_${label}`);
    if (
      workspace.data.name !== workspaceName ||
      workspace.data.kind !== "PERSONAL" ||
      workspace.data.personal_owner_auth_user_id !== userId ||
      candidate.data.workspace_id !== bootstrap.workspace_id ||
      candidate.data.auth_user_id !== userId
    ) {
      throw new AcceptanceFailure(`BOOTSTRAP_TENANCY_INVALID_${label}`);
    }

    return Object.freeze({
      label,
      userId,
      email,
      workspaceId: bootstrap.workspace_id,
      candidateId: bootstrap.candidate_id,
      workspaceName,
      client,
    });
  } catch (error) {
    if (userId) {
      if (workspaceId) {
        await admin
          .from("workspaces")
          .delete()
          .eq("id", workspaceId)
          .eq("personal_owner_auth_user_id", userId)
          .eq("name", workspaceName);
      }
      await admin.auth.admin.deleteUser(userId, false);
    }
    throw error;
  }
}

async function saveFact(
  candidate: ProfileCandidate,
  args: Database["public"]["Functions"]["save_candidate_fact"]["Args"],
  failureCode: string,
): Promise<SaveFactRow> {
  const saved = await candidate.client.rpc("save_candidate_fact", args);
  assertRemoteOk(saved.error, failureCode);
  const row = firstRpcRow(saved.data);
  if (!row) throw new AcceptanceFailure(`${failureCode}:ROW_MISSING`);
  return row;
}

async function verifyAnonymousDenied(
  config: CandidateProfileAcceptanceConfig,
): Promise<void> {
  const anonymous = createProfileClient(config, config.publishableKey);
  const read = await anonymous.from("candidate_facts").select("id").limit(1);
  if (!read.error) {
    throw new AcceptanceFailure("ANONYMOUS_FACT_READ_NOT_DENIED");
  }
  const write = await anonymous.rpc("save_candidate_fact", {
    p_command_id: randomUUID(),
    p_fact_key: "contact.phone",
    p_value_json: "+1 202 555 0100",
    p_normalized_text: "+1 202 555 0100",
  });
  if (!write.error) {
    throw new AcceptanceFailure("ANONYMOUS_FACT_RPC_NOT_DENIED");
  }
}

async function verifyDirectWritesDenied(
  candidate: ProfileCandidate,
  fact: SaveFactRow,
): Promise<void> {
  const inserted = await candidate.client.from("candidate_facts").insert({
    workspace_id: candidate.workspaceId,
    candidate_id: candidate.candidateId,
    fact_key: "acceptance.direct_write_probe",
    sensitivity: "STANDARD",
    usage_policy: "EXACT_FIELDS",
    verification_status: "VERIFIED",
  });
  assertExpectedError(
    inserted.error,
    "42501",
    null,
    "AUTH_DIRECT_FACT_INSERT_NOT_DENIED",
  );

  const updated = await candidate.client
    .from("candidate_facts")
    .update({ verification_status: "NEEDS_REVIEW" })
    .eq("id", fact.fact_id);
  assertExpectedError(
    updated.error,
    "42501",
    null,
    "AUTH_DIRECT_FACT_UPDATE_NOT_DENIED",
  );

  const deleted = await candidate.client
    .from("candidate_facts")
    .delete()
    .eq("id", fact.fact_id);
  assertExpectedError(
    deleted.error,
    "42501",
    null,
    "AUTH_DIRECT_FACT_DELETE_NOT_DENIED",
  );

  const versionUpdated = await candidate.client
    .from("candidate_fact_versions")
    .update({ normalized_text: "forbidden" })
    .eq("id", fact.fact_version_id);
  assertExpectedError(
    versionUpdated.error,
    "42501",
    null,
    "AUTH_DIRECT_VERSION_UPDATE_NOT_DENIED",
  );
}

async function verifyCandidateReads(
  alpha: ProfileCandidate,
  beta: ProfileCandidate,
  fact: SaveFactRow,
): Promise<void> {
  const [ownFact, ownVersion, otherFacts, otherVersions, otherSources] =
    await Promise.all([
      alpha.client
        .from("candidate_facts")
        .select("id, candidate_id, current_version_number")
        .eq("id", fact.fact_id)
        .single(),
      alpha.client
        .from("candidate_fact_versions")
        .select("id, candidate_id, fact_id, version_number")
        .eq("id", fact.fact_version_id)
        .single(),
      beta.client
        .from("candidate_facts")
        .select("id")
        .eq("candidate_id", alpha.candidateId),
      beta.client
        .from("candidate_fact_versions")
        .select("id")
        .eq("candidate_id", alpha.candidateId),
      beta.client
        .from("fact_sources")
        .select("fact_version_id")
        .eq("candidate_id", alpha.candidateId),
    ]);
  assertRemoteOk(ownFact.error, "OWN_FACT_READ_FAILED");
  assertRemoteOk(ownVersion.error, "OWN_VERSION_READ_FAILED");
  for (const result of [otherFacts, otherVersions, otherSources]) {
    assertRemoteOk(result.error, "CROSS_TENANT_READ_FAILED");
    if ((result.data ?? []).length !== 0) {
      throw new AcceptanceFailure("CROSS_TENANT_ROW_VISIBLE");
    }
  }
  if (
    ownFact.data.candidate_id !== alpha.candidateId ||
    ownFact.data.current_version_number !== fact.fact_version_number ||
    ownVersion.data.candidate_id !== alpha.candidateId ||
    ownVersion.data.fact_id !== fact.fact_id
  ) {
    throw new AcceptanceFailure("CANDIDATE_SELF_READ_INVARIANT_FAILED");
  }
}

async function verifyVersionImmutability(
  config: CandidateProfileAcceptanceConfig,
  fact: SaveFactRow,
  expectedText: string,
): Promise<void> {
  const admin = createProfileClient(config, config.secretKey);
  const update = await admin
    .from("candidate_fact_versions")
    .update({ normalized_text: "forbidden mutation" })
    .eq("id", fact.fact_version_id);
  assertExpectedError(
    update.error,
    "55000",
    "append-only",
    "SERVICE_VERSION_UPDATE_NOT_DENIED",
  );

  const remove = await admin
    .from("candidate_fact_versions")
    .delete()
    .eq("id", fact.fact_version_id);
  assertExpectedError(
    remove.error,
    "55000",
    "append-only",
    "SERVICE_VERSION_DELETE_NOT_DENIED",
  );

  const unchanged = await admin
    .from("candidate_fact_versions")
    .select("id, normalized_text")
    .eq("id", fact.fact_version_id)
    .single();
  assertRemoteOk(unchanged.error, "IMMUTABLE_VERSION_POSTCHECK_FAILED");
  if (unchanged.data.normalized_text !== expectedText) {
    throw new AcceptanceFailure("IMMUTABLE_VERSION_CHANGED");
  }
}

async function main(): Promise<void> {
  const config = requireCandidateProfileAcceptanceConfig();
  const checks: AcceptanceCheck[] = [];
  const candidates: ProfileCandidate[] = [];
  let record: CandidateProfileCleanupRecord | null = null;
  let cleanupArtifact: string | null = null;
  let runFailure: string | null = null;
  let cleanupStatus: "NOT_NEEDED" | "PASS" | "FAIL" | "KEPT" =
    "NOT_NEEDED";

  const persistRecoveryRecord = async (): Promise<void> => {
    if (candidates.length === 0) return;
    record = createCandidateProfileCleanupRecord(config, candidates);
    cleanupArtifact = await preserveCleanupRecord(record);
  };

  process.stdout.write(
    `RoleDawn candidate-profile hosted acceptance\nproject=${config.expectedProjectRef}\nrun=${config.runId}\n`,
  );

  try {
    await runStage("anonymous-denial", () => verifyAnonymousDenied(config));
    report(
      checks,
      "anonymous-denial",
      "anonymous reads and profile commands are rejected",
    );

    const { alpha, beta } = await runStage("two-real-candidates", async () => {
      const alpha = await createCandidate(config, "alpha");
      candidates.push(alpha);
      await persistRecoveryRecord();
      const beta = await createCandidate(config, "beta");
      candidates.push(beta);
      await persistRecoveryRecord();
      return { alpha, beta };
    });
    report(
      checks,
      "two-real-candidates",
      "two ordinary sessions have separate personal workspaces",
    );

    const createCommandId = randomUUID();
    const initialEmail = alpha.email;
    const createArgs = {
      p_command_id: createCommandId,
      p_fact_key: "contact.application_email",
      p_value_json: initialEmail,
      p_normalized_text: initialEmail,
    };
    const createdFact = await runStage("create-and-replay", async () => {
      const created = await saveFact(alpha, createArgs, "FACT_CREATE_FAILED");
      if (
        created.replayed ||
        created.fact_version_number !== 1 ||
        created.aggregate_version < 2
      ) {
        throw new AcceptanceFailure("FACT_CREATE_RESULT_INVALID");
      }
      const replay = await saveFact(alpha, createArgs, "FACT_REPLAY_FAILED");
      if (
        !replay.replayed ||
        replay.fact_id !== created.fact_id ||
        replay.fact_version_id !== created.fact_version_id ||
        replay.fact_version_number !== created.fact_version_number ||
        replay.aggregate_version !== created.aggregate_version
      ) {
        throw new AcceptanceFailure("FACT_REPLAY_RESULT_INVALID");
      }
      return created;
    });
    report(
      checks,
      "create-and-replay",
      "one command creates one immutable version and replays stable IDs",
    );

    await runStage("payload-mismatch", async () => {
      const mismatch = await alpha.client.rpc("save_candidate_fact", {
        ...createArgs,
        p_value_json: `changed-${initialEmail}`,
        p_normalized_text: `changed-${initialEmail}`,
      });
      assertExpectedError(
        mismatch.error,
        "23505",
        "COMMAND_ID_PAYLOAD_MISMATCH",
        "COMMAND_PAYLOAD_MISMATCH_NOT_DENIED",
      );
    });
    report(
      checks,
      "payload-mismatch",
      "a reused command ID cannot carry a different payload",
    );

    await runStage("canonical-policy", async () => {
      const [fact, version] = await Promise.all([
        alpha.client
          .from("candidate_facts")
          .select(
            "id, fact_key, sensitivity, usage_policy, verification_status, current_version_number, aggregate_version",
          )
          .eq("id", createdFact.fact_id)
          .single(),
        alpha.client
          .from("candidate_fact_versions")
          .select(
            "id, fact_id, version_number, value_json, normalized_text, candidate_disposition, created_by, review_kind, reviewed_at, reviewed_by",
          )
          .eq("id", createdFact.fact_version_id)
          .single(),
      ]);
      assertRemoteOk(fact.error, "CANONICAL_FACT_READ_FAILED");
      assertRemoteOk(version.error, "CANONICAL_VERSION_READ_FAILED");
      if (
        fact.data.fact_key !== "contact.application_email" ||
        fact.data.sensitivity !== "STANDARD" ||
        fact.data.usage_policy !== "EXACT_FIELDS" ||
        fact.data.verification_status !== "VERIFIED" ||
        fact.data.current_version_number !== 1 ||
        fact.data.aggregate_version !== createdFact.aggregate_version ||
        version.data.fact_id !== createdFact.fact_id ||
        version.data.value_json !== initialEmail ||
        version.data.normalized_text !== initialEmail ||
        version.data.candidate_disposition !== "APPROVED" ||
        version.data.created_by !== alpha.userId ||
        version.data.review_kind !== "CANDIDATE_ENTRY" ||
        !version.data.reviewed_at ||
        version.data.reviewed_by !== alpha.userId
      ) {
        throw new AcceptanceFailure("CANONICAL_POLICY_INVARIANT_FAILED");
      }
    });
    report(
      checks,
      "canonical-policy",
      "the database owns policy, review, and verification metadata",
    );

    await runStage("direct-auth-write-denial", () =>
      verifyDirectWritesDenied(alpha, createdFact),
    );
    report(
      checks,
      "direct-auth-write-denial",
      "ordinary sessions cannot bypass the profile command",
    );

    await runStage("candidate-self-rls", async () => {
      await verifyCandidateReads(alpha, beta, createdFact);
    });
    report(
      checks,
      "candidate-self-rls",
      "the candidate can read the exact fact and version they own",
    );
    report(
      checks,
      "cross-tenant-denial",
      "the second candidate reads zero fact, version, or source rows",
    );

    const updatedEmail = `updated-${initialEmail}`;
    const updatedFact = await runStage("append-only-update", async () => {
      const updated = await saveFact(
        alpha,
        {
          p_command_id: randomUUID(),
          p_fact_key: "contact.application_email",
          p_value_json: updatedEmail,
          p_normalized_text: updatedEmail,
          p_expected_aggregate_version: createdFact.aggregate_version,
        },
        "FACT_UPDATE_FAILED",
      );
      if (
        updated.replayed ||
        updated.fact_id !== createdFact.fact_id ||
        updated.fact_version_id === createdFact.fact_version_id ||
        updated.fact_version_number !== createdFact.fact_version_number + 1 ||
        updated.aggregate_version !== createdFact.aggregate_version + 1
      ) {
        throw new AcceptanceFailure("FACT_UPDATE_RESULT_INVALID");
      }
      const [fact, versions] = await Promise.all([
        alpha.client
          .from("candidate_facts")
          .select("current_version_number, aggregate_version")
          .eq("id", createdFact.fact_id)
          .single(),
        alpha.client
          .from("candidate_fact_versions")
          .select("id, version_number, normalized_text")
          .eq("fact_id", createdFact.fact_id)
          .order("version_number", { ascending: true }),
      ]);
      assertRemoteOk(fact.error, "UPDATED_FACT_READ_FAILED");
      assertRemoteOk(versions.error, "UPDATED_VERSIONS_READ_FAILED");
      if (
        fact.data.current_version_number !== updated.fact_version_number ||
        fact.data.aggregate_version !== updated.aggregate_version ||
        versions.data.length !== 2 ||
        versions.data[0]?.id !== createdFact.fact_version_id ||
        versions.data[0]?.normalized_text !== initialEmail ||
        versions.data[1]?.id !== updated.fact_version_id ||
        versions.data[1]?.normalized_text !== updatedEmail
      ) {
        throw new AcceptanceFailure("APPEND_ONLY_UPDATE_INVARIANT_FAILED");
      }
      return updated;
    });
    report(
      checks,
      "append-only-update",
      "an edit appends a version and advances the aggregate pointer",
    );

    await runStage("stale-write-denial", async () => {
      const stale = await alpha.client.rpc("save_candidate_fact", {
        p_command_id: randomUUID(),
        p_fact_key: "contact.application_email",
        p_value_json: `stale-${initialEmail}`,
        p_normalized_text: `stale-${initialEmail}`,
        p_expected_aggregate_version: createdFact.aggregate_version,
      });
      assertExpectedError(
        stale.error,
        "PT409",
        "CANDIDATE_FACT_VERSION_MISMATCH",
        "STALE_FACT_WRITE_NOT_DENIED",
      );
    });
    report(
      checks,
      "stale-write-denial",
      "an edit from a stale aggregate version is rejected",
    );

    await runStage("unsure-needs-review", async () => {
      const unsure = await saveFact(
        alpha,
        {
          p_command_id: randomUUID(),
          p_fact_key: "work_authorization.us.authorized",
          p_value_json: "unsure",
          p_normalized_text: "I'm not sure",
        },
        "UNSURE_FACT_SAVE_FAILED",
      );
      const [fact, version] = await Promise.all([
        alpha.client
          .from("candidate_facts")
          .select("sensitivity, usage_policy, verification_status")
          .eq("id", unsure.fact_id)
          .single(),
        alpha.client
          .from("candidate_fact_versions")
          .select(
            "value_json, normalized_text, candidate_disposition, review_kind, reviewed_by",
          )
          .eq("id", unsure.fact_version_id)
          .single(),
      ]);
      assertRemoteOk(fact.error, "UNSURE_FACT_READ_FAILED");
      assertRemoteOk(version.error, "UNSURE_VERSION_READ_FAILED");
      if (
        fact.data.sensitivity !== "SENSITIVE" ||
        fact.data.usage_policy !== "EXACT_FIELDS" ||
        fact.data.verification_status !== "NEEDS_REVIEW" ||
        version.data.value_json !== "unsure" ||
        version.data.normalized_text !== "I'm not sure" ||
        version.data.candidate_disposition !== "APPROVED" ||
        version.data.review_kind !== "CANDIDATE_ENTRY" ||
        version.data.reviewed_by !== alpha.userId
      ) {
        throw new AcceptanceFailure("UNSURE_FACT_INVARIANT_FAILED");
      }
    });
    report(
      checks,
      "unsure-needs-review",
      "an unsure sensitive answer remains unresolved and is never guessed",
    );

    await runStage("version-immutability", () =>
      verifyVersionImmutability(config, createdFact, initialEmail),
    );
    report(
      checks,
      "version-immutability",
      "even the service role cannot update or directly delete evidence versions",
    );

    await runStage("service-accounting", async () => {
      const admin = createProfileClient(config, config.secretKey);
      const rows = await admin
        .from("workspaces")
        .select("id, name, personal_owner_auth_user_id")
        .in(
          "id",
          candidates.map((candidate) => candidate.workspaceId),
        );
      assertRemoteOk(rows.error, "SERVICE_WORKSPACE_ACCOUNTING_FAILED");
      const expectedIds = new Set(
        candidates.map((candidate) => candidate.workspaceId),
      );
      if (
        rows.data.length !== candidates.length ||
        rows.data.some(
          (row) =>
            !expectedIds.has(row.id) ||
            !row.name.startsWith(profileWorkspaceName(config.runId, "alpha").replace(/alpha$/, "")),
        )
      ) {
        throw new AcceptanceFailure("SERVICE_WORKSPACE_ACCOUNTING_INVALID");
      }
    });
    report(
      checks,
      "service-accounting",
      "the service boundary accounts for exactly the two synthetic tenants",
    );

    const actual = new Set(checks.map((check) => check.name));
    const missing = REQUIRED_CHECKPOINTS.filter((name) => !actual.has(name));
    const unexpected = [...actual].filter(
      (name) =>
        !REQUIRED_CHECKPOINTS.includes(
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

    // Keep this read in the success path so the compiler and harness both bind
    // the immutable update result to the exact aggregate that was exercised.
    if (updatedFact.fact_id !== createdFact.fact_id) {
      throw new AcceptanceFailure("UPDATED_FACT_ID_DRIFTED");
    }
  } catch (error) {
    runFailure =
      error instanceof AcceptanceFailure
        ? error.message
        : "UNEXPECTED_CANDIDATE_PROFILE_ACCEPTANCE_FAILURE";
    process.stderr.write(`FAIL ${runFailure}\n`);
  } finally {
    if (record && !config.keepArtifacts) {
      try {
        process.stdout.write("START cleanup\n");
        const cleanupErrors = await withDeadline(
          cleanupCandidateProfileAcceptance(config, record),
          CLEANUP_TIMEOUT_MS,
          "CLEANUP_TIMEOUT",
        );
        if (cleanupErrors.length === 0) {
          cleanupStatus = "PASS";
          process.stdout.write(
            "PASS cleanup — synthetic users and cascading tenant data removed\n",
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
      runFailure ?? "CANDIDATE_PROFILE_ACCEPTANCE_CLEANUP_FAILED",
    );
  }
}

try {
  await main();
} catch (error) {
  if (!(error instanceof AcceptanceFailure)) {
    process.stderr.write(
      "FAIL UNEXPECTED_CANDIDATE_PROFILE_ACCEPTANCE_FAILURE\n",
    );
  }
  process.exitCode = 1;
}
