import "server-only";

import type { CoverLetterDocumentModel, ResumeDocumentModel } from "@/domain/application-documents";
import type { AnswerKind, DraftingProposalV2, NeedsBrief, ResearchFact } from "@/domain/application-drafting-v2";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ApplicationDocumentsView = Readonly<{
  resume: ResumeDocumentModel;
  coverLetter: CoverLetterDocumentModel;
  answers: readonly Readonly<{ kind: AnswerKind; text: string }>[];
  strategy: DraftingProposalV2["strategy"] | null;
  brief: NeedsBrief | null;
  facts: readonly ResearchFact[];
  quality: Readonly<{ status: string; warnings: readonly string[]; storiesCited: number; researchFactsCited: number }> | null;
  writerModel: string | null;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Reads the exact documents the current packet rendered (application-kit/4).
 * Older packets carry only files; the page then offers downloads alone.
 */
export async function getApplicationDocumentsView(revisionId: string): Promise<ApplicationDocumentsView | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("application_revisions").select("packet_manifest").eq("id", revisionId).maybeSingle();
  if (error || !data) return null;
  const manifest = record(data.packet_manifest);
  if (!manifest || manifest.release !== "application-kit/4") return null;
  const documents = record(manifest.documents);
  const drafting = record(manifest.drafting);
  const validation = record(manifest.validation);
  const resume = record(documents?.resume) as ResumeDocumentModel | null;
  const coverLetter = record(documents?.cover_letter) as CoverLetterDocumentModel | null;
  if (!resume || !coverLetter || !Array.isArray(resume.sections) || !Array.isArray(coverLetter.paragraphs)) return null;
  const proposal = record(drafting?.proposal);
  const quality = record(validation?.quality);
  const measurements = record(quality?.measurements);
  const issues = Array.isArray(quality?.issues) ? quality.issues as { severity?: string; message?: string }[] : [];
  return Object.freeze({
    resume,
    coverLetter,
    answers: Object.freeze((Array.isArray(documents?.answers) ? documents.answers : [])
      .flatMap((entry) => {
        const answer = record(entry);
        return answer && typeof answer.kind === "string" && typeof answer.text === "string"
          ? [Object.freeze({ kind: answer.kind as AnswerKind, text: answer.text })] : [];
      })),
    strategy: (record(proposal?.strategy) as DraftingProposalV2["strategy"] | null) ?? null,
    brief: (record(drafting?.research_brief) as NeedsBrief | null) ?? null,
    facts: Object.freeze((Array.isArray(drafting?.research_facts) ? drafting.research_facts : []) as ResearchFact[]),
    quality: quality ? Object.freeze({
      status: String(quality.status ?? ""),
      warnings: Object.freeze(issues.filter((issue) => issue.severity === "WARNING" && typeof issue.message === "string").map((issue) => issue.message!)),
      storiesCited: Number(measurements?.storiesCited ?? 0),
      researchFactsCited: Number(measurements?.researchFactsCited ?? 0),
    }) : null,
    writerModel: typeof drafting?.model_release === "string" ? drafting.model_release : null,
  });
}
