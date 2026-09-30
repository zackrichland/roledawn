import OpenAI from "openai";

export class StructuredResponseError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "StructuredResponseError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type StructuredResponseRequest = Readonly<{
  client?: OpenAI;
  apiKey?: string;
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  maxOutputTokens?: number;
  timeoutMs?: number;
  tools?: OpenAI.Responses.Tool[];
}>;

export type StructuredResponseResult = Readonly<{
  value: unknown;
  model: string;
  requestId: string | null;
  /** URLs the model opened or cited when a web search tool was available. */
  citedUrls: readonly string[];
}>;

function refusalPresent(output: unknown): boolean {
  return Array.isArray(output) && output.some((item) => {
    const content = (item as { content?: unknown } | null)?.content;
    return Array.isArray(content) && content.some((part) => (part as { type?: unknown } | null)?.type === "refusal");
  });
}

function citedUrls(output: unknown): string[] {
  const urls = new Set<string>();
  if (!Array.isArray(output)) return [];
  for (const item of output) {
    const record = item as Record<string, unknown> | null;
    if (!record) continue;
    const action = record.action as Record<string, unknown> | undefined;
    if (record.type === "web_search_call" && action) {
      if (typeof action.url === "string") urls.add(action.url);
      if (Array.isArray(action.sources)) {
        for (const source of action.sources) {
          const url = (source as Record<string, unknown> | null)?.url;
          if (typeof url === "string") urls.add(url);
        }
      }
    }
    const content = record.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        const annotations = (part as Record<string, unknown> | null)?.annotations;
        if (!Array.isArray(annotations)) continue;
        for (const annotation of annotations) {
          const url = (annotation as Record<string, unknown> | null)?.url;
          if (typeof url === "string") urls.add(url);
        }
      }
    }
  }
  return [...urls];
}

/** One strict JSON-schema Responses call. Every failure becomes a stable code. */
export async function structuredResponse(request: StructuredResponseRequest): Promise<StructuredResponseResult> {
  const apiKey = request.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!request.client && !apiKey) throw new StructuredResponseError("OPENAI_API_KEY_REQUIRED", false);
  const client = request.client ?? new OpenAI({ apiKey, maxRetries: 0, timeout: request.timeoutMs ?? 60_000 });
  let response: OpenAI.Responses.Response;
  try {
    response = await client.responses.create({
      model: request.model,
      store: false,
      instructions: request.instructions,
      input: request.input,
      reasoning: { effort: request.reasoningEffort ?? "low" },
      max_output_tokens: request.maxOutputTokens ?? 4_000,
      ...(request.tools ? { tools: request.tools } : {}),
      // Web search returns the pages it read only when asked; research facts
      // are kept only if their URL is among them.
      ...(request.tools?.some((tool) => tool.type === "web_search") ? { include: ["web_search_call.action.sources" as const] } : {}),
      text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } },
    });
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    const failure = error as { code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown } } | null;
    const code = failure?.code ?? failure?.error?.code;
    const type = failure?.type ?? failure?.error?.type;
    if (code === "credit_balance_exhausted" || code === "insufficient_quota" || type === "insufficient_quota") {
      throw new StructuredResponseError("MODEL_CREDITS_EXHAUSTED", false);
    }
    if (code === "rate_limit_exceeded") throw new StructuredResponseError("MODEL_RATE_LIMITED", true);
    const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
    throw new StructuredResponseError(status ? `MODEL_HTTP_${status}` : "MODEL_REQUEST_FAILED", retryable);
  }
  if (refusalPresent(response.output)) throw new StructuredResponseError("MODEL_REFUSAL", false);
  if (response.status !== "completed") throw new StructuredResponseError("MODEL_RESPONSE_INCOMPLETE", true);
  if (!response.output_text?.trim()) throw new StructuredResponseError("MODEL_OUTPUT_EMPTY", true);
  let value: unknown;
  try {
    value = JSON.parse(response.output_text);
  } catch {
    throw new StructuredResponseError("MODEL_OUTPUT_NOT_JSON", true);
  }
  return Object.freeze({
    value,
    model: response.model || request.model,
    requestId: response.id || null,
    citedUrls: Object.freeze(citedUrls(response.output)),
  });
}
