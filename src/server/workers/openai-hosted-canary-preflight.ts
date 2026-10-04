import { createHash } from "node:crypto";
import type { CanaryPlan } from "./openai-hosted-canary.ts";
export type CanaryOperatorManifest = Readonly<{ plan: CanaryPlan; approval: {
  intentSha256: string; packetSha256: string; destinationUrl: string;
  approvalHash: string; packetReadbackHash: string; priorSpendEvidenceHash: string; futureCostBoundHash: string;
  schemaReviewHash: string; expiresAt: string;
} }>;
const REQUIRED = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"] as const;
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
/** Local only: no imports of network clients, provider calls, or candidate values in output. */
export function hostedCanaryPreflight(environment: Readonly<Record<string, string | undefined>>, manifest?: CanaryOperatorManifest, now = Date.now()) {
  const missingConfig = REQUIRED.filter(k => !environment[k]?.trim());
  const blockers: string[] = [];
  if (environment.ROLEDAWN_HOSTED_CANARY_ENABLED !== "true") blockers.push("EXPERIMENT_DISABLED");
  let binding: { board: string; targetHash: string; packetSha256: string; intentSha256: string } | null = null;
  let originApprovals = 0; let originDenials = 0;
  let spend: { priorUpperCents: number; reservedRunCents: number; ceilingCents: number } | null = null;
  if (!manifest) blockers.push("PRIVATE_MANIFEST_REQUIRED");
  else try {
    const { plan: p, approval: a } = manifest;
    const { intentSha256, ...unsigned } = p;
    if (digest(unsigned) !== intentSha256 || a.intentSha256 !== intentSha256 || a.packetSha256 !== p.packetSha256 || a.destinationUrl !== p.destinationUrl) blockers.push("APPROVED_BINDING_MISMATCH");
    const url = new URL(p.destinationUrl);
    if (!/^https:\/\/jobs\.(lever\.co|ashbyhq\.com)\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\/(apply|application)$/iu.test(p.destinationUrl)) blockers.push("TARGET_INVALID");
    if (!/^[a-f0-9]{64}$/u.test(p.packetSha256) || !/^[a-f0-9]{64}$/u.test(intentSha256)) blockers.push("BINDING_HASH_INVALID");
    else binding = { board: url.hostname === "jobs.lever.co" ? "LEVER" : "ASHBY", targetHash: digest(p.destinationUrl), packetSha256: p.packetSha256, intentSha256 };
    if (![a.approvalHash,a.packetReadbackHash,a.priorSpendEvidenceHash,a.futureCostBoundHash,a.schemaReviewHash].every(v => /^[a-f0-9]{64}$/u.test(v))) blockers.push("REVIEW_EVIDENCE_REQUIRED");
    if (!Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= now) blockers.push("APPROVAL_EXPIRED");
    if (p.deadlineMs <= now || p.deadlineMs - now > 180_000) blockers.push("NEW_ADMISSION_DEADLINE_INVALID");
    for (const [origin, decision] of Object.entries(p.originDecisions)) {
      const u = new URL(origin);
      if (u.origin !== origin || u.protocol !== "https:" || !p.allowedDomains.includes(u.hostname)) blockers.push("ORIGIN_INVALID");
      if (decision === "approve") originApprovals++; else if (decision === "deny") originDenials++; else blockers.push("ORIGIN_INVALID");
    }
    if (p.originDecisions[url.origin] !== "approve") blockers.push("TARGET_ORIGIN_NOT_APPROVED");
    if (typeof p.priorSpendUpperBoundCents !== "number" || typeof p.reservedRunCents !== "number") throw Error();
    spend = { priorUpperCents: p.priorSpendUpperBoundCents, reservedRunCents: p.reservedRunCents, ceilingCents: 5000 };
    if (![spend.priorUpperCents,spend.reservedRunCents].every(Number.isSafeInteger) || spend.priorUpperCents < 0 || spend.reservedRunCents <= 0 || spend.priorUpperCents+spend.reservedRunCents>5000) blockers.push("SPEND_BOUND_INVALID");
  } catch { blockers.push("MANIFEST_INVALID"); }
  return { mode: "LOCAL_ONLY_NO_NETWORK" as const, missingConfig, blockers: [...new Set(blockers)], binding,
    originApprovals, originDenials, spend, localChecksPass: missingConfig.length === 0 && blockers.length === 0,
    deployedApprovalAndExclusionVerified: false, employerAcceptanceVerified: false };
}
