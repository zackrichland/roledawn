import { createHash } from "node:crypto";

// Agents API beta schemas verified 2026-09-16:
// https://developers.openai.com/api/docs/guides/agents-api/tools/functions
// https://developers.openai.com/api/docs/guides/agents-api/sessions
const API_ORIGIN = "https://api.openai.com/v1";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const FUNCTION_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const MAX_JSON_BYTES = 1_048_576;
const MAX_ARGUMENT_BYTES = 65_536;
// The 2026-09-16 live beta rejects environment:none creation without input,
// despite input being optional in the reference. This contains no form data.
const INITIALIZATION_INPUT = "This is a session initialization handshake only. Do not call any tools or work on a form. Reply READY and finish this turn. A later user message will provide the form task.";

export type OpenAIAgentFunctionTool = Readonly<{
  type: "function";
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
}>;

export type OpenAIAgentsCreateRequest = Readonly<{
  model: string;
  instructions: string;
  tools: readonly OpenAIAgentFunctionTool[];
  input?: string;
  metadata?: Readonly<Record<string, string>>;
}>;

export type OpenAIAgentFunctionCall = Readonly<{
  type: "function_call";
  turn_id: string;
  call_id: string;
  name: string;
  arguments: unknown;
}>;

export type OpenAIAgentSession = Readonly<{
  id: string;
  status: "idle" | "in_progress" | "requires_action" | "failed";
  required_actions: readonly OpenAIAgentFunctionCall[];
}>;

export type OpenAIAgentTurn = Readonly<{
  id: string;
  session_id: string;
  status: "queued" | "in_progress" | "waiting" | "completed" | "failed" | "cancelled";
  failure?: AgentTurnFailure;
}>;

export type AgentTurnFailure = "CREDITS_EXHAUSTED" | "RATE_LIMIT" | "PROVIDER_ERROR" | "CONTEXT_LIMIT" | "CONTENT_FILTER" | "UNKNOWN";
/** Fixed categories only: provider error messages can include candidate text or credentials. */
export function classifyAgentTurnFailure(value: unknown): AgentTurnFailure {
  const error = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const code = error.code;
  if (code === "credit_balance_exhausted" || code === "insufficient_quota" || error.type === "insufficient_quota") return "CREDITS_EXHAUSTED";
  if (code === "rate_limit_exceeded") return "RATE_LIMIT";
  if (code === "server_error" || code === "internal_error") return "PROVIDER_ERROR";
  if (code === "context_length_exceeded") return "CONTEXT_LIMIT";
  if (code === "content_filter" || code === "safety_violation") return "CONTENT_FILTER";
  return "UNKNOWN";
}

export type OpenAIAgentToolResult = Readonly<{
  type: "agent.session.input.tool_result";
  turn_id: string;
  call_id: string;
} & ({ success: true; output: string } | { success: false; error: string })>;

/** This seam never grants shell, MCP, web-search, or general browser authority. */
export interface OpenAIAgentsClient {
  createSession(request: OpenAIAgentsCreateRequest, signal?: AbortSignal): Promise<OpenAIAgentSession>;
  retrieveSession(sessionId: string, signal?: AbortSignal): Promise<OpenAIAgentSession>;
  retrieveTurn(sessionId: string, turnId: string, signal?: AbortSignal): Promise<OpenAIAgentTurn>;
  retrieveLatestTurn(sessionId: string, signal?: AbortSignal): Promise<OpenAIAgentTurn | null>;
  sendToolResults(sessionId: string, results: readonly OpenAIAgentToolResult[], signal?: AbortSignal): Promise<void>;
  sendMessage(sessionId: string, input: string, signal?: AbortSignal): Promise<void>;
  cancelTurn(sessionId: string, signal?: AbortSignal): Promise<void>;
  deleteSession(sessionId: string, signal?: AbortSignal): Promise<void>;
}

/** Only fixed error codes/statuses escape; provider bodies, tool errors, and credentials do not. */
export class OpenAIAgentsError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(code: string, status?: number) {
    super(code);
    this.name = "OpenAIAgentsError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string): never {
  throw new OpenAIAgentsError(code);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("OPENAI_AGENTS_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail("OPENAI_AGENTS_INVALID_ID");
  return value;
}

function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) fail("OPENAI_AGENTS_INVALID_LIMIT");
  return value;
}

function textValue(value: unknown, maxBytes = MAX_JSON_BYTES): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maxBytes) {
    fail("OPENAI_AGENTS_INVALID_INPUT");
  }
  return value;
}

function json(value: unknown, maxBytes = MAX_JSON_BYTES): string {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { fail("OPENAI_AGENTS_INVALID_JSON"); }
  if (encoded === undefined || Buffer.byteLength(encoded) > maxBytes) fail("OPENAI_AGENTS_INVALID_JSON");
  return encoded;
}

function hash(value: unknown): string {
  // Sort object keys so retries cannot evade a durable call binding by changing key order.
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    }
    return item;
  };
  return createHash("sha256").update(json(canonical(value))).digest("hex");
}

function parseSession(value: unknown, expectedId?: string): OpenAIAgentSession {
  const record = object(value);
  const sessionId = id(record.id);
  if (expectedId && sessionId !== expectedId) fail("OPENAI_AGENTS_SESSION_MISMATCH");
  if (!["idle", "in_progress", "requires_action", "failed"].includes(String(record.status))) {
    fail("OPENAI_AGENTS_INVALID_RESPONSE");
  }
  if (object(record.environment).type !== "none") fail("OPENAI_AGENTS_UNEXPECTED_ENVIRONMENT");
  if (!Array.isArray(record.required_actions) || record.required_actions.length > 100) fail("OPENAI_AGENTS_INVALID_RESPONSE");
  const requiredActions = record.required_actions.map((entry): OpenAIAgentFunctionCall => {
    const action = object(entry);
    if (action.type !== "function_call") fail("OPENAI_AGENTS_UNSUPPORTED_ACTION");
    if (typeof action.name !== "string" || !FUNCTION_PATTERN.test(action.name)) fail("OPENAI_AGENTS_INVALID_FUNCTION");
    json(action.arguments, MAX_ARGUMENT_BYTES);
    return { type: "function_call", turn_id: id(action.turn_id), call_id: id(action.call_id), name: action.name, arguments: action.arguments };
  });
  return { id: sessionId, status: record.status as OpenAIAgentSession["status"], required_actions: requiredActions };
}

function parseTurn(value: unknown, sessionId: string, turnId?: string): OpenAIAgentTurn {
  const record = object(value);
  const parsedId = id(record.id);
  if (id(record.session_id) !== sessionId || (turnId && parsedId !== turnId)) fail("OPENAI_AGENTS_TURN_MISMATCH");
  if (!["queued", "in_progress", "waiting", "completed", "failed", "cancelled"].includes(String(record.status))) {
    fail("OPENAI_AGENTS_INVALID_RESPONSE");
  }
  return { id: parsedId, session_id: sessionId, status: record.status as OpenAIAgentTurn["status"],
    ...(record.status === "failed" ? { failure: classifyAgentTurnFailure(record.error) } : {}) };
}

function validateResult(result: OpenAIAgentToolResult): void {
  id(result.turn_id);
  id(result.call_id);
  if (result.type !== "agent.session.input.tool_result" || typeof result.success !== "boolean") fail("OPENAI_AGENTS_INVALID_RESULT");
  textValue(result.success ? result.output : result.error);
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) fail("OPENAI_AGENTS_ABORTED");
}

/** Bounds even an injected transport/callback that fails to reject on abort. Handlers must still honor signal. */
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  checkSignal(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new OpenAIAgentsError("OPENAI_AGENTS_ABORTED"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) fail("OPENAI_AGENTS_INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_JSON_BYTES) fail("OPENAI_AGENTS_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof OpenAIAgentsError) throw error;
    fail("OPENAI_AGENTS_INVALID_RESPONSE");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createOpenAIAgentsClient(options: Readonly<{
  apiKey: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}>): OpenAIAgentsClient {
  const apiKey = textValue(options.apiKey, 4096);
  if (/\s/u.test(apiKey)) fail("OPENAI_AGENTS_INVALID_CREDENTIAL");
  const fetcher = options.fetch ?? fetch;
  const requestTimeoutMs = boundedInteger(options.requestTimeoutMs ?? 20_000, 1, 60_000);

  async function request(method: string, path: string, body?: unknown, signal?: AbortSignal, idempotencyKey?: string): Promise<unknown> {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      checkSignal(combined);
      const response = await abortable(fetcher(`${API_ORIGIN}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "agents=v1",
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: json(body) }),
        signal: combined,
        cache: "no-store",
        redirect: "error",
      }), combined);
      if (!response.ok) {
        if (response.status === 429) {
          let failure: AgentTurnFailure = "UNKNOWN";
          try { failure = classifyAgentTurnFailure(object(await readJson(response)).error); } catch { /* Never expose provider text. */ }
          if (failure === "CREDITS_EXHAUSTED") throw new OpenAIAgentsError("MODEL_CREDITS_EXHAUSTED", response.status);
          if (failure === "RATE_LIMIT") throw new OpenAIAgentsError("MODEL_RATE_LIMITED", response.status);
        } else void response.body?.cancel().catch(() => undefined);
        throw new OpenAIAgentsError("OPENAI_AGENTS_HTTP_ERROR", response.status);
      }
      if (method === "DELETE" && response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        fail("OPENAI_AGENTS_DELETE_NOT_CONFIRMED");
      }
      if (path.endsWith("/events")) {
        void response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      return await abortable(readJson(response), combined);
    } catch (error) {
      if (error instanceof OpenAIAgentsError) throw error;
      throw new OpenAIAgentsError(combined.aborted ? "OPENAI_AGENTS_ABORTED" : "OPENAI_AGENTS_NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
    }
  }

  const sessionPath = (sessionId: string) => `/agents/sessions/${id(sessionId)}`;
  return {
    async createSession(input, signal) {
      textValue(input.model, 128);
      textValue(input.instructions);
      if (input.input !== undefined) textValue(input.input);
      if (!Array.isArray(input.tools) || input.tools.length < 1 || input.tools.length > 32) fail("OPENAI_AGENTS_INVALID_TOOLS");
      const names = new Set<string>();
      const tools = input.tools.map((tool) => {
        if (tool.type !== "function" || !FUNCTION_PATTERN.test(tool.name) || names.has(tool.name)) fail("OPENAI_AGENTS_INVALID_TOOLS");
        names.add(tool.name);
        textValue(tool.description, 8192);
        const parameters = object(tool.parameters);
        if (parameters.type !== "object" || parameters.additionalProperties !== false) fail("OPENAI_AGENTS_INVALID_TOOLS");
        return { type: "function", name: tool.name, description: tool.description, parameters };
      });
      if (input.metadata && (Object.entries(input.metadata).length > 16 || Object.entries(input.metadata).some(([key, value]) => key.length > 64 || typeof value !== "string" || value.length > 512))) {
        fail("OPENAI_AGENTS_INVALID_METADATA");
      }
      // No automatic retry: creation may succeed even if its response is lost.
      return parseSession(await request("POST", "/agents/sessions", {
        agent: {
          model: input.model,
          instructions: input.instructions,
          tools: [...tools, { type: "programmatic_tool_calling", enabled: false }],
          multi_agent: { enabled: false },
        },
        environment: { type: "none" },
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }, signal));
    },
    async retrieveSession(sessionId, signal) {
      return parseSession(await request("GET", sessionPath(sessionId), undefined, signal), sessionId);
    },
    async retrieveTurn(sessionId, turnId, signal) {
      return parseTurn(await request("GET", `${sessionPath(sessionId)}/turns/${id(turnId)}`, undefined, signal), sessionId, turnId);
    },
    async retrieveLatestTurn(sessionId, signal) {
      const result = object(await request("GET", `${sessionPath(sessionId)}/turns?order=desc&limit=1`, undefined, signal));
      if (!Array.isArray(result.data) || result.data.length > 1) fail("OPENAI_AGENTS_INVALID_RESPONSE");
      return result.data.length ? parseTurn(result.data[0], sessionId) : null;
    },
    async sendToolResults(sessionId, results, signal) {
      if (!results.length || results.length > 100) fail("OPENAI_AGENTS_INVALID_RESULT");
      results.forEach(validateResult);
      await request("POST", `${sessionPath(sessionId)}/events`, { events: results }, signal, `roledawn-tools-${hash({ sessionId, results })}`);
    },
    async sendMessage(sessionId, input, signal) {
      textValue(input);
      await request("POST", `${sessionPath(sessionId)}/events`, {
        events: [{ type: "agent.session.input.message", input: [{ role: "user", content: [{ type: "input_text", text: input }] }] }],
      }, signal);
    },
    async cancelTurn(sessionId, signal) {
      await request("POST", `${sessionPath(sessionId)}/events`, { events: [{ type: "agent.session.input.cancel" }] }, signal);
    },
    async deleteSession(sessionId, signal) {
      try {
        const confirmation = object(await request("DELETE", sessionPath(sessionId), undefined, signal));
        if (confirmation.id !== sessionId || confirmation.deleted !== true || confirmation.object !== "agent.session.deleted") {
          fail("OPENAI_AGENTS_DELETE_NOT_CONFIRMED");
        }
      } catch (error) {
        // A prior delete may have succeeded before its response was lost.
        if (!(error instanceof OpenAIAgentsError && error.status === 404)) throw error;
      }
    },
  };
}

export type OpenAIAgentCallKey = Readonly<{
  sessionId: string;
  turnId: string;
  callId: string;
  name: string;
  argumentsHash: string;
}>;

/** Implement in durable storage. A prior STARTED call is uncertain until reconciled, never 'new'. */
export interface OpenAIAgentActionLedger {
  begin(key: OpenAIAgentCallKey): Promise<
    { status: "new" } |
    { status: "completed"; result: OpenAIAgentToolResult } |
    { status: "uncertain" }
  >;
  complete(key: OpenAIAgentCallKey, result: OpenAIAgentToolResult): Promise<void>;
}

export type OpenAIAgentToolHandler = Readonly<{
  parseArguments(value: unknown): Record<string, unknown>;
  /** Must honor signal before each browser action. A thrown call is not automatically retried. */
  execute(arguments_: Record<string, unknown>, context: Readonly<{
    sessionId: string; turnId: string; callId: string; signal: AbortSignal;
  }>): Promise<unknown>;
}>;

export type OpenAIAgentsRunResult = Readonly<{
  sessionId: string;
  turnId: string;
  status: "completed" | "failed" | "cancelled";
  actionCount: number;
  failure?: AgentTurnFailure;
}>;

/** Provider completion is not proof that a browser form is complete or that any application was sent. */
export async function runOpenAIAgentsFunctions(options: Readonly<{
  client: OpenAIAgentsClient;
  request: OpenAIAgentsCreateRequest;
  sessionId?: string;
  turnId?: string;
  /** New sessions only: disclose this input after durable session binding succeeds. */
  initialInputAfterBinding?: string;
  onSessionCreated(sessionId: string): Promise<void>;
  ledger: OpenAIAgentActionLedger;
  tools: Readonly<Record<string, OpenAIAgentToolHandler>>;
  timeoutMs: number;
  maxActions: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  signal?: AbortSignal;
  /** Checked after each delivered batch of tool results; true ends the run without a closing turn. */
  shouldStop?: () => boolean;
}>): Promise<OpenAIAgentsRunResult> {
  const timeoutMs = boundedInteger(options.timeoutMs, 1, 900_000);
  const maxActions = boundedInteger(options.maxActions, 1, 200);
  const pollIntervalMs = boundedInteger(options.pollIntervalMs ?? 500, 1, 10_000);
  const maxPolls = boundedInteger(options.maxPolls ?? 1200, 1, 10_000);
  if (options.initialInputAfterBinding !== undefined) {
    textValue(options.initialInputAfterBinding);
    if (options.request.input !== undefined || options.sessionId || options.turnId) fail("OPENAI_AGENTS_INVALID_STAGED_INPUT");
  }
  const allowed = new Set(options.request.tools.map((tool) => tool.name));
  if (allowed.size !== options.request.tools.length || [...allowed].some((name) => !Object.hasOwn(options.tools, name))) fail("OPENAI_AGENTS_INVALID_TOOLS");
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let sessionId = options.sessionId ? id(options.sessionId) : undefined;
  let turnId = options.turnId ? id(options.turnId) : undefined;
  let actionCount = 0;
  let polls = 0;
  let initializationTurnId: string | undefined;
  const observed = new Map<string, string>();
  const deliveries = new Map<string, number>();
  const bounded = <T>(operation: Promise<T>) => abortable(operation, signal);
  async function pause(): Promise<void> {
    await bounded(new Promise<void>((resolve) => {
      const timeout = setTimeout(done, pollIntervalMs);
      function done() { clearTimeout(timeout); signal.removeEventListener("abort", done); resolve(); }
      signal.addEventListener("abort", done, { once: true });
    }));
  }
  try {
    checkSignal(signal);
    let session = sessionId
      ? await bounded(options.client.retrieveSession(sessionId, signal))
      : await bounded(options.client.createSession(options.initialInputAfterBinding !== undefined
        ? { ...options.request, input: INITIALIZATION_INPUT } : options.request, signal));
    sessionId = id(session.id);
    // This is also awaited when resuming; the caller verifies the application binding.
    await bounded(options.onSessionCreated(sessionId));
    if (options.initialInputAfterBinding !== undefined) {
      // Complete the generic handshake without permitting any tool effect.
      // The turn ID also prevents a stale completed handshake from being
      // mistaken for successful completion of the subsequent form task.
      while (polls < maxPolls) {
        polls++;
        checkSignal(signal);
        if (session.id !== sessionId) fail("OPENAI_AGENTS_SESSION_MISMATCH");
        if (session.status === "failed") fail("OPENAI_AGENTS_SESSION_FAILED");
        if (session.required_actions.length) fail("OPENAI_AGENTS_INITIALIZATION_TOOL_DENIED");
        const initializationTurn: OpenAIAgentTurn | null = await bounded(options.client.retrieveLatestTurn(sessionId, signal));
        if (initializationTurn) {
          if (initializationTurn.session_id !== sessionId) fail("OPENAI_AGENTS_TURN_MISMATCH");
          if (initializationTurn.status === "failed" || initializationTurn.status === "cancelled") fail("OPENAI_AGENTS_INITIALIZATION_FAILED");
          if (initializationTurn.status === "completed") {
            initializationTurnId = id(initializationTurn.id);
            break;
          }
        }
        await pause();
        session = await bounded(options.client.retrieveSession(sessionId, signal));
      }
      if (!initializationTurnId) fail("OPENAI_AGENTS_POLL_LIMIT");
      // An uncertain create response can leave only this generic handshake
      // and opaque run metadata upstream, not the candidate/form payload.
      await bounded(options.client.sendMessage(sessionId, options.initialInputAfterBinding, signal));
      session = await bounded(options.client.retrieveSession(sessionId, signal));
    }
    for (; polls < maxPolls; polls += 1) {
      checkSignal(signal);
      if (session.id !== sessionId) fail("OPENAI_AGENTS_SESSION_MISMATCH");
      if (session.status === "failed") {
        const terminal = await bounded(options.client.retrieveLatestTurn(sessionId, signal));
        if (!terminal || terminal.id === initializationTurnId || terminal.session_id !== sessionId || terminal.status !== "failed"
          || (turnId && terminal.id !== turnId)) fail("OPENAI_AGENTS_SESSION_FAILED");
        return { sessionId, turnId: terminal.id, status: "failed", actionCount, failure: terminal.failure ?? "UNKNOWN" };
      }
      if (session.required_actions.length) {
        // Validate the whole batch before the first effect, including mixed-turn or duplicate calls.
        const batchIds = new Set<string>();
        const expectedTurn = turnId ?? id(session.required_actions[0].turn_id);
        if (expectedTurn === initializationTurnId) fail("OPENAI_AGENTS_TURN_MISMATCH");
        for (const action of session.required_actions) {
          if (action.type !== "function_call" || !allowed.has(action.name) || !Object.hasOwn(options.tools, action.name)) fail("OPENAI_AGENTS_TOOL_NOT_ALLOWED");
          if (id(action.turn_id) !== expectedTurn) fail("OPENAI_AGENTS_TURN_MISMATCH");
          const batchKey = `${expectedTurn}:${id(action.call_id)}`;
          if (batchIds.has(batchKey)) fail("OPENAI_AGENTS_CALL_MISMATCH");
          batchIds.add(batchKey);
          json(action.arguments, MAX_ARGUMENT_BYTES);
        }
        const results: OpenAIAgentToolResult[] = [];
        for (const action of session.required_actions) {
          checkSignal(signal);
          if (!allowed.has(action.name) || !Object.hasOwn(options.tools, action.name)) fail("OPENAI_AGENTS_TOOL_NOT_ALLOWED");
          if (turnId && turnId !== action.turn_id) fail("OPENAI_AGENTS_TURN_MISMATCH");
          turnId = id(action.turn_id);
          id(action.call_id);
          const argumentsHash = hash(action.arguments);
          const callKey = `${turnId}:${action.call_id}`;
          const priorHash = observed.get(callKey);
          if (priorHash && priorHash !== `${action.name}:${argumentsHash}`) fail("OPENAI_AGENTS_CALL_MISMATCH");
          if (!priorHash) {
            if (observed.size >= maxActions) fail("OPENAI_AGENTS_ACTION_LIMIT");
            observed.set(callKey, `${action.name}:${argumentsHash}`);
          }
          const key = { sessionId, turnId, callId: action.call_id, name: action.name, argumentsHash };
          const prior = await bounded(options.ledger.begin(key));
          checkSignal(signal);
          if (prior.status === "uncertain") fail("OPENAI_AGENTS_ACTION_UNCERTAIN");
          let result: OpenAIAgentToolResult;
          if (prior.status === "completed") {
            result = prior.result;
            validateResult(result);
            if (result.turn_id !== turnId || result.call_id !== action.call_id) fail("OPENAI_AGENTS_CALL_MISMATCH");
          } else {
            const handler = options.tools[action.name];
            let arguments_: Record<string, unknown>;
            try { arguments_ = object(handler.parseArguments(action.arguments)); }
            catch { fail("OPENAI_AGENTS_INVALID_ARGUMENTS"); }
            checkSignal(signal);
            let output: unknown;
            try {
              output = await bounded(handler.execute(arguments_, { sessionId, turnId, callId: action.call_id, signal }));
            } catch {
              // A browser action may have happened. Leave STARTED durable and force reconciliation.
              fail(signal.aborted ? "OPENAI_AGENTS_ABORTED" : "OPENAI_AGENTS_ACTION_UNCERTAIN");
            }
            checkSignal(signal);
            result = { type: "agent.session.input.tool_result", turn_id: turnId, call_id: action.call_id, success: true, output: json(output) };
            await bounded(options.ledger.complete(key, result));
            actionCount += 1;
          }
          const deliveryCount = (deliveries.get(callKey) ?? 0) + 1;
          if (deliveryCount > 3) fail("OPENAI_AGENTS_RESULT_NOT_ACCEPTED");
          deliveries.set(callKey, deliveryCount);
          results.push(result);
        }
        checkSignal(signal);
        // The caller's work is done (for example, the step review passed):
        // end here instead of paying for the model's closing turn.
        if (options.shouldStop?.() && turnId) {
          const cleanup = AbortSignal.timeout(2000);
          await abortable(options.client.cancelTurn(sessionId, cleanup), cleanup).catch(() => undefined);
          return { sessionId, turnId, status: "completed", actionCount };
        }
        try { await bounded(options.client.sendToolResults(sessionId, results, signal)); }
        catch (error) {
          // A lost acknowledgement can be reconciled by pending actions; saved results are reused.
          if (!(error instanceof OpenAIAgentsError) || (error.code !== "OPENAI_AGENTS_NETWORK_ERROR" && !(error.code === "OPENAI_AGENTS_HTTP_ERROR" && (error.status === 429 || (error.status ?? 0) >= 500)))) throw error;
        }
      } else {
        const turn: OpenAIAgentTurn | null = turnId
          ? await bounded(options.client.retrieveTurn(sessionId, turnId, signal))
          : await bounded(options.client.retrieveLatestTurn(sessionId, signal));
        if (turn && turn.id !== initializationTurnId) {
          if (turn.session_id !== sessionId || (turnId && turn.id !== turnId)) fail("OPENAI_AGENTS_TURN_MISMATCH");
          turnId = id(turn.id);
          if (turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled") {
            return { sessionId, turnId, status: turn.status, actionCount, ...(turn.failure ? { failure: turn.failure } : {}) };
          }
        }
      }
      await pause();
      checkSignal(signal);
      session = await bounded(options.client.retrieveSession(sessionId, signal));
    }
    fail("OPENAI_AGENTS_POLL_LIMIT");
  } catch (error) {
    if (sessionId) {
      // Cleanup has its own short deadline because the work signal may already be aborted.
      const cleanup = AbortSignal.timeout(2000);
      await abortable(options.client.cancelTurn(sessionId, cleanup), cleanup).catch(() => undefined);
    }
    if (error instanceof OpenAIAgentsError) throw error;
    fail("OPENAI_AGENTS_RUN_FAILED");
  } finally {
    clearTimeout(timer);
  }
}
