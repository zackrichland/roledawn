import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type AuthorizeApplicationFillCommand = Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
  expectedRevisionId: string;
  expectedPacketHash: string;
}>;

export type AuthorizeApplicationFillResult = Readonly<{
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  browserRunId: string;
  aggregateVersion: number;
  replayed: boolean;
}>;

export class ApplicationFillAuthorizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApplicationFillAuthorizationError";
  }
}

function oneRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0];
  return row !== null && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

function failForDatabaseError(error: { code?: string; message?: string } | null): never {
  const code = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code;

  switch (code) {
    case "APPLICATION_FILL_INPUTS_STALE":
      throw new ApplicationFillAuthorizationError(
        code,
        "Your profile changed after these files were prepared. Refresh the files before filling the form.",
      );
    case "APPLICATION_FILL_REVIEW_STALE":
    case "APPLICATION_VERSION_MISMATCH":
      throw new ApplicationFillAuthorizationError(
        code,
        "This application changed. Reload and review the current files before filling the form.",
      );
    case "COMMAND_ALREADY_IN_PROGRESS":
      throw new ApplicationFillAuthorizationError(
        code,
        "This fill request is still being recorded. Reload to see its status.",
      );
    case "APPLICATION_FILL_REVISION_INVALID":
    case "APPLICATION_FILL_ARTIFACT_SET_INVALID":
    case "APPLICATION_FILL_DESTINATION_INVALID":
    case "APPLICATION_FILL_JOB_UNRESOLVED":
      throw new ApplicationFillAuthorizationError(
        code,
        "This application is not ready for form filling. Review the job and files, then try again.",
      );
    case "AUTHENTICATION_REQUIRED":
    case "42501":
      throw new ApplicationFillAuthorizationError(
        code,
        "Sign in again before filling this application.",
      );
    case "23505":
      throw new ApplicationFillAuthorizationError(
        code,
        "A fill is already queued for this application. Reload to see its status.",
      );
    case "PGRST202":
    case "42883":
      throw new ApplicationFillAuthorizationError(
        code,
        "Form filling is not available yet. Try again after the latest update is deployed.",
      );
    default:
      throw new ApplicationFillAuthorizationError(
        code ?? "APPLICATION_FILL_AUTHORIZATION_FAILED",
        "RoleDawn could not queue this form fill. Nothing was submitted.",
      );
  }
}

export async function authorizeApplicationFillOnce(
  command: AuthorizeApplicationFillCommand,
): Promise<AuthorizeApplicationFillResult> {
  if (
    !UUID_PATTERN.test(command.commandId) ||
    !UUID_PATTERN.test(command.applicationId) ||
    !UUID_PATTERN.test(command.expectedRevisionId) ||
    !Number.isSafeInteger(command.expectedAggregateVersion) ||
    command.expectedAggregateVersion < 1 ||
    !SHA256_PATTERN.test(command.expectedPacketHash)
  ) {
    throw new ApplicationFillAuthorizationError(
      "APPLICATION_FILL_AUTHORIZATION_INPUT_INVALID",
      "Reload and review the current application before filling the form.",
    );
  }

  const client = await createSupabaseServerClient();
  const result = await client.rpc("authorize_application_fill_once", {
    p_command_id: command.commandId,
    p_application_id: command.applicationId,
    p_expected_aggregate_version: command.expectedAggregateVersion,
    p_expected_revision_id: command.expectedRevisionId,
    p_expected_packet_hash: command.expectedPacketHash,
  });
  if (result.error) failForDatabaseError(result.error);

  const row = oneRow(result.data);
  if (
    !row ||
    typeof row.application_id !== "string" ||
    !UUID_PATTERN.test(row.application_id) ||
    typeof row.revision_id !== "string" ||
    !UUID_PATTERN.test(row.revision_id) ||
    typeof row.fill_attempt_id !== "string" ||
    !UUID_PATTERN.test(row.fill_attempt_id) ||
    typeof row.browser_run_id !== "string" ||
    !UUID_PATTERN.test(row.browser_run_id) ||
    typeof row.aggregate_version !== "number" ||
    !Number.isSafeInteger(row.aggregate_version) ||
    row.aggregate_version < 1 ||
    typeof row.replayed !== "boolean"
  ) {
    throw new ApplicationFillAuthorizationError(
      "APPLICATION_FILL_AUTHORIZATION_PROTOCOL_INVALID",
      "RoleDawn could not confirm that the form fill was queued. Nothing was submitted.",
    );
  }

  return Object.freeze({
    applicationId: row.application_id,
    revisionId: row.revision_id,
    fillAttemptId: row.fill_attempt_id,
    browserRunId: row.browser_run_id,
    aggregateVersion: row.aggregate_version,
    replayed: row.replayed,
  });
}
