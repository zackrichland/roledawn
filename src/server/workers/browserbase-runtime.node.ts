import Browserbase from "@browserbasehq/sdk";
import { chromium } from "playwright-core";

import type { ComputerRuntimeAdapter } from "./application-fill.ts";
import {
  createBrowserbaseRuntimeAdapter,
  parseBrowserbaseRuntimeEnvironment,
  resolveBrowserbaseProjectId,
  type BrowserbaseSessionCreateInput,
  type BrowserbaseSessionRecord,
  type BrowserbaseSessionService,
} from "./browserbase-runtime.ts";

type SdkSession = Readonly<{
  id: string;
  projectId: string;
  status: "PENDING" | "RUNNING" | "ERROR" | "TIMED_OUT" | "COMPLETED";
  createdAt: string;
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
  contextId?: string;
  connectUrl?: string;
  userMetadata?: { [key: string]: unknown };
}>;

function normalizeSession(session: SdkSession): BrowserbaseSessionRecord {
  return Object.freeze({
    id: session.id,
    projectId: session.projectId,
    status: session.status,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    endedAt: session.endedAt ?? null,
    contextId: session.contextId ?? null,
    connectUrl: session.connectUrl ?? null,
    userMetadata: Object.freeze({ ...(session.userMetadata ?? {}) }),
  });
}

function createSessionService(
  browserbase: Browserbase,
): BrowserbaseSessionService {
  return Object.freeze({
    async create(input: BrowserbaseSessionCreateInput) {
      const session = await browserbase.sessions.create({
        region: input.region,
        // The pinned SDK intentionally names the API body's `timeout` field
        // `api_timeout`; its generated client remaps it before the POST.
        api_timeout: input.ttlSeconds,
        keepAlive: input.keepAlive,
        browserSettings: {
          allowedDomains: [...input.allowedDomains],
          solveCaptchas: input.solveCaptchas,
          recordSession: input.recordSession,
          logSession: input.logSession,
          ignoreCertificateErrors: input.ignoreCertificateErrors,
          ...(input.context === null ? {} : { context: input.context }),
        },
        userMetadata: input.userMetadata,
      });
      return normalizeSession(session);
    },
    async listByComputerSessionId(computerSessionId: string) {
      const query = `user_metadata['roledawn_computer_session_id']:'${computerSessionId}'`;
      const sessions = await browserbase.sessions.list({ q: query });
      return Object.freeze(sessions.map((session) => normalizeSession(session)));
    },
    async retrieve(sessionId: string) {
      return normalizeSession(await browserbase.sessions.retrieve(sessionId));
    },
    async release(sessionId: string) {
      return normalizeSession(await browserbase.sessions.update(sessionId, {
        status: "REQUEST_RELEASE",
      }));
    },
  });
}

/**
 * Node worker composition root. Environment parsing requires both an explicit
 * enable flag and the private API key; no Browserbase client is created before
 * that gate succeeds.
 */
export async function createBrowserbaseRuntimeAdapterForNodeWorker(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ComputerRuntimeAdapter> {
  const configuration = parseBrowserbaseRuntimeEnvironment(environment);
  // Disable SDK retries. A timed-out POST may already have created a billable
  // browser, so recovery must query our metadata key instead of replaying POST.
  const browserbase = new Browserbase({
    apiKey: configuration.apiKey,
    maxRetries: 0,
    timeout: configuration.apiTimeoutMs,
  });
  // Browserbase resolves the project from the API key. We read the one scoped
  // project once so RoleDawn can retain its provider-session binding check
  // without asking for or persisting a separate project-id setting.
  const projectId = resolveBrowserbaseProjectId(await browserbase.projects.list());
  return createBrowserbaseRuntimeAdapter({
    sessionService: createSessionService(browserbase),
    cdpConnector: Object.freeze({
      connectOverCDP(connectUrl: string, timeoutMs: number) {
        return chromium.connectOverCDP(connectUrl, { timeout: timeoutMs });
      },
    }),
    projectId,
    region: configuration.region,
    connectTimeoutMs: configuration.apiTimeoutMs,
  });
}
