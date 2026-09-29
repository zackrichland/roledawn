import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../lib/supabase/database.types.ts";
import type {
  ApplicationDraftingContextReader,
  ApplicationDraftingEvidenceVersionRow,
  ApplicationDraftingJobVersionRow,
  ApplicationDraftingResumeReviewRow,
  ApplicationDraftingSnapshotRow,
} from "./drafting-context.ts";

function readFailure(scope: string): Error {
  return new Error(`DRAFTING_CONTEXT_${scope}_READ_FAILED`);
}

/**
 * Service-owned persistence adapter for the immutable drafting-context loader.
 * Every query is bound to IDs supplied by the input snapshot. This adapter has
 * no candidate-fact read and no latest/current lookup.
 */
export function createSupabaseDraftingContextReader(
  supabase: SupabaseClient<Database>,
): ApplicationDraftingContextReader {
  return {
    async readInputSnapshot(locator): Promise<ApplicationDraftingSnapshotRow | null> {
      const { data, error } = await supabase
        .from("application_input_snapshots")
        .select(
          "id,workspace_id,application_id,preparation_run_id,candidate_id,job_id,job_version_id,source_document_id,source_document_version_id,source_text_review_id,readiness,blockers,tailoring_mode,submission_mode,assembler_release,policy_release,snapshot_manifest,snapshot_hash,created_at",
        )
        .eq("id", locator.inputSnapshotId)
        .eq("application_id", locator.applicationId)
        .eq("preparation_run_id", locator.preparationRunId)
        .maybeSingle();
      if (error) throw readFailure("SNAPSHOT");
      if (!data) return null;

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        applicationId: data.application_id,
        preparationRunId: data.preparation_run_id,
        candidateId: data.candidate_id,
        jobId: data.job_id,
        jobVersionId: data.job_version_id,
        sourceDocumentId: data.source_document_id,
        sourceDocumentVersionId: data.source_document_version_id,
        sourceTextReviewId: data.source_text_review_id,
        readiness: data.readiness,
        blockers: data.blockers,
        tailoringMode: data.tailoring_mode,
        submissionMode: data.submission_mode,
        assemblerRelease: data.assembler_release,
        policyRelease: data.policy_release,
        snapshotManifest: data.snapshot_manifest,
        snapshotHash: data.snapshot_hash,
        createdAt: data.created_at,
      };
    },

    async readJobVersion(input): Promise<ApplicationDraftingJobVersionRow | null> {
      const { data, error } = await supabase
        .from("job_versions")
        .select(
          "id,job_id,content_hash,employer_name,title,description_text,location_text,employment_type,work_mode,apply_url",
        )
        .eq("id", input.jobVersionId)
        .eq("job_id", input.jobId)
        .maybeSingle();
      if (error) throw readFailure("JOB");
      if (!data) return null;

      return {
        jobId: data.job_id,
        jobVersionId: data.id,
        contentSha256: data.content_hash,
        employerName: data.employer_name,
        title: data.title,
        description: data.description_text,
        location: data.location_text,
        employmentType: data.employment_type,
        workMode: data.work_mode,
        applyUrl: data.apply_url,
      };
    },

    async readResumeReview(input): Promise<ApplicationDraftingResumeReviewRow | null> {
      const [versionResult, reviewResult] = await Promise.all([
        supabase
          .from("source_document_versions")
          .select("id,workspace_id,candidate_id,document_id,sha256")
          .eq("id", input.documentVersionId)
          .eq("workspace_id", input.workspaceId)
          .eq("candidate_id", input.candidateId)
          .eq("document_id", input.documentId)
          .maybeSingle(),
        supabase
          .from("source_document_text_reviews")
          .select(
            "id,workspace_id,candidate_id,document_id,document_version_id,reviewed_text,text_sha256",
          )
          .eq("id", input.textReviewId)
          .eq("workspace_id", input.workspaceId)
          .eq("candidate_id", input.candidateId)
          .eq("document_id", input.documentId)
          .eq("document_version_id", input.documentVersionId)
          .maybeSingle(),
      ]);
      if (versionResult.error || reviewResult.error) throw readFailure("RESUME");
      if (!versionResult.data || !reviewResult.data) return null;

      return {
        workspaceId: reviewResult.data.workspace_id,
        candidateId: reviewResult.data.candidate_id,
        documentId: reviewResult.data.document_id,
        documentVersionId: reviewResult.data.document_version_id,
        textReviewId: reviewResult.data.id,
        sourceSha256: versionResult.data.sha256,
        reviewedTextSha256: reviewResult.data.text_sha256,
        reviewedText: reviewResult.data.reviewed_text,
      };
    },

    async readEvidenceVersions(input): Promise<readonly ApplicationDraftingEvidenceVersionRow[]> {
      if (input.evidenceVersionIds.length === 0) return [];

      const { data: versions, error: versionsError } = await supabase
        .from("candidate_evidence_versions")
        .select(
          "id,workspace_id,candidate_id,document_id,evidence_item_id,claim_sha256,claim_text,usage_policy,candidate_disposition,reviewed_at",
        )
        .eq("workspace_id", input.workspaceId)
        .eq("candidate_id", input.candidateId)
        .in("id", [...input.evidenceVersionIds]);
      if (versionsError) throw readFailure("EVIDENCE");
      if (versions.length === 0) return [];

      const itemIds = [...new Set(versions.map((version) => version.evidence_item_id))];
      const { data: items, error: itemsError } = await supabase
        .from("candidate_evidence_items")
        .select("id,workspace_id,candidate_id,text_review_id,review_status")
        .eq("workspace_id", input.workspaceId)
        .eq("candidate_id", input.candidateId)
        .in("id", itemIds);
      if (itemsError) throw readFailure("EVIDENCE");

      const itemsById = new Map(items.map((item) => [item.id, item] as const));
      return versions
        .flatMap((version) => {
          const item = itemsById.get(version.evidence_item_id);
          if (!item) return [];
          return [{
            workspaceId: version.workspace_id,
            candidateId: version.candidate_id,
            documentId: version.document_id,
            textReviewId: item.text_review_id,
            evidenceVersionId: version.id,
            claimSha256: version.claim_sha256,
            claimText: version.claim_text,
            usagePolicy: version.usage_policy,
            candidateDisposition: version.candidate_disposition,
            reviewStatus: item.review_status,
            reviewedAt: version.reviewed_at,
          }];
        })
        .sort((left, right) => left.evidenceVersionId.localeCompare(right.evidenceVersionId));
    },
  };
}
