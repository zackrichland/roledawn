import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import Browserbase from "@browserbasehq/sdk";

import {
  candidateFactDefinition,
  isCandidateFactKey,
  type CandidateFactKey,
} from "../src/domain/candidate-profile.ts";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
import type { Json } from "../src/lib/supabase/database.types.ts";
import type {
  ComputerRuntimeProvisionRequest,
  ProvisionedComputerRuntime,
} from "../src/server/workers/application-fill.ts";
import {
  eraseApplicationFillExecutionPackage,
  type ApplicationFillExecutionPackage,
  type MaterializedApplicationArtifact,
  type MaterializedApplicationFact,
} from "../src/server/workers/application-fill-materializer.ts";
import { createBrowserbaseRuntimeAdapterForNodeWorker } from
  "../src/server/workers/browserbase-runtime.node.ts";
import {
  browserbaseRuntimePage,
  parseBrowserbaseRuntimeEnvironment,
} from "../src/server/workers/browserbase-runtime.ts";
import { createGreenhouseNoSubmitDriver } from
  "../src/server/workers/greenhouse-no-submit-driver.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ARTIFACT_BUCKET = "application-artifacts";
const START_URL = "https://example.com/";
const ACCEPTED_FACT_KEYS = new Set<CandidateFactKey>([
  "identity.given_name",
  "identity.family_name",
  "identity.legal_name",
  "contact.application_email",
  "contact.phone",
  "contact.linkedin_url",
  "contact.website_url",
  "location.city",
  "location.region",
  "location.country_code",
  "work_authorization.us.authorized",
  "work_authorization.us.sponsorship_required",
  "work_authorization.ca.authorized",
  "work_authorization.ca.sponsorship_required",
]);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredUuid(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!UUID_PATTERN.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function databaseError(error: Readonly<{ message?: string; code?: string }> | null, code: string): never {
  const serverCode = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] ?? error?.code;
  throw new Error(serverCode ?? code);
}

function fixtureHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Controlled Greenhouse acceptance</title></head>
<body><main><h1>Controlled application form</h1>
  <form>
    <label>First name <input name="first_name" autocomplete="given-name"></label>
    <label>Last name <input name="last_name" autocomplete="family-name"></label>
    <label>Full legal name <input name="full_name" autocomplete="name" aria-required="true"></label>
    <label>Email <input name="email" type="email" autocomplete="email"></label>
    <label>Phone <input name="phone" type="tel" autocomplete="tel"></label>
    <label>LinkedIn <input name="linkedin_url" type="url"></label>
    <label>Website <input name="website_url" type="url"></label>
    <label>City <input name="city" autocomplete="address-level2"></label>
    <label>State or region <input name="region" autocomplete="address-level1"></label>
    <label>Country <select name="country" autocomplete="country"><option value="">Choose one</option><option value="US">United States</option><option value="CA">Canada</option></select></label>
    <label>Résumé <input name="resume" type="file" accept="application/pdf" aria-required="true"></label>
    <label>Cover letter <input name="cover_letter" type="file" accept="application/pdf"></label>
    <label>Gender (optional) <select name="gender"><option value="">Prefer not to answer</option><option value="female">Female</option><option value="male">Male</option></select></label>
    <button type="submit">Submit application</button>
  </form>
</main></body></html>`;
}

if (process.env.RUN_GREENHOUSE_BROWSERBASE_ACCEPTANCE !== "true") {
  throw new Error("GREENHOUSE_BROWSERBASE_ACCEPTANCE_NOT_AUTHORIZED");
}

const applicationId = requiredUuid("ACCEPTANCE_APPLICATION_ID");
const supabase = createSupabaseAdminClient("greenhouse-browserbase-acceptance/1");
const { data: application, error: applicationError } = await supabase
  .from("applications")
  .select("id,workspace_id,candidate_id,current_revision_id,status")
  .eq("id", applicationId)
  .maybeSingle();
if (applicationError) databaseError(applicationError, "ACCEPTANCE_APPLICATION_READ_FAILED");
if (!application || application.status !== "READY" || !application.current_revision_id) {
  throw new Error("ACCEPTANCE_APPLICATION_NOT_READY");
}

const { data: revision, error: revisionError } = await supabase
  .from("application_revisions")
  .select("id,input_snapshot_id,packet_hash,validation_status")
  .eq("workspace_id", application.workspace_id)
  .eq("application_id", application.id)
  .eq("id", application.current_revision_id)
  .maybeSingle();
if (revisionError) databaseError(revisionError, "ACCEPTANCE_REVISION_READ_FAILED");
if (!revision || revision.validation_status !== "PASSED" || !SHA256_PATTERN.test(revision.packet_hash)) {
  throw new Error("ACCEPTANCE_REVISION_NOT_VALIDATED");
}

const { data: artifactRows, error: artifactError } = await supabase
  .from("artifact_versions")
  .select("id,variant,mime_type,byte_size,sha256,qa_status,storage_bucket,storage_object_path")
  .eq("workspace_id", application.workspace_id)
  .eq("application_revision_id", revision.id)
  .in("variant", ["RESUME_PDF", "COVER_LETTER_PDF"]);
if (artifactError) databaseError(artifactError, "ACCEPTANCE_ARTIFACT_READ_FAILED");
if (artifactRows.length !== 2) throw new Error("ACCEPTANCE_PDF_ARTIFACT_SET_INVALID");

const artifacts: MaterializedApplicationArtifact[] = [];
for (const row of artifactRows.sort((left, right) => left.variant.localeCompare(right.variant))) {
  if (
    (row.variant !== "RESUME_PDF" && row.variant !== "COVER_LETTER_PDF") ||
    row.mime_type !== "application/pdf" || row.qa_status !== "PASSED" ||
    row.storage_bucket !== ARTIFACT_BUCKET || !SHA256_PATTERN.test(row.sha256) ||
    row.byte_size < 1 || row.byte_size > 10 * 1024 * 1024
  ) throw new Error("ACCEPTANCE_PDF_ARTIFACT_POLICY_INVALID");
  const download = await supabase.storage
    .from(ARTIFACT_BUCKET)
    .download(row.storage_object_path, {}, { cache: "no-store" });
  if (download.error) databaseError(download.error, "ACCEPTANCE_ARTIFACT_DOWNLOAD_FAILED");
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (bytes.byteLength !== row.byte_size || sha256(bytes) !== row.sha256) {
    bytes.fill(0);
    throw new Error("ACCEPTANCE_ARTIFACT_INTEGRITY_FAILED");
  }
  artifacts.push(Object.freeze({
    artifactVersionId: row.id,
    variant: row.variant,
    filename: row.variant === "RESUME_PDF" ? "resume.pdf" : "cover-letter.pdf",
    mediaType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    bytes,
  }));
}

const { data: refs, error: refsError } = await supabase
  .from("application_snapshot_fact_refs")
  .select("fact_version_id")
  .eq("workspace_id", application.workspace_id)
  .eq("candidate_id", application.candidate_id)
  .eq("application_id", application.id)
  .eq("input_snapshot_id", revision.input_snapshot_id);
if (refsError) databaseError(refsError, "ACCEPTANCE_FACT_REFS_READ_FAILED");
const factVersionIds = refs.map((ref) => ref.fact_version_id);
const { data: versionRows, error: versionsError } = factVersionIds.length === 0
  ? { data: [], error: null }
  : await supabase
      .from("candidate_fact_versions")
      .select("id,fact_id,value_json,normalized_text,candidate_disposition,reviewed_at")
      .eq("workspace_id", application.workspace_id)
      .eq("candidate_id", application.candidate_id)
      .in("id", factVersionIds);
if (versionsError) databaseError(versionsError, "ACCEPTANCE_FACT_VERSIONS_READ_FAILED");
const factIds = [...new Set(versionRows.map((row) => row.fact_id))];
const { data: factRows, error: factsError } = factIds.length === 0
  ? { data: [], error: null }
  : await supabase
      .from("candidate_facts")
      .select("id,fact_key,sensitivity,usage_policy,verification_status")
      .eq("workspace_id", application.workspace_id)
      .eq("candidate_id", application.candidate_id)
      .in("id", factIds);
if (factsError) databaseError(factsError, "ACCEPTANCE_FACTS_READ_FAILED");
const definitionById = new Map(factRows.map((row) => [row.id, row] as const));
const facts: MaterializedApplicationFact[] = [];
for (const row of versionRows) {
  const definition = definitionById.get(row.fact_id);
  if (!definition || !isCandidateFactKey(definition.fact_key) || !ACCEPTED_FACT_KEYS.has(definition.fact_key)) continue;
  const canonicalDefinition = candidateFactDefinition(definition.fact_key);
  const exactWorkAuthorization = definition.fact_key.startsWith("work_authorization.");
  if (
    definition.usage_policy !== "EXACT_FIELDS" ||
    definition.sensitivity !== canonicalDefinition.sensitivity ||
    definition.verification_status !== "VERIFIED" ||
    row.candidate_disposition !== "APPROVED" || !row.reviewed_at
  ) continue;
  const value = exactWorkAuthorization && typeof row.value_json === "boolean"
    ? row.value_json ? "Yes" : "No"
    : typeof row.value_json === "string" ? row.value_json : null;
  if (!value || row.normalized_text !== value) continue;
  facts.push(Object.freeze({
    factVersionId: row.id,
    factKey: definition.fact_key,
    value,
    valueHash: sha256(JSON.stringify(row.value_json)),
  }));
}
facts.sort((left, right) => left.factKey.localeCompare(right.factKey));
if (!facts.some((fact) => fact.factKey === "identity.legal_name")) {
  throw new Error("ACCEPTANCE_FULL_LEGAL_NAME_FACT_MISSING");
}

const ids = Object.freeze({
  workspaceId: application.workspace_id,
  candidateId: application.candidate_id,
  applicationId: application.id,
  revisionId: revision.id,
  fillAttemptId: randomUUID(),
  computerSessionId: randomUUID(),
});
const executionPackage: ApplicationFillExecutionPackage = Object.freeze({
  schemaRelease: "application-fill-execution-package/1" as const,
  authorityScope: "FILL_ONLY_NO_SUBMIT" as const,
  binding: ids,
  destinationUrl: START_URL,
  facts: Object.freeze(facts),
  artifacts: Object.freeze(artifacts),
  submitAuthorized: false as const,
});
const request: ComputerRuntimeProvisionRequest = Object.freeze({
  idempotencyKey: ids.computerSessionId,
  binding: ids,
  startUrl: START_URL,
  allowedOrigins: Object.freeze([new URL(START_URL).origin]),
  ttlSeconds: 120,
  executionMode: "EPHEMERAL_CLEAN" as const,
  browserProfileRef: null,
  artifactManifest: artifacts.map((artifact) => ({
    artifact_version_id: artifact.artifactVersionId,
    variant: artifact.variant,
    byte_size: artifact.byteSize,
    sha256: artifact.sha256,
  })) satisfies Json,
  artifactPayloads: executionPackage.artifacts,
  submissionGuard: Object.freeze({
    submitAuthorized: false as const,
    outboundSubmissionRequests: "BLOCK" as const,
  }),
});

const environment = parseBrowserbaseRuntimeEnvironment(process.env);
const browserbase = new Browserbase({ apiKey: environment.apiKey, maxRetries: 0, timeout: environment.apiTimeoutMs });
const runtimeAdapter = await createBrowserbaseRuntimeAdapterForNodeWorker(process.env);
let runtime: ProvisionedComputerRuntime | null = null;
let providerSessionRef: string | null = null;
try {
  runtime = await runtimeAdapter.provision(request);
  providerSessionRef = runtime.providerSessionRef;
  const page = browserbaseRuntimePage(runtime.handle);
  await page.setContent(fixtureHtml(), { waitUntil: "domcontentloaded" });
  const result = await createGreenhouseNoSubmitDriver().fillToPreSubmitReview({
    runtimeHandle: runtime.handle,
    binding: ids,
    startUrl: START_URL,
    executionPackage,
    submitAuthorized: false,
  });
  assert.equal(result.kind, "FILLED_TO_REVIEW");
  assert.equal(result.filledFieldCount, facts.length);
  assert.equal(result.uploadedArtifactCount, 2);
  assert.equal(result.blockedFieldCount, 1);
  assert.match(result.readbackHash ?? "", SHA256_PATTERN);

  const expectedFactByKey = new Map(facts.map((fact) => [fact.factKey, fact] as const));
  const readbacks = await page.locator("input:not([type=file]), select").evaluateAll((elements) =>
    elements.map((element) => ({
      name: (element as HTMLInputElement | HTMLSelectElement).name,
      value: (element as HTMLInputElement | HTMLSelectElement).value,
    }))
  );
  const controlToFact = new Map<string, CandidateFactKey>([
    ["first_name", "identity.given_name"],
    ["last_name", "identity.family_name"],
    ["full_name", "identity.legal_name"],
    ["email", "contact.application_email"],
    ["phone", "contact.phone"],
    ["linkedin_url", "contact.linkedin_url"],
    ["website_url", "contact.website_url"],
    ["city", "location.city"],
    ["region", "location.region"],
    ["country", "location.country_code"],
  ]);
  for (const readback of readbacks) {
    if (readback.name === "gender") {
      assert.equal(readback.value, "");
      continue;
    }
    const factKey = controlToFact.get(readback.name);
    if (!factKey) continue;
    assert.equal(readback.value, expectedFactByKey.get(factKey)?.value ?? "");
  }
  const resume = artifacts.find((artifact) => artifact.variant === "RESUME_PDF")!;
  const cover = artifacts.find((artifact) => artifact.variant === "COVER_LETTER_PDF")!;
  const selectedFiles = await page.locator('input[type="file"]').evaluateAll((elements) =>
    elements.map((element) => {
      const file = (element as HTMLInputElement).files?.[0];
      return file ? { name: file.name, size: file.size, type: file.type } : null;
    })
  );
  assert.deepEqual(selectedFiles, [
    { name: "resume.pdf", size: resume.byteSize, type: resume.mediaType },
    { name: "cover-letter.pdf", size: cover.byteSize, type: cover.mediaType },
  ]);
  assert.equal(await page.getByRole("button", { name: "Submit application" }).isDisabled(), true);
  await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());

  const usage = await runtimeAdapter.destroy(runtime);
  runtime = null;
  const finalSession = await browserbase.sessions.retrieve(providerSessionRef);
  assert.equal(finalSession.status, "COMPLETED");
  assert.equal(usage.outboundSubmissionRequestCount, 0);
  assert.equal(usage.uploadedByteCount, resume.byteSize + cover.byteSize);
  assert.ok(usage.blockedSubmissionAttemptCount >= 1);

  process.stdout.write(`${JSON.stringify({
    application_id: application.id,
    revision_id: revision.id,
    packet_hash: revision.packet_hash,
    artifact_integrity: artifacts.map((artifact) => ({
      artifact_version_id: artifact.artifactVersionId,
      variant: artifact.variant,
      byte_size: artifact.byteSize,
      sha256: artifact.sha256,
    })),
    exact_fact_count: facts.length,
    exact_fact_keys: facts.map((fact) => fact.factKey),
    exact_fact_readback_hash: sha256(JSON.stringify(facts.map((fact) => ({
      fact_key: fact.factKey,
      value_hash: fact.valueHash,
    })))),
    driver_outcome: result.kind,
    driver_readback_hash: result.readbackHash,
    filled_field_count: result.filledFieldCount,
    uploaded_artifact_count: result.uploadedArtifactCount,
    optional_sensitive_field_left_blank: true,
    submit_control_disabled: true,
    outbound_submission_request_count: usage.outboundSubmissionRequestCount,
    blocked_submission_attempt_count: usage.blockedSubmissionAttemptCount,
    runtime_terminal_status: finalSession.status,
    employer_contacted: false,
    application_submitted: false,
    controlled_origin: new URL(START_URL).origin,
    session_url: `https://www.browserbase.com/sessions/${providerSessionRef}`,
  })}\n`);
} finally {
  eraseApplicationFillExecutionPackage(executionPackage);
  if (runtime !== null) {
    try {
      await runtimeAdapter.destroy(runtime);
    } catch {
      if (providerSessionRef !== null) {
        await browserbase.sessions.update(providerSessionRef, { status: "REQUEST_RELEASE" }).catch(() => undefined);
      }
    }
  }
}
