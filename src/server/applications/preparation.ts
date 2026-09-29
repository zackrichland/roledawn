import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UntypedRpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}>;

export type RetryApplicationPreparationCommand = Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
}>;

export type RetryApplicationPreparationResult = Readonly<{
  preparationRunId: string;
  aggregateVersion: number;
  replayed: boolean;
}>;

export type RefreshApplicationFilesCommand = Readonly<{
  commandId: string;
  applicationId: string;
  expectedAggregateVersion: number;
}>;

export type RefreshApplicationFilesResult = Readonly<{
  preparationRunId: string;
  aggregateVersion: number;
  replayed: boolean;
}>;

export class ApplicationPreparationRetryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApplicationPreparationRetryError";
  }
}

export class ApplicationFilesRefreshError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApplicationFilesRefreshError";
  }
}

function asUntyped(client: unknown): UntypedRpcClient {
  return client as UntypedRpcClient;
}

function failForDatabaseError(error: { code?: string; message?: string } | null): never {
  const code = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code;
  switch (code) {
    case "APPLICATION_VERSION_MISMATCH":
      throw new ApplicationPreparationRetryError(
        code,
        "This application changed in another tab. Reload before checking again.",
      );
    case "PREPARATION_ALREADY_ACTIVE":
      throw new ApplicationPreparationRetryError(
        code,
        "Preparation is already queued. Reload to see its current status.",
      );
    case "APPLICATION_NOT_WAITING_FOR_INPUT":
      throw new ApplicationPreparationRetryError(
        code,
        "This application is no longer waiting for profile input. Reload to see its current status.",
      );
    default:
      throw new ApplicationPreparationRetryError(
        code ?? "PREPARATION_RETRY_FAILED",
        "RoleDawn could not check this application again. Try once more.",
      );
  }
}

function failForRefreshDatabaseError(
  error: { code?: string; message?: string } | null,
): never {
  const code = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code;
  switch (code) {
    case "APPLICATION_VERSION_MISMATCH":
      throw new ApplicationFilesRefreshError(
        code,
        "This application changed in another tab. Reload before refreshing its files.",
      );
    case "APPLICATION_PACKET_INPUTS_UNCHANGED":
      throw new ApplicationFilesRefreshError(
        code,
        "These files already use your latest profile. Reload to see the current application.",
      );
    case "PREPARATION_ALREADY_ACTIVE":
      throw new ApplicationFilesRefreshError(
        code,
        "File preparation is already active. Reload to see its progress.",
      );
    case "APPLICATION_FILL_ALREADY_ACTIVE":
      throw new ApplicationFilesRefreshError(
        code,
        "A form fill is already active. Wait for it to stop before refreshing these files.",
      );
    case "APPLICATION_PACKET_NOT_REFRESHABLE":
      throw new ApplicationFilesRefreshError(
        code,
        "Files cannot be refreshed during this application step. Reload to see its current status.",
      );
    case "AUTHENTICATION_REQUIRED":
    case "42501":
      throw new ApplicationFilesRefreshError(
        code,
        "Sign in again before refreshing these files.",
      );
    case "PGRST202":
    case "42883":
      throw new ApplicationFilesRefreshError(
        code,
        "File refresh is not available yet. Try again after the latest update is deployed.",
      );
    default:
      throw new ApplicationFilesRefreshError(
        code ?? "APPLICATION_PACKET_REFRESH_FAILED",
        "RoleDawn could not refresh these files. The current files were kept.",
      );
  }
}

function oneRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0];
  return row && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

export async function retryApplicationPreparation(
  command: RetryApplicationPreparationCommand,
): Promise<RetryApplicationPreparationResult> {
  if (
    !UUID_PATTERN.test(command.commandId) ||
    !UUID_PATTERN.test(command.applicationId) ||
    !Number.isSafeInteger(command.expectedAggregateVersion) ||
    command.expectedAggregateVersion < 1
  ) {
    throw new ApplicationPreparationRetryError(
      "PREPARATION_RETRY_INPUT_INVALID",
      "Reload before checking this application again.",
    );
  }

  const client = await createSupabaseServerClient();
  const result = await asUntyped(client).rpc("retry_application_preparation", {
    p_command_id: command.commandId,
    p_application_id: command.applicationId,
    p_expected_aggregate_version: command.expectedAggregateVersion,
  });
  if (result.error) failForDatabaseError(result.error);

  const row = oneRow(result.data);
  if (
    !row ||
    typeof row.preparation_run_id !== "string" ||
    !UUID_PATTERN.test(row.preparation_run_id) ||
    typeof row.aggregate_version !== "number" ||
    !Number.isSafeInteger(row.aggregate_version) ||
    row.aggregate_version < 1 ||
    typeof row.replayed !== "boolean"
  ) {
    throw new ApplicationPreparationRetryError(
      "PREPARATION_RETRY_PROTOCOL_INVALID",
      "RoleDawn could not confirm that preparation was queued.",
    );
  }

  return Object.freeze({
    preparationRunId: row.preparation_run_id,
    aggregateVersion: row.aggregate_version,
    replayed: row.replayed,
  });
}

export async function refreshApplicationFiles(
  command: RefreshApplicationFilesCommand,
): Promise<RefreshApplicationFilesResult> {
  if (
    !UUID_PATTERN.test(command.commandId) ||
    !UUID_PATTERN.test(command.applicationId) ||
    !Number.isSafeInteger(command.expectedAggregateVersion) ||
    command.expectedAggregateVersion < 1
  ) {
    throw new ApplicationFilesRefreshError(
      "APPLICATION_PACKET_REFRESH_INPUT_INVALID",
      "Reload before refreshing these files.",
    );
  }

  const client = await createSupabaseServerClient();
  const result = await asUntyped(client).rpc("refresh_stale_application_packet", {
    p_command_id: command.commandId,
    p_application_id: command.applicationId,
    p_expected_aggregate_version: command.expectedAggregateVersion,
  });
  if (result.error) failForRefreshDatabaseError(result.error);

  const row = oneRow(result.data);
  if (
    !row ||
    typeof row.preparation_run_id !== "string" ||
    !UUID_PATTERN.test(row.preparation_run_id) ||
    typeof row.aggregate_version !== "number" ||
    !Number.isSafeInteger(row.aggregate_version) ||
    row.aggregate_version < 1 ||
    typeof row.replayed !== "boolean"
  ) {
    throw new ApplicationFilesRefreshError(
      "APPLICATION_PACKET_REFRESH_PROTOCOL_INVALID",
      "RoleDawn could not confirm that fresh file preparation was queued.",
    );
  }

  return Object.freeze({
    preparationRunId: row.preparation_run_id,
    aggregateVersion: row.aggregate_version,
    replayed: row.replayed,
  });
}
