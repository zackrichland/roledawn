/**
 * Test-only, deterministic implementation of the computer-session lifecycle.
 *
 * This adapter provisions no browser, makes no network calls, and grants no
 * interaction or submission authority. Runtime code must depend on the
 * provider-neutral contract in `src/domain/computer-session-broker.ts`.
 */
import {
  isUrlAllowedByPolicy,
  normalizeAllowedDomainPolicy,
  normalizeComputerSessionUrl,
  validateArtifactMountReferences,
} from "../domain/computer-session-broker.ts";
import type {
  AllowedDomainPolicy,
  ArtifactMountId,
  ComputerSessionBinding,
  ComputerSessionBroker,
  ComputerSessionErrorCode,
  ComputerSessionId,
  ComputerSessionRequest,
  ComputerSessionResult,
  ComputerSessionSnapshot,
  LiveViewReference,
  MountedArtifactReference,
  NavigationCheck,
} from "../domain/computer-session-broker.ts";

type MutableComputerSessionSnapshot = Omit<ComputerSessionSnapshot, "artifacts" | "liveView"> & {
  artifacts: MountedArtifactReference[];
  liveView: ComputerSessionSnapshot["liveView"];
};

type InternalSessionRecord = {
  snapshot: MutableComputerSessionSnapshot;
  /** Stand-ins for values a production provider adapter would keep private. */
  providerRuntimeId: string | null;
  providerMountIds: string[];
  providerLiveViewId: string | null;
};

export type InMemoryComputerSessionBrokerOptions = {
  now?: () => number;
  createSessionId?: () => string;
  createProviderId?: () => string;
  createMountId?: () => string;
  createLiveViewReference?: () => string;
  supportsLiveView?: boolean;
  maximumTtlMs?: number;
};

const DEFAULT_MAXIMUM_TTL_MS = 60 * 60 * 1000;
const MINIMUM_TTL_MS = 1000;

function failure<T>(code: ComputerSessionErrorCode, message: string): ComputerSessionResult<T> {
  return { ok: false, error: { code, message } };
}

function randomReference(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clonePolicy(policy: AllowedDomainPolicy): AllowedDomainPolicy {
  return {
    policyId: policy.policyId,
    protocols: policy.protocols ? [...policy.protocols] : undefined,
    domains: policy.domains.map((rule) => ({ ...rule })),
  };
}

function cloneSnapshot(snapshot: ComputerSessionSnapshot): ComputerSessionSnapshot {
  return {
    ...snapshot,
    binding: { ...snapshot.binding },
    allowedDomainPolicy: clonePolicy(snapshot.allowedDomainPolicy),
    artifacts: snapshot.artifacts.map((artifact) => ({ ...artifact })),
    liveView: snapshot.liveView ? { ...snapshot.liveView } : null,
  };
}

export class InMemoryComputerSessionBroker implements ComputerSessionBroker {
  readonly capabilities: ComputerSessionBroker["capabilities"];

  readonly #now: () => number;
  readonly #createSessionId: () => string;
  readonly #createProviderId: () => string;
  readonly #createMountId: () => string;
  readonly #createLiveViewReference: () => string;
  readonly #records = new Map<ComputerSessionId, InternalSessionRecord>();

  constructor(options: InMemoryComputerSessionBrokerOptions = {}) {
    const maximumTtlMs = options.maximumTtlMs ?? DEFAULT_MAXIMUM_TTL_MS;
    if (!Number.isSafeInteger(maximumTtlMs) || maximumTtlMs < MINIMUM_TTL_MS) {
      throw new TypeError("maximumTtlMs must be an integer of at least 1000 milliseconds.");
    }

    this.#now = options.now ?? Date.now;
    this.#createSessionId = options.createSessionId ?? (() => randomReference("computer-session"));
    this.#createProviderId = options.createProviderId ?? (() => randomReference("private-provider-runtime"));
    this.#createMountId = options.createMountId ?? (() => randomReference("artifact-mount"));
    this.#createLiveViewReference = options.createLiveViewReference ?? (() => randomReference("live-view"));
    this.capabilities = {
      artifactMounts: true,
      liveView: options.supportsLiveView ?? false,
      maximumTtlMs,
    };
  }

  async createSession(request: ComputerSessionRequest): Promise<ComputerSessionResult<ComputerSessionSnapshot>> {
    const candidateId = request.binding.candidateId.trim();
    const applicationId = request.binding.applicationId.trim();
    if (!candidateId || !applicationId) {
      return failure("BINDING_INVALID", "A session must bind to one candidate and one application.");
    }
    if (
      !Number.isSafeInteger(request.ttlMs) ||
      request.ttlMs < MINIMUM_TTL_MS ||
      request.ttlMs > this.capabilities.maximumTtlMs
    ) {
      return failure(
        "TTL_INVALID",
        `Session TTL must be between 1000 and ${this.capabilities.maximumTtlMs} milliseconds.`,
      );
    }

    const policy = normalizeAllowedDomainPolicy(request.allowedDomainPolicy);
    if (!policy.ok) return policy;
    const normalizedStartUrl = normalizeComputerSessionUrl(request.startUrl);
    if (!normalizedStartUrl || !isUrlAllowedByPolicy(normalizedStartUrl, policy.value)) {
      return failure("START_URL_NOT_ALLOWED", "The start URL is outside this application's destination policy.");
    }

    const artifacts = request.artifacts ?? [];
    const artifactValidation = validateArtifactMountReferences(artifacts);
    if (!artifactValidation.ok) return artifactValidation;

    const liveViewPreference = request.liveView ?? "DISABLED";
    if (liveViewPreference === "REQUIRED" && !this.capabilities.liveView) {
      return failure("LIVE_VIEW_UNAVAILABLE", "This broker cannot provide a live view.");
    }
    if (!["DISABLED", "PREFERRED", "REQUIRED"].includes(liveViewPreference)) {
      return failure("REQUEST_INVALID", "Unknown live-view preference.");
    }

    const sessionId = this.#uniqueSessionId();
    const createdAtMs = this.#now();
    const createdAt = new Date(createdAtMs).toISOString();
    const expiresAt = new Date(createdAtMs + request.ttlMs).toISOString();
    const mountedArtifacts = artifacts.map((artifact) => ({
      ...artifact,
      mountId: this.#createMountId() as ArtifactMountId,
    }));
    const useLiveView = liveViewPreference !== "DISABLED" && this.capabilities.liveView;

    const snapshot: MutableComputerSessionSnapshot = {
      sessionId,
      binding: { candidateId, applicationId },
      state: "ACTIVE",
      startUrl: normalizedStartUrl,
      allowedDomainPolicy: clonePolicy(policy.value),
      artifacts: mountedArtifacts,
      liveView: useLiveView
        ? {
            reference: this.#createLiveViewReference() as LiveViewReference,
            mode: "READ_ONLY",
            expiresAt,
          }
        : null,
      createdAt,
      expiresAt,
      closedAt: null,
      destroyedAt: null,
    };

    this.#records.set(sessionId, {
      snapshot,
      providerRuntimeId: this.#createProviderId(),
      providerMountIds: artifacts.map(() => this.#createProviderId()),
      providerLiveViewId: useLiveView ? this.#createProviderId() : null,
    });

    return { ok: true, value: cloneSnapshot(snapshot) };
  }

  async getSession(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
  ): Promise<ComputerSessionResult<ComputerSessionSnapshot>> {
    const record = this.#boundRecord(sessionId, binding);
    if (!record.ok) return record;
    this.#expireIfNeeded(record.value);
    return { ok: true, value: cloneSnapshot(record.value.snapshot) };
  }

  async checkNavigation(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
    url: string,
  ): Promise<ComputerSessionResult<NavigationCheck>> {
    const record = this.#boundRecord(sessionId, binding);
    if (!record.ok) return record;
    this.#expireIfNeeded(record.value);
    if (record.value.snapshot.state !== "ACTIVE") {
      return failure("SESSION_NOT_ACTIVE", "Navigation checks require an active session.");
    }

    const normalizedUrl = normalizeComputerSessionUrl(url);
    if (!normalizedUrl || !isUrlAllowedByPolicy(normalizedUrl, record.value.snapshot.allowedDomainPolicy)) {
      return failure("NAVIGATION_NOT_ALLOWED", "The destination is outside this session's domain policy.");
    }
    return {
      ok: true,
      value: {
        sessionId,
        normalizedUrl,
        policyId: record.value.snapshot.allowedDomainPolicy.policyId,
      },
    };
  }

  async closeSession(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
  ): Promise<ComputerSessionResult<ComputerSessionSnapshot>> {
    const record = this.#boundRecord(sessionId, binding);
    if (!record.ok) return record;
    this.#expireIfNeeded(record.value);

    if (record.value.snapshot.state === "ACTIVE") {
      record.value.snapshot.state = "CLOSED";
      record.value.snapshot.closedAt = new Date(this.#now()).toISOString();
      record.value.snapshot.liveView = null;
      this.#releasePrivateProviderState(record.value);
    }
    return { ok: true, value: cloneSnapshot(record.value.snapshot) };
  }

  async destroySession(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
  ): Promise<ComputerSessionResult<ComputerSessionSnapshot>> {
    const record = this.#boundRecord(sessionId, binding);
    if (!record.ok) return record;
    this.#expireIfNeeded(record.value);

    if (record.value.snapshot.state !== "DESTROYED") {
      record.value.snapshot.state = "DESTROYED";
      record.value.snapshot.destroyedAt = new Date(this.#now()).toISOString();
      record.value.snapshot.artifacts = [];
      record.value.snapshot.liveView = null;
      this.#releasePrivateProviderState(record.value);
    }
    return { ok: true, value: cloneSnapshot(record.value.snapshot) };
  }

  #uniqueSessionId(): ComputerSessionId {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = this.#createSessionId() as ComputerSessionId;
      if (id.length > 0 && !this.#records.has(id)) return id;
    }
    throw new Error("In-memory session ID factory failed to produce a unique ID.");
  }

  #boundRecord(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
  ): ComputerSessionResult<InternalSessionRecord> {
    const record = this.#records.get(sessionId);
    if (
      !record ||
      record.snapshot.binding.candidateId !== binding.candidateId ||
      record.snapshot.binding.applicationId !== binding.applicationId
    ) {
      // Deliberately hide whether another tenant's session exists.
      return failure("SESSION_NOT_FOUND", "No session exists for this candidate and application.");
    }
    return { ok: true, value: record };
  }

  #expireIfNeeded(record: InternalSessionRecord): void {
    if (
      record.snapshot.state === "ACTIVE" &&
      this.#now() >= new Date(record.snapshot.expiresAt).getTime()
    ) {
      record.snapshot.state = "EXPIRED";
      record.snapshot.destroyedAt = record.snapshot.expiresAt;
      record.snapshot.artifacts = [];
      record.snapshot.liveView = null;
      this.#releasePrivateProviderState(record);
    }
  }

  #releasePrivateProviderState(record: InternalSessionRecord): void {
    record.providerRuntimeId = null;
    record.providerMountIds = [];
    record.providerLiveViewId = null;
  }
}
