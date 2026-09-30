import {
  APPLICATION_AUTOPILOT_STATUSES, AUTOPILOT_HASH, AUTOPILOT_UUID, ApplicationAutopilotError,
  validateAutopilotDelegation, validateAutopilotLease,
  type ApplicationAutopilotClaim, type ApplicationAutopilotLease, type ApplicationAutopilotRepository,
  type ApplicationAutopilotView, type ControlAutopilotCommand, type DelegateApplicationAutopilotCommand,
  type SaveAutopilotAnswersCommand,
} from "../../domain/application-autopilot.ts";
import { validateAgentQuestionAnswer, validateAgentQuestionDescriptors, type AgentQuestionAnswer, type AgentQuestionDescriptor, type ApplicationAgentQuestion, type StandingAnswerContext } from "../../domain/application-agent-questions.ts";
import { AUTOPILOT_UNSUPPORTED_DESTINATION_COPY, parseAutopilotDestination } from "../../domain/application-autopilot-eligibility.ts";
import type { OpenAIAgentActionLedger, OpenAIAgentCallKey, OpenAIAgentToolResult } from "../workers/openai-agents-client.ts";
import { recordWorkerEvent } from "../workers/worker-events.ts";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };
type RpcClient = { rpc(name: string, args: Row): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
type DestinationClient = { from(table: "applications"): {
  select(columns: string): { eq(column: "id", value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> } }
} };
type ReadClient = RpcClient & { from(table: string): {
  select(columns: string): { eq(column: string, value: string): { order(column: string, options: { ascending: boolean }): { limit(limit: number): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> } } }
} };
export type AutopilotCleanupResource = Readonly<{ id: string; autopilotId: string; kind: "AGENT" | "BROWSER"; reference: string }>;
export type AutopilotVerificationState = Readonly<{ id: string; status: "REQUESTED" | "PROVIDED" | "USED" | "EXPIRED"; code: string | null }>;
/** Worker side of an employer's emailed code: request, read once, settle, keep the lease. */
export type ApplicationAutopilotVerificationStore = Readonly<{
  requestVerification(lease: ApplicationAutopilotLease, input: Readonly<{ recipientHint: string; retry: boolean }>): Promise<string>;
  readVerification(lease: ApplicationAutopilotLease): Promise<AutopilotVerificationState | null>;
  settleVerification(lease: ApplicationAutopilotLease, verificationId: string, outcome: "USED" | "EXPIRED"): Promise<void>;
  extendLease(lease: ApplicationAutopilotLease, seconds: number): Promise<void>;
  /** The candidate's connected mailbox (sealed token), readable only while sending. */
  readMailboxConnection(lease: ApplicationAutopilotLease): Promise<AutopilotMailboxConnection | null>;
  recordMailboxUse(lease: ApplicationAutopilotLease, errorCode: string | null): Promise<void>;
  provideVerificationFromMailbox(lease: ApplicationAutopilotLease, verificationId: string, code: string): Promise<void>;
}>;
export type AutopilotMailboxConnection = Readonly<{ candidateId: string; provider: "GOOGLE"; emailAddress: string; encryptedToken: string; keyId: string }>;
export type ApplicationAutopilotStore = ApplicationAutopilotRepository & ApplicationAutopilotVerificationStore & Readonly<{
  ledger(lease: ApplicationAutopilotLease): OpenAIAgentActionLedger;
  cleanupPending(limit?: number): Promise<readonly AutopilotCleanupResource[]>;
  acknowledgeDelete(resourceId: string): Promise<void>;
}>;

function row(value: unknown): value is Row { return value !== null && typeof value === "object" && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && AUTOPILOT_UUID.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" && AUTOPILOT_HASH.test(value); }
function protocol(): never { throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_PROTOCOL_INVALID"); }
function fail(error: { code?: string; message?: string }): never {
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_UNAVAILABLE", "Apply for me is not available yet.");
  }
  const code = error.message?.match(/\b(?:APPLICATION_AUTOPILOT_[A-Z_]+|COMMAND_ID_PAYLOAD_MISMATCH|AUTHENTICATION_REQUIRED)\b/u)?.[0] ?? "APPLICATION_AUTOPILOT_OPERATION_FAILED";
  throw new ApplicationAutopilotError(code, code.includes("STALE") || code.includes("REVISION")
    ? "This application changed. Reload and review its current files before continuing."
    : "This application could not be updated. Reload to check its status.");
}
async function call(client: unknown, name: string, args: Row): Promise<unknown> {
  let result: Awaited<ReturnType<RpcClient["rpc"]>>;
  try { result = await (client as RpcClient).rpc(name, args); }
  catch { throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_CONNECTION_INTERRUPTED", "The connection was interrupted. Retry to check the same request."); }
  if (result.error) fail(result.error);
  return result.data;
}
function leaseArgs(lease: ApplicationAutopilotLease): Row {
  validateAutopilotLease(lease); return { p_id: lease.id, p_lease_token: lease.leaseToken };
}
function callKey(key: OpenAIAgentCallKey): Row {
  if (![key.sessionId,key.turnId,key.callId].every(value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value)) ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key.name) || !hash(key.argumentsHash)) protocol();
  return { p_session_id: key.sessionId, p_turn_id: key.turnId, p_call_id: key.callId, p_tool_name: key.name, p_arguments_hash: key.argumentsHash };
}
function toolResult(value: unknown, key: OpenAIAgentCallKey): asserts value is OpenAIAgentToolResult {
  if (!row(value) || value.type !== "agent.session.input.tool_result" || value.turn_id !== key.turnId || value.call_id !== key.callId ||
    typeof value.success !== "boolean" || (value.success ? typeof value.output !== "string" || "error" in value : typeof value.error !== "string" || "output" in value) ||
    Object.keys(value).some(name => !["type","turn_id","call_id","success","output","error"].includes(name)) || JSON.stringify(value).length > 262_144) protocol();
}

/** Answers exactly as the database returned them, each checked against its own question. */
function parseAnswers(value: unknown): readonly AgentQuestionAnswer[] {
  if (!Array.isArray(value) || value.length > 96) protocol();
  return Object.freeze(value.map(item => {
    if (!row(item) || !uuid(item.answer_id) || !hash(item.fingerprint) || !row(item.descriptor)) protocol();
    const descriptor = item.descriptor as unknown as AgentQuestionDescriptor;
    validateAgentQuestionDescriptors([descriptor]);
    if (descriptor.fingerprint !== item.fingerprint || descriptor.fieldId !== item.field_id) protocol();
    validateAgentQuestionAnswer(descriptor, item.value);
    return Object.freeze({ answerId: item.answer_id, fieldId: item.field_id, fingerprint: item.fingerprint, value: item.value }) as AgentQuestionAnswer;
  }));
}

function parseStandingAnswers(value: unknown): StandingAnswerContext {
  if (!row(value) || !Array.isArray(value.answers) || value.answers.length > 100 || (value.job !== null && !row(value.job))) protocol();
  const text = (item: unknown, max: number) => typeof item === "string" && item.trim().length > 0 && item.length <= max;
  const answers = value.answers.map(item => {
    if (!row(item) || !uuid(item.id) || !text(item.topic, 200) || !text(item.answer, 1_000)) protocol();
    return Object.freeze({ id: item.id as string, topic: item.topic as string, answer: item.answer as string });
  });
  const job = value.job as Row | null;
  const optional = (item: unknown) => typeof item === "string" && item.trim() ? item.slice(0, 200) : null;
  return Object.freeze({ answers: Object.freeze(answers),
    job: job ? Object.freeze({ title: optional(job.title), employer: optional(job.employer), location: optional(job.location), workMode: optional(job.work_mode) }) : null });
}

export function createApplicationAutopilotRepository(client: unknown): ApplicationAutopilotStore {
  const repository: ApplicationAutopilotStore = {
    async claim(workerId, leaseSeconds = 300, targetId) {
      if (!/^[A-Za-z0-9_.:-]{1,120}$/u.test(workerId) || !Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 600) protocol();
      if (targetId !== undefined && !uuid(targetId)) protocol();
      const value = await call(client, "claim_application_autopilot", { p_worker_id: workerId, p_lease_seconds: leaseSeconds, ...(targetId ? { p_target_id: targetId } : {}) });
      if (value === null) return null;
      if (targetId && (!row(value) || value.id !== targetId)) protocol();
      if (!row(value) || ![value.id,value.workspace_id,value.candidate_id,value.application_id,value.revision_id,value.lease_token].every(uuid) ||
        !hash(value.packet_hash) || typeof value.destination_url !== "string" || !/^https:\/\//u.test(value.destination_url) ||
        !Array.isArray(value.artifact_manifest) || !row(value.disclosure_manifest) || !row(value.checkpoint) ||
        (value.status !== "RUNNING" && value.status !== "RECONCILING") || (value.mode !== "FILL" && value.mode !== "RECONCILE") ||
        typeof value.lease_expires_at !== "string" || !Number.isFinite(Date.parse(value.lease_expires_at)) ||
        (value.runtime_reference !== null && (typeof value.runtime_reference !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.runtime_reference))) ||
        (value.attempt_id !== null && !uuid(value.attempt_id)) || (value.sealed_diff_hash !== null && !hash(value.sealed_diff_hash)) ||
        (value.mode === "RECONCILE") !== (value.attempt_id !== null) || (value.mode === "FILL") !== (value.status === "RUNNING")) protocol();
      return Object.freeze({ id: value.id, workspaceId: value.workspace_id, candidateId: value.candidate_id, applicationId: value.application_id,
        revisionId: value.revision_id, packetHash: value.packet_hash, destinationUrl: value.destination_url, artifactManifest: value.artifact_manifest,
        disclosureManifest: value.disclosure_manifest, status: value.status, mode: value.mode, leaseToken: value.lease_token,
        leaseExpiresAt: value.lease_expires_at, checkpoint: value.checkpoint, runtimeReference: value.runtime_reference,
        attemptId: value.attempt_id, sealedDiffHash: value.sealed_diff_hash }) as ApplicationAutopilotClaim;
    },
    async assertLease(lease, mutating = true) { await call(client, "assert_application_autopilot_lease", { ...leaseArgs(lease), p_mutating: mutating }); },
    async checkpoint(lease, input) {
      if (!/^[A-Z][A-Z0-9_]{0,79}$/u.test(input.stage) || !row(input.data) || JSON.stringify(input.data).length > 131_072) protocol();
      await call(client, "checkpoint_application_autopilot", { ...leaseArgs(lease), p_stage: input.stage, p_data: input.data });
    },
    async bindRuntime(lease, runtimeReference) {
      if (runtimeReference !== null && !/^[A-Za-z0-9_-]{1,128}$/u.test(runtimeReference)) protocol();
      await call(client, "bind_application_autopilot_resource", { ...leaseArgs(lease), p_kind: "BROWSER", p_reference: runtimeReference });
    },
    async setAgentSession(lease, sessionId) {
      if (sessionId !== null && !/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) protocol();
      await call(client, "bind_application_autopilot_resource", { ...leaseArgs(lease), p_kind: "AGENT", p_reference: sessionId });
    },
    async requestQuestions(lease, questions) {
      validateAgentQuestionDescriptors(questions);
      await call(client, "request_application_autopilot_questions", { ...leaseArgs(lease), p_questions: questions });
    },
    async recordEvent(claim, event) {
      await recordWorkerEvent(client as never, { lane: "autopilot", ...event, applicationId: claim.applicationId, autopilotId: claim.id });
    },
    async prefillAnswers(lease, questions) {
      if (!questions.length) return [];
      if (questions.length > 24) protocol();
      validateAgentQuestionDescriptors(questions);
      return parseAnswers(await call(client, "prefill_application_autopilot_answers", { ...leaseArgs(lease), p_questions: questions }));
    },
    async readAllAnswers(lease) {
      return parseAnswers(await call(client, "read_application_autopilot_answers", leaseArgs(lease)));
    },
    async readStandingAnswers(lease) {
      return parseStandingAnswers(await call(client, "read_candidate_standing_answers", leaseArgs(lease)));
    },
    async recordStandingAnswers(lease, answers) {
      if (!answers.length) return [];
      if (answers.length > 24) protocol();
      for (const answer of answers) {
        validateAgentQuestionAnswer(answer.descriptor, answer.value);
        if (!Array.isArray(answer.basis) || answer.basis.length < 1 || answer.basis.length > 6 ||
          answer.basis.some(id => !uuid(id) && !/^fact:[a-z_]+(?:\.[a-z_]+){1,3}$/u.test(id))) protocol();
      }
      return parseAnswers(await call(client, "record_application_autopilot_standing_answers", { ...leaseArgs(lease),
        p_answers: answers.map(answer => ({ descriptor: answer.descriptor, value: answer.value, basis: answer.basis })) }));
    },
    async seal(lease, input) {
      if (!row(input.diff) || !hash(input.readbackHash) || !hash(input.requestFingerprint) || !input.destinationUrl.startsWith("https://")) protocol();
      const value = await call(client, "seal_application_autopilot", { ...leaseArgs(lease), p_diff: input.diff,
        p_readback_hash: input.readbackHash, p_request_fingerprint: input.requestFingerprint, p_destination_url: input.destinationUrl });
      if (!hash(value)) protocol(); return value;
    },
    async beginSubmit(lease, input) {
      if (!hash(input.sealHash) || !hash(input.requestFingerprint) || !/^[A-Za-z0-9/._-]{1,120}$/u.test(input.adapterRelease)) protocol();
      const value = await call(client, "begin_application_autopilot_submit", { ...leaseArgs(lease), p_seal_hash: input.sealHash,
        p_request_fingerprint: input.requestFingerprint, p_adapter_release: input.adapterRelease });
      if (!row(value) || !uuid(value.attempt_id) || typeof value.idempotency_key !== "string" || !new RegExp(`^autopilot:${lease.id}(?::[1-9][0-9]{0,2})?$`, "u").test(value.idempotency_key) || value.seal_hash !== input.sealHash || value.request_fingerprint !== input.requestFingerprint) protocol();
      return Object.freeze({ attemptId: value.attempt_id, idempotencyKey: value.idempotency_key, sealHash: input.sealHash, requestFingerprint: input.requestFingerprint });
    },
    async finish(lease, input) {
      if (!["CONFIRMED","UNCERTAIN","FAILED_SAFE","NOT_ACCEPTED"].includes(input.outcome) || (input.failureCode !== undefined && !/^[A-Z][A-Z0-9_]{2,119}$/u.test(input.failureCode)) ||
        (input.outcome === "CONFIRMED" && !input.receipt)) protocol();
      await call(client, "finish_application_autopilot", { ...leaseArgs(lease), p_outcome: input.outcome,
        p_failure_code: input.failureCode ?? null, p_receipt: input.receipt ?? null });
    },
    ledger(lease) {
      const binding = leaseArgs(lease);
      return {
        async begin(key) {
          const value = await call(client, "begin_application_autopilot_tool", { ...binding, ...callKey(key) });
          if (!row(value)) protocol();
          if (value.status === "new" || value.status === "uncertain") return { status: value.status };
          if (value.status !== "completed") protocol();
          toolResult(value.result, key); return { status: "completed", result: value.result };
        },
        async complete(key, result) {
          toolResult(result, key);
          await call(client, "complete_application_autopilot_tool", { ...binding, ...callKey(key), p_result: result });
        },
      };
    },
    async cleanupPending(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) protocol();
      const value = await call(client, "claim_application_autopilot_cleanup", { p_limit: limit });
      if (!Array.isArray(value) || value.length > limit) protocol();
      return Object.freeze(value.map(item => {
        if (!row(item) || !uuid(item.id) || !uuid(item.autopilot_id) || !["AGENT","BROWSER"].includes(String(item.kind)) || typeof item.reference !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(item.reference)) protocol();
        return Object.freeze({ id: item.id, autopilotId: item.autopilot_id, kind: item.kind, reference: item.reference }) as AutopilotCleanupResource;
      }));
    },
    async acknowledgeDelete(resourceId) {
      if (!uuid(resourceId)) protocol(); await call(client, "acknowledge_application_autopilot_cleanup", { p_resource_id: resourceId });
    },
    async requestVerification(lease, input) {
      const recipient = typeof input.recipientHint === "string" ? input.recipientHint.trim() : "";
      if (!recipient || recipient.length > 320 || /[\u0000-\u001f]/u.test(recipient) || typeof input.retry !== "boolean") protocol();
      const value = await call(client, "request_application_autopilot_verification", { ...leaseArgs(lease), p_recipient_hint: recipient,
        p_retry_reason: input.retry ? "CODE_REJECTED" : null });
      if (!uuid(value)) protocol(); return value;
    },
    async readVerification(lease) {
      const value = await call(client, "read_application_autopilot_verification", leaseArgs(lease));
      if (value === null) return null;
      if (!row(value) || !uuid(value.id) || !["REQUESTED", "PROVIDED", "USED", "EXPIRED"].includes(String(value.status)) ||
        (value.code !== null && value.code !== undefined && (typeof value.code !== "string" || !/^[A-Za-z0-9]{4,12}$/u.test(value.code))) ||
        (value.status === "PROVIDED") !== (typeof value.code === "string")) protocol();
      return Object.freeze({ id: value.id, status: value.status, code: typeof value.code === "string" ? value.code : null }) as AutopilotVerificationState;
    },
    async settleVerification(lease, verificationId, outcome) {
      if (!uuid(verificationId) || !["USED", "EXPIRED"].includes(outcome)) protocol();
      await call(client, "settle_application_autopilot_verification", { ...leaseArgs(lease), p_verification_id: verificationId, p_outcome: outcome });
    },
    async extendLease(lease, seconds) {
      if (!Number.isInteger(seconds) || seconds < 30 || seconds > 600) protocol();
      await call(client, "extend_application_autopilot_lease", { ...leaseArgs(lease), p_seconds: seconds });
    },
    async readMailboxConnection(lease) {
      const value = await call(client, "read_autopilot_mailbox_connection", leaseArgs(lease));
      if (value === null) return null;
      if (!row(value) || !uuid(value.candidateId) || value.provider !== "GOOGLE" || typeof value.emailAddress !== "string" ||
        typeof value.encryptedToken !== "string" || typeof value.keyId !== "string") protocol();
      return Object.freeze({ candidateId: value.candidateId, provider: "GOOGLE", emailAddress: value.emailAddress, encryptedToken: value.encryptedToken, keyId: value.keyId });
    },
    async recordMailboxUse(lease, errorCode) {
      if (errorCode !== null && !/^[A-Z][A-Z0-9_]{2,119}$/u.test(errorCode)) protocol();
      await call(client, "record_autopilot_mailbox_use", { ...leaseArgs(lease), p_error: errorCode });
    },
    async provideVerificationFromMailbox(lease, verificationId, code) {
      if (!uuid(verificationId) || !/^[A-Za-z0-9]{4,12}$/u.test(code)) protocol();
      await call(client, "provide_application_autopilot_verification_from_mailbox", { ...leaseArgs(lease), p_verification_id: verificationId, p_code: code });
    },
  };
  return Object.freeze(repository);
}

export async function delegateApplicationAutopilot(client: unknown, command: DelegateApplicationAutopilotCommand): Promise<Readonly<{ id: string; replayed: boolean }>> {
  validateAutopilotDelegation(command);
  // Read the immutable job version through the candidate's application RLS. A
  // caller-provided URL cannot establish eligibility or override this relation.
  let destination: QueryResult;
  try {
    destination = await (client as DestinationClient).from("applications")
      .select("job_version:job_versions!applications_job_id_job_version_id_fkey(apply_url)")
      .eq("id", command.applicationId).maybeSingle();
  } catch { throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_CONNECTION_INTERRUPTED", "The connection was interrupted. Retry to check the same request."); }
  if (destination.error) fail(destination.error);
  if (!row(destination.data)) throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_NOT_FOUND", "This application could not be found.");
  const version = destination.data.job_version;
  if (!row(version) || typeof version.apply_url !== "string" || !parseAutopilotDestination(version.apply_url)) {
    throw new ApplicationAutopilotError("APPLICATION_AUTOPILOT_DESTINATION_UNSUPPORTED", AUTOPILOT_UNSUPPORTED_DESTINATION_COPY);
  }
  const value = await call(client, "delegate_application_autopilot", { p_command_id: command.commandId, p_application_id: command.applicationId,
    p_expected_aggregate_version: command.expectedAggregateVersion, p_revision_id: command.revisionId, p_packet_hash: command.packetHash });
  if (!row(value) || !uuid(value.id) || typeof value.replayed !== "boolean") protocol();
  return { id: value.id, replayed: value.replayed };
}
export async function saveApplicationAutopilotAnswers(client: unknown, command: SaveAutopilotAnswersCommand): Promise<void> {
  if (!uuid(command?.commandId) || !uuid(command.id) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 ||
    !Array.isArray(command.answers) || command.answers.length < 1 || command.answers.length > 24 ||
    command.answers.some(answer => !uuid(answer.questionId) || !hash(answer.fingerprint)) || new Set(command.answers.map(answer => answer.questionId)).size !== command.answers.length ||
    JSON.stringify(command.answers).length > 240_000) protocol();
  await call(client, "save_application_autopilot_answers", { p_command_id: command.commandId, p_id: command.id, p_expected_version: command.expectedVersion, p_answers: command.answers });
}
export async function provideApplicationAutopilotVerificationCode(client: unknown, command: Readonly<{ commandId: string; id: string; verificationId: string; code: string }>): Promise<void> {
  const code = typeof command?.code === "string" ? command.code.trim() : "";
  if (!uuid(command?.commandId) || !uuid(command.id) || !uuid(command.verificationId) || !/^[A-Za-z0-9]{4,12}$/u.test(code)) protocol();
  await call(client, "provide_application_autopilot_verification_code", { p_command_id: command.commandId, p_id: command.id, p_verification_id: command.verificationId, p_code: code });
}
export async function controlApplicationAutopilot(client: unknown, command: ControlAutopilotCommand): Promise<void> {
  if (!uuid(command?.commandId) || !uuid(command.id) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || !["PAUSE","RESUME","CANCEL"].includes(command.action)) protocol();
  await call(client, "control_application_autopilot", { p_command_id: command.commandId, p_id: command.id, p_expected_version: command.expectedVersion, p_action: command.action });
}
export async function getApplicationAutopilot(client: unknown, applicationId: string, enabled = true): Promise<ApplicationAutopilotView | null> {
  if (!enabled) return null;
  if (!uuid(applicationId)) protocol();
  const db = client as ReadClient;
  const result = await db.from("application_autopilots").select("id,application_id,revision_id,status,version,failure_code,application_autopilot_questions(id,descriptor,status),application_autopilot_verifications(id,status,recipient_hint,retry_reason,requested_at,expires_at)")
    .eq("application_id", applicationId).order("created_at", { ascending: false }).limit(1);
  if (result.error) fail(result.error);
  if (!Array.isArray(result.data) || result.data.length > 1) protocol();
  const item = result.data[0]; if (!item) return null;
  if (!row(item) || !uuid(item.id) || item.application_id !== applicationId || !uuid(item.revision_id) || !APPLICATION_AUTOPILOT_STATUSES.includes(item.status as never) ||
    !Number.isSafeInteger(item.version) || Number(item.version) < 1 || !Array.isArray(item.application_autopilot_questions) || item.application_autopilot_questions.length > 96) protocol();
  const questions = item.application_autopilot_questions.filter(question => row(question) && question.status === "OPEN").map(question => {
    if (!row(question) || !uuid(question.id) || !row(question.descriptor)) protocol();
    const descriptor = question.descriptor as unknown as AgentQuestionDescriptor; validateAgentQuestionDescriptors([descriptor]);
    return Object.freeze({ ...descriptor, id: question.id, status: "OPEN" as const });
  }) as ApplicationAgentQuestion[];
  const requests = Array.isArray(item.application_autopilot_verifications) ? item.application_autopilot_verifications : [];
  const open = requests.filter((request): request is Row => row(request) && request.status === "REQUESTED" && uuid(request.id) &&
    typeof request.recipient_hint === "string" && typeof request.expires_at === "string" && Date.parse(request.expires_at) > Date.now())
    .sort((left, right) => String(right.requested_at).localeCompare(String(left.requested_at)))[0];
  const verification = item.status === "SUBMITTING" && open ? Object.freeze({ id: open.id as string, recipient: open.recipient_hint as string,
    retry: open.retry_reason === "CODE_REJECTED", expiresAt: open.expires_at as string }) : null;
  return Object.freeze({ id: item.id, applicationId, revisionId: item.revision_id, status: item.status,
    version: item.version, failureCode: item.failure_code, questions, verification }) as ApplicationAutopilotView;
}
