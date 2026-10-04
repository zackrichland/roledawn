import { createHash } from "node:crypto";

/** Offline design model only. No repository, provider client, seal RPC or receipt writer. */
export const HOSTED_TASK_MODEL_MODE = "OFFLINE_ONLY" as const;
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fail = (): never => { throw new Error("HOSTED_TASK_MODEL_TRANSITION_REFUSED"); };

export type HostedTaskBinding = Readonly<{
  applicationId: string;
  sessionId: string;
  destinationUrl: string;
  packetSha256: string;
  admissionKey: string;
  /** Hash of the exact serialized task message, never an employer request fingerprint. */
  messageSha256: string;
}>;
export type HostedTaskModel = Readonly<{
  binding: HostedTaskBinding;
  phase: "RESERVED" | "ADMISSION_PENDING" | "ADMITTED" | "UNCERTAIN" | "STOPPED" | "CONFIRMED" | "NOT_ACCEPTED";
  possibleEgress: boolean;
  automaticRetryAllowed: false;
  evidenceSha256: string | null;
}>;
const frozen = (state: HostedTaskModel): HostedTaskModel => Object.freeze({ ...state, binding: Object.freeze({ ...state.binding }) });
const terminal = (state: HostedTaskModel) => ["STOPPED", "CONFIRMED", "NOT_ACCEPTED"].includes(state.phase);
function messageHash(message: string): string {
  if (typeof message !== "string" || !message.trim() || Buffer.byteLength(message) > 4_000_000) fail();
  return hash(message);
}

/** A real implementation would insert this once under a durable unique application/destination key. */
export function reserveHostedTaskModel(input: Omit<HostedTaskBinding, "messageSha256"> & { message: string }): HostedTaskModel {
  if (!UUID.test(input.applicationId) || !ID.test(input.sessionId) || !ID.test(input.admissionKey) || !HASH.test(input.packetSha256)) fail();
  let url: URL;
  try { url = new URL(input.destinationUrl); } catch { return fail(); }
  const suffix = url.hostname === "jobs.lever.co" ? "apply" : url.hostname === "jobs.ashbyhq.com" ? "application" : null;
  const parts = url.pathname.split("/");
  if (!suffix || url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      parts.length !== 4 || !/^[A-Za-z0-9_-]+$/u.test(parts[1]) || !UUID.test(parts[2]) || parts[3] !== suffix) fail();
  return frozen({ binding: { applicationId: input.applicationId, sessionId: input.sessionId,
    destinationUrl: url.href, packetSha256: input.packetSha256, admissionKey: input.admissionKey,
    messageSha256: messageHash(input.message) }, phase: "RESERVED", possibleEgress: false,
    automaticRetryAllowed: false, evidenceSha256: null });
}

/** Persist this transition BEFORE any candidate-bearing task or employer-origin grant. */
export function beginHostedTaskAdmissionModel(state: HostedTaskModel): HostedTaskModel {
  if (state.phase !== "RESERVED" || state.possibleEgress) fail();
  return frozen({ ...state, phase: "ADMISSION_PENDING", possibleEgress: true });
}

/** Identical admission replay is not a new task and does not clear uncertainty or authorize employer traffic. */
export function checkHostedAdmissionReplayModel(state: HostedTaskModel, replay: Readonly<{
  sessionId: string; admissionKey: string; message: string;
}>): HostedTaskModel {
  if (!state.possibleEgress || terminal(state) || replay.sessionId !== state.binding.sessionId ||
      replay.admissionKey !== state.binding.admissionKey || messageHash(replay.message) !== state.binding.messageSha256) fail();
  return state;
}

export function acknowledgeHostedAdmissionModel(state: HostedTaskModel): HostedTaskModel {
  if (state.phase === "UNCERTAIN") return state; // An acknowledgement cannot establish the employer outcome.
  if (state.phase !== "ADMISSION_PENDING" && state.phase !== "ADMITTED") fail();
  return frozen({ ...state, phase: "ADMITTED" });
}

/** Includes lost streams, transport timeouts, lease expiry and provider completion without employer evidence. */
export function interruptHostedTaskModel(state: HostedTaskModel): HostedTaskModel {
  if (terminal(state)) return state;
  return frozen({ ...state, phase: state.possibleEgress ? "UNCERTAIN" : "STOPPED" });
}

/** Input represents separately verified employer evidence; this model cannot verify or mint a real receipt. */
export function reconcileHostedTaskModel(state: HostedTaskModel, evidence: Readonly<{
  source: "VERIFIED_EMPLOYER_EVIDENCE";
  applicationId: string;
  destinationUrl: string;
  packetSha256: string;
  outcome: "CONFIRMED" | "NOT_ACCEPTED";
  evidenceSha256: string;
}>): HostedTaskModel {
  if (!state.possibleEgress || state.phase === "STOPPED" || evidence.source !== "VERIFIED_EMPLOYER_EVIDENCE" ||
      evidence.applicationId !== state.binding.applicationId || evidence.destinationUrl !== state.binding.destinationUrl ||
      evidence.packetSha256 !== state.binding.packetSha256 || !HASH.test(evidence.evidenceSha256) ||
      !["CONFIRMED", "NOT_ACCEPTED"].includes(evidence.outcome)) fail();
  if (terminal(state)) {
    if (state.phase !== evidence.outcome || state.evidenceSha256 !== evidence.evidenceSha256) fail();
    return state;
  }
  return frozen({ ...state, phase: evidence.outcome, evidenceSha256: evidence.evidenceSha256 });
}
