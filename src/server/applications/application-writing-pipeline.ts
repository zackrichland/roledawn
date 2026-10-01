import { StructuredResponseError } from "../ai/structured-response.ts";
import { createHash } from "node:crypto";

import {
  proposalSegments,
  validateDraftingProposalV2,
  wordCount,
  type DraftingContextV2,
  type DraftingIssue,
  type DraftingProposalV2,
  type DraftingSource,
  type EmployerResearch,
} from "../../domain/application-drafting-v2.ts";
import {
  evaluateApplicationQualityV2,
  isSalvageableSegment,
  salvageProposal,
  type QualityReportV2,
} from "../../domain/application-quality-v2.ts";
import type { SegmentVerification, VerificationResult, WriterResult } from "./application-writer.ts";

export type StyleLinter = (input: Readonly<{ proposal: DraftingProposalV2; context: DraftingContextV2 }>) => readonly DraftingIssue[];

export type WritingAttempt = Readonly<{
  attempt: number;
  deterministicCodes: readonly string[];
  styleCodes: readonly string[];
  unsupportedSegments: readonly string[];
  coverLetterWords: number;
  outcome: "CLEAN" | "REPAIR_REQUESTED" | "FINAL";
}>;

export type WritingPipelineResult = Readonly<{
  proposal: DraftingProposalV2;
  writer: Readonly<{ model: string; requestId: string | null; policy: WriterResult["policy"] }>;
  verification: Readonly<{ release: string; model: string | null; results: readonly SegmentVerification[] }>;
  quality: QualityReportV2;
  attempts: readonly WritingAttempt[];
}>;

export class ApplicationWritingError extends Error {
  readonly retryable: boolean;
  readonly attempts: readonly WritingAttempt[];
  constructor(code: string, retryable: boolean, attempts: readonly WritingAttempt[] = []) {
    super(code);
    this.name = "ApplicationWritingError";
    this.retryable = retryable;
    this.attempts = attempts;
  }
}

type Dependencies = Readonly<{
  write: (input: Readonly<{ revision?: Readonly<{ previous: DraftingProposalV2; problems: readonly DraftingIssue[] }> }>) => Promise<WriterResult>;
  verify: (segments: ReturnType<typeof proposalSegments>) => Promise<VerificationResult>;
  /**
   * Whether another write-check round fits the run's time budget, given how
   * long the last round took. When it does not, the last complete draft is
   * finished with salvage, exactly as after the final round (D-149).
   */
  canAttemptAgain?: (lastAttemptMs: number) => boolean;
  lintStyle: StyleLinter;
  onAttempt?: (attempt: WritingAttempt) => Promise<void>;
}>;

const TRUTH_CODES = new Set([
  "UNKNOWN_SOURCE", "SOURCE_REQUIRED", "RESUME_EMPLOYER_SOURCE", "RESUME_USE_NOT_ALLOWED",
  "RESUME_CANDIDATE_SOURCE_REQUIRED", "BULLET_WRONG_ROLE", "UNSUPPORTED_NUMBER", "UNKNOWN_POSITION",
]);
export const MAX_WRITING_ATTEMPTS = 3;

function verificationKey(text: string, sourceIds: readonly string[]): string {
  return createHash("sha256").update(`${text}\n${[...sourceIds].sort().join(",")}`).digest("hex");
}

function verificationIssues(results: readonly SegmentVerification[]): DraftingIssue[] {
  return results.filter((result) => result.verdict !== "SUPPORTED").map((result) => Object.freeze({
    code: "UNSUPPORTED_STATEMENT",
    severity: "REPAIR" as const,
    segmentId: result.segmentId,
    message: `Not supported by its sources: ${result.unsupported ?? "part of this text"}. ${result.reason}`,
    fix: "Delete the unsupported words or narrow them to exactly what the cited sources state.",
  }));
}

/**
 * Write, check, and repair one application at most three times, then remove
 * anything in the résumé or answers that still fails verification. A cover
 * letter that still contains an unverified statement blocks the packet.
 */
/**
 * A verifier failure follows the writer's rule: a provider error the model
 * client marks terminal (credit exhaustion, refusal, invalid output) stops
 * writing at once; timeouts and unknown errors retry (D-149).
 */
export function verifierFailure(error: unknown, attempts: readonly WritingAttempt[] = []): ApplicationWritingError {
  const retryable = error instanceof StructuredResponseError ? error.retryable : true;
  return new ApplicationWritingError(error instanceof Error && /^[A-Z][A-Z0-9_]{3,}$/u.test(error.message) ? error.message : "APPLICATION_VERIFIER_FAILED", retryable, attempts);
}

export async function generateApplicationWriting(
  input: Readonly<{ context: DraftingContextV2; research: EmployerResearch; sources: ReadonlyMap<string, DraftingSource>; policyRelease: string }>,
  dependencies: Dependencies,
): Promise<WritingPipelineResult> {
  const attempts: WritingAttempt[] = [];
  const verified = new Map<string, SegmentVerification>();
  let revision: Readonly<{ previous: DraftingProposalV2; problems: readonly DraftingIssue[] }> | undefined;
  let written: WriterResult | null = null;
  let deterministic: readonly DraftingIssue[] = [];
  let style: readonly DraftingIssue[] = [];
  let results: SegmentVerification[] = [];
  let verifierModel: string | null = null;

  for (let attempt = 1; attempt <= MAX_WRITING_ATTEMPTS; attempt += 1) {
    const attemptStarted = Date.now();
    try {
      written = await dependencies.write({ revision });
    } catch (error) {
      if (written) break; // keep the last complete draft and finish with salvage
      const retryable = error instanceof StructuredResponseError ? error.retryable : !(error instanceof Error && /OUTPUT_INVALID|REFUSAL/u.test(error.message));
      throw new ApplicationWritingError(error instanceof Error && /^[A-Z][A-Z0-9_]{3,}$/u.test(error.message) ? error.message : "APPLICATION_WRITER_FAILED", retryable, attempts);
    }
    const proposal = written.proposal;
    deterministic = validateDraftingProposalV2(input.context, input.sources, proposal);
    style = dependencies.lintStyle({ proposal, context: input.context });

    const segments = proposalSegments(proposal);
    const pending = segments.filter((segment) => !verified.has(verificationKey(segment.text, segment.sourceIds)));
    if (pending.length > 0) {
      try {
        const checked = await dependencies.verify(pending);
        verifierModel = checked.model;
        pending.forEach((segment, index) => {
          const result = checked.results[index];
          if (result) verified.set(verificationKey(segment.text, segment.sourceIds), result);
        });
      } catch (error) {
        throw verifierFailure(error, attempts);
      }
    }
    results = segments.map((segment) => {
      const result = verified.get(verificationKey(segment.text, segment.sourceIds));
      return result ? Object.freeze({ ...result, segmentId: segment.segmentId }) : Object.freeze({
        segmentId: segment.segmentId, verdict: "UNCLEAR" as const, unsupported: null, reason: "Not checked.",
      });
    });

    const problems = [
      ...deterministic.filter((problem) => problem.severity !== "WARNING"),
      ...style.filter((problem) => problem.severity !== "WARNING"),
      ...verificationIssues(results),
    ];
    const clean = problems.length === 0;
    const last = attempt === MAX_WRITING_ATTEMPTS || !clean && dependencies.canAttemptAgain?.(Date.now() - attemptStarted) === false;
    attempts.push(Object.freeze({
      attempt,
      deterministicCodes: Object.freeze([...new Set(deterministic.map((problem) => problem.code))].sort()),
      styleCodes: Object.freeze([...new Set(style.map((problem) => problem.code))].sort()),
      unsupportedSegments: Object.freeze(results.filter((result) => result.verdict !== "SUPPORTED").map((result) => result.segmentId)),
      coverLetterWords: wordCount(proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text).join(" ")),
      outcome: clean ? "CLEAN" : last ? "FINAL" : "REPAIR_REQUESTED",
    }));
    await dependencies.onAttempt?.(attempts.at(-1)!).catch(() => undefined);
    if (clean || last) break;
    revision = Object.freeze({ previous: proposal, problems: Object.freeze(problems) });
  }
  if (!written) throw new ApplicationWritingError("APPLICATION_WRITER_FAILED", true, attempts);

  // Salvage: drop résumé lines and answers that still fail truth checks.
  const failing = new Set<string>([
    ...results.filter((result) => result.verdict !== "SUPPORTED" && isSalvageableSegment(result.segmentId)).map((result) => result.segmentId),
    ...deterministic.filter((problem) => TRUTH_CODES.has(problem.code) && problem.segmentId && isSalvageableSegment(problem.segmentId)).map((problem) => problem.segmentId!),
  ]);
  const unsupportedSkills = new Set(deterministic
    .filter((problem) => problem.code === "UNSUPPORTED_SKILL")
    .map((problem) => /"(.+)"/u.exec(problem.message)?.[1])
    .filter((skill): skill is string => Boolean(skill)));
  const finalProposal = failing.size > 0 || unsupportedSkills.size > 0
    ? salvageProposal(written.proposal, failing, unsupportedSkills)
    : written.proposal;
  const finalSegments = new Set(proposalSegments(finalProposal).map((segment) => segment.segmentId));
  const remainingDeterministic = validateDraftingProposalV2(input.context, input.sources, finalProposal);
  const remainingStyle = dependencies.lintStyle({ proposal: finalProposal, context: input.context });
  const unsupportedLetter = results
    .filter((result) => result.verdict !== "SUPPORTED" && result.segmentId.startsWith("letter.") && finalSegments.has(result.segmentId))
    .map((result) => result.segmentId);
  const letterTruthProblems = remainingDeterministic.filter((problem) => TRUTH_CODES.has(problem.code) && problem.segmentId?.startsWith("letter."));

  const quality = evaluateApplicationQualityV2({
    policyRelease: input.policyRelease,
    proposal: finalProposal,
    sources: input.sources,
    research: input.research,
    remainingDeterministic,
    remainingStyle,
    unsupportedLetterSegments: [...new Set([...unsupportedLetter, ...letterTruthProblems.map((problem) => problem.segmentId!)])],
    attempts: attempts.length,
    droppedSegments: failing.size,
  });
  return Object.freeze({
    proposal: finalProposal,
    writer: Object.freeze({ model: written.model, requestId: written.requestId, policy: written.policy }),
    verification: Object.freeze({
      release: "roledawn-verifier/1",
      model: verifierModel,
      results: Object.freeze(results.filter((result) => finalSegments.has(result.segmentId))),
    }),
    quality,
    attempts: Object.freeze(attempts),
  });
}
