import { createHash, randomUUID } from "node:crypto";

import type { AgentQuestionDescriptor, ApplicationAgentQuestionRepository } from "../../domain/application-agent-questions.ts";
import type { ApplicationAutopilotClaim, ApplicationAutopilotRepository, ApplicationAutopilotSubmitPermit, AutopilotJsonObject } from "../../domain/application-autopilot.ts";
import type { Json } from "../../lib/supabase/database.types.ts";
import { eraseApplicationFillExecutionPackage, type ApplicationFillExecutionMaterializer, type ApplicationFillExecutionPackage } from "./application-fill-materializer.ts";
import type { ApplicationDeliveryRuntime, ApplicationDeliveryRuntimeAdapter } from "./application-delivery-runtime.ts";
import type { Page } from "playwright-core";

export type DeliveryWorkerReceipt = Readonly<{
  url: string; observedAt: string; bodyHash: string; requestFingerprint: string; attemptId: string;
}>;
export type DeliveryWorkerOutcome = Readonly<{
  kind: "CONFIRMED" | "QUESTIONS_REQUIRED" | "TAKEOVER" | "UNCERTAIN" | "FAILED_SAFE" | "NOT_ACCEPTED";
  reasonCode?: string; receipt?: DeliveryWorkerReceipt; attemptId?: string;
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
  signal?: AbortSignal;
}>): Promise<Readonly<{ kind: DeliveryWorkerOutcome["kind"]; cleanupPending: boolean }>> {
  const { claim, repository } = input;
  const signal = input.signal ?? AbortSignal.timeout(240_000);
  let execution: ApplicationFillExecutionPackage | null = null;
  let runtime: ApplicationDeliveryRuntime | null = null;
  const submission: { permit: ApplicationAutopilotSubmitPermit | null; authorizationRequested: boolean } = { permit: null, authorizationRequested: false };
  let outcome: DeliveryWorkerOutcome = { kind: "FAILED_SAFE", reasonCode: "APPLICATION_DELIVERY_FAILED" };
  let cleanupPending = false;
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
    const answers = await repository.readAllAnswers(claim);
    const questions: ApplicationAgentQuestionRepository = {
      async loadAnswers({ binding: actual, questions: fields }) {
        if (actual.applicationId !== claim.applicationId || actual.revisionId !== claim.revisionId || actual.fillAttemptId !== claim.id) throw new Error("DELIVERY_QUESTION_BINDING_MISMATCH");
        return answers.filter(answer => fields.some(field => field.fingerprint === answer.fingerprint && field.fieldId === answer.fieldId));
      },
      async requestQuestions({ binding: actual, questions: fields }) {
        if (actual.applicationId !== claim.applicationId || actual.revisionId !== claim.revisionId || actual.fillAttemptId !== claim.id) throw new Error("DELIVERY_QUESTION_BINDING_MISMATCH");
        await repository.assertLease(claim);
        for (const field of fields) requested.set(field.fingerprint, field);
        return fields.map(field => ({ ...field, id: randomUUID(), status: "OPEN" as const }));
      },
    };
    outcome = await input.drive({
      claim, page: runtime.page, executionPackage: execution, questions, signal,
      async begin(request) {
        if (signal.aborted || claim.mode !== "FILL") throw new Error("DELIVERY_SUBMIT_NOT_AUTHORIZED");
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
    outcome = { kind: submission.authorizationRequested ? "UNCERTAIN" : kind, reasonCode: safeCode(error) };
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
  return { kind: outcome.kind, cleanupPending };
}
