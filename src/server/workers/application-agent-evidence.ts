import { createHash } from "node:crypto";
import OpenAI from "openai";

import { createOpenAIApplicationEntailmentAdapter } from "../applications/openai-entailment-adapter.ts";
import { extractResumeText, type ResumeExtractionInput, type ResumeExtractionResult } from "../resume/extract-resume.ts";
import type { ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";

export type ApplicationAgentEvidenceSource = Readonly<{ sourceId: string; text: string }>;
type ValidationInput = Readonly<{
  question: string;
  text: string;
  sourceIds: readonly string[];
  sources: readonly ApplicationAgentEvidenceSource[];
  signal?: AbortSignal;
}>;

// These are exact candidate decisions, never résumé-derived prose. This check
// is independent of the model's own label/classification of the question.
const EXACT_OR_SENSITIVE = /\b(?:salary|compensation|pay|wage|rate|dates?|months?|years?|citizen\w*|nationality|passport|marital|pregnan\w*|visa|sponsor\w*|authori[sz]\w*|eligible|eligibility|race|ethnic\w*|gender|sex|sexual|pronoun\w*|veteran|disabil\w*|medical|health|age|birth|religion|criminal|conviction|felon\w*|background check|clearance|consent|agree|attest\w*|certif\w*|signature|legal|privacy|terms|relocat\w*|availability|start date|address|phone|email)\b/iu;

export function mayDraftApplicationAnswer(question: string): boolean {
  return question.trim().length > 0 && question.length <= 2000 && !EXACT_OR_SENSITIVE.test(question) &&
    !/\b(?:full|legal|first|last|given|family|your) name\b|^name[\s:*.?]*$/iu.test(question) &&
    !/\bwhen (?:can|could|would|will) you (?:start|begin)\b/iu.test(question);
}

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** Reads only the already-approved, byte-verified output documents; never the live résumé. */
export function createApplicationAgentEvidence(options: Readonly<{
  apiKey?: string;
  model?: string;
  extract?: (input: ResumeExtractionInput) => Promise<ResumeExtractionResult>;
  verify?: (text: string, sources: readonly ApplicationAgentEvidenceSource[], signal?: AbortSignal) => Promise<boolean>;
}> = {}) {
  const extract = options.extract ?? extractResumeText;
  let verifier: ReturnType<typeof createOpenAIApplicationEntailmentAdapter> | undefined;
  return {
    async load(executionPackage: ApplicationFillExecutionPackage): Promise<readonly ApplicationAgentEvidenceSource[]> {
      const sources: ApplicationAgentEvidenceSource[] = [];
      for (const artifact of executionPackage.artifacts) {
        if (artifact.variant !== "RESUME_PDF" && artifact.variant !== "COVER_LETTER_PDF") continue;
        if (artifact.bytes.byteLength !== artifact.byteSize ||
          createHash("sha256").update(artifact.bytes).digest("hex") !== artifact.sha256) {
          throw new Error("APPLICATION_AGENT_EVIDENCE_BYTES_CHANGED");
        }
        const result = await extract({ bytes: artifact.bytes.slice(), filename: artifact.filename, declaredMediaType: artifact.mediaType });
        if (!result.ok) continue;
        let text = result.value.extraction.normalizedText;
        // Exact contact/identity fields remain in the fact tools. Do not send
        // duplicate PII to a narrative model just because it appears in a PDF.
        for (const fact of executionPackage.facts) {
          if (!/^(identity|contact|location)\./u.test(fact.factKey) || fact.value.length < 3) continue;
          const escaped = fact.value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          text = text.replace(new RegExp(escaped, "giu"), "[profile field]");
        }
        const paragraphs = text.split(/\n\s*\n/gu);
        let chunk = "";
        let index = 0;
        for (const paragraph of paragraphs) {
          if (chunk.length + paragraph.length > 12_000 && chunk.trim()) {
            sources.push({ sourceId: `${artifact.artifactVersionId}:${index++}`, text: chunk.trim() });
            chunk = "";
          }
          chunk += `${paragraph.slice(0, 12_000)}\n\n`;
          if (index >= 3) break;
        }
        if (chunk.trim() && index < 3) sources.push({ sourceId: `${artifact.artifactVersionId}:${index}`, text: chunk.trim() });
      }
      return Object.freeze(sources.map(source => Object.freeze(source)));
    },
    async validate(input: ValidationInput): Promise<boolean> {
      if (input.signal?.aborted || !mayDraftApplicationAnswer(input.question) ||
        !input.text.trim() || input.text.length > 6000 || input.sourceIds.length < 1 ||
        input.sourceIds.length > 6 || new Set(input.sourceIds).size !== input.sourceIds.length) return false;
      const sources = input.sourceIds.map(id => input.sources.find(source => source.sourceId === id));
      if (sources.some(source => !source)) return false;
      const cited = sources as ApplicationAgentEvidenceSource[];
      // Even an exact substring can remove a negation or qualifier. Every
      // proposed answer must preserve the meaning of the full cited context.
      const answer = normalize(input.text);
      if (answer.includes("[profile field]")) return false;
      if (options.verify) {
        const accepted = await options.verify(input.text, cited, input.signal);
        return !input.signal?.aborted && accepted;
      }
      verifier ??= createOpenAIApplicationEntailmentAdapter({
        client: new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 25_000 }),
        model: options.model,
      });
      const checked = await verifier.validate({
        schemaRelease: "application-entailment/1",
        claims: [{ claimId: "application-answer", statement: input.text, sources: cited.map(source => ({ sourceKey: source.sourceId, text: source.text })) }],
      });
      if (input.signal?.aborted) return false;
      return checked.result.decisions.length === 1 &&
        checked.result.decisions[0]?.claimId === "application-answer" &&
        checked.result.decisions[0]?.verdict === "ENTAILED";
    },
  };
}
