import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  type CandidateEvidenceCleanupRecord,
  assertCandidateEvidenceAcceptanceEmail,
  createCandidateEvidenceAcceptancePassword,
  createCandidateEvidenceClient,
  requireCandidateEvidenceCleanupConfig,
  safeCandidateEvidenceErrorCode,
  validateCandidateEvidenceCleanupRecord,
} from "./candidate-evidence-acceptance-lib.ts";
import { AcceptanceFailure, assertRemoteOk } from "./milestone-zero-acceptance-lib.ts";

const ARTIFACT_DIRECTORY = resolve("artifacts/acceptance");
const VAULT_BUCKET = "career-vault";

async function loadCleanupRecord(
  recordPath: string,
): Promise<CandidateEvidenceCleanupRecord> {
  const resolvedPath = resolve(recordPath);
  const allowedDirectory = await realpath(ARTIFACT_DIRECTORY);
  const parentDirectory = await realpath(dirname(resolvedPath));
  if (parentDirectory !== allowedDirectory) {
    throw new AcceptanceFailure("CLEANUP_RECORD_OUTSIDE_ACCEPTANCE_DIRECTORY");
  }

  const stats = await lstat(resolvedPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new AcceptanceFailure("CLEANUP_RECORD_FILE_INVALID");
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new AcceptanceFailure("CLEANUP_RECORD_PERMISSIONS_UNSAFE");
  }

  const parsed = validateCandidateEvidenceCleanupRecord(
    JSON.parse(await readFile(resolvedPath, "utf8")),
  );
  if (basename(resolvedPath) !== `evidence-${parsed.runId}-cleanup.json`) {
    throw new AcceptanceFailure("CLEANUP_RECORD_FILENAME_MISMATCH");
  }
  return parsed;
}

const recordPath = process.argv[2];
if (!recordPath) {
  throw new AcceptanceFailure(
    "USAGE: npm run acceptance:evidence:cleanup -- artifacts/acceptance/evidence-<run>-cleanup.json",
  );
}

const config = requireCandidateEvidenceCleanupConfig();
const record = await loadCleanupRecord(recordPath);
if (record.projectRef !== config.expectedProjectRef) {
  throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
}

const admin = createCandidateEvidenceClient(config, config.secretKey);
const preflight = [];
for (const identity of record.identities) {
  assertCandidateEvidenceAcceptanceEmail(identity.email);
  const [workspace, user] = await Promise.all([
    admin
      .from("workspaces")
      .select("id, name, kind, personal_owner_auth_user_id")
      .eq("id", identity.workspaceId)
      .maybeSingle(),
    admin.auth.admin.getUserById(identity.userId),
  ]);
  assertRemoteOk(workspace.error, `CLEANUP_WORKSPACE_LOOKUP_${identity.label}`);
  if (
    workspace.data &&
    (workspace.data.name !== identity.workspaceName ||
      workspace.data.kind !== "PERSONAL" ||
      workspace.data.personal_owner_auth_user_id !== identity.userId)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_WORKSPACE_IDENTITY_MISMATCH_${identity.label}`,
    );
  }
  if (
    !user.error &&
    (user.data.user.email?.toLowerCase() !== identity.email.toLowerCase() ||
      user.data.user.app_metadata.roledawn_acceptance_run_id !== record.runId)
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_AUTH_IDENTITY_MISMATCH_${identity.label}`,
    );
  }
  if (
    user.error &&
    safeCandidateEvidenceErrorCode(user.error) !== "user_not_found"
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_AUTH_LOOKUP_${identity.label}:${safeCandidateEvidenceErrorCode(user.error)}`,
    );
  }
  preflight.push({ identity, workspace: workspace.data, user: user.data.user });
}

if (record.storageObjectPaths.length > 0) {
  const removed = await admin.storage
    .from(VAULT_BUCKET)
    .remove([...record.storageObjectPaths]);
  assertRemoteOk(removed.error, "CLEANUP_STORAGE_REMOVE_FAILED");
}

for (const entry of preflight) {
  const { identity } = entry;
  let candidateClient = null;
  if (entry.user) {
    const password = createCandidateEvidenceAcceptancePassword();
    const updated = await admin.auth.admin.updateUserById(identity.userId, {
      password,
    });
    assertRemoteOk(updated.error, `CLEANUP_PASSWORD_RESET_${identity.label}`);
    candidateClient = createCandidateEvidenceClient(
      config,
      config.publishableKey,
    );
    const signedIn = await candidateClient.auth.signInWithPassword({
      email: identity.email,
      password,
    });
    assertRemoteOk(signedIn.error, `CLEANUP_SIGN_IN_${identity.label}`);
  }

  if (entry.workspace) {
    const documents = await admin
      .from("source_documents")
      .select("id, status, aggregate_version")
      .eq("workspace_id", identity.workspaceId);
    assertRemoteOk(documents.error, `CLEANUP_DOCUMENTS_${identity.label}`);
    for (const document of documents.data) {
      if (document.status !== "DELETION_PENDING") {
        if (!candidateClient) {
          throw new AcceptanceFailure(
            `CLEANUP_CANDIDATE_SESSION_REQUIRED_${identity.label}`,
          );
        }
        const requested = await candidateClient.rpc(
          "request_source_document_deletion",
          {
            p_command_id: randomUUID(),
            p_document_id: document.id,
            p_expected_aggregate_version: document.aggregate_version,
          },
        );
        assertRemoteOk(
          requested.error,
          `CLEANUP_DELETE_REQUEST_${identity.label}`,
        );
      }
      const completed = await admin.rpc("complete_source_document_deletion", {
        p_document_id: document.id,
      });
      assertRemoteOk(
        completed.error,
        `CLEANUP_DOCUMENT_PURGE_${identity.label}`,
      );
      if (completed.data !== true) {
        throw new AcceptanceFailure(
          `CLEANUP_DOCUMENT_PURGE_FALSE_${identity.label}`,
        );
      }
    }

    const removedWorkspace = await admin
      .from("workspaces")
      .delete()
      .eq("id", identity.workspaceId)
      .eq("personal_owner_auth_user_id", identity.userId);
    assertRemoteOk(
      removedWorkspace.error,
      `CLEANUP_WORKSPACE_DELETE_${identity.label}`,
    );
  }

  if (candidateClient) {
    const signedOut = await candidateClient.auth.signOut({ scope: "global" });
    assertRemoteOk(signedOut.error, `CLEANUP_SIGN_OUT_${identity.label}`);
  }
  if (entry.user) {
    const deleted = await admin.auth.admin.deleteUser(identity.userId, false);
    assertRemoteOk(deleted.error, `CLEANUP_AUTH_DELETE_${identity.label}`);
  }
}

for (const identity of record.identities) {
  const [workspace, user] = await Promise.all([
    admin.from("workspaces").select("id").eq("id", identity.workspaceId),
    admin.auth.admin.getUserById(identity.userId),
  ]);
  assertRemoteOk(workspace.error, `CLEANUP_VERIFY_WORKSPACE_${identity.label}`);
  if (workspace.data.length !== 0) {
    throw new AcceptanceFailure(
      `CLEANUP_VERIFY_WORKSPACE_REMAINS_${identity.label}`,
    );
  }
  if (
    !user.error ||
    safeCandidateEvidenceErrorCode(user.error) !== "user_not_found"
  ) {
    throw new AcceptanceFailure(
      `CLEANUP_VERIFY_AUTH_REMAINS_${identity.label}`,
    );
  }
}

process.stdout.write("Candidate-evidence acceptance cleanup complete.\n");
