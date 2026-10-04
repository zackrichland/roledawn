/** Read-only release gate for a predeclared private nine-job cohort. Never submits or retries. */
import { readFile } from "node:fs/promises";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
import { evaluateEmployerAcceptance, type AcceptanceManifest } from "../src/domain/employer-acceptance-gate.ts";

const [flag, path] = process.argv.slice(2);
if (flag !== "--read-only-live" || !path || process.argv.length !== 4) {
  throw new Error("Usage: node --experimental-strip-types --env-file=.env.local scripts/check-nine-job-employer-receipts.ts --read-only-live PRIVATE_MANIFEST.json");
}
const manifest = JSON.parse(await readFile(path, "utf8")) as AcceptanceManifest;
// Validate the declared denominator before opening the production connection.
evaluateEmployerAcceptance(manifest, { applications: [], attempts: [], receipts: [] });
const ids = manifest.cases.map(item => item.applicationId);
const admin = createSupabaseAdminClient("nine-job-employer-receipt-gate/1");
const [applications, attempts, receipts] = await Promise.all([
  admin.from("applications").select("id,candidate_id,status").in("id", ids),
  admin.from("application_attempts").select("id,application_id,status").in("application_id", ids),
  admin.from("receipts").select("id,application_id,attempt_id,confirmation_reference,receipt_hash,confirmed_at,evidence_manifest").in("application_id", ids),
]);
if (applications.error || attempts.error || receipts.error) throw new Error("EMPLOYER_ACCEPTANCE_READ_FAILED");
const result = evaluateEmployerAcceptance(manifest, {
  applications: applications.data ?? [], attempts: attempts.data ?? [], receipts: receipts.data ?? [],
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
