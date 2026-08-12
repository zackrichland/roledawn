/**
 * Provider-neutral lifecycle boundary for an isolated computer session.
 *
 * A production adapter may provision Cua or another sandbox provider. Provider
 * session IDs, signed viewer URLs, mount paths, and credentials must remain
 * private to the adapter. Interaction drivers are deliberately separate: this
 * broker has no click, type, upload, or submit authority.
 */

declare const computerSessionIdBrand: unique symbol;
declare const artifactMountIdBrand: unique symbol;
declare const liveViewReferenceBrand: unique symbol;

export type ComputerSessionId = string & { readonly [computerSessionIdBrand]: true };
export type ArtifactMountId = string & { readonly [artifactMountIdBrand]: true };
export type LiveViewReference = string & { readonly [liveViewReferenceBrand]: true };

export type ComputerSessionBinding = {
  candidateId: string;
  applicationId: string;
};

export type AllowedProtocol = "https:" | "http:";

export type AllowedDomainRule = {
  hostname: string;
  includeSubdomains: boolean;
};

export type AllowedDomainPolicy = {
  policyId: string;
  protocols?: readonly AllowedProtocol[];
  domains: readonly AllowedDomainRule[];
};

/**
 * An application-owned reference to an immutable artifact. This is not a URL,
 * filesystem path, bearer token, signed download URL, or provider mount ID.
 */
export type ArtifactMountReference = {
  artifactRef: string;
  artifactVersionId: string;
  contentHash: `sha256:${string}`;
  filename: string;
  mediaType: string;
};

export type MountedArtifactReference = ArtifactMountReference & {
  mountId: ArtifactMountId;
};

export type ComputerSessionState = "ACTIVE" | "CLOSED" | "EXPIRED" | "DESTROYED";
export type LiveViewPreference = "DISABLED" | "PREFERRED" | "REQUIRED";

export type ComputerSessionRequest = {
  binding: ComputerSessionBinding;
  startUrl: string;
  allowedDomainPolicy: AllowedDomainPolicy;
  ttlMs: number;
  artifacts?: readonly ArtifactMountReference[];
  liveView?: LiveViewPreference;
};

export type ComputerSessionSnapshot = {
  sessionId: ComputerSessionId;
  binding: ComputerSessionBinding;
  state: ComputerSessionState;
  startUrl: string;
  allowedDomainPolicy: AllowedDomainPolicy;
  artifacts: readonly MountedArtifactReference[];
  liveView: null | {
    /** Resolve this app-owned reference through an authenticated endpoint. */
    reference: LiveViewReference;
    mode: "READ_ONLY";
    expiresAt: string;
  };
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  destroyedAt: string | null;
};

export type ComputerSessionErrorCode =
  | "REQUEST_INVALID"
  | "BINDING_INVALID"
  | "POLICY_INVALID"
  | "START_URL_NOT_ALLOWED"
  | "NAVIGATION_NOT_ALLOWED"
  | "ARTIFACT_REFERENCE_INVALID"
  | "TTL_INVALID"
  | "LIVE_VIEW_UNAVAILABLE"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_ACTIVE";

export type ComputerSessionError = {
  code: ComputerSessionErrorCode;
  message: string;
};

export type ComputerSessionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ComputerSessionError };

export type NavigationCheck = {
  sessionId: ComputerSessionId;
  normalizedUrl: string;
  policyId: string;
};

export interface ComputerSessionBroker {
  readonly capabilities: {
    artifactMounts: true;
    liveView: boolean;
    maximumTtlMs: number;
  };

  createSession(request: ComputerSessionRequest): Promise<ComputerSessionResult<ComputerSessionSnapshot>>;

  getSession(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
  ): Promise<ComputerSessionResult<ComputerSessionSnapshot>>;

  /**
   * Policy check for an interaction driver. A real adapter must additionally
   * enforce the same policy at the browser/network boundary and on redirects.
   */
  checkNavigation(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
    url: string,
  ): Promise<ComputerSessionResult<NavigationCheck>>;

  /** Gracefully releases the provider runtime while retaining safe metadata. */
  closeSession(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
  ): Promise<ComputerSessionResult<ComputerSessionSnapshot>>;

  /** Irreversibly removes runtime, live-view, and mounted-artifact references. */
  destroySession(
    sessionId: ComputerSessionId,
    binding: ComputerSessionBinding,
  ): Promise<ComputerSessionResult<ComputerSessionSnapshot>>;
}

export type NormalizedAllowedDomainPolicy = {
  policyId: string;
  protocols: readonly AllowedProtocol[];
  domains: readonly AllowedDomainRule[];
};

function failure<T>(code: ComputerSessionErrorCode, message: string): ComputerSessionResult<T> {
  return { ok: false, error: { code, message } };
}

function normalizeHostname(hostname: string): string | null {
  const candidate = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (
    candidate.length === 0 ||
    candidate.includes("*") ||
    /[\s/@?#:]/.test(candidate)
  ) {
    return null;
  }

  try {
    const parsed = new URL(`https://${candidate}`);
    if (parsed.hostname !== candidate || parsed.port || parsed.pathname !== "/") return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function normalizeAllowedDomainPolicy(
  policy: AllowedDomainPolicy,
): ComputerSessionResult<NormalizedAllowedDomainPolicy> {
  const policyId = policy.policyId.trim();
  if (!policyId) return failure("POLICY_INVALID", "The domain policy needs an immutable policy ID.");
  if (policy.domains.length === 0) {
    return failure("POLICY_INVALID", "At least one destination domain must be allowed.");
  }

  const protocols = [...new Set(policy.protocols ?? ["https:" as const])];
  if (
    protocols.length === 0 ||
    protocols.some((protocol) => protocol !== "https:" && protocol !== "http:")
  ) {
    return failure("POLICY_INVALID", "Only explicit HTTP or HTTPS protocols are supported.");
  }

  const domains: AllowedDomainRule[] = [];
  const seen = new Set<string>();
  for (const rule of policy.domains) {
    const hostname = normalizeHostname(rule.hostname);
    if (!hostname) {
      return failure("POLICY_INVALID", `Invalid allowed hostname: ${rule.hostname}`);
    }
    const key = `${hostname}:${rule.includeSubdomains}`;
    if (seen.has(key)) continue;
    seen.add(key);
    domains.push({ hostname, includeSubdomains: rule.includeSubdomains });
  }

  return { ok: true, value: { policyId, protocols, domains } };
}

/**
 * Performs exact hostname or dot-boundary subdomain matching. A suffix such as
 * `evil-example.com` never matches `example.com`.
 */
export function isUrlAllowedByPolicy(url: string, policy: AllowedDomainPolicy): boolean {
  const normalizedPolicy = normalizeAllowedDomainPolicy(policy);
  if (!normalizedPolicy.ok) return false;

  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (!normalizedPolicy.value.protocols.includes(parsed.protocol as AllowedProtocol)) return false;

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return normalizedPolicy.value.domains.some((rule) =>
      hostname === rule.hostname ||
      (rule.includeSubdomains && hostname.endsWith(`.${rule.hostname}`)),
    );
  } catch {
    return false;
  }
}

export function normalizeComputerSessionUrl(url: string): string | null {
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function isSafeArtifactFilename(filename: string): boolean {
  const trimmed = filename.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 180 &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    !trimmed.includes("\0")
  );
}

export function validateArtifactMountReferences(
  artifacts: readonly ArtifactMountReference[],
): ComputerSessionResult<true> {
  const refs = new Set<string>();
  const filenames = new Set<string>();

  for (const artifact of artifacts) {
    if (!/^artifact:[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(artifact.artifactRef)) {
      return failure(
        "ARTIFACT_REFERENCE_INVALID",
        "Artifacts must use app-owned artifact references, never URLs, paths, or bearer tokens.",
      );
    }
    if (!artifact.artifactVersionId.trim()) {
      return failure("ARTIFACT_REFERENCE_INVALID", "Every artifact mount needs an immutable version ID.");
    }
    if (!/^sha256:[a-f0-9]{64}$/i.test(artifact.contentHash)) {
      return failure("ARTIFACT_REFERENCE_INVALID", "Every artifact mount needs a complete SHA-256 hash.");
    }
    if (!isSafeArtifactFilename(artifact.filename) || !artifact.mediaType.trim()) {
      return failure("ARTIFACT_REFERENCE_INVALID", "Artifact metadata contains an unsafe filename or media type.");
    }
    if (refs.has(artifact.artifactRef) || filenames.has(artifact.filename)) {
      return failure("ARTIFACT_REFERENCE_INVALID", "Artifact references and mounted filenames must be unique.");
    }
    refs.add(artifact.artifactRef);
    filenames.add(artifact.filename);
  }

  return { ok: true, value: true };
}
