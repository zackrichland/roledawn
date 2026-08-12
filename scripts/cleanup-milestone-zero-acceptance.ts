import { readFile } from "node:fs/promises";

import {
  AcceptanceFailure,
  assertAcceptanceEmail,
  createAdminClient,
  requireAcceptanceConfig,
  safeErrorCode,
  validateCleanupRecord,
} from "./milestone-zero-acceptance-lib.ts";

const recordPath = process.argv[2];
if (!recordPath) {
  throw new AcceptanceFailure(
    "USAGE: npm run acceptance:m0:cleanup -- artifacts/acceptance/m0-<run>-cleanup.json",
  );
}

const config = requireAcceptanceConfig();
const record = validateCleanupRecord(JSON.parse(await readFile(recordPath, "utf8")));
if (record.projectRef !== config.expectedProjectRef) {
  throw new AcceptanceFailure("CLEANUP_PROJECT_MISMATCH");
}

const admin = createAdminClient(config);
const failures: string[] = [];
for (let index = 0; index < record.userIds.length; index += 1) {
  const userId = record.userIds[index];
  const email = record.emails[index];
  const workspaceId = record.workspaceIds[index];
  assertAcceptanceEmail(email);

  const fetched = await admin.auth.admin.getUserById(userId);
  if (fetched.error) {
    if (safeErrorCode(fetched.error) === "user_not_found") {
      process.stdout.write(`Already removed ${email}\n`);
      continue;
    }
    failures.push(`${email}:AUTH_USER_LOOKUP_FAILED:${safeErrorCode(fetched.error)}`);
    continue;
  }
  if (fetched.data.user.email?.toLowerCase() !== email.toLowerCase()) {
    failures.push(`${email}:AUTH_USER_EMAIL_MISMATCH`);
    continue;
  }
  const workspace = await admin
    .from("workspaces")
    .select("id, name, kind, personal_owner_auth_user_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspace.error) {
    failures.push(`${email}:WORKSPACE_LOOKUP_FAILED:${safeErrorCode(workspace.error)}`);
    continue;
  }
  if (
    workspace.data &&
    (workspace.data.kind !== "PERSONAL" ||
      workspace.data.personal_owner_auth_user_id !== userId ||
      !workspace.data.name.startsWith("RoleDawn M0 "))
  ) {
    failures.push(`${email}:WORKSPACE_IDENTITY_MISMATCH`);
    continue;
  }
  if (workspace.data) {
    const removedWorkspace = await admin
      .from("workspaces")
      .delete()
      .eq("id", workspaceId)
      .eq("personal_owner_auth_user_id", userId);
    if (removedWorkspace.error) {
      failures.push(
        `${email}:WORKSPACE_DELETE_FAILED:${safeErrorCode(removedWorkspace.error)}`,
      );
      continue;
    }
  }
  const deleted = await admin.auth.admin.deleteUser(userId, false);
  if (deleted.error) {
    failures.push(`${email}:AUTH_USER_DELETE_FAILED:${safeErrorCode(deleted.error)}`);
  } else {
    process.stdout.write(`Removed ${email}\n`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Milestone 0 acceptance cleanup complete.\n");
}
