import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildApplicationDraftingRequest, validateApplicationDraftingProposal } from "../src/domain/application-drafting.ts";
import { ROLEDAWN_APPLICATION_WRITING_POLICY } from "../src/domain/application-writing-policy.ts";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
import { loadApplicationDraftingContext } from "../src/server/applications/drafting-context.ts";
import { createOpenAIApplicationDraftingAdapter } from "../src/server/applications/openai-drafting-adapter.ts";
import { createSupabaseDraftingContextReader } from "../src/server/applications/supabase-drafting-context-reader.ts";

type DraftingLocator = Readonly<{
  inputSnapshotId: string;
  applicationId: string;
  preparationRunId: string;
}>;

function locatorFromPayload(value: unknown): DraftingLocator {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DRAFTING_EVENT_PAYLOAD_INVALID");
  }
  const payload = value as Record<string, unknown>;
  const inputSnapshotId = payload.input_snapshot_id;
  const applicationId = payload.application_id;
  const preparationRunId = payload.preparation_run_id;
  if (
    typeof inputSnapshotId !== "string" || !inputSnapshotId.trim() ||
    typeof applicationId !== "string" || !applicationId.trim() ||
    typeof preparationRunId !== "string" || !preparationRunId.trim()
  ) {
    throw new Error("DRAFTING_EVENT_PAYLOAD_INVALID");
  }
  return {
    inputSnapshotId: inputSnapshotId.trim(),
    applicationId: applicationId.trim(),
    preparationRunId: preparationRunId.trim(),
  };
}

const supabase = createSupabaseAdminClient("live-drafting-acceptance/0.1");
const { data: message, error } = await supabase
  .from("outbox")
  .select("id,payload")
  .eq("topic", "application.drafting_requested")
  .is("published_at", null)
  .is("dead_lettered_at", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (error) throw new Error("DRAFTING_EVENT_READ_FAILED");
if (!message) throw new Error("DRAFTING_EVENT_NOT_FOUND");

const locator = locatorFromPayload(message.payload);
const context = await loadApplicationDraftingContext(
  createSupabaseDraftingContextReader(supabase),
  locator,
);
const request = buildApplicationDraftingRequest(context, ROLEDAWN_APPLICATION_WRITING_POLICY);
const result = await createOpenAIApplicationDraftingAdapter().draft(request);
if (result.status !== "COMPLETED") {
  throw new Error(`DRAFTING_PROVIDER_${result.status}:${result.reasonCode}`);
}

const validation = validateApplicationDraftingProposal(
  context,
  ROLEDAWN_APPLICATION_WRITING_POLICY,
  result.proposal,
);
const output = {
  acceptanceVersion: 1,
  executedAt: new Date().toISOString(),
  outboxMessageId: message.id,
  target: result.proposal.target,
  source: {
    inputSnapshotId: context.source.inputSnapshotId,
    snapshotHash: context.source.snapshotHash,
    approvedNarrativeEvidenceCount: context.approvedNarrativeEvidence.length,
    excludedExactFactCount: context.excludedExactFactCount,
  },
  execution: result.execution,
  validation,
  proposal: result.proposal,
  authority: {
    outboxAcknowledged: false,
    databaseRevisionWritten: false,
    employerFormTouched: false,
    applicationSubmitted: false,
  },
};

const outputDirectory = resolve("artifacts/acceptance");
const outputPath = resolve(outputDirectory, "live-terra-drafting.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });

process.stdout.write(`${JSON.stringify({
  status: "COMPLETED",
  target: output.target,
  model: output.execution.modelRelease,
  deterministicChecksPassed: validation.deterministicChecksPassed,
  semanticEntailmentStatus: validation.semanticEntailmentStatus,
  issueCount: validation.issues.length,
  outputPath,
})}\n`);
