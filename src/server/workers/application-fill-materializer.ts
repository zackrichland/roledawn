import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  candidateFactDefinition,
  isCandidateFactKey,
  type CandidateFactKey,
} from "../../domain/candidate-profile.ts";
import type { ComputerSessionBinding } from "../../domain/computer-session-broker.ts";
import type { Database, Json } from "../../lib/supabase/database.types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FACT_KEY_PATTERN = /^[a-z][a-z0-9_.]{0,119}$/u;
const ARTIFACT_BUCKET = "application-artifacts";
const MAX_FACT_COUNT = 32;
const MAX_FACT_VALUE_BYTES = 20_000;
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 5 * MAX_ARTIFACT_BYTES;
const WORK_AUTHORIZATION_AUTOFILL_KEYS = new Set<CandidateFactKey>([
  "work_authorization.us.authorized",
  "work_authorization.us.sponsorship_required",
  "work_authorization.ca.authorized",
  "work_authorization.ca.sponsorship_required",
]);

const ARTIFACT_VARIANTS = Object.freeze([
  "APPLICATION_PDF",
  "COVER_LETTER_DOCX",
  "COVER_LETTER_PDF",
  "RESUME_DOCX",
  "RESUME_PDF",
] as const);

type ApplicationArtifactVariant = (typeof ARTIFACT_VARIANTS)[number];

const VARIANT_MEDIA_TYPES: Readonly<Record<ApplicationArtifactVariant, string>> = Object.freeze({
  APPLICATION_PDF: "application/pdf",
  COVER_LETTER_DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  COVER_LETTER_PDF: "application/pdf",
  RESUME_DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  RESUME_PDF: "application/pdf",
});

const VARIANT_EXTENSIONS: Readonly<Record<ApplicationArtifactVariant, ".pdf" | ".docx">> = Object.freeze({
  APPLICATION_PDF: ".pdf",
  COVER_LETTER_DOCX: ".docx",
  COVER_LETTER_PDF: ".pdf",
  RESUME_DOCX: ".docx",
  RESUME_PDF: ".pdf",
});
const VARIANT_FALLBACK_SUFFIXES: Readonly<Record<ApplicationArtifactVariant, string>> = Object.freeze({
  APPLICATION_PDF: "Application",
  COVER_LETTER_DOCX: "Cover-Letter",
  COVER_LETTER_PDF: "Cover-Letter",
  RESUME_DOCX: "Resume",
  RESUME_PDF: "Resume",
});
export const MAX_UPLOAD_FILENAME_LENGTH = 80;

function uploadFilenamePart(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-{2,}/gu, "-").replace(/\.{2,}/gu, ".")
    .replace(/^[-._]+|[-._]+$/gu, "");
}

/**
 * The name an employer sees for an uploaded document. Uses the reviewed
 * artifact display name (for example "Alex-Example-Anthropic-Resume.pdf"),
 * restricted to [A-Za-z0-9._-], at most 80 characters, with the extension the
 * immutable bytes actually have. Falls back to "<First>-<Last>-Resume.pdf".
 */
export function applicationArtifactUploadFilename(input: Readonly<{
  displayName: string | null | undefined;
  variant: ApplicationArtifactVariant;
  givenName?: string | null;
  familyName?: string | null;
  legalName?: string | null;
}>): string {
  const extension = VARIANT_EXTENSIONS[input.variant];
  const bounded = (stem: string) => {
    const trimmed = stem.slice(0, MAX_UPLOAD_FILENAME_LENGTH - extension.length).replace(/[-._]+$/u, "");
    return /[A-Za-z0-9]/u.test(trimmed) ? `${trimmed}${extension}` : null;
  };
  const displayStem = uploadFilenamePart((input.displayName ?? "").trim().replace(/\.(?:pdf|docx?|rtf|txt)$/iu, ""));
  const fromDisplay = bounded(displayStem);
  if (fromDisplay) return fromDisplay;
  const person = input.givenName?.trim() && input.familyName?.trim()
    ? `${input.givenName}-${input.familyName}` : input.legalName?.trim() ?? "";
  return bounded(uploadFilenamePart(`${person}-${VARIANT_FALLBACK_SUFFIXES[input.variant]}`)) ??
    `${VARIANT_FALLBACK_SUFFIXES[input.variant]}${extension}`;
}

export type ApplicationFillMaterializationContext = Readonly<{
  workspaceId: string;
  candidateId: string;
  applicationId: string;
  revisionId: string;
  fillAttemptId: string;
  destinationUrl: string;
  artifactManifest: Json;
  disclosureManifest: Json;
}>;

export type MaterializedApplicationFact = Readonly<{
  factVersionId: string;
  factKey: CandidateFactKey;
  /** The exact immutable value whose PostgreSQL jsonb hash was authorized. */
  value: string;
  valueHash: string;
}>;

export type MaterializedApplicationArtifact = Readonly<{
  artifactVersionId: string;
  variant: ApplicationArtifactVariant;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  /** Service-worker memory only. Never persist, serialize, or log this field. */
  bytes: Uint8Array;
}>;

export type ApplicationFillExecutionPackage = Readonly<{
  schemaRelease: "application-fill-execution-package/1";
  authorityScope: "FILL_ONLY_NO_SUBMIT";
  binding: Readonly<ComputerSessionBinding & { computerSessionId: string }>;
  destinationUrl: string;
  facts: readonly MaterializedApplicationFact[];
  artifacts: readonly MaterializedApplicationArtifact[];
  submitAuthorized: false;
}>;

export interface ApplicationFillExecutionMaterializer {
  materialize(input: Readonly<{
    context: ApplicationFillMaterializationContext;
    binding: Readonly<ComputerSessionBinding & { computerSessionId: string }>;
  }>): Promise<ApplicationFillExecutionPackage>;
}

export type ApplicationFillFactVersionRow = Readonly<{
  id: string;
  workspace_id: string;
  candidate_id: string;
  fact_id: string;
  value_json: Json;
  normalized_text: string | null;
  candidate_disposition: string;
  reviewed_at: string | null;
}>;

export type ApplicationFillFactDefinitionRow = Readonly<{
  id: string;
  workspace_id: string;
  candidate_id: string;
  fact_key: string;
  sensitivity: string;
  usage_policy: string;
  verification_status: string;
}>;

export type ApplicationFillArtifactRow = Readonly<{
  id: string;
  workspace_id: string;
  application_revision_id: string;
  variant: string;
  display_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  qa_status: string;
  storage_bucket: string;
  storage_object_path: string;
}>;

export interface ApplicationFillMaterializationSource {
  loadFactVersions(input: Readonly<{
    workspaceId: string;
    candidateId: string;
    factVersionIds: readonly string[];
  }>): Promise<readonly ApplicationFillFactVersionRow[]>;
  loadFactDefinitions(input: Readonly<{
    workspaceId: string;
    candidateId: string;
    factIds: readonly string[];
  }>): Promise<readonly ApplicationFillFactDefinitionRow[]>;
  loadArtifactVersions(input: Readonly<{
    workspaceId: string;
    revisionId: string;
    artifactVersionIds: readonly string[];
  }>): Promise<readonly ApplicationFillArtifactRow[]>;
  downloadPrivateArtifact(input: Readonly<{
    storageBucket: string;
    storageObjectPath: string;
  }>): Promise<Uint8Array>;
}

type FactManifestEntry = Readonly<{
  factVersionId: string;
  factKey: CandidateFactKey;
  valueHash: string;
}>;

type ArtifactManifestEntry = Readonly<{
  artifactVersionId: string;
  variant: ApplicationArtifactVariant;
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}>;

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === "object";
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSafeFilename(value: string): boolean {
  const filename = value.trim();
  return filename.length >= 1 && filename.length <= 255 &&
    filename !== "." && filename !== ".." &&
    !filename.includes("/") && !filename.includes("\\") && !filename.includes("\0");
}

function isArtifactVariant(value: string): value is ApplicationArtifactVariant {
  return ARTIFACT_VARIANTS.includes(value as ApplicationArtifactVariant);
}

/**
 * Mirrors the disclosure predicate patched by migration
 * 20260928100000_candidate_story_bank_and_profile.sql: candidate-entered
 * voluntary self-identification answers and the salary expectation. The
 * definition's sensitivity must still equal the stored row's (checked below),
 * and the drivers write each only into its own anchored question.
 */
function isDisclosedCandidateAnswer(key: CandidateFactKey, sensitivity: string): boolean {
  return (sensitivity === "SENSITIVE" || sensitivity === "PROTECTED") &&
    (key.startsWith("self_id.") || key === "compensation.expected_salary");
}

function isFillEligibleExactFact(key: CandidateFactKey): boolean {
  const definition = candidateFactDefinition(key);
  return definition.usagePolicy === "EXACT_FIELDS" && (
    definition.sensitivity === "STANDARD" ||
    (definition.sensitivity === "SENSITIVE" && WORK_AUTHORIZATION_AUTOFILL_KEYS.has(key)) ||
    isDisclosedCandidateAnswer(key, definition.sensitivity)
  );
}

function parseFactManifest(disclosureManifest: Json): readonly FactManifestEntry[] {
  if (!isJsonObject(disclosureManifest)) throw new Error("APPLICATION_FILL_DISCLOSURE_MANIFEST_INVALID");
  if (disclosureManifest.policy_release !== "fill-disclosure-policy/1") {
    throw new Error("APPLICATION_FILL_DISCLOSURE_POLICY_RELEASE_INVALID");
  }
  const policy = disclosureManifest.policy;
  if (
    !isJsonObject(policy) || policy.submit_authorized !== false ||
    policy.unknown_field !== "TAKEOVER" ||
    policy.sensitive_field_without_exact_fact !== "TAKEOVER" ||
    policy.captcha_or_otp !== "TAKEOVER"
  ) throw new Error("APPLICATION_FILL_DISCLOSURE_POLICY_INVALID");

  const values = disclosureManifest.allowed_fact_versions;
  if (!Array.isArray(values) || values.length > MAX_FACT_COUNT) {
    throw new Error("APPLICATION_FILL_FACT_MANIFEST_INVALID");
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const entries: FactManifestEntry[] = [];
  for (const value of values) {
    if (!isJsonObject(value)) throw new Error("APPLICATION_FILL_FACT_MANIFEST_INVALID");
    const factVersionId = value.fact_version_id;
    const factKey = value.fact_key;
    const valueHash = value.value_hash;
    if (
      typeof factVersionId !== "string" || !UUID_PATTERN.test(factVersionId) ||
      typeof factKey !== "string" || !FACT_KEY_PATTERN.test(factKey) || !isCandidateFactKey(factKey) ||
      typeof valueHash !== "string" || !SHA256_PATTERN.test(valueHash) ||
      value.candidate_disposition !== "APPROVED" || ids.has(factVersionId) || keys.has(factKey)
    ) throw new Error("APPLICATION_FILL_FACT_MANIFEST_INVALID");
    if (!isFillEligibleExactFact(factKey)) {
      throw new Error("APPLICATION_FILL_FACT_POLICY_INVALID");
    }
    ids.add(factVersionId);
    keys.add(factKey);
    entries.push(Object.freeze({ factVersionId, factKey, valueHash }));
  }
  return Object.freeze(entries.sort((left, right) =>
    left.factKey.localeCompare(right.factKey) || left.factVersionId.localeCompare(right.factVersionId)
  ));
}

function parseArtifactManifest(value: Json): readonly ArtifactManifestEntry[] {
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== ARTIFACT_VARIANTS.length)) {
    throw new Error("APPLICATION_FILL_ARTIFACT_MANIFEST_INVALID");
  }
  const ids = new Set<string>();
  const variants = new Set<string>();
  const entries: ArtifactManifestEntry[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) throw new Error("APPLICATION_FILL_ARTIFACT_MANIFEST_INVALID");
    const artifactVersionId = item.artifact_version_id;
    const variant = item.variant;
    const displayName = item.display_name;
    const mimeType = item.mime_type;
    const byteSize = item.byte_size;
    const sha256 = item.sha256;
    if (
      typeof artifactVersionId !== "string" || !UUID_PATTERN.test(artifactVersionId) ||
      typeof variant !== "string" || !isArtifactVariant(variant) ||
      typeof displayName !== "string" || !isSafeFilename(displayName) ||
      typeof mimeType !== "string" || mimeType !== VARIANT_MEDIA_TYPES[variant] ||
      typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) ||
        byteSize < 1 || byteSize > MAX_ARTIFACT_BYTES ||
      typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256) ||
      item.qa_status !== "PASSED" || ids.has(artifactVersionId) || variants.has(variant)
    ) throw new Error("APPLICATION_FILL_ARTIFACT_MANIFEST_INVALID");
    ids.add(artifactVersionId);
    variants.add(variant);
    entries.push(Object.freeze({
      artifactVersionId,
      variant,
      displayName: displayName.trim(),
      mimeType,
      byteSize,
      sha256,
    }));
  }
  if (ARTIFACT_VARIANTS.some((variant) => variant !== "APPLICATION_PDF" && !variants.has(variant))) {
    throw new Error("APPLICATION_FILL_ARTIFACT_MANIFEST_INVALID");
  }
  const totalBytes = entries.reduce((total, entry) => total + entry.byteSize, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
    throw new Error("APPLICATION_FILL_ARTIFACT_BYTES_LIMIT_EXCEEDED");
  }
  return Object.freeze(entries.sort((left, right) => left.variant.localeCompare(right.variant)));
}

function assertArtifactManifestsMatch(
  authorized: readonly ArtifactManifestEntry[],
  disclosedValue: Json | undefined,
): void {
  if (disclosedValue === undefined) throw new Error("APPLICATION_FILL_DISCLOSED_ARTIFACTS_MISSING");
  const disclosed = parseArtifactManifest(disclosedValue);
  for (let index = 0; index < authorized.length; index += 1) {
    const left = authorized[index];
    const right = disclosed[index];
    if (!left || !right ||
      left.artifactVersionId !== right.artifactVersionId || left.variant !== right.variant ||
      left.displayName !== right.displayName || left.mimeType !== right.mimeType ||
      left.byteSize !== right.byteSize || left.sha256 !== right.sha256
    ) throw new Error("APPLICATION_FILL_ARTIFACT_MANIFEST_MISMATCH");
  }
}

function assertBinding(
  context: ApplicationFillMaterializationContext,
  binding: Readonly<ComputerSessionBinding & { computerSessionId: string }>,
): void {
  if (
    context.workspaceId !== binding.workspaceId || context.candidateId !== binding.candidateId ||
    context.applicationId !== binding.applicationId || context.revisionId !== binding.revisionId ||
    context.fillAttemptId !== binding.fillAttemptId || !UUID_PATTERN.test(binding.computerSessionId)
  ) throw new Error("APPLICATION_FILL_MATERIALIZATION_BINDING_MISMATCH");
  let destination: URL;
  try {
    destination = new URL(context.destinationUrl);
  } catch {
    throw new Error("APPLICATION_FILL_DESTINATION_INVALID");
  }
  if (!isJsonObject(context.disclosureManifest) ||
    context.disclosureManifest.destination_origin !== destination.origin ||
    context.disclosureManifest.destination_url_hash !== sha256Text(context.destinationUrl)
  ) throw new Error("APPLICATION_FILL_DESTINATION_BINDING_MISMATCH");
}

function assertExactSet(actualIds: readonly string[], expectedIds: readonly string[], errorCode: string): void {
  if (actualIds.length !== expectedIds.length) throw new Error(errorCode);
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length || actualIds.some((id) => !expected.has(id))) {
    throw new Error(errorCode);
  }
  if (new Set(actualIds).size !== actualIds.length) throw new Error(errorCode);
}

export function eraseApplicationFillExecutionPackage(value: ApplicationFillExecutionPackage): void {
  for (const artifact of value.artifacts) artifact.bytes.fill(0);
}

export function createApplicationFillExecutionMaterializer(
  source: ApplicationFillMaterializationSource,
): ApplicationFillExecutionMaterializer {
  return Object.freeze({
    async materialize({ context, binding }: Readonly<{
      context: ApplicationFillMaterializationContext;
      binding: Readonly<ComputerSessionBinding & { computerSessionId: string }>;
    }>) {
      assertBinding(context, binding);
      const factManifest = parseFactManifest(context.disclosureManifest);
      const artifactManifest = parseArtifactManifest(context.artifactManifest);
      if (!isJsonObject(context.disclosureManifest)) {
        throw new Error("APPLICATION_FILL_DISCLOSURE_MANIFEST_INVALID");
      }
      assertArtifactManifestsMatch(artifactManifest, context.disclosureManifest.artifacts);

      const factVersionIds = factManifest.map((entry) => entry.factVersionId);
      const versionRows = factVersionIds.length === 0
        ? []
        : await source.loadFactVersions({
            workspaceId: context.workspaceId,
            candidateId: context.candidateId,
            factVersionIds,
          });
      assertExactSet(
        versionRows.map((row) => row.id),
        factVersionIds,
        "APPLICATION_FILL_FACT_VERSION_SET_MISMATCH",
      );

      const factIds = versionRows.map((row) => row.fact_id);
      const definitionRows = factIds.length === 0
        ? []
        : await source.loadFactDefinitions({
            workspaceId: context.workspaceId,
            candidateId: context.candidateId,
            factIds,
          });
      assertExactSet(
        definitionRows.map((row) => row.id),
        [...new Set(factIds)],
        "APPLICATION_FILL_FACT_DEFINITION_SET_MISMATCH",
      );

      const manifestByVersion = new Map(factManifest.map((entry) => [entry.factVersionId, entry] as const));
      const definitionById = new Map(definitionRows.map((row) => [row.id, row] as const));
      const facts: MaterializedApplicationFact[] = [];
      for (const row of versionRows) {
        const expected = manifestByVersion.get(row.id);
        const definition = definitionById.get(row.fact_id);
        if (!expected || !definition ||
          row.workspace_id !== context.workspaceId || row.candidate_id !== context.candidateId ||
          definition.workspace_id !== context.workspaceId || definition.candidate_id !== context.candidateId ||
          definition.fact_key !== expected.factKey || !isFillEligibleExactFact(expected.factKey) ||
          definition.sensitivity !== candidateFactDefinition(expected.factKey).sensitivity ||
          definition.usage_policy !== "EXACT_FIELDS" || definition.verification_status !== "VERIFIED" ||
          row.candidate_disposition !== "APPROVED" || row.reviewed_at === null ||
          (
            typeof row.value_json !== "string" &&
            !(WORK_AUTHORIZATION_AUTOFILL_KEYS.has(expected.factKey) && typeof row.value_json === "boolean")
          )
        ) throw new Error("APPLICATION_FILL_FACT_POLICY_BINDING_INVALID");
        const fillValue = typeof row.value_json === "boolean"
          ? row.value_json ? "Yes" : "No"
          : row.value_json;
        if (row.normalized_text !== fillValue) {
          throw new Error("APPLICATION_FILL_FACT_POLICY_BINDING_INVALID");
        }
        const valueBytes = Buffer.byteLength(fillValue, "utf8");
        if (valueBytes < 1 || valueBytes > MAX_FACT_VALUE_BYTES) {
          throw new Error("APPLICATION_FILL_FACT_VALUE_INVALID");
        }
        // PostgreSQL renders a top-level JSONB string with JSON string
        // escaping. JSON.stringify is byte-identical for that deliberately
        // narrow shape. Objects, arrays, numbers, booleans, and null are
        // rejected above; supporting them requires a versioned PostgreSQL-side
        // hash verifier rather than a guessed JavaScript canonicalizer.
        const postgresJsonbText = JSON.stringify(row.value_json);
        const valueHash = sha256Text(postgresJsonbText);
        if (valueHash !== expected.valueHash) throw new Error("APPLICATION_FILL_FACT_VALUE_HASH_MISMATCH");
        facts.push(Object.freeze({
          factVersionId: row.id,
          factKey: expected.factKey,
          value: fillValue,
          valueHash,
        }));
      }
      facts.sort((left, right) => left.factKey.localeCompare(right.factKey));

      const artifactVersionIds = artifactManifest.map((entry) => entry.artifactVersionId);
      const artifactRows = await source.loadArtifactVersions({
        workspaceId: context.workspaceId,
        revisionId: context.revisionId,
        artifactVersionIds,
      });
      assertExactSet(
        artifactRows.map((row) => row.id),
        artifactVersionIds,
        "APPLICATION_FILL_ARTIFACT_VERSION_SET_MISMATCH",
      );
      const artifactRowById = new Map(artifactRows.map((row) => [row.id, row] as const));
      const factValue = (key: CandidateFactKey) => facts.find((fact) => fact.factKey === key)?.value ?? null;
      const names = { givenName: factValue("identity.given_name"), familyName: factValue("identity.family_name"), legalName: factValue("identity.legal_name") };
      const artifacts: MaterializedApplicationArtifact[] = [];
      const expectedStoragePrefix = `${context.workspaceId}/${context.candidateId}/${context.applicationId}/`;
      try {
        for (const expected of artifactManifest) {
          const row = artifactRowById.get(expected.artifactVersionId);
          if (!row || row.workspace_id !== context.workspaceId ||
            row.application_revision_id !== context.revisionId || row.variant !== expected.variant ||
            row.display_name.trim() !== expected.displayName || row.mime_type !== expected.mimeType ||
            row.byte_size !== expected.byteSize || row.sha256 !== expected.sha256 ||
            row.qa_status !== "PASSED" || row.storage_bucket !== ARTIFACT_BUCKET ||
            !row.storage_object_path.startsWith(expectedStoragePrefix) ||
            row.storage_object_path.includes("..")
          ) throw new Error("APPLICATION_FILL_ARTIFACT_POLICY_BINDING_INVALID");
          const downloaded = await source.downloadPrivateArtifact({
            storageBucket: row.storage_bucket,
            storageObjectPath: row.storage_object_path,
          });
          if (downloaded.byteLength !== expected.byteSize) {
            downloaded.fill(0);
            throw new Error("APPLICATION_FILL_ARTIFACT_SIZE_MISMATCH");
          }
          const digest = sha256Bytes(downloaded);
          if (digest !== expected.sha256) {
            downloaded.fill(0);
            throw new Error("APPLICATION_FILL_ARTIFACT_HASH_MISMATCH");
          }
          artifacts.push(Object.freeze({
            artifactVersionId: row.id,
            variant: expected.variant,
            filename: applicationArtifactUploadFilename({ displayName: expected.displayName, variant: expected.variant, ...names }),
            mediaType: expected.mimeType,
            byteSize: expected.byteSize,
            sha256: digest,
            bytes: downloaded,
          }));
        }
      } catch (error) {
        for (const artifact of artifacts) artifact.bytes.fill(0);
        throw error;
      }

      return Object.freeze({
        schemaRelease: "application-fill-execution-package/1" as const,
        authorityScope: "FILL_ONLY_NO_SUBMIT" as const,
        binding,
        destinationUrl: context.destinationUrl,
        facts: Object.freeze(facts),
        artifacts: Object.freeze(artifacts),
        submitAuthorized: false as const,
      });
    },
  });
}

export function createSupabaseApplicationFillMaterializationSource(
  supabase: SupabaseClient<Database>,
): ApplicationFillMaterializationSource {
  return Object.freeze({
    async loadFactVersions(input: Readonly<{
      workspaceId: string;
      candidateId: string;
      factVersionIds: readonly string[];
    }>) {
      const response = await supabase
        .from("candidate_fact_versions")
        .select("id,workspace_id,candidate_id,fact_id,value_json,normalized_text,candidate_disposition,reviewed_at")
        .eq("workspace_id", input.workspaceId)
        .eq("candidate_id", input.candidateId)
        .in("id", [...input.factVersionIds]);
      if (response.error) throw new Error("APPLICATION_FILL_FACT_VERSION_LOAD_FAILED");
      return response.data;
    },

    async loadFactDefinitions(input: Readonly<{
      workspaceId: string;
      candidateId: string;
      factIds: readonly string[];
    }>) {
      const response = await supabase
        .from("candidate_facts")
        .select("id,workspace_id,candidate_id,fact_key,sensitivity,usage_policy,verification_status")
        .eq("workspace_id", input.workspaceId)
        .eq("candidate_id", input.candidateId)
        .in("id", [...input.factIds]);
      if (response.error) throw new Error("APPLICATION_FILL_FACT_DEFINITION_LOAD_FAILED");
      return response.data;
    },

    async loadArtifactVersions(input: Readonly<{
      workspaceId: string;
      revisionId: string;
      artifactVersionIds: readonly string[];
    }>) {
      const response = await supabase
        .from("artifact_versions")
        .select("id,workspace_id,application_revision_id,variant,display_name,mime_type,byte_size,sha256,qa_status,storage_bucket,storage_object_path")
        .eq("workspace_id", input.workspaceId)
        .eq("application_revision_id", input.revisionId)
        .in("id", [...input.artifactVersionIds]);
      if (response.error) throw new Error("APPLICATION_FILL_ARTIFACT_VERSION_LOAD_FAILED");
      return response.data;
    },

    async downloadPrivateArtifact(input: Readonly<{
      storageBucket: string;
      storageObjectPath: string;
    }>) {
      if (input.storageBucket !== ARTIFACT_BUCKET || input.storageObjectPath.trim().length === 0) {
        throw new Error("APPLICATION_FILL_ARTIFACT_STORAGE_REFERENCE_INVALID");
      }
      const response = await supabase.storage
        .from(input.storageBucket)
        .download(input.storageObjectPath, {}, { cache: "no-store" });
      if (response.error) throw new Error("APPLICATION_FILL_ARTIFACT_DOWNLOAD_FAILED");
      if (response.data.size < 1 || response.data.size > MAX_ARTIFACT_BYTES) {
        throw new Error("APPLICATION_FILL_ARTIFACT_DOWNLOAD_SIZE_INVALID");
      }
      return new Uint8Array(await response.data.arrayBuffer());
    },
  });
}

export function createSupabaseApplicationFillExecutionMaterializer(
  supabase: SupabaseClient<Database>,
): ApplicationFillExecutionMaterializer {
  return createApplicationFillExecutionMaterializer(
    createSupabaseApplicationFillMaterializationSource(supabase),
  );
}
