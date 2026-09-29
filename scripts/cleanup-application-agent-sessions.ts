import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
import { createApplicationAgentCleanupRepository, runApplicationAgentCleanup } from "../src/server/workers/application-agent-cleanup.ts";
import { createApplicationAgentStore } from "../src/server/workers/application-agent-store.ts";
import { createOpenAIAgentsClient } from "../src/server/workers/openai-agents-client.ts";

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");
const supabase = createSupabaseAdminClient("application-agent-cleanup/1");
const result = await runApplicationAgentCleanup(createApplicationAgentCleanupRepository(supabase),
  createOpenAIAgentsClient({ apiKey }), createApplicationAgentStore(supabase));
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.failed > 0) process.exitCode = 1;
