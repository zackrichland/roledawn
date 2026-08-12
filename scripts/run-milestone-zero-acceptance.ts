import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";
import { runPreparationWorkerOnce } from "../src/server/workers/outbox-worker.ts";
import {
  AcceptanceFailure,
  acceptanceEmail,
  assertAcceptanceEmail,
  assertRemoteOk,
  createAcceptancePassword,
  createAdminClient,
  createCandidateClient,
  createCleanupRecord,
  firstRpcRow,
  requireAcceptanceConfig,
  safeErrorCode,
  type AcceptanceCandidate,
  type AcceptanceConfig,
  type CleanupRecord,
} from "./milestone-zero-acceptance-lib.ts";

type BootstrapRow =
  Database["public"]["Functions"]["bootstrap_personal_workspace"]["Returns"][number];
type EnqueueRow =
  Database["public"]["Functions"]["enqueue_pasted_link_application"]["Returns"][number];

type AcceptanceCheck = Readonly<{
  name: string;
  status: "PASS" | "SKIP";
  detail: string;
}>;

const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");

function report(checks: AcceptanceCheck[], name: string, detail: string): void {
  checks.push({ name, status: "PASS", detail });
  process.stdout.write(`PASS ${name} — ${detail}\n`);
}

function skip(checks: AcceptanceCheck[], name: string, detail: string): void {
  checks.push({ name, status: "SKIP", detail });
  process.stdout.write(`SKIP ${name} — ${detail}\n`);
}

async function createCandidate(
  config: AcceptanceConfig,
  label: AcceptanceCandidate["label"],
): Promise<AcceptanceCandidate> {
  const admin = createAdminClient(config);
  const email = acceptanceEmail(config.runId, label);
  const password = createAcceptancePassword();
  assertAcceptanceEmail(email);
  let createdUserId: string | null = null;

  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: `RoleDawn M0 ${config.runId} ${label}`,
        acceptance_run_id: config.runId,
      },
      app_metadata: {
        roledawn_acceptance_run_id: config.runId,
      },
    });
    if (created.error || !created.data.user) {
      throw new AcceptanceFailure(
        `AUTH_USER_CREATE_FAILED_${label}:${safeErrorCode(created.error)}`,
      );
    }
    createdUserId = created.data.user.id;

    const client = createCandidateClient(config);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.user || !signedIn.data.session) {
      throw new AcceptanceFailure(
        `AUTH_PASSWORD_SESSION_FAILED_${label}:${safeErrorCode(signedIn.error)}`,
      );
    }
    if (signedIn.data.user.id !== createdUserId) {
      throw new AcceptanceFailure(`AUTH_USER_ID_MISMATCH_${label}`);
    }

    const bootstrapped = await client.rpc("bootstrap_personal_workspace", {
      p_display_name: `RoleDawn M0 ${config.runId} ${label}`,
    });
    assertRemoteOk(bootstrapped.error, `BOOTSTRAP_FAILED_${label}`);
    const row = firstRpcRow<BootstrapRow>(bootstrapped.data);
    if (!row || row.replayed) {
      throw new AcceptanceFailure(`BOOTSTRAP_FIRST_CALL_INVALID_${label}`);
    }

    const replay = await client.rpc("bootstrap_personal_workspace", {
      p_display_name: `RoleDawn M0 ${config.runId} ${label}`,
    });
    assertRemoteOk(replay.error, `BOOTSTRAP_REPLAY_FAILED_${label}`);
    const replayRow = firstRpcRow<BootstrapRow>(replay.data);
    if (
      !replayRow?.replayed ||
      replayRow.workspace_id !== row.workspace_id ||
      replayRow.candidate_id !== row.candidate_id
    ) {
      throw new AcceptanceFailure(`BOOTSTRAP_REPLAY_INVALID_${label}`);
    }

    return Object.freeze({
      label,
      email,
      password,
      userId: createdUserId,
      workspaceId: row.workspace_id,
      candidateId: row.candidate_id,
      client,
      accessToken: signedIn.data.session.access_token,
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

async function verifyOwnTenancy(candidate: AcceptanceCandidate): Promise<void> {
  const [workspace, membership, profile] = await Promise.all([
    candidate.client
      .from("workspaces")
      .select("id, personal_owner_auth_user_id")
      .eq("id", candidate.workspaceId)
      .single(),
    candidate.client
      .from("workspace_memberships")
      .select("workspace_id, auth_user_id, role, status")
      .eq("workspace_id", candidate.workspaceId)
      .single(),
    candidate.client
      .from("candidates")
      .select("id, workspace_id, auth_user_id, status")
      .eq("id", candidate.candidateId)
      .single(),
  ]);
  assertRemoteOk(workspace.error, `WORKSPACE_SELF_READ_FAILED_${candidate.label}`);
  assertRemoteOk(membership.error, `MEMBERSHIP_SELF_READ_FAILED_${candidate.label}`);
  assertRemoteOk(profile.error, `CANDIDATE_SELF_READ_FAILED_${candidate.label}`);
  if (
    workspace.data.personal_owner_auth_user_id !== candidate.userId ||
    membership.data.auth_user_id !== candidate.userId ||
    membership.data.role !== "OWNER" ||
    membership.data.status !== "ACTIVE" ||
    profile.data.auth_user_id !== candidate.userId ||
    profile.data.workspace_id !== candidate.workspaceId
  ) {
    throw new AcceptanceFailure(`OWN_TENANCY_INVARIANT_FAILED_${candidate.label}`);
  }
}

async function enqueueAndReplay(
  candidate: AcceptanceCandidate,
  jobUrl: string,
): Promise<EnqueueRow> {
  const commandId = randomUUID();
  const first = await candidate.client.rpc("enqueue_pasted_link_application", {
    p_command_id: commandId,
    p_canonical_url: jobUrl,
  });
  assertRemoteOk(first.error, "ENQUEUE_FAILED");
  const firstRow = firstRpcRow<EnqueueRow>(first.data);
  if (!firstRow || firstRow.replayed) {
    throw new AcceptanceFailure("ENQUEUE_FIRST_CALL_INVALID");
  }

  const replay = await candidate.client.rpc("enqueue_pasted_link_application", {
    p_command_id: commandId,
    p_canonical_url: jobUrl,
  });
  assertRemoteOk(replay.error, "ENQUEUE_REPLAY_FAILED");
  const replayRow = firstRpcRow<EnqueueRow>(replay.data);
  if (
    !replayRow?.replayed ||
    replayRow.application_id !== firstRow.application_id ||
    replayRow.job_intake_id !== firstRow.job_intake_id ||
    replayRow.aggregate_version !== firstRow.aggregate_version
  ) {
    throw new AcceptanceFailure("ENQUEUE_REPLAY_INVARIANT_FAILED");
  }

  const sameUrlNewCommand = await candidate.client.rpc(
    "enqueue_pasted_link_application",
    {
      p_command_id: randomUUID(),
      p_canonical_url: jobUrl,
    },
  );
  assertRemoteOk(sameUrlNewCommand.error, "ENQUEUE_URL_DEDUP_FAILED");
  const sameUrlNewCommandRow = firstRpcRow<EnqueueRow>(sameUrlNewCommand.data);
  if (
    !sameUrlNewCommandRow?.replayed ||
    sameUrlNewCommandRow.application_id !== firstRow.application_id ||
    sameUrlNewCommandRow.job_intake_id !== firstRow.job_intake_id ||
    sameUrlNewCommandRow.aggregate_version !== firstRow.aggregate_version
  ) {
    throw new AcceptanceFailure("ENQUEUE_URL_DEDUP_INVARIANT_FAILED");
  }

  const mismatchUrl = new URL(jobUrl);
  mismatchUrl.searchParams.set("roledawn_acceptance_mismatch", randomUUID());
  const mismatch = await candidate.client.rpc("enqueue_pasted_link_application", {
    p_command_id: commandId,
    p_canonical_url: mismatchUrl.toString(),
  });
  if (!mismatch.error || safeErrorCode(mismatch.error) !== "23505") {
    throw new AcceptanceFailure(
      `ENQUEUE_MISMATCH_NOT_REJECTED:${safeErrorCode(mismatch.error)}`,
    );
  }

  return firstRow;
}

async function verifyDeadLetterRecovery(
  config: AcceptanceConfig,
  owner: AcceptanceCandidate,
  application: EnqueueRow,
): Promise<void> {
  const admin = createAdminClient(config);
  const workerId = `m0-${config.runId}-${randomUUID()}`.slice(0, 120);
  let claimedOutboxId: string | null = null;

  const acceptanceMessage = await admin
    .from("outbox")
    .select("id")
    .eq("workspace_id", owner.workspaceId)
    .eq("topic", "application.queued")
    .is("published_at", null)
    .is("dead_lettered_at", null)
    .single();
  assertRemoteOk(acceptanceMessage.error, "ACCEPTANCE_OUTBOX_READ_FAILED");
  const { error: prioritizeError } = await admin
    .from("outbox")
    .update({ available_at: new Date(0).toISOString() })
    .eq("id", acceptanceMessage.data.id)
    .eq("workspace_id", owner.workspaceId);
  assertRemoteOk(prioritizeError, "ACCEPTANCE_OUTBOX_PRIORITY_FAILED");

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const claim = await admin.rpc("claim_outbox_batch", {
      p_worker_id: workerId,
      p_limit: 1,
      p_lease_seconds: 120,
      p_topics: ["application.queued"],
    });
    assertRemoteOk(claim.error, `OUTBOX_CLAIM_FAILED_${attempt}`);
    const message = claim.data.find(
      (candidate) =>
        candidate.payload &&
        !Array.isArray(candidate.payload) &&
        typeof candidate.payload === "object" &&
        candidate.payload.application_id === application.application_id,
    );
    if (!message) {
      throw new AcceptanceFailure(`ACCEPTANCE_OUTBOX_NOT_CLAIMED_${attempt}`);
    }
    claimedOutboxId = message.outbox_id;
    if (message.attempt_count !== attempt) {
      throw new AcceptanceFailure(`OUTBOX_ATTEMPT_COUNT_INVALID_${attempt}`);
    }

    const transition = attempt < 5
      ? await admin.rpc("fail_outbox_message", {
          p_worker_id: workerId,
          p_outbox_id: message.outbox_id,
          p_error_code: "M0_ACCEPTANCE_RETRY",
          p_retry_after_seconds: 1,
        })
      : await admin.rpc("dead_letter_outbox_message", {
          p_worker_id: workerId,
          p_outbox_id: message.outbox_id,
          p_error_code: "M0_ACCEPTANCE_DEAD_LETTER",
        });
    assertRemoteOk(transition.error, `OUTBOX_FAILURE_TRANSITION_FAILED_${attempt}`);
    if (transition.data !== true) {
      throw new AcceptanceFailure(`OUTBOX_FAILURE_TRANSITION_INVALID_${attempt}`);
    }

    if (attempt < 5) {
      const { error: makeAvailableError } = await admin
        .from("outbox")
        .update({ available_at: new Date(0).toISOString() })
        .eq("id", message.outbox_id)
        .eq("last_error", "M0_ACCEPTANCE_RETRY");
      assertRemoteOk(makeAvailableError, `OUTBOX_TEST_RETRY_SCHEDULE_FAILED_${attempt}`);
    }
  }
  if (!claimedOutboxId) throw new AcceptanceFailure("ACCEPTANCE_OUTBOX_ID_MISSING");

  const ownerRecoveryClient = createCandidateClient(config);
  const ownerSession = await ownerRecoveryClient.auth.signInWithPassword({
    email: owner.email,
    password: owner.password,
  });
  if (ownerSession.error || ownerSession.data.user?.id !== owner.userId) {
    throw new AcceptanceFailure("OWNER_RECOVERY_SESSION_ATTACH_FAILED");
  }
  const candidateList = await ownerRecoveryClient.rpc(
    "list_dead_lettered_outbox",
    { p_limit: 100 },
  );
  assertRemoteOk(candidateList.error, "OWNER_DEAD_LETTER_LIST_FAILED");
  if (candidateList.data.length !== 0) {
    throw new AcceptanceFailure("OWNER_CAN_LIST_DEAD_LETTERS");
  }

  const deadLetterForDeniedWrite = await admin
    .from("outbox")
    .select("dead_lettered_at")
    .eq("id", claimedOutboxId)
    .single();
  assertRemoteOk(
    deadLetterForDeniedWrite.error,
    "OWNER_DENIAL_DEAD_LETTER_READ_FAILED",
  );
  if (!deadLetterForDeniedWrite.data.dead_lettered_at) {
    throw new AcceptanceFailure("OWNER_DENIAL_DEAD_LETTER_TIMESTAMP_MISSING");
  }
  const deniedRequeue = await ownerRecoveryClient.rpc(
    "requeue_dead_lettered_outbox",
    {
      p_outbox_id: claimedOutboxId,
      p_expected_dead_lettered_at:
        deadLetterForDeniedWrite.data.dead_lettered_at,
      p_reason: `Denied owner-only acceptance attempt ${config.runId}`,
    },
  );
  if (!deniedRequeue.error || safeErrorCode(deniedRequeue.error) !== "42501") {
    throw new AcceptanceFailure(
      `OWNER_REQUEUE_NOT_REJECTED:${safeErrorCode(deniedRequeue.error)}`,
    );
  }

  const supportClient = createCandidateClient(config);
  const supportSignIn = await supportClient.auth.signInWithPassword({
    email: owner.email,
    password: owner.password,
  });
  if (supportSignIn.error || supportSignIn.data.user?.id !== owner.userId) {
    throw new AcceptanceFailure("SUPPORT_SESSION_ATTACH_FAILED");
  }

  const { error: supportMembershipError } = await admin
    .from("workspace_memberships")
    .update({ role: "SUPPORT" })
    .eq("workspace_id", owner.workspaceId)
    .eq("auth_user_id", owner.userId);
  assertRemoteOk(supportMembershipError, "SUPPORT_MEMBERSHIP_ASSIGN_FAILED");

  try {
    const listed = await supportClient.rpc("list_dead_lettered_outbox", {
      p_limit: 100,
    });
    assertRemoteOk(listed.error, "DEAD_LETTER_LIST_FAILED");
    const deadLetter = listed.data.find(
      (message) => message.outbox_id === claimedOutboxId,
    );
    if (
      !deadLetter ||
      deadLetter.attempt_count !== 5 ||
      deadLetter.dead_letter_reason !== "M0_ACCEPTANCE_DEAD_LETTER"
    ) {
      throw new AcceptanceFailure("DEAD_LETTER_LIST_INVARIANT_FAILED");
    }

    const requeued = await supportClient.rpc("requeue_dead_lettered_outbox", {
      p_outbox_id: deadLetter.outbox_id,
      p_expected_dead_lettered_at: deadLetter.dead_lettered_at,
      p_reason: `Milestone 0 acceptance ${config.runId}`,
    });
    assertRemoteOk(requeued.error, "DEAD_LETTER_REQUEUE_FAILED");
    const recovery = firstRpcRow(requeued.data);
    if (!recovery || recovery.outbox_id !== deadLetter.outbox_id) {
      throw new AcceptanceFailure("DEAD_LETTER_REQUEUE_INVARIANT_FAILED");
    }

    const [
      messageAfter,
      recoveryAction,
      approvals,
      consumptions,
      attempts,
      receipts,
    ] = await Promise.all([
      admin
        .from("outbox")
        .select(
          "id, attempt_count, last_error, dead_lettered_at, dead_letter_reason, published_at",
        )
        .eq("id", deadLetter.outbox_id)
        .single(),
      createClient(config.url, config.secretKey, {
        auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      })
        .from("outbox_recovery_actions")
        .select("id, outbox_id, operator_auth_user_id, action, reason")
        .eq("id", recovery.recovery_action_id)
        .single(),
      owner.client
        .from("approval_challenges")
        .select("application_id")
        .eq("application_id", application.application_id),
      owner.client
        .from("approval_consumptions")
        .select("application_id")
        .eq("application_id", application.application_id),
      owner.client
        .from("application_attempts")
        .select("application_id")
        .eq("application_id", application.application_id),
      owner.client
        .from("receipts")
        .select("application_id")
        .eq("application_id", application.application_id),
    ]);
    assertRemoteOk(messageAfter.error, "REQUEUED_MESSAGE_READ_FAILED");
    assertRemoteOk(recoveryAction.error, "RECOVERY_ACTION_READ_FAILED");
    assertRemoteOk(approvals.error, "POST_RECOVERY_APPROVAL_READ_FAILED");
    assertRemoteOk(consumptions.error, "POST_RECOVERY_CONSUMPTION_READ_FAILED");
    assertRemoteOk(attempts.error, "POST_RECOVERY_ATTEMPT_READ_FAILED");
    assertRemoteOk(receipts.error, "POST_RECOVERY_RECEIPT_READ_FAILED");
    const recoveryData = recoveryAction.data as unknown as {
      outbox_id: string;
      operator_auth_user_id: string;
      action: string;
      reason: string;
    };
    if (
      messageAfter.data.attempt_count !== 0 ||
      messageAfter.data.last_error !== null ||
      messageAfter.data.dead_lettered_at !== null ||
      messageAfter.data.dead_letter_reason !== null ||
      messageAfter.data.published_at !== null ||
      recoveryData.outbox_id !== deadLetter.outbox_id ||
      recoveryData.operator_auth_user_id !== owner.userId ||
      recoveryData.action !== "REQUEUED" ||
      approvals.data.length !== 0 ||
      consumptions.data.length !== 0 ||
      attempts.data.length !== 0 ||
      receipts.data.length !== 0
    ) {
      throw new AcceptanceFailure("OUTBOX_RECOVERY_INVARIANT_FAILED");
    }
  } finally {
    const { error: restoreMembershipError } = await admin
      .from("workspace_memberships")
      .update({ role: "OWNER" })
      .eq("workspace_id", owner.workspaceId)
      .eq("auth_user_id", owner.userId);
    assertRemoteOk(restoreMembershipError, "OWNER_MEMBERSHIP_RESTORE_FAILED");
  }
}

async function verifyApplicationReadInvariants(
  owner: AcceptanceCandidate,
  other: AcceptanceCandidate,
  application: EnqueueRow,
  expectedJobUrl: string,
): Promise<void> {
  const [ownApplication, ownIntake, ownRuns, ownEvents, ownReceipts] =
    await Promise.all([
      owner.client
        .from("applications")
        .select(
          "id, workspace_id, candidate_id, job_intake_id, status, queued_at, aggregate_version",
        )
        .eq("id", application.application_id)
        .single(),
      owner.client
        .from("job_intakes")
        .select("id, workspace_id, candidate_id, canonical_url, status")
        .eq("id", application.job_intake_id)
        .single(),
      owner.client
        .from("application_runs")
        .select("application_id, run_kind, status")
        .eq("application_id", application.application_id),
      owner.client
        .from("domain_events")
        .select("aggregate_id, aggregate_version, event_type, actor_kind")
        .eq("aggregate_type", "APPLICATION")
        .eq("aggregate_id", application.application_id),
      owner.client
        .from("receipts")
        .select("application_id")
        .eq("application_id", application.application_id),
    ]);

  assertRemoteOk(ownApplication.error, "APPLICATION_SELF_READ_FAILED");
  assertRemoteOk(ownIntake.error, "INTAKE_SELF_READ_FAILED");
  assertRemoteOk(ownRuns.error, "RUN_SELF_READ_FAILED");
  assertRemoteOk(ownEvents.error, "EVENT_SELF_READ_FAILED");
  assertRemoteOk(ownReceipts.error, "RECEIPT_SELF_READ_FAILED");

  if (
    ownApplication.data.workspace_id !== owner.workspaceId ||
    ownApplication.data.candidate_id !== owner.candidateId ||
    ownApplication.data.job_intake_id !== application.job_intake_id ||
    ownApplication.data.status !== "DRAFTING" ||
    ownApplication.data.aggregate_version !== 1 ||
    ownIntake.data.workspace_id !== owner.workspaceId ||
    ownIntake.data.candidate_id !== owner.candidateId ||
    ownIntake.data.canonical_url !== expectedJobUrl ||
    !["PENDING", "RESOLVING", "RESOLVED", "FAILED"].includes(
      ownIntake.data.status,
    ) ||
    ownRuns.data.length !== 1 ||
    ownRuns.data[0]?.run_kind !== "PREPARATION" ||
    ownRuns.data[0]?.status !== "QUEUED" ||
    ownEvents.data.length !== 1 ||
    ownEvents.data[0]?.event_type !== "application.queued" ||
    ownEvents.data[0]?.actor_kind !== "CANDIDATE" ||
    ownReceipts.data.length !== 0
  ) {
    throw new AcceptanceFailure("APPLICATION_DETAIL_INVARIANT_FAILED");
  }

  const foreignReads = await Promise.all([
    other.client.from("applications").select("id").eq("id", application.application_id),
    other.client.from("job_intakes").select("id").eq("id", application.job_intake_id),
    other.client.from("application_runs").select("id").eq("application_id", application.application_id),
    other.client.from("domain_events").select("id").eq("aggregate_id", application.application_id),
    other.client.from("receipts").select("id").eq("application_id", application.application_id),
  ]);
  for (const [index, result] of foreignReads.entries()) {
    assertRemoteOk(result.error, `FOREIGN_READ_QUERY_FAILED_${index}`);
    if (result.data.length !== 0) {
      throw new AcceptanceFailure(`TENANT_ISOLATION_FAILED_${index}`);
    }
  }
}

async function verifyPostWorkerState(
  owner: AcceptanceCandidate,
  application: EnqueueRow,
): Promise<void> {
  const [app, intake, events, receipts] = await Promise.all([
    owner.client
      .from("applications")
      .select("status, job_id, job_version_id, aggregate_version")
      .eq("id", application.application_id)
      .single(),
    owner.client
      .from("job_intakes")
      .select("status, resolved_job_id, resolved_job_version_id, failure_code")
      .eq("id", application.job_intake_id)
      .single(),
    owner.client
      .from("domain_events")
      .select("event_type, aggregate_version")
      .eq("aggregate_id", application.application_id)
      .order("aggregate_version", { ascending: true }),
    owner.client
      .from("receipts")
      .select("application_id")
      .eq("application_id", application.application_id),
  ]);
  assertRemoteOk(app.error, "POST_WORKER_APPLICATION_READ_FAILED");
  assertRemoteOk(intake.error, "POST_WORKER_INTAKE_READ_FAILED");
  assertRemoteOk(events.error, "POST_WORKER_EVENT_READ_FAILED");
  assertRemoteOk(receipts.error, "POST_WORKER_RECEIPT_READ_FAILED");

  if (receipts.data.length !== 0 || app.data.status === "CONFIRMED") {
    throw new AcceptanceFailure("WORKER_CREATED_UNSUPPORTED_SUBMISSION_EVIDENCE");
  }
  if (
    intake.data.status !== "RESOLVED" ||
    !intake.data.resolved_job_id ||
    !intake.data.resolved_job_version_id ||
    app.data.job_id !== intake.data.resolved_job_id ||
    app.data.job_version_id !== intake.data.resolved_job_version_id ||
    !events.data.some((event) => event.event_type === "application.job_resolved")
  ) {
    throw new AcceptanceFailure(
      `WORKER_DID_NOT_RESOLVE_CURRENT_FIXTURE:${intake.data.failure_code ?? intake.data.status}`,
    );
  }
}

async function cleanup(
  config: AcceptanceConfig,
  record: CleanupRecord,
): Promise<string[]> {
  if (record.projectRef !== config.expectedProjectRef) {
    throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
  }
  const admin = createAdminClient(config);
  const errors: string[] = [];
  for (let index = 0; index < record.userIds.length; index += 1) {
    const userId = record.userIds[index];
    const email = record.emails[index];
    const workspaceId = record.workspaceIds[index];
    assertAcceptanceEmail(email);
    const fetched = await admin.auth.admin.getUserById(userId);
    if (fetched.error) {
      if (safeErrorCode(fetched.error) === "user_not_found") {
        continue;
      }
      errors.push(`${email}:AUTH_USER_LOOKUP_FAILED:${safeErrorCode(fetched.error)}`);
      continue;
    }
    if (fetched.data.user.email?.toLowerCase() !== email.toLowerCase()) {
      errors.push(`${email}:AUTH_USER_EMAIL_MISMATCH`);
      continue;
    }
    const workspace = await admin
      .from("workspaces")
      .select("id, name, kind, personal_owner_auth_user_id")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspace.error) {
      errors.push(`${email}:WORKSPACE_LOOKUP_FAILED:${safeErrorCode(workspace.error)}`);
      continue;
    }
    if (
      workspace.data &&
      (workspace.data.kind !== "PERSONAL" ||
        workspace.data.personal_owner_auth_user_id !== userId ||
        !workspace.data.name.startsWith("RoleDawn M0 "))
    ) {
      errors.push(`${email}:WORKSPACE_IDENTITY_MISMATCH`);
      continue;
    }
    if (workspace.data) {
      const removedWorkspace = await admin
        .from("workspaces")
        .delete()
        .eq("id", workspaceId)
        .eq("personal_owner_auth_user_id", userId);
      if (removedWorkspace.error) {
        errors.push(
          `${email}:WORKSPACE_DELETE_FAILED:${safeErrorCode(removedWorkspace.error)}`,
        );
        continue;
      }
    }
    const deleted = await admin.auth.admin.deleteUser(userId, false);
    if (deleted.error) {
      errors.push(`${email}:AUTH_USER_DELETE_FAILED:${safeErrorCode(deleted.error)}`);
    }
  }
  return errors;
}

async function preserveCleanupRecord(record: CleanupRecord): Promise<string> {
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
  const target = resolve(ARTIFACT_DIRECTORY, `m0-${record.runId}-cleanup.json`);
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  return target;
}

async function main(): Promise<void> {
  const config = requireAcceptanceConfig();
  const checks: AcceptanceCheck[] = [];
  const candidates: AcceptanceCandidate[] = [];
  let record: CleanupRecord | null = null;
  let cleanupArtifact: string | null = null;
  let exitCode = 0;

  process.stdout.write(
    `RoleDawn Milestone 0 hosted acceptance\nproject=${config.expectedProjectRef}\nrun=${config.runId}\n`,
  );

  try {
    const admin = createAdminClient(config);
    const anonymous = createCandidateClient(config);
    const anonymousApplicationRead = await anonymous.from("applications").select("id").limit(1);
    if (!anonymousApplicationRead.error) {
      throw new AcceptanceFailure("ANONYMOUS_APPLICATION_READ_NOT_REJECTED");
    }
    report(checks, "anonymous-denial", "applications reject anonymous reads");

    const alpha = await createCandidate(config, "alpha");
    candidates.push(alpha);
    record = createCleanupRecord(config, candidates);
    cleanupArtifact = await preserveCleanupRecord(record);

    const beta = await createCandidate(config, "beta");
    candidates.push(beta);
    record = createCleanupRecord(config, candidates);
    cleanupArtifact = await preserveCleanupRecord(record);
    report(checks, "two-real-auth-users", "two confirmed Auth users established normal sessions");
    report(checks, "bootstrap-replay", "both personal workspace bootstraps replay to stable IDs");

    await Promise.all([verifyOwnTenancy(alpha), verifyOwnTenancy(beta)]);
    report(checks, "self-tenancy", "each session reads its own workspace, membership, and candidate");

    const application = await enqueueAndReplay(alpha, config.jobUrl);
    report(checks, "enqueue-replay", "same command and payload return one stable application");
    report(checks, "same-url-dedup", "a new command for the same canonical URL returns the original application");
    report(checks, "mismatched-replay", "same command with a different payload is rejected");

    await verifyApplicationReadInvariants(alpha, beta, application, config.jobUrl);
    report(checks, "application-detail", "aggregate, intake, run, event, and no-receipt invariants hold");
    report(checks, "tenant-isolation", "the second session reads zero rows for the first application");

    await verifyDeadLetterRecovery(config, alpha, application);
    report(checks, "outbox-retry", "the acceptance message reaches exactly five claimed attempts");
    report(checks, "dead-letter-access", "candidate/owner access fails and an explicit support member can inspect");
    report(checks, "dead-letter-requeue", "one audited optimistic requeue resets delivery state without a receipt");

    if (config.runWorker) {
      const worker = await runPreparationWorkerOnce();
      if (worker.claimed !== 1 || worker.completed !== 1 || worker.failed !== 0) {
        throw new AcceptanceFailure(
          `WORKER_RESOLUTION_COUNTS_INVALID:claimed=${worker.claimed},completed=${worker.completed},failed=${worker.failed}`,
        );
      }
      await verifyPostWorkerState(alpha, application);
      report(
        checks,
        "optional-worker",
        `worker claimed=${worker.claimed} completed=${worker.completed} failed=${worker.failed}`,
      );
    } else {
      skip(
        checks,
        "optional-worker",
        "set ACCEPTANCE_RUN_WORKER=true only after official-source network access is approved",
      );
    }

    const adminRows = await admin
      .from("workspaces")
      .select("id")
      .in("id", candidates.map((candidate) => candidate.workspaceId));
    assertRemoteOk(adminRows.error, "SERVICE_ROLE_WORKSPACE_READ_FAILED");
    if (adminRows.data.length !== candidates.length) {
      throw new AcceptanceFailure("SERVICE_ROLE_WORKSPACE_COUNT_INVALID");
    }
    report(checks, "service-boundary", "server-only client can account for both acceptance workspaces");
  } catch (error) {
    exitCode = 1;
    const message = error instanceof Error ? error.message : "UNKNOWN_ACCEPTANCE_FAILURE";
    process.stderr.write(`FAIL ${message}\n`);
  } finally {
    if (record && !config.keepArtifacts) {
      try {
        const cleanupErrors = await cleanup(config, record);
        if (cleanupErrors.length === 0) {
          process.stdout.write("PASS cleanup — acceptance Auth users and cascading tenant data removed\n");
        } else {
          exitCode = 1;
          process.stderr.write(
            `FAIL cleanup incomplete; use ${cleanupArtifact}\n${cleanupErrors.join("\n")}\n`,
          );
        }
      } catch (error) {
        exitCode = 1;
        const message = error instanceof Error ? error.message : "UNKNOWN_CLEANUP_FAILURE";
        process.stderr.write(`FAIL cleanup:${message}; use ${cleanupArtifact}\n`);
      }
    } else if (record) {
      process.stdout.write(`KEEP acceptance artifacts; cleanup record: ${cleanupArtifact}\n`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({ runId: config.runId, projectRef: config.expectedProjectRef, checks }, null, 2)}\n`,
  );
  process.exitCode = exitCode;
}

await main();
