import { spawn, type ChildProcess } from "node:child_process";

type ServiceName = "web" | "worker";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Map<ServiceName, ChildProcess>();
let stopping = false;
let exitCode = 0;

function start(
  name: ServiceName,
  command: string,
  args: readonly string[],
): ChildProcess {
  const child = spawn(command, [...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.set(name, child);
  child.once("error", (error) => {
    process.stderr.write(`[local-stack] ${name} failed to start: ${error.message}\n`);
    exitCode = 1;
    void stop("START_FAILURE");
  });
  child.once("exit", (code, signal) => {
    children.delete(name);
    if (!stopping) {
      process.stderr.write(
        `[local-stack] ${name} exited unexpectedly (${signal ?? code ?? "unknown"}).\n`,
      );
      exitCode = code && code > 0 ? code : 1;
      void stop("CHILD_EXIT");
    }
  });
  return child;
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000);
    timeout.unref();
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stop(reason: NodeJS.Signals | "CHILD_EXIT" | "START_FAILURE"): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`[local-stack] stopping (${reason})\n`);
  const running = [...children.values()];
  for (const child of running) child.kill("SIGTERM");
  await Promise.all(running.map(waitForExit));
  process.exitCode = exitCode;
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });

start("web", npmCommand, ["run", "dev", "--", "--port", "3001"]);
// Own the worker Node process directly. An npm wrapper can exit before its
// grandchild finishes releasing a retained Browserbase session and recording
// the terminal state in Supabase.
start("worker", process.execPath, [
  "--experimental-strip-types",
  "--env-file=.env.local",
  "scripts/run-worker-service.ts",
]);
