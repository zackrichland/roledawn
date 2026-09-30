import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";

const compiled = transpileModule(readFileSync(new URL("./need-actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const applicationId = "10000000-0000-4000-8000-000000000001";

test("Home loads owned existing questions with new-send execution disabled", async () => {
  let authenticated = true;
  let reads = 0;
  const client = {};
  const view = { questions: [{ label: "A required experience question" }] };
  const dependencies = {
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "@/server/auth/session": { getOptionalActor: async () => authenticated ? { userId: "candidate" } : null },
    "@/server/applications/autopilot": { getApplicationAutopilot: async (...args: unknown[]) => {
      assert.deepEqual(args, [client, applicationId]); reads++; return view;
    } },
  };
  const actions: { loadApplicationNeedAction?: (id: string) => Promise<{ ok: boolean; view?: unknown }> } = {};
  runInNewContext(compiled, { exports: actions, process: { env: { ROLEDAWN_AUTOPILOT_ENABLED: "false" } },
    require: (name: keyof typeof dependencies) => dependencies[name] });
  const result = await actions.loadApplicationNeedAction!(applicationId);
  assert.equal(result.ok, true); assert.equal(result.view, view); assert.equal(reads, 1);
  authenticated = false;
  assert.equal((await actions.loadApplicationNeedAction!(applicationId)).ok, false);
  authenticated = true;
  assert.equal((await actions.loadApplicationNeedAction!("invalid")).ok, false);
  assert.equal(reads, 1);
});
