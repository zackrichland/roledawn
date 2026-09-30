import type { ApplicationWritingPolicyBundle } from "../../domain/application-writing-policy.ts";
import {
  DRAFTING_PROPOSAL_SCHEMA,
  draftingModelInput,
  parseDraftingProposalV2,
  type DraftingContextV2,
  type DraftingIssue,
  type DraftingProposalV2,
  type DraftingSource,
  type EmployerResearch,
  type ProposalSegment,
} from "../../domain/application-drafting-v2.ts";
import { modelFor } from "../ai/models.ts";
import { structuredResponse } from "../ai/structured-response.ts";
import { loadApplicationWritingPolicy } from "./application-writing-policy-loader.ts";
export const APPLICATION_VERIFIER_RELEASE = "roledawn-verifier/1";

const WRITER_RULES = `You write one job application: the content of a tailored résumé, the body of a cover letter, and up to three short answers for common form questions. Return JSON in the given schema. Follow the owned writing policy below; these hard rules are enforced by the application after you return:

- sourceIds: every headline, summary, bullet, paragraph, and answer lists the exact sourceIds (from the input) that support every statement in it. Candidate sources are "ev:…" (résumé passages) and "st:…" (interview stories). "job" is the posting. "rs:…" is company research.
- Résumé text (headline, summary, bullets) cites only candidate sources whose usage allows the résumé. A bullet cites only sources listed under its own role in candidate.positions. Unassigned sources may support the summary, headline, letter, and answers only.
- Every number in a text must appear, exactly, in that text's cited sources.
- Skills: only items from candidate.skills or the candidate's sources.
- resume.positions: include every positionKey from candidate.positions, most relevant bullets first; an empty bullets array is allowed only when nothing about that role helps this application. Never write employer names, titles, or dates into bullets; the system prints them.
- coverLetter.paragraphs: body paragraphs only; no greeting, sign-off, or signature.
- answers: WHY_COMPANY (why this employer, grounded in the posting or company research and linked to the candidate's work), WHY_ROLE (why this role fits their record), RELEVANT_EXPERIENCE (their single most relevant example as a compact story). 60–150 words each, first person.
- strategy is private reasoning for the candidate's review screen, not part of any document: fill it honestly before writing.
- An independent fact-checker reads every segment against only the sources it lists. Write natural, specific sentences, but assert only what those sources say. The connective reasoning between facts is yours to write; the facts are not.
- tailoringMode AS_UPLOADED: return headline null, summary null, empty bullets for every position, and empty skills; still write the letter and answers.`;

const REVISION_RULES = `This is a revision. The input includes your previous draft and the problems found in it. Return a complete replacement in the same schema.
- Fix every listed problem. Keep everything that was not flagged unless a fix requires changing it.
- For a statement flagged as unsupported, delete the unsupported words or narrow them to exactly what the cited sources say. Never find another way to assert the same unsupported thing.
- For style problems, rewrite the flagged sentence plainly; do not introduce new claims.
- For length problems, add or cut proof from the sources, never filler.`;

export type WriterResult = Readonly<{
  proposal: DraftingProposalV2;
  model: string;
  requestId: string | null;
  policy: ApplicationWritingPolicyBundle["provenance"];
}>;

export async function writeApplicationDraft(input: Readonly<{
  context: DraftingContextV2;
  research: EmployerResearch;
  sources: ReadonlyMap<string, DraftingSource>;
  revision?: Readonly<{ previous: DraftingProposalV2; problems: readonly DraftingIssue[] }>;
  apiKey?: string;
  environment?: NodeJS.ProcessEnv;
  loadPolicy?: () => Promise<ApplicationWritingPolicyBundle>;
}>): Promise<WriterResult> {
  const environment = input.environment ?? process.env;
  const policy = await (input.loadPolicy ?? loadApplicationWritingPolicy)();
  const base = JSON.parse(draftingModelInput(input.context, input.research, input.sources)) as Record<string, unknown>;
  const payload = input.revision
    ? {
        ...base,
        previousDraft: input.revision.previous,
        problems: input.revision.problems.slice(0, 40).map((problem) => ({
          where: problem.segmentId ?? "whole packet",
          problem: problem.message,
          fix: problem.fix,
        })),
      }
    : base;
  const result = await structuredResponse({
    apiKey: input.apiKey ?? environment.OPENAI_API_KEY,
    model: modelFor("DRAFTING", environment),
    instructions: `${WRITER_RULES}${input.revision ? `\n\n${REVISION_RULES}` : ""}\n\n${policy.instructions}`,
    input: JSON.stringify(payload),
    schemaName: "roledawn_application_draft",
    schema: DRAFTING_PROPOSAL_SCHEMA as unknown as Record<string, unknown>,
    reasoningEffort: "medium",
    maxOutputTokens: 16_000,
    timeoutMs: 240_000,
  });
  return Object.freeze({
    proposal: parseDraftingProposalV2(result.value),
    model: result.model,
    requestId: result.requestId,
    policy: policy.provenance,
  });
}

// ---------------------------------------------------------------------------
// Independent verification: each segment against only its listed sources.
// ---------------------------------------------------------------------------

export type VerificationVerdict = "SUPPORTED" | "UNSUPPORTED" | "UNCLEAR";

export type SegmentVerification = Readonly<{
  segmentId: string;
  verdict: VerificationVerdict;
  unsupported: string | null;
  reason: string;
}>;

export type VerificationResult = Readonly<{
  release: typeof APPLICATION_VERIFIER_RELEASE;
  model: string;
  requestId: string | null;
  results: readonly SegmentVerification[];
  passed: boolean;
}>;

const VERIFIER_INSTRUCTIONS = `You are a strict fact-checker for job application materials. For each segment, decide whether everything it asserts is supported by the sources attached to that segment, and only those sources.

- CANDIDATE sources (résumé passages, interview stories) can support statements about the candidate: what they did, where, with whom, how much, and what resulted.
- EMPLOYER sources (the job posting, company research) can support statements about the employer or the role. They never support a statement about the candidate.
- Numbers must match the source exactly. A figure the source marks as an estimate must be hedged ("about", "roughly", "~") in the segment.
- Respect scope: "helped" is not "led", "pitched" is not "sold", a team result is not a solo result, a current responsibility is not a finished outcome.
- A "Do not overstate" line in a story is binding.
- These need no support: first-person voice, section headings, a plain statement of interest in the role, a wish to discuss or show the candidate's cited work ("I'd like to walk you through the dispatch rebuild"), and connective framing that accurately relates the candidate's cited work to the cited role ("that is the same coordination problem, at larger scale"). Judge connective framing only for accuracy of the comparison.
- These always need support: anything the candidate did, owned, built, achieved, or knows; any number; any claim about the employer beyond the posting and research; motives attributed to the employer; promises about future results; availability; qualifications.
- Do not use outside knowledge. Do not reward plausible wording.

Verdicts: SUPPORTED when every assertion is supported; UNSUPPORTED when any assertion conflicts with or goes beyond its sources; UNCLEAR when support is partial or ambiguous. For UNSUPPORTED or UNCLEAR, copy the exact unsupported words into unsupported and give a one-sentence reason. For SUPPORTED, unsupported is null and reason is "Supported.". Return exactly one result per segment.`;

export async function verifyApplicationDraft(input: Readonly<{
  segments: readonly ProposalSegment[];
  sources: ReadonlyMap<string, DraftingSource>;
  apiKey?: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<VerificationResult> {
  const environment = input.environment ?? process.env;
  const segmentIds = input.segments.map((segment) => segment.segmentId);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: segmentIds.length,
        maxItems: segmentIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["segmentId", "verdict", "unsupported", "reason"],
          properties: {
            segmentId: { type: "string", enum: segmentIds },
            verdict: { type: "string", enum: ["SUPPORTED", "UNSUPPORTED", "UNCLEAR"] },
            unsupported: { type: ["string", "null"], maxLength: 600 },
            reason: { type: "string", minLength: 1, maxLength: 400 },
          },
        },
      },
    },
  };
  const request = input.segments.map((segment) => ({
    segmentId: segment.segmentId,
    kind: segment.surface,
    text: segment.text,
    sources: segment.sourceIds.flatMap((id) => {
      const source = input.sources.get(id);
      if (!source) return [];
      const side = source.kind === "RESUME_EVIDENCE" || source.kind === "STORY" ? "CANDIDATE" : "EMPLOYER";
      return [{ id, side, kind: source.kind, text: source.kind === "JOB_POSTING" ? source.text.slice(0, 12_000) : source.text }];
    }),
  }));
  const result = await structuredResponse({
    apiKey: input.apiKey ?? environment.OPENAI_API_KEY,
    model: modelFor("VERIFICATION", environment),
    instructions: VERIFIER_INSTRUCTIONS,
    input: JSON.stringify({ segments: request }),
    schemaName: "roledawn_application_verification",
    schema,
    reasoningEffort: "medium",
    maxOutputTokens: 12_000,
    timeoutMs: 180_000,
  });
  const record = (result.value && typeof result.value === "object" ? result.value : {}) as Record<string, unknown>;
  const byId = new Map<string, SegmentVerification>();
  for (const entry of Array.isArray(record.results) ? record.results : []) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const segmentId = typeof item.segmentId === "string" ? item.segmentId : "";
    if (!segmentIds.includes(segmentId) || byId.has(segmentId)) continue;
    const verdict = item.verdict === "SUPPORTED" || item.verdict === "UNSUPPORTED" ? item.verdict : "UNCLEAR";
    byId.set(segmentId, Object.freeze({
      segmentId,
      verdict,
      unsupported: typeof item.unsupported === "string" && item.unsupported.trim() ? item.unsupported.trim().slice(0, 600) : null,
      reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim().slice(0, 400) : "No reason given.",
    }));
  }
  // A segment with no decision fails closed.
  for (const segment of input.segments) {
    if (!byId.has(segment.segmentId)) {
      byId.set(segment.segmentId, Object.freeze({ segmentId: segment.segmentId, verdict: "UNCLEAR", unsupported: null, reason: "The checker returned no decision." }));
    }
  }
  const results = input.segments.map((segment) => byId.get(segment.segmentId)!);
  return Object.freeze({
    release: APPLICATION_VERIFIER_RELEASE,
    model: result.model,
    requestId: result.requestId,
    results: Object.freeze(results),
    passed: results.every((entry) => entry.verdict === "SUPPORTED"),
  });
}
