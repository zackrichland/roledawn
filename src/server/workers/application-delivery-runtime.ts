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
        return {
          page, sessionId: session.id, expiresAt: session.expiresAt,
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

export async function createApplicationDeliveryRuntimeForNodeWorker(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ApplicationDeliveryRuntimeAdapter> {
  const configuration = parseBrowserbaseRuntimeEnvironment(environment);
  const sdk = new Browserbase({ apiKey: configuration.apiKey, timeout: configuration.apiTimeoutMs, maxRetries: 0 });
  const projectId = resolveBrowserbaseProjectId(await sdk.projects.list());
  return createApplicationDeliveryRuntimeAdapter({
    projectId,
    connect: (url) => chromium.connectOverCDP(url, { timeout: configuration.apiTimeoutMs }),
    provider: {
      list: (key) => sdk.sessions.list({ q: `user_metadata['roledawn_delivery_provision_key']:'${key}'` }),
      create: (key) => sdk.sessions.create({
        projectId, region: configuration.region, api_timeout: 900, keepAlive: false,
        browserSettings: { solveCaptchas: false, recordSession: false, logSession: false, ignoreCertificateErrors: false },
        userMetadata: { roledawn_delivery_provision_key: key, roledawn_adapter_release: RELEASE },
      }).catch((error: unknown) => { throw deliveryProviderError(error); }),
      retrieve: (id) => sdk.sessions.retrieve(id),
      async release(id) {
        await sdk.sessions.update(id, { status: "REQUEST_RELEASE" });
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const session = await sdk.sessions.retrieve(id);
          if (!["RUNNING", "PENDING"].includes(session.status)) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("DELIVERY_RUNTIME_RELEASE_PENDING");
      },
    },
  });
}
