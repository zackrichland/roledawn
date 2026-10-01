import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, transpileModule } from "typescript";
import { ApplicationAutopilotError } from "../../../../domain/application-autopilot.ts";

// Execute the real Server Action module with isolated Next/auth/RPC boundaries.
// No request context, environment credentials or hosted worker is used here.
const compiled = transpileModule(readFileSync(new URL("./autopilot-actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;

function harness(options: { enabled?: boolean; authenticated?: boolean; failure?: Error; pending?: Promise<void> } = {}) {
  const events: string[] = [];
  const callbacks: (() => Promise<void>)[] = [];
  const client = {};
  const command = (name: string) => async (receivedClient: unknown) => {
    assert.equal(receivedClient, client);
    events.push(`command:${name}`);
    await options.pending;
    if (options.failure) throw options.failure;
    events.push(`saved:${name}`);
  };
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: () => events.push("revalidate") },
    "next/server": { after: (callback: () => Promise<void>) => { events.push("scheduled"); callbacks.push(callback); } },
    "@/domain/application-autopilot": { ApplicationAutopilotError },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "@/server/auth/session": { getOptionalActor: async () => options.authenticated === false ? null : { userId: "candidate" } },
    "@/server/applications/autopilot": {
      delegateApplicationAutopilot: command("delegate"), saveApplicationAutopilotAnswers: command("answers"),
      controlApplicationAutopilot: command("control"), provideApplicationAutopilotVerificationCode: command("verification"),
    },
    "@/server/workers/hosted-worker-wakeup": { requestHostedWorkerWakeup: async (lanes: string[]) => {
      assert.equal(JSON.stringify(lanes), '["autopilot"]'); events.push("wake:autopilot");
    } },
  };
  const actions: Record<string, (command: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>> = {};
  runInNewContext(compiled, {
    exports: actions,
    process: { env: { ROLEDAWN_AUTOPILOT_ENABLED: options.enabled === false ? "false" : "true" } },
    require: (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return { actions, events, callbacks };
}

test("delegation, answers, verification and resume wake only after their command saved", async () => {
  for (const [name, command] of [
    ["delegateApplicationAutopilotAction", {}], ["saveApplicationAutopilotAnswersAction", {}],
    ["provideApplicationAutopilotVerificationCodeAction", {}], ["controlApplicationAutopilotAction", { action: "RESUME" }],
  ] as const) {
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const run = harness({ pending });
    const result = run.actions[name](command);
    await new Promise(done => setImmediate(done));
    assert.equal(run.callbacks.length, 0, `${name}: no wake before commit`);
    resolve();
    assert.equal((await result).ok, true);
    assert.equal(run.callbacks.length, 1);
    assert.ok(run.events.findIndex(event => event.startsWith("saved:")) < run.events.indexOf("scheduled"));
    assert.ok(!run.events.includes("wake:autopilot"), "wake waits for the response callback");
    await run.callbacks[0]();
    assert.equal(run.events.at(-1), "wake:autopilot");
  }
});

test("pause and cancel persist and refresh without scheduling delivery", async () => {
  for (const action of ["PAUSE", "CANCEL"]) {
    const run = harness();
    assert.equal((await run.actions.controlApplicationAutopilotAction({ action })).ok, true);
    assert.equal(run.callbacks.length, 0);
    assert.ok(run.events.includes("saved:control"));
    assert.ok(run.events.includes("revalidate"));
  }
});

test("existing sends accept answers, codes and controls while new sends are disabled", async () => {
  for (const [name, command] of [
    ["saveApplicationAutopilotAnswersAction", {}], ["provideApplicationAutopilotVerificationCodeAction", {}],
    ["controlApplicationAutopilotAction", { action: "RESUME" }], ["controlApplicationAutopilotAction", { action: "PAUSE" }],
    ["controlApplicationAutopilotAction", { action: "CANCEL" }],
  ] as const) {
    const run = harness({ enabled: false });
    assert.equal((await run.actions[name](command)).ok, true, name);
    assert.ok(run.events.some(event => event.startsWith("saved:")));
    const signedOut = harness({ enabled: false, authenticated: false });
    assert.equal((await signedOut.actions[name](command)).ok, false, name);
    assert.equal(signedOut.events.length, 0);
  }
});

test("failed, unauthenticated and disabled commands never schedule a wakeup", async () => {
  for (const options of [
    { enabled: false }, { authenticated: false },
    { failure: new ApplicationAutopilotError("APPLICATION_AUTOPILOT_REVIEW_STALE") },
    { failure: new Error("private upstream detail") },
  ]) {
    const run = harness(options);
    const result = await run.actions.delegateApplicationAutopilotAction({});
    assert.equal(result.ok, false);
    assert.equal(run.callbacks.length, 0);
    assert.ok(!result.message?.includes("private upstream detail"));
  }
});
