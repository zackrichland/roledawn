import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { hostedCanaryPreflight, type CanaryOperatorManifest } from "../src/server/workers/openai-hosted-canary-preflight.ts";
import { createHostedCanaryStore, readHostedCanaryEvidence } from "../src/server/workers/openai-hosted-canary-store.ts";
import { createHostedCanaryTransport } from "../src/server/workers/openai-hosted-canary-transport.ts";
import { captureHostedOutputs, openPrivateEvidenceArchive, verifyArchivedEmployerEvidence } from "../src/server/workers/openai-hosted-canary-evidence.ts";
import { runHostedCanary } from "../src/server/workers/openai-hosted-canary.ts";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";

export async function main(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const mode = args[0] ?? "--preflight";
  if (!["--preflight","--execute","--recover"].includes(mode) || args.length > 2) throw Error("HOSTED_CANARY_ARGUMENTS_INVALID");
  let manifest: CanaryOperatorManifest | undefined;
  if (args[1]) {
    const info = await stat(args[1]);
    if (!info.isFile() || info.size > 4_000_000 || (info.mode & 0o077) !== 0) throw Error("HOSTED_CANARY_PRIVATE_MANIFEST_REQUIRED");
    manifest = JSON.parse(await readFile(args[1], "utf8")) as CanaryOperatorManifest;
  }
  const preflight = hostedCanaryPreflight(env, manifest);
  let archive: Awaited<ReturnType<typeof openPrivateEvidenceArchive>> | undefined;
  if (env.ROLEDAWN_HOSTED_CANARY_EVIDENCE_DIR) {
    try { archive = await openPrivateEvidenceArchive(env.ROLEDAWN_HOSTED_CANARY_EVIDENCE_DIR); }
    catch { preflight.blockers.push("PRIVATE_ARCHIVE_UNAVAILABLE"); preflight.localChecksPass = false; }
  }
  if (mode === "--preflight") { console.log(JSON.stringify(preflight)); return; }
  const recoveryOnly = mode === "--recover";
  const blockers = recoveryOnly ? preflight.blockers.filter(b => !["EXPERIMENT_DISABLED","APPROVAL_EXPIRED","NEW_ADMISSION_DEADLINE_INVALID"].includes(b)) : preflight.blockers;
  if (preflight.missingConfig.length || blockers.length || !manifest || !archive) throw Error("HOSTED_CANARY_PREFLIGHT_BLOCKED");
  // The store independently verifies the exact pre-staged private plan and durable budget.
  // Local manifest assertions never create or grant that authority.
  const client = createSupabaseAdminClient("isolated-hosted-canary/1", env);
  const store = createHostedCanaryStore(client);
  const transport = createHostedCanaryTransport(env.OPENAI_API_KEY!);
  let capture: Awaited<ReturnType<typeof captureHostedOutputs>> | null = null;
  const originDecisionHashes: string[] = [];
  const result = await runHostedCanary({ enabled: true, recoveryOnly, reducedGuaranteeApproved: true, plan: manifest.plan, store,
    transport, captureOutputs: async run => {
      capture = await captureHostedOutputs(run,transport,archive);
      if (capture.status !== "CAPTURED") throw Error("HOSTED_CANARY_CAPTURE_INCOMPLETE");
    },
    recordOriginDecision: async (run, action) => {
      originDecisionHashes.push(await archive.put(Buffer.from(JSON.stringify({
        kind: "HOSTED_ORIGIN_DECISION_NOT_RECEIPT", runId: run.runId, sessionId: run.sessionId,
        requestId: action.requestId, origin: action.origin, decision: action.decision, observedAt: new Date().toISOString(),
      }))));
    },
    // No model/turn output is a receipt. Independent reconciliation remains required.
    verifyEmployerEvidence: async run => {
      const evidence = await readHostedCanaryEvidence(client,run);
      return evidence ? verifyArchivedEmployerEvidence(manifest.plan,run,evidence,archive) : null;
    } });
  console.log(JSON.stringify({ ...result,capture,originDecisionHashes }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => { console.error("HOSTED_CANARY_OPERATOR_ACTION_BLOCKED"); process.exitCode = 1; });
}
