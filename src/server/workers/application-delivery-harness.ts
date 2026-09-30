import type { ApplicationAutopilotLease, ApplicationAutopilotRepository } from "../../domain/application-autopilot.ts";
import type { AgentFormHarness } from "./agents-form-driver.ts";
import type { ApplicationAgentConfiguration } from "./application-form-driver.ts";
import { runOpenAIAgentsFunctions, type OpenAIAgentActionLedger, type OpenAIAgentsClient, type OpenAIAgentToolHandler } from "./openai-agents-client.ts";
import { errorDetail } from "./worker-events.ts";

export type ApplicationDeliveryAgentStore = Pick<ApplicationAutopilotRepository, "assertLease" | "setAgentSession"> & Readonly<{
  ledger(lease: ApplicationAutopilotLease): OpenAIAgentActionLedger;
}>;

/** A fresh agent turn reconstructs context from the durable application, never from an unbound chat. */
export function createApplicationDeliveryHarness(input: Readonly<{
  configuration: ApplicationAgentConfiguration;
  client: OpenAIAgentsClient;
  store: ApplicationDeliveryAgentStore;
  lease: ApplicationAutopilotLease;
  signal?: AbortSignal;
  report?: (detail: Readonly<Record<string, unknown>>, durationMs: number) => Promise<void>;
}>): AgentFormHarness {
  return {
    async run(task) {
      await input.store.assertLease(input.lease);
      let sessionId: string | null = null;
      let remainingActions = Math.min(task.maxActions, input.configuration.maxActions);
      const tools: Record<string, OpenAIAgentToolHandler> = {};
      for (const tool of task.toolDefinitions) {
        tools[tool.name] = {
          parseArguments(value) {
            if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 65_536) {
              throw new Error("DELIVERY_AGENT_TOOL_ARGUMENTS_INVALID");
            }
            // The driver performs the function-specific schema and semantic checks.
            return value as Record<string, unknown>;
          },
          async execute(args, context) {
            if (context.signal.aborted || input.signal?.aborted) throw new Error("DELIVERY_AGENT_CANCELED");
            // This check also observes candidate pause/cancel while the model is thinking.
            await input.store.assertLease(input.lease);
            return task.executeTool(tool.name, args, context.signal);
          },
        };
      }
      // Only an explicitly failed provider turn can be resumed. A thrown/uncertain tool action never retries here.
      for (let turnAttempt = 1; turnAttempt <= 2; turnAttempt += 1) {
        const started = Date.now();
        try {
          const result = await runOpenAIAgentsFunctions({
            client: input.client,
            request: {
              model: input.configuration.model,
              instructions: task.instructions,
              tools: task.toolDefinitions,
              metadata: { roledawn_autopilot_id: input.lease.id, driver_release: "application-delivery/2" },
            },
            initialInputAfterBinding: JSON.stringify(task.input) + (turnAttempt > 1
              ? "\nA prior provider turn failed after its acknowledged tools. Inspect the current form before continuing. Preserve current values and acknowledged uploads; do not repeat completed writes."
              : ""),
            async onSessionCreated(id) {
              sessionId = id;
              await input.store.setAgentSession(input.lease, id);
            },
            ledger: input.store.ledger(input.lease), tools,
            timeoutMs: input.configuration.timeoutMs,
            maxActions: remainingActions,
            pollIntervalMs: 750,
            ...(task.shouldStop ? { shouldStop: task.shouldStop } : {}),
            signal: input.signal && task.signal ? AbortSignal.any([input.signal, task.signal]) : input.signal ?? task.signal,
          });
          remainingActions -= result.actionCount;
          await input.report?.({ turnAttempt, status: result.status, actions: result.actionCount,
            failure: result.failure ?? (result.status === "failed" ? "UNKNOWN" : "NONE") }, Date.now() - started).catch(() => undefined);
          if (result.status === "completed") return;
          if (result.status === "failed" && turnAttempt === 1 && remainingActions > 0
            && (result.failure === undefined || result.failure === "UNKNOWN" || result.failure === "PROVIDER_ERROR")) {
            await input.store.assertLease(input.lease);
            continue;
          }
          throw new Error(result.status === "cancelled" ? "DELIVERY_AGENT_TURN_CANCELLED"
            : result.failure === "CREDITS_EXHAUSTED" ? "MODEL_CREDITS_EXHAUSTED"
            : result.failure === "RATE_LIMIT" ? "MODEL_RATE_LIMITED" : "DELIVERY_AGENT_TURN_FAILED");
        } catch (error) {
          await input.report?.({ turnAttempt, status: "error", ...errorDetail(error) }, Date.now() - started).catch(() => undefined);
          throw error;
        } finally {
          if (sessionId) {
            // The durable private session reference remains if deletion is uncertain,
            // allowing maintenance to retry without retaining it in candidate-facing state.
            let deleted = false;
            try { await input.client.deleteSession(sessionId, AbortSignal.timeout(10_000)); deleted = true; }
            catch { /* The worker's cleanup queue retries provider deletion. */ }
            if (deleted) await input.store.setAgentSession(input.lease, null);
            sessionId = null;
          }
        }
      }
    },
  };
}
