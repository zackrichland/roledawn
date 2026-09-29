export const APPLICATION_DRAFTING_SCHEMA_RELEASE = "application-drafting/1";

export type ApplicationDraftingTailoringMode =
  | "AS_UPLOADED"
  | "REORDER_AND_TIGHTEN"
  | "REWRITE_FROM_VERIFIED_FACTS";

export type ApplicationDraftingEvidenceUsage =
  | "RESUME_AND_COVER_LETTER"
  | "COVER_LETTER_ONLY";

export type ApplicationDraftingSurface = "RESUME" | "COVER_LETTER";

export type ApplicationDraftingResumeHandling =
  | "PRESERVE_SERVER_SIDE"
  | "TAILOR_FROM_APPROVED_EVIDENCE";

export type ApplicationDraftingJobField =
  | "EMPLOYER_NAME"
  | "TITLE"
  | "LOCATION"
  | "DESCRIPTION"
  | "APPLY_URL";

export type ApplicationDraftingResearchClaim = Readonly<{
  researchClaimId: string;
  text: string;
}>;

export type ApplicationDraftingContext = Readonly<{
  schemaVersion: 1;
  source: Readonly<{
    inputSnapshotId: string;
    snapshotHash: string;
    capturedAt: string;
  }>;
  application: Readonly<{
    workspaceId: string;
    applicationId: string;
    candidateId: string;
  }>;
  policy: Readonly<{
    tailoringMode: ApplicationDraftingTailoringMode;
    writingPolicyRelease: string;
    assemblerRelease: string;
    exactFactsAllowedInNarrativeContext: false;
  }>;
  job: Readonly<{
    jobId: string;
    jobVersionId: string;
    contentSha256: string;
    employerName: string;
    title: string;
    description: string;
    location: string | null;
    employmentType: string | null;
    workMode: string | null;
    applyUrl: string;
  }>;
  sourceResume: Readonly<{
    documentId: string;
    documentVersionId: string;
    textReviewId: string;
    sourceSha256: string;
    reviewedTextSha256: string;
    reviewedText: string;
  }>;
  approvedNarrativeEvidence: readonly Readonly<{
    evidenceVersionId: string;
    documentId: string;
    claimSha256: string;
    claimText: string;
    usagePolicy: ApplicationDraftingEvidenceUsage;
  }>[];
  excludedExactFactCount: number;
  /** Frozen career profile, story, and voice references (snapshots from 2026-09-28 onward). */
  profileContext?: import("./application-input-snapshot.ts").ApplicationProfileContextManifest | null;
}>;

export type ApplicationDraftingWritingPolicy = Readonly<{
  policyRelease: string;
  prohibitedPhrases: readonly string[];
  maxResumeWords: number;
  minCoverLetterWords: number;
  maxCoverLetterWords: number;
  minCoverLetterParagraphs: number;
  maxCoverLetterParagraphs: number;
  minCandidateEvidenceClaimsInCoverLetter: number;
  minRoleContextClaimsInCoverLetter: number;
  minCandidateEvidenceClaimsInTailoredResume: number;
}>;

/**
 * This is the only candidate context an implementation may pass to a drafting
 * provider. Candidate/workspace identity and exact application facts are
 * deliberately absent.
 */
export type ApplicationDraftingRequest = Readonly<{
  schemaRelease: typeof APPLICATION_DRAFTING_SCHEMA_RELEASE;
  source: Readonly<{
    inputSnapshotId: string;
    snapshotHash: string;
  }>;
  target: Readonly<{
    employerName: string;
    title: string;
    description: string;
    location: string | null;
    employmentType: string | null;
    workMode: string | null;
  }>;
  resume:
    | Readonly<{
        handling: "PRESERVE_SERVER_SIDE";
        tailoringMode: "AS_UPLOADED";
        reviewedTextSha256: string;
      }>
    | Readonly<{
        handling: "TAILOR_FROM_APPROVED_EVIDENCE";
        tailoringMode: "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS";
        reviewedTextSha256: string;
      }>;
  approvedNarrativeEvidence: readonly Readonly<{
    evidenceVersionId: string;
    claimText: string;
    usagePolicy: ApplicationDraftingEvidenceUsage;
  }>[];
  approvedResearchClaims: readonly ApplicationDraftingResearchClaim[];
  policy: Readonly<{
    tailoringMode: ApplicationDraftingTailoringMode;
    policyRelease: string;
    prohibitedPhrases: readonly string[];
    maxResumeWords: number;
    minCoverLetterWords: number;
    maxCoverLetterWords: number;
    minCoverLetterParagraphs: number;
    maxCoverLetterParagraphs: number;
    minCandidateEvidenceClaimsInCoverLetter: number;
    minRoleContextClaimsInCoverLetter: number;
    minCandidateEvidenceClaimsInTailoredResume: number;
  }>;
}>;

export type ApplicationDraftingCitation =
  | Readonly<{
      sourceType: "CANDIDATE_EVIDENCE";
      evidenceVersionId: string;
    }>
  | Readonly<{
      sourceType: "JOB_FIELD";
      field: ApplicationDraftingJobField;
    }>
  | Readonly<{
      sourceType: "RESEARCH_CLAIM";
      researchClaimId: string;
    }>;

export type ApplicationDraftingClaim = Readonly<{
  claimId: string;
  claimType: "CANDIDATE_EVIDENCE" | "JOB_CONTEXT" | "RESEARCH_CONTEXT";
  surface: ApplicationDraftingSurface;
  statement: string;
  citations: readonly ApplicationDraftingCitation[];
}>;

export type ApplicationDraftingProposal = Readonly<{
  schemaVersion: 1;
  inputSnapshotId: string;
  snapshotHash: string;
  target: Readonly<{
    employerName: string;
    title: string;
  }>;
  claims: readonly ApplicationDraftingClaim[];
  resume:
    | Readonly<{
        handling: "PRESERVE_SERVER_SIDE";
        mode: "AS_UPLOADED";
        text: null;
        claimIds: readonly [];
      }>
    | Readonly<{
        handling: "TAILOR_FROM_APPROVED_EVIDENCE";
        mode: "REORDER_AND_TIGHTEN" | "REWRITE_FROM_VERIFIED_FACTS";
        text: string;
        claimIds: readonly string[];
      }>;
  coverLetter: Readonly<{
    title: string;
    paragraphs: readonly Readonly<{
      paragraphId: string;
      text: string;
      claimIds: readonly string[];
    }>[];
  }>;
}>;

export type ApplicationDraftingAdapterResult =
  | Readonly<{
      status: "COMPLETED";
      proposal: ApplicationDraftingProposal;
      execution: Readonly<{
        adapterRelease: string;
        modelRelease: string;
        requestId: string | null;
        writingPolicy?: ApplicationWritingPolicyProvenance;
      }>;
    }>
  | Readonly<{
      status: "REFUSED" | "INCOMPLETE";
      reasonCode: string;
      execution: Readonly<{
        adapterRelease: string;
        modelRelease: string;
        requestId: string | null;
        writingPolicy?: ApplicationWritingPolicyProvenance;
      }>;
    }>;

export interface ApplicationDraftingAdapter {
  readonly adapterRelease: string;
  draft(request: ApplicationDraftingRequest, revision?: ApplicationDraftingRevision): Promise<ApplicationDraftingAdapterResult>;
}

export type ApplicationDraftingRevision = Readonly<{
  previousProposal: ApplicationDraftingProposal;
  issueCodes: readonly string[];
  measurements: Readonly<{ coverLetterWords: number; coverLetterParagraphs: number; resumeWords: number }>;
  targetCoverLetterWords: number;
}>;

export type ApplicationDraftingAttemptHistory = Readonly<{
  release: "application-drafting-repair/1";
  attempts: readonly Readonly<{
    attempt: 1 | 2;
    status: "ACCEPTED" | "REPAIR_REQUESTED" | "REJECTED" | "REFUSED" | "INCOMPLETE" | "ERROR";
    deterministicIssueCodes: readonly string[];
    semanticIssueCodes: readonly string[];
    qualityIssueCodes: readonly string[];
    coverLetterWords?: number;
    coverLetterParagraphs?: number;
    policyRelease?: string;
    policySha256?: string;
  }>[];
}>;

export type ApplicationDraftingAdapterOutputIssue = Readonly<{
  path: string;
  message: string;
}>;

export type ParsedApplicationDraftingAdapterResult =
  | Readonly<{ ok: true; value: ApplicationDraftingAdapterResult }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "ADAPTER_OUTPUT_INVALID";
        issues: readonly ApplicationDraftingAdapterOutputIssue[];
      }>;
    }>;

const ADAPTER_OUTPUT_LIMITS = Object.freeze({
  maxIssues: 64,
  maxClaims: 64,
  maxCitationsPerClaim: 8,
  maxClaimReferences: 64,
  maxParagraphs: 16,
  maxIdCharacters: 160,
  maxReleaseCharacters: 240,
  maxReasonCodeCharacters: 120,
  maxTitleCharacters: 320,
  maxStatementCharacters: 2_000,
  maxParagraphCharacters: 4_000,
  maxResumeCharacters: 24_000,
});

type AdapterOutputParseState = {
  issues: ApplicationDraftingAdapterOutputIssue[];
};

function addAdapterOutputIssue(
  state: AdapterOutputParseState,
  path: string,
  message: string,
): void {
  if (state.issues.length < ADAPTER_OUTPUT_LIMITS.maxIssues) {
    state.issues.push(Object.freeze({ path, message }));
  }
}

function parseStrictRecord(
  state: AdapterOutputParseState,
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addAdapterOutputIssue(state, path, "Expected an object.");
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) addAdapterOutputIssue(state, `${path}.${key}`, "Unknown field.");
  }
  return record;
}

function parseBoundedString(
  state: AdapterOutputParseState,
  value: unknown,
  path: string,
  maxCharacters: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxCharacters) {
    addAdapterOutputIssue(state, path, `Expected a non-empty string of at most ${maxCharacters} characters.`);
    return "";
  }
  return value;
}

function parseEnum<T extends string>(
  state: AdapterOutputParseState,
  value: unknown,
  path: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    addAdapterOutputIssue(state, path, `Expected one of: ${values.join(", ")}.`);
    return values[0]!;
  }
  return value as T;
}

function parseBoundedArray(
  state: AdapterOutputParseState,
  value: unknown,
  path: string,
  maxItems: number,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    addAdapterOutputIssue(state, path, "Expected an array.");
    return [];
  }
  if (value.length > maxItems) {
    addAdapterOutputIssue(state, path, `Array exceeds the ${maxItems}-item limit.`);
    return value.slice(0, maxItems);
  }
  return value;
}

function parseStringReferences(
  state: AdapterOutputParseState,
  value: unknown,
  path: string,
): readonly string[] {
  return parseBoundedArray(
    state,
    value,
    path,
    ADAPTER_OUTPUT_LIMITS.maxClaimReferences,
  ).map((entry, index) => parseBoundedString(
    state,
    entry,
    `${path}[${index}]`,
    ADAPTER_OUTPUT_LIMITS.maxIdCharacters,
  ));
}

function parseAdapterExecution(
  state: AdapterOutputParseState,
  value: unknown,
): ApplicationDraftingAdapterResult["execution"] {
  const record = parseStrictRecord(
    state,
    value,
    "execution",
    ["adapterRelease", "modelRelease", "requestId", "writingPolicy"],
  ) ?? {};
  let requestId: string | null = null;
  if (record.requestId !== null) {
    requestId = parseBoundedString(
      state,
      record.requestId,
      "execution.requestId",
      ADAPTER_OUTPUT_LIMITS.maxIdCharacters,
    );
  }
  let writingPolicy: ApplicationWritingPolicyProvenance | undefined;
  if (record.writingPolicy !== undefined) {
    const policy = parseStrictRecord(state, record.writingPolicy, "execution.writingPolicy", ["release", "sha256", "documents"]) ?? {};
    const release = parseBoundedString(state, policy.release, "execution.writingPolicy.release", 120);
    if (!/^[A-Za-z][A-Za-z0-9._/-]{1,119}$/u.test(release)) addAdapterOutputIssue(state, "execution.writingPolicy.release", "Invalid owned policy release.");
    const sha256 = parseBoundedString(state, policy.sha256, "execution.writingPolicy.sha256", 64);
    if (!/^[0-9a-f]{64}$/u.test(sha256)) addAdapterOutputIssue(state, "execution.writingPolicy.sha256", "Expected SHA-256.");
    const documents: { name: string; sha256: string }[] = [];
    if (!Array.isArray(policy.documents) || policy.documents.length !== 5) {
      addAdapterOutputIssue(state, "execution.writingPolicy.documents", "Expected five writing policy documents.");
    } else {
      for (const [index, value] of policy.documents.entries()) {
        const path = `execution.writingPolicy.documents.${index}`;
        const item = parseStrictRecord(state, value, path, ["name", "sha256"]) ?? {};
        const name = parseBoundedString(state, item.name, `${path}.name`, 80);
        const hash = parseBoundedString(state, item.sha256, `${path}.sha256`, 64);
        if (!["evidence.md", "resume.md", "cover-letter.md", "voice.md", "quality.md"].includes(name)
          || documents.some(document => document.name === name) || !/^[0-9a-f]{64}$/u.test(hash)) {
          addAdapterOutputIssue(state, path, "Invalid policy document provenance.");
        }
        documents.push({ name, sha256: hash });
      }
    }
    writingPolicy = { release, sha256, documents };
  }
  return {
    adapterRelease: parseBoundedString(
      state,
      record.adapterRelease,
      "execution.adapterRelease",
      ADAPTER_OUTPUT_LIMITS.maxReleaseCharacters,
    ),
    modelRelease: parseBoundedString(
      state,
      record.modelRelease,
      "execution.modelRelease",
      ADAPTER_OUTPUT_LIMITS.maxReleaseCharacters,
    ),
    requestId,
    ...(writingPolicy ? { writingPolicy } : {}),
  };
}

function parseAdapterCitation(
  state: AdapterOutputParseState,
  value: unknown,
  path: string,
): ApplicationDraftingCitation {
  const base = parseStrictRecord(
    state,
    value,
    path,
    ["sourceType", "evidenceVersionId", "field", "researchClaimId"],
  ) ?? {};
  const sourceType = parseEnum(
    state,
    base.sourceType,
    `${path}.sourceType`,
    ["CANDIDATE_EVIDENCE", "JOB_FIELD", "RESEARCH_CLAIM"] as const,
  );
  if (sourceType === "CANDIDATE_EVIDENCE") {
    if (Object.hasOwn(base, "field")) addAdapterOutputIssue(state, `${path}.field`, "Field is not allowed for a candidate-evidence citation.");
    if (Object.hasOwn(base, "researchClaimId")) addAdapterOutputIssue(state, `${path}.researchClaimId`, "Research claim is not allowed for a candidate-evidence citation.");
    return {
      sourceType,
      evidenceVersionId: parseBoundedString(
        state,
        base.evidenceVersionId,
        `${path}.evidenceVersionId`,
        ADAPTER_OUTPUT_LIMITS.maxIdCharacters,
      ),
    };
  }
  if (sourceType === "JOB_FIELD") {
    if (Object.hasOwn(base, "evidenceVersionId")) {
      addAdapterOutputIssue(state, `${path}.evidenceVersionId`, "Evidence version is not allowed for a job-field citation.");
    }
    if (Object.hasOwn(base, "researchClaimId")) {
      addAdapterOutputIssue(state, `${path}.researchClaimId`, "Research claim is not allowed for a job-field citation.");
    }
    return {
      sourceType,
      field: parseEnum(
        state,
        base.field,
        `${path}.field`,
        ["EMPLOYER_NAME", "TITLE", "LOCATION", "DESCRIPTION", "APPLY_URL"] as const,
      ),
    };
  }
  if (Object.hasOwn(base, "evidenceVersionId")) {
    addAdapterOutputIssue(state, `${path}.evidenceVersionId`, "Evidence version is not allowed for a job-field citation.");
  }
  if (Object.hasOwn(base, "field")) {
    addAdapterOutputIssue(state, `${path}.field`, "Job field is not allowed for a research citation.");
  }
  return {
    sourceType,
    researchClaimId: parseBoundedString(
      state,
      base.researchClaimId,
      `${path}.researchClaimId`,
      ADAPTER_OUTPUT_LIMITS.maxIdCharacters,
    ),
  };
}

function parseAdapterClaim(
  state: AdapterOutputParseState,
  value: unknown,
  index: number,
): ApplicationDraftingClaim {
  const path = `proposal.claims[${index}]`;
  const record = parseStrictRecord(
    state,
    value,
    path,
    ["claimId", "claimType", "surface", "statement", "citations"],
  ) ?? {};
  return {
    claimId: parseBoundedString(state, record.claimId, `${path}.claimId`, ADAPTER_OUTPUT_LIMITS.maxIdCharacters),
    claimType: parseEnum(
      state,
      record.claimType,
      `${path}.claimType`,
      ["CANDIDATE_EVIDENCE", "JOB_CONTEXT", "RESEARCH_CONTEXT"] as const,
    ),
    surface: parseEnum(state, record.surface, `${path}.surface`, ["RESUME", "COVER_LETTER"] as const),
    statement: parseBoundedString(
      state,
      record.statement,
      `${path}.statement`,
      ADAPTER_OUTPUT_LIMITS.maxStatementCharacters,
    ),
    citations: parseBoundedArray(
      state,
      record.citations,
      `${path}.citations`,
      ADAPTER_OUTPUT_LIMITS.maxCitationsPerClaim,
    ).map((citation, citationIndex) => parseAdapterCitation(
      state,
      citation,
      `${path}.citations[${citationIndex}]`,
    )),
  };
}

function parseAdapterResume(
  state: AdapterOutputParseState,
  value: unknown,
): ApplicationDraftingProposal["resume"] {
  const path = "proposal.resume";
  const record = parseStrictRecord(state, value, path, ["handling", "mode", "text", "claimIds"]) ?? {};
  const handling = parseEnum(
    state,
    record.handling,
    `${path}.handling`,
    ["PRESERVE_SERVER_SIDE", "TAILOR_FROM_APPROVED_EVIDENCE"] as const,
  );
  if (handling === "PRESERVE_SERVER_SIDE") {
    const mode = parseEnum(state, record.mode, `${path}.mode`, ["AS_UPLOADED"] as const);
    if (record.text !== null) addAdapterOutputIssue(state, `${path}.text`, "Preserved résumé text must be null; the server owns the original.");
    const claimIds = parseStringReferences(state, record.claimIds, `${path}.claimIds`);
    if (claimIds.length > 0) addAdapterOutputIssue(state, `${path}.claimIds`, "A preserved résumé cannot contain generated claims.");
    return { handling, mode, text: null, claimIds: [] };
  }
  const mode = parseEnum(
    state,
    record.mode,
    `${path}.mode`,
    ["REORDER_AND_TIGHTEN", "REWRITE_FROM_VERIFIED_FACTS"] as const,
  );
  return {
    handling,
    mode,
    text: parseBoundedString(state, record.text, `${path}.text`, ADAPTER_OUTPUT_LIMITS.maxResumeCharacters),
    claimIds: parseStringReferences(state, record.claimIds, `${path}.claimIds`),
  };
}

function parseAdapterProposal(
  state: AdapterOutputParseState,
  value: unknown,
): ApplicationDraftingProposal {
  const record = parseStrictRecord(
    state,
    value,
    "proposal",
    ["schemaVersion", "inputSnapshotId", "snapshotHash", "target", "claims", "resume", "coverLetter"],
  ) ?? {};
  if (record.schemaVersion !== 1) addAdapterOutputIssue(state, "proposal.schemaVersion", "Expected schema version 1.");
  const target = parseStrictRecord(
    state,
    record.target,
    "proposal.target",
    ["employerName", "title"],
  ) ?? {};
  const coverLetter = parseStrictRecord(
    state,
    record.coverLetter,
    "proposal.coverLetter",
    ["title", "paragraphs"],
  ) ?? {};
  const paragraphs = parseBoundedArray(
    state,
    coverLetter.paragraphs,
    "proposal.coverLetter.paragraphs",
    ADAPTER_OUTPUT_LIMITS.maxParagraphs,
  ).map((entry, index) => {
    const path = `proposal.coverLetter.paragraphs[${index}]`;
    const paragraph = parseStrictRecord(state, entry, path, ["paragraphId", "text", "claimIds"]) ?? {};
    return {
      paragraphId: parseBoundedString(
        state,
        paragraph.paragraphId,
        `${path}.paragraphId`,
        ADAPTER_OUTPUT_LIMITS.maxIdCharacters,
      ),
      text: parseBoundedString(
        state,
        paragraph.text,
        `${path}.text`,
        ADAPTER_OUTPUT_LIMITS.maxParagraphCharacters,
      ),
      claimIds: parseStringReferences(state, paragraph.claimIds, `${path}.claimIds`),
    };
  });
  const snapshotHash = parseBoundedString(state, record.snapshotHash, "proposal.snapshotHash", 64);
  if (!/^[0-9a-f]{64}$/u.test(snapshotHash)) {
    addAdapterOutputIssue(state, "proposal.snapshotHash", "Expected a lowercase SHA-256 hash.");
  }
  return {
    schemaVersion: 1,
    inputSnapshotId: parseBoundedString(
      state,
      record.inputSnapshotId,
      "proposal.inputSnapshotId",
      ADAPTER_OUTPUT_LIMITS.maxIdCharacters,
    ),
    snapshotHash,
    target: {
      employerName: parseBoundedString(
        state,
        target.employerName,
        "proposal.target.employerName",
        ADAPTER_OUTPUT_LIMITS.maxTitleCharacters,
      ),
      title: parseBoundedString(
        state,
        target.title,
        "proposal.target.title",
        ADAPTER_OUTPUT_LIMITS.maxTitleCharacters,
      ),
    },
    claims: parseBoundedArray(
      state,
      record.claims,
      "proposal.claims",
      ADAPTER_OUTPUT_LIMITS.maxClaims,
    ).map((claim, index) => parseAdapterClaim(state, claim, index)),
    resume: parseAdapterResume(state, record.resume),
    coverLetter: {
      title: parseBoundedString(
        state,
        coverLetter.title,
        "proposal.coverLetter.title",
        ADAPTER_OUTPUT_LIMITS.maxTitleCharacters,
      ),
      paragraphs,
    },
  };
}

/**
 * Fail-closed boundary for untrusted adapter/model data. Callers must obtain an
 * `ok: true` result here before invoking deterministic proposal validation.
 */
export function parseApplicationDraftingAdapterOutput(
  value: unknown,
): ParsedApplicationDraftingAdapterResult {
  const state: AdapterOutputParseState = { issues: [] };
  try {
    const base = parseStrictRecord(
      state,
      value,
      "output",
      ["status", "proposal", "reasonCode", "execution"],
    ) ?? {};
    const status = parseEnum(
      state,
      base.status,
      "output.status",
      ["COMPLETED", "REFUSED", "INCOMPLETE"] as const,
    );
    let parsed: ApplicationDraftingAdapterResult;
    if (status === "COMPLETED") {
      if (Object.hasOwn(base, "reasonCode")) addAdapterOutputIssue(state, "output.reasonCode", "Completed output cannot include a reason code.");
      parsed = {
        status,
        proposal: parseAdapterProposal(state, base.proposal),
        execution: parseAdapterExecution(state, base.execution),
      };
    } else {
      if (Object.hasOwn(base, "proposal")) addAdapterOutputIssue(state, "output.proposal", "Non-completed output cannot include a proposal.");
      parsed = {
        status,
        reasonCode: parseBoundedString(
          state,
          base.reasonCode,
          "output.reasonCode",
          ADAPTER_OUTPUT_LIMITS.maxReasonCodeCharacters,
        ),
        execution: parseAdapterExecution(state, base.execution),
      };
    }
    if (state.issues.length > 0) {
      return deepFreeze({
        ok: false as const,
        error: {
          code: "ADAPTER_OUTPUT_INVALID" as const,
          issues: state.issues,
        },
      }) as ParsedApplicationDraftingAdapterResult;
    }
    return deepFreeze({ ok: true as const, value: parsed }) as ParsedApplicationDraftingAdapterResult;
  } catch {
    addAdapterOutputIssue(state, "output", "Adapter output could not be read safely.");
    return deepFreeze({
      ok: false as const,
      error: {
        code: "ADAPTER_OUTPUT_INVALID" as const,
        issues: state.issues,
      },
    }) as ParsedApplicationDraftingAdapterResult;
  }
}

export type ApplicationDraftingValidationIssueCode =
  | "INPUT_INVALID"
  | "INPUT_BINDING_MISMATCH"
  | "TARGET_MISMATCH"
  | "MODE_MISMATCH"
  | "DUPLICATE_ID"
  | "UNKNOWN_CLAIM"
  | "UNUSED_CLAIM"
  | "CITATION_REQUIRED"
  | "CITATION_INVALID"
  | "EVIDENCE_USE_NOT_ALLOWED"
  | "SOURCE_RESUME_CHANGED"
  | "UNSUPPORTED_NUMBER"
  | "WRITING_POLICY_VIOLATION";

export type ApplicationDraftingValidationIssue = Readonly<{
  code: ApplicationDraftingValidationIssueCode;
  path: string;
  message: string;
}>;

export type ApplicationDraftingValidationReport = Readonly<{
  deterministicChecksPassed: boolean;
  validationScope: "STRUCTURAL_CITATION_AND_POLICY_ONLY";
  semanticEntailmentStatus: "REQUIRED_NOT_RUN";
  mayPersistAsPassed: false;
  issues: readonly ApplicationDraftingValidationIssue[];
}>;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function normalizePolicy(policy: ApplicationDraftingWritingPolicy): ApplicationDraftingWritingPolicy {
  const policyRelease = policy.policyRelease.trim();
  if (!policyRelease) throw new TypeError("Writing policy release is required.");
  assertPositiveInteger(policy.maxResumeWords, "Résumé word limit");
  assertPositiveInteger(policy.minCoverLetterWords, "Cover-letter minimum word count");
  assertPositiveInteger(policy.maxCoverLetterWords, "Cover-letter word limit");
  assertPositiveInteger(policy.minCoverLetterParagraphs, "Cover-letter minimum paragraph count");
  assertPositiveInteger(policy.maxCoverLetterParagraphs, "Cover-letter maximum paragraph count");
  assertPositiveInteger(
    policy.minCandidateEvidenceClaimsInCoverLetter,
    "Cover-letter candidate-evidence minimum",
  );
  assertPositiveInteger(policy.minRoleContextClaimsInCoverLetter, "Cover-letter role-context minimum");
  assertPositiveInteger(
    policy.minCandidateEvidenceClaimsInTailoredResume,
    "Tailored-résumé candidate-evidence minimum",
  );
  if (policy.minCoverLetterWords > policy.maxCoverLetterWords) {
    throw new TypeError("Cover-letter minimum word count cannot exceed the maximum.");
  }
  if (policy.minCoverLetterParagraphs > policy.maxCoverLetterParagraphs) {
    throw new TypeError("Cover-letter minimum paragraph count cannot exceed the maximum.");
  }
  return deepFreeze({
    policyRelease,
    prohibitedPhrases: [...new Set(
      policy.prohibitedPhrases.map((phrase) => phrase.trim()).filter(Boolean),
    )].sort((left, right) => left.localeCompare(right)),
    maxResumeWords: policy.maxResumeWords,
    minCoverLetterWords: policy.minCoverLetterWords,
    maxCoverLetterWords: policy.maxCoverLetterWords,
    minCoverLetterParagraphs: policy.minCoverLetterParagraphs,
    maxCoverLetterParagraphs: policy.maxCoverLetterParagraphs,
    minCandidateEvidenceClaimsInCoverLetter: policy.minCandidateEvidenceClaimsInCoverLetter,
    minRoleContextClaimsInCoverLetter: policy.minRoleContextClaimsInCoverLetter,
    minCandidateEvidenceClaimsInTailoredResume: policy.minCandidateEvidenceClaimsInTailoredResume,
  }) as ApplicationDraftingWritingPolicy;
}

export function buildApplicationDraftingRequest(
  context: ApplicationDraftingContext,
  writingPolicy: ApplicationDraftingWritingPolicy,
  approvedResearchClaims: readonly ApplicationDraftingResearchClaim[] = [],
): ApplicationDraftingRequest {
  const policy = normalizePolicy(writingPolicy);
  if (policy.policyRelease !== context.policy.writingPolicyRelease) {
    throw new TypeError("Writing policy release does not match the frozen input snapshot.");
  }
  if (context.policy.exactFactsAllowedInNarrativeContext !== false) {
    throw new TypeError("Exact application facts may not enter narrative drafting context.");
  }

  return deepFreeze({
    schemaRelease: APPLICATION_DRAFTING_SCHEMA_RELEASE,
    source: {
      inputSnapshotId: context.source.inputSnapshotId,
      snapshotHash: context.source.snapshotHash,
    },
    target: {
      employerName: context.job.employerName,
      title: context.job.title,
      description: context.job.description,
      location: context.job.location,
      employmentType: context.job.employmentType,
      workMode: context.job.workMode,
    },
    resume: context.policy.tailoringMode === "AS_UPLOADED"
      ? {
          handling: "PRESERVE_SERVER_SIDE" as const,
          tailoringMode: "AS_UPLOADED" as const,
          reviewedTextSha256: context.sourceResume.reviewedTextSha256,
        }
      : {
          handling: "TAILOR_FROM_APPROVED_EVIDENCE" as const,
          tailoringMode: context.policy.tailoringMode,
          reviewedTextSha256: context.sourceResume.reviewedTextSha256,
        },
    approvedNarrativeEvidence: context.approvedNarrativeEvidence.map((evidence) => ({
      evidenceVersionId: evidence.evidenceVersionId,
      claimText: evidence.claimText,
      usagePolicy: evidence.usagePolicy,
    })),
    approvedResearchClaims: approvedResearchClaims.map((claim) => ({
      researchClaimId: claim.researchClaimId,
      text: claim.text,
    })),
    policy: {
      tailoringMode: context.policy.tailoringMode,
      policyRelease: policy.policyRelease,
      prohibitedPhrases: [...policy.prohibitedPhrases],
      maxResumeWords: policy.maxResumeWords,
      minCoverLetterWords: policy.minCoverLetterWords,
      maxCoverLetterWords: policy.maxCoverLetterWords,
      minCoverLetterParagraphs: policy.minCoverLetterParagraphs,
      maxCoverLetterParagraphs: policy.maxCoverLetterParagraphs,
      minCandidateEvidenceClaimsInCoverLetter: policy.minCandidateEvidenceClaimsInCoverLetter,
      minRoleContextClaimsInCoverLetter: policy.minRoleContextClaimsInCoverLetter,
      minCandidateEvidenceClaimsInTailoredResume: policy.minCandidateEvidenceClaimsInTailoredResume,
    },
  }) as ApplicationDraftingRequest;
}

function issue(
  code: ApplicationDraftingValidationIssueCode,
  path: string,
  message: string,
): ApplicationDraftingValidationIssue {
  return Object.freeze({ code, path, message });
}

function wordCount(value: string): number {
  return value.trim().match(/\S+/gu)?.length ?? 0;
}

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function numericTokens(value: string): readonly string[] {
  return value.match(
    /(?<![\p{L}\p{N}])(?:[$+\-]?\d(?:[\d,]*\d)?(?:\.\d+)?(?:%|x)?)(?![\p{L}\p{N}])/giu,
  ) ?? [];
}

function normalizedNumericToken(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll(",", "");
}

function allProposalText(proposal: ApplicationDraftingProposal): readonly Readonly<{
  path: string;
  text: string;
}>[] {
  return [
    ...(typeof proposal.resume.text === "string"
      ? [{ path: "resume.text", text: proposal.resume.text }]
      : []),
    ...proposal.claims.map((claim, index) => ({
      path: `claims[${index}].statement`,
      text: claim.statement,
    })),
    ...proposal.coverLetter.paragraphs.map((paragraph, index) => ({
      path: `coverLetter.paragraphs[${index}].text`,
      text: paragraph.text,
    })),
  ];
}

export function validateApplicationDraftingProposal(
  context: ApplicationDraftingContext,
  writingPolicy: ApplicationDraftingWritingPolicy,
  proposal: ApplicationDraftingProposal,
  approvedResearchClaims: readonly ApplicationDraftingResearchClaim[] = [],
): ApplicationDraftingValidationReport {
  const issues: ApplicationDraftingValidationIssue[] = [];
  let policy: ApplicationDraftingWritingPolicy;
  try {
    policy = normalizePolicy(writingPolicy);
  } catch (error) {
    return deepFreeze({
      deterministicChecksPassed: false,
      validationScope: "STRUCTURAL_CITATION_AND_POLICY_ONLY" as const,
      semanticEntailmentStatus: "REQUIRED_NOT_RUN" as const,
      mayPersistAsPassed: false as const,
      issues: [issue("INPUT_INVALID", "writingPolicy", error instanceof Error ? error.message : "Writing policy is invalid.")],
    }) as ApplicationDraftingValidationReport;
  }

  if (proposal.schemaVersion !== 1) {
    issues.push(issue("INPUT_INVALID", "schemaVersion", "Drafting proposal schema version is invalid."));
  }
  if (typeof proposal.resume.text === "string" && !proposal.resume.text.trim()) {
    issues.push(issue("INPUT_INVALID", "resume.text", "Drafted résumé text cannot be empty."));
  }
  if (!proposal.coverLetter.title.trim()) {
    issues.push(issue("INPUT_INVALID", "coverLetter.title", "Cover letter needs a non-empty title."));
  }
  if (policy.policyRelease !== context.policy.writingPolicyRelease) {
    issues.push(issue("INPUT_BINDING_MISMATCH", "writingPolicy.policyRelease", "The proposal validator must use the policy frozen by the input snapshot."));
  }
  if (
    proposal.inputSnapshotId !== context.source.inputSnapshotId ||
    proposal.snapshotHash !== context.source.snapshotHash
  ) {
    issues.push(issue("INPUT_BINDING_MISMATCH", "proposal", "The proposal is not bound to this immutable input snapshot."));
  }
  if (proposal.target.employerName !== context.job.employerName) {
    issues.push(issue("TARGET_MISMATCH", "target.employerName", "The target employer must match the frozen job version exactly."));
  }
  if (proposal.target.title !== context.job.title) {
    issues.push(issue("TARGET_MISMATCH", "target.title", "The target title must match the frozen job version exactly."));
  }
  if (proposal.resume.mode !== context.policy.tailoringMode) {
    issues.push(issue("MODE_MISMATCH", "resume.mode", "The résumé mode must match the candidate's frozen setting."));
  }
  const expectedResumeHandling: ApplicationDraftingResumeHandling =
    context.policy.tailoringMode === "AS_UPLOADED"
      ? "PRESERVE_SERVER_SIDE"
      : "TAILOR_FROM_APPROVED_EVIDENCE";
  if (proposal.resume.handling !== expectedResumeHandling) {
    issues.push(issue("MODE_MISMATCH", "resume.handling", "Résumé handling must match the candidate's frozen tailoring mode."));
  }

  const claimIds = proposal.claims.map((claim) => claim.claimId);
  for (const duplicate of duplicateValues(claimIds)) {
    issues.push(issue("DUPLICATE_ID", "claims", `Duplicate claim ID: ${duplicate}.`));
  }
  const paragraphIds = proposal.coverLetter.paragraphs.map((paragraph) => paragraph.paragraphId);
  for (const duplicate of duplicateValues(paragraphIds)) {
    issues.push(issue("DUPLICATE_ID", "coverLetter.paragraphs", `Duplicate paragraph ID: ${duplicate}.`));
  }

  const claimsById = new Map(proposal.claims.map((claim) => [claim.claimId, claim] as const));
  const evidenceById = new Map(
    context.approvedNarrativeEvidence.map((evidence) => [evidence.evidenceVersionId, evidence] as const),
  );
  const researchById = new Map(
    approvedResearchClaims.map((claim) => [claim.researchClaimId, claim] as const),
  );
  const usedClaimIds = [
    ...proposal.resume.claimIds,
    ...proposal.coverLetter.paragraphs.flatMap((paragraph) => paragraph.claimIds),
  ];

  for (const [index, claim] of proposal.claims.entries()) {
    const path = `claims[${index}]`;
    if (!claim.claimId.trim() || !claim.statement.trim()) {
      issues.push(issue("INPUT_INVALID", path, "Every claim needs a stable ID and non-empty statement."));
    }
    if (claim.citations.length === 0) {
      issues.push(issue("CITATION_REQUIRED", `${path}.citations`, "Every generated claim needs at least one source citation."));
    }
    if (
      claim.claimType !== "CANDIDATE_EVIDENCE" &&
      claim.claimType !== "JOB_CONTEXT" &&
      claim.claimType !== "RESEARCH_CONTEXT"
    ) {
      issues.push(issue("INPUT_INVALID", `${path}.claimType`, "Claim type is invalid."));
    }
    if (claim.surface !== "RESUME" && claim.surface !== "COVER_LETTER") {
      issues.push(issue("INPUT_INVALID", `${path}.surface`, "Claim surface is invalid."));
    }
    const hasEvidenceCitation = claim.citations.some((citation) => citation.sourceType === "CANDIDATE_EVIDENCE");
    const hasJobCitation = claim.citations.some((citation) => citation.sourceType === "JOB_FIELD");
    const hasResearchCitation = claim.citations.some((citation) => citation.sourceType === "RESEARCH_CLAIM");
    if (claim.claimType === "CANDIDATE_EVIDENCE" && !hasEvidenceCitation) {
      issues.push(issue("CITATION_REQUIRED", `${path}.citations`, "Candidate claims must cite approved candidate evidence."));
    }
    if (claim.claimType === "JOB_CONTEXT" && !hasJobCitation) {
      issues.push(issue("CITATION_REQUIRED", `${path}.citations`, "Job-context claims must cite a frozen job field."));
    }
    if (claim.claimType === "RESEARCH_CONTEXT" && !hasResearchCitation) {
      issues.push(issue("CITATION_REQUIRED", `${path}.citations`, "Research claims must cite an approved research-bundle claim."));
    }
    for (const [citationIndex, citation] of claim.citations.entries()) {
      const citationPath = `${path}.citations[${citationIndex}]`;
      if (citation.sourceType === "CANDIDATE_EVIDENCE") {
        const evidence = evidenceById.get(citation.evidenceVersionId);
        if (!evidence) {
          issues.push(issue("CITATION_INVALID", citationPath, "The cited evidence version is not in the immutable input snapshot."));
        } else if (claim.surface === "RESUME" && evidence.usagePolicy !== "RESUME_AND_COVER_LETTER") {
          issues.push(issue("EVIDENCE_USE_NOT_ALLOWED", citationPath, "Cover-letter-only evidence may not support résumé text."));
        }
      } else if (citation.sourceType === "JOB_FIELD") {
        const allowedFields: readonly ApplicationDraftingJobField[] = [
          "EMPLOYER_NAME",
          "TITLE",
          "LOCATION",
          "DESCRIPTION",
          "APPLY_URL",
        ];
        if (!allowedFields.includes(citation.field)) {
          issues.push(issue("CITATION_INVALID", citationPath, "The cited job field is invalid."));
        }
      } else if (citation.sourceType === "RESEARCH_CLAIM") {
        if (!researchById.has(citation.researchClaimId)) {
          issues.push(issue("CITATION_INVALID", citationPath, "The cited research claim is not in the validated research bundle."));
        }
      } else {
        issues.push(issue("CITATION_INVALID", citationPath, "Citation source type is invalid."));
      }
    }
  }

  proposal.coverLetter.paragraphs.forEach((paragraph, index) => {
    if (!paragraph.paragraphId.trim() || !paragraph.text.trim()) {
      issues.push(issue("INPUT_INVALID", `coverLetter.paragraphs[${index}]`, "Every cover-letter paragraph needs a stable ID and non-empty text."));
    }
  });

  for (const [index, claimId] of usedClaimIds.entries()) {
    if (!claimsById.has(claimId)) {
      issues.push(issue("UNKNOWN_CLAIM", `claimReferences[${index}]`, `Unknown claim ID: ${claimId}.`));
    }
  }
  for (const claim of proposal.claims) {
    if (!usedClaimIds.includes(claim.claimId)) {
      issues.push(issue("UNUSED_CLAIM", "claims", `Claim ${claim.claimId} is not attached to either generated document.`));
    }
  }
  for (const claimId of proposal.resume.claimIds) {
    const claim = claimsById.get(claimId);
    if (claim && claim.surface !== "RESUME") {
      issues.push(issue("CITATION_INVALID", "resume.claimIds", `Claim ${claimId} is not authorized for résumé use.`));
    }
  }
  for (const paragraph of proposal.coverLetter.paragraphs) {
    for (const claimId of paragraph.claimIds) {
      const claim = claimsById.get(claimId);
      if (claim && claim.surface !== "COVER_LETTER") {
        issues.push(issue("CITATION_INVALID", "coverLetter.paragraphs.claimIds", `Claim ${claimId} is not authorized for cover-letter use.`));
      }
    }
  }

  if (context.policy.tailoringMode === "AS_UPLOADED") {
    if (
      proposal.resume.handling !== "PRESERVE_SERVER_SIDE" ||
      proposal.resume.text !== null ||
      proposal.resume.claimIds.length > 0
    ) {
      issues.push(issue("SOURCE_RESUME_CHANGED", "resume", "AS_UPLOADED is preserved from the reviewed server-side source and cannot contain provider-generated résumé text or claims."));
    }
  } else if (
    proposal.resume.handling !== "TAILOR_FROM_APPROVED_EVIDENCE" ||
    typeof proposal.resume.text !== "string" ||
    !proposal.resume.text.trim() ||
    proposal.resume.claimIds.length === 0
  ) {
    issues.push(issue("CITATION_REQUIRED", "resume", "A tailored résumé must contain provider-generated text supported by approved narrative-evidence claims."));
  }

  if (typeof proposal.resume.text === "string" && wordCount(proposal.resume.text) > policy.maxResumeWords) {
    issues.push(issue("WRITING_POLICY_VIOLATION", "resume.text", `Résumé exceeds the ${policy.maxResumeWords}-word limit.`));
  }
  const coverLetterText = proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
  if (wordCount(coverLetterText) > policy.maxCoverLetterWords) {
    issues.push(issue("WRITING_POLICY_VIOLATION", "coverLetter", `Cover letter exceeds the ${policy.maxCoverLetterWords}-word limit.`));
  }

  const generatedText = allProposalText(proposal);
  for (const phrase of policy.prohibitedPhrases) {
    const normalizedPhrase = phrase.toLocaleLowerCase("en-US");
    for (const value of generatedText) {
      if (value.text.toLocaleLowerCase("en-US").includes(normalizedPhrase)) {
        issues.push(issue("WRITING_POLICY_VIOLATION", value.path, `Generated copy contains prohibited phrase: ${phrase}.`));
      }
    }
  }

  const sourceNumbers = new Set(
    numericTokens([
      context.job.employerName,
      context.job.title,
      context.job.description,
      context.job.location ?? "",
      ...context.approvedNarrativeEvidence.map((evidence) => evidence.claimText),
      ...approvedResearchClaims.map((claim) => claim.text),
    ].join("\n")).map(normalizedNumericToken),
  );
  for (const value of generatedText) {
    for (const token of numericTokens(value.text)) {
      if (!sourceNumbers.has(normalizedNumericToken(token))) {
        issues.push(issue("UNSUPPORTED_NUMBER", value.path, `Generated number ${token} does not appear in the frozen source material.`));
      }
    }
  }

  return deepFreeze({
    deterministicChecksPassed: issues.length === 0,
    validationScope: "STRUCTURAL_CITATION_AND_POLICY_ONLY" as const,
    semanticEntailmentStatus: "REQUIRED_NOT_RUN" as const,
    mayPersistAsPassed: false as const,
    issues,
  }) as ApplicationDraftingValidationReport;
}
import type { ApplicationWritingPolicyProvenance } from "./application-writing-policy.ts";
