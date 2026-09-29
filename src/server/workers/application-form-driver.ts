import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { createApplicationAgentQuestionRepository } from "../applications/agent-questions.ts";
import { createApplicationAgentStore, type ApplicationAgentStore } from "./application-agent-store.ts";
import { createApplicationAgentEvidence } from "./application-agent-evidence.ts";
import {
  AGENTS_FORM_DRIVER_RELEASE, createAgentsFormDriver, parseAgentFormToolArguments,
  type AgentFormHarness,
} from "./agents-form-driver.ts";
import type { NoSubmitFormDriver } from "./application-fill.ts";
import { createGreenhouseNoSubmitDriver } from "./greenhouse-no-submit-driver.ts";
import {
  createOpenAIAgentsClient, runOpenAIAgentsFunctions,
  type OpenAIAgentsClient, type OpenAIAgentToolHandler,
} from "./openai-agents-client.ts";

export type ApplicationAgentConfiguration = Readonly<{
  driver: "agents";
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxActions: number;
}>;

function integer(value: string | undefined, fallback: number, min: number, max: number, code: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(code);
  return parsed;
}

export function parseApplicationFormDriverEnvironment(environment: Readonly<Record<string, string | undefined>>): Readonly<{ driver: "deterministic" }> | ApplicationAgentConfiguration {
  const driver = environment.ROLEDAWN_FORM_DRIVER || "deterministic";
  if (driver === "deterministic") return Object.freeze({ driver });
  if (driver !== "agents") throw new Error("ROLEDAWN_FORM_DRIVER_INVALID");
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey || /\s/u.test(apiKey)) throw new Error("OPENAI_API_KEY_REQUIRED");
  // GPT-6.1 Sol fills forms at about a fifth of Astra's token price and answered a
  // measured tool turn ~30% faster (2026-09-29); document writing stays on Astra.
  const model = environment.ROLEDAWN_APPLICATION_AGENT_MODEL?.trim() || "gpt-6.1-sol";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(model)) throw new Error("ROLEDAWN_APPLICATION_AGENT_MODEL_INVALID");
  return Object.freeze({
    driver, apiKey, model,
    // Resume leases are five minutes; leave a full minute for persistence and cleanup.
    timeoutMs: integer(environment.ROLEDAWN_APPLICATION_AGENT_TIMEOUT_MS, 180_000, 5_000, 240_000, "ROLEDAWN_APPLICATION_AGENT_TIMEOUT_INVALID"),
    maxActions: integer(environment.ROLEDAWN_APPLICATION_AGENT_MAX_ACTIONS, 80, 4, 200, "ROLEDAWN_APPLICATION_AGENT_ACTION_LIMIT_INVALID"),
  });
}

export function createManagedApplicationFormHarness(
  configuration: ApplicationAgentConfiguration,
  client: OpenAIAgentsClient,
  store: ApplicationAgentStore,
): AgentFormHarness {
  return {
    async run(input) {
      // Persist intent before creating a billable provider session. The unique
      // active-run constraint prevents a second worker silently replacing it.
      const runId = await store.startRun(input.binding, configuration.model, AGENTS_FORM_DRIVER_RELEASE);
      let providerSessionId: string | null = null;
      let status: "COMPLETED" | "FAILED" = "FAILED";
      let failureCode: string | null = "APPLICATION_AGENT_EXECUTION_FAILED";
      const tools: Record<string, OpenAIAgentToolHandler> = {};
      for (const tool of input.toolDefinitions) {
        tools[tool.name] = {
          parseArguments: value => parseAgentFormToolArguments(tool.name, value),
          async execute(args, context) {
            if (context.signal.aborted) throw new Error("APPLICATION_AGENT_CANCELED");
            return input.executeTool(tool.name, args, context.signal);
          },
        };
      }
      try {
        const result = await runOpenAIAgentsFunctions({
          client,
          request: {
            model: configuration.model,
            instructions: `${input.instructions}\nWhen the form is complete or only candidate questions remain, finish the turn. Do not keep calling inspect_form.`,
            tools: input.toolDefinitions,
            // Internal run ID only: no candidate identity or employer PII in provider metadata.
            metadata: { roledawn_run_id: runId, driver_release: AGENTS_FORM_DRIVER_RELEASE },
          },
          initialInputAfterBinding: JSON.stringify(input.input),
          async onSessionCreated(sessionId) {
            providerSessionId = sessionId;
            await store.bindSession(runId, sessionId);
          },
          ledger: store.ledger(runId), tools,
          timeoutMs: configuration.timeoutMs,
          maxActions: Math.min(configuration.maxActions, input.maxActions),
          pollIntervalMs: 750,
          signal: input.signal,
        });
        if (result.status !== "completed") throw new Error("APPLICATION_AGENT_TURN_INCOMPLETE");
        status = "COMPLETED";
        failureCode = null;
      } finally {
        // The browser may remain for a candidate answer; the model session's
        // private context need not. The next turn observes the retained form.
        let providerDeleted = false;
        if (providerSessionId) {
          try {
            await client.deleteSession(providerSessionId, AbortSignal.timeout(10_000));
            providerDeleted = true;
          } catch { /* Persist pending cleanup for the maintenance command. */ }
        }
        await store.finishRun(runId, status, failureCode, providerDeleted);
      }
    },
  };
}

/** Shared composition root for one-shot and long-running workers. */
export function createApplicationFormDriver(environment: NodeJS.ProcessEnv = process.env): NoSubmitFormDriver {
  const configuration = parseApplicationFormDriverEnvironment(environment);
  if (configuration.driver === "deterministic") return createGreenhouseNoSubmitDriver();
  const supabase = createSupabaseAdminClient("agents-form-driver/1");
  const client = createOpenAIAgentsClient({ apiKey: configuration.apiKey });
  return createAgentsFormDriver({
    harness: createManagedApplicationFormHarness(configuration, client, createApplicationAgentStore(supabase)),
    questions: createApplicationAgentQuestionRepository(supabase),
    evidence: createApplicationAgentEvidence({ apiKey: configuration.apiKey }),
    maxActions: configuration.maxActions,
  });
}
