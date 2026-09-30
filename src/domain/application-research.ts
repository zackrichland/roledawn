import { createHash } from "node:crypto";

export type ApplicationResearchSourceType =
  | "JOB_POSTING"
  | "EMPLOYER_WEBSITE"
  | "REGULATORY_FILING"
  | "PRIMARY_PUBLICATION";

export type ApplicationResearchClaimType =
  | "COMPANY_CONTEXT"
  | "ROLE_REQUIREMENT"
  | "HIRING_SIGNAL"
  | "ROLE_CONSTRAINT";

export type ApplicationResearchConflictStatus =
  | "NO_CONFLICT"
  | "RESOLVED"
  | "UNRESOLVED";

export type ApplicationResearchBinding = Readonly<{
  inputSnapshotId: string;
  inputSnapshotHash: string;
  applicationId: string;
  jobVersionId: string;
  jobContentSha256: string;
}>;

export type ApplicationResearchFreshnessPolicy = Readonly<{
  policyRelease: string;
  maxAgeMs: number;
  maxFutureSkewMs: number;
}>;

export type ApplicationResearchSource = Readonly<{
  sourceId: string;
  sourceType: ApplicationResearchSourceType;
  url: string;
  title: string;
  retrievedAt: string;
}>;

export type ApplicationResearchCitation = Readonly<{
  sourceId: string;
  locator: string;
  excerpt: string | null;
}>;

export type ApplicationResearchClaim = Readonly<{
  claimId: string;
  claimType: ApplicationResearchClaimType;
  text: string;
  conflictStatus: ApplicationResearchConflictStatus;
  conflictNote: string | null;
  citations: readonly ApplicationResearchCitation[];
}>;

/**
 * Provider-neutral research output. Binding and expiry are deliberately absent:
 * the trusted application worker adds both after parsing this unknown output.
 * This schema has no candidate evidence, candidate facts, or candidate PII fields.
 */
export type ApplicationResearchProposal = Readonly<{
  schemaVersion: 1;
  researcherRelease: string;
  sources: readonly ApplicationResearchSource[];
  claims: readonly ApplicationResearchClaim[];
}>;

export type ApplicationResearchBundleManifest = Readonly<{
  schema_version: 1;
  objective: "APPLICATION_MATERIALS";
  binding: Readonly<{
    input_snapshot_id: string;
    input_snapshot_hash: string;
    application_id: string;
    job_version_id: string;
    job_content_sha256: string;
  }>;
  research: Readonly<{
    researcher_release: string;
    sources: readonly Readonly<{
      source_id: string;
      source_type: ApplicationResearchSourceType;
      url: string;
      title: string;
      retrieved_at: string;
    }>[];
    claims: readonly Readonly<{
      claim_id: string;
      claim_type: ApplicationResearchClaimType;
      text: string;
      conflict_status: ApplicationResearchConflictStatus;
      conflict_note: string | null;
      citations: readonly Readonly<{
        source_id: string;
        locator: string;
        excerpt: string | null;
      }>[];
    }>[];
  }>;
  freshness: Readonly<{
    policy_release: string;
    max_age_ms: number;
    oldest_source_retrieved_at: string;
    newest_source_retrieved_at: string;
    expires_at: string;
  }>;
}>;

export type BuiltApplicationResearchBundle = Readonly<{
  manifest: ApplicationResearchBundleManifest;
  bundleHash: string;
  researcherRelease: string;
  freshnessPolicyRelease: string;
  freshnessExpiresAt: string;
}>;

export type ApplicationResearchIssueCode =
  | "INPUT_INVALID"
  | "UNKNOWN_FIELD"
  | "DUPLICATE_ID"
  | "CITATION_INVALID"
  | "CONFLICT_INVALID"
  | "BINDING_MISMATCH"
  | "FRESHNESS_INVALID"
  | "BUNDLE_HASH_MISMATCH";

export type ApplicationResearchIssue = Readonly<{
  code: ApplicationResearchIssueCode;
  path: string;
  message: string;
}>;

export type ParsedApplicationResearchProposal =
  | Readonly<{ ok: true; value: ApplicationResearchProposal }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "APPLICATION_RESEARCH_OUTPUT_INVALID";
        issues: readonly ApplicationResearchIssue[];
      }>;
    }>;

export type ApplicationResearchBuildResult =
  | Readonly<{ ok: true; value: BuiltApplicationResearchBundle }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "APPLICATION_RESEARCH_INVALID";
        issues: readonly ApplicationResearchIssue[];
      }>;
    }>;

export type ApplicationResearchValidationReport = Readonly<{
  valid: boolean;
  fresh: boolean;
  issues: readonly ApplicationResearchIssue[];
}>;

const LIMITS = Object.freeze({
  maxIssues: 64,
  maxSources: 32,
  maxClaims: 64,
  maxCitationsPerClaim: 8,
  maxIdCharacters: 160,
  maxReleaseCharacters: 120,
  maxUrlCharacters: 2_048,
  maxTitleCharacters: 320,
  maxClaimCharacters: 2_000,
  maxLocatorCharacters: 500,
  maxExcerptCharacters: 2_000,
  maxConflictNoteCharacters: 2_000,
});

type ParseState = { issues: ApplicationResearchIssue[] };
type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };

function issue(
  code: ApplicationResearchIssueCode,
  path: string,
  message: string,
): ApplicationResearchIssue {
  return Object.freeze({ code, path, message });
}

function addIssue(
  state: ParseState,
  code: ApplicationResearchIssueCode,
  path: string,
  message: string,
): void {
  if (state.issues.length < LIMITS.maxIssues) state.issues.push(issue(code, path, message));
}

function strictRecord(
  state: ParseState,
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addIssue(state, "INPUT_INVALID", path, "Expected an object.");
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) addIssue(state, "UNKNOWN_FIELD", `${path}.${key}`, "Unknown field.");
  }
  return record;
}

function boundedArray(
  state: ParseState,
  value: unknown,
  path: string,
  maxItems: number,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    addIssue(state, "INPUT_INVALID", path, "Expected an array.");
    return [];
  }
  if (value.length > maxItems) {
    addIssue(state, "INPUT_INVALID", path, `Array exceeds the ${maxItems}-item limit.`);
    return value.slice(0, maxItems);
  }
  return value;
}

function boundedString(
  state: ParseState,
  value: unknown,
  path: string,
  maxCharacters: number,
): string {
  if (typeof value !== "string") {
    addIssue(state, "INPUT_INVALID", path, "Expected a string.");
    return "";
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxCharacters) {
    addIssue(state, "INPUT_INVALID", path, `Expected 1-${maxCharacters} non-whitespace characters.`);
    return normalized.slice(0, maxCharacters);
  }
  return normalized;
}

function stableId(state: ParseState, value: unknown, path: string): string {
  const parsed = boundedString(state, value, path, LIMITS.maxIdCharacters);
  if (parsed && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(parsed)) {
    addIssue(state, "INPUT_INVALID", path, "Expected a stable ID containing only letters, numbers, dot, underscore, colon, or hyphen.");
  }
  return parsed;
}

function enumValue<T extends string>(
  state: ParseState,
  value: unknown,
  path: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    addIssue(state, "INPUT_INVALID", path, `Expected one of: ${values.join(", ")}.`);
    return values[0]!;
  }
  return value as T;
}

function nullableBoundedString(
  state: ParseState,
  value: unknown,
  path: string,
  maxCharacters: number,
): string | null {
  if (value === null) return null;
  return boundedString(state, value, path, maxCharacters);
}

function timestamp(state: ParseState, value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  ) {
    addIssue(state, "INPUT_INVALID", path, "Expected an RFC 3339 timestamp.");
    return "";
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    addIssue(state, "INPUT_INVALID", path, "Expected an RFC 3339 timestamp.");
    return "";
  }
  return new Date(milliseconds).toISOString();
}

function publicHttpsUrl(state: ParseState, value: unknown, path: string): string {
  const raw = boundedString(state, value, path, LIMITS.maxUrlCharacters);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      addIssue(state, "INPUT_INVALID", path, "Expected a public HTTPS URL without embedded credentials.");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    addIssue(state, "INPUT_INVALID", path, "Expected a valid public HTTPS URL.");
    return raw;
  }
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): Canonical {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Research manifest numbers must be finite.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new TypeError("Research manifest values must be JSON-compatible.");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function parseSource(
  state: ParseState,
  value: unknown,
  index: number,
): ApplicationResearchSource {
  const path = `sources[${index}]`;
  const record = strictRecord(
    state,
    value,
    path,
    ["sourceId", "sourceType", "url", "title", "retrievedAt"],
  ) ?? {};
  return {
    sourceId: stableId(state, record.sourceId, `${path}.sourceId`),
    sourceType: enumValue(
      state,
      record.sourceType,
      `${path}.sourceType`,
      ["JOB_POSTING", "EMPLOYER_WEBSITE", "REGULATORY_FILING", "PRIMARY_PUBLICATION"] as const,
    ),
    url: publicHttpsUrl(state, record.url, `${path}.url`),
    title: boundedString(state, record.title, `${path}.title`, LIMITS.maxTitleCharacters),
    retrievedAt: timestamp(state, record.retrievedAt, `${path}.retrievedAt`),
  };
}

function parseCitation(
  state: ParseState,
  value: unknown,
  claimIndex: number,
  citationIndex: number,
): ApplicationResearchCitation {
  const path = `claims[${claimIndex}].citations[${citationIndex}]`;
  const record = strictRecord(
    state,
    value,
    path,
    ["sourceId", "locator", "excerpt"],
  ) ?? {};
  return {
    sourceId: stableId(state, record.sourceId, `${path}.sourceId`),
    locator: boundedString(state, record.locator, `${path}.locator`, LIMITS.maxLocatorCharacters),
    excerpt: nullableBoundedString(
      state,
      record.excerpt,
      `${path}.excerpt`,
      LIMITS.maxExcerptCharacters,
    ),
  };
}

function parseClaim(
  state: ParseState,
  value: unknown,
  index: number,
): ApplicationResearchClaim {
  const path = `claims[${index}]`;
  const record = strictRecord(
    state,
    value,
    path,
    ["claimId", "claimType", "text", "conflictStatus", "conflictNote", "citations"],
  ) ?? {};
  return {
    claimId: stableId(state, record.claimId, `${path}.claimId`),
    claimType: enumValue(
      state,
      record.claimType,
      `${path}.claimType`,
      ["COMPANY_CONTEXT", "ROLE_REQUIREMENT", "HIRING_SIGNAL", "ROLE_CONSTRAINT"] as const,
    ),
    text: boundedString(state, record.text, `${path}.text`, LIMITS.maxClaimCharacters),
    conflictStatus: enumValue(
      state,
      record.conflictStatus,
      `${path}.conflictStatus`,
      ["NO_CONFLICT", "RESOLVED", "UNRESOLVED"] as const,
    ),
    conflictNote: nullableBoundedString(
      state,
      record.conflictNote,
      `${path}.conflictNote`,
      LIMITS.maxConflictNoteCharacters,
    ),
    citations: boundedArray(
      state,
      record.citations,
      `${path}.citations`,
      LIMITS.maxCitationsPerClaim,
    ).map((citation, citationIndex) => parseCitation(state, citation, index, citationIndex)),
  };
}

function validateProposalRelations(
  state: ParseState,
  proposal: ApplicationResearchProposal,
): void {
  const sourceIds = new Set<string>();
  const sourceUrls = new Set<string>();
  proposal.sources.forEach((source, index) => {
    if (sourceIds.has(source.sourceId)) {
      addIssue(state, "DUPLICATE_ID", `sources[${index}].sourceId`, "Source IDs must be unique.");
    }
    if (sourceUrls.has(source.url)) {
      addIssue(state, "DUPLICATE_ID", `sources[${index}].url`, "Canonical source URLs must be unique.");
    }
    sourceIds.add(source.sourceId);
    sourceUrls.add(source.url);
  });

  const claimIds = new Set<string>();
  const citedAcrossBundle = new Set<string>();
  proposal.claims.forEach((claim, index) => {
    const path = `claims[${index}]`;
    if (claimIds.has(claim.claimId)) {
      addIssue(state, "DUPLICATE_ID", `${path}.claimId`, "Claim IDs must be unique.");
    }
    claimIds.add(claim.claimId);
    if (claim.citations.length === 0) {
      addIssue(state, "CITATION_INVALID", `${path}.citations`, "Every research claim needs at least one source citation.");
    }
    const citedSourceIds = new Set<string>();
    claim.citations.forEach((citation, citationIndex) => {
      if (!sourceIds.has(citation.sourceId)) {
        addIssue(
          state,
          "CITATION_INVALID",
          `${path}.citations[${citationIndex}].sourceId`,
          "Citation source is not present in this research bundle.",
        );
      }
      if (citedSourceIds.has(citation.sourceId)) {
        addIssue(
          state,
          "CITATION_INVALID",
          `${path}.citations[${citationIndex}].sourceId`,
          "A claim may cite each source only once.",
        );
      }
      citedSourceIds.add(citation.sourceId);
      citedAcrossBundle.add(citation.sourceId);
    });
    if (claim.conflictStatus === "NO_CONFLICT" && claim.conflictNote !== null) {
      addIssue(state, "CONFLICT_INVALID", `${path}.conflictNote`, "A no-conflict claim must not include a conflict note.");
    }
    if (claim.conflictStatus !== "NO_CONFLICT") {
      if (!claim.conflictNote) {
        addIssue(state, "CONFLICT_INVALID", `${path}.conflictNote`, "A conflicted claim needs an explanatory note.");
      }
      if (citedSourceIds.size < 2) {
        addIssue(state, "CONFLICT_INVALID", `${path}.citations`, "A conflicted claim must cite at least two distinct sources.");
      }
    }
  });
  proposal.sources.forEach((source, index) => {
    if (!citedAcrossBundle.has(source.sourceId)) {
      addIssue(
        state,
        "CITATION_INVALID",
        `sources[${index}]`,
        "Every source in the bundle must support at least one claim.",
      );
    }
  });
}

export function parseApplicationResearchProposal(
  value: unknown,
): ParsedApplicationResearchProposal {
  const state: ParseState = { issues: [] };
  try {
    const record = strictRecord(
      state,
      value,
      "output",
      ["schemaVersion", "researcherRelease", "sources", "claims"],
    ) ?? {};
    if (record.schemaVersion !== 1) {
      addIssue(state, "INPUT_INVALID", "output.schemaVersion", "Expected schema version 1.");
    }
    const proposal: ApplicationResearchProposal = {
      schemaVersion: 1,
      researcherRelease: boundedString(
        state,
        record.researcherRelease,
        "output.researcherRelease",
        LIMITS.maxReleaseCharacters,
      ),
      sources: boundedArray(state, record.sources, "output.sources", LIMITS.maxSources)
        .map((source, index) => parseSource(state, source, index)),
      claims: boundedArray(state, record.claims, "output.claims", LIMITS.maxClaims)
        .map((claim, index) => parseClaim(state, claim, index)),
    };
    if (proposal.sources.length === 0) {
      addIssue(state, "INPUT_INVALID", "output.sources", "At least one public source is required.");
    }
    if (proposal.claims.length === 0) {
      addIssue(state, "INPUT_INVALID", "output.claims", "At least one source-backed claim is required.");
    }
    validateProposalRelations(state, proposal);
    if (state.issues.length > 0) {
      return deepFreeze({
        ok: false as const,
        error: {
          code: "APPLICATION_RESEARCH_OUTPUT_INVALID" as const,
          issues: state.issues,
        },
      }) as ParsedApplicationResearchProposal;
    }
    return deepFreeze({ ok: true as const, value: proposal }) as ParsedApplicationResearchProposal;
  } catch {
    addIssue(state, "INPUT_INVALID", "output", "Research output could not be read safely.");
    return deepFreeze({
      ok: false as const,
      error: {
        code: "APPLICATION_RESEARCH_OUTPUT_INVALID" as const,
        issues: state.issues,
      },
    }) as ParsedApplicationResearchProposal;
  }
}

function validBinding(
  binding: ApplicationResearchBinding,
  issues: ApplicationResearchIssue[],
): boolean {
  const identifiers: readonly [keyof ApplicationResearchBinding, string][] = [
    ["inputSnapshotId", "inputSnapshotId"],
    ["applicationId", "applicationId"],
    ["jobVersionId", "jobVersionId"],
  ];
  for (const [key, path] of identifiers) {
    if (typeof binding[key] !== "string" || !binding[key].trim()) {
      issues.push(issue("INPUT_INVALID", `binding.${path}`, "A stable binding ID is required."));
    }
  }
  const hashes: readonly ["inputSnapshotHash" | "jobContentSha256", string][] = [
    ["inputSnapshotHash", "inputSnapshotHash"],
    ["jobContentSha256", "jobContentSha256"],
  ];
  for (const [key, path] of hashes) {
    if (!/^[0-9a-f]{64}$/u.test(binding[key])) {
      issues.push(issue("INPUT_INVALID", `binding.${path}`, "Expected a lowercase SHA-256 hash."));
    }
  }
  return issues.length === 0;
}

function validFreshnessPolicy(
  policy: ApplicationResearchFreshnessPolicy,
  issues: ApplicationResearchIssue[],
): boolean {
  if (!policy.policyRelease.trim() || policy.policyRelease.length > LIMITS.maxReleaseCharacters) {
    issues.push(issue("INPUT_INVALID", "freshnessPolicy.policyRelease", "A 1-120 character policy release is required."));
  }
  if (!Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs <= 0) {
    issues.push(issue("INPUT_INVALID", "freshnessPolicy.maxAgeMs", "Maximum age must be a positive safe integer."));
  }
  if (!Number.isSafeInteger(policy.maxFutureSkewMs) || policy.maxFutureSkewMs < 0) {
    issues.push(issue("INPUT_INVALID", "freshnessPolicy.maxFutureSkewMs", "Future skew must be a non-negative safe integer."));
  }
  return issues.length === 0;
}

function normalizedCompletedAt(value: string, issues: ApplicationResearchIssue[]): string | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    issues.push(issue("INPUT_INVALID", "completedAt", "Expected an RFC 3339 completion timestamp."));
    return null;
  }
  return new Date(milliseconds).toISOString();
}

function byString<T>(selector: (value: T) => string): (left: T, right: T) => number {
  return (left, right) => selector(left).localeCompare(selector(right));
}

export function buildApplicationResearchBundle(input: Readonly<{
  binding: ApplicationResearchBinding;
  freshnessPolicy: ApplicationResearchFreshnessPolicy;
  completedAt: string;
  proposal: unknown;
}>): ApplicationResearchBuildResult {
  const parsed = parseApplicationResearchProposal(input.proposal);
  if (!parsed.ok) {
    return deepFreeze({
      ok: false as const,
      error: { code: "APPLICATION_RESEARCH_INVALID" as const, issues: parsed.error.issues },
    }) as ApplicationResearchBuildResult;
  }

  const issues: ApplicationResearchIssue[] = [];
  validBinding(input.binding, issues);
  validFreshnessPolicy(input.freshnessPolicy, issues);
  const completedAt = normalizedCompletedAt(input.completedAt, issues);
  if (!completedAt || issues.length > 0) {
    return deepFreeze({
      ok: false as const,
      error: { code: "APPLICATION_RESEARCH_INVALID" as const, issues },
    }) as ApplicationResearchBuildResult;
  }

  const completedMilliseconds = Date.parse(completedAt);
  const retrievalMilliseconds = parsed.value.sources.map((source) => Date.parse(source.retrievedAt));
  const newestRetrievedMilliseconds = Math.max(...retrievalMilliseconds);
  const oldestRetrievedMilliseconds = Math.min(...retrievalMilliseconds);
  if (newestRetrievedMilliseconds > completedMilliseconds + input.freshnessPolicy.maxFutureSkewMs) {
    issues.push(issue("FRESHNESS_INVALID", "sources.retrievedAt", "A source retrieval timestamp exceeds the allowed future clock skew."));
  }
  const expiresMilliseconds = oldestRetrievedMilliseconds + input.freshnessPolicy.maxAgeMs;
  if (expiresMilliseconds <= completedMilliseconds) {
    issues.push(issue("FRESHNESS_INVALID", "freshness.expiresAt", "The oldest source is already stale under the selected freshness policy."));
  }
  if (issues.length > 0) {
    return deepFreeze({
      ok: false as const,
      error: { code: "APPLICATION_RESEARCH_INVALID" as const, issues },
    }) as ApplicationResearchBuildResult;
  }

  const sortedSources = [...parsed.value.sources].sort(byString((source) => source.sourceId));
  const sortedClaims = [...parsed.value.claims]
    .map((claim) => ({
      ...claim,
      citations: [...claim.citations].sort(byString((citation) =>
        `${citation.sourceId}\u0000${citation.locator}\u0000${citation.excerpt ?? ""}`)),
    }))
    .sort(byString((claim) => claim.claimId));

  const manifest: ApplicationResearchBundleManifest = {
    schema_version: 1,
    objective: "APPLICATION_MATERIALS",
    binding: {
      input_snapshot_id: input.binding.inputSnapshotId.trim(),
      input_snapshot_hash: input.binding.inputSnapshotHash,
      application_id: input.binding.applicationId.trim(),
      job_version_id: input.binding.jobVersionId.trim(),
      job_content_sha256: input.binding.jobContentSha256,
    },
    research: {
      researcher_release: parsed.value.researcherRelease,
      sources: sortedSources.map((source) => ({
        source_id: source.sourceId,
        source_type: source.sourceType,
        url: source.url,
        title: source.title,
        retrieved_at: source.retrievedAt,
      })),
      claims: sortedClaims.map((claim) => ({
        claim_id: claim.claimId,
        claim_type: claim.claimType,
        text: claim.text,
        conflict_status: claim.conflictStatus,
        conflict_note: claim.conflictNote,
        citations: claim.citations.map((citation) => ({
          source_id: citation.sourceId,
          locator: citation.locator,
          excerpt: citation.excerpt,
        })),
      })),
    },
    freshness: {
      policy_release: input.freshnessPolicy.policyRelease.trim(),
      max_age_ms: input.freshnessPolicy.maxAgeMs,
      oldest_source_retrieved_at: new Date(oldestRetrievedMilliseconds).toISOString(),
      newest_source_retrieved_at: new Date(newestRetrievedMilliseconds).toISOString(),
      expires_at: new Date(expiresMilliseconds).toISOString(),
    },
  };
  const frozenManifest = deepFreeze(manifest) as ApplicationResearchBundleManifest;
  return deepFreeze({
    ok: true as const,
    value: {
      manifest: frozenManifest,
      bundleHash: sha256(frozenManifest),
      researcherRelease: parsed.value.researcherRelease,
      freshnessPolicyRelease: input.freshnessPolicy.policyRelease.trim(),
      freshnessExpiresAt: frozenManifest.freshness.expires_at,
    },
  }) as ApplicationResearchBuildResult;
}

export function isApplicationResearchClaimUsable(
  claim: Pick<ApplicationResearchClaim, "conflictStatus">,
): boolean {
  return claim.conflictStatus !== "UNRESOLVED";
}

export function validateApplicationResearchBundle(
  bundle: BuiltApplicationResearchBundle,
  expectedBinding: ApplicationResearchBinding,
  expectedFreshnessPolicyRelease: string,
  at: string,
): ApplicationResearchValidationReport {
  const issues: ApplicationResearchIssue[] = [];
  const binding = bundle.manifest.binding;
  const expected: readonly [string, string, string][] = [
    [binding.input_snapshot_id, expectedBinding.inputSnapshotId, "binding.input_snapshot_id"],
    [binding.input_snapshot_hash, expectedBinding.inputSnapshotHash, "binding.input_snapshot_hash"],
    [binding.application_id, expectedBinding.applicationId, "binding.application_id"],
    [binding.job_version_id, expectedBinding.jobVersionId, "binding.job_version_id"],
    [binding.job_content_sha256, expectedBinding.jobContentSha256, "binding.job_content_sha256"],
  ];
  for (const [actual, wanted, path] of expected) {
    if (actual !== wanted) issues.push(issue("BINDING_MISMATCH", path, "Research bundle does not match the expected immutable input."));
  }
  if (bundle.freshnessPolicyRelease !== expectedFreshnessPolicyRelease ||
      bundle.manifest.freshness.policy_release !== expectedFreshnessPolicyRelease) {
    issues.push(issue("FRESHNESS_INVALID", "freshness.policy_release", "Research bundle uses a different freshness policy release."));
  }
  if (bundle.researcherRelease !== bundle.manifest.research.researcher_release) {
    issues.push(issue("INPUT_INVALID", "research.researcher_release", "Researcher release metadata does not match the manifest."));
  }
  if (bundle.freshnessExpiresAt !== bundle.manifest.freshness.expires_at) {
    issues.push(issue("FRESHNESS_INVALID", "freshness.expires_at", "Freshness metadata does not match the manifest."));
  }
  if (bundle.bundleHash !== sha256(bundle.manifest)) {
    issues.push(issue("BUNDLE_HASH_MISMATCH", "bundleHash", "Research manifest hash does not match the bundle hash."));
  }
  const atMilliseconds = Date.parse(at);
  const expiresMilliseconds = Date.parse(bundle.manifest.freshness.expires_at);
  const fresh = Number.isFinite(atMilliseconds) &&
    Number.isFinite(expiresMilliseconds) &&
    expiresMilliseconds > atMilliseconds;
  if (!Number.isFinite(atMilliseconds)) {
    issues.push(issue("INPUT_INVALID", "at", "Expected an RFC 3339 validation timestamp."));
  } else if (!fresh) {
    issues.push(issue("FRESHNESS_INVALID", "freshness.expires_at", "Research bundle is expired and must not create a new application revision."));
  }
  return deepFreeze({ valid: issues.length === 0, fresh, issues }) as ApplicationResearchValidationReport;
}
