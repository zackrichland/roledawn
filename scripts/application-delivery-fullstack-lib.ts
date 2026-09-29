import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { RenderedApplicationKitArtifact } from "../src/server/applications/application-kit-renderer.ts";

export const FULLSTACK_PROJECT = "dxrrotrugwhquqxyoisk";
export const FULLSTACK_RELEASE = "application-delivery-fullstack/1";
export const FULLSTACK_ACKNOWLEDGEMENT = "CREATE_AND_DELETE_ISOLATED_SYNTHETIC_DATA";
export const syntheticHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export type FullstackScope = {
  runId: string; userId: string; workspaceId: string; candidateId: string;
  jobId: string; jobVersionId: string; applicationId: string; runRecordId: string;
  documentId: string; documentVersionId: string; extractionId: string; reviewId: string;
  snapshotId: string; researchId: string; revisionId: string; email: string;
  destinationUrl: string; workspaceName: string;
};
export function createFullstackScope(runId: string = randomUUID()): FullstackScope {
  if (!uuid.test(runId)) throw new Error("FULLSTACK_RUN_ID_INVALID");
  return { runId, userId: randomUUID(), workspaceId: randomUUID(), candidateId: randomUUID(),
    jobId: randomUUID(), jobVersionId: randomUUID(), applicationId: randomUUID(), runRecordId: randomUUID(),
    documentId: randomUUID(), documentVersionId: randomUUID(), extractionId: randomUUID(), reviewId: randomUUID(),
    snapshotId: randomUUID(), researchId: randomUUID(), revisionId: randomUUID(),
    email: `roledawn-delivery-${runId}@acceptance.invalid`, destinationUrl: `https://${runId}.roledawn-acceptance.invalid/step1`,
    workspaceName: `RoleDawn Delivery ${runId} workspace` };
}
export function assertFullstackScope(scope: FullstackScope) {
  for (const [key, value] of Object.entries(scope)) if ((key.endsWith("Id") || key === "runId") && !uuid.test(value)) throw new Error("FULLSTACK_SCOPE_INVALID");
  const expected = createFullstackScope(scope.runId);
  if (scope.email !== expected.email || scope.destinationUrl !== expected.destinationUrl || scope.workspaceName !== expected.workspaceName) throw new Error("FULLSTACK_SCOPE_IDENTITY_MISMATCH");
}
export function requireFullstackEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.RUN_HOSTED_DELIVERY_ACCEPTANCE !== FULLSTACK_ACKNOWLEDGEMENT || environment.ACCEPTANCE_EXPECTED_SUPABASE_PROJECT_REF !== FULLSTACK_PROJECT) throw new Error("FULLSTACK_EXPLICIT_PROJECT_GATE_REQUIRED");
  if (environment.NEXT_PUBLIC_SUPABASE_URL !== `https://${FULLSTACK_PROJECT}.supabase.co`) throw new Error("FULLSTACK_PROJECT_MISMATCH");
  for (const key of ["SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "OPENAI_API_KEY", "BROWSERBASE_API_KEY"]) if (!environment[key]?.trim()) throw new Error(`FULLSTACK_${key}_REQUIRED`);
}
const quote = (value: string) => { if (value.includes("\0")) throw new Error("FULLSTACK_SQL_VALUE_INVALID"); return `'${value.replaceAll("'", "''")}'`; };
const literal = (value: unknown): string => value === null ? "null" : typeof value === "number" ? String(value) : typeof value === "boolean" ? String(value) : typeof value === "string" ? quote(value) : `${quote(JSON.stringify(value))}::jsonb`;
const insert = (table: string, row: Record<string, unknown>) => `insert into public.${table} (${Object.keys(row).join(",")}) values (${Object.values(row).map(literal).join(",")});`;
function assertOwnerSql(scope: FullstackScope) {
  return `if not exists(select 1 from auth.users where id=${quote(scope.userId)} and email=${quote(scope.email)} and raw_app_meta_data->>'roledawn_delivery_acceptance_run_id'=${quote(scope.runId)}) then raise exception 'FULLSTACK_AUTH_IDENTITY_MISMATCH'; end if;
if exists(select 1 from public.workspaces where id=${quote(scope.workspaceId)} and (name<>${quote(scope.workspaceName)} or personal_owner_auth_user_id is distinct from ${quote(scope.userId)}::uuid)) then raise exception 'FULLSTACK_WORKSPACE_IDENTITY_MISMATCH'; end if;`;
}
export function buildFullstackSeedSql(input: { scope: FullstackScope; text: string; sourcePath: string; sourceArtifact: RenderedApplicationKitArtifact; artifacts: readonly (RenderedApplicationKitArtifact & { id: string; path: string })[]; factVersionIds: readonly string[]; writingPolicy: unknown }) {
  const { scope: s } = input; assertFullstackScope(s);
  if (input.factVersionIds.some((id) => !uuid.test(id)) || input.artifacts.length !== 5) throw new Error("FULLSTACK_SEED_INPUT_INVALID");
  const scoped = { workspace_id: s.workspaceId, candidate_id: s.candidateId };
  const snapshotHash = syntheticHash(JSON.stringify({ release: FULLSTACK_RELEASE, runId: s.runId, text: input.text }));
  const researchHash = syntheticHash(`Synthetic research ${s.runId}`);
  const packetManifest = { release: "application-kit/3", synthetic_acceptance: { release: FULLSTACK_RELEASE, runId: s.runId, drafting_quality_stub: true },
    authority: { state: "CANDIDATE_REVIEW_REQUIRED", application_submitted: false },
    drafting: { writing_policy_release: "roledawn-writing-policy/2", writing_policy: input.writingPolicy },
    validation: { quality: { policyRelease: "roledawn-writing-policy/2", evaluatorRelease: "roledawn-application-quality-evaluator/1", readyForCandidateReview: true, status: "PASSED", measurements: { syntheticFixture: true }, issues: [] } },
    artifacts: input.artifacts.map((artifact) => ({ variant: artifact.variant, sha256: artifact.sha256 })) };
  const packetHash = syntheticHash(JSON.stringify(packetManifest));
  const statements = [
    "begin;", `do $guard$ begin ${assertOwnerSql(s)}
      if exists(select 1 from public.applications where workspace_id=${quote(s.workspaceId)}) then raise exception 'FULLSTACK_NONEMPTY_WORKSPACE'; end if;
      if exists(select 1 from public.jobs where id=${quote(s.jobId)}) then raise exception 'FULLSTACK_JOB_ALREADY_EXISTS'; end if;
    end $guard$;`,
    insert("jobs", { id: s.jobId, canonical_url: s.destinationUrl, state: "CLOSED" }),
    insert("job_versions", { id: s.jobVersionId, job_id: s.jobId, version_number: 1, content_hash: syntheticHash(s.destinationUrl), title: "Synthetic delivery acceptance", employer_name: "RoleDawn Synthetic Fixture", description_text: "Synthetic worker test only. No employer exists and no employer submission is permitted.", apply_url: s.destinationUrl, observed_at: new Date().toISOString(), normalized_data: { synthetic: true, acceptanceRunId: s.runId } }),
    insert("source_documents", { id: s.documentId, ...scoped, document_kind: "RESUME", display_name: "Synthetic acceptance resume.pdf", status: "READY", current_version_number: 1 }),
    insert("source_document_versions", { id: s.documentVersionId, ...scoped, document_id: s.documentId, version_number: 1, storage_bucket: "career-vault", storage_object_path: input.sourcePath, mime_type: input.sourceArtifact.mimeType, byte_size: input.sourceArtifact.byteSize, sha256: input.sourceArtifact.sha256, scan_status: "CLEAN", parser_release: FULLSTACK_RELEASE, created_by: s.userId }),
    insert("source_document_extractions", { id: s.extractionId, ...scoped, document_id: s.documentId, document_version_id: s.documentVersionId, attempt_number: 1, status: "SUCCEEDED", extractor_kind: "LOCAL_DETERMINISTIC", extractor_release: FULLSTACK_RELEASE, output_schema_version: FULLSTACK_RELEASE, source_sha256: input.sourceArtifact.sha256, extracted_text: input.text, text_sha256: syntheticHash(input.text), page_count: 1, resulting_document_status: "READY", document_aggregate_version: 1, started_at: new Date().toISOString() }),
    insert("source_document_text_reviews", { id: s.reviewId, ...scoped, document_id: s.documentId, document_version_id: s.documentVersionId, extraction_id: s.extractionId, document_aggregate_version: 1, review_version_number: 1, reviewed_text: input.text, text_sha256: syntheticHash(input.text), created_by: s.userId }),
    insert("applications", { id: s.applicationId, ...scoped, job_id: s.jobId, job_version_id: s.jobVersionId, status: "READY", aggregate_version: 1 }),
    insert("application_runs", { id: s.runRecordId, workspace_id: s.workspaceId, application_id: s.applicationId, run_kind: "PREPARATION", status: "SUCCEEDED", preparation_stage: "COMPLETE" }),
    insert("application_input_snapshots", { id: s.snapshotId, ...scoped, application_id: s.applicationId, preparation_run_id: s.runRecordId, job_id: s.jobId, job_version_id: s.jobVersionId, source_document_id: s.documentId, source_document_version_id: s.documentVersionId, source_text_review_id: s.reviewId, tailoring_mode: "REORDER_AND_TIGHTEN", submission_mode: "PER_APPLICATION_APPROVAL", readiness: "READY_FOR_DRAFTING", snapshot_manifest: { syntheticAcceptanceRunId: s.runId }, snapshot_hash: snapshotHash, candidate_input_version: 1, policy_release: FULLSTACK_RELEASE, assembler_release: FULLSTACK_RELEASE }).replace(",1," + quote(FULLSTACK_RELEASE), `,(select application_input_version from public.candidates where id=${quote(s.candidateId)}),${quote(FULLSTACK_RELEASE)}`),
    insert("application_research_bundles", { id: s.researchId, ...scoped, application_id: s.applicationId, input_snapshot_id: s.snapshotId, input_snapshot_hash: snapshotHash, bundle_manifest: { syntheticAcceptanceRunId: s.runId }, bundle_hash: researchHash, researcher_release: FULLSTACK_RELEASE, freshness_policy_release: FULLSTACK_RELEASE, freshness_expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
    insert("application_revisions", { id: s.revisionId, workspace_id: s.workspaceId, application_id: s.applicationId, version_number: 1, job_version_id: s.jobVersionId, packet_manifest: packetManifest, material_diff: { syntheticAcceptanceRunId: s.runId }, packet_hash: packetHash, validation_status: "PASSED", input_snapshot_id: s.snapshotId, input_snapshot_hash: snapshotHash, research_bundle_id: s.researchId, research_bundle_hash: researchHash }),
    ...input.factVersionIds.map((id) => insert("application_snapshot_fact_refs", { ...scoped, application_id: s.applicationId, input_snapshot_id: s.snapshotId, fact_version_id: id })),
    ...input.artifacts.map((artifact) => insert("artifact_versions", { id: artifact.id, workspace_id: s.workspaceId, application_revision_id: s.revisionId, kind: artifact.kind, variant: artifact.variant, display_name: artifact.displayName, storage_bucket: "application-artifacts", storage_object_path: artifact.path, mime_type: artifact.mimeType, byte_size: artifact.byteSize, sha256: artifact.sha256, renderer_release: artifact.rendererRelease, qa_status: "PASSED" })),
    `update public.applications set current_revision_id=${quote(s.revisionId)} where id=${quote(s.applicationId)} and workspace_id=${quote(s.workspaceId)};`,
    "commit;", "select true as synthetic_seed_created;",
  ];
  return { sql: statements.join("\n"), packetHash };
}
export function buildFullstackCleanupSql(s: FullstackScope) {
  assertFullstackScope(s);
  return `begin;
do $guard$ begin
${assertOwnerSql(s)}
if exists(select 1 from public.applications where workspace_id=${quote(s.workspaceId)} and id<>${quote(s.applicationId)}) then raise exception 'FULLSTACK_UNKNOWN_APPLICATION'; end if;
if exists(select 1 from public.applications where job_id=${quote(s.jobId)} and workspace_id<>${quote(s.workspaceId)}) then raise exception 'FULLSTACK_JOB_REFERENCED_ELSEWHERE'; end if;
if exists(select 1 from public.jobs where id=${quote(s.jobId)} and canonical_url<>${quote(s.destinationUrl)}) then raise exception 'FULLSTACK_JOB_IDENTITY_MISMATCH'; end if;
if exists(select 1 from public.job_versions where job_id=${quote(s.jobId)} and (id<>${quote(s.jobVersionId)} or normalized_data->>'acceptanceRunId' is distinct from ${quote(s.runId)})) then raise exception 'FULLSTACK_JOB_VERSION_MISMATCH'; end if;
if exists(select 1 from private.application_autopilot_resources r join public.application_autopilots a on a.id=r.autopilot_id where a.workspace_id=${quote(s.workspaceId)} and r.deleted_at is null) then raise exception 'FULLSTACK_PROVIDER_CLEANUP_REQUIRED'; end if;
if exists(select 1 from storage.objects where bucket_id in ('career-vault','application-artifacts') and name like ${quote(s.workspaceId + "/%")}) then raise exception 'FULLSTACK_STORAGE_CLEANUP_REQUIRED'; end if;
end $guard$;
delete from public.application_autopilots where application_id=${quote(s.applicationId)} and workspace_id=${quote(s.workspaceId)};
-- The receipt and attempt are exact synthetic records whose restrictive FKs
-- require explicit order; disable their immutable triggers only in this transaction.
set local session_replication_role=replica;
delete from public.receipts where application_id=${quote(s.applicationId)} and workspace_id=${quote(s.workspaceId)};
delete from public.application_attempts where application_id=${quote(s.applicationId)} and workspace_id=${quote(s.workspaceId)};
delete from public.approval_consumptions where application_id=${quote(s.applicationId)} and workspace_id=${quote(s.workspaceId)};
delete from public.approval_challenges where application_id=${quote(s.applicationId)} and workspace_id=${quote(s.workspaceId)};
set local session_replication_role=origin;
delete from public.applications where id=${quote(s.applicationId)} and workspace_id=${quote(s.workspaceId)};
update public.source_documents set status='DELETION_PENDING' where id=${quote(s.documentId)} and workspace_id=${quote(s.workspaceId)} and candidate_id=${quote(s.candidateId)};
set local role service_role;
select public.complete_source_document_deletion(${quote(s.documentId)}::uuid) where exists(select 1 from public.source_documents where id=${quote(s.documentId)} and workspace_id=${quote(s.workspaceId)});
delete from public.workspaces where id=${quote(s.workspaceId)} and personal_owner_auth_user_id=${quote(s.userId)} and name=${quote(s.workspaceName)};
reset role;
-- Only the known standalone synthetic catalog rows need this transaction-local
-- append-only exception. No table trigger or global setting is changed.
set local session_replication_role=replica;
delete from public.job_versions where id=${quote(s.jobVersionId)} and job_id=${quote(s.jobId)} and normalized_data->>'acceptanceRunId'=${quote(s.runId)};
delete from public.jobs where id=${quote(s.jobId)} and canonical_url=${quote(s.destinationUrl)};
set local session_replication_role=origin;
commit;
select not exists(select 1 from public.workspaces where id=${quote(s.workspaceId)}) and not exists(select 1 from public.jobs where id=${quote(s.jobId)}) and not exists(select 1 from public.applications where id=${quote(s.applicationId)}) as synthetic_database_rows_deleted;`;
}
/** Read-only absence proof for the exact isolated scope after successful cleanup. */
export function buildFullstackCleanupVerificationSql(s: FullstackScope) {
  assertFullstackScope(s);
  const counts = [
    ["auth_users", `select count(*) from auth.users where id=${quote(s.userId)}`],
    ["workspaces", `select count(*) from public.workspaces where id=${quote(s.workspaceId)}`],
    ["jobs", `select count(*) from public.jobs where id=${quote(s.jobId)}`],
    ["job_versions", `select count(*) from public.job_versions where job_id=${quote(s.jobId)}`],
    ...["candidates", "candidate_facts", "candidate_fact_versions", "applications", "application_revisions", "application_autopilots", "approval_challenges", "approval_consumptions", "application_attempts", "receipts", "source_documents", "source_document_versions", "artifact_versions", "application_input_snapshots", "domain_events"].map((table) => [table, `select count(*) from public.${table} where workspace_id=${quote(s.workspaceId)}`]),
    ["storage_objects", `select count(*) from storage.objects where bucket_id in ('career-vault','application-artifacts') and name like ${quote(s.workspaceId + "/%")}`],
  ];
  return `select ${counts.map(([name, sql]) => `(${sql}) as ${name}`).join(",")};`;
}
export function buildFullstackResourcesSql(s: FullstackScope) {
  assertFullstackScope(s);
  return `select r.id,r.kind,r.reference,r.deleted_at from private.application_autopilot_resources r join public.application_autopilots a on a.id=r.autopilot_id where a.workspace_id=${quote(s.workspaceId)} and a.application_id=${quote(s.applicationId)};`;
}
export async function executeFullstackSql(sql: string, path: string): Promise<Record<string, unknown>[]> {
  if ((await readFile(resolve("supabase/.temp/project-ref"), "utf8")).trim() !== FULLSTACK_PROJECT) throw new Error("FULLSTACK_LINKED_PROJECT_MISMATCH");
  await writeFile(path, sql, { mode: 0o600 });
  try {
    const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["db", "query", "--linked", "--file", path, "--output", "json"], { timeout: 60_000, maxBuffer: 1_000_000 });
    const parsed = JSON.parse(stdout) as { rows?: Record<string, unknown>[] };
    if (!Array.isArray(parsed.rows)) throw new Error("FULLSTACK_SQL_PROTOCOL_INVALID");
    return parsed.rows;
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    throw new Error(stderr.match(/(?:FULLSTACK|APPLICATION|SOURCE|RESEARCH)_[A-Z_]+/u)?.[0] ?? "FULLSTACK_SQL_EXECUTION_FAILED");
  }
}
