import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import Browserbase from "@browserbasehq/sdk";

import type {
  ComputerRuntimeProvisionRequest,
  ProvisionedComputerRuntime,
} from "../src/server/workers/application-fill.ts";
import { createBrowserbaseRuntimeAdapterForNodeWorker } from
  "../src/server/workers/browserbase-runtime.node.ts";
import {
  browserbaseRuntimePage,
  parseBrowserbaseRuntimeEnvironment,
  resolveBrowserbaseProjectId,
} from "../src/server/workers/browserbase-runtime.ts";

if (process.env.RUN_BROWSERBASE_SMOKE_ACCEPTANCE !== "true") {
  throw new Error("BROWSERBASE_SMOKE_ACCEPTANCE_NOT_AUTHORIZED");
}

const environment = parseBrowserbaseRuntimeEnvironment(process.env);
const browserbase = new Browserbase({
  apiKey: environment.apiKey,
  maxRetries: 0,
  timeout: environment.apiTimeoutMs,
});
const projectId = resolveBrowserbaseProjectId(await browserbase.projects.list());
const runtimeAdapter = await createBrowserbaseRuntimeAdapterForNodeWorker(process.env);
const ids = Object.freeze({
  workspaceId: randomUUID(),
  candidateId: randomUUID(),
  applicationId: randomUUID(),
  revisionId: randomUUID(),
  fillAttemptId: randomUUID(),
  computerSessionId: randomUUID(),
});
const request: ComputerRuntimeProvisionRequest = Object.freeze({
  idempotencyKey: ids.computerSessionId,
  binding: ids,
  startUrl: "https://example.com/",
  allowedOrigins: Object.freeze(["https://example.com"]),
  ttlSeconds: 60,
  executionMode: "EPHEMERAL_CLEAN" as const,
  browserProfileRef: null,
  artifactManifest: [],
  artifactPayloads: [],
  submissionGuard: Object.freeze({
    submitAuthorized: false as const,
    outboundSubmissionRequests: "BLOCK" as const,
  }),
});

let runtime: ProvisionedComputerRuntime | null = null;
let providerSessionRef: string | null = null;
try {
  runtime = await runtimeAdapter.provision(request);
  providerSessionRef = runtime.providerSessionRef;
  const page = browserbaseRuntimePage(runtime.handle);
  const pageTitle = await page.title();
  const exactOriginNavigation = new URL(page.url()).origin === "https://example.com";

  const domSubmitBlocked = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __roledawnBlockedSubmitAttempts?: number;
    };
    const before = state.__roledawnBlockedSubmitAttempts ?? 0;
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/synthetic-submit";
    document.body.append(form);
    form.requestSubmit();
    return (state.__roledawnBlockedSubmitAttempts ?? 0) === before + 1;
  });
  const postRequestBlocked = await page.evaluate(async () => {
    try {
      await fetch("/synthetic-submit", {
        method: "POST",
        body: "synthetic-smoke-only",
      });
      return false;
    } catch {
      return true;
    }
  });
  const postloadGetBlocked = await page.evaluate(async () => {
    try {
      await fetch("/synthetic-read?value=synthetic-smoke-only");
      return false;
    } catch {
      return true;
    }
  });
  const serviceWorkerBlocked = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return true;
    try {
      await navigator.serviceWorker.register("/synthetic-service-worker.js");
      return false;
    } catch {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.length === 0;
    }
  });
  const websocketBlocked = await page.evaluate(() => new Promise<boolean>((resolve) => {
    const socket = new WebSocket("wss://example.com/synthetic-websocket");
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    socket.addEventListener("close", () => finish(true), { once: true });
    socket.addEventListener("error", () => finish(true), { once: true });
    setTimeout(() => finish(false), 2_000);
  }));

  const usage = await runtimeAdapter.destroy(runtime);
  runtime = null;

  const matches = await browserbase.sessions.list({
    q: `user_metadata['roledawn_computer_session_id']:'${ids.computerSessionId}'`,
  });
  const finalSession = await browserbase.sessions.retrieve(providerSessionRef);
  const terminalStatus = finalSession.status;

  assert.equal(finalSession.projectId, projectId);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, providerSessionRef);
  assert.equal(exactOriginNavigation, true);
  assert.equal(domSubmitBlocked, true);
  assert.equal(postRequestBlocked, true);
  assert.equal(postloadGetBlocked, true);
  assert.equal(serviceWorkerBlocked, true);
  assert.equal(websocketBlocked, true);
  assert.equal(usage.outboundSubmissionRequestCount, 0);
  assert.ok(usage.blockedSubmissionAttemptCount >= 4);
  assert.equal(terminalStatus, "COMPLETED");

  process.stdout.write(`${JSON.stringify({
    credentialed_session_created: true,
    project_inferred: true,
    cdp_connected: true,
    exact_origin_navigation: exactOriginNavigation,
    metadata_match_count: matches.length,
    dom_submit_blocked: domSubmitBlocked,
    post_request_blocked: postRequestBlocked,
    postload_get_blocked: postloadGetBlocked,
    service_worker_blocked: serviceWorkerBlocked,
    websocket_blocked: websocketBlocked,
    outbound_submission_request_count: usage.outboundSubmissionRequestCount,
    blocked_egress_attempt_count: usage.blockedSubmissionAttemptCount,
    explicit_release_requested: true,
    terminal_status: terminalStatus,
    page_title: pageTitle,
    session_url: `https://www.browserbase.com/sessions/${providerSessionRef}`,
  })}\n`);
} finally {
  if (runtime !== null) {
    try {
      await runtimeAdapter.destroy(runtime);
    } catch {
      if (providerSessionRef !== null) {
        await browserbase.sessions.update(providerSessionRef, {
          status: "REQUEST_RELEASE",
        }).catch(() => undefined);
      }
    }
  }
}
