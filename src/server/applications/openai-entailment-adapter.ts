import OpenAI from "openai";

import {
  type ApplicationEntailmentAdapterResult,
  type ApplicationEntailmentRequest,
  type ApplicationEntailmentVerdict,
} from "../../domain/application-entailment.ts";

export const OPENAI_ENTAILMENT_ADAPTER_RELEASE = "openai-responses-entailment/2";
export const DEFAULT_OPENAI_ENTAILMENT_MODEL = "gpt-5.6-terra";

export type ApplicationEntailmentExecution = Readonly<{
  adapterRelease: typeof OPENAI_ENTAILMENT_ADAPTER_RELEASE;
  modelRelease: string;
  requestId: string | null;
}>;

function schema(request: ApplicationEntailmentRequest): Record<string, unknown> {
  const claimIds = request.claims.map((claim) => claim.claimId);
  return {
    type: "object",
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      decisions: {
        type: "array",
        minItems: claimIds.length,
        maxItems: claimIds.length,
        items: {
          type: "object",
          properties: {
            claimId: { type: "string", enum: claimIds },
            verdict: { type: "string", enum: ["ENTAILED", "NOT_ENTAILED", "UNCERTAIN"] },
            reason: { type: "string", minLength: 1, maxLength: 500 },
          },
          required: ["claimId", "verdict", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["schemaVersion", "decisions"],
    additionalProperties: false,
  };
}

function parse(value: unknown): ApplicationEntailmentAdapterResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ENTAILMENT_OUTPUT_INVALID");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "schemaVersion" && key !== "decisions") ||
    record.schemaVersion !== 1 ||
    !Array.isArray(record.decisions)
  ) {
    throw new Error("ENTAILMENT_OUTPUT_INVALID");
  }
  const decisions = record.decisions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("ENTAILMENT_OUTPUT_INVALID");
    }
    const decision = entry as Record<string, unknown>;
    if (
      Object.keys(decision).some((key) => !["claimId", "verdict", "reason"].includes(key)) ||
      typeof decision.claimId !== "string" || !decision.claimId.trim() || decision.claimId.length > 160 ||
      typeof decision.reason !== "string" || !decision.reason.trim() || decision.reason.length > 500 ||
      !["ENTAILED", "NOT_ENTAILED", "UNCERTAIN"].includes(String(decision.verdict))
    ) {
      throw new Error("ENTAILMENT_OUTPUT_INVALID");
    }
    return Object.freeze({
      claimId: decision.claimId,
      verdict: decision.verdict as ApplicationEntailmentVerdict,
      reason: decision.reason,
    });
  });
  return Object.freeze({ schemaVersion: 1 as const, decisions: Object.freeze(decisions) });
}

export function createOpenAIApplicationEntailmentAdapter(options: Readonly<{
  apiKey?: string;
  model?: string;
  client?: OpenAI;
}> = {}): Readonly<{
  validate(request: ApplicationEntailmentRequest): Promise<Readonly<{
    result: ApplicationEntailmentAdapterResult;
    execution: ApplicationEntailmentExecution;
  }>>;
}> {
  const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!options.client && !apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");
  const client = options.client ?? new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
  const model = options.model?.trim() || DEFAULT_OPENAI_ENTAILMENT_MODEL;

  return {
    async validate(request) {
      const response = await client.responses.create({
        model,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 8_000,
        instructions: [
          "Evaluate each claim independently against only its cited source text.",
          "ENTAILED means the source text directly supports the full material meaning of the claim.",
          "Use UNCERTAIN when support is incomplete or ambiguous. Use NOT_ENTAILED when the source conflicts or does not support it.",
          "Do not use outside knowledge, infer adjacent facts, or reward plausible wording.",
          "For DOCUMENT_SEGMENT entries, inspect every factual assertion in the actual document text, including assertions absent from separately declared claims. The entire segment passes only if every factual assertion is supported by its attached sources.",
          "Candidate-evidence sources can support the candidate's record. Job fields and employer research can support only employer or role facts, never candidate abilities, employment, qualifications, outcomes, or personal circumstances.",
          "For DOCUMENT_SEGMENT entries only, headings, first-person voice, and a conventional expression of interest or invitation to discuss the sourced record need no independent evidence. This exception never covers a factual claim, invented motivation, future commitment, availability, promised artifact, qualification, or outcome. A role connection is supported only when it accurately relates the cited work to the cited role requirements without claiming new results or expertise.",
          "Return exactly one decision for every claim ID.",
        ].join("\n"),
        input: [{
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(request) }],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "roledawn_application_entailment",
            strict: true,
            schema: schema(request),
          },
        },
      });
      if (response.status !== "completed" || !response.output_text.trim()) {
        throw new Error("ENTAILMENT_RESPONSE_INCOMPLETE");
      }
      let output: unknown;
      try {
        output = JSON.parse(response.output_text) as unknown;
      } catch {
        throw new Error("ENTAILMENT_OUTPUT_NOT_JSON");
      }
      return Object.freeze({
        result: parse(output),
        execution: Object.freeze({
          adapterRelease: OPENAI_ENTAILMENT_ADAPTER_RELEASE,
          modelRelease: response.model || model,
          requestId: response.id || null,
        }),
      });
    },
  };
}
