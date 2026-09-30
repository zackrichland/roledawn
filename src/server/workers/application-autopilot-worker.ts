import { createHash, randomUUID } from "node:crypto";

import type { AgentQuestionAnswer, AgentQuestionDescriptor, ApplicationAgentQuestionRepository } from "../../domain/application-agent-questions.ts";
import type { ApplicationAutopilotClaim, ApplicationAutopilotRepository, ApplicationAutopilotSubmitPermit, AutopilotJsonObject } from "../../domain/application-autopilot.ts";
import type { Json } from "../../lib/supabase/database.types.ts";
import { eraseApplicationFillExecutionPackage, type ApplicationFillExecutionMaterializer, type ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import type { ApplicationDeliveryRuntime, ApplicationDeliveryRuntimeAdapter } from "./application-delivery-runtime.ts";
import type { Page } from "playwright-core";
import type { StandingAnswerResolver } from "./standing-answers.ts";
import { errorCode, errorDetail } from "./worker-events.ts";

export type DeliveryWorkerReceipt = Readonly<{
  url: string; observedAt: string; bodyHash: string; requestFingerprint: string; attemptId: string;
}>;
export type DeliveryWorkerOutcome = Readonly<{
  kind: "CONFIRMED" | "QUESTIONS_REQUIRED" | "TAKEOVER" | "UNCERTAIN" | "FAILED_SAFE" | "NOT_ACCEPTED";
  reasonCode?: string; receipt?: DeliveryWorkerReceipt; attemptId?: string;
  /** Error class and short message behind a stop (D-116). */
  detail?: Readonly<Record<string, string>>;
  /** Milliseconds per delivery phase, recorded with the send's worker event. */
  timings?: Readonly<Record<string, number>>;
  questions?: readonly AgentQuestionDescriptor[];
}>;
export type DeliveryWorkerDriveInput = Readonly<{
  claim: ApplicationAutopilotClaim;
  page: Page;
  executionPackage: ApplicationFillExecutionPackage;
  questions: ApplicationAgentQuestionRepository;
  signal: AbortSignal;
  begin(input: Readonly<{ reviewHash: string; requestFingerprint: string; review: Record<string, unknown> }>): Promise<ApplicationAutopilotSubmitPermit>;
  checkpoint(state: Record<string, unknown>): Promise<void>;
}>;

function jsonObject(value: Record<string, unknown>): AutopilotJsonObject {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 262_144) throw new Error("DELIVERY_CHECKPOINT_TOO_LARGE");
  return JSON.parse(encoded) as AutopilotJsonObject;
}
function safeCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/u.test(error.message)
    ? error.message : "APPLICATION_DELIVERY_FAILED";
}
function receiptEvidence(receipt: DeliveryWorkerReceipt, claim: ApplicationAutopilotClaim) {
  if (!/^[a-f0-9]{64}$/u.test(receipt.bodyHash) || !/^[a-f0-9]{64}$/u.test(receipt.requestFingerprint) ||
      !Number.isFinite(Date.parse(receipt.observedAt)) ||
      new URL(receipt.url).origin !== new URL(claim.destinationUrl).origin) {
    throw new Error("DELIVERY_RECEIPT_INVALID");
  }
  const evidenceManifest = jsonObject({ schemaRelease: "application-delivery-receipt/1", ...receipt, autopilotId: claim.id, revisionId: claim.revisionId, packetHash: claim.packetHash });
  return {
    confirmationKind: "PORTAL" as const,
    confirmationReference: receipt.url,
    evidenceManifest,
    receiptHash: createHash("sha256").update(JSON.stringify(evidenceManifest)).digest("hex"),
    confirmedAt: receipt.observedAt,
  };
}

/** Coordinates one durable job. Model output never directly changes submission status. */
export async function coordinateApplicationAutopilot(input: Readonly<{
  claim: ApplicationAutopilotClaim;
  repository: ApplicationAutopilotRepository;
  runtimeAdapter: ApplicationDeliveryRuntimeAdapter;
  materializer: ApplicationFillExecutionMaterializer;
  drive(task: DeliveryWorkerDriveInput): Promise<DeliveryWorkerOutcome>;
  /** Maps new questions to the candidate's standing answers (D-117). */
  standingAnswers?: StandingAnswerResolver;
  signal?: AbortSignal;
}>): Promise<Readonly<{ kind: DeliveryWorkerOutcome["kind"]; cleanupPending: boolean }>> {
  const { claim, repository } = input;
  const signal = input.signal ?? AbortSignal.timeout(240_000);
  let execution: ApplicationFillExecutionPackage | null = null;
  let runtime: ApplicationDeliveryRuntime | null = null;
  const submission: { permit: ApplicationAutopilotSubmitPermit | null; authorizationRequested: boolean } = { permit: null, authorizationRequested: false };
  let outcome: DeliveryWorkerOutcome = { kind: "FAILED_SAFE", reasonCode: "APPLICATION_DELIVERY_FAILED" };
  let cleanupPending = false;
  const timings = { started: Date.now(), browserMs: null as number | null, driveMs: null as number | null };
  const requested = new Map<string, AgentQuestionDescriptor>();
  try {
    await repository.assertLease(claim, claim.mode === "FILL");
    if (signal.aborted) throw new Error("APPLICATION_DELIVERY_CANCELED");
    // A driver-observed receipt persisted before a crash can be reconciled without
    // opening a fresh browser or replaying a submission.
    const saved = claim.checkpoint.observedReceipt;
    if (claim.mode === "RECONCILE" && saved && typeof saved === "object" && !Array.isArray(saved)) {
      const receipt = saved as unknown as DeliveryWorkerReceipt;
      if (receipt.attemptId !== claim.attemptId) throw new Error("DELIVERY_RECEIPT_ATTEMPT_MISMATCH");
      await repository.finish(claim, { outcome: "CONFIRMED", receipt: receiptEvidence(receipt, claim) });
      return { kind: "CONFIRMED", cleanupPending: false };
    }
    if (claim.mode === "RECONCILE" && !claim.runtimeReference) {
      await repository.finish(claim, { outcome: "UNCERTAIN", failureCode: "DELIVERY_RECEIPT_RECONCILIATION_REQUIRED" });
      return { kind: "UNCERTAIN", cleanupPending: false };
    }
    const binding = {
      workspaceId: claim.workspaceId, candidateId: claim.candidateId,
      applicationId: claim.applicationId, revisionId: claim.revisionId,
      // Reuse the byte/fact validation shape only. These IDs never enter fill-only RPCs.
      fillAttemptId: claim.id, computerSessionId: claim.id,
    };
    execution = await input.materializer.materialize({
      context: { ...binding, destinationUrl: claim.destinationUrl, artifactManifest: claim.artifactManifest, disclosureManifest: claim.disclosureManifest },
      binding,
    });
    const oldKey = claim.checkpoint.runtimeProvisionKey;
    const newIntent = typeof oldKey !== "string" || claim.checkpoint.runtimeState === "RELEASED";
    let provisionKey = newIntent ? randomUUID() : oldKey;
    if (newIntent) await repository.checkpoint(claim, { stage: "PROVISIONING", data: { runtimeProvisionKey: provisionKey, runtimeState: "INTENT" } });
    const onBound = async (sessionId: string, expiresAt: string) => {
        await repository.bindRuntime(claim, sessionId);
        await repository.checkpoint(claim, { stage: "BROWSER_BOUND", data: { runtimeProvisionKey: provisionKey, runtimeState: "BOUND", browserExpiresAt: expiresAt } });
    };
    const browserStarted = Date.now();
    try {
      runtime = await input.runtimeAdapter.open({
        provisionKey, runtimeReference: claim.runtimeReference,
        allowCreate: newIntent && claim.mode === "FILL", onBound,
      });
    } catch (error) {
      // An expired pre-submit browser can be rebuilt from frozen facts and saved
      // answers. Once an attempt exists, recovery is strictly read-only.
      if (safeCode(error) !== "DELIVERY_RUNTIME_EXPIRED" || claim.mode !== "FILL") throw error;
      await repository.bindRuntime(claim, null);
      provisionKey = randomUUID();
      await repository.checkpoint(claim, { stage: "PROVISIONING", data: { runtimeProvisionKey: provisionKey, runtimeState: "INTENT" } });
      runtime = await input.runtimeAdapter.open({ provisionKey, runtimeReference: null, allowCreate: true, onBound });
    }
    const answers: AgentQuestionAnswer[] = [...await repository.readAllAnswers(claim)];
    // Each askable field is looked up in the candidate's remembered answers at
    // most once per run, so repeat questions are filled in this same pass.
    const remembered = new Set<string>();
    let standing: ReturnType<NonNullable<ApplicationAutopilotRepository["readStandingAnswers"]>> | null = null;
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ binding: actual, questions: fields }) {
        if (actual.applicationId !== claim.applicationId || actual.revisionId !== claim.revisionId || actual.fillAttemptId !== claim.id) throw new Error("DELIVERY_QUESTION_BINDING_MISMATCH");
        const unanswered = fields.filter(field => !remembered.has(field.fingerprint) &&
          !answers.some(answer => answer.fingerprint === field.fingerprint && answer.fieldId === field.fieldId));
        if (unanswered.length && repository.prefillAnswers && claim.mode === "FILL") {
          unanswered.forEach(field => remembered.add(field.fingerprint));
          answers.push(...await repository.prefillAnswers(claim, unanswered));
        }
        return answers.filter(answer => fields.some(field => field.fingerprint === answer.fingerprint && field.fieldId === answer.fieldId));
      },
      async resolveSavedAnswers({ binding: actual, questions: fields }) {
        if (actual.applicationId !== claim.applicationId || actual.revisionId !== claim.revisionId || actual.fillAttemptId !== claim.id) throw new Error("DELIVERY_QUESTION_BINDING_MISMATCH");
        const pending = fields.filter(field => !answers.some(answer => answer.fingerprint === field.fingerprint && answer.fieldId === field.fieldId));
        if (!pending.length || claim.mode !== "FILL" || !input.standingAnswers || !execution || !repository.readStandingAnswers || !repository.recordStandingAnswers) return [];
        const started = Date.now();
        try {
          standing ??= repository.readStandingAnswers(claim);
          const proposals = await input.standingAnswers.resolve({ questions: pending, context: await standing, facts: execution.facts, signal });
          let recorded: readonly AgentQuestionAnswer[] = [];
          let refused: string | null = null;
          if (proposals.length) {
            try { recorded = await repository.recordStandingAnswers(claim, proposals); }
            catch (error) {
              // One refused answer never costs the others: record them one at a time.
              refused = errorCode(error, "APPLICATION_DELIVERY_FAILED");
              const kept: AgentQuestionAnswer[] = [];
              for (const proposal of proposals) {
                try { kept.push(...await repository.recordStandingAnswers(claim, [proposal])); } catch { /* left for the candidate */ }
              }
              recorded = kept;
            }
          }
          answers.push(...recorded);
          await repository.recordEvent?.(claim, { stage: "standing_answers", outcome: recorded.length ? "OK" : "SKIPPED", code: refused,
            detail: { questions: String(pending.length), proposed: String(proposals.length), answered: String(recorded.length) }, durationMs: Date.now() - started });
          return recorded;
        } catch (error) {
          // A failed lookup never fails the send: the questions go to the candidate.
          standing = null;
          if (signal.aborted) throw error;
          await repository.recordEvent?.(claim, { stage: "standing_answers", outcome: "FAILED", code: errorCode(error, "APPLICATION_DELIVERY_FAILED"), detail: errorDetail(error), durationMs: Date.now() - started });
          return [];
        }
      },
      async requestQuestions({ binding: actual, questions: fields }) {
        if (actual.applicationId !== claim.applicationId || actual.revisionId !== claim.revisionId || actual.fillAttemptId !== claim.id) throw new Error("DELIVERY_QUESTION_BINDING_MISMATCH");
        await repository.assertLease(claim);
        for (const field of fields) requested.set(field.fingerprint, field);
        return fields.map(field => ({ ...field, id: randomUUID(), status: "OPEN" as const }));
      },
    };
    timings.browserMs = Date.now() - browserStarted;
    const driveStarted = Date.now();
    outcome = await input.drive({
      claim, page: runtime.page, executionPackage: execution, questions, signal,
      async begin(request) {
        if (signal.aborted || claim.mode !== "FILL") throw new Error("DELIVERY_SUBMIT_NOT_AUTHORIZED");
        // Exact final readback found no unresolved fields. Previously asked
        // questions can become obsolete after parser omission or evidence-led
        // drafting; supersede them under this lease before sealing, not by
        // fabricating candidate answers. Answered questions remain intact.
        await repository.requestQuestions(claim, []);
        const sealHash = await repository.seal(claim, {
          diff: jsonObject(request.review), readbackHash: request.reviewHash,
          requestFingerprint: request.requestFingerprint, destinationUrl: claim.destinationUrl,
        });
        submission.authorizationRequested = true;
        submission.permit = await repository.beginSubmit(claim, { sealHash, requestFingerprint: request.requestFingerprint, adapterRelease: "application-delivery/1" });
        return submission.permit;
      },
      async checkpoint(state) {
        await repository.checkpoint(claim, { stage: "DELIVERY_PROGRESS", data: { delivery: jsonObject(state) as Json } });
      },
    });
    timings.driveMs = Date.now() - driveStarted;
    if (outcome.kind === "CONFIRMED") {
      if (!outcome.receipt || outcome.receipt.attemptId !== (submission.permit?.attemptId ?? claim.attemptId)) throw new Error("DELIVERY_RECEIPT_ATTEMPT_MISMATCH");
      const receipt = receiptEvidence(outcome.receipt, claim);
      await repository.checkpoint(claim, { stage: "RECEIPT_OBSERVED", data: { observedReceipt: jsonObject({ ...outcome.receipt }) as Json } });
      await repository.finish(claim, { outcome: "CONFIRMED", receipt });
    } else if (outcome.kind === "QUESTIONS_REQUIRED" && requested.size > 0 && !submission.permit) {
      await repository.requestQuestions(claim, (outcome.questions ?? [...requested.values()]).slice(0, 24));
    } else if (outcome.kind === "NOT_ACCEPTED" && submission.permit) {
      // The employer refused this attempt outright; the database closes it and queues the send again.
      await repository.finish(claim, { outcome: "NOT_ACCEPTED", failureCode: outcome.reasonCode ?? "DELIVERY_EMAIL_VERIFICATION_TIMEOUT" });
    } else {
      await repository.finish(claim, { outcome: outcome.kind === "UNCERTAIN" || submission.permit || claim.attemptId ? "UNCERTAIN" : "FAILED_SAFE", failureCode: outcome.reasonCode ?? "APPLICATION_DELIVERY_STOPPED" });
    }
  } catch (error) {
    // The database also checks whether beginSubmit committed when its response
    // was lost. A client-side exception cannot erase that durable attempt.
    const kind = submission.permit || claim.attemptId ? "UNCERTAIN" : "FAILED_SAFE";
    outcome = { kind: submission.authorizationRequested ? "UNCERTAIN" : kind, reasonCode: safeCode(error), detail: errorDetail(error) };
    try { await repository.finish(claim, { outcome: kind, failureCode: safeCode(error) }); }
    catch { /* A canceled/expired lease is reconciled by the next durable claim. */ }
  } finally {
    if (runtime) {
      try {
        await runtime.release();
        await repository.bindRuntime(claim, null);
      } catch { cleanupPending = true; }
    }
    if (execution) eraseApplicationFillExecutionPackage(execution);
  }
  await repository.recordEvent?.(claim, {
    stage: claim.mode === "RECONCILE" ? "reconcile" : "send",
    outcome: outcome.kind === "CONFIRMED" ? "OK" : outcome.kind === "QUESTIONS_REQUIRED" ? "INFO" : "FAILED",
    code: outcome.reasonCode ?? null,
    detail: { kind: outcome.kind, ...(outcome.detail ?? {}),
      ...Object.fromEntries(Object.entries(outcome.timings ?? {}).filter(([key, value]) => /^[a-z]+Ms$/u.test(key) && Number.isFinite(value)).map(([key, value]) => [key, String(Math.round(value))])),
      ...(timings.browserMs !== null ? { browserMs: String(timings.browserMs) } : {}),
      ...(timings.driveMs !== null ? { driveMs: String(timings.driveMs) } : {}), ...(cleanupPending ? { cleanupPending: "true" } : {}) },
    durationMs: Date.now() - timings.started,
  });
  return { kind: outcome.kind, cleanupPending };
}
