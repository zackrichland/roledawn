import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RequestApplicationFillResumeCommand = Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
  fillAttemptId: string;
  computerSessionId: string;
  candidateCompletedRequiredFields: true;
}>;

export type RequestApplicationFillResumeResult = Readonly<{
  applicationId: string;
  fillAttemptId: string;
  computerSessionId: string;
  resumeAttemptId: string;
  aggregateVersion: number;
  replayed: boolean;
}>;

export class ApplicationFillResumeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApplicationFillResumeError";
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
    case "APPLICATION_FILL_RESUME_REVIEW_STALE":
    case "APPLICATION_VERSION_MISMATCH":
      throw new ApplicationFillResumeError(
        code,
        "This application changed. Reload before continuing the browser.",
      );
    case "APPLICATION_FILL_RESUME_STATE_INVALID":
      throw new ApplicationFillResumeError(
        code,
        "This secure browser is no longer available to continue. Nothing was submitted.",
      );
    case "COMMAND_ALREADY_IN_PROGRESS":
      throw new ApplicationFillResumeError(
        code,
        "The secure browser is already continuing. Reload to see its status.",
      );
    case "APPLICATION_FILL_SUBMISSION_STATE_CONFLICT":
      throw new ApplicationFillResumeError(
        code,
        "RoleDawn stopped because this application already has submission activity.",
      );
    case "AUTHENTICATION_REQUIRED":
    case "42501":
      throw new ApplicationFillResumeError(
        code,
        "Sign in again before continuing this application.",
      );
    case "23505":
      throw new ApplicationFillResumeError(
        code,
        "This continuation was already requested. Reload to see its status.",
      );
    case "PGRST202":
    case "42883":
      throw new ApplicationFillResumeError(
        code,
        "Secure browser continuation is not available yet.",
      );
    default:
      throw new ApplicationFillResumeError(
        code ?? "APPLICATION_FILL_RESUME_REQUEST_FAILED",
        "RoleDawn could not continue the secure browser. Nothing was submitted.",
      );
  }
}

export async function requestApplicationFillResume(
  command: RequestApplicationFillResumeCommand,
): Promise<RequestApplicationFillResumeResult> {
  if (
    !UUID_PATTERN.test(command.commandId) ||
    !UUID_PATTERN.test(command.applicationId) ||
    !UUID_PATTERN.test(command.fillAttemptId) ||
    !UUID_PATTERN.test(command.computerSessionId) ||
    !Number.isSafeInteger(command.expectedAggregateVersion) ||
    command.expectedAggregateVersion < 1 ||
    command.candidateCompletedRequiredFields !== true
  ) {
    throw new ApplicationFillResumeError(
      "APPLICATION_FILL_RESUME_INPUT_INVALID",
      "Reload before continuing the secure browser.",
    );
  }

  const client = await createSupabaseServerClient();
  const result = await client.rpc("request_application_fill_resume", {
    p_command_id: command.commandId,
    p_application_id: command.applicationId,
    p_expected_aggregate_version: command.expectedAggregateVersion,
    p_fill_attempt_id: command.fillAttemptId,
    p_computer_session_id: command.computerSessionId,
    p_candidate_completed_required_fields:
      command.candidateCompletedRequiredFields,
  });
  if (result.error) failForDatabaseError(result.error);

  const row = oneRow(result.data);
  if (
    !row ||
    typeof row.application_id !== "string" || !UUID_PATTERN.test(row.application_id) ||
    typeof row.fill_attempt_id !== "string" || !UUID_PATTERN.test(row.fill_attempt_id) ||
    typeof row.computer_session_id !== "string" || !UUID_PATTERN.test(row.computer_session_id) ||
    typeof row.resume_attempt_id !== "string" || !UUID_PATTERN.test(row.resume_attempt_id) ||
    typeof row.aggregate_version !== "number" ||
    !Number.isSafeInteger(row.aggregate_version) || row.aggregate_version < 1 ||
    typeof row.replayed !== "boolean"
  ) {
    throw new ApplicationFillResumeError(
      "APPLICATION_FILL_RESUME_PROTOCOL_INVALID",
      "RoleDawn could not confirm that the secure browser will continue. Nothing was submitted.",
    );
  }
  return Object.freeze({
    applicationId: row.application_id,
    fillAttemptId: row.fill_attempt_id,
    computerSessionId: row.computer_session_id,
    resumeAttemptId: row.resume_attempt_id,
    aggregateVersion: row.aggregate_version,
    replayed: row.replayed,
  });
}
