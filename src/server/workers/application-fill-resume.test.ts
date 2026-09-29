import assert from "node:assert/strict";
import test from "node:test";

import type { Json } from "../../lib/supabase/database.types.ts";
import type {
  ApplicationFillExecutionMaterializer,
  ApplicationFillExecutionPackage,
} from "./application-fill-materializer.ts";
import type {
  ApplicationFillAuthorizationContext,
  ApplicationFillOutboxMessage,
  ApplicationFillRuntimeSupervisor,
  NoSubmitFormDriver,
  NoSubmitFormOutcome,
} from "./application-fill.ts";
import {
  APPLICATION_FILL_RESUME_TOPIC,
  coordinateApplicationFillResume,
  parseApplicationFillResumeRequestedPayload,
  runApplicationFillResumeWorkerOnce,
  type ApplicationFillResumeCompletion,
  type ApplicationFillResumeContext,
  type ApplicationFillResumeDatabase,
} from "./application-fill-resume.ts";

const IDS = Object.freeze({
  workspace: "10000000-0000-4000-8000-000000000001",
  candidate: "20000000-0000-4000-8000-000000000002",
  application: "30000000-0000-4000-8000-000000000003",
  revision: "40000000-0000-4000-8000-000000000004",
  fill: "50000000-0000-4000-8000-000000000005",
  run: "60000000-0000-4000-8000-000000000006",
  outbox: "70000000-0000-4000-8000-000000000007",
  session: "80000000-0000-4000-8000-000000000008",
  resume: "90000000-0000-4000-8000-000000000009",
});

const AUTHORITY_HASH = "a".repeat(64);
const DISCLOSURE_HASH = "b".repeat(64);
const READBACK_HASH = "c".repeat(64);

function authorization(): ApplicationFillAuthorizationContext {
  return Object.freeze({
    workspaceId: IDS.workspace,
    candidateId: IDS.candidate,
    applicationId: IDS.application,
    revisionId: IDS.revision,
    fillAttemptId: IDS.fill,
    browserRunId: IDS.run,
    status: "TAKEOVER" as const,
    destinationUrl: "https://boards.greenhouse.io/example/jobs/1",
    authorityHash: AUTHORITY_HASH,
    disclosureManifestHash: DISCLOSURE_HASH,
    artifactManifest: [],
    disclosureManifest: { policy: { submit_authorized: false } },
  });
}

function resumeContext(): ApplicationFillResumeContext {
  return Object.freeze({
    resumeAttemptId: IDS.resume,
    resumeStatus: "QUEUED" as const,
    computerSessionId: IDS.session,
    authorization: authorization(),
  });
}

function message(payloadOverride: Json | null = null): ApplicationFillOutboxMessage {
  return Object.freeze({
    outboxId: IDS.outbox,
    topic: APPLICATION_FILL_RESUME_TOPIC,
    attemptCount: 1,
    payload: payloadOverride ?? {
      application_id: IDS.application,
      revision_id: IDS.revision,
      fill_attempt_id: IDS.fill,
      computer_session_id: IDS.session,
      resume_attempt_id: IDS.resume,
      authority_hash: AUTHORITY_HASH,
      disclosure_manifest_hash: DISCLOSURE_HASH,
      authority_scope: "FILL_ONLY_NO_SUBMIT",
    },
  });
}

class FakeDatabase implements ApplicationFillResumeDatabase {
  readonly completions: ApplicationFillResumeCompletion[] = [];
  readonly claimed: ApplicationFillOutboxMessage[] = [];
  readonly released: string[] = [];
  context = resumeContext();

  async claim(): Promise<readonly ApplicationFillOutboxMessage[]> {
    return this.claimed;
  }

  async loadContext(): Promise<ApplicationFillResumeContext> {
    return this.context;
  }

  async complete(input: ApplicationFillResumeCompletion): Promise<void> {
    this.completions.push(input);
  }

  async releaseFailure(input: Readonly<{ errorCode: string }>): Promise<boolean> {
    this.released.push(input.errorCode);
    return true;
  }
}

function executionPackage(bytes: Uint8Array): ApplicationFillExecutionPackage {
  return Object.freeze({
    schemaRelease: "application-fill-execution-package/1" as const,
    authorityScope: "FILL_ONLY_NO_SUBMIT" as const,
    binding: Object.freeze({
      workspaceId: IDS.workspace,
      candidateId: IDS.candidate,
      applicationId: IDS.application,
      revisionId: IDS.revision,
      fillAttemptId: IDS.fill,
      computerSessionId: IDS.session,
    }),
    destinationUrl: authorization().destinationUrl,
    facts: Object.freeze([]),
    artifacts: Object.freeze([{
      artifactVersionId: IDS.revision,
      variant: "RESUME_PDF" as const,
      filename: "resume.pdf",
      mediaType: "application/pdf",
      byteSize: bytes.byteLength,
      sha256: "d".repeat(64),
      bytes,
    }]),
    submitAuthorized: false as const,
  });
}

test("parses only exact fill-only continuation payloads", () => {
  assert.equal(parseApplicationFillResumeRequestedPayload(message().payload)?.resumeAttemptId, IDS.resume);
  assert.equal(parseApplicationFillResumeRequestedPayload({
    ...(message().payload as Record<string, Json>),
    authority_scope: "SUBMIT_APPLICATION_ONCE",
  }), null);
});

test("continues the exact retained runtime and records zero-submit review completion", async () => {
  const database = new FakeDatabase();
  const bytes = new Uint8Array([1, 2, 3]);
  const materializer: ApplicationFillExecutionMaterializer = {
    async materialize() { return executionPackage(bytes); },
  };
  const supervisor: ApplicationFillRuntimeSupervisor = {
    async retain() { throw new Error("UNUSED"); },
    async resume(input) {
      assert.equal(input.computerSessionId, IDS.session);
      assert.equal(input.fillAttemptId, IDS.fill);
      return input.run(Object.freeze({
        handle: Object.freeze({ retained: true }),
        providerAdapter: "test-provider",
        providerSessionRef: "private-ref",
        providerContextRef: null,
      }));
    },
  };
  const driver: NoSubmitFormDriver = {
    driverRelease: "test-driver/1",
    async fillToPreSubmitReview(input) {
      assert.equal(input.submitAuthorized, false);
      assert.deepEqual(input.runtimeHandle, { retained: true });
      return Object.freeze({
        kind: "FILLED_TO_REVIEW" as const,
        readbackHash: READBACK_HASH,
        filledFieldCount: 8,
        uploadedArtifactCount: 1,
        blockedFieldCount: 1,
      });
    },
  };

  const result = await coordinateApplicationFillResume(
    database,
    supervisor,
    driver,
    materializer,
    message(),
    "test-worker",
  );

  assert.equal(result.terminalStatus, "FILLED_TO_REVIEW");
  assert.equal(database.completions.length, 1);
  assert.deepEqual(database.completions[0]?.redactedSummary, {
    schema_release: "application-fill-resume-result/1",
    resume_attempt_id: IDS.resume,
    terminal_status: "FILLED_TO_REVIEW",
    reason_code: null,
    readback_hash: READBACK_HASH,
    filled_field_count: 8,
    uploaded_artifact_count: 1,
    blocked_field_count: 1,
    authority_scope: "FILL_ONLY_NO_SUBMIT",
    submission_request_count: 0,
    application_submitted: false,
    driver_release: "test-driver/1",
  });
  assert.deepEqual([...bytes], [0, 0, 0]);
  assert.equal(JSON.stringify(database.completions).includes("private-ref"), false);
});

test("records a fail-safe continuation when the retained runtime is unavailable", async () => {
  const database = new FakeDatabase();
  const materializer: ApplicationFillExecutionMaterializer = {
    async materialize() { return executionPackage(new Uint8Array([1])); },
  };
  const supervisor: ApplicationFillRuntimeSupervisor = {
    async retain() { throw new Error("UNUSED"); },
    async resume() { throw new Error("APPLICATION_FILL_RUNTIME_NOT_RETAINED"); },
  };
  const driver: NoSubmitFormDriver = {
    driverRelease: "test-driver/1",
    async fillToPreSubmitReview(): Promise<NoSubmitFormOutcome> {
      throw new Error("UNREACHABLE");
    },
  };

  const result = await coordinateApplicationFillResume(
    database,
    supervisor,
    driver,
    materializer,
    message(),
    "test-worker",
  );

  assert.equal(result.terminalStatus, "FAILED_SAFE");
  assert.equal(
    (database.completions[0]?.redactedSummary as Record<string, Json>).reason_code,
    "APPLICATION_FILL_RUNTIME_NOT_RETAINED",
  );
  assert.equal(
    (database.completions[0]?.redactedSummary as Record<string, Json>).application_submitted,
    false,
  );
});

test("worker releases malformed claims for bounded retry without running a browser", async () => {
  const database = new FakeDatabase();
  database.claimed.push(message({ invalid: true }));
  const supervisor: ApplicationFillRuntimeSupervisor = {
    async retain() { throw new Error("UNUSED"); },
    async resume() { throw new Error("UNREACHABLE"); },
  };
  const result = await runApplicationFillResumeWorkerOnce({
    database,
    materializer: { async materialize() { throw new Error("UNREACHABLE"); } },
    runtimeSupervisor: supervisor,
    formDriver: {
      driverRelease: "test-driver/1",
      async fillToPreSubmitReview() { throw new Error("UNREACHABLE"); },
    },
  });

  assert.deepEqual(result, { claimed: 1, completed: 0, failed: 1 });
  assert.deepEqual(database.released, ["APPLICATION_FILL_RESUME_OUTBOX_PAYLOAD_INVALID"]);
});
