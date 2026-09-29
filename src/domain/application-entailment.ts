import type {
  ApplicationDraftingContext,
  ApplicationDraftingProposal,
  ApplicationDraftingResearchClaim,
} from "./application-drafting.ts";

export const APPLICATION_ENTAILMENT_SCHEMA_RELEASE = "application-entailment/2";

export type ApplicationEntailmentVerdict = "ENTAILED" | "NOT_ENTAILED" | "UNCERTAIN";

export type ApplicationEntailmentRequest = Readonly<{
  schemaRelease: typeof APPLICATION_ENTAILMENT_SCHEMA_RELEASE | "application-entailment/1";
  claims: readonly Readonly<{
    claimId: string;
    kind?: "DOCUMENT_SEGMENT";
    statement: string;
    sources: readonly Readonly<{
      sourceKey: string;
      text: string;
    }>[];
  }>[];
}>;

export type ApplicationEntailmentDecision = Readonly<{
  claimId: string;
  verdict: ApplicationEntailmentVerdict;
  reason: string;
}>;

export type ApplicationEntailmentAdapterResult = Readonly<{
  schemaVersion: 1;
  decisions: readonly ApplicationEntailmentDecision[];
}>;

export type ApplicationSemanticValidationReport = Readonly<{
  semanticChecksPassed: boolean;
  status: "PASSED" | "BLOCKED";
  decisions: readonly ApplicationEntailmentDecision[];
  issues: readonly Readonly<{
    code: "DUPLICATE_DECISION" | "MISSING_DECISION" | "UNKNOWN_DECISION" | "CLAIM_NOT_ENTAILED";
    claimId: string;
    message: string;
  }>[];
}>;

function jobFieldText(
  context: ApplicationDraftingContext,
  field: "EMPLOYER_NAME" | "TITLE" | "LOCATION" | "DESCRIPTION" | "APPLY_URL",
): string {
  switch (field) {
    case "EMPLOYER_NAME": return context.job.employerName;
    case "TITLE": return context.job.title;
    case "LOCATION": return context.job.location ?? "";
    case "DESCRIPTION": return context.job.description;
    case "APPLY_URL": return context.job.applyUrl;
  }
}

export function buildApplicationEntailmentRequest(
  context: ApplicationDraftingContext,
  proposal: ApplicationDraftingProposal,
  researchClaims: readonly ApplicationDraftingResearchClaim[],
): ApplicationEntailmentRequest {
  const evidence = new Map(
    context.approvedNarrativeEvidence.map((item) => [item.evidenceVersionId, item.claimText] as const),
  );
  const research = new Map(
    researchClaims.map((item) => [item.researchClaimId, item.text] as const),
  );

  const sourcesFor = (claim: ApplicationDraftingProposal["claims"][number]) => {
    const sources = new Map<string, Readonly<{ sourceKey: string; text: string }>>();
    for (const citation of claim.citations) {
      if (claim.claimType === "CANDIDATE_EVIDENCE" && citation.sourceType === "CANDIDATE_EVIDENCE") {
        sources.set(`candidate-evidence:${citation.evidenceVersionId}`, Object.freeze({
          sourceKey: `candidate-evidence:${citation.evidenceVersionId}`, text: evidence.get(citation.evidenceVersionId) ?? "",
        }));
      } else if (claim.claimType === "JOB_CONTEXT" && citation.sourceType === "JOB_FIELD") {
        // Job field citations refer to one frozen posting. Resolve its complete
        // context under explicit field keys, so a TITLE reference does not lose
        // the same posting's hiring statement or requirements. Never use this
        // context as candidate evidence.
        for (const field of ["EMPLOYER_NAME", "TITLE", "DESCRIPTION", "LOCATION", "APPLY_URL"] as const) {
          const text = jobFieldText(context, field);
          if (text.trim()) sources.set(`job-field:${field}`, Object.freeze({ sourceKey: `job-field:${field}`, text }));
        }
      } else if (claim.claimType === "RESEARCH_CONTEXT" && citation.sourceType === "RESEARCH_CLAIM") {
        sources.set(`research-claim:${citation.researchClaimId}`, Object.freeze({
          sourceKey: `research-claim:${citation.researchClaimId}`, text: research.get(citation.researchClaimId) ?? "",
        }));
      }
    }
    return [...sources.values()];
  };
  const claims: Array<ApplicationEntailmentRequest["claims"][number]> = proposal.claims.map(claim => Object.freeze({
    claimId: claim.claimId, statement: claim.statement, sources: Object.freeze(sourcesFor(claim)),
  }));
  const byId = new Map(proposal.claims.map(claim => [claim.claimId, claim]));
  const ids = new Set(claims.map(claim => claim.claimId));
  const addSegment = (key: string, text: string, claimIds: readonly string[], surface: "RESUME" | "COVER_LETTER") => {
    let claimId = `document:${key}`;
    for (let suffix = 1; ids.has(claimId); suffix++) claimId = `document:${key}:${suffix}`;
    ids.add(claimId);
    const sources = new Map<string, Readonly<{ sourceKey: string; text: string }>>();
    for (const id of claimIds) {
      const claim = byId.get(id);
      if (!claim || claim.surface !== surface || (surface === "RESUME" && claim.claimType !== "CANDIDATE_EVIDENCE")) continue;
      for (const source of sourcesFor(claim)) sources.set(source.sourceKey, source);
    }
    claims.push(Object.freeze({ claimId, kind: "DOCUMENT_SEGMENT", statement: text,
      sources: Object.freeze([...sources.values()]) }));
  };
  // Check the actual prose, not just the model's list of declared claims. Only
  // the attached citations are available; another paragraph cannot lend evidence.
  if (proposal.resume.handling === "TAILOR_FROM_APPROVED_EVIDENCE") {
    addSegment("resume", proposal.resume.text, proposal.resume.claimIds, "RESUME");
  }
  for (const [index, paragraph] of proposal.coverLetter.paragraphs.entries()) {
    addSegment(`cover-letter:${index}`, paragraph.text, paragraph.claimIds, "COVER_LETTER");
  }
  return Object.freeze({ schemaRelease: APPLICATION_ENTAILMENT_SCHEMA_RELEASE, claims: Object.freeze(claims) });
}

export function validateApplicationEntailment(
  request: ApplicationEntailmentRequest,
  result: ApplicationEntailmentAdapterResult,
): ApplicationSemanticValidationReport {
  const expected = new Set(request.claims.map((claim) => claim.claimId));
  const seen = new Set<string>();
  const issues: Array<ApplicationSemanticValidationReport["issues"][number]> = [];

  for (const decision of result.decisions) {
    if (seen.has(decision.claimId)) {
      issues.push({
        code: "DUPLICATE_DECISION",
        claimId: decision.claimId,
        message: "The entailment adapter returned the claim more than once.",
      });
      continue;
    }
    seen.add(decision.claimId);
    if (!expected.has(decision.claimId)) {
      issues.push({
        code: "UNKNOWN_DECISION",
        claimId: decision.claimId,
        message: "The entailment adapter returned a claim outside the frozen proposal.",
      });
    } else if (decision.verdict !== "ENTAILED") {
      issues.push({
        code: "CLAIM_NOT_ENTAILED",
        claimId: decision.claimId,
        message: decision.verdict === "UNCERTAIN"
          ? "The cited sources do not clearly entail this claim."
          : "The cited sources do not entail this claim.",
      });
    }
  }
  for (const claimId of expected) {
    if (!seen.has(claimId)) {
      issues.push({
        code: "MISSING_DECISION",
        claimId,
        message: "The entailment adapter omitted a generated claim.",
      });
    }
  }

  for (const claim of request.claims) {
    if (claim.sources.length === 0 || claim.sources.some(source => !source.text.trim())) issues.push({
      code: "CLAIM_NOT_ENTAILED", claimId: claim.claimId, message: "A checked claim or document segment has no complete attached source text.",
    });
  }
  const passed = result.schemaVersion === 1 && issues.length === 0;
  return Object.freeze({
    semanticChecksPassed: passed,
    status: passed ? "PASSED" : "BLOCKED",
    decisions: Object.freeze(result.decisions.map((decision) => Object.freeze({ ...decision }))),
    issues: Object.freeze(issues.map((item) => Object.freeze(item))),
  });
}
