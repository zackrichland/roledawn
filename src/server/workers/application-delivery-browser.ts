import { createHash } from "node:crypto";

import type { Page, Request, Response, Route } from "playwright-core";

import { parseAutopilotDestination, parseAshbyAutopilotDestination, parseGreenhouseAutopilotDestination, parseLeverAutopilotDestination } from "../../domain/application-autopilot-eligibility.ts";
import type { AgentBrowserField, AgentFieldValue } from "./agents-browser-tools.ts";
import { APPLICATION_FILL_CAPTCHA_TAKEOVER, pageShowsCaptchaChallenge } from "./agents-captcha.ts";
import type { MaterializedApplicationArtifact } from "./application-fill-materializer.ts";

import type { OptionMatch } from "./agents-option-match.ts";
import { ashbySubmissionAccepted, createAshbyProtocol, inspectAshbyEnvelope, inspectAshbySubmissionResponse, type AshbyEnvelope, type AshbySubmissionDiagnostics } from "./ashby-delivery-protocol.ts";

export const DELIVERY_BROWSER_RELEASE = "application-delivery-browser/1";
export type DeliveryRequestRule = Readonly<{ method: "GET" | "POST" | "PUT"; url: string }>;
/** Injected by controlled acceptance only, after the same policy/authority checks. */
export type DeliveryRequestTransport = (route: Route) => Promise<void>;
export type DeliveryUploadRule = Readonly<{
  fieldId?: string; fieldName?: string; selector: string;
  request?: DeliveryRequestRule;
  acknowledgementSelector: string;
  successSelector?: string;
}>;
export type DeliveryMoveRule = Readonly<{
  selector: string; request?: DeliveryRequestRule; nextStepId: string;
}>;
export type DeliveryStepPolicy = Readonly<{
  id: string; url: string; readySelector: string;
  uploads?: readonly DeliveryUploadRule[];
  forward?: DeliveryMoveRule; back?: DeliveryMoveRule;
  submit?: Readonly<{ selector: string; request: DeliveryRequestRule }>;
}>;
/**
 * One permitted type-to-search lookup. `query` carries the approved typed text;
 * `params` are reviewed literal values for the page's own fixed parameters.
 * Patterns would let page code encode other data in those values. Any other
 * parameter or changed fixed value blocks the request.
 */
export type DeliverySearchRule = Readonly<{ origin: string; path: string; query: string; params?: Readonly<Record<string, string>> }>;

function searchPermitted(url: URL, rule: DeliverySearchRule, approvedQuery: string): boolean {
  const params = rule.params ?? {};
  if (url.origin !== rule.origin || url.pathname !== rule.path) return false;
  if ([...url.searchParams.keys()].some((key) => key !== rule.query && !Object.hasOwn(params, key))) return false;
  if (url.searchParams.getAll(rule.query).length !== 1 || (url.searchParams.get(rule.query) ?? "").length > 200) return false;
  // Typing may request each prefix. No page-selected text can leave through
  // this lookup, even while a legitimate search is in progress.
  const query = url.searchParams.get(rule.query) ?? "";
  if (!query || !approvedQuery.startsWith(query)) return false;
  return Object.entries(params).every(([name, value]) =>
    url.searchParams.getAll(name).length === 1 && url.searchParams.get(name) === value);
}
export type DeliverySitePolicy = Readonly<{
  release: string; startUrl: string;
  /**
   * The public posting this policy delivers for when its form is served from
   * another URL (Greenhouse's embedded form). Defaults to `startUrl`.
   */
  destinationUrl?: string;
  assets?: readonly Readonly<{ origin: string; pathPrefix: string }>[];
  bootstrapRequests?: readonly DeliveryRequestRule[];
  /** Enables type-to-search comboboxes. Lookups carry only the approved typed value. */
  searches?: readonly DeliverySearchRule[];
  steps: readonly DeliveryStepPolicy[];
  receipt: Readonly<{ url: string; selector: string; textPattern: string; receiptIdAttribute?: string }>;
  /** Only the concrete Greenhouse adapter can enable this presign protocol. */
  greenhouse?: Readonly<{ presignOrigin: string; uploadOrigins: readonly string[] }>;
  /**
   * `invisibleHcaptcha`: Lever's hCaptcha scores the browser passively on
   * submit. Only its scripts, frames and passive assessment are admitted; a
   * visible challenge at any point hands over. Answers are never sent.
   */
  lever?: Readonly<{ accountIdSelector: string; invisibleHcaptcha?: boolean }>;
  ashby?: Readonly<{ board: string; jobId: string }>;
}>;
export type DeliverySubmissionLease = Readonly<{ attemptId: string; idempotencyKey: string; sealHash?: string }>;
export type DeliveryResponseEvidence = Readonly<{ url: string; status: number; bodyHash: string | null; redirectUrl?: string; ashbyAccepted?: boolean; ashbyDiagnostic?: AshbySubmissionDiagnostics }>;
export type DeliveryPriorSubmission = DeliverySubmissionLease & Readonly<{
  reviewHash: string; requestFingerprint: string; response?: DeliveryResponseEvidence;
}>;
export type DeliveryReceipt = Readonly<{
  attemptId: string; url: string; observedAt: string; bodyHash: string;
  requestFingerprint: string; receiptId: string | null; response: DeliveryResponseEvidence;
}>;
export type DeliverySubmissionHooks = Readonly<{
  begin(input: Readonly<{ reviewHash: string; requestFingerprint: string; review: Readonly<Record<string, unknown>> }>): Promise<DeliverySubmissionLease>;
  checkpoint?(state: Readonly<Record<string, unknown>>): Promise<void>;
  /** The candidate completes a visible check in an embedded, guarded browser. */
  browserVerification?: Readonly<{
    open(): Promise<number | null>;
    poll(): Promise<void>;
    close(): Promise<void>;
  }>;
}>;
export type DeliverySubmitResult =
  | Readonly<{ kind: "CONFIRMED"; receipt: DeliveryReceipt; submission: DeliveryPriorSubmission }>
  | Readonly<{ kind: "UNCERTAIN"; reasonCode: string; submission: DeliveryPriorSubmission | null }>
  | Readonly<{ kind: "TAKEOVER"; reasonCode: string }>
  /**
   * The employer declined the final request and emailed the applicant a code
   * (Greenhouse's fallback when its invisible CAPTCHA does not pass). Nothing
   * was accepted. `verify()` resends this same attempt with the code.
   */
  | Readonly<{ kind: "VERIFICATION_REQUIRED"; reasonCode: string; recipient: string; submission: DeliveryPriorSubmission }>;

type Presign = { url: string; fields: Record<string, string>; keyPattern: string };
type ActionWindow = {
  kind: "UPLOAD" | "MOVE" | "SUBMIT";
  request?: DeliveryRequestRule;
  admitted: boolean;
  requestObject?: Request;
  response?: DeliveryResponseEvidence;
  artifact?: MaterializedApplicationArtifact;
  uploadFields?: Readonly<Record<string, string>>;
  strictMultipart?: boolean;
  presign?: Presign;
  reviewHash?: string;
  review?: Readonly<Record<string, unknown>>;
  verifyReview?: () => Promise<void>;
  submission?: DeliveryPriorSubmission;
  beginStarted?: boolean;
  error?: string;
  signal?: AbortSignal;
  humanVerification?: boolean;
  humanVerificationDeadline?: number;
  /** The final request's body, kept in memory to bind a verification resend. */
  requestBody?: Buffer;
  /** The employer asked for an emailed code in its response. */
  challenge?: Readonly<{ recipient: string }>;
  /** A resend of the same attempt carrying the candidate's code. */
  verification?: Readonly<{ code: string; firstBody: Readonly<Record<string, unknown>> }>;
};
type PendingVerification = {
  submission: DeliveryPriorSubmission; firstBody: Readonly<Record<string, unknown>>;
  request: DeliveryRequestRule; selector: string; recipient: string; sends: number;
};

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const canonical = (url: string) => { const parsed = new URL(url); parsed.hash = ""; return parsed.href; };
const requestMatches = (request: Request, rule: DeliveryRequestRule) => request.method() === rule.method && canonical(request.url()) === canonical(rule.url);
const safeError = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/u.test(error.message) ? error.message : "DELIVERY_BROWSER_ACTION_FAILED";
function assertActive(signal?: AbortSignal) { if (signal?.aborted) throw new Error("DELIVERY_CANCELED"); }

/** Greenhouse's emailed-code form: eight single-character boxes. */
const VERIFICATION_INPUTS = 'fieldset#email-verification input[id^="security-input-"]';
export const VERIFICATION_CODE_PATTERN = /^[A-Za-z0-9]{8}$/u;
function jsonObject(body: Buffer | null | undefined): Readonly<Record<string, unknown>> | null {
  if (!body || body.length > 2_000_000) return null;
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
/** The CAPTCHA token the code replaces; the page may also mark a retry. */
const VERIFICATION_REPLACED_KEYS = new Set(["g-recaptcha-enterprise-token", "captcha_retried"]);
/**
 * A verification resend is the first request's exact content plus the code:
 * every other key must be present with an identical value, and only the
 * CAPTCHA token (or its retry marker) may be dropped.
 */
export function verificationBodyMatches(body: Buffer | null | undefined, expected: Readonly<{ code: string; firstBody: Readonly<Record<string, unknown>> }>): boolean {
  const second = jsonObject(body);
  if (!second || second.security_code !== expected.code) return false;
  for (const [key, value] of Object.entries(second)) {
    if (key === "security_code") continue;
    if (VERIFICATION_REPLACED_KEYS.has(key) || !Object.hasOwn(expected.firstBody, key) || JSON.stringify(value) !== JSON.stringify(expected.firstBody[key])) return false;
  }
  return Object.keys(expected.firstBody).every((key) => VERIFICATION_REPLACED_KEYS.has(key) || Object.hasOwn(second, key));
}

/**
 * Upload widgets show the selected file's name, sometimes shortened with an
 * ellipsis. Uploads use sanitized names without spaces, so one displayed token
 * must be the exact name or a clearly shortened form of it: a long exact
 * prefix, plus the exact tail including the extension for a middle ellipsis.
 * The HTTP response and byte checks remain the primary upload evidence.
 */
export function displaysUploadFilename(text: string, filename: string): boolean {
  if (!filename || /\s/u.test(filename)) return false;
  if (text.includes(filename)) return true;
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return text.split(/\s+/u).some((token) => {
    const shortened = /^([^\u2026]+?)(?:\u2026|\.{3})([^\u2026]*)$/u.exec(token);
    if (!shortened) return false;
    const [, prefix, suffix] = shortened;
    if (prefix.length + suffix.length >= filename.length || !filename.startsWith(prefix) || !filename.endsWith(suffix)) return false;
    return suffix ? prefix.length >= 8 && suffix.toLowerCase().endsWith(extension) : prefix.length >= 16;
  });
}

function parseMultipart(body: Buffer, contentType: string): Readonly<{ fields: Record<string, string>; file: Buffer }> | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/iu.exec(contentType)?.slice(1).find(Boolean);
  if (!boundary || boundary.length > 150) return null;
  const marker = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: Buffer | null = null;
  let offset = 0;
  while ((offset = body.indexOf(marker, offset)) >= 0) {
    const start = offset + marker.length + 2;
    const end = body.indexOf(marker, start);
    if (end < 0) break;
    const divider = body.indexOf(Buffer.from("\r\n\r\n"), start);
    if (divider < start || divider >= end) return null;
    const header = body.subarray(start, divider).toString("utf8");
    const name = /name="([^"\r\n]+)"/u.exec(header)?.[1];
    if (!name || Object.hasOwn(fields, name)) return null;
    const data = body.subarray(divider + 4, end - 2);
    if (/filename="/u.test(header)) {
      if (file) return null;
      file = data;
    } else fields[name] = data.toString("utf8");
    offset = end;
  }
  return file ? { fields, file } : null;
}

/** Candidate payload bytes are checked inside the browser request boundary. */
function uploadBodyMatches(request: Request, action: ActionWindow): boolean {
  const body = request.postDataBuffer();
  const artifact = action.artifact;
  if (!body || !artifact) return false;
  const contentType = request.headers()["content-type"] || "";
  if (action.strictMultipart) {
    const boundary = /boundary=(?:"([^"\r\n]+)"|([^;\s]+))/iu.exec(contentType)?.slice(1).find(Boolean);
    if (!boundary || !body.subarray(0, boundary.length + 4).equals(Buffer.from(`--${boundary}\r\n`)) || !body.subarray(-(boundary.length + 8)).equals(Buffer.from(`\r\n--${boundary}--\r\n`))) return false;
    const parts = body.toString("latin1").split(`--${boundary}`);
    for (const part of parts.slice(1, -1)) {
      const header = part.slice(2, part.indexOf("\r\n\r\n"));
      const fileHeader = `Content-Disposition: form-data; name="file"; filename="${artifact.filename}"\r\nContent-Type: ${artifact.mediaType}`;
      if (header !== fileHeader && !/^Content-Disposition: form-data; name="[A-Za-z0-9_-]{1,100}"$/u.test(header)) return false;
    }
  }
  if (!contentType.includes("multipart/form-data")) return !action.strictMultipart && body.length === artifact.byteSize && hash(body) === artifact.sha256;
  const multipart = parseMultipart(body, contentType);
  if (!multipart || multipart.file.length !== artifact.byteSize || hash(multipart.file) !== artifact.sha256) return false;
  if (action.uploadFields && (Object.keys(multipart.fields).length !== Object.keys(action.uploadFields).length || Object.entries(action.uploadFields).some(([key, value]) => multipart.fields[key] !== value))) return false;
  if (action.presign) {
    if (Object.entries(action.presign.fields).some(([key, value]) => multipart.fields[key] !== value)) return false;
    const pattern = action.presign.keyPattern.split(/(\{timestamp\}|\{unique_id\})/u)
      .map((part) => part === "{timestamp}" ? "[0-9]{10,16}" : part === "{unique_id}" ? "[a-z0-9]{1,20}" : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("");
    if (!new RegExp(`^${pattern}$`, "u").test(multipart.fields.key || "")) return false;
  }
  return true;
}

function validatePolicy(policy: DeliverySitePolicy): void {
  const start = new URL(policy.startUrl);
  if (start.username || start.password || !(start.protocol === "https:" || start.protocol === "http:" && ["127.0.0.1", "localhost"].includes(start.hostname))) throw new Error("DELIVERY_POLICY_URL_INVALID");
  if (policy.destinationUrl) {
    const destination = new URL(policy.destinationUrl);
    if (destination.username || destination.password || destination.protocol !== start.protocol) throw new Error("DELIVERY_POLICY_URL_INVALID");
  }
  if (!policy.steps.length || policy.steps.length > 12 || new Set(policy.steps.map((step) => step.id)).size !== policy.steps.length) throw new Error("DELIVERY_POLICY_STEPS_INVALID");
  const finalEndpoints = new Set(policy.steps.flatMap((step) => step.submit ? [canonical(step.submit.request.url)] : []));
  if (policy.bootstrapRequests?.some((rule) => rule.method !== "GET" || finalEndpoints.has(canonical(rule.url)))) throw new Error("DELIVERY_POLICY_BOOTSTRAP_INVALID");
  for (const step of policy.steps) {
    if (new URL(step.url).origin !== start.origin) throw new Error("DELIVERY_POLICY_STEP_ORIGIN_INVALID");
    for (const move of [step.forward, step.back]) {
      if (move && (!policy.steps.some((next) => next.id === move.nextStepId) || move.request && finalEndpoints.has(canonical(move.request.url)))) throw new Error("DELIVERY_POLICY_NEXT_IS_SUBMIT");
    }
    if (step.forward && step.submit) throw new Error("DELIVERY_POLICY_AMBIGUOUS_FINAL_STEP");
  }
  if (new URL(policy.receipt.url).origin !== start.origin) throw new Error("DELIVERY_POLICY_RECEIPT_ORIGIN_INVALID");
  const sideEffects = new Set(policy.steps.flatMap((step) => [step.submit?.request, step.forward?.request, step.back?.request, ...(step.uploads ?? []).map((upload) => upload.request)])
    .flatMap((rule) => rule ? [canonical(rule.url).split("?")[0]] : []));
  for (const rule of policy.searches ?? []) {
    const url = new URL(rule.path, rule.origin);
    if (url.origin !== rule.origin || url.pathname !== rule.path || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(rule.query) ||
      !(url.protocol === "https:" || url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) ||
      sideEffects.has(canonical(url.href).split("?")[0])) throw new Error("DELIVERY_POLICY_SEARCH_INVALID");
    for (const [name, value] of Object.entries(rule.params ?? {})) {
      if (name === rule.query || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(name) || typeof value !== "string" || !value || value.length > 120 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("DELIVERY_POLICY_SEARCH_INVALID");
    }
  }
  new RegExp(policy.receipt.textPattern, "iu");
}

/**
 * Isolated delivery egress lane. No model-supplied URL, selector, or script is
 * accepted. A final request remains paused until durable one-use authority is
 * consumed. The legacy Browserbase hard no-submit guard is never relaxed.
 */
export async function createApplicationDeliveryBrowser(input: Readonly<{
  page: Page; policy: DeliverySitePolicy; hooks: DeliverySubmissionHooks; timeoutMs?: number;
  requestTransport?: DeliveryRequestTransport;
}>) {
  const { page, policy, hooks } = input;
  validatePolicy(policy);
  const timeoutMs = input.timeoutMs ?? 15_000;
  const dispatch = input.requestTransport ?? ((route: Route) => route.continue());
  const context = page.context();
  if (context.serviceWorkers().length) throw new Error("DELIVERY_SERVICE_WORKER_UNSUPPORTED");
  await context.addInitScript(() => {
    if ("serviceWorker" in navigator) Object.defineProperty(navigator.serviceWorker, "register", {
      configurable: false, value: () => Promise.reject(new Error("DELIVERY_SERVICE_WORKER_BLOCKED")),
    });
  });
  let action: ActionWindow | null = null;
  let loading = false;
  let submitConsumed = false;
  let blockedRequests = 0;
  let submittedRequests = 0;
  let closed = false;
  let pendingVerification: PendingVerification | null = null;
  const ashby = policy.ashby ? createAshbyProtocol(policy.ashby.board, policy.ashby.jobId) : null;
  const ashbyRequests = new WeakMap<Request, AshbyEnvelope>();
  let ashbyError: string | null = null;
  let ashbyFieldSignal: AbortSignal | undefined;
  let activeSearch: Readonly<{ query: string; signal?: AbortSignal }> | null = null;
  const presigns = new Map<string, Presign>();
  const recaptchaKeys = new Set<string>();
  const pending = new Set<Promise<void>>();
  const uploadProofs = new Map<string, Readonly<{ artifactVersionId: string; filename: string; sha256: string; byteSize: number; acknowledgementHash: string; response: DeliveryResponseEvidence }>>();
  const uploadChecks = new Map<string, Readonly<{ stepId: string; selector: string; filename: string }>>();
  const uploadedArtifacts = new Map<string, MaterializedApplicationArtifact>();

  function isPassiveFrameUrl(value: string): boolean {
    if (!policy.greenhouse && !ashby) return false;
    // A DOM iframe.src can be known before Playwright's frame.url(). Evaluate
    // that exact URL against the adapter's observed key, never a stale list.
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    return url.origin === "https://www.recaptcha.net" && ["/recaptcha/enterprise/anchor", ...(ashby ? ["/recaptcha/api2/anchor"] : [])].includes(url.pathname) &&
      url.searchParams.get("size") === "invisible" && recaptchaKeys.has(url.searchParams.get("k") ?? "");
  }
  function isReviewedChallengeFrameUrl(value: string): boolean {
    if (!policy.greenhouse && !ashby) return false;
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    // The SDK mounts its idle challenge document before any challenge exists.
    // This is URL identity only: the observer must separately reject visibility.
    return url.origin === "https://www.recaptcha.net"
      && ["/recaptcha/enterprise/bframe", ...(ashby ? ["/recaptcha/api2/bframe"] : [])].includes(url.pathname)
      && recaptchaKeys.has(url.searchParams.get("k") ?? "");
  }
  function passiveFrameUrls(): string[] {
    return page.frames().map((frame) => frame.url()).filter(isPassiveFrameUrl);
  }

  function isPresign(request: Request): boolean {
    if (!policy.greenhouse || request.method() !== "GET") return false;
    const url = new URL(request.url());
    return url.origin === policy.greenhouse.presignOrigin && url.pathname === "/uncacheable_attributes/presigned_fields" &&
      [...url.searchParams.keys()].every((key) => key === "fields[]") &&
      url.searchParams.getAll("fields[]").length > 0 && url.searchParams.getAll("fields[]").every((field) => ["resume", "cover_letter"].includes(field));
  }
  function isRecaptcha(request: Request): boolean {
    if (!policy.greenhouse && !ashby) return false;
    const url = new URL(request.url());
    if (url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/recaptcha/") && request.method() === "GET") return true;
    if (url.origin !== "https://www.recaptcha.net") return false;
    if (request.method() === "GET" && (url.pathname === "/recaptcha/enterprise.js" || ashby && url.pathname === "/recaptcha/api.js")) {
      const key = url.searchParams.get("render");
      if (!key || !/^[A-Za-z0-9_-]{25,100}$/u.test(key)) return false;
      if (ashby && !["6LeFb_YUAAAAALUD5h-BiQEp8JaFChe0e0A6r49Y", "6LezdY0tAAAAAEnollNLCAI0z1VDGwM7AzGrU4XZ"].includes(key)) return false;
      recaptchaKeys.add(key); return true;
    }
    if (request.method() === "GET" && ["/recaptcha/enterprise/webworker.js", ...(ashby ? ["/recaptcha/api2/webworker.js"] : [])].includes(url.pathname)) return recaptchaKeys.size > 0;
    if (!recaptchaKeys.has(url.searchParams.get("k") ?? "")) return false;
    if (request.method() === "GET" && ["/recaptcha/enterprise/anchor", "/recaptcha/enterprise/bframe", ...(ashby ? ["/recaptcha/api2/anchor", "/recaptcha/api2/bframe"] : [])].includes(url.pathname)) return true;
    // Challenge traffic is admitted only while the candidate's Live View is
    // open. The model has no challenge tools, and final sends still read back.
    if (action?.humanVerification && !action.error && !action.signal?.aborted && request.method() === "GET" &&
        ["/recaptcha/enterprise/payload", "/recaptcha/api2/payload"].includes(url.pathname)) return true;
    return action?.kind === "SUBMIT" && request.method() === "POST" &&
      ["/recaptcha/enterprise/reload", "/recaptcha/enterprise/clr", ...(ashby ? ["/recaptcha/api2/reload", "/recaptcha/api2/clr"] : []),
        ...(action.humanVerification && !action.error && !action.signal?.aborted ? ["/recaptcha/enterprise/userverify", "/recaptcha/api2/userverify"] : [])].includes(url.pathname) && (request.postDataBuffer()?.length ?? 0) <= 128_000;
  }
  const startHost = new URL(policy.startUrl).hostname;
  const hcaptchaKeys = new Set<string>();
  function isHcaptcha(request: Request): boolean {
    if (!policy.lever?.invisibleHcaptcha) return false;
    const url = new URL(request.url());
    if (request.method() === "GET") {
      if (action?.humanVerification && !action.error && !action.signal?.aborted && url.origin === "https://imgs.hcaptcha.com" && request.resourceType() === "image") return true;
      // Live Lever forms load the `secure-api.js` loader (observed 2026-09-28).
      return ["https://js.hcaptcha.com", "https://hcaptcha.com"].includes(url.origin) && ["/1/api.js", "/1/secure-api.js"].includes(url.pathname) ||
        url.origin === "https://newassets.hcaptcha.com" && /^\/(?:captcha\/v1|c)\/[A-Za-z0-9._-]{1,80}\//u.test(url.pathname) ||
        // Passive connectivity beacon the loader requests from its own subdomains.
        /^https:\/\/[0-9a-f]{12}\.w\.hcaptcha\.com$/u.test(url.origin) && url.pathname === "/logo.png" && !url.search;
    }
    if (request.method() !== "POST" || !["https://api.hcaptcha.com", "https://api2.hcaptcha.com"].includes(url.origin) || (request.postDataBuffer()?.length ?? 0) > 128_000) return false;
    // User challenge responses are allowed only in the guarded human window.
    const challenge = /^\/checkcaptcha\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,200}$/u.exec(url.pathname);
    if (action?.humanVerification && !action.error && !action.signal?.aborted && challenge && hcaptchaKeys.has(challenge[1])) return true;
    if (url.pathname === "/checksiteconfig") {
      const key = url.searchParams.get("sitekey") ?? "";
      if (url.searchParams.get("host") !== startHost || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(key)) return false;
      hcaptchaKeys.add(key); return true;
    }
    const passive = /^\/getcaptcha\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(url.pathname);
    return action?.kind === "SUBMIT" && Boolean(passive && hcaptchaKeys.has(passive[1]));
  }
  async function onResponse(response: Response) {
    const current = action;
    if (isPresign(response.request()) && response.ok()) {
      const data = await response.json() as Record<string, unknown>;
      if (typeof data.url !== "string" || !policy.greenhouse?.uploadOrigins.includes(new URL(data.url).origin)) return;
      for (const field of ["resume", "cover_letter"]) {
        const value = data[field] as { fields?: unknown; key?: unknown } | undefined;
        if (!value || typeof value.key !== "string" || !value.key.startsWith("stash/applications/") || !value.fields || typeof value.fields !== "object") continue;
        const entries = Object.entries(value.fields);
        if (entries.length > 20 || entries.some(([key, val]) => !/^[A-Za-z0-9_-]{1,100}$/u.test(key) || typeof val !== "string" || val.length > 10_000)) continue;
        presigns.set(field, { url: canonical(data.url), keyPattern: value.key, fields: Object.fromEntries(entries) });
      }
    }
    const ashbyEnvelope = ashbyRequests.get(response.request());
    if (ashby && ashbyEnvelope && !ashbyEnvelope.operation.startsWith("ApiSubmit")) {
      if (!response.ok()) throw new Error("DELIVERY_ASHBY_RESPONSE_REJECTED");
      ashby.observe(ashbyEnvelope, await response.json());
      if (ashbyEnvelope.operation === "ApiCreateFileUploadHandle" && current?.kind === "UPLOAD") {
        const upload = ashby.upload();
        if (!upload?.url || !upload.fields) throw new Error("DELIVERY_ASHBY_UPLOAD_HANDLE_UNVERIFIED");
        current.request = { method: "POST", url: upload.url };
        current.uploadFields = upload.fields;
      }
    }
    if (current?.requestObject === response.request() || current?.kind === "UPLOAD" && ashbyEnvelope?.operation === "ApiSetFormValueToFile") {
      // Chromium can leave getResponseBody pending after a fast redirect. The
      // HTTP status remains observed evidence; unavailable bytes are explicit.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const body = await Promise.race([
        response.body().catch(() => null),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.min(timeoutMs, 500)); }),
      ]);
      if (timer) clearTimeout(timer);
      const location = response.headers().location;
      current.response = { url: canonical(response.url()), status: response.status(), bodyHash: body ? hash(body) : null, ...(location ? { redirectUrl: canonical(new URL(location, response.url()).href) } : {}) };
      if (ashby && current.kind === "UPLOAD" && current.requestObject === response.request() && response.ok()) ashby.acknowledgeBytes();
      if (ashbyEnvelope?.operation.startsWith("ApiSubmit")) current.response = { ...current.response,
        ashbyAccepted: Boolean(body && ashbySubmissionAccepted(ashbyEnvelope.operation, jsonObject(body), ashby?.surveyCount())),
        ashbyDiagnostic: inspectAshbySubmissionResponse(ashbyEnvelope.operation, body, ashby?.surveyCount()) };
      // Greenhouse answers 428 {code: "captcha-failed", security_code_recipient}
      // when it wants the applicant to confirm by email instead.
      if (policy.greenhouse && current.kind === "SUBMIT" && response.status() === 428 && body && body.length <= 64_000) {
        const data = jsonObject(body);
        const recipient = data?.code === "captcha-failed" && typeof data.security_code_recipient === "string" ? data.security_code_recipient.trim() : "";
        if (recipient && recipient.length <= 320 && !/[\u0000-\u001f<>]/u.test(recipient)) current.challenge = { recipient };
      }
      if (current.submission) {
        current.submission = { ...current.submission, response: current.response };
        await hooks.checkpoint?.({ phase: "SUBMIT_RESPONSE_OBSERVED", submission: current.submission });
      }
    }
  }
  const responseListener = (response: Response) => {
    const operation = onResponse(response).catch((error) => { if (ashby) ashbyError ??= safeError(error); if (action) action.error ??= safeError(error); });
    pending.add(operation); void operation.finally(() => pending.delete(operation));
  };
  page.on("response", responseListener);
  const routeHandler = async (route: Route) => {
    const request = route.request();
    const current = action;
    try {
      if (closed) { await route.abort("blockedbyclient"); return; }
      if (current?.humanVerification && (Date.now() >= (current.humanVerificationDeadline ?? 0) || current.signal?.aborted)) {
        current.error ??= "DELIVERY_BROWSER_VERIFICATION_TIMEOUT";
        blockedRequests += 1; await route.abort("blockedbyclient"); return;
      }
      const recaptcha = isRecaptcha(request);
      const hcaptcha = isHcaptcha(request);
      try {
        if (request.frame().page() !== page) { blockedRequests += 1; await route.abort(); return; }
      } catch {
        // Worker requests have no frame: only fixed CAPTCHA script assets pass.
        if (recaptcha && request.method() === "GET" && new URL(request.url()).origin === "https://www.gstatic.com") { await dispatch(route); return; }
        if (hcaptcha && request.method() === "GET" && new URL(request.url()).origin === "https://newassets.hcaptcha.com") { await dispatch(route); return; }
        blockedRequests += 1; await route.abort(); return;
      }
      // Ashby chains each mutation from the previous response. Complete its
      // server-side readback before admitting the browser's next chained step.
      if (ashby) await drain();
      const url = new URL(request.url());
      const ashbyInspection = ashby ? inspectAshbyEnvelope(request.url(), request.method(), request.postDataBuffer(), new URL(policy.startUrl).origin) : null;
      const ashbyEnvelope = ashbyInspection?.envelope;
      if (ashby && url.origin === new URL(policy.startUrl).origin && url.pathname === "/api/non-user-graphql" && !ashbyEnvelope) throw new Error(ashbyInspection?.rejection || "DELIVERY_ASHBY_REQUEST_ENVELOPE_INVALID");
      if (ashbyEnvelope && ashby) {
        if (ashbyError || ashbyFieldSignal?.aborted || current?.error || current?.signal?.aborted) throw new Error(ashbyError || current?.error || "DELIVERY_CANCELED");
        const permission = ashby.authorize(ashbyEnvelope, activeSearch && !activeSearch.signal?.aborted ? activeSearch.query : undefined, current?.kind === "SUBMIT" && !current.admitted && !submitConsumed);
        if (!permission) throw new Error(ashby.authorizationFailure() || "DELIVERY_ASHBY_REQUEST_PERMISSION_INVALID");
        ashbyRequests.set(request, ashbyEnvelope);
        if (permission !== "SUBMIT") { await dispatch(route); return; }
      }
      const asset = request.method() === "GET" && ["script", "stylesheet", "image", "font"].includes(request.resourceType()) &&
        policy.assets?.some((rule) => url.origin === rule.origin && url.pathname.startsWith(rule.pathPrefix));
      const ashbyManifest = Boolean(ashby) && request.method() === "GET" && url.origin === "https://cdn.ashbyprd.com" && !url.search && !url.hash && /^\/frontend_non_user\/[a-f0-9]{40}\/\.vite\/manifest\.json$/u.test(url.pathname);
      const translation = Boolean(policy.greenhouse) && request.method() === "GET" && url.origin === "https://job-boards.cdn.greenhouse.io" && !url.search &&
        /^\/locales\/[A-Za-z-]{2,20}\/(?:job_post|common|confirmation)\.[A-Za-z0-9_-]{20,100}\.json$/u.test(url.pathname);
      const bootstrap = loading && request.method() === "GET" && canonical(request.url()) === canonical(policy.startUrl) ||
        isPresign(request) || policy.bootstrapRequests?.some((rule) => requestMatches(request, rule));
      const search = activeSearch && !activeSearch.signal?.aborted && request.method() === "GET" && ["fetch", "xhr"].includes(request.resourceType()) &&
        Boolean(policy.searches?.some((rule) => searchPermitted(url, rule, activeSearch!.query)));
      const receiptNavigation = current?.kind === "SUBMIT" && current.admitted && request.method() === "GET" && canonical(request.url()) === canonical(policy.receipt.url);
      const moveNavigation = current?.kind === "MOVE" && current.admitted && request.method() === "GET" && policy.steps.some((step) => canonical(step.url) === canonical(request.url()));
      if (asset || ashbyManifest || translation || bootstrap || search || recaptcha || hcaptcha || receiptNavigation || moveNavigation) { await dispatch(route); return; }
      // A CORS preflight has no candidate payload; it is limited to this exact
      // active action endpoint and requested method, never a wildcard origin.
      if (current?.request && request.method() === "OPTIONS" && canonical(request.url()) === canonical(current.request.url) &&
        request.headers()["access-control-request-method"] === current.request.method) { await dispatch(route); return; }
      // An action that already stopped (for example on a visible CAPTCHA) admits nothing.
      if (!current?.request || !requestMatches(request, current.request) || current.admitted || current.error || current.signal?.aborted) {
        blockedRequests += 1; await route.abort("blockedbyclient"); return;
      }
      current.admitted = true;
      current.requestObject = request;
      if (current.kind === "UPLOAD" && !uploadBodyMatches(request, current)) throw new Error("DELIVERY_UPLOAD_BODY_MISMATCH");
      if (current.kind === "SUBMIT" && current.verification) {
        // The same attempt resent with the emailed code. No new authority is
        // taken: the content must equal what the sealed attempt already sent.
        if (!verificationBodyMatches(request.postDataBuffer(), current.verification)) throw new Error("DELIVERY_VERIFICATION_BODY_MISMATCH");
        assertActive(current.signal);
        current.beginStarted = true;
        await hooks.checkpoint?.({ phase: "VERIFICATION_DISPATCHING", submission: current.submission });
        assertActive(current.signal);
        submittedRequests += 1;
      } else if (current.kind === "SUBMIT") {
        if (submitConsumed) throw new Error("DELIVERY_SUBMISSION_ALREADY_CONSUMED");
        if (policy.lever) {
          const multipart = parseMultipart(request.postDataBuffer() ?? Buffer.alloc(0), request.headers()["content-type"] || "");
          const artifacts = [...uploadedArtifacts.values()];
          if (!multipart || artifacts.length !== 1 || multipart.file.length !== artifacts[0].byteSize || hash(multipart.file) !== artifacts[0].sha256) throw new Error("DELIVERY_SUBMIT_ARTIFACT_MISMATCH");
        }
        if (current.humanVerification) {
          // Providers may invoke their callback just before hiding the widget.
          // Wait for its actual disappearance; never suppress the final check.
          const hidden = await waitFor(async () => !await pageShowsCaptchaChallenge(page, ashby ? passiveFrameUrls() : []), current.signal);
          if (!hidden) throw new Error(APPLICATION_FILL_CAPTCHA_TAKEOVER);
        }
        await current.verifyReview?.();
        assertActive(current.signal);
        submitConsumed = true;
        current.beginStarted = true;
        const body = request.postDataBuffer() ?? Buffer.from("");
        current.requestBody = body;
        const requestFingerprint = hash(JSON.stringify({ method: request.method(), url: canonical(request.url()), bodyHash: hash(body) }));
        const lease = await hooks.begin({ reviewHash: current.reviewHash!, requestFingerprint, review: current.review! });
        current.submission = { ...lease, reviewHash: current.reviewHash!, requestFingerprint };
        assertActive(current.signal);
        await hooks.checkpoint?.({ phase: "SUBMIT_DISPATCHING", submission: current.submission });
        assertActive(current.signal);
        submittedRequests += 1;
      }
      await dispatch(route); } catch (error) {
      const reason = safeError(error);
      // Keep the first protocol rejection even when it arrives between action
      // windows, or a later chained request fails because that rejection stopped us.
      if (ashby && reason.startsWith("DELIVERY_ASHBY_")) ashbyError ??= reason;
      if (current) current.error ??= reason;
      blockedRequests += 1;
      await route.abort("blockedbyclient").catch(() => undefined);
    }
  };
  await context.route("**/*", routeHandler);
  await context.routeWebSocket("**/*", (socket) => socket.close());

  async function drain() { await Promise.all([...pending]); }
  async function uploadAcknowledgementText(selector: string): Promise<string> {
    const target = page.locator(selector);
    // Lever styles this filename with text-transform. Its DOM text preserves
    // the actual filename; innerText changes its case for presentation only.
    return (policy.lever ? await target.textContent() ?? "" : await target.innerText()).trim();
  }
  async function waitFor(check: () => Promise<boolean>, signal?: AbortSignal, extendedDeadline?: () => number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      assertActive(signal);
      await drain();
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < Math.max(deadline, extendedDeadline?.() ?? 0));
    return false;
  }
  async function currentStep(): Promise<DeliveryStepPolicy | null> {
    const matches: DeliveryStepPolicy[] = [];
    for (const step of policy.steps) {
      if (canonical(page.url()) === canonical(step.url) && await page.locator(step.readySelector).count() === 1 && await page.locator(step.readySelector).isVisible()) matches.push(step);
    }
    if (matches.length > 1) throw new Error("DELIVERY_STEP_AMBIGUOUS");
    const step = matches[0];
    if (!step || !ashby) return step ?? null;
    if (ashbyError) throw new Error(ashbyError);
    if (!ashby.ready()) return null;
    return { ...step, uploads: ashby.fileFields().map(({ formId, path }) => ({ fieldId: path, fieldName: path,
      selector: `[data-field-entry-id="${formId}_${path}"] input[type="file"]`,
      acknowledgementSelector: `[data-field-entry-id="${formId}_${path}"] .ashby-application-form-input-file-item-name` })),
      submit: { selector: ".ashby-application-form-submit-button", request: { method: "POST", url: ashby.endpoint(ashby.submitOperation(), new URL(policy.startUrl).origin) } } };

  }
  async function verificationShown(): Promise<boolean> {
    if (!policy.greenhouse) return false;
    const inputs = page.locator(VERIFICATION_INPUTS);
    return await inputs.count() === 8 && await inputs.first().isVisible();
  }
  async function receipt(submission: DeliveryPriorSubmission): Promise<DeliveryReceipt | null> {
    const response = submission.response;
    const acceptedResponse = response && (response.status >= 200 && response.status < 300 || [302, 303].includes(response.status) && response.redirectUrl === canonical(policy.receipt.url));
    if (!response || ashby && response.ashbyAccepted !== true || !acceptedResponse || canonical(page.url()) !== canonical(policy.receipt.url)) return null;
    const locator = page.locator(policy.receipt.selector);
    if (await locator.count() !== 1 || !await locator.isVisible()) return null;
    const text = (await locator.innerText()).trim();
    if (!new RegExp(policy.receipt.textPattern, "iu").test(text)) return null;
    const receiptId = policy.receipt.receiptIdAttribute ? await locator.getAttribute(policy.receipt.receiptIdAttribute) : null;
    if (policy.receipt.receiptIdAttribute && !receiptId) return null;
    return { attemptId: submission.attemptId, url: canonical(page.url()), observedAt: new Date().toISOString(), bodyHash: hash(text), requestFingerprint: submission.requestFingerprint, receiptId, response };
  }
  return Object.freeze({
    policy, currentStep,
    async withField<T>(field: AgentBrowserField, approved: AgentFieldValue, work: () => Promise<T>, signal?: AbortSignal, match?: OptionMatch): Promise<T> {
      if (!ashby) return work();
      assertActive(signal);
      if (closed || action || submitConsumed || ashbyError) throw new Error(ashbyError || "DELIVERY_ACTION_NOT_AVAILABLE");
      ashby.beginField(field, approved, match);
      ashbyFieldSignal = signal;
      try {
        const result = await work();
        const acknowledged = await waitFor(async () => Boolean(ashbyError || ashby.fieldAcknowledged()), signal);
        if (!acknowledged || ashbyError || !ashby.fieldAcknowledged()) throw new Error(ashbyError || "DELIVERY_ASHBY_FIELD_NOT_ACKNOWLEDGED");
        return result;
      } finally { await drain(); ashby.endField(); ashbyFieldSignal = undefined; }
    },
    savedFieldProofs: () => ashby?.review() ?? [],
    /** Opened only around a server-approved field fill, never by the page or model. */
    async withSearch<T>(query: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      assertActive(signal);
      if (closed || action || submitConsumed || activeSearch || !(policy.searches?.length || ashby) || !query.trim() || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) {
        throw new Error("DELIVERY_SEARCH_NOT_AUTHORIZED");
      }
      activeSearch = { query, signal };
      try { return await work(); } finally { activeSearch = null; }
    },
    passiveFrameUrls, isPassiveFrameUrl, isReviewedChallengeFrameUrl,
    async open(signal?: AbortSignal) {
      assertActive(signal);
      if (page.url() !== "about:blank" && canonical(page.url()) !== canonical(policy.startUrl) && !await currentStep()) throw new Error("DELIVERY_RESTORE_DESTINATION_INVALID");
      // Every pre-submit recovery rebuilds from the first step and re-observes
      // all prior values/uploads. An empty in-memory review can never inherit
      // a retained later step. Submitted attempts use reconcile(), not open().
      loading = true;
      try { await page.goto(policy.startUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }); }
      finally { loading = false; }
      await waitFor(async () => Boolean(await currentStep()), signal);
      if (policy.greenhouse) await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
      await drain();
      if (!await currentStep()) throw new Error("DELIVERY_STEP_UNSUPPORTED");
      if (policy.lever) {
        const form = page.locator("#application-form");
        if (await form.count() !== 1 || (await form.getAttribute("method"))?.toUpperCase() !== "POST" || (await form.getAttribute("enctype"))?.toLowerCase() !== "multipart/form-data" ||
          canonical(new URL(await form.getAttribute("action") || "", page.url()).href) !== canonical(policy.startUrl)) throw new Error("DELIVERY_FORM_CONTRACT_DRIFT");
      }
      for (const rule of (await currentStep())?.uploads ?? []) {
        const acknowledgement = page.locator(rule.acknowledgementSelector);
        if (!await page.locator(rule.selector).count() && await acknowledgement.count() && (await acknowledgement.first().innerText()).trim()) throw new Error("DELIVERY_UNVERIFIED_EXISTING_UPLOAD");
      }
    },
    async upload(field: AgentBrowserField, artifact: MaterializedApplicationArtifact, signal?: AbortSignal) {
      assertActive(signal);
      if (action) throw new Error("DELIVERY_ACTION_BUSY");
      const step = await currentStep();
      const rule = step?.uploads?.find((item) => item.fieldId && item.fieldId === field.domId || item.fieldName && item.fieldName === field.name);
      if (!rule || field.kind !== "FILE" || field.hasValue) throw new Error("DELIVERY_UPLOAD_POLICY_REQUIRED");
      const target = page.locator(rule.selector);
      if (await target.count() !== 1 || await target.getAttribute("type") !== "file") throw new Error("DELIVERY_UPLOAD_FIELD_DRIFT");
      if (artifact.bytes.byteLength !== artifact.byteSize || hash(artifact.bytes) !== artifact.sha256) throw new Error("DELIVERY_ARTIFACT_HASH_MISMATCH");
      await drain();
      const presign = policy.greenhouse ? presigns.get(field.domId) : undefined;
      const request = rule.request ?? (presign ? { method: "POST" as const, url: presign.url } : undefined);
      if (!request && !ashby) throw new Error("DELIVERY_UPLOAD_ENDPOINT_UNVERIFIED");
      ashby?.beginUpload(field, artifact);
      const current: ActionWindow = { kind: "UPLOAD", request, admitted: false, artifact, presign, signal, strictMultipart: Boolean(ashby) };
      if (policy.lever) {
        const account = page.locator(policy.lever.accountIdSelector);
        if (await account.count() !== 1) throw new Error("DELIVERY_UPLOAD_ACCOUNT_UNVERIFIED");
        const accountId = await account.inputValue();
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(accountId)) throw new Error("DELIVERY_UPLOAD_ACCOUNT_UNVERIFIED");
        current.uploadFields = { accountId };
      }
      action = current;
      const temporary = Buffer.from(artifact.bytes);
      try {
        await target.setInputFiles({ name: artifact.filename, mimeType: artifact.mediaType, buffer: temporary });
        const acknowledged = await waitFor(async () => {
          if (current.error || current.response && (current.response.status < 200 || current.response.status >= 300)) return true;
          const ack = page.locator(rule.acknowledgementSelector);
          const success = !rule.successSelector || await page.locator(rule.successSelector).count() === 1 && await page.locator(rule.successSelector).isVisible();
          return Boolean(current.response && (!ashby || ashby.upload()?.acknowledged) && success && await ack.count() === 1 && await ack.isVisible() && displaysUploadFilename(await uploadAcknowledgementText(rule.acknowledgementSelector), artifact.filename));
        }, signal);
        if (!acknowledged || current.error || ashby && !ashby.upload()?.acknowledged || !current.response || current.response.status < 200 || current.response.status >= 300) throw new Error(current.error || "DELIVERY_UPLOAD_NOT_ACKNOWLEDGED");
        // The review records the exact name the employer received with the bytes.
        const proof = { artifactVersionId: artifact.artifactVersionId, filename: artifact.filename, sha256: artifact.sha256, byteSize: artifact.byteSize, acknowledgementHash: hash(await uploadAcknowledgementText(rule.acknowledgementSelector)), response: current.response };
        uploadProofs.set(field.fieldId, proof);
        uploadedArtifacts.set(field.fieldId, artifact);
        uploadChecks.set(field.fieldId, { stepId: step!.id, selector: rule.acknowledgementSelector, filename: artifact.filename });
        await hooks.checkpoint?.({ phase: "UPLOAD_ACKNOWLEDGED", stepId: step!.id, fieldId: field.fieldId, proof });
        return proof;
      } finally { temporary.fill(0); await drain(); action = null; ashby?.endUpload(); }
    },
    async move(direction: "FORWARD" | "BACK", signal?: AbortSignal) {
      assertActive(signal);
      if (action || submitConsumed) throw new Error("DELIVERY_ACTION_NOT_AVAILABLE");
      const step = await currentStep();
      const rule = direction === "FORWARD" ? step?.forward : step?.back;
      if (!rule) throw new Error("DELIVERY_NAVIGATION_POLICY_REQUIRED");
      const target = page.locator(rule.selector);
      if (await target.count() !== 1 || !await target.isVisible()) throw new Error("DELIVERY_NAVIGATION_CONTROL_DRIFT");
      const current: ActionWindow = { kind: "MOVE", request: rule.request, admitted: false, signal };
      action = current;
      try {
        await target.click({ timeout: timeoutMs });
        const arrived = await waitFor(async () => (await currentStep())?.id === rule.nextStepId, signal);
        if (!arrived || current.error || rule.request && (!current.admitted || !current.response || current.response.status >= 400)) throw new Error(current.error || "DELIVERY_NAVIGATION_UNVERIFIED");
        await hooks.checkpoint?.({ phase: "STEP_REACHED", stepId: rule.nextStepId, pageUrl: canonical(page.url()) });
      } finally { await drain(); action = null; }
    },
    async submit(reviewHash: string, review: Readonly<Record<string, unknown>>, signal?: AbortSignal, verifyReview?: () => Promise<void>): Promise<DeliverySubmitResult> {
      assertActive(signal);
      if (action || submitConsumed) return { kind: "UNCERTAIN", reasonCode: "DELIVERY_SUBMISSION_ALREADY_CONSUMED", submission: null };
      const step = await currentStep();
      if (!step?.submit) return { kind: "TAKEOVER", reasonCode: "DELIVERY_SUBMIT_POLICY_REQUIRED" };
      const current: ActionWindow = { kind: "SUBMIT", request: step.submit.request, admitted: false, reviewHash, review, signal, verifyReview };
      action = current;
      // No model tools run during this window. Only the candidate can interact
      // through Live View; the exact final readback and submit guard stay active.
      let verificationDeadline = 0;
      let verificationOpened = false;
      let polledAt = 0;
      const challenged = async () => {
        if (!(policy.lever?.invisibleHcaptcha || ashby) || current.admitted || current.error) return false;
        if (verificationOpened) {
          if (Date.now() >= verificationDeadline) { current.error = "DELIVERY_BROWSER_VERIFICATION_TIMEOUT"; return true; }
          if (Date.now() - polledAt >= 2_000) { await hooks.browserVerification!.poll(); polledAt = Date.now(); }
          return false;
        }
        if (!await pageShowsCaptchaChallenge(page, ashby ? passiveFrameUrls() : [])) return false;
        if (current.admitted || current.error) return false;
        const deadline = await hooks.browserVerification?.open();
        if (deadline && Number.isFinite(deadline) && deadline > Date.now()) {
          verificationOpened = true; verificationDeadline = deadline; current.humanVerification = true; current.humanVerificationDeadline = deadline;
          return false;
        }
        current.error = APPLICATION_FILL_CAPTCHA_TAKEOVER;
        return true;
      };
      try {
        await page.locator(step.submit.selector).click({ timeout: timeoutMs });
        await waitFor(async () => Boolean(current.error || current.submission && await receipt(current.submission) || await challenged() ||
          current.challenge && await verificationShown()), signal, () => verificationDeadline);
        await drain();
        if (current.submission) {
          const observed = await receipt(current.submission);
          if (observed && !current.error) return { kind: "CONFIRMED", receipt: observed, submission: current.submission };
          const firstBody = jsonObject(current.requestBody);
          if (!current.error && current.challenge && firstBody && await verificationShown()) {
            pendingVerification = { submission: current.submission, firstBody, request: step.submit.request, selector: step.submit.selector, recipient: current.challenge.recipient, sends: 0 };
            return { kind: "VERIFICATION_REQUIRED", reasonCode: "DELIVERY_EMAIL_VERIFICATION_REQUIRED", recipient: current.challenge.recipient, submission: current.submission };
          }
        }
        if (current.beginStarted) return { kind: "UNCERTAIN", reasonCode: current.error || "DELIVERY_RECEIPT_UNVERIFIED", submission: current.submission ?? null };
        return { kind: "TAKEOVER", reasonCode: current.error || "DELIVERY_FORM_VALIDATION_OR_CAPTCHA" };
      } catch (error) {
        return current.beginStarted ? { kind: "UNCERTAIN", reasonCode: safeError(error), submission: current.submission ?? null }
          : { kind: "TAKEOVER", reasonCode: safeError(error) };
      } finally {
        current.humanVerification = false;
        if (verificationOpened) await hooks.browserVerification!.close().catch(() => undefined);
        await drain(); action = null;
      }
    },
    /**
     * Types the candidate's emailed code into the employer's own boxes and lets
     * the page resend. Only a request carrying the pending attempt's exact
     * content plus this code is admitted (at most three sends).
     */
    async verify(code: string, signal?: AbortSignal): Promise<DeliverySubmitResult> {
      assertActive(signal);
      const pending = pendingVerification;
      if (!pending || action) return { kind: "UNCERTAIN", reasonCode: "DELIVERY_VERIFICATION_NOT_PENDING", submission: pending?.submission ?? null };
      const again = (reasonCode: string): DeliverySubmitResult => ({ kind: "VERIFICATION_REQUIRED", reasonCode, recipient: pending.recipient, submission: pending.submission });
      if (!VERIFICATION_CODE_PATTERN.test(code)) return again("DELIVERY_VERIFICATION_CODE_INVALID");
      if (pending.sends >= 3) return { kind: "UNCERTAIN", reasonCode: "DELIVERY_VERIFICATION_ATTEMPTS_EXCEEDED", submission: pending.submission };
      if (!await verificationShown()) return { kind: "UNCERTAIN", reasonCode: "DELIVERY_VERIFICATION_FORM_DRIFT", submission: pending.submission };
      pending.sends += 1;
      const current: ActionWindow = { kind: "SUBMIT", request: pending.request, admitted: false, signal, submission: pending.submission,
        verification: { code, firstBody: pending.firstBody } };
      action = current;
      try {
        for (let index = 0; index < 8; index += 1) {
          assertActive(signal);
          await page.locator(`fieldset#email-verification input#security-input-${index}`).fill(code[index], { timeout: timeoutMs });
        }
        await page.locator(pending.selector).click({ timeout: timeoutMs });
        await waitFor(async () => Boolean(current.error || current.response && current.submission &&
          (await receipt(current.submission) || current.response.status >= 400 && await verificationShown())), signal);
        await drain();
        const observed = current.submission ? await receipt(current.submission) : null;
        if (observed && !current.error) { pendingVerification = null; return { kind: "CONFIRMED", receipt: observed, submission: current.submission! }; }
        if (!current.admitted && !current.error) return again("DELIVERY_VERIFICATION_NOT_SENT");
        // Only Greenhouse's explicit 428 captcha-failed response proves this
        // resend was refused. A 5xx or unknown response may follow acceptance;
        // the still-visible code form cannot authorize another send.
        if (!current.error && current.challenge && await verificationShown()) {
          pending.submission = current.submission ?? pending.submission;
          return again("DELIVERY_VERIFICATION_CODE_REJECTED");
        }
        pendingVerification = null;
        return { kind: "UNCERTAIN", reasonCode: current.error || "DELIVERY_RECEIPT_UNVERIFIED", submission: current.submission ?? pending.submission };
      } catch (error) {
        pendingVerification = null;
        return { kind: "UNCERTAIN", reasonCode: safeError(error), submission: current.submission ?? pending.submission };
      } finally { await drain(); action = null; }
    },
    async reconcile(prior: DeliveryPriorSubmission): Promise<Exclude<DeliverySubmitResult, { kind: "VERIFICATION_REQUIRED" }>> {
      submitConsumed = true;
      // A fresh GET of a static thank-you page is never evidence of submission.
      // Recovery only inspects the retained page plus persisted response proof.
      const observed = await receipt(prior);
      return observed ? { kind: "CONFIRMED", receipt: observed, submission: prior }
        : { kind: "UNCERTAIN", reasonCode: "DELIVERY_RECONCILIATION_REQUIRED", submission: prior };
    },
    uploaded: (fieldId: string) => uploadProofs.has(fieldId),
    async verifyCurrentUploads() {
      const step = await currentStep();
      for (const [fieldId, check] of uploadChecks) {
        if (check.stepId !== step?.id) continue;
        const acknowledgement = page.locator(check.selector);
        if (await acknowledgement.count() !== 1 || !await acknowledgement.isVisible()) throw new Error("DELIVERY_UPLOAD_ACKNOWLEDGEMENT_DRIFT");
        const text = await uploadAcknowledgementText(check.selector);
        if (!displaysUploadFilename(text, check.filename) || hash(text) !== uploadProofs.get(fieldId)?.acknowledgementHash) throw new Error("DELIVERY_UPLOAD_ACKNOWLEDGEMENT_DRIFT");
      }
    },
    uploadProofs: () => [...uploadProofs].map(([fieldId, proof]) => ({ fieldId, ...proof })),
    usage: () => ({ blockedRequests, submittedRequests }),
    async dispose() {
      closed = true;
      pendingVerification = null;
      await drain();
      page.off("response", responseListener);
      // Keep the context locked until its owner closes it. Returning an outcome
      // must never create an unguarded interval before provider cleanup.
    },
  });
}

/**
 * US Greenhouse postings, delivered through Greenhouse's embedded application
 * form: the same form employers embed on their own careers sites. It is served
 * for every public posting, including boards whose hosted page redirects to a
 * custom careers site (Carvana, Airbnb, Databricks), so delivery never passes
 * through an employer's own site or its bot protection. Other hosts fail closed.
 * "Location (City)" is a type-to-search field backed by Greenhouse's own
 * geocoding proxy (observed 2026-09-30): city results only, the typed text is
 * the candidate's approved city, and a result is chosen only when their region
 * and country confirm it.
 */
export function resolveGreenhouseDeliveryPolicy(destinationUrl: string): DeliverySitePolicy {
  const destination = parseGreenhouseAutopilotDestination(destinationUrl);
  if (!destination) throw new Error("DELIVERY_SITE_UNSUPPORTED");
  const { boardToken, jobId } = destination;
  const embed = `for=${boardToken}&token=${jobId}`;
  const startUrl = `https://job-boards.greenhouse.io/embed/job_app?${embed}`;
  const submitUrl = `https://boards.greenhouse.io/embed/${boardToken}/jobs/${jobId}`;
  return Object.freeze({
    release: "greenhouse-embed-us/2026-09-28", startUrl, destinationUrl: destination.startUrl,
    assets: [
      { origin: "https://job-boards.cdn.greenhouse.io", pathPrefix: "/assets/" },
      { origin: "https://job-boards.cdn.greenhouse.io", pathPrefix: "/fonts/" },
      { origin: "https://s8-recruiting.cdn.greenhouse.io", pathPrefix: "/job_board_renderer/custom_fonts/" },
      { origin: "https://s8-recruiting.cdn.greenhouse.io", pathPrefix: "/external_greenhouse_job_boards/logos/" },
      { origin: "https://fonts.gstatic.com", pathPrefix: "/s/" },
    ],
    // Greenhouse presigns an upload to the bucket nearest the browser: us-east-1
    // (legacy endpoint) or us-west-2 (regional endpoint), both observed 2026-09-28.
    greenhouse: { presignOrigin: "https://boards.greenhouse.io", uploadOrigins: ["https://grnhse-prod-jben-us-east-1.s3.amazonaws.com", "https://grnhse-prod-jben-us-west-2.s3.us-west-2.amazonaws.com"] },
    // Public client constants, read from Greenhouse's own form/bootstrap and
    // location library (source register GH-20260929-01). Never copy values from
    // the active candidate-bearing page; a vendor change must be re-reviewed.
    searches: [{ origin: "https://api-geocode-earth-proxy.greenhouse.io", path: "/v1/autocomplete", query: "text",
      params: { api_key: "ge-39f1178289d5d0c5", layers: "locality", lang: "en" } }],
    steps: [{ id: "application", url: startUrl, readySelector: "#application-form",
      uploads: ["resume", "cover_letter"].map((fieldId) => ({ fieldId, selector: `input[type="file"][id="${fieldId}"]`, acknowledgementSelector: `.file-upload:has(#upload-label-${fieldId}) .file-upload__filename` })),
      submit: { selector: '#application-form button[type="submit"]', request: { method: "POST" as const, url: submitUrl } },
    }],
    receipt: { url: `https://job-boards.greenhouse.io/embed/job_app/confirmation?${embed}`, selector: ".confirmation__content", textPattern: "thank|application|received" },
  });
}

/** Lever's hosted form: parse response is upload evidence, never identity authority. */
export function resolveLeverDeliveryPolicy(destinationUrl: string): DeliverySitePolicy {
  const destination = parseLeverAutopilotDestination(destinationUrl);
  if (!destination) throw new Error("DELIVERY_SITE_UNSUPPORTED");
  const { startUrl, boardToken, jobId } = destination;
  return Object.freeze({
    release: "lever-hosted-global/2026-09-16", startUrl,
    assets: [
      { origin: "https://jobs.lever.co", pathPrefix: "/js/" },
      { origin: "https://jobs.lever.co", pathPrefix: "/css/" },
      { origin: "https://jobs.lever.co", pathPrefix: "/img/" },
      { origin: "https://cdn.lever.co", pathPrefix: "/fonts/" },
    ],
    lever: { accountIdSelector: '#application-form input[type="hidden"][name="accountId"]', invisibleHcaptcha: true },
    steps: [{ id: "application", url: startUrl, readySelector: "#application-form",
      uploads: [{ fieldId: "resume-upload-input", fieldName: "resume", selector: '#application-form input[type="file"][name="resume"]',
        request: { method: "POST" as const, url: "https://jobs.lever.co/parseResume" },
        acknowledgementSelector: ".visible-resume-upload .filename", successSelector: ".resume-upload-success" }],
      submit: { selector: "#application-form #btn-submit", request: { method: "POST" as const, url: startUrl } },
    }],
    receipt: { url: `https://jobs.lever.co/${boardToken}/${jobId}/thanks`, selector: '[data-qa="msg-submit-success"]', textPattern: "^Application submitted!$" },
  });
}

/** Ashby's reviewed GraphQL draft and final protocols are enforced in runtime. */
export function resolveAshbyDeliveryPolicy(destinationUrl: string): DeliverySitePolicy {
  const destination = parseAshbyAutopilotDestination(destinationUrl);
  if (!destination) throw new Error("DELIVERY_SITE_UNSUPPORTED");
  const { startUrl, boardToken, jobId } = destination;
  return Object.freeze({ release: "ashby-hosted/2026-09-30", startUrl,
    ashby: { board: boardToken, jobId },
    assets: [{ origin: "https://cdn.ashbyprd.com", pathPrefix: "/frontend_non_user/" }, { origin: "https://fonts.gstatic.com", pathPrefix: "/" }],
    bootstrapRequests: [{ method: "GET" as const, url: "https://cdn.ashbyprd.com/frontend_non_user/06905250b594d4f5cf131e84b29a46a36af89dc5/.vite/manifest.json" }],
    steps: [{ id: "application", url: startUrl, readySelector: ".ashby-application-form-submit-button",
      submit: { selector: ".ashby-application-form-submit-button", request: { method: "POST" as const, url: "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction" } } }],
    receipt: { url: startUrl, selector: ".ashby-application-form-success-container", textPattern: "\\S" },
  });
}

export function resolveApplicationDeliveryPolicy(destinationUrl: string): DeliverySitePolicy {
  const destination = parseAutopilotDestination(destinationUrl);
  if (!destination) throw new Error("DELIVERY_SITE_UNSUPPORTED");
  return destination.provider === "GREENHOUSE" ? resolveGreenhouseDeliveryPolicy(destinationUrl) : destination.provider === "ASHBY" ? resolveAshbyDeliveryPolicy(destinationUrl) : resolveLeverDeliveryPolicy(destinationUrl);
}
