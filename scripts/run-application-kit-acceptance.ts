import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REQUIRED_VARIANTS = [
  "COVER_LETTER_DOCX",
  "COVER_LETTER_PDF",
  "RESUME_DOCX",
  "RESUME_PDF",
] as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeExactFile(filePath: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(filePath, bytes, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const existing = new Uint8Array(await readFile(filePath));
    assert.equal(sha256(existing), sha256(bytes), `Existing acceptance file differs: ${filePath}`);
  }
}

async function exactCount(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: "approval_challenges" | "approval_consumptions" | "application_attempts" | "receipts",
  applicationId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("application_id", applicationId);
  if (error || count === null) throw new Error(`APPLICATION_KIT_ACCEPTANCE_${table.toUpperCase()}_READ_FAILED`);
  return count;
}

const applicationId = process.argv[2]?.trim() ?? "";
if (!UUID_PATTERN.test(applicationId)) {
  throw new Error("Usage: npm run acceptance:kit -- <application-uuid>");
}

const supabase = createSupabaseAdminClient("application-kit-acceptance/1");
const { data: application, error: applicationError } = await supabase
  .from("applications")
  .select("id,status,current_revision_id")
  .eq("id", applicationId)
  .single();
if (applicationError) throw new Error("APPLICATION_KIT_ACCEPTANCE_APPLICATION_READ_FAILED");
assert.equal(application.status, "READY");
assert.ok(application.current_revision_id);

const { data: revision, error: revisionError } = await supabase
  .from("application_revisions")
  .select("id,packet_hash,validation_status,research_bundle_id,input_snapshot_id,packet_manifest")
  .eq("id", application.current_revision_id)
  .eq("application_id", application.id)
  .single();
if (revisionError) throw new Error("APPLICATION_KIT_ACCEPTANCE_REVISION_READ_FAILED");
assert.equal(revision.validation_status, "PASSED");
assert.match(revision.packet_hash, SHA256_PATTERN);

const { data: artifacts, error: artifactError } = await supabase
  .from("artifact_versions")
  .select("id,kind,variant,display_name,storage_bucket,storage_object_path,mime_type,byte_size,sha256,renderer_release,qa_status")
  .eq("application_revision_id", revision.id)
  .order("variant", { ascending: true });
if (artifactError) throw new Error("APPLICATION_KIT_ACCEPTANCE_ARTIFACT_READ_FAILED");
assert.ok(revision.packet_manifest && typeof revision.packet_manifest === "object" && !Array.isArray(revision.packet_manifest));
const kitRelease = revision.packet_manifest.release;
assert.ok(kitRelease === "application-kit/2" || kitRelease === "application-kit/3");
assert.deepEqual(artifacts.map((artifact) => artifact.variant), kitRelease === "application-kit/3"
  ? ["APPLICATION_PDF", ...REQUIRED_VARIANTS] : [...REQUIRED_VARIANTS]);

const outputDirectory = path.resolve("artifacts", "acceptance", "application-kit", revision.packet_hash);
await mkdir(outputDirectory, { recursive: true });
const downloaded: Array<Record<string, unknown>> = [];
for (const artifact of artifacts) {
  assert.equal(artifact.qa_status, "PASSED");
  assert.equal(path.basename(artifact.display_name), artifact.display_name);
  assert.match(artifact.sha256, SHA256_PATTERN);
  const { data: object, error: objectError } = await supabase.storage
    .from(artifact.storage_bucket)
    .download(artifact.storage_object_path);
  if (objectError) throw new Error("APPLICATION_KIT_ACCEPTANCE_STORAGE_READ_FAILED");
  const bytes = new Uint8Array(await object.arrayBuffer());
  assert.equal(bytes.byteLength, artifact.byte_size);
  assert.equal(sha256(bytes), artifact.sha256);
  const filePath = path.join(outputDirectory, artifact.display_name);
  await writeExactFile(filePath, bytes);
  downloaded.push({
    id: artifact.id,
    variant: artifact.variant,
    displayName: artifact.display_name,
    byteSize: artifact.byte_size,
    sha256: artifact.sha256,
    rendererRelease: artifact.renderer_release,
    qaStatus: artifact.qa_status,
    localPath: filePath,
  });
}

const sideEffects = {
  approvalChallenges: await exactCount(supabase, "approval_challenges", applicationId),
  approvalConsumptions: await exactCount(supabase, "approval_consumptions", applicationId),
  applicationAttempts: await exactCount(supabase, "application_attempts", applicationId),
  receipts: await exactCount(supabase, "receipts", applicationId),
};
assert.deepEqual(sideEffects, {
  approvalChallenges: 0,
  approvalConsumptions: 0,
  applicationAttempts: 0,
  receipts: 0,
});

const result = {
  acceptedAt: new Date().toISOString(),
  applicationId,
  inputSnapshotId: revision.input_snapshot_id,
  researchBundleId: revision.research_bundle_id,
  revisionId: revision.id,
  packetHash: revision.packet_hash,
  applicationStatus: application.status,
  revisionValidationStatus: revision.validation_status,
  artifacts: downloaded,
  noSubmitSideEffects: sideEffects,
};
await writeFile(
  path.join(outputDirectory, "acceptance.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(result)}\n`);
