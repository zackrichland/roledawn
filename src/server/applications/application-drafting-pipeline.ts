import {
  buildApplicationDraftingRequest, parseApplicationDraftingAdapterOutput, validateApplicationDraftingProposal,
  type ApplicationDraftingAdapter, type ApplicationDraftingAdapterResult, type ApplicationDraftingAttemptHistory,
  type ApplicationDraftingContext, type ApplicationDraftingRevision, type ApplicationDraftingWritingPolicy,
} from "../../domain/application-drafting.ts";
import { buildApplicationEntailmentRequest, validateApplicationEntailment } from "../../domain/application-entailment.ts";
import { evaluateApplicationQuality } from "../../domain/application-quality.ts";
import type { BuiltApplicationResearchBundle } from "../../domain/application-research.ts";
import { draftingClaimsFromResearchBundle } from "./job-posting-research.ts";
import type { createOpenAIApplicationEntailmentAdapter } from "./openai-entailment-adapter.ts";

const REPAIRABLE_QUALITY = new Set([
  "COVER_LETTER_LENGTH_OUT_OF_RANGE", "COVER_LETTER_PARAGRAPH_COUNT_OUT_OF_RANGE", "COVER_LETTER_TARGET_MISSING",
  "CANDIDATE_FACING_PLACEHOLDER", "INTERNAL_METADATA_EXPOSED", "RESUME_SECTION_STRUCTURE_WEAK",
  "CEREMONIAL_OPENING", "RHETORICAL_QUESTION", "EM_DASH_DENSITY", "DUPLICATE_COVER_LETTER_PARAGRAPH",
]);
type Attempt = ApplicationDraftingAttemptHistory["attempts"][number];
const wordCount = (text: string) => text.trim().match(/\S+/gu)?.length ?? 0;
const codes = (issues: readonly { code: string }[]) => Object.freeze([...new Set(issues.map(issue => issue.code))].sort());
const history = (attempts: readonly Attempt[]): ApplicationDraftingAttemptHistory => Object.freeze({
  release: "application-drafting-repair/1", attempts: Object.freeze(attempts.map(attempt => Object.freeze({ ...attempt,
    deterministicIssueCodes: Object.freeze([...attempt.deterministicIssueCodes]),
    semanticIssueCodes: Object.freeze([...attempt.semanticIssueCodes]), qualityIssueCodes: Object.freeze([...attempt.qualityIssueCodes]),
  }))),
});

/** No provider text, failed prose, source text, or SDK error body enters this error. */
export class ApplicationDraftingPipelineError extends Error {
  readonly attempts: ApplicationDraftingAttemptHistory;
  readonly retryable: boolean;
  constructor(code: string, attempts: readonly Attempt[], retryable = false) {
    super(`${code}:ATTEMPTS_${attempts.length}`);
    this.name = "ApplicationDraftingPipelineError";
    this.attempts = history(attempts);
    this.retryable = retryable;
  }
}

type Dependencies = Readonly<{
  drafting: ApplicationDraftingAdapter;
  entailment: ReturnType<typeof createOpenAIApplicationEntailmentAdapter>;
}>;
type Input = Readonly<{
  context: ApplicationDraftingContext;
  research: BuiltApplicationResearchBundle;
  writingPolicy: ApplicationDraftingWritingPolicy;
}>;

/** At most two complete proposals. A revision never changes the approved sources or hard gates. */
export async function generateValidatedApplicationDraft(input: Input, dependencies: Dependencies) {
  const researchClaims = draftingClaimsFromResearchBundle(input.research);
  const request = buildApplicationDraftingRequest(input.context, input.writingPolicy, researchClaims);
  const attempts: Attempt[] = [];
  let revision: ApplicationDraftingRevision | undefined;
  for (const attempt of [1, 2] as const) {
    let draft: ApplicationDraftingAdapterResult;
    try {
      const parsed = parseApplicationDraftingAdapterOutput(await dependencies.drafting.draft(request, revision));
      if (!parsed.ok) {
        attempts.push({ attempt, status: "REJECTED", deterministicIssueCodes: ["ADAPTER_OUTPUT_INVALID"], semanticIssueCodes: [], qualityIssueCodes: [] });
        throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_OUTPUT_INVALID", attempts);
      }
      draft = parsed.value;
    } catch (error) {
      if (error instanceof ApplicationDraftingPipelineError) throw error;
      attempts.push({ attempt, status: "ERROR", deterministicIssueCodes: [], semanticIssueCodes: [], qualityIssueCodes: [] });
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_PROVIDER_FAILED", attempts,
        !(error instanceof Error && error.message === "APPLICATION_WRITING_POLICY_LOAD_FAILED"));
    }
    const base = { attempt, deterministicIssueCodes: [] as readonly string[], semanticIssueCodes: [] as readonly string[], qualityIssueCodes: [] as readonly string[],
      ...(draft.execution.writingPolicy ? { policyRelease: draft.execution.writingPolicy.release, policySha256: draft.execution.writingPolicy.sha256 } : {}) };
    if (draft.status !== "COMPLETED") {
      attempts.push({ ...base, status: draft.status });
      throw new ApplicationDraftingPipelineError(`APPLICATION_DRAFTING_${draft.status}`, attempts);
    }
    if (!draft.execution.writingPolicy) {
      attempts.push({ ...base, status: "REJECTED", qualityIssueCodes: ["POLICY_BINDING_MISMATCH"] });
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_POLICY_PROVENANCE_MISSING", attempts);
    }
    const deterministicValidation = validateApplicationDraftingProposal(input.context, input.writingPolicy, draft.proposal, researchClaims);
    const deterministicIssueCodes = codes(deterministicValidation.issues);
    const measured = { ...base, deterministicIssueCodes, coverLetterWords: wordCount(draft.proposal.coverLetter.paragraphs.map(p => p.text).join("\n\n")), coverLetterParagraphs: draft.proposal.coverLetter.paragraphs.length };
    if (deterministicValidation.issues.some(issue => issue.code !== "WRITING_POLICY_VIOLATION")) {
      attempts.push({ ...measured, status: "REJECTED" });
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_FACTUAL_VALIDATION_FAILED", attempts);
    }
    // Even a stylistically invalid first draft must pass evidence checking before it can be revised.
    const entailmentRequest = buildApplicationEntailmentRequest(input.context, draft.proposal, researchClaims);
    let entailment: Awaited<ReturnType<Dependencies["entailment"]["validate"]>>;
    try { entailment = await dependencies.entailment.validate(entailmentRequest); }
    catch (error) {
      attempts.push({ ...measured, status: "ERROR" });
      const permanent = error instanceof Error && ["ENTAILMENT_RESPONSE_INCOMPLETE", "ENTAILMENT_OUTPUT_NOT_JSON", "ENTAILMENT_OUTPUT_INVALID"].includes(error.message);
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_EVIDENCE_PROVIDER_FAILED", attempts, !permanent);
    }
    const semanticValidation = validateApplicationEntailment(entailmentRequest, entailment.result);
    if (!semanticValidation.semanticChecksPassed) {
      attempts.push({ ...measured, status: "REJECTED", semanticIssueCodes: codes(semanticValidation.issues) });
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_SEMANTIC_VALIDATION_FAILED", attempts);
    }
    const qualityValidation = evaluateApplicationQuality({ ...input, proposal: draft.proposal, deterministicValidation, semanticValidation });
    const qualityIssueCodes = codes(qualityValidation.issues);
    const feedbackCodes = [...new Set([...deterministicIssueCodes, ...qualityValidation.issues.filter(issue => REPAIRABLE_QUALITY.has(issue.code)).map(issue => issue.code)])].sort();
    const unrepairable = qualityValidation.issues.some(issue => issue.severity === "BLOCKING" && !REPAIRABLE_QUALITY.has(issue.code)
      && !(issue.code === "SOURCE_VALIDATION_INCOMPLETE" && deterministicIssueCodes.length > 0));
    if (unrepairable) {
      attempts.push({ ...measured, qualityIssueCodes, status: "REJECTED" });
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_QUALITY_VALIDATION_FAILED", attempts);
    }
    if (attempt === 1 && feedbackCodes.length > 0) {
      attempts.push({ ...measured, qualityIssueCodes, status: "REPAIR_REQUESTED" });
      revision = Object.freeze({ previousProposal: draft.proposal, issueCodes: Object.freeze(feedbackCodes),
        measurements: Object.freeze({ coverLetterWords: measured.coverLetterWords, coverLetterParagraphs: measured.coverLetterParagraphs, resumeWords: wordCount(draft.proposal.resume.text ?? "") }),
        targetCoverLetterWords: Math.round((input.writingPolicy.minCoverLetterWords + input.writingPolicy.maxCoverLetterWords) / 2) });
      continue;
    }
    if (!deterministicValidation.deterministicChecksPassed || !qualityValidation.readyForCandidateReview) {
      attempts.push({ ...measured, qualityIssueCodes, status: "REJECTED" });
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_REPAIR_EXHAUSTED", attempts);
    }
    attempts.push({ ...measured, qualityIssueCodes, status: "ACCEPTED" });
    return Object.freeze({ drafting: draft, deterministicValidation, semanticValidation, qualityValidation,
      entailmentExecution: entailment.execution, draftingAttempts: history(attempts) });
  }
  throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_REPAIR_EXHAUSTED", attempts);
}

/** Artifact rendering, staging, and commit are reachable only through a validated result. */
export async function withValidatedApplicationDraft<T>(input: Input, dependencies: Dependencies,
  consume: (result: Awaited<ReturnType<typeof generateValidatedApplicationDraft>>) => Promise<T>): Promise<T> {
  const validated = await generateValidatedApplicationDraft(input, dependencies);
  try { return await consume(validated); }
  catch (error) {
    if (error instanceof Error && /^APPLICATION_ARTIFACT_QA_/u.test(error.message)) {
      throw new ApplicationDraftingPipelineError("APPLICATION_DRAFTING_ARTIFACT_QA_FAILED", validated.draftingAttempts.attempts);
    }
    throw error;
  }
}
