import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright-core";

import { parseBrowserbaseRuntimeEnvironment, resolveBrowserbaseProjectId } from "./browserbase-runtime.ts";

type ProviderSession = Readonly<{
  id: string; projectId: string; status: string; expiresAt: string;
  connectUrl?: string; userMetadata?: Record<string, unknown>;
}>;

export interface DeliverySessionProvider {
  list(provisionKey: string): Promise<readonly ProviderSession[]>;
  create(provisionKey: string): Promise<ProviderSession>;
  retrieve(id: string): Promise<ProviderSession>;
  release(id: string): Promise<void>;
}

export type ApplicationDeliveryRuntime = Readonly<{
  page: Page;
  sessionId: string;
  expiresAt: string;
  /** Which provider settings this session runs with (D-149): STANDARD, or PROVEN after a definitive rejection. */
  sessionSettings?: string | null;
  release(): Promise<void>;
}>;

export interface ApplicationDeliveryRuntimeAdapter {
  open(input: Readonly<{
    provisionKey: string;
    runtimeReference: string | null;
    /** False after an interrupted create: discovery is allowed, a second POST is not. */
    allowCreate: boolean;
    onBound(sessionId: string, expiresAt: string): Promise<void>;
  }>): Promise<ApplicationDeliveryRuntime>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RELEASE = "application-delivery-browser-1";

/** Provisioning has its own durable intent key. Never retry an uncertain create. */
export function createApplicationDeliveryRuntimeAdapter(input: Readonly<{
  provider: DeliverySessionProvider;
  projectId: string;
  connect(url: string): Promise<Browser>;
  now?: () => number;
}>): ApplicationDeliveryRuntimeAdapter {
  const now = input.now ?? Date.now;
  return {
    async open(request) {
      if (!UUID.test(request.provisionKey)) throw new Error("DELIVERY_RUNTIME_INTENT_INVALID");
      let session: ProviderSession;
      if (request.runtimeReference) {
        session = await input.provider.retrieve(request.runtimeReference);
      } else {
        const found = await input.provider.list(request.provisionKey);
        if (found.length > 1) throw new Error("DELIVERY_RUNTIME_DISCOVERY_AMBIGUOUS");
        if (found[0]) session = await input.provider.retrieve(found[0].id);
        else {
          if (!request.allowCreate) throw new Error("DELIVERY_RUNTIME_CREATE_UNCERTAIN");
          // Provider retries must be disabled by the composition root.
          session = await input.provider.create(request.provisionKey);
        }
      }
      if (session.projectId !== input.projectId ||
          session.userMetadata?.roledawn_delivery_provision_key !== request.provisionKey ||
          session.userMetadata?.roledawn_adapter_release !== RELEASE) {
        throw new Error("DELIVERY_RUNTIME_BINDING_MISMATCH");
      }
      if (!["RUNNING", "PENDING"].includes(session.status) ||
          !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now()) {
        if (["RUNNING", "PENDING"].includes(session.status)) await input.provider.release(session.id);
        throw new Error("DELIVERY_RUNTIME_EXPIRED");
      }
      let browser: Browser | null = null;
      try {
        // Save the ID before connecting or loading any candidate information.
        // A failed/lost binding acknowledgement must still release the known
        // provider session. The durable intent handles an uncertain create.
        await request.onBound(session.id, session.expiresAt);
        if (!session.connectUrl) session = await input.provider.retrieve(session.id);
        let connection: URL;
        try { connection = new URL(session.connectUrl ?? ""); }
        catch { throw new Error("DELIVERY_RUNTIME_CONNECTION_INVALID"); }
        if (connection.protocol !== "wss:" && connection.protocol !== "https:") {
          throw new Error("DELIVERY_RUNTIME_CONNECTION_INVALID");
        }
        browser = await input.connect(connection.href);
        // Browserbase's default profile contains its provider extension worker.
        // Candidate pages use a separate context with service workers disabled;
        // on recovery, reuse only the unique context created in this bound session.
        const isolatedContexts = browser.contexts().slice(1);
        if (isolatedContexts.length > 1) throw new Error("DELIVERY_RUNTIME_CONTEXT_AMBIGUOUS");
        const context = isolatedContexts[0] ?? await browser.newContext({ serviceWorkers: "block" });
        if (context.serviceWorkers().length) throw new Error("DELIVERY_SERVICE_WORKER_UNSUPPORTED");
        // The driver installs its narrowly scoped request policy before its first navigation.
        const page = context.pages()[0] ?? await context.newPage();
        let released = false;
        const settings = session.userMetadata?.roledawn_session_settings;
        return {
          page, sessionId: session.id, expiresAt: session.expiresAt,
          sessionSettings: typeof settings === "string" && /^[A-Z_]{1,20}$/u.test(settings) ? settings : null,
          async release() {
            if (released) return;
            // Request provider release before dropping the CDP connection. A disconnected
            // page must not continue running employer scripts without our request guard.
            try {
              await input.provider.release(session.id);
              released = true;
            } finally { await browser?.close(); }
          },
        };
      } catch (error) {
        try { await input.provider.release(session.id); } finally { await browser?.close(); }
        throw error;
      }
    },
  };
}

/**
 * Provider limits are reported plainly (the plan is out of browser minutes, or
 * too many browsers are open); anything else keeps its own error.
 */
export function deliveryProviderError(error: unknown): Error {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : Number.NaN;
  if (status === 402) return new Error("DELIVERY_BROWSER_QUOTA_EXHAUSTED");
  if (status === 429) return new Error("DELIVERY_BROWSER_CONCURRENCY_LIMIT");
  return error instanceof Error ? error : new Error("DELIVERY_RUNTIME_PROVIDER_FAILED");
}

/** The provider settings every send asks for first (D-146 solver, D-147 recording and logs). */
export const STANDARD_BROWSER_SETTINGS = Object.freeze({ solveCaptchas: true, recordSession: true, logSession: true, ignoreCertificateErrors: false });
/** The settings that produced the three confirmed Greenhouse applications (before D-146/D-147). */
export const PROVEN_BROWSER_SETTINGS = Object.freeze({ solveCaptchas: false, recordSession: false, logSession: false, ignoreCertificateErrors: false });

/** A client error proves Browserbase created nothing; quota (402) and rate (429) keep their own codes. */
function definitiveRejection(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : Number.NaN;
  return [400, 403, 404, 422].includes(status);
}

type BrowserbaseSessions = Readonly<{
  list(input: { q: string }): Promise<readonly ProviderSession[]>;
  create(input: Record<string, unknown>): Promise<ProviderSession>;
  retrieve(id: string): Promise<ProviderSession>;
  update(id: string, input: { status: "REQUEST_RELEASE" }): Promise<unknown>;
}>;

/**
 * Browserbase sessions for delivery. If Browserbase definitively rejects the
 * standard settings (a 4xx, so no session exists), confirm nothing was made
 * under this provision key and ask once more with the proven settings, so a
 * plan or settings change can never stop every send before the form opens (D-149).
 */
export function createBrowserbaseDeliveryProvider(input: Readonly<{
  sessions: BrowserbaseSessions; projectId: string; region: string; sleep?: (ms: number) => Promise<void>;
}>): DeliverySessionProvider {
  const { sessions, projectId, region } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const list = (key: string) => sessions.list({ q: `user_metadata['roledawn_delivery_provision_key']:'${key}'` });
  const create = (key: string, label: "STANDARD" | "PROVEN") => sessions.create({
    projectId, region, api_timeout: 900, keepAlive: false,
    // Recording and console/network logs give every send a replay and request log in Browserbase for diagnosis (D-147); it holds what the form showed, so it stays in the founder's private Browserbase project.
    browserSettings: label === "STANDARD" ? STANDARD_BROWSER_SETTINGS : PROVEN_BROWSER_SETTINGS,
    userMetadata: { roledawn_delivery_provision_key: key, roledawn_adapter_release: RELEASE, roledawn_session_settings: label },
  });
  return {
    list,
    async create(key) {
      try { return await create(key, "STANDARD"); }
      catch (error) {
        if (!definitiveRejection(error)) throw deliveryProviderError(error);
        if ((await list(key)).length) throw deliveryProviderError(error);
        return await create(key, "PROVEN").catch((retry: unknown) => { throw deliveryProviderError(retry); });
      }
    },
    retrieve: (id) => sessions.retrieve(id),
    async release(id) {
      await sessions.update(id, { status: "REQUEST_RELEASE" });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const session = await sessions.retrieve(id);
        if (!["RUNNING", "PENDING"].includes(session.status)) return;
        await sleep(250);
      }
      throw new Error("DELIVERY_RUNTIME_RELEASE_PENDING");
    },
  };
}

export async function createApplicationDeliveryRuntimeForNodeWorker(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ApplicationDeliveryRuntimeAdapter> {
  const configuration = parseBrowserbaseRuntimeEnvironment(environment);
  const sdk = new Browserbase({ apiKey: configuration.apiKey, timeout: configuration.apiTimeoutMs, maxRetries: 0 });
  const projectId = resolveBrowserbaseProjectId(await sdk.projects.list(), environment.BROWSERBASE_PROJECT_ID);
  return createApplicationDeliveryRuntimeAdapter({
    projectId,
    connect: (url) => chromium.connectOverCDP(url, { timeout: configuration.apiTimeoutMs }),
    provider: createBrowserbaseDeliveryProvider({ sessions: sdk.sessions as unknown as BrowserbaseSessions, projectId, region: configuration.region }),
  });
}
