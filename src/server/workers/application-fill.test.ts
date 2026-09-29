import assert from "node:assert/strict";
import test from "node:test";

import type { Json } from "../../lib/supabase/database.types.ts";
import {
  APPLICATION_FILL_TOPIC,
  coordinateApplicationFill,
  ephemeralCleanFillExecutionPolicy,
  parseApplicationFillRequestedPayload,
  runApplicationFillRecoveryOnce,
  runApplicationFillWorkerOnce,
} from "./application-fill.ts";
import type {
  ApplicationFillAuthorizationContext,
  ApplicationFillOutboxMessage,
  ApplicationFillRecoveryClaim,
  ApplicationFillRecoveryDatabase,
  ComputerRuntimeAdapter,
  ComputerRuntimeProvisionRequest,
  ComputerRuntimeUsage,
  FillCompletionInput,
  FillExecutionPlan,
  NoSubmitFormDriver,
  NoSubmitFormOutcome,
  ProvisionedComputerRuntime,
} from "./application-fill.ts";
import type {
  ApplicationFillExecutionMaterializer,
  ApplicationFillExecutionPackage,
} from "./application-fill-materializer.ts";

const IDS = Object.freeze({
  workspace: "10000000-0000-4000-8000-000000000001",
  candidate: "20000000-0000-4000-8000-000000000002",
  application: "30000000-0000-4000-8000-000000000003",
  revision: "40000000-0000-4000-8000-000000000004",
  fill: "50000000-0000-4000-8000-000000000005",
  run: "60000000-0000-4000-8000-000000000006",
  outbox: "70000000-0000-4000-8000-000000000007",
  session: "80000000-0000-4000-8000-000000000008",
  profile: "90000000-0000-4000-8000-000000000009",
  otherSession: "a0000000-0000-4000-8000-00000000000a",
});
const AUTHORITY_HASH = "a".repeat(64);
const DISCLOSURE_HASH = "b".repeat(64);
const READBACK_HASH = "c".repeat(64);

function context(status: ApplicationFillAuthorizationContext["status"] = "QUEUED"): ApplicationFillAuthorizationContext {
  return Object.freeze({
    workspaceId: IDS.workspace,
    candidateId: IDS.candidate,
    applicationId: IDS.application,
    revisionId: IDS.revision,
    fillAttemptId: IDS.fill,
    browserRunId: IDS.run,
    status,
    destinationUrl: "https://jobs.example.com/apply/role-1",
    authorityHash: AUTHORITY_HASH,
    disclosureManifestHash: DISCLOSURE_HASH,
    artifactManifest: [{ artifact_version_id: IDS.revision, sha256: "d".repeat(64) }],
    disclosureManifest: {
      policy: {
        submit_authorized: false,
        captcha_or_otp: "TAKEOVER",
      },
    },
  });
}

function message(payloadOverride: Json | null = null): ApplicationFillOutboxMessage {
  return Object.freeze({
    outboxId: IDS.outbox,
    topic: APPLICATION_FILL_TOPIC,
    attemptCount: 1,
    payload: payloadOverride ?? {
      application_id: IDS.application,
      revision_id: IDS.revision,
      fill_attempt_id: IDS.fill,
      browser_run_id: IDS.run,
      authority_hash: AUTHORITY_HASH,
      disclosure_manifest_hash: DISCLOSURE_HASH,
      authority_scope: "FILL_ONLY_NO_SUBMIT",
    },
  });
}

function recoveryClaim(
  recoveryMode: ApplicationFillRecoveryClaim["recoveryMode"],
  computerSessionId: string = IDS.session,
): ApplicationFillRecoveryClaim {
  return Object.freeze({
    fillAttemptId: IDS.fill,
    computerSessionId,
    recoveryMode,
    message: recoveryMode === "RESUME_IDEMPOTENT_PROVISION" ? message() : null,
  });
}

class FakeFillDatabase implements ApplicationFillRecoveryDatabase {
  currentContext: ApplicationFillAuthorizationContext;
  readonly calls: string[] = [];
  readonly completions: FillCompletionInput[] = [];
  readonly claimed: ApplicationFillOutboxMessage[] = [];
  readonly released: Array<Readonly<{ errorCode: string; attemptCount: number }>> = [];
  readonly staleClaims: ApplicationFillRecoveryClaim[] = [];
  readonly completionWorkers: string[] = [];
  releaseResult = true;
  startReplay = false;
  reservedExecutionPlan: FillExecutionPlan | null = null;

  constructor(initialContext = context()) {
    this.currentContext = initialContext;
  }

  async loadAuthorizationContext(): Promise<ApplicationFillAuthorizationContext> {
    this.calls.push("load");
    return this.currentContext;
  }

  async startAttempt(input: Readonly<{
    outboxId: string;
    workerId: string;
    fillAttemptId: string;
    executionPlan: FillExecutionPlan;
    allowedDomainPolicy: Json;
  }>): Promise<Readonly<{
    computerSessionId: string;
    applicationId: string;
    revisionId: string;
    replayed: boolean;
    executionPlan: FillExecutionPlan;
  }>> {
    this.calls.push("start");
    assert.equal(input.outboxId, IDS.outbox);
    assert.equal(input.fillAttemptId, IDS.fill);
    assert.ok(input.executionPlan.ttlSeconds >= 60 && input.executionPlan.ttlSeconds <= 1_800);
    assert.deepEqual(input.allowedDomainPolicy, {
      policy_release: "ats-destination-policy/1",
      navigation_scope: "EXACT_ORIGIN",
      allowed_origins: ["https://jobs.example.com"],
      submit_authorized: false,
    });
    this.currentContext = context("STARTED");
    return Object.freeze({
      computerSessionId: IDS.session,
      applicationId: IDS.application,
      revisionId: IDS.revision,
      replayed: this.startReplay,
      executionPlan: this.reservedExecutionPlan ?? input.executionPlan,
    });
  }

  async activateSession(): Promise<void> {
    this.calls.push("activate");
  }

  async completeAttempt(input: FillCompletionInput, workerId: string): Promise<void> {
    this.calls.push("complete");
    this.completions.push(input);
    this.completionWorkers.push(workerId);
    this.currentContext = context(input.terminalStatus);
  }

  async claimStale(): Promise<readonly ApplicationFillRecoveryClaim[]> {
    this.calls.push("claim-stale");
    return this.staleClaims;
  }

  async claim(): Promise<readonly ApplicationFillOutboxMessage[]> {
    this.calls.push("claim");
    return this.claimed;
  }

  async releaseFailure(input: Readonly<{
    workerId: string;
    outboxId: string;
    attemptCount: number;
    errorCode: string;
  }>): Promise<boolean> {
    this.calls.push("release");
    assert.equal(input.outboxId, IDS.outbox);
    this.released.push({ errorCode: input.errorCode, attemptCount: input.attemptCount });
    return this.releaseResult;
  }
}

class FakeRuntimeAdapter implements ComputerRuntimeAdapter {
  readonly adapterRelease = "test-runtime/1";
  readonly calls: string[];
  readonly provisions: ComputerRuntimeProvisionRequest[] = [];
  readonly recoveries: ComputerRuntimeProvisionRequest[] = [];
  provisionError: Error | null = null;
  recoveryError: Error | null = null;
  destroyError: Error | null = null;
  usage: ComputerRuntimeUsage = Object.freeze({
    wallClockMs: 1_500,
    providerBilledMs: 2_000,
    uploadedByteCount: 42_000,
    blockedSubmissionAttemptCount: 0,
    outboundSubmissionRequestCount: 0,
  });

  constructor(calls: string[] = []) {
    this.calls = calls;
  }

  async provision(request: ComputerRuntimeProvisionRequest): Promise<ProvisionedComputerRuntime> {
    this.calls.push("provision");
    this.provisions.push(request);
    if (this.provisionError) throw this.provisionError;
    return Object.freeze({
      handle: { providerPrivateState: true },
      providerAdapter: "test-provider",
      providerSessionRef: "provider-session-private",
      providerContextRef: null,
    });
  }

  async recoverProvisioning(
    request: ComputerRuntimeProvisionRequest,
  ): Promise<ProvisionedComputerRuntime> {
    this.calls.push("recover");
    this.recoveries.push(request);
    if (this.recoveryError) throw this.recoveryError;
    return Object.freeze({
      handle: { recoveredProviderPrivateState: true },
      providerAdapter: "test-provider",
      providerSessionRef: "provider-session-private",
      providerContextRef: null,
    });
  }

  async destroy(): Promise<ComputerRuntimeUsage> {
    this.calls.push("destroy");
    if (this.destroyError) throw this.destroyError;
    return this.usage;
  }
}

class FakeNoSubmitDriver implements NoSubmitFormDriver {
  readonly driverRelease = "test-no-submit-driver/1";
  readonly calls: string[];
  readonly inputs: Array<Parameters<NoSubmitFormDriver["fillToPreSubmitReview"]>[0]> = [];
  outcome: NoSubmitFormOutcome = Object.freeze({
    kind: "FILLED_TO_REVIEW",
    readbackHash: READBACK_HASH,
    filledFieldCount: 12,
    uploadedArtifactCount: 2,
    blockedFieldCount: 0,
  });
  error: Error | null = null;

  constructor(calls: string[] = []) {
    this.calls = calls;
  }

  async fillToPreSubmitReview(
    input: Parameters<NoSubmitFormDriver["fillToPreSubmitReview"]>[0],
  ): Promise<NoSubmitFormOutcome> {
    this.calls.push("drive");
    this.inputs.push(input);
    if (this.error) throw this.error;
    return this.outcome;
  }
}

class FakeMaterializer implements ApplicationFillExecutionMaterializer {
  readonly calls: string[];
  readonly packages: ApplicationFillExecutionPackage[] = [];
  error: Error | null = null;

  constructor(calls: string[] = []) {
    this.calls = calls;
  }

  async materialize(
    input: Parameters<ApplicationFillExecutionMaterializer["materialize"]>[0],
  ): Promise<ApplicationFillExecutionPackage> {
    this.calls.push("materialize");
    if (this.error) throw this.error;
    const value = Object.freeze({
      schemaRelease: "application-fill-execution-package/1" as const,
      authorityScope: "FILL_ONLY_NO_SUBMIT" as const,
      binding: input.binding,
      destinationUrl: input.context.destinationUrl,
      facts: Object.freeze([]),
      artifacts: Object.freeze([Object.freeze({
        artifactVersionId: IDS.revision,
        variant: "RESUME_PDF" as const,
        filename: "Resume.pdf",
        mediaType: "application/pdf",
        byteSize: 3,
        sha256: "d".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      })]),
      submitAuthorized: false as const,
    });
    this.packages.push(value);
    return value;
  }
}

test("parses only a complete immutable no-submit fill binding", () => {
  assert.deepEqual(parseApplicationFillRequestedPayload(message().payload), {
    applicationId: IDS.application,
    revisionId: IDS.revision,
    fillAttemptId: IDS.fill,
    browserRunId: IDS.run,
    authorityHash: AUTHORITY_HASH,
    disclosureManifestHash: DISCLOSURE_HASH,
  });
  assert.equal(parseApplicationFillRequestedPayload({
    ...(message().payload as Record<string, Json | undefined>),
    authority_scope: "SUBMIT_APPLICATION_ONCE",
  }), null);
});

test("coordinates a guarded fill, destroys the runtime, and persists a redacted review checkpoint", async () => {
  const calls: string[] = [];
  const database = new FakeFillDatabase();
  database.calls.push = (...values: string[]) => {
    calls.push(...values);
    return calls.length;
  };
  const runtime = new FakeRuntimeAdapter(calls);
  const driver = new FakeNoSubmitDriver(calls);
  const materializer = new FakeMaterializer(calls);

  const result = await coordinateApplicationFill(
    database,
    runtime,
    driver,
    materializer,
    message(),
    "worker-1",
  );

  assert.deepEqual(result, {
    fillAttemptId: IDS.fill,
    terminalStatus: "FILLED_TO_REVIEW",
    replayed: false,
  });
  assert.deepEqual(calls, ["load", "start", "materialize", "provision", "activate", "drive", "destroy", "complete"]);
  assert.equal(runtime.provisions[0]?.idempotencyKey, IDS.session);
  assert.deepEqual(runtime.provisions[0]?.allowedOrigins, ["https://jobs.example.com"]);
  assert.deepEqual(runtime.provisions[0]?.submissionGuard, {
    submitAuthorized: false,
    outboundSubmissionRequests: "BLOCK",
  });
  assert.equal(driver.inputs[0]?.submitAuthorized, false);
  assert.equal(driver.inputs[0]?.executionPackage.authorityScope, "FILL_ONLY_NO_SUBMIT");
  assert.equal(runtime.provisions[0]?.artifactPayloads.length, 1);
  assert.deepEqual([...materializer.packages[0]!.artifacts[0]!.bytes], [0, 0, 0]);
  assert.equal("submit" in driver, false);
  const completion = database.completions[0];
  assert.ok(completion);
  assert.equal(completion.runtimeDestroyed, true);
  assert.equal(completion.terminalStatus, "FILLED_TO_REVIEW");
  assert.equal((completion.redactedSummary as Record<string, Json>).application_submitted, false);
  assert.equal((completion.redactedSummary as Record<string, Json>).submission_request_count, 0);
  assert.equal((completion.redactedSummary as Record<string, Json>).readback_hash, READBACK_HASH);
  assert.match(completion.checkpointHash, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(completion).includes("provider-session-private"), false);
});

test("hands a review-ready guarded runtime to the long-running supervisor", async () => {
  const calls: string[] = [];
  const database = new FakeFillDatabase();
  database.calls.push = (...values: string[]) => {
    calls.push(...values);
    return calls.length;
  };
  const runtime = new FakeRuntimeAdapter(calls);
  const retained: Array<Parameters<NonNullable<
    Parameters<typeof coordinateApplicationFill>[8]
  >["retain"]>[0]> = [];

  const result = await coordinateApplicationFill(
    database,
    runtime,
    new FakeNoSubmitDriver(calls),
    new FakeMaterializer(calls),
    message(),
    "worker-1",
    ephemeralCleanFillExecutionPolicy,
    null,
    {
      async retain(input) {
        retained.push(input);
      },
      async resume() {
        throw new Error("APPLICATION_FILL_RUNTIME_NOT_RETAINED");
      },
    },
  );

  assert.deepEqual(result, {
    fillAttemptId: IDS.fill,
    terminalStatus: "FILLED_TO_REVIEW",
    replayed: false,
  });
  assert.deepEqual(calls, ["load", "start", "materialize", "provision", "activate", "drive", "complete"]);
  assert.equal(retained.length, 1);
  assert.equal(retained[0]?.computerSessionId, IDS.session);
  assert.equal(retained[0]?.fillAttemptId, IDS.fill);
  assert.equal(retained[0]?.runtimeAdapter, runtime);
  assert.equal(retained[0]?.runtime.providerSessionRef, "provider-session-private");
  assert.ok((retained[0]?.expiresAtMs ?? 0) > Date.now());
  assert.equal(runtime.calls.includes("destroy"), false);
  assert.equal(database.completions[0]?.runtimeDestroyed, false);
  assert.deepEqual(database.completions[0]?.usageSummary, {
    schema_release: "computer-runtime-usage/1",
    runtime_destroyed: false,
    wall_clock_ms: 0,
    provider_billed_ms: 0,
    uploaded_byte_count: 0,
    blocked_submission_attempt_count: 0,
    submission_request_count: 0,
    application_submitted: false,
  });
});

test("maps a candidate-only gate to TAKEOVER without preserving free-form page content", async () => {
  const database = new FakeFillDatabase();
  const runtime = new FakeRuntimeAdapter();
  const driver = new FakeNoSubmitDriver();
  driver.outcome = Object.freeze({
    kind: "TAKEOVER",
    reasonCode: "CAPTCHA_OR_OTP",
    readbackHash: READBACK_HASH,
    filledFieldCount: 8,
    uploadedArtifactCount: 2,
    blockedFieldCount: 1,
  });

  const result = await coordinateApplicationFill(
    database,
    runtime,
    driver,
    new FakeMaterializer(),
    message(),
    "worker-1",
  );

  assert.equal(result.terminalStatus, "TAKEOVER");
  const summary = database.completions[0]?.redactedSummary as Record<string, Json>;
  assert.equal(summary.reason_code, "CAPTCHA_OR_OTP");
  assert.equal(summary.application_submitted, false);
});

test("terminalizes provider and driver failures as FAILED_SAFE after best-effort teardown", async () => {
  const provisionDatabase = new FakeFillDatabase();
  const provisionRuntime = new FakeRuntimeAdapter();
  provisionRuntime.provisionError = new Error("PROVIDER_CAPACITY_UNAVAILABLE");
  const provisionResult = await coordinateApplicationFill(
    provisionDatabase,
    provisionRuntime,
    new FakeNoSubmitDriver(),
    new FakeMaterializer(),
    message(),
    "worker-1",
  );
  assert.equal(provisionResult.terminalStatus, "FAILED_SAFE");
  assert.equal(provisionDatabase.completions[0]?.runtimeDestroyed, true);
  assert.equal(provisionRuntime.calls.includes("destroy"), false);

  const driverDatabase = new FakeFillDatabase();
  const driverRuntime = new FakeRuntimeAdapter();
  const driver = new FakeNoSubmitDriver();
  driver.error = new Error("UNKNOWN_FIELD_REQUIRES_TAKEOVER");
  const driverResult = await coordinateApplicationFill(
    driverDatabase,
    driverRuntime,
    driver,
    new FakeMaterializer(),
    message(),
    "worker-1",
  );
  assert.equal(driverResult.terminalStatus, "FAILED_SAFE");
  assert.equal(driverRuntime.calls.at(-1), "destroy");
  assert.equal(driverDatabase.completions[0]?.runtimeDestroyed, true);

  const teardownDatabase = new FakeFillDatabase();
  const teardownRuntime = new FakeRuntimeAdapter();
  teardownRuntime.destroyError = new Error("PROVIDER_DESTROY_TIMEOUT");
  const teardownResult = await coordinateApplicationFill(
    teardownDatabase,
    teardownRuntime,
    new FakeNoSubmitDriver(),
    new FakeMaterializer(),
    message(),
    "worker-1",
  );
  assert.equal(teardownResult.terminalStatus, "FAILED_SAFE");
  assert.equal(teardownDatabase.completions[0]?.runtimeDestroyed, false);
  assert.equal(
    (teardownDatabase.completions[0]?.redactedSummary as Record<string, Json>).reason_code,
    "APPLICATION_FILL_RUNTIME_TEARDOWN_FAILED",
  );
});

test("does not reprovision an attempt that the database already terminalized", async () => {
  const database = new FakeFillDatabase(context("FILLED_TO_REVIEW"));
  const runtime = new FakeRuntimeAdapter();
  const driver = new FakeNoSubmitDriver();

  const materializer = new FakeMaterializer();
  const result = await coordinateApplicationFill(
    database,
    runtime,
    driver,
    materializer,
    message(),
    "worker-1",
  );

  assert.equal(result.replayed, true);
  assert.equal(result.terminalStatus, "FILLED_TO_REVIEW");
  assert.deepEqual(database.calls, ["load"]);
  assert.equal(runtime.calls.length, 0);
  assert.equal(driver.calls.length, 0);
  assert.equal(materializer.calls.length, 0);
});

test("recovers a replay only through the original database session idempotency key", async () => {
  const database = new FakeFillDatabase(context("STARTED"));
  database.startReplay = true;
  const runtime = new FakeRuntimeAdapter();
  const result = await coordinateApplicationFill(
    database,
    runtime,
    new FakeNoSubmitDriver(),
    new FakeMaterializer(),
    message(),
    "worker-1",
  );

  assert.equal(result.replayed, true);
  assert.equal(runtime.provisions.length, 0);
  assert.equal(runtime.recoveries[0]?.idempotencyKey, IDS.session);
});

test("refuses to assert no submission when the runtime reports an outbound request", async () => {
  const database = new FakeFillDatabase();
  const runtime = new FakeRuntimeAdapter();
  runtime.usage = Object.freeze({
    ...runtime.usage,
    outboundSubmissionRequestCount: 1,
  });

  await assert.rejects(
    coordinateApplicationFill(
      database,
      runtime,
      new FakeNoSubmitDriver(),
      new FakeMaterializer(),
      message(),
      "worker-1",
    ),
    /APPLICATION_FILL_SUBMISSION_STATE_UNCERTAIN/u,
  );
  assert.equal(database.completions.length, 0);
});

test("the worker releases malformed pre-start messages for bounded retry", async () => {
  const database = new FakeFillDatabase();
  database.claimed.push(message({ invalid: true }));

  const result = await runApplicationFillWorkerOnce({
    database,
    runtimeAdapter: new FakeRuntimeAdapter(),
    formDriver: new FakeNoSubmitDriver(),
    materializer: new FakeMaterializer(),
  });

  assert.deepEqual(result, { claimed: 1, completed: 0, failed: 1 });
  assert.deepEqual(database.released, [{
    errorCode: "APPLICATION_FILL_OUTBOX_PAYLOAD_INVALID",
    attemptCount: 1,
  }]);
});

test("persistent-context policy is forwarded without exposing provider context in the result", async () => {
  const database = new FakeFillDatabase();
  const runtime = new FakeRuntimeAdapter();
  const originalProvision = runtime.provision.bind(runtime);
  runtime.provision = async (request) => {
    const provisioned = await originalProvision(request);
    return Object.freeze({ ...provisioned, providerContextRef: "provider-context-private" });
  };

  await coordinateApplicationFill(
    database,
    runtime,
    new FakeNoSubmitDriver(),
    new FakeMaterializer(),
    message(),
    "worker-1",
    {
      plan: () => Object.freeze({
        executionMode: "EPHEMERAL_WITH_PERSISTENT_CONTEXT",
        browserProfileRef: IDS.profile,
        ttlSeconds: 600,
      }),
    },
  );

  assert.equal(runtime.provisions[0]?.browserProfileRef, IDS.profile);
  assert.equal(JSON.stringify(database.completions[0]).includes("provider-context-private"), false);
});

test("the recovery sweep resumes only a leased PROVISIONING session by its original idempotency key", async () => {
  const calls: string[] = [];
  const database = new FakeFillDatabase(context("STARTED"));
  database.startReplay = true;
  database.calls.push = (...values: string[]) => {
    calls.push(...values);
    return calls.length;
  };
  database.staleClaims.push(recoveryClaim("RESUME_IDEMPOTENT_PROVISION"));
  const runtime = new FakeRuntimeAdapter(calls);
  const materializer = new FakeMaterializer(calls);

  const result = await runApplicationFillRecoveryOnce({
    database,
    runtimeAdapter: runtime,
    formDriver: new FakeNoSubmitDriver(calls),
    materializer,
  });

  assert.deepEqual(result, { claimed: 1, recovered: 1, failedSafe: 0 });
  assert.deepEqual(calls, [
    "claim-stale", "load", "start", "materialize", "recover",
    "activate", "drive", "destroy", "complete",
  ]);
  assert.equal(runtime.provisions.length, 0);
  assert.equal(runtime.recoveries.length, 1);
  assert.equal(runtime.recoveries[0]?.idempotencyKey, IDS.session);
  assert.equal(runtime.recoveries[0]?.binding.computerSessionId, IDS.session);
  assert.deepEqual(runtime.recoveries[0]?.submissionGuard, {
    submitAuthorized: false,
    outboundSubmissionRequests: "BLOCK",
  });
  assert.match(database.completionWorkers[0] ?? "", /fill-recovery/u);
});

test("ACTIVE and expired stale fills fail safe without materializing, provisioning, or driving", async () => {
  for (const recoveryMode of [
    "FAIL_SAFE_DISCLOSURE_POSSIBLE",
    "FAIL_SAFE_SESSION_EXPIRED",
  ] as const) {
    const database = new FakeFillDatabase(context("STARTED"));
    database.staleClaims.push(recoveryClaim(recoveryMode));
    const runtime = new FakeRuntimeAdapter();
    const driver = new FakeNoSubmitDriver();
    const materializer = new FakeMaterializer();

    const result = await runApplicationFillRecoveryOnce({
      database,
      runtimeAdapter: runtime,
      formDriver: driver,
      materializer,
    });

    assert.deepEqual(result, { claimed: 1, recovered: 0, failedSafe: 1 });
    assert.equal(runtime.provisions.length, 0);
    assert.equal(runtime.recoveries.length, 0);
    assert.equal(driver.inputs.length, 0);
    assert.equal(materializer.calls.length, 0);
    assert.equal(database.completions[0]?.terminalStatus, "FAILED_SAFE");
    assert.equal(database.completions[0]?.runtimeDestroyed, false);
    assert.equal(
      (database.completions[0]?.redactedSummary as Record<string, Json>).application_submitted,
      false,
    );
    assert.equal(
      (database.completions[0]?.redactedSummary as Record<string, Json>).telemetry_available,
      false,
    );
  }
});

test("recovery refuses a database session binding mismatch before bytes or a runtime are released", async () => {
  const database = new FakeFillDatabase(context("STARTED"));
  database.startReplay = true;
  database.staleClaims.push(recoveryClaim(
    "RESUME_IDEMPOTENT_PROVISION",
    IDS.otherSession,
  ));
  const runtime = new FakeRuntimeAdapter();
  const materializer = new FakeMaterializer();

  await assert.rejects(
    runApplicationFillRecoveryOnce({
      database,
      runtimeAdapter: runtime,
      formDriver: new FakeNoSubmitDriver(),
      materializer,
    }),
    /APPLICATION_FILL_RECOVERY_SESSION_MISMATCH/u,
  );
  assert.equal(runtime.provisions.length, 0);
  assert.equal(runtime.recoveries.length, 0);
  assert.equal(materializer.calls.length, 0);
});

test("idempotent provider recovery failure never falls back to fresh provisioning", async () => {
  const database = new FakeFillDatabase(context("STARTED"));
  database.startReplay = true;
  database.staleClaims.push(recoveryClaim("RESUME_IDEMPOTENT_PROVISION"));
  const runtime = new FakeRuntimeAdapter();
  runtime.recoveryError = new Error("EXACT_PROVIDER_SESSION_UNAVAILABLE");

  const result = await runApplicationFillRecoveryOnce({
    database,
    runtimeAdapter: runtime,
    formDriver: new FakeNoSubmitDriver(),
    materializer: new FakeMaterializer(),
  });

  assert.deepEqual(result, { claimed: 1, recovered: 0, failedSafe: 1 });
  assert.equal(runtime.recoveries.length, 1);
  assert.equal(runtime.provisions.length, 0);
  assert.equal(database.completions[0]?.terminalStatus, "FAILED_SAFE");
  assert.equal(
    (database.completions[0]?.redactedSummary as Record<string, Json>).reason_code,
    "EXACT_PROVIDER_SESSION_UNAVAILABLE",
  );
});
