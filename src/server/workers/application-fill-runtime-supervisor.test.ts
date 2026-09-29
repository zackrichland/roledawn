import assert from "node:assert/strict";
import test from "node:test";

import type {
  ComputerRuntimeAdapter,
  ComputerRuntimeUsage,
  ProvisionedComputerRuntime,
} from "./application-fill.ts";
import {
  createApplicationFillRuntimeSupervisor,
  type ApplicationFillRuntimeReleaseEvent,
} from "./application-fill-runtime-supervisor.ts";

const SESSION_ID = "80000000-0000-4000-8000-000000000008";

class FakeAdapter implements ComputerRuntimeAdapter {
  readonly adapterRelease = "test-runtime/1";
  readonly destroyed: ProvisionedComputerRuntime[] = [];
  usage: ComputerRuntimeUsage = Object.freeze({
    wallClockMs: 1_000,
    providerBilledMs: 1_000,
    uploadedByteCount: 10,
    blockedSubmissionAttemptCount: 0,
    outboundSubmissionRequestCount: 0,
  });

  async provision(): Promise<ProvisionedComputerRuntime> {
    throw new Error("UNUSED");
  }

  async recoverProvisioning(): Promise<ProvisionedComputerRuntime> {
    throw new Error("UNUSED");
  }

  async destroy(runtime: ProvisionedComputerRuntime): Promise<ComputerRuntimeUsage> {
    this.destroyed.push(runtime);
    return this.usage;
  }
}

function runtime(): ProvisionedComputerRuntime {
  return Object.freeze({
    handle: Object.freeze({ guarded: true }),
    providerAdapter: "test-provider",
    providerSessionRef: "private-provider-session",
    providerContextRef: null,
  });
}

async function runScheduledTask(
  task: (() => Promise<void>) | null,
): Promise<void> {
  assert.ok(task);
  await task();
}

test("retains one guarded runtime until its TTL and releases it exactly once", async () => {
  const adapter = new FakeAdapter();
  const events: ApplicationFillRuntimeReleaseEvent[] = [];
  let scheduled: (() => Promise<void>) | null = null;
  let canceled = 0;
  const supervisor = createApplicationFillRuntimeSupervisor({
    now: () => 1_000,
    schedule(delayMs, task) {
      assert.equal(delayMs, 5_000);
      scheduled = task;
      return () => { canceled += 1; };
    },
    onRelease(event) {
      events.push(event);
    },
  });

  await supervisor.retain({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    expiresAtMs: 6_000,
    runtimeAdapter: adapter,
    runtime: runtime(),
  });
  assert.equal(supervisor.snapshot().retainedCount, 1);
  await runScheduledTask(scheduled);

  assert.equal(supervisor.snapshot().retainedCount, 0);
  assert.equal(adapter.destroyed.length, 1);
  assert.equal(canceled, 1);
  assert.deepEqual(events.map((event) => [event.reason, event.outcome]), [
    ["TTL_EXPIRED", "RELEASED"],
  ]);
  assert.equal(events[0]?.computerSessionId, SESSION_ID);
  assert.equal(
    events[0]?.fillAttemptId,
    "50000000-0000-4000-8000-000000000005",
  );
  assert.equal(JSON.stringify(events).includes("private-provider-session"), false);
});

test("graceful stop releases every retained runtime and rejects later retention", async () => {
  const adapter = new FakeAdapter();
  const events: ApplicationFillRuntimeReleaseEvent[] = [];
  const supervisor = createApplicationFillRuntimeSupervisor({
    now: () => 1_000,
    schedule: () => () => undefined,
    onRelease(event) {
      events.push(event);
    },
  });
  await supervisor.retain({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    expiresAtMs: 6_000,
    runtimeAdapter: adapter,
    runtime: runtime(),
  });

  await supervisor.stop();

  assert.equal(adapter.destroyed.length, 1);
  assert.equal(supervisor.snapshot().accepting, false);
  assert.deepEqual(events.map((event) => [event.reason, event.outcome]), [
    ["WORKER_STOPPED", "RELEASED"],
  ]);
  await assert.rejects(
    supervisor.retain({
      computerSessionId: "90000000-0000-4000-8000-000000000009",
      fillAttemptId: "50000000-0000-4000-8000-000000000005",
      expiresAtMs: 6_000,
      runtimeAdapter: adapter,
      runtime: runtime(),
    }),
    /APPLICATION_FILL_RUNTIME_SUPERVISOR_STOPPED/u,
  );
});

test("non-zero submission telemetry is reported as uncertain", async () => {
  const adapter = new FakeAdapter();
  adapter.usage = Object.freeze({
    ...adapter.usage,
    outboundSubmissionRequestCount: 1,
  });
  const events: ApplicationFillRuntimeReleaseEvent[] = [];
  let scheduled: (() => Promise<void>) | null = null;
  const supervisor = createApplicationFillRuntimeSupervisor({
    now: () => 1_000,
    schedule(_delayMs, task) {
      scheduled = task;
      return () => undefined;
    },
    onRelease(event) {
      events.push(event);
    },
  });
  await supervisor.retain({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    expiresAtMs: 6_000,
    runtimeAdapter: adapter,
    runtime: runtime(),
  });
  await runScheduledTask(scheduled);

  assert.equal(events[0]?.outcome, "RELEASE_UNCERTAIN");
  assert.equal(
    events[0]?.errorCode,
    "APPLICATION_FILL_RUNTIME_RELEASE_TELEMETRY_UNCERTAIN",
  );
});

test("release does not finish before durable reconciliation completes", async () => {
  const adapter = new FakeAdapter();
  let scheduled: (() => Promise<void>) | null = null;
  let finishReconciliation: () => void = () => {
    throw new Error("RECONCILIATION_GATE_NOT_READY");
  };
  const reconciliationGate = new Promise<void>((resolve) => {
    finishReconciliation = resolve;
  });
  const sequence: string[] = [];
  const supervisor = createApplicationFillRuntimeSupervisor({
    now: () => 1_000,
    schedule(_delayMs, task) {
      scheduled = task;
      return () => undefined;
    },
    async onRelease() {
      sequence.push("reconciliation_started");
      await reconciliationGate;
      sequence.push("reconciliation_committed");
    },
  });
  await supervisor.retain({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    expiresAtMs: 6_000,
    runtimeAdapter: adapter,
    runtime: runtime(),
  });

  let settled = false;
  const releasePromise = runScheduledTask(scheduled).then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(sequence, ["reconciliation_started"]);

  finishReconciliation();
  await releasePromise;
  assert.equal(settled, true);
  assert.deepEqual(sequence, [
    "reconciliation_started",
    "reconciliation_committed",
  ]);
});

test("resumes only the exact retained fill and keeps provider references opaque", async () => {
  const adapter = new FakeAdapter();
  const retainedRuntime = runtime();
  const supervisor = createApplicationFillRuntimeSupervisor({
    now: () => 1_000,
    schedule: () => () => undefined,
  });
  await supervisor.retain({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    expiresAtMs: 6_000,
    runtimeAdapter: adapter,
    runtime: retainedRuntime,
  });

  const result = await supervisor.resume({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    async run(value) {
      assert.equal(value, retainedRuntime);
      return "continued";
    },
  });
  assert.equal(result, "continued");
  assert.equal(supervisor.snapshot().retainedCount, 1);
  assert.equal(adapter.destroyed.length, 0);

  await assert.rejects(
    supervisor.resume({
      computerSessionId: SESSION_ID,
      fillAttemptId: "50000000-0000-4000-8000-000000000099",
      async run() { return undefined; },
    }),
    /APPLICATION_FILL_RUNTIME_BINDING_MISMATCH/u,
  );
});

test("TTL release waits for an in-flight resume before destroying the runtime", async () => {
  const adapter = new FakeAdapter();
  let scheduled: (() => Promise<void>) | null = null;
  let finishResume: () => void = () => {
    throw new Error("RESUME_GATE_NOT_READY");
  };
  const resumeGate = new Promise<void>((resolve) => {
    finishResume = resolve;
  });
  const sequence: string[] = [];
  const supervisor = createApplicationFillRuntimeSupervisor({
    now: () => 1_000,
    schedule(_delayMs, task) {
      scheduled = task;
      return () => undefined;
    },
    onRelease() {
      sequence.push("released");
    },
  });
  await supervisor.retain({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    expiresAtMs: 6_000,
    runtimeAdapter: adapter,
    runtime: runtime(),
  });

  const resumePromise = supervisor.resume({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    async run() {
      sequence.push("resume_started");
      await resumeGate;
      sequence.push("resume_finished");
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const releasePromise = runScheduledTask(scheduled);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(adapter.destroyed.length, 0);

  finishResume();
  await Promise.all([resumePromise, releasePromise]);
  assert.equal(adapter.destroyed.length, 1);
  assert.deepEqual(sequence, ["resume_started", "resume_finished", "released"]);
});

test("rejects concurrent resume callbacks for the same browser", async () => {
  const supervisor = createApplicationFillRuntimeSupervisor({
    now: () => 1_000,
    schedule: () => () => undefined,
  });
  await supervisor.retain({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    expiresAtMs: 6_000,
    runtimeAdapter: new FakeAdapter(),
    runtime: runtime(),
  });
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const first = supervisor.resume({
    computerSessionId: SESSION_ID,
    fillAttemptId: "50000000-0000-4000-8000-000000000005",
    async run() { await gate; },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  await assert.rejects(
    supervisor.resume({
      computerSessionId: SESSION_ID,
      fillAttemptId: "50000000-0000-4000-8000-000000000005",
      async run() { return undefined; },
    }),
    /APPLICATION_FILL_RUNTIME_BUSY/u,
  );
  finish();
  await first;
});
