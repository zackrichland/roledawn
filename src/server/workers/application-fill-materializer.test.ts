import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { Json } from "../../lib/supabase/database.types.ts";
import {
  applicationArtifactUploadFilename,
  createApplicationFillExecutionMaterializer,
  eraseApplicationFillExecutionPackage,
  MAX_UPLOAD_FILENAME_LENGTH,
  type ApplicationFillArtifactRow,
  type ApplicationFillFactDefinitionRow,
  type ApplicationFillFactVersionRow,
  type ApplicationFillMaterializationContext,
  type ApplicationFillMaterializationSource,
} from "./application-fill-materializer.ts";

const IDS = Object.freeze({
  workspace: "10000000-0000-4000-8000-000000000001",
  candidate: "20000000-0000-4000-8000-000000000002",
  application: "30000000-0000-4000-8000-000000000003",
  revision: "40000000-0000-4000-8000-000000000004",
  fill: "50000000-0000-4000-8000-000000000005",
  session: "60000000-0000-4000-8000-000000000006",
  legalNameVersion: "70000000-0000-4000-8000-000000000007",
  emailVersion: "70000000-0000-4000-8000-000000000008",
  workAuthorizedVersion: "70000000-0000-4000-8000-000000000009",
  legalNameFact: "80000000-0000-4000-8000-000000000007",
  emailFact: "80000000-0000-4000-8000-000000000008",
  workAuthorizedFact: "80000000-0000-4000-8000-000000000009",
  extraVersion: "90000000-0000-4000-8000-000000000010",
  extraFact: "90000000-0000-4000-8000-000000000011",
  artifacts: [
    "a0000000-0000-4000-8000-000000000001",
    "a0000000-0000-4000-8000-000000000002",
    "a0000000-0000-4000-8000-000000000003",
    "a0000000-0000-4000-8000-000000000004",
  ],
});

const DESTINATION_URL = "https://jobs.example.com/apply/role-1";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function factHash(value: Json): string {
  return sha256(JSON.stringify(value));
}

const FACTS = Object.freeze([
  Object.freeze({
    versionId: IDS.legalNameVersion,
    factId: IDS.legalNameFact,
    key: "identity.legal_name",
    value: "Alex Example",
    normalizedText: "Alex Example",
    sensitivity: "STANDARD",
  }),
  Object.freeze({
    versionId: IDS.emailVersion,
    factId: IDS.emailFact,
    key: "contact.application_email",
    value: "alex@example.com",
    normalizedText: "alex@example.com",
    sensitivity: "STANDARD",
  }),
  Object.freeze({
    versionId: IDS.workAuthorizedVersion,
    factId: IDS.workAuthorizedFact,
    key: "work_authorization.us.authorized",
    value: true,
    normalizedText: "Yes",
    sensitivity: "SENSITIVE",
  }),
]);

const ARTIFACT_SPECS = Object.freeze([
  Object.freeze({ variant: "COVER_LETTER_DOCX", filename: "Cover Letter.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  Object.freeze({ variant: "COVER_LETTER_PDF", filename: "Cover Letter.pdf", mimeType: "application/pdf" }),
  Object.freeze({ variant: "RESUME_DOCX", filename: "Resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  Object.freeze({ variant: "RESUME_PDF", filename: "Resume.pdf", mimeType: "application/pdf" }),
]);

type Fixture = Readonly<{
  context: ApplicationFillMaterializationContext;
  factVersions: ApplicationFillFactVersionRow[];
  factDefinitions: ApplicationFillFactDefinitionRow[];
  artifacts: ApplicationFillArtifactRow[];
  bytesByPath: Map<string, Uint8Array>;
}>;

function fixture(): Fixture {
  const factVersions = FACTS.map((fact) => ({
    id: fact.versionId,
    workspace_id: IDS.workspace,
    candidate_id: IDS.candidate,
    fact_id: fact.factId,
    value_json: fact.value,
    normalized_text: fact.normalizedText,
    candidate_disposition: "APPROVED",
    reviewed_at: "2026-08-16T00:00:00.000Z",
  })) satisfies ApplicationFillFactVersionRow[];
  const factDefinitions = FACTS.map((fact) => ({
    id: fact.factId,
    workspace_id: IDS.workspace,
    candidate_id: IDS.candidate,
    fact_key: fact.key,
    sensitivity: fact.sensitivity,
    usage_policy: "EXACT_FIELDS",
    verification_status: "VERIFIED",
  })) satisfies ApplicationFillFactDefinitionRow[];

  const bytesByPath = new Map<string, Uint8Array>();
  const artifactManifest: Json[] = [];
  const artifacts = ARTIFACT_SPECS.map((artifact, index) => {
    const id = IDS.artifacts[index]!;
    const bytes = new TextEncoder().encode(`${artifact.variant}-verified-bytes`);
    const digest = sha256(bytes);
    const extension = artifact.variant.endsWith("PDF") ? "pdf" : "docx";
    const path = `${IDS.workspace}/${IDS.candidate}/${IDS.application}/packet/${artifact.variant.toLowerCase()}.${extension}`;
    bytesByPath.set(path, bytes);
    artifactManifest.push({
      artifact_version_id: id,
      variant: artifact.variant,
      display_name: artifact.filename,
      mime_type: artifact.mimeType,
      byte_size: bytes.byteLength,
      sha256: digest,
      qa_status: "PASSED",
    });
    return {
      id,
      workspace_id: IDS.workspace,
      application_revision_id: IDS.revision,
      variant: artifact.variant,
      display_name: artifact.filename,
      mime_type: artifact.mimeType,
      byte_size: bytes.byteLength,
      sha256: digest,
      qa_status: "PASSED",
      storage_bucket: "application-artifacts",
      storage_object_path: path,
    };
  }) satisfies ApplicationFillArtifactRow[];

  const disclosureManifest = {
    destination_origin: "https://jobs.example.com",
    destination_url_hash: sha256(DESTINATION_URL),
    allowed_fact_versions: FACTS.map((fact) => ({
      fact_version_id: fact.versionId,
      fact_key: fact.key,
      value_hash: factHash(fact.value),
      candidate_disposition: "APPROVED",
    })),
    artifacts: artifactManifest,
    policy: {
      unknown_field: "TAKEOVER",
      sensitive_field_without_exact_fact: "TAKEOVER",
      captcha_or_otp: "TAKEOVER",
      submit_authorized: false,
    },
    policy_release: "fill-disclosure-policy/1",
  } satisfies Json;

  return {
    context: Object.freeze({
      workspaceId: IDS.workspace,
      candidateId: IDS.candidate,
      applicationId: IDS.application,
      revisionId: IDS.revision,
      fillAttemptId: IDS.fill,
      destinationUrl: DESTINATION_URL,
      artifactManifest,
      disclosureManifest,
    }),
    factVersions,
    factDefinitions,
    artifacts,
    bytesByPath,
  };
}

class FixtureSource implements ApplicationFillMaterializationSource {
  factVersions: ApplicationFillFactVersionRow[];
  factDefinitions: ApplicationFillFactDefinitionRow[];
  artifacts: ApplicationFillArtifactRow[];
  readonly bytesByPath: Map<string, Uint8Array>;
  readonly downloads: string[] = [];

  constructor(value: Fixture) {
    this.factVersions = value.factVersions;
    this.factDefinitions = value.factDefinitions;
    this.artifacts = value.artifacts;
    this.bytesByPath = value.bytesByPath;
  }

  async loadFactVersions(): Promise<readonly ApplicationFillFactVersionRow[]> {
    return this.factVersions;
  }

  async loadFactDefinitions(): Promise<readonly ApplicationFillFactDefinitionRow[]> {
    return this.factDefinitions;
  }

  async loadArtifactVersions(): Promise<readonly ApplicationFillArtifactRow[]> {
    return this.artifacts;
  }

  async downloadPrivateArtifact(input: Readonly<{
    storageBucket: string;
    storageObjectPath: string;
  }>): Promise<Uint8Array> {
    assert.equal(input.storageBucket, "application-artifacts");
    this.downloads.push(input.storageObjectPath);
    const bytes = this.bytesByPath.get(input.storageObjectPath);
    if (!bytes) throw new Error("APPLICATION_FILL_ARTIFACT_DOWNLOAD_FAILED");
    return bytes.slice();
  }
}

function binding() {
  return Object.freeze({
    workspaceId: IDS.workspace,
    candidateId: IDS.candidate,
    applicationId: IDS.application,
    revisionId: IDS.revision,
    fillAttemptId: IDS.fill,
    computerSessionId: IDS.session,
  });
}

test("materializes only the exact approved facts and verified private artifact bytes", async () => {
  const value = fixture();
  const source = new FixtureSource(value);
  const materializer = createApplicationFillExecutionMaterializer(source);

  const executionPackage = await materializer.materialize({ context: value.context, binding: binding() });

  assert.equal(executionPackage.authorityScope, "FILL_ONLY_NO_SUBMIT");
  assert.equal(executionPackage.submitAuthorized, false);
  assert.deepEqual(executionPackage.facts.map((fact) => [fact.factKey, fact.value]), [
    ["contact.application_email", "alex@example.com"],
    ["identity.legal_name", "Alex Example"],
    ["work_authorization.us.authorized", "Yes"],
  ]);
  assert.deepEqual(executionPackage.artifacts.map((artifact) => artifact.variant), [
    "COVER_LETTER_DOCX",
    "COVER_LETTER_PDF",
    "RESUME_DOCX",
    "RESUME_PDF",
  ]);
  // Employers see the reviewed display names, restricted to a portable charset.
  assert.deepEqual(executionPackage.artifacts.map((artifact) => artifact.filename), [
    "Cover-Letter.docx",
    "Cover-Letter.pdf",
    "Resume.docx",
    "Resume.pdf",
  ]);
  assert.equal(source.downloads.length, 4);
  assert.equal("storageObjectPath" in executionPackage.artifacts[0]!, false);

  eraseApplicationFillExecutionPackage(executionPackage);
  assert.equal(executionPackage.artifacts.every((artifact) => artifact.bytes.every((byte) => byte === 0)), true);
});

test("rejects a tampered fact value hash before any artifact leaves private storage", async () => {
  const value = fixture();
  value.factVersions[0] = { ...value.factVersions[0]!, value_json: "Invented Name", normalized_text: "Invented Name" };
  const source = new FixtureSource(value);

  await assert.rejects(
    createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
    /APPLICATION_FILL_FACT_VALUE_HASH_MISMATCH/u,
  );
  assert.equal(source.downloads.length, 0);
});

test("rejects unresolved work authorization instead of converting uncertainty to a default", async () => {
  const value = fixture();
  value.factVersions[2] = {
    ...value.factVersions[2]!,
    value_json: "unsure",
    normalized_text: "I'm not sure",
  };
  const source = new FixtureSource(value);

  await assert.rejects(
    createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
    /APPLICATION_FILL_FACT_POLICY_BINDING_INVALID/u,
  );
  assert.equal(source.downloads.length, 0);
});

test("rejects missing, extra, duplicate, or policy-ineligible fact rows", async (t) => {
  await t.test("missing", async () => {
    const value = fixture();
    const source = new FixtureSource(value);
    source.factVersions = source.factVersions.slice(0, 1);
    await assert.rejects(
      createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
      /APPLICATION_FILL_FACT_VERSION_SET_MISMATCH/u,
    );
  });

  await t.test("extra", async () => {
    const value = fixture();
    const source = new FixtureSource(value);
    source.factVersions = [...source.factVersions, {
      id: IDS.extraVersion,
      workspace_id: IDS.workspace,
      candidate_id: IDS.candidate,
      fact_id: IDS.extraFact,
      value_json: "Extra",
      normalized_text: "Extra",
      candidate_disposition: "APPROVED",
      reviewed_at: "2026-08-16T00:00:00.000Z",
    }];
    await assert.rejects(
      createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
      /APPLICATION_FILL_FACT_VERSION_SET_MISMATCH/u,
    );
  });

  await t.test("duplicate", async () => {
    const value = fixture();
    const source = new FixtureSource(value);
    source.factVersions = [source.factVersions[0]!, source.factVersions[0]!];
    await assert.rejects(
      createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
      /APPLICATION_FILL_FACT_VERSION_SET_MISMATCH/u,
    );
  });

  await t.test("sensitive", async () => {
    const value = fixture();
    const source = new FixtureSource(value);
    source.factDefinitions[0] = { ...source.factDefinitions[0]!, sensitivity: "SENSITIVE" };
    await assert.rejects(
      createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
      /APPLICATION_FILL_FACT_POLICY_BINDING_INVALID/u,
    );
  });
});

const ANSWER_FACTS = Object.freeze([
  Object.freeze({ versionId: "70000000-0000-4000-8000-000000000011", factId: "80000000-0000-4000-8000-000000000011", key: "self_id.gender", value: "Decline to self-identify", sensitivity: "PROTECTED" }),
  Object.freeze({ versionId: "70000000-0000-4000-8000-000000000012", factId: "80000000-0000-4000-8000-000000000012", key: "self_id.veteran_status", value: "I am not a protected veteran", sensitivity: "PROTECTED" }),
  Object.freeze({ versionId: "70000000-0000-4000-8000-000000000013", factId: "80000000-0000-4000-8000-000000000013", key: "compensation.expected_salary", value: "$150,000–$170,000 base", sensitivity: "SENSITIVE" }),
  Object.freeze({ versionId: "70000000-0000-4000-8000-000000000014", factId: "80000000-0000-4000-8000-000000000014", key: "location.postal_code", value: "20001", sensitivity: "STANDARD" }),
]);

/** The fixture plus saved answers, disclosed as the patched fill-disclosure predicate admits them. */
function fixtureWithAnswers() {
  const value = fixture();
  value.factVersions.push(...ANSWER_FACTS.map((fact) => ({
    id: fact.versionId, workspace_id: IDS.workspace, candidate_id: IDS.candidate, fact_id: fact.factId,
    value_json: fact.value, normalized_text: fact.value, candidate_disposition: "APPROVED", reviewed_at: "2026-09-28T00:00:00.000Z",
  })));
  value.factDefinitions.push(...ANSWER_FACTS.map((fact) => ({
    id: fact.factId, workspace_id: IDS.workspace, candidate_id: IDS.candidate, fact_key: fact.key,
    sensitivity: fact.sensitivity, usage_policy: "EXACT_FIELDS", verification_status: "VERIFIED",
  })));
  const disclosure = value.context.disclosureManifest as Record<string, Json | undefined>;
  const context = { ...value.context, disclosureManifest: { ...disclosure, allowed_fact_versions: [
    ...(disclosure.allowed_fact_versions as Json[]),
    ...ANSWER_FACTS.map((fact) => ({ fact_version_id: fact.versionId, fact_key: fact.key, value_hash: factHash(fact.value), candidate_disposition: "APPROVED" })),
  ] } };
  return { value, context };
}

test("materializes the approved self-identification answers and salary expectation the fill disclosure admits", async () => {
  const { value, context } = fixtureWithAnswers();
  const executionPackage = await createApplicationFillExecutionMaterializer(new FixtureSource(value)).materialize({ context, binding: binding() });
  assert.deepEqual(executionPackage.facts.map((fact) => [fact.factKey, fact.value]), [
    ["compensation.expected_salary", "$150,000–$170,000 base"],
    ["contact.application_email", "alex@example.com"],
    ["identity.legal_name", "Alex Example"],
    ["location.postal_code", "20001"],
    ["self_id.gender", "Decline to self-identify"],
    ["self_id.veteran_status", "I am not a protected veteran"],
    ["work_authorization.us.authorized", "Yes"],
  ]);
  assert.equal(executionPackage.facts.find((fact) => fact.factKey === "compensation.expected_salary")?.valueHash, factHash("$150,000–$170,000 base"));
  eraseApplicationFillExecutionPackage(executionPackage);
});

test("a disclosed answer still needs its exact sensitivity, exact-field policy and text value", async (t) => {
  const gender = ANSWER_FACTS[0]!;
  for (const [name, change] of [
    ["sensitivity drift", (source: FixtureSource) => { source.factDefinitions = source.factDefinitions.map((row) => row.id === gender.factId ? { ...row, sensitivity: "STANDARD" } : row); }],
    ["never-autofill policy", (source: FixtureSource) => { source.factDefinitions = source.factDefinitions.map((row) => row.id === gender.factId ? { ...row, usage_policy: "NEVER_AUTOFILL" } : row); }],
    ["unverified", (source: FixtureSource) => { source.factDefinitions = source.factDefinitions.map((row) => row.id === gender.factId ? { ...row, verification_status: "NEEDS_REVIEW" } : row); }],
    ["boolean value", (source: FixtureSource) => { source.factVersions = source.factVersions.map((row) => row.id === gender.versionId ? { ...row, value_json: true, normalized_text: "Yes" } : row); }],
  ] as const) {
    await t.test(name, async () => {
      const { value, context } = fixtureWithAnswers();
      const source = new FixtureSource(value);
      change(source);
      await assert.rejects(
        createApplicationFillExecutionMaterializer(source).materialize({ context, binding: binding() }),
        /APPLICATION_FILL_FACT_POLICY_BINDING_INVALID/u,
      );
      assert.equal(source.downloads.length, 0);
    });
  }
});

test("rejects swapped artifact metadata and tampered or missing bytes", async (t) => {
  await t.test("wrong revision metadata", async () => {
    const value = fixture();
    const source = new FixtureSource(value);
    source.artifacts[0] = { ...source.artifacts[0]!, application_revision_id: IDS.application };
    await assert.rejects(
      createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
      /APPLICATION_FILL_ARTIFACT_POLICY_BINDING_INVALID/u,
    );
  });

  await t.test("tampered bytes", async () => {
    const value = fixture();
    const source = new FixtureSource(value);
    const path = source.artifacts[0]!.storage_object_path;
    const original = source.bytesByPath.get(path)!;
    source.bytesByPath.set(path, new Uint8Array(original.byteLength).fill(9));
    await assert.rejects(
      createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
      /APPLICATION_FILL_ARTIFACT_HASH_MISMATCH/u,
    );
  });

  await t.test("missing object", async () => {
    const value = fixture();
    const source = new FixtureSource(value);
    source.bytesByPath.delete(source.artifacts[0]!.storage_object_path);
    await assert.rejects(
      createApplicationFillExecutionMaterializer(source).materialize({ context: value.context, binding: binding() }),
      /APPLICATION_FILL_ARTIFACT_DOWNLOAD_FAILED/u,
    );
  });
});

test("rejects a cross-binding request and mismatched disclosed artifact set", async (t) => {
  await t.test("candidate binding", async () => {
    const value = fixture();
    await assert.rejects(
      createApplicationFillExecutionMaterializer(new FixtureSource(value)).materialize({
        context: value.context,
        binding: { ...binding(), candidateId: IDS.application },
      }),
      /APPLICATION_FILL_MATERIALIZATION_BINDING_MISMATCH/u,
    );
  });

  await t.test("disclosed artifacts", async () => {
    const value = fixture();
    const disclosure = value.context.disclosureManifest as Record<string, Json | undefined>;
    const artifacts = [...(disclosure.artifacts as Json[])];
    artifacts[0] = { ...(artifacts[0] as Record<string, Json | undefined>), sha256: "f".repeat(64) };
    const context = { ...value.context, disclosureManifest: { ...disclosure, artifacts } };
    await assert.rejects(
      createApplicationFillExecutionMaterializer(new FixtureSource(value)).materialize({ context, binding: binding() }),
      /APPLICATION_FILL_ARTIFACT_MANIFEST_MISMATCH/u,
    );
  });
});

test("upload filenames use the reviewed display name, sanitized and bounded, with the artifact's own extension", async () => {
  const cases: readonly [Parameters<typeof applicationArtifactUploadFilename>[0], string][] = [
    [{ displayName: "Alex-Example-Anthropic-Resume.pdf", variant: "RESUME_PDF" }, "Alex-Example-Anthropic-Resume.pdf"],
    [{ displayName: "Alex Example – Anthropic Résumé.pdf", variant: "RESUME_PDF" }, "Alex-Example-Anthropic-Resume.pdf"],
    [{ displayName: "José Núñez / Acme, Inc. Cover Letter.docx", variant: "COVER_LETTER_DOCX" }, "Jose-Nunez-Acme-Inc.-Cover-Letter.docx"],
    [{ displayName: "Alex-Example-Anthropic-Application.pdf", variant: "APPLICATION_PDF" }, "Alex-Example-Anthropic-Application.pdf"],
    // The bytes decide the extension; a mismatched or missing suffix is replaced.
    [{ displayName: "Resume.docx", variant: "RESUME_PDF" }, "Resume.pdf"],
    [{ displayName: "Resume", variant: "RESUME_DOCX" }, "Resume.docx"],
    [{ displayName: "../../etc/passwd", variant: "RESUME_PDF" }, "etc-passwd.pdf"],
    // No usable characters: "<First>-<Last>-Resume.pdf", then the legal name, then a plain role name.
    [{ displayName: "📄.pdf", variant: "RESUME_PDF", givenName: "Alex", familyName: "Example", legalName: "Alexander Example" }, "Alex-Example-Resume.pdf"],
    [{ displayName: "   ", variant: "COVER_LETTER_PDF", legalName: "Alex Example" }, "Alex-Example-Cover-Letter.pdf"],
    [{ displayName: null, variant: "APPLICATION_PDF" }, "Application.pdf"],
    [{ displayName: "履歴書.pdf", variant: "RESUME_PDF", givenName: "Zoë", familyName: "O'Neil" }, "Zoe-O-Neil-Resume.pdf"],
  ];
  for (const [input, expected] of cases) assert.equal(applicationArtifactUploadFilename(input), expected, String(input.displayName));
  const long = applicationArtifactUploadFilename({ displayName: `${"Very-Long-Candidate-Name-".repeat(6)}Northstar-Systems-Cover-Letter.pdf`, variant: "COVER_LETTER_PDF" });
  assert.ok(long.length <= MAX_UPLOAD_FILENAME_LENGTH, long);
  assert.match(long, /^[A-Za-z0-9._-]+\.pdf$/u);
  assert.doesNotMatch(long, /[-._]\.pdf$/u);
});

test("materialized artifacts fall back to the candidate's approved name when a display name is unusable", async () => {
  const value = fixture();
  const renamed = new Map([["RESUME_PDF", "✓✓✓.pdf"], ["COVER_LETTER_PDF", "Alex Example — Northstar Cover Letter.pdf"]]);
  const rename = (item: Json) => {
    const entry = item as Record<string, Json | undefined>;
    return renamed.has(String(entry.variant)) ? { ...entry, display_name: renamed.get(String(entry.variant))! } : entry;
  };
  const disclosure = value.context.disclosureManifest as Record<string, Json | undefined>;
  const context = { ...value.context,
    artifactManifest: (value.context.artifactManifest as Json[]).map(rename),
    disclosureManifest: { ...disclosure, artifacts: (disclosure.artifacts as Json[]).map(rename) } };
  const source = new FixtureSource(value);
  source.artifacts = source.artifacts.map((row) => renamed.has(row.variant) ? { ...row, display_name: renamed.get(row.variant)! } : row);
  const executionPackage = await createApplicationFillExecutionMaterializer(source).materialize({ context, binding: binding() });
  assert.equal(executionPackage.artifacts.find((artifact) => artifact.variant === "RESUME_PDF")?.filename, "Alex-Example-Resume.pdf");
  assert.equal(executionPackage.artifacts.find((artifact) => artifact.variant === "COVER_LETTER_PDF")?.filename, "Alex-Example-Northstar-Cover-Letter.pdf");
  eraseApplicationFillExecutionPackage(executionPackage);
});
