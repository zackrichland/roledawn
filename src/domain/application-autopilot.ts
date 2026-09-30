import type { AgentQuestionAnswer, AgentQuestionDescriptor, ApplicationAgentQuestion, StandingAnswerContext, StandingAnswerProposal } from "./application-agent-questions.ts";
import type { Json } from "../lib/supabase/database.types.ts";

export type AutopilotJsonObject = Readonly<{ [key: string]: Json | undefined }>;
export const APPLICATION_AUTOPILOT_STATUSES = ["QUEUED", "RUNNING", "WAITING_ANSWERS", "PAUSED", "SUBMITTING", "UNCERTAIN", "RECONCILING", "CONFIRMED", "CANCELED", "FAILED_SAFE"] as const;
export type ApplicationAutopilotStatus = (typeof APPLICATION_AUTOPILOT_STATUSES)[number];
export type ApplicationAutopilotLease = Readonly<{ id: string; leaseToken: string }>;
export type ApplicationAutopilotClaim = ApplicationAutopilotLease & Readonly<{
  workspaceId: string; candidateId: string; applicationId: string; revisionId: string;
  packetHash: string; destinationUrl: string; artifactManifest: Json; disclosureManifest: Json;
  status: "RUNNING" | "RECONCILING"; mode: "FILL" | "RECONCILE";
  checkpoint: AutopilotJsonObject; runtimeReference: string | null;
  leaseExpiresAt: string; attemptId: string | null; sealedDiffHash: string | null;
}>;
export type DelegateApplicationAutopilotCommand = Readonly<{
  commandId: string; applicationId: string; expectedAggregateVersion: number; revisionId: string; packetHash: string;
}>;
/** The employer emailed the candidate a code during the final send. */
export type ApplicationAutopilotVerificationRequest = Readonly<{ id: string; recipient: string; retry: boolean; expiresAt: string }>;
export type ApplicationAutopilotView = Readonly<{
  id: string; applicationId: string; revisionId: string; status: ApplicationAutopilotStatus;
  version: number; questions: readonly ApplicationAgentQuestion[]; failureCode: string | null;
  verification?: ApplicationAutopilotVerificationRequest | null;
  browserVerification?: Readonly<{ expiresAt: string }> | null;
}>;
export type SaveAutopilotAnswersCommand = Readonly<{
  commandId: string; id: string; expectedVersion: number;
  answers: readonly Readonly<{ questionId: string; fingerprint: string; value: string | boolean | readonly string[] }>[];
}>;
export type ControlAutopilotCommand = Readonly<{
  commandId: string; id: string; expectedVersion: number; action: "PAUSE" | "RESUME" | "CANCEL";
}>;
export type ApplicationAutopilotSeal = Readonly<{
  diff: AutopilotJsonObject; readbackHash: string; requestFingerprint: string; destinationUrl: string;
}>;
export type ApplicationAutopilotSubmitPermit = Readonly<{
  attemptId: string; idempotencyKey: string; sealHash: string; requestFingerprint: string;
}>;
export type ApplicationAutopilotReceipt = Readonly<{
  confirmationKind: "PORTAL" | "EMAIL" | "EXTERNAL_RECEIPT";
  confirmationReference: string; evidenceManifest: AutopilotJsonObject;
  receiptHash: string; confirmedAt: string;
}>;
export type ApplicationAutopilotCompletion = Readonly<{
  /** NOT_ACCEPTED: the employer explicitly refused this attempt (its emailed-code challenge went unmet); the send may run again. */
  outcome: "CONFIRMED" | "UNCERTAIN" | "FAILED_SAFE" | "NOT_ACCEPTED";
  failureCode?: string; receipt?: ApplicationAutopilotReceipt;
}>;
export interface ApplicationAutopilotRepository {
  claim(workerId: string, leaseSeconds?: number, targetId?: string): Promise<ApplicationAutopilotClaim | null>;
  assertLease(lease: ApplicationAutopilotLease, mutating?: boolean): Promise<void>;
  checkpoint(lease: ApplicationAutopilotLease, input: Readonly<{ stage: string; data: AutopilotJsonObject }>): Promise<void>;
  bindRuntime(lease: ApplicationAutopilotLease, runtimeReference: string | null): Promise<void>;
  setAgentSession(lease: ApplicationAutopilotLease, sessionId: string | null): Promise<void>;
  requestQuestions(lease: ApplicationAutopilotLease, questions: readonly AgentQuestionDescriptor[]): Promise<void>;
  readAllAnswers(lease: ApplicationAutopilotLease): Promise<readonly AgentQuestionAnswer[]>;
  /** One observability event for this send (D-116); best effort, never throws. */
  recordEvent?(lease: ApplicationAutopilotClaim, event: Readonly<{
    stage: string; outcome: "OK" | "FAILED" | "SKIPPED" | "INFO"; code?: string | null;
    detail?: Readonly<Record<string, unknown>>; durationMs?: number | null;
  }>): Promise<void>;
  /** Remembered answers for these askable fields, stored as this send's own answers (D-115). */
  prefillAnswers?(lease: ApplicationAutopilotLease, questions: readonly AgentQuestionDescriptor[]): Promise<readonly AgentQuestionAnswer[]>;
  /** The candidate's standing answers and the job (D-117). */
  readStandingAnswers?(lease: ApplicationAutopilotLease): Promise<StandingAnswerContext>;
  /** Records answers derived from standing answers, labeled STANDING with their basis (D-117). */
  recordStandingAnswers?(lease: ApplicationAutopilotLease, answers: readonly StandingAnswerProposal[]): Promise<readonly AgentQuestionAnswer[]>;
  seal(lease: ApplicationAutopilotLease, input: ApplicationAutopilotSeal): Promise<string>;
  beginSubmit(lease: ApplicationAutopilotLease, input: Readonly<{ sealHash: string; requestFingerprint: string; adapterRelease: string }>): Promise<ApplicationAutopilotSubmitPermit>;
  finish(lease: ApplicationAutopilotLease, input: ApplicationAutopilotCompletion): Promise<void>;
}

export class ApplicationAutopilotError extends Error {
  readonly code: string;
  constructor(code: string, message = "This application could not be updated. Reload to check its status.") {
    super(message); this.name = "ApplicationAutopilotError"; this.code = code;
  }
}

export const AUTOPILOT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const AUTOPILOT_HASH = /^[0-9a-f]{64}$/u;
export function validateAutopilotLease(lease: ApplicationAutopilotLease): void {
  if (!lease || !AUTOPILOT_UUID.test(lease.id) || !AUTOPILOT_UUID.test(lease.leaseToken)) {
    throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_LEASE_INVALID");
  }
}
export function validateAutopilotDelegation(command: DelegateApplicationAutopilotCommand): void {
  if (!command || ![command.commandId,command.applicationId,command.revisionId].every(value => typeof value === "string" && AUTOPILOT_UUID.test(value)) ||
    !Number.isSafeInteger(command.expectedAggregateVersion) || command.expectedAggregateVersion < 1 ||
    typeof command.packetHash !== "string" || !AUTOPILOT_HASH.test(command.packetHash)) {
    throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_INPUT_INVALID");
  }
}
