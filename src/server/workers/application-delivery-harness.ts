import type { ApplicationAutopilotLease, ApplicationAutopilotRepository } from "../../domain/application-autopilot.ts";
import type { AgentFormHarness } from "./agents-form-driver.ts";
import type { ApplicationAgentConfiguration } from "./application-form-driver.ts";
import { runOpenAIAgentsFunctions, type OpenAIAgentActionLedger, type OpenAIAgentsClient, type OpenAIAgentToolHandler } from "./openai-agents-client.ts";

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
}>): AgentFormHarness {
  return {
    async run(task) {
      await input.store.assertLease(input.lease);
      let sessionId: string | null = null;
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
      try {
        const result = await runOpenAIAgentsFunctions({
          client: input.client,
          request: {
            model: input.configuration.model,
            instructions: task.instructions,
            tools: task.toolDefinitions,
            metadata: { roledawn_autopilot_id: input.lease.id, driver_release: "application-delivery/1" },
          },
          initialInputAfterBinding: JSON.stringify(task.input),
          async onSessionCreated(id) {
            sessionId = id;
            await input.store.setAgentSession(input.lease, id);
          },
          ledger: input.store.ledger(input.lease), tools,
          timeoutMs: input.configuration.timeoutMs,
          maxActions: Math.min(task.maxActions, input.configuration.maxActions),
          pollIntervalMs: 750,
          ...(task.shouldStop ? { shouldStop: task.shouldStop } : {}),
          signal: input.signal && task.signal ? AbortSignal.any([input.signal, task.signal]) : input.signal ?? task.signal,
        });
        if (result.status !== "completed") throw new Error("DELIVERY_AGENT_TURN_INCOMPLETE");
      } finally {
        if (sessionId) {
          // The durable private session reference remains if deletion is uncertain,
          // allowing maintenance to retry without retaining it in candidate-facing state.
          let deleted = false;
          try { await input.client.deleteSession(sessionId, AbortSignal.timeout(10_000)); deleted = true; }
          catch { /* The worker's cleanup queue retries provider deletion. */ }
          if (deleted) await input.store.setAgentSession(input.lease, null);
        }
      }
    },
  };
}
