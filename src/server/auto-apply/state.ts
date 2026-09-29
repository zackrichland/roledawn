import { AutoApplyError, parseAutoApplyState, validateSetAutoApplyCommand, type SetAutoApplyCommand } from "../../domain/account-auto-apply.ts";
export type AutoApplyRpc = Readonly<{ rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> }>;
export async function autoApplyRpc(client: unknown, name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
  let result;
  // PostgreSQL explicitly rolls back a deadlocked transaction. Retry only that
  // known outcome, with the identical idempotency key and expected version.
  // Network interruptions and every other failure are deliberately not retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { result = await (client as AutoApplyRpc).rpc(name, args); }
    catch { throw new AutoApplyError("AUTO_APPLY_CONNECTION_INTERRUPTED"); }
    if (name !== "set_auto_apply_enabled" || result.error?.code !== "40P01" || attempt === 2) break;
  }
  if (!result) throw new AutoApplyError("AUTO_APPLY_COMMAND_FAILED");
  if (result.error) {
    const code = result.error.message?.match(/\bAUTO_APPLY_[A-Z_]+\b/u)?.[0];
    throw new AutoApplyError(code ?? (result.error.code === "PGRST202" ? "AUTO_APPLY_UNAVAILABLE" : "AUTO_APPLY_COMMAND_FAILED"));
  }
  return result.data;
}
export async function readAutoApplyState(client: unknown) {
  return parseAutoApplyState(await autoApplyRpc(client, "read_auto_apply_state", {}));
}
export async function setAutoApplyEnabled(client: unknown, command: SetAutoApplyCommand) {
  validateSetAutoApplyCommand(command);
  return parseAutoApplyState(await autoApplyRpc(client, "set_auto_apply_enabled", {
    p_command_id: command.commandId, p_expected_version: command.expectedVersion, p_enabled: command.enabled,
  }));
}
export type { AutoApplyState, SetAutoApplyCommand } from "../../domain/account-auto-apply.ts";
