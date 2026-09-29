import OpenAI from "openai";
import type { ApplicationWritingPolicyBundle } from "../../domain/application-writing-policy.ts";
import { loadApplicationWritingPolicy } from "./application-writing-policy-loader.ts";

import {
  parseApplicationDraftingAdapterOutput,
  type ApplicationDraftingAdapter,
  type ApplicationDraftingAdapterResult,
  type ApplicationDraftingRequest,
  type ApplicationDraftingRevision,
} from "../../domain/application-drafting.ts";

export const OPENAI_DRAFTING_ADAPTER_RELEASE = "openai-responses-drafting/3";
export const DEFAULT_OPENAI_DRAFTING_MODEL = "gpt-5.6-terra";

type OpenAIDraftingAdapterOptions = Readonly<{
  apiKey?: string;
  model?: string;
  client?: OpenAI;
  loadWritingPolicy?: () => Promise<ApplicationWritingPolicyBundle>;
}>;

function proposalSchema(request: ApplicationDraftingRequest): Record<string, unknown> {
  const candidateCitation = {
    type: "object",
    properties: {
      sourceType: { type: "string", enum: ["CANDIDATE_EVIDENCE"] },
      evidenceVersionId: { type: "string", minLength: 1, maxLength: 160 },
    },
    required: ["sourceType", "evidenceVersionId"],
    additionalProperties: false,
  };
  const jobCitation = {
    type: "object",
    properties: {
      sourceType: { type: "string", enum: ["JOB_FIELD"] },
      field: {
        type: "string",
        enum: ["EMPLOYER_NAME", "TITLE", "LOCATION", "DESCRIPTION", "APPLY_URL"],
      },
    },
    required: ["sourceType", "field"],
    additionalProperties: false,
  };
  const researchCitation = {
    type: "object",
    properties: {
      sourceType: { type: "string", enum: ["RESEARCH_CLAIM"] },
      researchClaimId: { type: "string", minLength: 1, maxLength: 160 },
    },
    required: ["sourceType", "researchClaimId"],
    additionalProperties: false,
  };
  const claimSchema = (
    claimType: "CANDIDATE_EVIDENCE" | "JOB_CONTEXT" | "RESEARCH_CONTEXT",
    surfaces: readonly ("RESUME" | "COVER_LETTER")[],
    citation: Record<string, unknown>,
  ) => ({
    type: "object",
    properties: {
      claimId: { type: "string", minLength: 1, maxLength: 160 },
      claimType: { type: "string", enum: [claimType] },
      surface: { type: "string", enum: surfaces },
      statement: { type: "string", minLength: 1, maxLength: 2_000 },
      citations: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: citation,
      },
    },
    required: ["claimId", "claimType", "surface", "statement", "citations"],
    additionalProperties: false,
  });
  const preservedResume = {
    type: "object",
    properties: {
      handling: { type: "string", enum: ["PRESERVE_SERVER_SIDE"] },
      mode: { type: "string", enum: ["AS_UPLOADED"] },
      text: { type: "null" },
      claimIds: { type: "array", maxItems: 0, items: { type: "string" } },
    },
    required: ["handling", "mode", "text", "claimIds"],
    additionalProperties: false,
  };
  const tailoredResume = {
    type: "object",
    properties: {
      handling: { type: "string", enum: ["TAILOR_FROM_APPROVED_EVIDENCE"] },
      mode: { type: "string", enum: [request.policy.tailoringMode] },
      text: { type: "string", minLength: 1, maxLength: 24_000 },
      claimIds: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: { type: "string", minLength: 1, maxLength: 160 },
      },
    },
    required: ["handling", "mode", "text", "claimIds"],
    additionalProperties: false,
  };

  return {
    type: "object",
    properties: {
      schemaVersion: { type: "integer", enum: [1] },
      inputSnapshotId: { type: "string", enum: [request.source.inputSnapshotId] },
      snapshotHash: { type: "string", enum: [request.source.snapshotHash] },
      target: {
        type: "object",
        properties: {
          employerName: { type: "string", enum: [request.target.employerName] },
          title: { type: "string", enum: [request.target.title] },
        },
        required: ["employerName", "title"],
        additionalProperties: false,
      },
      claims: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: {
          anyOf: [
            claimSchema(
              "CANDIDATE_EVIDENCE",
              ["RESUME", "COVER_LETTER"],
              candidateCitation,
            ),
            claimSchema("JOB_CONTEXT", ["COVER_LETTER"], jobCitation),
            claimSchema("RESEARCH_CONTEXT", ["COVER_LETTER"], researchCitation),
          ],
        },
      },
      resume: request.resume.handling === "PRESERVE_SERVER_SIDE"
        ? preservedResume
        : tailoredResume,
      coverLetter: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 320 },
          paragraphs: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                paragraphId: { type: "string", minLength: 1, maxLength: 160 },
                text: { type: "string", minLength: 1, maxLength: 4_000 },
                claimIds: {
                  type: "array",
                  minItems: 1,
                  maxItems: 64,
                  items: { type: "string", minLength: 1, maxLength: 160 },
                },
              },
              required: ["paragraphId", "text", "claimIds"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "paragraphs"],
        additionalProperties: false,
      },
    },
    required: [
      "schemaVersion",
      "inputSnapshotId",
      "snapshotHash",
      "target",
      "claims",
      "resume",
      "coverLetter",
    ],
    additionalProperties: false,
  };
}

function draftingInstructions(request: ApplicationDraftingRequest): string {
  return [
    "Create one truthful, role-specific application packet from the supplied JSON only.",
    "Candidate evidence is the complete set of permitted candidate claims. Do not infer adjacent skills, dates, titles, metrics, preferences, or personal details.",
    "Job fields may describe the employer and role but may not support a candidate claim.",
    "Approved research claims may describe the employer and role but may not support a candidate claim.",
    "Every material statement must be represented in claims and attached to the relevant resume or cover-letter claimIds. The verifier also checks every factual assertion in the actual resume and each paragraph against only that segment's attached citations.",
    "Attach every source needed for the whole paragraph: a sentence naming employer and role needs those job fields or a description containing both; a paragraph combining candidate record with job relevance needs both candidate and job citations. Do not assume a citation on another paragraph carries over.",
    "Keep each declared claim in exactly one source category. A JOB_CONTEXT claim states only job or employer facts, never what the candidate did or wants. When a sentence connects candidate work to a role requirement, declare separate candidate and job claims and attach both to the paragraph. Do not turn an invitation to discuss into a claim about the candidate's intentions; attach only the factual record and role references used in that invitation.",
    "Do not add a causal bridge or outcome merely because tasks are related. Wording such as this work kept, improved, enabled, or led to requires that exact causal relationship in the evidence. State the supported actions and role requirements plainly when no outcome is supplied.",
    "Claims are surface-specific. A resume claim may appear only in resume.claimIds. A cover-letter claim may appear only in a cover-letter paragraph. If the same evidence supports both documents, create two distinct claim IDs with the correct surface.",
    "Use a candidate-evidence citation for candidate claims, a job-field citation for frozen job context, and a research-claim citation only for an approved research claim.",
    "Never invent a number. Use a number only when it appears verbatim in the supplied job text or approved evidence.",
    "Write in direct, plain language. Remove throat-clearing, empty superlatives, fake enthusiasm, rhetorical questions, and generic AI phrasing.",
    "Do not include an address, phone number, email address, salutation to an invented person, or any fact absent from the input.",
    `Write ${request.policy.minCoverLetterParagraphs}-${request.policy.maxCoverLetterParagraphs} connected cover-letter paragraphs totaling ${request.policy.minCoverLetterWords}-${request.policy.maxCoverLetterWords} words.`,
    `Use at least ${request.policy.minCandidateEvidenceClaimsInCoverLetter} candidate-evidence claim in the cover letter and at least ${request.policy.minRoleContextClaimsInCoverLetter} job or research claim so the letter is both proven and role-specific.`,
    "Name the target employer and role in the cover letter. Use the candidate proof to explain a relevant action, shipped result, or operating judgment rather than repeating generic qualifications.",
    `Keep the resume under ${request.policy.maxResumeWords} words and the cover letter under ${request.policy.maxCoverLetterWords} words.`,
    `Do not use these phrases: ${request.policy.prohibitedPhrases.join(", ")}.`,
    request.resume.handling === "PRESERVE_SERVER_SIDE"
      ? "The server will preserve the original resume. Return the required null resume payload and do not reconstruct it."
      : `Create a concise ATS-readable resume in plain text using only approved evidence. Include standard section labels and at least ${request.policy.minCandidateEvidenceClaimsInTailoredResume} cited candidate-evidence claim. Do not add unsupported section metadata.`,
  ].join("\n");
}

function refusalPresent(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!item || typeof item !== "object") return false;
    const content = (item as { content?: unknown }).content;
    return Array.isArray(content) && content.some((part) => (
      Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "refusal"
    ));
  });
}

function boundedReason(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/[^A-Za-z0-9_.:-]+/gu, "_").slice(0, 120)
    : fallback;
}

export function createOpenAIApplicationDraftingAdapter(
  options: OpenAIDraftingAdapterOptions = {},
): ApplicationDraftingAdapter {
  const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!options.client && !apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");
  const client = options.client ?? new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
  const model = options.model?.trim() || DEFAULT_OPENAI_DRAFTING_MODEL;

  return {
    adapterRelease: OPENAI_DRAFTING_ADAPTER_RELEASE,
    async draft(request, revision?: ApplicationDraftingRevision): Promise<ApplicationDraftingAdapterResult> {
      const writingPolicy = await (options.loadWritingPolicy ?? loadApplicationWritingPolicy)();
      const response = await client.responses.create({
        model,
        store: false,
        reasoning: { effort: "medium" },
        max_output_tokens: 12_000,
        instructions: `${draftingInstructions(request)}\n\n${writingPolicy.instructions}${revision ? "\n\nRevise the supplied previousProposal using the fixed validation issueCodes and measurements. Return a complete replacement proposal in the same schema. The original approved evidence, source restrictions, and word bounds remain authoritative. The previous proposal is a draft, not evidence. Preserve its supported facts and citations; add only relevant detail supported by the original evidence. Aim near targetCoverLetterWords, counting only body paragraphs. A length repair must change the measured length: use relevant source details not yet included and explain their connection to the cited role. Do not merely restate an existing task in another sentence or add padding. Internally count each paragraph and total them before returning. Fix flagged organization or prose without inventing material. Do not include the feedback or diagnostics in the documents." : ""}`,
        input: [{
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(revision ? { ...request, revision } : request) }],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "roledawn_application_drafting_proposal",
            strict: true,
            schema: proposalSchema(request),
          },
        },
      });

      const execution = {
        adapterRelease: OPENAI_DRAFTING_ADAPTER_RELEASE,
        modelRelease: response.model || model,
        requestId: response.id || null,
        writingPolicy: writingPolicy.provenance,
      };
      if (refusalPresent(response.output)) {
        return { status: "REFUSED", reasonCode: "MODEL_REFUSAL", execution };
      }
      if (response.status !== "completed") {
        return {
          status: "INCOMPLETE",
          reasonCode: boundedReason(response.incomplete_details?.reason, "MODEL_RESPONSE_INCOMPLETE"),
          execution,
        };
      }
      if (!response.output_text.trim()) {
        return { status: "INCOMPLETE", reasonCode: "MODEL_OUTPUT_EMPTY", execution };
      }

      let proposal: unknown;
      try {
        proposal = JSON.parse(response.output_text) as unknown;
      } catch {
        return { status: "INCOMPLETE", reasonCode: "MODEL_OUTPUT_NOT_JSON", execution };
      }
      const parsed = parseApplicationDraftingAdapterOutput({
        status: "COMPLETED",
        proposal,
        execution,
      });
      if (!parsed.ok) {
        return { status: "INCOMPLETE", reasonCode: "MODEL_OUTPUT_SCHEMA_INVALID", execution };
      }
      return parsed.value;
    },
  };
}
