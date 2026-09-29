import type { ComputerSessionBinding } from "../../domain/computer-session-broker.ts";
import type { OpenAIAgentActionLedger, OpenAIAgentCallKey, OpenAIAgentToolResult } from "./openai-agents-client.ts";

type RpcClient = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}>;

export type ApplicationAgentBinding = Readonly<ComputerSessionBinding & { computerSessionId: string }>;

export interface ApplicationAgentStore {
  startRun(binding: ApplicationAgentBinding, model: string, driverRelease: string): Promise<string>;
  bindSession(runId: string, sessionId: string): Promise<void>;
  ledger(runId: string): OpenAIAgentActionLedger;
  finishRun(runId: string, status: "COMPLETED" | "FAILED", failureCode: string | null, providerDeleted: boolean): Promise<void>;
  expireRuns(limit?: number): Promise<number>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function assertRunId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("APPLICATION_AGENT_RUN_ID_INVALID");
}

function assertCallKey(key: OpenAIAgentCallKey): void {
  if (![key.sessionId, key.turnId, key.callId].every(value => typeof value === "string" && PROVIDER_ID_PATTERN.test(value))
    || typeof key.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key.name)
    || typeof key.argumentsHash !== "string" || !/^[0-9a-f]{64}$/u.test(key.argumentsHash)) {
    throw new Error("APPLICATION_AGENT_CALL_KEY_INVALID");
  }
}

function assertToolResult(value: unknown, key: OpenAIAgentCallKey): asserts value is OpenAIAgentToolResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("APPLICATION_AGENT_LEDGER_RESULT_INVALID");
  const record = value as Record<string, unknown>;
  if (record.type !== "agent.session.input.tool_result" || record.turn_id !== key.turnId || record.call_id !== key.callId
    || typeof record.success !== "boolean"
    || Object.keys(record).some(name => !["type", "turn_id", "call_id", "success", "output", "error"].includes(name))
    || (record.success && (typeof record.output !== "string" || !record.output.trim() || "error" in record))
    || (!record.success && (typeof record.error !== "string" || !record.error.trim() || "output" in record))) {
    throw new Error("APPLICATION_AGENT_LEDGER_RESULT_INVALID");
  }
  try {
    if (Buffer.byteLength(JSON.stringify(record)) > 262_144) throw new Error();
  } catch { throw new Error("APPLICATION_AGENT_LEDGER_RESULT_INVALID"); }
}

export function createApplicationAgentStore(client: unknown): ApplicationAgentStore {
  const rpc = client as RpcClient;
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const result = await rpc.rpc(name, args);
      if (!result || typeof result !== "object" || result.error) throw new Error();
      return result.data;
    } catch {
      // Rejected promises can contain request bodies too; redact both error paths.
      throw new Error("APPLICATION_AGENT_STORE_OPERATION_FAILED");
    }
  }
  return Object.freeze({
    async startRun(binding: ApplicationAgentBinding, model: string, driverRelease: string) {
      if ([binding.workspaceId,binding.candidateId,binding.applicationId,binding.revisionId,binding.fillAttemptId,binding.computerSessionId]
        .some(value => typeof value !== "string" || !UUID_PATTERN.test(value))) {
        throw new Error("APPLICATION_AGENT_BINDING_INVALID");
      }
      if (![model, driverRelease].every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 120)) {
        throw new Error("APPLICATION_AGENT_CONFIGURATION_INVALID");
      }
      const value = await call("start_application_agent_run", {
        p_workspace_id: binding.workspaceId,
        p_candidate_id: binding.candidateId,
        p_application_id: binding.applicationId,
        p_revision_id: binding.revisionId,
        p_fill_attempt_id: binding.fillAttemptId,
        p_computer_session_id: binding.computerSessionId,
        p_model: model,
        p_driver_release: driverRelease,
      });
      if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("APPLICATION_AGENT_RUN_ID_INVALID");
      return value;
    },
    async bindSession(runId: string, sessionId: string) {
      assertRunId(runId);
      if (typeof sessionId !== "string" || !PROVIDER_ID_PATTERN.test(sessionId)) throw new Error("APPLICATION_AGENT_SESSION_ID_INVALID");
      await call("bind_application_agent_session", { p_run_id: runId, p_provider_session_id: sessionId });
    },
    ledger(runId: string): OpenAIAgentActionLedger {
      assertRunId(runId);
      return {
        async begin(key) {
          assertCallKey(key);
          const value = await call("begin_application_agent_tool_call", {
            p_run_id: runId, p_session_id: key.sessionId, p_turn_id: key.turnId,
            p_call_id: key.callId, p_tool_name: key.name, p_arguments_hash: key.argumentsHash,
          });
          if (!value || typeof value !== "object" || Array.isArray(value) || !("status" in value)) throw new Error("APPLICATION_AGENT_LEDGER_RESULT_INVALID");
          if (value.status === "new" || value.status === "uncertain") return { status: value.status };
          if (value.status === "completed" && "result" in value) {
            assertToolResult(value.result, key);
            return { status: "completed", result: value.result };
          }
          throw new Error("APPLICATION_AGENT_LEDGER_RESULT_INVALID");
        },
        async complete(key, result) {
          assertCallKey(key);
          assertToolResult(result, key);
          await call("complete_application_agent_tool_call", {
            p_run_id: runId, p_session_id: key.sessionId, p_turn_id: key.turnId,
            p_call_id: key.callId, p_tool_name: key.name, p_arguments_hash: key.argumentsHash,
            p_result: result,
          });
        },
      };
    },
    async finishRun(runId: string, status: "COMPLETED" | "FAILED", failureCode: string | null, providerDeleted: boolean) {
      assertRunId(runId);
      if (!["COMPLETED", "FAILED"].includes(status) || typeof providerDeleted !== "boolean"
        || (failureCode !== null && (typeof failureCode !== "string" || !/^[A-Z][A-Z0-9_]{2,119}$/u.test(failureCode)))
        || (status === "COMPLETED" && failureCode !== null)) {
        throw new Error("APPLICATION_AGENT_COMPLETION_INVALID");
      }
      await call("finish_application_agent_run", {
        p_run_id: runId, p_status: status, p_failure_code: failureCode, p_provider_deleted: providerDeleted,
      });
    },
    async expireRuns(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("APPLICATION_AGENT_CLEANUP_LIMIT_INVALID");
      const count = await call("expire_application_agent_runs", { p_limit: limit });
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > limit) {
        throw new Error("APPLICATION_AGENT_CLEANUP_RESULT_INVALID");
      }
      return count;
    },
  });
}
