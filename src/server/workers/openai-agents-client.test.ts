import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAIAgentsClient,
  OpenAIAgentsError,
  runOpenAIAgentsFunctions,
  type OpenAIAgentActionLedger,
  type OpenAIAgentCallKey,
  type OpenAIAgentFunctionCall,
  type OpenAIAgentSession,
  type OpenAIAgentToolResult,
  type OpenAIAgentTurn,
  type OpenAIAgentsClient,
  type OpenAIAgentsCreateRequest,
} from "./openai-agents-client.ts";

const REQUEST: OpenAIAgentsCreateRequest = {
  model: "test-model",
  instructions: "Use the permitted tools only.",
  input: "Inspect the synthetic form.",
  tools: [{
    type: "function", name: "inspect_form", description: "Inspect fields.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  }],
  metadata: { application: "synthetic-application" },
};

test("session cleanup accepts an already-deleted session without masking other failures", async () => {
  const gone = createOpenAIAgentsClient({ apiKey: "synthetic-api-key", fetch: async () => new Response(null, { status: 404 }) });
  await gone.deleteSession("session_gone");
  const denied = createOpenAIAgentsClient({ apiKey: "synthetic-api-key", fetch: async () => new Response(null, { status: 403 }) });
  await assert.rejects(denied.deleteSession("session_denied"), error => error instanceof OpenAIAgentsError && error.status === 403);
});

test("deletion requires exact API removal confirmation, never generic asynchronous acceptance", async () => {
  const correct = { id: "session_1", deleted: true, object: "agent.session.deleted" };
  for (const body of [{ ...correct, deleted: false }, { ...correct, id: "other_session" }, { ...correct, object: "agent.session" }, {}]) {
    const client = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async () => response(body) });
    await assert.rejects(client.deleteSession("session_1"), /DELETE_NOT_CONFIRMED/u);
  }
  for (const status of [202, 204]) {
    const client = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async () => new Response(null, { status }) });
    await assert.rejects(client.deleteSession("session_1"), /DELETE_NOT_CONFIRMED/u);
  }
  await createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async () => response(correct) }).deleteSession("session_1");
});

function action(overrides: Partial<OpenAIAgentFunctionCall> = {}): OpenAIAgentFunctionCall {
  return { type: "function_call", turn_id: "turn_1", call_id: "call_1", name: "inspect_form", arguments: {}, ...overrides };
}

function session(required_actions: readonly OpenAIAgentFunctionCall[] = [], status?: OpenAIAgentSession["status"]): OpenAIAgentSession {
  return { id: "session_1", status: status ?? (required_actions.length ? "requires_action" : "idle"), required_actions };
}

function turn(status: OpenAIAgentTurn["status"] = "completed"): OpenAIAgentTurn {
  return { id: "turn_1", session_id: "session_1", status };
}

function response(body: unknown): Response {
  return Response.json(body);
}

function providerSession(required_actions: readonly OpenAIAgentFunctionCall[] = []) {
  return { ...session(required_actions), environment: { type: "none" } };
}

function memoryLedger(): OpenAIAgentActionLedger & { entries: Map<string, { key: OpenAIAgentCallKey; result?: OpenAIAgentToolResult }> } {
  const entries = new Map<string, { key: OpenAIAgentCallKey; result?: OpenAIAgentToolResult }>();
  const keyFor = (key: OpenAIAgentCallKey) => `${key.sessionId}:${key.turnId}:${key.callId}`;
  return {
    entries,
    async begin(key) {
      const old = entries.get(keyFor(key));
      if (old && (old.key.name !== key.name || old.key.argumentsHash !== key.argumentsHash)) throw new Error("mismatched durable key");
      if (old?.result) return { status: "completed", result: old.result };
      if (old) return { status: "uncertain" };
      entries.set(keyFor(key), { key });
      return { status: "new" };
    },
    async complete(key, result) {
      assert.ok(entries.has(keyFor(key)));
      entries.set(keyFor(key), { key, result });
    },
  };
}

function mockClient(overrides: Partial<OpenAIAgentsClient> = {}): OpenAIAgentsClient {
  return {
    async createSession() { return session([action()]); },
    async retrieveSession() { return session(); },
    async retrieveTurn() { return turn(); },
    async retrieveLatestTurn() { return turn(); },
    async sendToolResults() {},
    async sendMessage() {},
    async cancelTurn() {},
    async deleteSession() {},
    ...overrides,
  };
}

function runnerOptions(overrides: Partial<Parameters<typeof runOpenAIAgentsFunctions>[0]> = {}): Parameters<typeof runOpenAIAgentsFunctions>[0] {
  return {
    client: mockClient(), request: REQUEST, onSessionCreated: async () => {}, ledger: memoryLedger(),
    tools: {
      inspect_form: {
        parseArguments(value) {
          assert.deepEqual(value, {});
          return {};
        },
        async execute() { return { fields: [] }; },
      },
    },
    timeoutMs: 2000, maxActions: 10, pollIntervalMs: 1, maxPolls: 10,
    ...overrides,
  };
}

test("client uses fixed origin, beta header, function-only environment and disables programmatic tools", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = createOpenAIAgentsClient({
    apiKey: "synthetic-api-key", fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return response(providerSession());
    },
  });
  assert.equal((await client.createSession(REQUEST)).id, "session_1");
  assert.equal(requests[0].url, "https://api.openai.com/v1/agents/sessions");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(new Headers(requests[0].init.headers).get("OpenAI-Beta"), "agents=v1");
  const sent = JSON.parse(String(requests[0].init.body));
  assert.deepEqual(sent.environment, { type: "none" });
  assert.deepEqual(sent.agent.multi_agent, { enabled: false });
  assert.deepEqual(sent.agent.tools, [...REQUEST.tools, { type: "programmatic_tool_calling", enabled: false }]);
  assert.deepEqual(sent.metadata, REQUEST.metadata);
});

test("client never retries an uncertain session creation and redacts transport errors", async () => {
  let count = 0;
  const client = createOpenAIAgentsClient({ apiKey: "secret", fetch: async () => { count += 1; throw new Error("secret resume data"); } });
  await assert.rejects(client.createSession(REQUEST), { message: "OPENAI_AGENTS_NETWORK_ERROR" });
  assert.equal(count, 1);
});

test("empty session creation omits candidate input entirely", async () => {
  let body: Record<string, unknown> = {};
  const client = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return response(providerSession());
  } });
  const configuration = { ...REQUEST, input: undefined };
  await client.createSession(configuration);
  assert.equal(Object.hasOwn(body, "input"), false);
});

test("client rejects provider errors without exposing response bodies", async () => {
  const client = createOpenAIAgentsClient({ apiKey: "secret", fetch: async () => new Response("private employer URL and candidate data", { status: 403 }) });
  await assert.rejects(client.retrieveSession("session_1"), (error: unknown) => {
    assert.ok(error instanceof OpenAIAgentsError);
    assert.equal(error.status, 403);
    assert.equal(error.message, "OPENAI_AGENTS_HTTP_ERROR");
    return true;
  });
});

test("client rejects route injection, unapproved tool kinds, duplicate functions, and remote environments", async () => {
  let calls = 0;
  const client = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async () => { calls += 1; return response({ ...providerSession(), environment: { type: "openai_hosted" } }); } });
  await assert.rejects(client.retrieveSession("../vaults"), /INVALID_ID/u);
  await assert.rejects(client.createSession({ ...REQUEST, tools: [...REQUEST.tools, ...REQUEST.tools] }), /INVALID_TOOLS/u);
  await assert.rejects(client.createSession({ ...REQUEST, tools: [{ ...REQUEST.tools[0], type: "mcp" } as never] }), /INVALID_TOOLS/u);
  assert.equal(calls, 0);
  await assert.rejects(client.retrieveSession("session_1"), /UNEXPECTED_ENVIRONMENT/u);
});

test("client encodes native tool result, message, cancellation, and deletion contracts", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return init?.method === "DELETE" ? response({ id: "session_1", deleted: true, object: "agent.session.deleted" }) : new Response(null, { status: 204 });
  } });
  const result: OpenAIAgentToolResult = { type: "agent.session.input.tool_result", turn_id: "turn_1", call_id: "call_1", success: true, output: "{}" };
  await client.sendToolResults("session_1", [result]);
  await client.sendToolResults("session_1", [result]);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), { events: [result] });
  assert.equal(new Headers(requests[0].init.headers).get("Idempotency-Key"), new Headers(requests[1].init.headers).get("Idempotency-Key"));
  await client.sendMessage("session_1", "Continue with reviewed facts.");
  assert.deepEqual(JSON.parse(String(requests[2].init.body)), { events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: "Continue with reviewed facts." }] }] }] });
  await client.cancelTurn("session_1");
  assert.deepEqual(JSON.parse(String(requests[3].init.body)), { events: [{ type: "agent.session.input.cancel" }] });
  await client.deleteSession("session_1");
  assert.equal(requests[4].init.method, "DELETE");
});

test("client validates turn ownership and reads actual last-turn status", async () => {
  const requests: string[] = [];
  const client = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async (url) => {
    requests.push(String(url));
    return response(String(url).includes("?") ? { data: [turn("failed")] } : { ...turn(), session_id: "other_session" });
  } });
  assert.equal((await client.retrieveLatestTurn("session_1"))?.status, "failed");
  assert.match(requests[0], /turns\?order=desc&limit=1$/u);
  await assert.rejects(client.retrieveTurn("session_1", "turn_1"), /TURN_MISMATCH/u);
});

test("client bounds response size, malformed arguments, and unresponsive transport", async () => {
  const huge = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async () => new Response("x".repeat(1_048_577)) });
  await assert.rejects(huge.retrieveSession("session_1"), /RESPONSE_TOO_LARGE/u);
  const malformed = createOpenAIAgentsClient({ apiKey: "synthetic", fetch: async () => response(providerSession([action({ arguments: "x".repeat(70_000) })])) });
  await assert.rejects(malformed.retrieveSession("session_1"), /INVALID_JSON/u);
  const blocked = createOpenAIAgentsClient({ apiKey: "synthetic", requestTimeoutMs: 10, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(blocked.retrieveSession("session_1"), /ABORTED/u);
});

test("runner awaits session binding and durable result before sending provider result", async () => {
  const order: string[] = [];
  const ledger = memoryLedger();
  const result = await runOpenAIAgentsFunctions(runnerOptions({
    onSessionCreated: async () => { await Promise.resolve(); order.push("bound"); },
    ledger: {
      async begin(key) { order.push("begun"); return ledger.begin(key); },
      async complete(key, output) { await ledger.complete(key, output); order.push("saved"); },
    },
    tools: { inspect_form: { parseArguments: () => ({}), async execute() { order.push("executed"); return { fields: [] }; } } },
    client: mockClient({ async sendToolResults() { order.push("sent"); } }),
  }));
  assert.deepEqual(order, ["bound", "begun", "executed", "saved", "sent"]);
  assert.deepEqual(result, { sessionId: "session_1", turnId: "turn_1", status: "completed", actionCount: 1 });
});

test("binding persistence failure cancels without executing a tool", async () => {
  let executed = false;
  let cancelled = false;
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
    onSessionCreated: async () => { throw new Error("private database error"); },
    tools: { inspect_form: { parseArguments: () => ({}), async execute() { executed = true; } } },
    client: mockClient({ async cancelTurn() { cancelled = true; } }),
  })), /RUN_FAILED/u);
  assert.equal(executed, false);
  assert.equal(cancelled, true);
});

test("staged initial input is never disclosed if creation or durable binding fails", async () => {
  const configuration = { ...REQUEST, input: undefined };
  for (const failure of ["create", "bind"] as const) {
    let sends = 0;
    let effects = 0;
    await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
      request: configuration,
      initialInputAfterBinding: "private candidate payload",
      async onSessionCreated() { if (failure === "bind") throw new Error("database unavailable"); },
      tools: { inspect_form: { parseArguments: () => ({}), async execute() { effects++; } } },
      client: mockClient({
        async createSession(request) { assert.match(request.input ?? "", /initialization handshake/u); assert.ok(!request.input?.includes("private candidate payload")); if (failure === "create") throw new Error("response lost"); return session(); },
        async sendMessage() { sends++; },
      }),
    })), /RUN_FAILED/u);
    assert.equal(sends, 0);
    assert.equal(effects, 0);
  }
});

test("staged input requires a new generic session and ignores the completed initialization turn", async () => {
  const configuration = { ...REQUEST, input: undefined };
  const order: string[] = [];
  let sentMessage = false;
  let latestReads = 0;
  await runOpenAIAgentsFunctions(runnerOptions({
    request: configuration,
    initialInputAfterBinding: "candidate payload",
    async onSessionCreated() { order.push("bound"); },
    client: mockClient({
      async createSession(request) { assert.match(request.input ?? "", /initialization handshake/u); assert.ok(!request.input?.includes("candidate payload")); order.push("created"); return session(); },
      async sendMessage(id, input) { assert.equal(id, "session_1"); assert.equal(input, "candidate payload"); sentMessage = true; order.push("message"); },
      async retrieveLatestTurn() {
        latestReads++;
        return { ...turn(), id: sentMessage && latestReads > 2 ? "turn_1" : "turn_initialization" };
      },
    }),
  }));
  assert.deepEqual(order, ["created", "bound", "message"]);
  assert.equal(latestReads, 3);
  for (const options of [{ request: REQUEST }, { sessionId: "session_1" }]) {
    await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
      request: configuration, initialInputAfterBinding: "candidate payload", ...options,
      client: mockClient({ async createSession() { assert.fail("must not create"); } }),
    })), /INVALID_STAGED_INPUT/u);
  }
});

test("initialization cannot execute tools or receive candidate data", async () => {
  let effects = 0;
  let messages = 0;
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
    request: { ...REQUEST, input: undefined }, initialInputAfterBinding: "candidate payload",
    client: mockClient({ async sendMessage() { messages++; } }),
    tools: { inspect_form: { parseArguments: () => ({}), async execute() { effects++; } } },
  })), /INITIALIZATION_TOOL_DENIED/u);
  assert.equal(effects, 0);
  assert.equal(messages, 0);
});

test("lost tool-result acknowledgement resends the durable result without executing twice", async () => {
  let executions = 0;
  let sends = 0;
  const sent: readonly OpenAIAgentToolResult[][] = [];
  const client = mockClient({
    async retrieveSession() { return sends < 2 ? session([action()]) : session(); },
    async sendToolResults(_sessionId, results) {
      (sent as OpenAIAgentToolResult[][]).push([...results]);
      sends += 1;
      if (sends === 1) throw new OpenAIAgentsError("OPENAI_AGENTS_NETWORK_ERROR");
    },
  });
  await runOpenAIAgentsFunctions(runnerOptions({ client, tools: { inspect_form: { parseArguments: () => ({}), async execute() { executions += 1; return { fields: [] }; } } } }));
  assert.equal(executions, 1);
  assert.equal(sends, 2);
  assert.deepEqual(sent[0], sent[1]);
});

test("uncertain durable call never repeats its browser side effect", async () => {
  let executed = false;
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
    ledger: { async begin() { return { status: "uncertain" }; }, async complete() { assert.fail("unexpected complete"); } },
    tools: { inspect_form: { parseArguments: () => ({}), async execute() { executed = true; } } },
  })), /ACTION_UNCERTAIN/u);
  assert.equal(executed, false);
});

test("invalid arguments, unknown names and cross-turn actions cannot run tools", async () => {
  for (const invalid of [action({ name: "submit_application" }), action({ arguments: { injected: "candidate secret" } })]) {
    let executed = false;
    await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
      client: mockClient({ async createSession() { return session([invalid]); } }),
      tools: { inspect_form: { parseArguments(value) { assert.deepEqual(value, {}); return {}; }, async execute() { executed = true; } } },
    })), /TOOL_NOT_ALLOWED|INVALID_ARGUMENTS/u);
    assert.equal(executed, false);
  }
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
    client: mockClient({ async createSession() { return session([action(), action({ turn_id: "turn_2", call_id: "call_2" })]); } }),
  })), /TURN_MISMATCH/u);
});

test("throwing handler leaves ledger uncertain and does not expose its raw exception", async () => {
  const ledger = memoryLedger();
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({ ledger,
    tools: { inspect_form: { parseArguments: () => ({}), async execute() { throw new Error("secret browser content"); } } },
  })), { message: "OPENAI_AGENTS_ACTION_UNCERTAIN" });
  assert.equal(ledger.entries.size, 1);
  assert.equal([...ledger.entries.values()][0].result, undefined);
});

test("idle session does not mean success: last turn failure or cancellation remains explicit", async () => {
  for (const status of ["failed", "cancelled"] as const) {
    const result = await runOpenAIAgentsFunctions(runnerOptions({ client: mockClient({
      async createSession() { return session(); }, async retrieveLatestTurn() { return turn(status); },
    }) }));
    assert.equal(result.status, status);
    assert.equal(result.actionCount, 0);
  }
});

test("runner enforces action and poll budgets and cancels upstream work", async () => {
  let cancellations = 0;
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({ maxActions: 1, client: mockClient({
    async createSession() { return session([action(), action({ call_id: "call_2" })]); },
    async cancelTurn() { cancellations += 1; },
  }) })), /ACTION_LIMIT/u);
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({ maxPolls: 2, client: mockClient({
    async createSession() { return session(); }, async retrieveLatestTurn() { return null; },
    async cancelTurn() { cancellations += 1; },
  }) })), /POLL_LIMIT/u);
  assert.equal(cancellations, 2);
});

test("runner abort bounds a non-cooperative tool and never starts another action", async () => {
  const controller = new AbortController();
  let executed = 0;
  let cancelled = false;
  const run = runOpenAIAgentsFunctions(runnerOptions({ signal: controller.signal,
    client: mockClient({
      async createSession() { return session([action(), action({ call_id: "call_2" })]); },
      async cancelTurn() { cancelled = true; },
    }),
    tools: { inspect_form: { parseArguments: () => ({}), async execute() {
      executed += 1;
      setTimeout(() => controller.abort(), 5);
      return new Promise(() => {});
    } } },
  }));
  await assert.rejects(run, /ABORTED/u);
  assert.equal(executed, 1);
  assert.equal(cancelled, true);
});

test("same call ID with changed payload fails instead of repeating an effect", async () => {
  let executed = 0;
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
    client: mockClient({ async retrieveSession() { return session([action({ arguments: { changed: true } })]); } }),
    tools: { inspect_form: { parseArguments: () => ({}), async execute() { executed += 1; return {}; } } },
  })), /CALL_MISMATCH/u);
  assert.equal(executed, 1);
});

test("repeated pending result is bounded even when the provider never acknowledges it", async () => {
  let executions = 0;
  await assert.rejects(runOpenAIAgentsFunctions(runnerOptions({
    client: mockClient({ async retrieveSession() { return session([action()]); } }),
    tools: { inspect_form: { parseArguments: () => ({}), async execute() { executions += 1; return {}; } } },
  })), /RESULT_NOT_ACCEPTED/u);
  assert.equal(executions, 1);
});
