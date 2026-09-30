import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import Browserbase from "@browserbasehq/sdk";
import type { Page } from "playwright-core";

import { createSupabaseAdminClient } from "../../lib/supabase/admin.ts";
import { createApplicationAutopilotRepository, type ApplicationAutopilotStore } from "../applications/autopilot.ts";
import type { ApplicationAutopilotClaim } from "../../domain/application-autopilot.ts";
import { createApplicationAgentEvidence } from "./application-agent-evidence.ts";
import { createStandingAnswerResolver } from "./standing-answers.ts";
import { coordinateApplicationAutopilot } from "./application-autopilot-worker.ts";
import { createApplicationDeliveryDriver, type DeliveryVerificationRelay } from "./application-delivery-driver.ts";
import { parseAutopilotDestination } from "../../domain/application-autopilot-eligibility.ts";
import { createGoogleMailboxReader, readGoogleMailboxConfig, type MailboxCodeReader } from "../mailbox/google-mailbox.ts";
import { openMailboxToken, readMailboxTokenKey } from "../mailbox/token-crypto.ts";
import type { DeliveryPriorSubmission, DeliverySitePolicy, DeliveryRequestTransport } from "./application-delivery-browser.ts";
import { createApplicationDeliveryHarness } from "./application-delivery-harness.ts";
import { createApplicationDeliveryRuntimeForNodeWorker, type ApplicationDeliveryRuntimeAdapter } from "./application-delivery-runtime.ts";
import { createSupabaseApplicationFillExecutionMaterializer } from "./application-fill-materializer.ts";
import { parseApplicationFormDriverEnvironment } from "./application-form-driver.ts";
import { createOpenAIAgentsClient } from "./openai-agents-client.ts";
import { parseBrowserbaseRuntimeEnvironment } from "./browserbase-runtime.ts";

/**
 * One claim may run for the database's maximum lease. The browser and model
 * work stop a minute earlier so the outcome is recorded while the lease holds.
 * (Hosted background functions allow 15 minutes.)
 */
export const AUTOPILOT_LEASE_SECONDS = 600;
export const AUTOPILOT_RUN_BUDGET_MS = 540_000;
/**
 * While the employer waits on an emailed code, the run may continue up to this
 * point after its claim (the host stops background work at 15 minutes).
 */
export const AUTOPILOT_HARD_LIMIT_MS = 14 * 60_000;
export const AUTOPILOT_VERIFICATION_WAIT_MS = 8 * 60_000;

/** An abort signal whose deadline can move later, never earlier. */
export function createExtendableBudget(ms: number, now: () => number = Date.now) {
  const controller = new AbortController();
  let deadline = now() + ms;
  let timer = setTimeout(() => controller.abort(), ms);
  return Object.freeze({
    signal: controller.signal,
    deadline: () => deadline,
    extendTo(next: number) {
      if (controller.signal.aborted || next <= deadline) return;
      deadline = next; clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), Math.max(0, next - now()));
    },
    clear() { clearTimeout(timer); },
  });
}
type ExtendableBudget = ReturnType<typeof createExtendableBudget>;

/** Keep the guarded worker attached while the candidate completes verification. */
export function createAutopilotBrowserVerificationRelay(input: Readonly<{
  claim: ApplicationAutopilotClaim; repository: Pick<ApplicationAutopilotStore, "assertLease" | "extendLease" | "checkpoint" | "recordEvent">;
  budget: ExtendableBudget; hardDeadline: number; runtimeExpiresAt: string; now?: () => number;
}>) {
  const now = input.now ?? Date.now;
  let renewed = 0;
  return {
    async open() {
      const deadline = Math.min(now() + 5 * 60_000, input.hardDeadline - 45_000, Date.parse(input.runtimeExpiresAt) - 45_000);
      if (!Number.isFinite(deadline) || deadline <= now() + 30_000) return null;
      await input.repository.assertLease(input.claim);
      await input.repository.extendLease(input.claim, AUTOPILOT_LEASE_SECONDS);
      renewed = now(); input.budget.extendTo(deadline + 40_000);
      await input.repository.checkpoint(input.claim, { stage: "BROWSER_VERIFICATION", data: { browserVerificationExpiresAt: new Date(deadline).toISOString() } });
      await input.repository.recordEvent?.(input.claim, { stage: "browser-verification", outcome: "INFO", code: "DELIVERY_BROWSER_VERIFICATION_REQUIRED" });
      return deadline;
    },
    async poll() {
      await input.repository.assertLease(input.claim);
      if (now() - renewed >= 120_000) { await input.repository.extendLease(input.claim, AUTOPILOT_LEASE_SECONDS); renewed = now(); }
    },
    async close() {
      await input.repository.checkpoint(input.claim, { stage: "BROWSER_VERIFICATION_CLOSED", data: { browserVerificationExpiresAt: null } });
      await input.repository.recordEvent?.(input.claim, { stage: "browser-verification", outcome: "INFO", code: "DELIVERY_BROWSER_VERIFICATION_CLOSED" });
    },
  };
}

/**
 * Waits for the code the candidate types into RoleDawn after the employer
 * emails it. The lease is kept alive; the code is read once and settled.
 */
export function createAutopilotVerificationRelay(input: Readonly<{
  claim: ApplicationAutopilotClaim; repository: ApplicationAutopilotStore; budget: ExtendableBudget; hardDeadline: number;
  waitMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The candidate's connected mailbox, if any (read-only, D-106). */
  mailbox?: () => Promise<MailboxCodeReader | null>;
  /** The job board token, so only this employer's code email is used. */
  employerHint?: string | null;
  mailboxPollMs?: number;
}>): DeliveryVerificationRelay {
  const now = input.now ?? Date.now;
  // Codes already typed into this form never count again, even if still in the inbox.
  const used = new Set<string>();
  let mailboxDisabled = false;
  let reader: MailboxCodeReader | null | undefined;
  async function fromMailbox(id: string, since: number, signal?: AbortSignal): Promise<boolean> {
    if (mailboxDisabled || !input.mailbox) return false;
    try {
      reader ??= await input.mailbox();
      if (!reader) { mailboxDisabled = true; return false; }
      const code = await reader.findCode({ since, employerHint: input.employerHint ?? null, exclude: used, signal });
      if (!code) return false;
      await input.repository.provideVerificationFromMailbox(input.claim, id, code);
      await input.repository.recordMailboxUse(input.claim, null).catch(() => undefined);
      return true;
    } catch (error) {
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/u.test(error.message) ? error.message : "MAILBOX_READ_FAILED";
      // A revoked or misconfigured mailbox stops being tried; the candidate can still type the code.
      if (["MAILBOX_TOKEN_REVOKED", "MAILBOX_SCOPE_MISSING", "MAILBOX_TOKEN_UNREADABLE", "MAILBOX_TOKEN_FORMAT_INVALID", "MAILBOX_TOKEN_KEY_INVALID"].includes(code)) mailboxDisabled = true;
      await input.repository.recordMailboxUse(input.claim, code).catch(() => undefined);
      return false;
    }
  }
  const sleep = input.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
    signal?.addEventListener("abort", done, { once: true });
  }));
  return Object.freeze({
    async requestCode({ recipient, retry, signal }) {
      const deadline = Math.min(now() + (input.waitMs ?? AUTOPILOT_VERIFICATION_WAIT_MS), input.hardDeadline - 45_000);
      if (deadline <= now() + 30_000) return null;
      input.budget.extendTo(deadline + 40_000);
      await input.repository.extendLease(input.claim, AUTOPILOT_LEASE_SECONDS);
      const id = await input.repository.requestVerification(input.claim, { recipientHint: recipient, retry });
      // Mail that arrived shortly before the request (the employer sends it with its answer) counts.
      const since = now() - 120_000;
      let extended = now();
      let checkedMailbox = 0;
      while (now() < deadline && !signal?.aborted) {
        if (now() - extended > 120_000) { await input.repository.extendLease(input.claim, AUTOPILOT_LEASE_SECONDS); extended = now(); }
        const state = await input.repository.readVerification(input.claim);
        if (!state || state.id !== id || state.status === "USED" || state.status === "EXPIRED") return null;
        if (state.status === "PROVIDED" && state.code) {
          await input.repository.settleVerification(input.claim, id, "USED");
          used.add(state.code);
          return state.code;
        }
        if (now() - checkedMailbox >= (input.mailboxPollMs ?? 5_000)) {
          checkedMailbox = now();
          if (await fromMailbox(id, since, signal)) continue;
        }
        await sleep(input.pollMs ?? 2_000, signal);
      }
      await input.repository.settleVerification(input.claim, id, "EXPIRED").catch(() => undefined);
      return null;
    },
  });
}

export async function runApplicationAutopilotWorkerOnce(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.ROLEDAWN_AUTOPILOT_ENABLED !== "true") return { claimed: 0, completed: 0, failed: 0 };
  const configuration = parseApplicationFormDriverEnvironment(environment);
  if (configuration.driver !== "agents") throw new Error("APPLICATION_AUTOPILOT_REQUIRES_AGENTS");
  const supabase = createSupabaseAdminClient("application-autopilot-worker/1", environment);
  const repository = createApplicationAutopilotRepository(supabase);
  const claim = await repository.claim(`${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 120), AUTOPILOT_LEASE_SECONDS);
  if (!claim) return { claimed: 0, completed: 0, failed: 0 };
  return runApplicationAutopilotClaim(claim, { environment, repository });
}

/** Shared durable execution path. Transport/policy overrides are trusted code dependencies only. */
export async function runApplicationAutopilotClaim(claim: ApplicationAutopilotClaim, dependencies: Readonly<{
  environment?: NodeJS.ProcessEnv;
  repository?: ApplicationAutopilotStore;
  runtimeAdapter?: ApplicationDeliveryRuntimeAdapter;
  sitePolicy?: DeliverySitePolicy;
  requestTransport?: DeliveryRequestTransport;
}> = {}) {
  const environment = dependencies.environment ?? process.env;
  const configuration = parseApplicationFormDriverEnvironment(environment);
  if (configuration.driver !== "agents") throw new Error("APPLICATION_AUTOPILOT_REQUIRES_AGENTS");
  const supabase = createSupabaseAdminClient("application-autopilot-worker/1", environment);
  const repository = dependencies.repository ?? createApplicationAutopilotRepository(supabase);
  const client = createOpenAIAgentsClient({ apiKey: configuration.apiKey });
  const started = Date.now();
  const budget = createExtendableBudget(AUTOPILOT_RUN_BUDGET_MS);
  const signal = budget.signal;
  const verification = createAutopilotVerificationRelay({ claim, repository, budget, hardDeadline: started + AUTOPILOT_HARD_LIMIT_MS,
    employerHint: parseAutopilotDestination(claim.destinationUrl)?.boardToken ?? null,
    async mailbox() {
      const key = readMailboxTokenKey(environment); const config = readGoogleMailboxConfig(environment);
      if (!key || !config) return null;
      const connection = await repository.readMailboxConnection(claim);
      if (!connection) return null;
      return createGoogleMailboxReader({ config, refreshToken: openMailboxToken(connection.encryptedToken, key, connection.candidateId) });
    } });
  const result = await coordinateApplicationAutopilot({
    claim, repository, signal,
    // Provider configuration is only read after a durable job claim exists.
    runtimeAdapter: dependencies.runtimeAdapter ?? {
      // Initialization failures occur inside the coordinator's durable failure handling.
      async open(request) {
        const adapter = await createApplicationDeliveryRuntimeForNodeWorker(environment);
        return adapter.open(request);
      },
    },
    materializer: createSupabaseApplicationFillExecutionMaterializer(supabase),
    standingAnswers: createStandingAnswerResolver({ apiKey: configuration.apiKey, model: configuration.model }),
    async drive(task) {
      const driver = createApplicationDeliveryDriver({
        harness: createApplicationDeliveryHarness({ configuration, client, store: repository, lease: claim, signal,
          report: async (detail, durationMs) => {
            const { recordWorkerEvent } = await import("./worker-events.ts");
            await recordWorkerEvent(supabase as never, { lane: "autopilot", stage: "agent-turn", outcome: "INFO", detail, durationMs,
              applicationId: claim.applicationId, autopilotId: claim.id });
          },
        }),
        questions: task.questions,
        evidence: createApplicationAgentEvidence({ apiKey: configuration.apiKey }),
        resolvePage: (handle) => handle as Page,
        submissionHooks: { begin: task.begin, checkpoint: task.checkpoint,
          browserVerification: createAutopilotBrowserVerificationRelay({ claim, repository, budget,
            hardDeadline: started + AUTOPILOT_HARD_LIMIT_MS, runtimeExpiresAt: task.runtimeExpiresAt }),
        },
        verification,
        assertLease: () => repository.assertLease(claim),
        maxActions: configuration.maxActions,
        sitePolicy: dependencies.sitePolicy,
        requestTransport: dependencies.requestTransport,
      });
      const progress = claim.checkpoint.delivery;
      const prior = progress && typeof progress === "object" && !Array.isArray(progress) ? progress.submission : null;
      if (claim.mode === "RECONCILE" && (!prior || typeof prior !== "object" || Array.isArray(prior) || prior.attemptId !== claim.attemptId)) {
        return { kind: "UNCERTAIN", reasonCode: "DELIVERY_RECONCILIATION_EVIDENCE_MISSING" };
      }
      return driver.deliver({
        binding: task.executionPackage.binding, runtimeHandle: task.page,
        executionPackage: task.executionPackage, startUrl: claim.destinationUrl, signal,
        ...(claim.mode === "RECONCILE" ? { priorSubmission: prior as unknown as DeliveryPriorSubmission } : {}),
      });
    },
  }).finally(() => budget.clear());
  return { claimed: 1, completed: ["CONFIRMED", "QUESTIONS_REQUIRED"].includes(result.kind) ? 1 : 0,
    failed: ["CONFIRMED", "QUESTIONS_REQUIRED"].includes(result.kind) ? 0 : 1, outcome: result.kind };
}

/** Runs independently of active browser work, including after candidate cancellation. */
export async function runApplicationAutopilotCleanup(environment: NodeJS.ProcessEnv = process.env) {
  const configuration = parseApplicationFormDriverEnvironment(environment);
  if (configuration.driver !== "agents") throw new Error("APPLICATION_AUTOPILOT_REQUIRES_AGENTS");
  const repository = createApplicationAutopilotRepository(createSupabaseAdminClient("application-autopilot-cleanup/1", environment));
  const pending = await repository.cleanupPending(20);
  if (!pending.length) return { claimed: 0, completed: 0, failed: 0 };
  const agents = createOpenAIAgentsClient({ apiKey: configuration.apiKey });
  const browserConfiguration = parseBrowserbaseRuntimeEnvironment(environment);
  const browser = new Browserbase({ apiKey: browserConfiguration.apiKey, timeout: browserConfiguration.apiTimeoutMs, maxRetries: 0 });
  let completed = 0;
  for (const resource of pending) {
    try {
      if (resource.kind === "AGENT") await agents.deleteSession(resource.reference, AbortSignal.timeout(10_000));
      else {
        let state = await browser.sessions.retrieve(resource.reference);
        if (["PENDING", "RUNNING"].includes(state.status)) {
          await browser.sessions.update(resource.reference, { status: "REQUEST_RELEASE" });
          state = await browser.sessions.retrieve(resource.reference);
        }
        if (["PENDING", "RUNNING"].includes(state.status)) continue;
      }
      await repository.acknowledgeDelete(resource.id);
      completed += 1;
    } catch { /* Claimed resources keep a durable backoff; never output credentials or provider bodies. */ }
  }
  return { claimed: pending.length, completed, failed: pending.length - completed };
}
