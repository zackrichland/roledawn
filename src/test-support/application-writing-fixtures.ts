import { createHash } from "node:crypto";
import type { ApplicationDraftingContext, ApplicationDraftingProposal } from "../domain/application-drafting.ts";
import { ROLEDAWN_APPLICATION_WRITING_POLICY } from "../domain/application-writing-policy.ts";
import { buildOfficialJobPostingResearch } from "../server/applications/job-posting-research.ts";

export const WRITING_EVAL_PROFESSIONS = ["teacher", "nursing", "finance"] as const;
export type WritingEvalProfession = typeof WRITING_EVAL_PROFESSIONS[number];
const records = {
  teacher: { title: "Science Teacher", employer: "Riverbend School", former: "Community School", degree: "Bachelor of Science in Education",
    need: "plan classroom investigations, assess student work, and collaborate on curriculum",
    work: ["Planned classroom investigations that connected scientific concepts to observations students could record and explain.", "Created assessment rubrics and used student work to adjust lesson sequencing.", "Worked with colleagues to align laboratory activities with curriculum objectives.", "Prepared written laboratory instructions, demonstrated activities, and gave students feedback on their explanations of results."] },
  nursing: { title: "Registered Nurse", employer: "Community Clinic", former: "Neighborhood Care", degree: "Bachelor of Science in Nursing",
    need: "coordinate patient teaching, document observations, and communicate care needs to colleagues",
    work: ["Coordinated discharge teaching with patients and the care team.", "Documented patient observations and escalated changes through established clinical channels.", "Worked with colleagues to keep handoffs clear and follow-up needs visible.", "Prepared patient education materials and checked understanding by asking patients to explain the instructions in their own words."] },
  finance: { title: "Financial Analyst", employer: "Cedar Finance", former: "Regional Services", degree: "Bachelor of Science in Accounting",
    need: "reconcile account balances, explain variances, and work with budget owners",
    work: ["Reconciled monthly account balances and investigated discrepancies against source records.", "Prepared variance explanations for departmental review.", "Worked with budget owners to clarify assumptions and document changes.", "Prepared reporting notes that identified the source records checked and the questions requiring follow-up before a discrepancy could be resolved."] },
} as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Entirely invented test records, never loaded from a candidate database. */
export function applicationWritingFixture(profession: WritingEvalProfession, capturedAt = new Date().toISOString()) {
  const record = records[profession];
  const employment = `Worked as a ${record.title} at ${record.former} from 2022 to 2026.`;
  const education = `Earned a ${record.degree} from Example University in 2022.`;
  // Each approved source explicitly preserves its employer relationship. A
  // detached task alone must not authorize assigning that task to an employer.
  const scopedWork = record.work.map(work => `At ${record.former}, ${work[0].toLocaleLowerCase("en-US")}${work.slice(1)}`);
  const facts = [employment, ...scopedWork, education];
  const description = `${record.employer} is seeking a ${record.title} to ${record.need}.`;
  const sourceText = `EXPERIENCE\n${employment}\n${scopedWork.join("\n")}\nEDUCATION\n${education}`;
  const context: ApplicationDraftingContext = {
    schemaVersion: 1, source: { inputSnapshotId: `synthetic-${profession}-snapshot`, snapshotHash: hash(profession), capturedAt },
    application: { workspaceId: "synthetic-workspace", applicationId: `synthetic-${profession}-application`, candidateId: "synthetic-candidate" },
    policy: { tailoringMode: "REORDER_AND_TIGHTEN", writingPolicyRelease: ROLEDAWN_APPLICATION_WRITING_POLICY.policyRelease, assemblerRelease: "synthetic/1", exactFactsAllowedInNarrativeContext: false },
    job: { jobId: `synthetic-${profession}-job`, jobVersionId: `synthetic-${profession}-version`, contentSha256: hash(description), employerName: record.employer,
      title: record.title, description, location: "Springfield, US", employmentType: "Full-time", workMode: "ONSITE", applyUrl: `https://jobs.example.com/synthetic-${profession}` },
    sourceResume: { documentId: "synthetic-document", documentVersionId: "synthetic-version", textReviewId: "synthetic-review", sourceSha256: hash(sourceText), reviewedTextSha256: hash(sourceText), reviewedText: sourceText },
    approvedNarrativeEvidence: facts.map((claimText, index) => ({ evidenceVersionId: `evidence-${index}`, documentId: "synthetic-document", claimSha256: hash(claimText), claimText, usagePolicy: "RESUME_AND_COVER_LETTER" })), excludedExactFactCount: 2,
  };
  const candidateClaims = facts.flatMap((statement, index) => (["RESUME", "COVER_LETTER"] as const).map(surface => ({ claimId: `${surface}-${index}`, claimType: "CANDIDATE_EVIDENCE" as const, surface, statement, citations: [{ sourceType: "CANDIDATE_EVIDENCE" as const, evidenceVersionId: `evidence-${index}` }] })));
  const letterClaims = candidateClaims.filter(claim => claim.surface === "COVER_LETTER").map(claim => claim.claimId);
  const proposal: ApplicationDraftingProposal = {
    schemaVersion: 1, inputSnapshotId: context.source.inputSnapshotId, snapshotHash: context.source.snapshotHash,
    target: { employerName: record.employer, title: record.title }, claims: [...candidateClaims,
      { claimId: "role", claimType: "JOB_CONTEXT", surface: "COVER_LETTER", statement: description, citations: [{ sourceType: "JOB_FIELD", field: "DESCRIPTION" }] }],
    resume: { handling: "TAILOR_FROM_APPROVED_EVIDENCE", mode: "REORDER_AND_TIGHTEN", text: sourceText, claimIds: candidateClaims.filter(claim => claim.surface === "RESUME").map(claim => claim.claimId) },
    coverLetter: { title: `Application for ${record.title}`, paragraphs: [
      { paragraphId: "opening", claimIds: ["role", ...letterClaims], text: `The ${record.title} role at ${record.employer} calls for someone to ${record.need}. My record includes this work: ${employment} ${record.work[0]} I would welcome the opportunity to discuss how that experience connects to the responsibilities described in your posting.` },
      { paragraphId: "proof", claimIds: letterClaims, text: `${record.work[1]} ${record.work[2]} ${record.work[3]} These are the specific parts of my record I would use as a starting point for a discussion of the work, rather than claiming experience I have not described.` },
      { paragraphId: "closing", claimIds: ["role", ...letterClaims], text: `${education} I welcome a conversation about this record and the ${record.title} role at ${record.employer}. The examples above describe the work I can discuss in detail and the experience I would bring to that conversation.` },
    ] },
  };
  return { context, proposal, research: buildOfficialJobPostingResearch(context, capturedAt), writingPolicy: ROLEDAWN_APPLICATION_WRITING_POLICY };
}
