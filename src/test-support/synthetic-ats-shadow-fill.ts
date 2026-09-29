/**
 * Test-only proof harness for the browser shadow-fill boundary.
 *
 * The harness launches an installed Chromium browser against a loopback-only
 * synthetic ATS form. It can fill deterministic fields and mount one local
 * artifact, but it installs both DOM and network interlocks before touching
 * candidate data. It deliberately has no submit operation.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export type SyntheticCandidateInput = Readonly<{
  fullName: string;
  email: string;
  phone: string;
  workAuthorization: "YES" | "NO";
}>;

export type SyntheticShadowFillReadBack = Readonly<{
  fullName: string;
  email: string;
  phone: string;
  workAuthorization: "YES" | "NO" | "";
  uploadedFile: null | Readonly<{
    name: string;
    size: number;
    type: string;
  }>;
  sensitiveAttestationAnswered: boolean;
  submitControlDisabled: boolean;
  blockedDomSubmitAttempts: number;
}>;

export type ShadowFillAttemptState =
  | "CREATED"
  | "SESSION_ACTIVE"
  | "FILLING"
  | "READY_FOR_REVIEW"
  | "FAILED_SAFE"
  | "CLOSED";

export type ShadowFillAttemptBinding = Readonly<{
  attemptId: string;
  applicationId: string;
  revisionId: string;
  revisionHash: `sha256:${string}`;
  artifactHash: `sha256:${string}`;
  authority: "FILL_ONLY_NO_SUBMIT";
}>;

export type ShadowFillAttemptEvent = Readonly<{
  index: number;
  state: ShadowFillAttemptState;
  occurredAt: string;
  binding: ShadowFillAttemptBinding;
  summary: Readonly<Record<string, string | number | boolean | null>>;
}>;

const ALLOWED_TRANSITIONS: Readonly<Record<ShadowFillAttemptState, readonly ShadowFillAttemptState[]>> = {
  CREATED: ["SESSION_ACTIVE", "FAILED_SAFE"],
  SESSION_ACTIVE: ["FILLING", "FAILED_SAFE"],
  FILLING: ["READY_FOR_REVIEW", "FAILED_SAFE"],
  READY_FOR_REVIEW: ["CLOSED"],
  FAILED_SAFE: ["CLOSED"],
  CLOSED: [],
};

function stableBindingKey(binding: ShadowFillAttemptBinding): string {
  return JSON.stringify([
    binding.attemptId,
    binding.applicationId,
    binding.revisionId,
    binding.revisionHash,
    binding.artifactHash,
    binding.authority,
  ]);
}

/**
 * A tiny append-only JSONL ledger used only by this local proof. Production
 * code must persist the equivalent lifecycle in PostgreSQL, not this file.
 */
export class SyntheticShadowFillAttemptLedger {
  readonly #filePath: string;
  readonly #binding: ShadowFillAttemptBinding;
  readonly #now: () => number;
  #events: ShadowFillAttemptEvent[];

  private constructor(
    filePath: string,
    binding: ShadowFillAttemptBinding,
    events: ShadowFillAttemptEvent[],
    now: () => number,
  ) {
    this.#filePath = filePath;
    this.#binding = binding;
    this.#events = events;
    this.#now = now;
  }

  static async create(
    filePath: string,
    binding: ShadowFillAttemptBinding,
    now: () => number = Date.now,
  ): Promise<SyntheticShadowFillAttemptLedger> {
    const ledger = new SyntheticShadowFillAttemptLedger(filePath, binding, [], now);
    await ledger.transition("CREATED", { source: "synthetic-shadow-harness" });
    return ledger;
  }

  static async reopen(
    filePath: string,
    binding: ShadowFillAttemptBinding,
    now: () => number = Date.now,
  ): Promise<SyntheticShadowFillAttemptLedger> {
    const raw = await readFile(filePath, "utf8");
    const events = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ShadowFillAttemptEvent);

    if (events.length === 0) throw new Error("The shadow-fill ledger is empty.");
    for (const [index, event] of events.entries()) {
      if (event.index !== index) throw new Error("The shadow-fill ledger has a non-contiguous event index.");
      if (stableBindingKey(event.binding) !== stableBindingKey(binding)) {
        throw new Error("The shadow-fill ledger binding does not match the requested attempt.");
      }
      if (index > 0 && !ALLOWED_TRANSITIONS[events[index - 1].state].includes(event.state)) {
        throw new Error("The shadow-fill ledger contains an invalid state transition.");
      }
    }

    return new SyntheticShadowFillAttemptLedger(filePath, binding, events, now);
  }

  get events(): readonly ShadowFillAttemptEvent[] {
    return this.#events.map((event) => ({
      ...event,
      binding: { ...event.binding },
      summary: { ...event.summary },
    }));
  }

  get state(): ShadowFillAttemptState {
    const latest = this.#events.at(-1);
    if (!latest) throw new Error("The shadow-fill ledger has no state.");
    return latest.state;
  }

  async transition(
    state: ShadowFillAttemptState,
    summary: Readonly<Record<string, string | number | boolean | null>> = {},
  ): Promise<void> {
    if (this.#events.length > 0 && !ALLOWED_TRANSITIONS[this.state].includes(state)) {
      throw new Error(`Invalid shadow-fill transition: ${this.state} -> ${state}.`);
    }
    if (this.#events.length === 0 && state !== "CREATED") {
      throw new Error("A shadow-fill attempt must start in CREATED.");
    }

    const event: ShadowFillAttemptEvent = {
      index: this.#events.length,
      state,
      occurredAt: new Date(this.#now()).toISOString(),
      binding: { ...this.#binding },
      summary: { ...summary },
    };
    await writeFile(this.#filePath, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      flag: "a",
      mode: 0o600,
    });
    this.#events = [...this.#events, event];
  }
}

export function findInstalledChromium(): string | null {
  const configured = process.env.ROLEDAWN_CHROME_PATH?.trim();
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));

  // `spawn` produces a clearer error than importing a filesystem sync API.
  // The fixed common paths keep this optional local acceptance dependency-free.
  return candidates.find((candidate) => {
    try {
      return process.getBuiltinModule("node:fs").existsSync(candidate);
    } catch {
      return false;
    }
  }) ?? null;
}

type CdpResponse = Readonly<{
  id?: number;
  result?: unknown;
  error?: Readonly<{ code: number; message: string }>;
  method?: string;
  params?: unknown;
}>;

class CdpClient {
  readonly #socket: WebSocket;
  #nextId = 1;
  readonly #pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (message) => {
      const response = JSON.parse(String(message.data)) as CdpResponse;
      if (typeof response.id !== "number") return;
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      if (response.error) {
        pending.reject(new Error(`CDP ${response.error.code}: ${response.error.message}`));
      } else {
        pending.resolve(response.result);
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("The Chrome DevTools connection closed."));
      }
      this.#pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 5_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Could not connect to Chrome DevTools."));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  async send<T = unknown>(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<T> {
    const id = this.#nextId;
    this.#nextId += 1;
    const response = new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    this.#socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  close(): void {
    this.#socket.close();
  }
}

type SyntheticAtsRuntime = Readonly<{
  baseUrl: string;
  getSubmitRequestCount(): number;
  close(): Promise<void>;
}>;

function syntheticAtsHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Synthetic ATS fixture</title></head>
  <body>
    <main>
      <h1>Synthetic product engineer application</h1>
      <form action="/apply" method="post" enctype="multipart/form-data">
        <label>Full name <input name="fullName" autocomplete="name" required></label>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Phone <input name="phone" autocomplete="tel" required></label>
        <label>Work authorization
          <select name="workAuthorization" required>
            <option value="">Choose one</option><option value="YES">Yes</option><option value="NO">No</option>
          </select>
        </label>
        <label>Résumé <input name="resume" type="file" accept="application/pdf" required></label>
        <label><input name="legalAttestation" type="checkbox"> I certify every answer under penalty of perjury.</label>
        <button type="submit">Submit application</button>
      </form>
    </main>
  </body>
</html>`;
}

async function startSyntheticAts(): Promise<SyntheticAtsRuntime> {
  let submitRequestCount = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/job") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(syntheticAtsHtml());
      return;
    }
    if (request.url === "/apply") {
      submitRequestCount += 1;
      response.writeHead(409, { "content-type": "text/plain; charset=utf-8" });
      response.end("Synthetic submit endpoint must never be reached.");
      return;
    }
    response.writeHead(404).end();
  });

  await listenLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic ATS did not bind a TCP port.");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    getSubmitRequestCount: () => submitRequestCount,
    close: () => closeServer(server),
  };
}

function listenLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

async function waitForDevToolsPort(userDataDir: string, chrome: ChildProcess): Promise<number> {
  const portFile = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before DevTools started (${chrome.exitCode}).`);
    try {
      const [port] = (await readFile(portFile, "utf8")).split("\n");
      const parsed = Number(port);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    } catch {
      // Chrome creates the port file asynchronously.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Chrome DevTools.");
}

async function findPageTarget(port: number, expectedUrl: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json() as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
    const target = targets.find((candidate) =>
      candidate.type === "page" && candidate.url.startsWith(expectedUrl) && candidate.webSocketDebuggerUrl,
    );
    if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Chrome did not expose the synthetic ATS page target.");
}

type RuntimeEvaluateResult = Readonly<{
  result: Readonly<{
    type: string;
    value?: unknown;
    description?: string;
  }>;
  exceptionDetails?: unknown;
}>;

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const response = await client.send<RuntimeEvaluateResult>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error("The synthetic browser expression failed.");
  return response.result.value as T;
}

async function waitForForm(client: CdpClient): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(client, "Boolean(document.querySelector('form'))")) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The synthetic ATS form did not load.");
}

export type SyntheticShadowFillAcceptance = Readonly<{
  readBack: SyntheticShadowFillReadBack;
  submitRequestCount: number;
  ledgerEvents: readonly ShadowFillAttemptEvent[];
  artifactHash: `sha256:${string}`;
}>;

/**
 * Runs a real local browser proof. The returned result is evidence of this
 * fixture only; it is not a production provider or a claim of ATS coverage.
 */
export async function runSyntheticShadowFillAcceptance(input: Readonly<{
  chromePath: string;
  candidate: SyntheticCandidateInput;
  applicationId: string;
  revisionId: string;
  revisionHash: `sha256:${string}`;
  now?: () => number;
}>): Promise<SyntheticShadowFillAcceptance> {
  const workDir = await mkdtemp(join(tmpdir(), "roledawn-shadow-fill-"));
  const profileDir = join(workDir, "chrome-profile");
  const artifactPath = join(workDir, "candidate-resume.pdf");
  const ledgerPath = join(workDir, "attempt.jsonl");
  const artifactBytes = Buffer.from("%PDF-1.4\n% RoleDawn synthetic ATS upload fixture\n%%EOF\n", "utf8");
  await writeFile(artifactPath, artifactBytes, { mode: 0o600 });
  const artifactHash = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}` as const;
  const binding: ShadowFillAttemptBinding = {
    attemptId: "synthetic-shadow-attempt-1",
    applicationId: input.applicationId,
    revisionId: input.revisionId,
    revisionHash: input.revisionHash,
    artifactHash,
    authority: "FILL_ONLY_NO_SUBMIT",
  };
  const ledger = await SyntheticShadowFillAttemptLedger.create(ledgerPath, binding, input.now);
  const ats = await startSyntheticAts();
  let chrome: ChildProcess | null = null;
  let client: CdpClient | null = null;

  try {
    const startUrl = `${ats.baseUrl}/job`;
    chrome = spawn(input.chromePath, [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--disable-features=OptimizationHints,MediaRouter,Translate",
      startUrl,
    ], { stdio: "ignore" });
    const devToolsPort = await waitForDevToolsPort(profileDir, chrome);
    client = await CdpClient.connect(await findPageTarget(devToolsPort, startUrl));
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: [`${ats.baseUrl}/apply*`] });
    await waitForForm(client);
    await ledger.transition("SESSION_ACTIVE", { provider: "local-chrome-cdp", networkScope: "loopback-only" });

    await evaluate(client, `(() => {
      const form = document.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('Missing application form');
      window.__roledawnBlockedSubmitAttempts = 0;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.__roledawnBlockedSubmitAttempts += 1;
      }, true);
      for (const control of form.querySelectorAll('button[type="submit"], input[type="submit"]')) {
        control.disabled = true;
        control.setAttribute('aria-disabled', 'true');
        control.dataset.roledawnShadowLocked = 'true';
      }
      form.dataset.roledawnAuthority = 'FILL_ONLY_NO_SUBMIT';
      return true;
    })()`);
    await ledger.transition("FILLING", { adapter: "synthetic-ats/1" });

    await evaluate(client, `(() => {
      const values = ${JSON.stringify(input.candidate)};
      const setValue = (name, value) => {
        const control = document.querySelector('[name="' + name + '"]');
        if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
          throw new Error('Missing field: ' + name);
        }
        control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue('fullName', values.fullName);
      setValue('email', values.email);
      setValue('phone', values.phone);
      setValue('workAuthorization', values.workAuthorization);
      return true;
    })()`);

    const document = await client.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 1 });
    const uploadNode = await client.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: "input[name=\"resume\"]",
    });
    if (!uploadNode.nodeId) throw new Error("The synthetic résumé upload field is missing.");
    await client.send("DOM.setFileInputFiles", { nodeId: uploadNode.nodeId, files: [artifactPath] });

    const readBack = await evaluate<SyntheticShadowFillReadBack>(client, `(() => {
      const value = (name) => document.querySelector('[name="' + name + '"]').value;
      const upload = document.querySelector('input[name="resume"]');
      const file = upload.files && upload.files[0];
      const submit = document.querySelector('[type="submit"]');
      const sensitive = document.querySelector('input[name="legalAttestation"]');
      return {
        fullName: value('fullName'),
        email: value('email'),
        phone: value('phone'),
        workAuthorization: value('workAuthorization'),
        uploadedFile: file ? { name: file.name, size: file.size, type: file.type } : null,
        sensitiveAttestationAnswered: Boolean(sensitive.checked),
        submitControlDisabled: Boolean(submit.disabled && submit.dataset.roledawnShadowLocked === 'true'),
        blockedDomSubmitAttempts: window.__roledawnBlockedSubmitAttempts,
      };
    })()`);

    await ledger.transition("READY_FOR_REVIEW", {
      fieldsReadBack: 4,
      artifactReadBack: Boolean(readBack.uploadedFile),
      submitAuthority: false,
    });

    // Exercise the DOM interlock itself. Even a page-level requestSubmit cannot
    // reach the synthetic side-effect endpoint in shadow mode.
    const blockedDomSubmitAttempts = await evaluate<number>(client, `(() => {
      const form = document.querySelector('form');
      const submit = document.querySelector('[type="submit"]');
      submit.disabled = false;
      form.requestSubmit(submit);
      submit.disabled = true;
      return window.__roledawnBlockedSubmitAttempts;
    })()`);
    const finalReadBack = { ...readBack, blockedDomSubmitAttempts };

    await ledger.transition("CLOSED", {
      submitRequestCount: ats.getSubmitRequestCount(),
      runtimeDestroyed: true,
    });
    const reopened = await SyntheticShadowFillAttemptLedger.reopen(ledgerPath, binding, input.now);
    return {
      readBack: finalReadBack,
      submitRequestCount: ats.getSubmitRequestCount(),
      ledgerEvents: reopened.events,
      artifactHash,
    };
  } catch (error) {
    if (ledger.state !== "FAILED_SAFE" && ledger.state !== "CLOSED") {
      await ledger.transition("FAILED_SAFE", {
        reason: error instanceof Error ? error.name : "UNKNOWN",
        submitRequestCount: ats.getSubmitRequestCount(),
      });
      await ledger.transition("CLOSED", {
        submitRequestCount: ats.getSubmitRequestCount(),
        runtimeDestroyed: true,
      });
    }
    throw error;
  } finally {
    client?.close();
    if (chrome) await terminateChild(chrome);
    await ats.close();
    // Chrome can still be flushing its profile as it exits; retry busy directories.
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
