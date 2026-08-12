import { createHash } from "node:crypto";

import { normalizePublicJobUrl } from "./job-url.ts";

export const RESUME_TAILORING_MODES = [
  "AS_UPLOADED",
  "REORDER_AND_TIGHTEN",
  "REWRITE_FROM_VERIFIED_FACTS",
] as const;

export type ResumeTailoringMode = (typeof RESUME_TAILORING_MODES)[number];

export type PacketDocumentUse = "RESUME" | "COVER_LETTER";

export type SourceResumeItemInput = Readonly<{
  itemId: string;
  text: string;
}>;

export type SourceResumeSectionInput = Readonly<{
  sectionId: string;
  heading: string;
  items: readonly SourceResumeItemInput[];
}>;

export type SourceResumeInput = Readonly<{
  artifactReference: string;
  artifactVersionId: string;
  contentHash: `sha256:${string}`;
  filename: string;
  sections: readonly SourceResumeSectionInput[];
}>;

export type ReviewedCandidateFactInput = Readonly<{
  factId: string;
  factVersionId: string;
  label: string;
  value: string;
  sensitivity: "STANDARD" | "SENSITIVE";
  allowedUses: readonly PacketDocumentUse[];
  review: Readonly<{
    status: "REVIEWED";
    reviewedAt: string;
    reviewedBy: "CANDIDATE" | "AUTHORIZED_OPERATOR";
  }>;
  provenance: Readonly<{
    documentId: string;
    documentVersionId: string;
    passageId: string;
  }>;
}>;

export type JobRequirementInput = Readonly<{
  requirementId: string;
  text: string;
}>;

export type PacketWritingPolicyInput = Readonly<{
  policyVersionId: string;
  prohibitedPhrases: readonly string[];
  maxCoverLetterWords: number;
  maxResumeItemWords: number;
}>;

export type ApplicationPacketSnapshotInput = Readonly<{
  applicationId: string;
  candidateId: string;
  capturedAt: string;
  job: Readonly<{
    jobId: string;
    jobVersionId: string;
    sourceUrl: string;
    company: string;
    title: string;
    location: string | null;
    description: string;
    requirements: readonly JobRequirementInput[];
  }>;
  candidate: Readonly<{
    sourceResume: SourceResumeInput;
    reviewedFacts: readonly ReviewedCandidateFactInput[];
  }>;
  writingPolicy: PacketWritingPolicyInput;
}>;

export type ApplicationPacketInputSnapshot = Readonly<{
  schemaVersion: 1;
  applicationId: string;
  candidateId: string;
  capturedAt: string;
  job: Readonly<{
    jobId: string;
    jobVersionId: string;
    sourceUrl: string;
    company: string;
    title: string;
    location: string | null;
    description: string;
    requirements: readonly Readonly<JobRequirementInput>[];
  }>;
  candidate: Readonly<{
    sourceResume: Readonly<{
      artifactReference: string;
      artifactVersionId: string;
      contentHash: `sha256:${string}`;
      filename: string;
      sections: readonly Readonly<{
        sectionId: string;
        heading: string;
        items: readonly Readonly<SourceResumeItemInput>[];
      }>[];
    }>;
    reviewedFacts: readonly Readonly<ReviewedCandidateFactInput>[];
  }>;
  writingPolicy: Readonly<PacketWritingPolicyInput>;
  snapshotHash: `sha256:${string}`;
}>;

export type CandidateFactCitation = Readonly<{
  sourceType: "CANDIDATE_FACT";
  factVersionId: string;
}>;

export type JobFieldCitation = Readonly<{
  sourceType: "JOB_FIELD";
  field: "COMPANY" | "TITLE" | "LOCATION" | "DESCRIPTION";
}>;

export type JobRequirementCitation = Readonly<{
  sourceType: "JOB_REQUIREMENT";
  requirementId: string;
}>;

export type ApplicationClaimCitation =
  | CandidateFactCitation
  | JobFieldCitation
  | JobRequirementCitation;

export type ApplicationClaim = Readonly<{
  claimId: string;
  claimType: "CANDIDATE_EVIDENCE" | "JOB_CONTEXT";
  statement: string;
  citations: readonly ApplicationClaimCitation[];
}>;

export type ProposedResumeItem = Readonly<{
  itemId: string;
  text: string;
  claimIds: readonly string[];
}>;

export type ProposedResumeSection = Readonly<{
  sectionId: string;
  heading: string;
  items: readonly ProposedResumeItem[];
}>;

export type ResumeProposal = Readonly<{
  mode: ResumeTailoringMode;
  sourceArtifactVersionId: string;
  sections: readonly ProposedResumeSection[];
}>;

export type CoverLetterParagraph = Readonly<{
  paragraphId: string;
  kind: "SALUTATION" | "ROLE_MOTIVATION" | "EVIDENCE" | "CLOSING";
  text: string;
  claimIds: readonly string[];
}>;

export type CoverLetterProposal = Readonly<{
  title: string;
  paragraphs: readonly CoverLetterParagraph[];
}>;

export type ApplicationPacketProposal = Readonly<{
  proposalId: string;
  createdAt: string;
  snapshotHash: `sha256:${string}`;
  claims: readonly ApplicationClaim[];
  resume: ResumeProposal;
  coverLetter: CoverLetterProposal;
}>;

export type PacketEvidenceRequirement = Readonly<{
  requirementId: string;
  prompt: string;
  documentUse: PacketDocumentUse;
  sensitivity: "STANDARD" | "SENSITIVE";
  factVersionId: string | null;
}>;

export type PacketPreparationBlocker = Readonly<{
  requirementId: string;
  code:
    | "MISSING_REVIEWED_FACT"
    | "SENSITIVE_CANDIDATE_INPUT_REQUIRED"
    | "FACT_USE_NOT_ALLOWED";
  prompt: string;
  resolution: "CANDIDATE_REVIEW_REQUIRED" | "CANDIDATE_INPUT_REQUIRED";
  mayModelResolve: false;
}>;

export type PacketEvidenceReadiness = Readonly<{
  ready: boolean;
  resolvedFactVersionIds: readonly string[];
  blockers: readonly PacketPreparationBlocker[];
}>;

export type PacketValidationIssueCode =
  | "INPUT_INVALID"
  | "DUPLICATE_ID"
  | "UNREVIEWED_FACT"
  | "HASH_INVALID"
  | "SNAPSHOT_MISMATCH"
  | "SOURCE_RESUME_MISMATCH"
  | "UNKNOWN_CLAIM"
  | "UNUSED_CLAIM"
  | "CITATION_REQUIRED"
  | "CITATION_INVALID"
  | "FACT_USE_NOT_ALLOWED"
  | "RESUME_MODE_VIOLATION"
  | "WRITING_POLICY_VIOLATION";

export type PacketValidationIssue = Readonly<{
  code: PacketValidationIssueCode;
  path: string;
  message: string;
}>;

export type PacketValidationReport = Readonly<{
  valid: boolean;
  issues: readonly PacketValidationIssue[];
}>;

export type PacketResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: "SNAPSHOT_INVALID" | "PROPOSAL_INVALID";
        message: string;
        issues: readonly PacketValidationIssue[];
      }>;
    }>;

export type ResumeMaterialChange = Readonly<{
  kind: "ADDED" | "REMOVED" | "REWRITTEN" | "MOVED";
  itemId: string;
  before: Readonly<{ sectionId: string; index: number; text: string }> | null;
  after: Readonly<{ sectionId: string; index: number; text: string }> | null;
  claimIds: readonly string[];
}>;

export type ResumeSectionChange = Readonly<{
  kind: "ADDED" | "REMOVED" | "RENAMED" | "MOVED";
  sectionId: string;
  before: Readonly<{ index: number; heading: string }> | null;
  after: Readonly<{ index: number; heading: string }> | null;
}>;

export type ApplicationPacketMaterialDiff = Readonly<{
  resume: Readonly<{
    mode: ResumeTailoringMode;
    sectionChanges: readonly ResumeSectionChange[];
    changes: readonly ResumeMaterialChange[];
  }>;
  coverLetter: Readonly<{
    kind: "CREATED";
    paragraphCount: number;
    wordCount: number;
    contentHash: `sha256:${string}`;
  }>;
}>;

export type ApplicationPacketManifest = Readonly<{
  schemaVersion: 1;
  packetId: string;
  proposalId: string;
  createdAt: string;
  applicationId: string;
  candidateId: string;
  jobId: string;
  jobVersionId: string;
  sourceResumeArtifactVersionId: string;
  writingPolicyVersionId: string;
  snapshotHash: `sha256:${string}`;
  proposalHash: `sha256:${string}`;
  materialDiffHash: `sha256:${string}`;
  artifacts: readonly Readonly<{
    kind: "RESUME_PROPOSAL" | "COVER_LETTER_PROPOSAL";
    mediaType: "application/vnd.roledawn.proposal+json";
    contentHash: `sha256:${string}`;
  }>[];
  claimCitations: readonly Readonly<{
    claimId: string;
    citations: readonly ApplicationClaimCitation[];
  }>[];
  packetHash: `sha256:${string}`;
}>;

export type PreparedApplicationPacket = Readonly<{
  immutable: true;
  snapshot: ApplicationPacketInputSnapshot;
  proposal: ApplicationPacketProposal;
  materialDiff: ApplicationPacketMaterialDiff;
  manifest: ApplicationPacketManifest;
}>;

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function issue(
  code: PacketValidationIssueCode,
  path: string,
  message: string,
): PacketValidationIssue {
  return { code, path, message };
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isSha256(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function wordCount(value: string): number {
  const words = value.trim().match(/\S+/g);
  return words?.length ?? 0;
}

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical values must contain finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]));
  }
  throw new TypeError("Canonical values cannot contain functions, symbols, bigint, or undefined array members.");
}

function hashValue(value: unknown): `sha256:${string}` {
  const serialized = JSON.stringify(canonicalize(value));
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  }
  return value;
}

function copyUses(uses: readonly PacketDocumentUse[]): readonly PacketDocumentUse[] {
  return [...new Set(uses)].sort();
}

function cloneSnapshotBase(input: ApplicationPacketSnapshotInput) {
  return {
    schemaVersion: 1 as const,
    applicationId: input.applicationId.trim(),
    candidateId: input.candidateId.trim(),
    capturedAt: input.capturedAt,
    job: {
      jobId: input.job.jobId.trim(),
      jobVersionId: input.job.jobVersionId.trim(),
      sourceUrl: input.job.sourceUrl.trim(),
      company: input.job.company.trim(),
      title: input.job.title.trim(),
      location: input.job.location?.trim() || null,
      description: input.job.description.trim(),
      requirements: input.job.requirements
        .map((requirement) => ({
          requirementId: requirement.requirementId.trim(),
          text: requirement.text.trim(),
        }))
        .sort((left, right) => left.requirementId < right.requirementId ? -1 : left.requirementId > right.requirementId ? 1 : 0),
    },
    candidate: {
      sourceResume: {
        artifactReference: input.candidate.sourceResume.artifactReference.trim(),
        artifactVersionId: input.candidate.sourceResume.artifactVersionId.trim(),
        contentHash: input.candidate.sourceResume.contentHash,
        filename: input.candidate.sourceResume.filename.trim(),
        sections: input.candidate.sourceResume.sections.map((section) => ({
          sectionId: section.sectionId.trim(),
          heading: section.heading.trim(),
          items: section.items.map((item) => ({
            itemId: item.itemId.trim(),
            text: item.text.trim(),
          })),
        })),
      },
      reviewedFacts: input.candidate.reviewedFacts
        .map((fact) => ({
          factId: fact.factId.trim(),
          factVersionId: fact.factVersionId.trim(),
          label: fact.label.trim(),
          value: fact.value.trim(),
          sensitivity: fact.sensitivity,
          allowedUses: copyUses(fact.allowedUses),
          review: { ...fact.review },
          provenance: {
            documentId: fact.provenance.documentId.trim(),
            documentVersionId: fact.provenance.documentVersionId.trim(),
            passageId: fact.provenance.passageId.trim(),
          },
        }))
        .sort((left, right) => left.factVersionId < right.factVersionId ? -1 : left.factVersionId > right.factVersionId ? 1 : 0),
    },
    writingPolicy: {
      policyVersionId: input.writingPolicy.policyVersionId.trim(),
      prohibitedPhrases: [...new Set(
        input.writingPolicy.prohibitedPhrases.map((phrase) => phrase.trim()).filter(Boolean),
      )].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
      maxCoverLetterWords: input.writingPolicy.maxCoverLetterWords,
      maxResumeItemWords: input.writingPolicy.maxResumeItemWords,
    },
  };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function validateSnapshotBase(base: ReturnType<typeof cloneSnapshotBase>): PacketValidationIssue[] {
  const issues: PacketValidationIssue[] = [];
  for (const [path, value] of [
    ["applicationId", base.applicationId],
    ["candidateId", base.candidateId],
    ["job.jobId", base.job.jobId],
    ["job.jobVersionId", base.job.jobVersionId],
    ["job.company", base.job.company],
    ["job.title", base.job.title],
    ["job.description", base.job.description],
    ["candidate.sourceResume.artifactReference", base.candidate.sourceResume.artifactReference],
    ["candidate.sourceResume.artifactVersionId", base.candidate.sourceResume.artifactVersionId],
    ["candidate.sourceResume.filename", base.candidate.sourceResume.filename],
    ["writingPolicy.policyVersionId", base.writingPolicy.policyVersionId],
  ] as const) {
    if (!isNonEmpty(value)) issues.push(issue("INPUT_INVALID", path, "A stable non-empty value is required."));
  }
  if (!isIsoTimestamp(base.capturedAt)) {
    issues.push(issue("INPUT_INVALID", "capturedAt", "Use a valid snapshot timestamp."));
  }
  const normalizedUrl = normalizePublicJobUrl(base.job.sourceUrl);
  if (!normalizedUrl.ok) {
    issues.push(issue("INPUT_INVALID", "job.sourceUrl", normalizedUrl.error.message));
  } else {
    base.job.sourceUrl = normalizedUrl.value;
  }
  if (!isSha256(base.candidate.sourceResume.contentHash)) {
    issues.push(issue("HASH_INVALID", "candidate.sourceResume.contentHash", "The source résumé needs a complete lowercase SHA-256 hash."));
  }
  if (!Number.isInteger(base.writingPolicy.maxCoverLetterWords) || base.writingPolicy.maxCoverLetterWords <= 0) {
    issues.push(issue("INPUT_INVALID", "writingPolicy.maxCoverLetterWords", "The cover-letter word limit must be a positive integer."));
  }
  if (!Number.isInteger(base.writingPolicy.maxResumeItemWords) || base.writingPolicy.maxResumeItemWords <= 0) {
    issues.push(issue("INPUT_INVALID", "writingPolicy.maxResumeItemWords", "The résumé-item word limit must be a positive integer."));
  }

  for (const duplicate of duplicateValues(base.job.requirements.map((item) => item.requirementId))) {
    issues.push(issue("DUPLICATE_ID", "job.requirements", `Duplicate requirement ID: ${duplicate}.`));
  }
  const sectionIds = base.candidate.sourceResume.sections.map((section) => section.sectionId);
  for (const duplicate of duplicateValues(sectionIds)) {
    issues.push(issue("DUPLICATE_ID", "candidate.sourceResume.sections", `Duplicate section ID: ${duplicate}.`));
  }
  const resumeItemIds = base.candidate.sourceResume.sections.flatMap((section) => section.items.map((item) => item.itemId));
  for (const duplicate of duplicateValues(resumeItemIds)) {
    issues.push(issue("DUPLICATE_ID", "candidate.sourceResume.sections.items", `Duplicate résumé item ID: ${duplicate}.`));
  }
  for (const duplicate of duplicateValues(base.candidate.reviewedFacts.map((fact) => fact.factVersionId))) {
    issues.push(issue("DUPLICATE_ID", "candidate.reviewedFacts", `Duplicate fact version ID: ${duplicate}.`));
  }

  base.job.requirements.forEach((requirement, index) => {
    if (!isNonEmpty(requirement.requirementId) || !isNonEmpty(requirement.text)) {
      issues.push(issue("INPUT_INVALID", `job.requirements[${index}]`, "Each requirement needs an ID and source text."));
    }
  });
  base.candidate.sourceResume.sections.forEach((section, sectionIndex) => {
    if (!isNonEmpty(section.sectionId) || !isNonEmpty(section.heading)) {
      issues.push(issue("INPUT_INVALID", `candidate.sourceResume.sections[${sectionIndex}]`, "Each source résumé section needs an ID and heading."));
    }
    section.items.forEach((item, itemIndex) => {
      if (!isNonEmpty(item.itemId) || !isNonEmpty(item.text)) {
        issues.push(issue("INPUT_INVALID", `candidate.sourceResume.sections[${sectionIndex}].items[${itemIndex}]`, "Each source résumé item needs an ID and text."));
      }
    });
  });
  base.candidate.reviewedFacts.forEach((fact, index) => {
    const path = `candidate.reviewedFacts[${index}]`;
    if (
      !isNonEmpty(fact.factId) ||
      !isNonEmpty(fact.factVersionId) ||
      !isNonEmpty(fact.label) ||
      !isNonEmpty(fact.value) ||
      !isNonEmpty(fact.provenance.documentId) ||
      !isNonEmpty(fact.provenance.documentVersionId) ||
      !isNonEmpty(fact.provenance.passageId)
    ) {
      issues.push(issue("INPUT_INVALID", path, "Each candidate fact needs stable identity, reviewed content, and source provenance."));
    }
    if (fact.review.status !== "REVIEWED" || !isIsoTimestamp(fact.review.reviewedAt)) {
      issues.push(issue("UNREVIEWED_FACT", `${path}.review`, "Only reviewed fact versions may enter a packet snapshot."));
    }
    if (fact.allowedUses.length === 0) {
      issues.push(issue("INPUT_INVALID", `${path}.allowedUses`, "A packet fact needs at least one candidate-approved document use."));
    }
  });
  return issues;
}

export function createApplicationPacketInputSnapshot(
  input: ApplicationPacketSnapshotInput,
): PacketResult<ApplicationPacketInputSnapshot> {
  const base = cloneSnapshotBase(input);
  const issues = validateSnapshotBase(base);
  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: "SNAPSHOT_INVALID",
        message: "The application packet snapshot contains invalid or unreviewed inputs.",
        issues,
      },
    };
  }
  const snapshot = {
    ...base,
    snapshotHash: hashValue(base),
  } as ApplicationPacketInputSnapshot;
  return { ok: true, value: deepFreeze(snapshot) as ApplicationPacketInputSnapshot };
}

/**
 * Resolves declared evidence needs only against the reviewed snapshot. Missing
 * values are returned as explicit human blockers; a model is never a resolver.
 * Sensitive facts additionally require the candidate's own review.
 */
export function assessApplicationPacketEvidence(
  snapshot: ApplicationPacketInputSnapshot,
  requirements: readonly PacketEvidenceRequirement[],
): PacketEvidenceReadiness {
  const blockers: PacketPreparationBlocker[] = [];
  const resolvedFactVersionIds: string[] = [];
  const seenRequirements = new Set<string>();

  for (const requirement of requirements) {
    const requirementId = requirement.requirementId.trim();
    const prompt = requirement.prompt.trim();
    if (!requirementId || !prompt || seenRequirements.has(requirementId)) {
      blockers.push({
        requirementId: requirementId || "invalid-requirement",
        code: requirement.sensitivity === "SENSITIVE"
          ? "SENSITIVE_CANDIDATE_INPUT_REQUIRED"
          : "MISSING_REVIEWED_FACT",
        prompt: prompt || "Review this missing application evidence.",
        resolution: requirement.sensitivity === "SENSITIVE"
          ? "CANDIDATE_INPUT_REQUIRED"
          : "CANDIDATE_REVIEW_REQUIRED",
        mayModelResolve: false,
      });
      continue;
    }
    seenRequirements.add(requirementId);
    const fact = requirement.factVersionId
      ? snapshot.candidate.reviewedFacts.find((item) => item.factVersionId === requirement.factVersionId)
      : undefined;

    if (
      requirement.sensitivity === "SENSITIVE" &&
      (!fact || fact.sensitivity !== "SENSITIVE" || fact.review.reviewedBy !== "CANDIDATE")
    ) {
      blockers.push({
        requirementId,
        code: "SENSITIVE_CANDIDATE_INPUT_REQUIRED",
        prompt,
        resolution: "CANDIDATE_INPUT_REQUIRED",
        mayModelResolve: false,
      });
      continue;
    }
    if (!fact) {
      blockers.push({
        requirementId,
        code: "MISSING_REVIEWED_FACT",
        prompt,
        resolution: "CANDIDATE_REVIEW_REQUIRED",
        mayModelResolve: false,
      });
      continue;
    }
    if (!fact.allowedUses.includes(requirement.documentUse)) {
      blockers.push({
        requirementId,
        code: "FACT_USE_NOT_ALLOWED",
        prompt,
        resolution: fact.sensitivity === "SENSITIVE"
          ? "CANDIDATE_INPUT_REQUIRED"
          : "CANDIDATE_REVIEW_REQUIRED",
        mayModelResolve: false,
      });
      continue;
    }
    resolvedFactVersionIds.push(fact.factVersionId);
  }

  return deepFreeze({
    ready: blockers.length === 0,
    resolvedFactVersionIds: [...new Set(resolvedFactVersionIds)],
    blockers,
  }) as PacketEvidenceReadiness;
}

function snapshotBase(snapshot: ApplicationPacketInputSnapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "snapshotHash"),
  ) as Omit<ApplicationPacketInputSnapshot, "snapshotHash">;
}

function normalizeProposal(proposal: ApplicationPacketProposal): ApplicationPacketProposal {
  return {
    proposalId: proposal.proposalId.trim(),
    createdAt: proposal.createdAt,
    snapshotHash: proposal.snapshotHash,
    claims: proposal.claims.map((claim) => ({
      claimId: claim.claimId.trim(),
      claimType: claim.claimType,
      statement: claim.statement.trim(),
      citations: claim.citations.map((citation) => ({ ...citation })),
    })),
    resume: {
      mode: proposal.resume.mode,
      sourceArtifactVersionId: proposal.resume.sourceArtifactVersionId.trim(),
      sections: proposal.resume.sections.map((section) => ({
        sectionId: section.sectionId.trim(),
        heading: section.heading.trim(),
        items: section.items.map((item) => ({
          itemId: item.itemId.trim(),
          text: item.text.trim(),
          claimIds: [...item.claimIds],
        })),
      })),
    },
    coverLetter: {
      title: proposal.coverLetter.title.trim(),
      paragraphs: proposal.coverLetter.paragraphs.map((paragraph) => ({
        paragraphId: paragraph.paragraphId.trim(),
        kind: paragraph.kind,
        text: paragraph.text.trim(),
        claimIds: [...paragraph.claimIds],
      })),
    },
  };
}

type LocatedResumeItem = Readonly<{
  sectionId: string;
  index: number;
  text: string;
  claimIds: readonly string[];
}>;

function locateSourceResumeItems(snapshot: ApplicationPacketInputSnapshot): Map<string, LocatedResumeItem> {
  const items = new Map<string, LocatedResumeItem>();
  for (const section of snapshot.candidate.sourceResume.sections) {
    section.items.forEach((item, index) => {
      items.set(item.itemId, { sectionId: section.sectionId, index, text: item.text, claimIds: [] });
    });
  }
  return items;
}

function locateProposedResumeItems(proposal: ApplicationPacketProposal): Map<string, LocatedResumeItem> {
  const items = new Map<string, LocatedResumeItem>();
  for (const section of proposal.resume.sections) {
    section.items.forEach((item, index) => {
      items.set(item.itemId, { sectionId: section.sectionId, index, text: item.text, claimIds: item.claimIds });
    });
  }
  return items;
}

function citationKey(citation: ApplicationClaimCitation): string {
  if (citation.sourceType === "CANDIDATE_FACT") return `${citation.sourceType}:${citation.factVersionId}`;
  if (citation.sourceType === "JOB_REQUIREMENT") return `${citation.sourceType}:${citation.requirementId}`;
  return `${citation.sourceType}:${citation.field}`;
}

function validateClaimCitation(
  snapshot: ApplicationPacketInputSnapshot,
  citation: ApplicationClaimCitation,
  path: string,
): PacketValidationIssue[] {
  if (citation.sourceType === "CANDIDATE_FACT") {
    const fact = snapshot.candidate.reviewedFacts.find((item) => item.factVersionId === citation.factVersionId);
    return fact
      ? []
      : [issue("CITATION_INVALID", path, `Unknown reviewed candidate fact version: ${citation.factVersionId}.`)];
  }
  if (citation.sourceType === "JOB_REQUIREMENT") {
    const requirement = snapshot.job.requirements.find((item) => item.requirementId === citation.requirementId);
    return requirement
      ? []
      : [issue("CITATION_INVALID", path, `Unknown job requirement: ${citation.requirementId}.`)];
  }
  if (citation.sourceType === "JOB_FIELD" && citation.field === "LOCATION" && snapshot.job.location === null) {
    return [issue("CITATION_INVALID", path, "The snapshot has no job location to cite.")];
  }
  return [];
}

function validateClaimUse(
  snapshot: ApplicationPacketInputSnapshot,
  claim: ApplicationClaim,
  use: PacketDocumentUse,
  path: string,
): PacketValidationIssue[] {
  const issues: PacketValidationIssue[] = [];
  for (const citation of claim.citations) {
    if (citation.sourceType !== "CANDIDATE_FACT") continue;
    const fact = snapshot.candidate.reviewedFacts.find((item) => item.factVersionId === citation.factVersionId);
    if (fact && !fact.allowedUses.includes(use)) {
      issues.push(issue(
        "FACT_USE_NOT_ALLOWED",
        path,
        `Fact version ${citation.factVersionId} is not approved for ${use.toLowerCase().replace("_", " ")}.`,
      ));
    }
  }
  return issues;
}

function prohibitedPhraseIssues(
  snapshot: ApplicationPacketInputSnapshot,
  value: string,
  path: string,
): PacketValidationIssue[] {
  const lower = value.toLocaleLowerCase();
  return snapshot.writingPolicy.prohibitedPhrases
    .filter((phrase) => lower.includes(phrase.toLocaleLowerCase()))
    .map((phrase) => issue(
      "WRITING_POLICY_VIOLATION",
      path,
      `The promoted writing policy prohibits the phrase: "${phrase}".`,
    ));
}

export function validateApplicationPacketProposal(
  snapshot: ApplicationPacketInputSnapshot,
  rawProposal: ApplicationPacketProposal,
): PacketValidationReport {
  const proposal = normalizeProposal(rawProposal);
  const issues: PacketValidationIssue[] = [];
  if (hashValue(snapshotBase(snapshot)) !== snapshot.snapshotHash) {
    issues.push(issue("SNAPSHOT_MISMATCH", "snapshot.snapshotHash", "The immutable input snapshot hash does not match its contents."));
  }
  if (proposal.snapshotHash !== snapshot.snapshotHash) {
    issues.push(issue("SNAPSHOT_MISMATCH", "proposal.snapshotHash", "The proposal is bound to a different input snapshot."));
  }
  if (!isNonEmpty(proposal.proposalId) || !isIsoTimestamp(proposal.createdAt)) {
    issues.push(issue("INPUT_INVALID", "proposal", "The proposal needs a stable ID and valid creation time."));
  }
  if (proposal.resume.sourceArtifactVersionId !== snapshot.candidate.sourceResume.artifactVersionId) {
    issues.push(issue("SOURCE_RESUME_MISMATCH", "resume.sourceArtifactVersionId", "The proposal must reference the exact source résumé version in the snapshot."));
  }

  for (const duplicate of duplicateValues(proposal.claims.map((claim) => claim.claimId))) {
    issues.push(issue("DUPLICATE_ID", "claims", `Duplicate claim ID: ${duplicate}.`));
  }
  const claimById = new Map(proposal.claims.map((claim) => [claim.claimId, claim]));
  const usedClaims = new Set<string>();
  proposal.claims.forEach((claim, claimIndex) => {
    const path = `claims[${claimIndex}]`;
    if (!isNonEmpty(claim.claimId) || !isNonEmpty(claim.statement)) {
      issues.push(issue("INPUT_INVALID", path, "Each claim needs an ID and a concrete statement."));
    }
    if (claim.citations.length === 0) {
      issues.push(issue("CITATION_REQUIRED", `${path}.citations`, "Every material claim needs at least one immutable citation."));
    }
    for (const duplicate of duplicateValues(claim.citations.map(citationKey))) {
      issues.push(issue("DUPLICATE_ID", `${path}.citations`, `Duplicate claim citation: ${duplicate}.`));
    }
    claim.citations.forEach((citation, citationIndex) => {
      issues.push(...validateClaimCitation(snapshot, citation, `${path}.citations[${citationIndex}]`));
    });
    const hasCandidateEvidence = claim.citations.some((citation) => citation.sourceType === "CANDIDATE_FACT");
    const hasJobContext = claim.citations.some((citation) => citation.sourceType !== "CANDIDATE_FACT");
    if (claim.claimType === "CANDIDATE_EVIDENCE" && !hasCandidateEvidence) {
      issues.push(issue("CITATION_REQUIRED", `${path}.citations`, "A candidate-evidence claim needs at least one reviewed candidate fact citation."));
    }
    if (claim.claimType === "JOB_CONTEXT" && !hasJobContext) {
      issues.push(issue("CITATION_REQUIRED", `${path}.citations`, "A job-context claim needs at least one immutable job citation."));
    }
    issues.push(...prohibitedPhraseIssues(snapshot, claim.statement, `${path}.statement`));
  });

  const sectionIds = proposal.resume.sections.map((section) => section.sectionId);
  for (const duplicate of duplicateValues(sectionIds)) {
    issues.push(issue("DUPLICATE_ID", "resume.sections", `Duplicate proposed résumé section ID: ${duplicate}.`));
  }
  const proposalItemIds = proposal.resume.sections.flatMap((section) => section.items.map((item) => item.itemId));
  for (const duplicate of duplicateValues(proposalItemIds)) {
    issues.push(issue("DUPLICATE_ID", "resume.sections.items", `Duplicate proposed résumé item ID: ${duplicate}.`));
  }
  const sourceItems = locateSourceResumeItems(snapshot);
  const proposedItems = locateProposedResumeItems(proposal);
  proposal.resume.sections.forEach((section, sectionIndex) => {
    if (!isNonEmpty(section.sectionId) || !isNonEmpty(section.heading)) {
      issues.push(issue("INPUT_INVALID", `resume.sections[${sectionIndex}]`, "Each proposed résumé section needs an ID and heading."));
    }
    section.items.forEach((item, itemIndex) => {
      const path = `resume.sections[${sectionIndex}].items[${itemIndex}]`;
      if (!isNonEmpty(item.itemId) || !isNonEmpty(item.text)) {
        issues.push(issue("INPUT_INVALID", path, "Each proposed résumé item needs an ID and text."));
      }
      if (wordCount(item.text) > snapshot.writingPolicy.maxResumeItemWords) {
        issues.push(issue("WRITING_POLICY_VIOLATION", `${path}.text`, "The résumé item exceeds the promoted word limit."));
      }
      issues.push(...prohibitedPhraseIssues(snapshot, item.text, `${path}.text`));
      const source = sourceItems.get(item.itemId);
      const introducesWording = !source || source.text !== item.text;
      if (introducesWording && item.claimIds.length === 0) {
        issues.push(issue("CITATION_REQUIRED", `${path}.claimIds`, "Every added or rewritten résumé item needs cited claims."));
      }
      for (const duplicate of duplicateValues(item.claimIds)) {
        issues.push(issue("DUPLICATE_ID", `${path}.claimIds`, `Duplicate claim use: ${duplicate}.`));
      }
      for (const claimId of item.claimIds) {
        const claim = claimById.get(claimId);
        if (!claim) {
          issues.push(issue("UNKNOWN_CLAIM", `${path}.claimIds`, `Unknown claim: ${claimId}.`));
          continue;
        }
        usedClaims.add(claimId);
        if (claim.claimType !== "CANDIDATE_EVIDENCE") {
          issues.push(issue("CITATION_INVALID", `${path}.claimIds`, "Résumé wording can use only candidate-evidence claims, never job text as proof of experience."));
        }
        issues.push(...validateClaimUse(snapshot, claim, "RESUME", `${path}.claimIds`));
      }
    });
  });

  if (proposal.resume.mode === "AS_UPLOADED") {
    const proposedSourceShape = proposal.resume.sections.map((section) => ({
      sectionId: section.sectionId,
      heading: section.heading,
      items: section.items.map((item) => ({ itemId: item.itemId, text: item.text })),
    }));
    if (hashValue(proposedSourceShape) !== hashValue(snapshot.candidate.sourceResume.sections)) {
      issues.push(issue("RESUME_MODE_VIOLATION", "resume.sections", "AS_UPLOADED cannot change text, headings, sections, or order."));
    }
  }
  if (proposal.resume.mode === "REORDER_AND_TIGHTEN") {
    for (const itemId of proposedItems.keys()) {
      if (!sourceItems.has(itemId)) {
        issues.push(issue("RESUME_MODE_VIOLATION", "resume.sections.items", "REORDER_AND_TIGHTEN cannot add a new résumé item."));
      }
    }
  }

  if (!isNonEmpty(proposal.coverLetter.title) || proposal.coverLetter.paragraphs.length === 0) {
    issues.push(issue("INPUT_INVALID", "coverLetter", "The cover letter needs a title and at least one paragraph."));
  }
  for (const duplicate of duplicateValues(proposal.coverLetter.paragraphs.map((paragraph) => paragraph.paragraphId))) {
    issues.push(issue("DUPLICATE_ID", "coverLetter.paragraphs", `Duplicate paragraph ID: ${duplicate}.`));
  }
  const coverLetterText = [proposal.coverLetter.title, ...proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text)].join("\n");
  if (wordCount(coverLetterText) > snapshot.writingPolicy.maxCoverLetterWords) {
    issues.push(issue("WRITING_POLICY_VIOLATION", "coverLetter", "The cover letter exceeds the promoted word limit."));
  }
  issues.push(...prohibitedPhraseIssues(snapshot, coverLetterText, "coverLetter"));
  proposal.coverLetter.paragraphs.forEach((paragraph, paragraphIndex) => {
    const path = `coverLetter.paragraphs[${paragraphIndex}]`;
    if (!isNonEmpty(paragraph.paragraphId) || !isNonEmpty(paragraph.text)) {
      issues.push(issue("INPUT_INVALID", path, "Each cover-letter paragraph needs an ID and text."));
    }
    const structural = paragraph.kind === "SALUTATION" || paragraph.kind === "CLOSING";
    if (!structural && paragraph.claimIds.length === 0) {
      issues.push(issue("CITATION_REQUIRED", `${path}.claimIds`, "Every motivation or evidence paragraph needs cited claims."));
    }
    if (structural && paragraph.claimIds.length > 0) {
      issues.push(issue("CITATION_INVALID", `${path}.claimIds`, "Use material paragraph kinds for factual claims; salutations and closings are structural only."));
    }
    for (const duplicate of duplicateValues(paragraph.claimIds)) {
      issues.push(issue("DUPLICATE_ID", `${path}.claimIds`, `Duplicate claim use: ${duplicate}.`));
    }
    for (const claimId of paragraph.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim) {
        issues.push(issue("UNKNOWN_CLAIM", `${path}.claimIds`, `Unknown claim: ${claimId}.`));
        continue;
      }
      usedClaims.add(claimId);
      if (paragraph.kind === "EVIDENCE" && claim.claimType !== "CANDIDATE_EVIDENCE") {
        issues.push(issue("CITATION_INVALID", `${path}.claimIds`, "An evidence paragraph can use only candidate-evidence claims."));
      }
      issues.push(...validateClaimUse(snapshot, claim, "COVER_LETTER", `${path}.claimIds`));
    }
  });

  proposal.claims.forEach((claim, index) => {
    if (!usedClaims.has(claim.claimId)) {
      issues.push(issue("UNUSED_CLAIM", `claims[${index}]`, "Remove claims that are not used by either proposed document."));
    }
  });
  return deepFreeze({ valid: issues.length === 0, issues }) as PacketValidationReport;
}

function buildMaterialDiff(
  snapshot: ApplicationPacketInputSnapshot,
  proposal: ApplicationPacketProposal,
): ApplicationPacketMaterialDiff {
  const sourceItems = locateSourceResumeItems(snapshot);
  const proposedItems = locateProposedResumeItems(proposal);
  const sourceSections = new Map(snapshot.candidate.sourceResume.sections.map((section, index) => [
    section.sectionId,
    { index, heading: section.heading },
  ]));
  const proposedSections = new Map(proposal.resume.sections.map((section, index) => [
    section.sectionId,
    { index, heading: section.heading },
  ]));
  const sectionChanges: ResumeSectionChange[] = [];
  for (const [sectionId, before] of sourceSections) {
    const after = proposedSections.get(sectionId);
    if (!after) {
      sectionChanges.push({ kind: "REMOVED", sectionId, before, after: null });
      continue;
    }
    if (before.heading !== after.heading) {
      sectionChanges.push({ kind: "RENAMED", sectionId, before, after });
    }
    if (before.index !== after.index) {
      sectionChanges.push({ kind: "MOVED", sectionId, before, after });
    }
  }
  for (const [sectionId, after] of proposedSections) {
    if (!sourceSections.has(sectionId)) {
      sectionChanges.push({ kind: "ADDED", sectionId, before: null, after });
    }
  }
  const changes: ResumeMaterialChange[] = [];
  for (const [itemId, before] of sourceItems) {
    const after = proposedItems.get(itemId);
    if (!after) {
      changes.push({ kind: "REMOVED", itemId, before, after: null, claimIds: [] });
      continue;
    }
    if (before.text !== after.text) {
      changes.push({ kind: "REWRITTEN", itemId, before, after, claimIds: [...after.claimIds] });
    }
    if (before.sectionId !== after.sectionId || before.index !== after.index) {
      changes.push({ kind: "MOVED", itemId, before, after, claimIds: [] });
    }
  }
  for (const [itemId, after] of proposedItems) {
    if (!sourceItems.has(itemId)) {
      changes.push({ kind: "ADDED", itemId, before: null, after, claimIds: [...after.claimIds] });
    }
  }
  const coverLetterContent = {
    title: proposal.coverLetter.title,
    paragraphs: proposal.coverLetter.paragraphs,
  };
  return deepFreeze({
    resume: { mode: proposal.resume.mode, sectionChanges, changes },
    coverLetter: {
      kind: "CREATED",
      paragraphCount: proposal.coverLetter.paragraphs.length,
      wordCount: wordCount([proposal.coverLetter.title, ...proposal.coverLetter.paragraphs.map((paragraph) => paragraph.text)].join("\n")),
      contentHash: hashValue(coverLetterContent),
    },
  }) as ApplicationPacketMaterialDiff;
}

export function prepareApplicationPacket(
  snapshot: ApplicationPacketInputSnapshot,
  rawProposal: ApplicationPacketProposal,
  packetId: string,
): PacketResult<PreparedApplicationPacket> {
  const proposal = normalizeProposal(rawProposal);
  const report = validateApplicationPacketProposal(snapshot, proposal);
  const packetIdentity = packetId.trim();
  const issues = [...report.issues];
  if (!packetIdentity) issues.push(issue("INPUT_INVALID", "packetId", "The immutable packet needs a stable ID."));
  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: "PROPOSAL_INVALID",
        message: "The application packet proposal failed deterministic validation.",
        issues,
      },
    };
  }

  const frozenProposal = deepFreeze(proposal) as ApplicationPacketProposal;
  const materialDiff = buildMaterialDiff(snapshot, frozenProposal);
  const proposalHash = hashValue(frozenProposal);
  const materialDiffHash = hashValue(materialDiff);
  const manifestBase = {
    schemaVersion: 1 as const,
    packetId: packetIdentity,
    proposalId: frozenProposal.proposalId,
    createdAt: frozenProposal.createdAt,
    applicationId: snapshot.applicationId,
    candidateId: snapshot.candidateId,
    jobId: snapshot.job.jobId,
    jobVersionId: snapshot.job.jobVersionId,
    sourceResumeArtifactVersionId: snapshot.candidate.sourceResume.artifactVersionId,
    writingPolicyVersionId: snapshot.writingPolicy.policyVersionId,
    snapshotHash: snapshot.snapshotHash,
    proposalHash,
    materialDiffHash,
    artifacts: [
      {
        kind: "RESUME_PROPOSAL" as const,
        mediaType: "application/vnd.roledawn.proposal+json" as const,
        contentHash: hashValue(frozenProposal.resume),
      },
      {
        kind: "COVER_LETTER_PROPOSAL" as const,
        mediaType: "application/vnd.roledawn.proposal+json" as const,
        contentHash: materialDiff.coverLetter.contentHash,
      },
    ],
    claimCitations: frozenProposal.claims.map((claim) => ({
      claimId: claim.claimId,
      citations: claim.citations,
    })),
  };
  const manifest: ApplicationPacketManifest = deepFreeze({
    ...manifestBase,
    packetHash: hashValue(manifestBase),
  }) as ApplicationPacketManifest;
  return {
    ok: true,
    value: deepFreeze({
      immutable: true as const,
      snapshot,
      proposal: frozenProposal,
      materialDiff,
      manifest,
    }) as PreparedApplicationPacket,
  };
}
