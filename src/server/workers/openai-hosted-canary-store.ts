import type { CanaryRun, CanaryEvidence, HostedCanaryStore } from "./openai-hosted-canary.ts";
export type CanaryRpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
async function boundedRpc(client: CanaryRpcClient, name: string, args: Record<string, unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(client.rpc(name,args)), new Promise<never>((_,reject) => {
      timer = setTimeout(() => reject(new Error("HOSTED_CANARY_STORE_TIMEOUT")),5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
/** Requires the reviewed SQL draft to be installed and independently approved private records to exist. */
export function createHostedCanaryStore(client: CanaryRpcClient): HostedCanaryStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    try { const result = await boundedRpc(client,name,args); if (result.error) throw Error(); return result.data; }
    catch { throw new Error("HOSTED_CANARY_STORE_REFUSED"); }
  };
  const parse = (value: unknown): CanaryRun => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HOSTED_CANARY_STORE_INVALID");
    const r = value as CanaryRun;
    if (typeof r.runId !== "string" || typeof r.controllerToken !== "string" || !Number.isSafeInteger(r.version) ||
      typeof r.intentSha256 !== "string" || !["RESERVED","CREATING","READY","ADMISSION_PENDING","ACTIVE","UNCERTAIN","CONFIRMED","NOT_ACCEPTED","STOPPED"].includes(r.phase) ||
      !(r.sessionId === null || typeof r.sessionId === "string") || typeof r.possibleEgress !== "boolean" ||
      typeof r.cancelRequested !== "boolean" || typeof r.cleanupPending !== "boolean" || !(r.evidence === null || typeof r.evidence === "object")) throw new Error("HOSTED_CANARY_STORE_INVALID");
    return r;
  };
  return {
    claim: async (plan, recoveryOnly = false) => parse(await call("claim_hosted_canary", { p_plan_text: JSON.stringify(plan), p_recovery: recoveryOnly })),
    commit: async (r, patch) => parse(await call("commit_hosted_canary", { p_run_id: r.runId, p_token: r.controllerToken, p_version: r.version, p_patch: patch })),
    budgetAvailable: async r => (await call("hosted_canary_budget_available", { p_run_id: r.runId, p_token: r.controllerToken })) === true,
    releaseController: async r => { await call("release_hosted_canary_controller", { p_run_id: r.runId, p_token: r.controllerToken }); },
  };
}

/** Reads separately reviewed employer evidence, never model output or a task completion. */
export async function readHostedCanaryEvidence(client: CanaryRpcClient, run: CanaryRun): Promise<CanaryEvidence | null> {
  try {
    const result = await boundedRpc(client,"read_hosted_canary_evidence", { p_run_id: run.runId, p_token: run.controllerToken });
    if (result.error) throw Error();
    if (result.data === null) return null;
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw Error();
    return result.data as CanaryEvidence; // Controller and transaction both validate the exact binding.
  } catch { throw new Error("HOSTED_CANARY_EVIDENCE_READ_FAILED"); }
}
