import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserbaseLiveViewProvider } from "./browserbase-live-view.ts";
import {
  CandidateLiveViewError,
  isBrowserbaseLiveViewUrl,
  issueCandidateApplicationLiveView,
  type CandidateLiveViewDependencies,
} from "./live-view.ts";

const IDS = Object.freeze({
  authUser: "10000000-0000-4000-8000-000000000001",
  application: "20000000-0000-4000-8000-000000000002",
  computerSession: "30000000-0000-4000-8000-000000000003",
});
const NOW = Date.parse("2026-08-18T20:00:00.000Z");

function dependencies(
  overrides: Partial<CandidateLiveViewDependencies> = {},
): CandidateLiveViewDependencies {
  return {
    now: () => NOW,
    sessions: {
      async findOwnedLiveSession() {
        return {
          computerSessionId: IDS.computerSession,
          state: "PAUSED_FOR_REVIEW",
          expiresAt: "2026-08-18T20:10:00.000Z",
        };
      },
    },
    providerBindings: {
      async findActiveBinding() {
        return {
          providerAdapter: "browserbase",
          providerSessionRef: "private-provider-session",
        };
      },
    },
    providers: {
      browserbase: {
        async issueLiveView() {
          return {
            url: "https://www.browserbase.com/devtools-fullscreen/signed-capability",
            providerExpiresAt: "2026-08-18T20:08:00.000Z",
          };
        },
      },
    },
    ...overrides,
  };
}

test("candidate live view resolves one owned active session without returning provider identifiers", async () => {
  let scopedInput: unknown;
  let requestedBinding = "";
  let requestedProviderRef = "";
  const base = dependencies();
  const result = await issueCandidateApplicationLiveView(
    { authUserId: IDS.authUser, applicationId: IDS.application },
    {
      ...base,
      sessions: {
        async findOwnedLiveSession(input) {
          scopedInput = input;
          return base.sessions.findOwnedLiveSession(input);
        },
      },
      providerBindings: {
        async findActiveBinding(id) {
          requestedBinding = id;
          return base.providerBindings.findActiveBinding(id);
        },
      },
      providers: {
        browserbase: {
          async issueLiveView(ref) {
            requestedProviderRef = ref;
            return base.providers.browserbase!.issueLiveView(ref);
          },
        },
      },
    },
  );

  assert.deepEqual(scopedInput, {
    authUserId: IDS.authUser,
    applicationId: IDS.application,
    nowIso: "2026-08-18T20:00:00.000Z",
  });
  assert.equal(requestedBinding, IDS.computerSession);
  assert.equal(requestedProviderRef, "private-provider-session");
  assert.deepEqual(result, {
    url: "https://www.browserbase.com/devtools-fullscreen/signed-capability",
    expiresAt: "2026-08-18T20:08:00.000Z",
  });
  assert.equal("providerSessionRef" in result, false);
});

test("missing or expired candidate-owned sessions fail before provider binding access", async () => {
  let bindingReads = 0;
  const base = dependencies();
  await assert.rejects(
    issueCandidateApplicationLiveView(
      { authUserId: IDS.authUser, applicationId: IDS.application },
      {
        ...base,
        sessions: { async findOwnedLiveSession() { return null; } },
        providerBindings: {
          async findActiveBinding() {
            bindingReads += 1;
            return null;
          },
        },
      },
    ),
    (error) => error instanceof CandidateLiveViewError &&
      error.code === "LIVE_VIEW_NOT_AVAILABLE",
  );
  assert.equal(bindingReads, 0);

  await assert.rejects(
    issueCandidateApplicationLiveView(
      { authUserId: IDS.authUser, applicationId: IDS.application },
      {
        ...base,
        sessions: {
          async findOwnedLiveSession() {
            return {
              computerSessionId: IDS.computerSession,
              state: "ACTIVE",
              expiresAt: "2026-08-18T19:59:59.000Z",
            };
          },
        },
      },
    ),
    (error) => error instanceof CandidateLiveViewError &&
      error.code === "LIVE_VIEW_NOT_AVAILABLE",
  );
});

test("unsupported providers and malformed Browserbase URLs fail closed", async () => {
  const base = dependencies();
  await assert.rejects(
    issueCandidateApplicationLiveView(
      { authUserId: IDS.authUser, applicationId: IDS.application },
      {
        ...base,
        providerBindings: {
          async findActiveBinding() {
            return { providerAdapter: "unknown", providerSessionRef: "private-ref" };
          },
        },
      },
    ),
    (error) => error instanceof CandidateLiveViewError &&
      error.code === "LIVE_VIEW_PROVIDER_UNSUPPORTED",
  );

  assert.equal(isBrowserbaseLiveViewUrl("https://www.browserbase.com/live/signed"), true);
  assert.equal(isBrowserbaseLiveViewUrl("https://connect.browserbase.com/live/signed"), true);
  assert.equal(isBrowserbaseLiveViewUrl("http://www.browserbase.com/live/signed"), false);
  assert.equal(isBrowserbaseLiveViewUrl("https://browserbase.com.evil.test/live/signed"), false);
  assert.equal(isBrowserbaseLiveViewUrl("https://user:secret@browserbase.com/live"), false);
});

test("Browserbase provider verifies a running session before requesting its live URL", async () => {
  const calls: string[] = [];
  const provider = createBrowserbaseLiveViewProvider({
    async retrieveSession(ref) {
      calls.push(`retrieve:${ref}`);
      return {
        id: ref,
        status: "RUNNING",
        expiresAt: "2026-08-18T20:05:00.000Z",
      };
    },
    async debugSession(ref) {
      calls.push(`debug:${ref}`);
      return {
        debuggerFullscreenUrl: "https://www.browserbase.com/devtools-fullscreen/signed",
      };
    },
  }, () => NOW);

  assert.deepEqual(await provider.issueLiveView("provider-session"), {
    url: "https://www.browserbase.com/devtools-fullscreen/signed",
    providerExpiresAt: "2026-08-18T20:05:00.000Z",
  });
  assert.deepEqual(calls, ["retrieve:provider-session", "debug:provider-session"]);
});

test("Browserbase provider never requests a debug URL for a terminal session", async () => {
  let debugReads = 0;
  const provider = createBrowserbaseLiveViewProvider({
    async retrieveSession(ref) {
      return {
        id: ref,
        status: "COMPLETED",
        expiresAt: "2026-08-18T20:05:00.000Z",
      };
    },
    async debugSession() {
      debugReads += 1;
      return { debuggerFullscreenUrl: "https://www.browserbase.com/live/signed" };
    },
  }, () => NOW);

  await assert.rejects(
    provider.issueLiveView("provider-session"),
    /BROWSERBASE_LIVE_VIEW_SESSION_NOT_ACTIVE/u,
  );
  assert.equal(debugReads, 0);
});
