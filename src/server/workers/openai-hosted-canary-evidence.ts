import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanaryEvidence, CanaryPlan, CanaryRun } from "./openai-hosted-canary.ts";
import type { HostedCanaryTransport } from "./openai-hosted-canary-transport.ts";
export const evidenceHash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export const verificationDigest = (value: unknown) => evidenceHash(JSON.stringify(canonical(value)));
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
function fail(): never { throw Error("HOSTED_CANARY_EVIDENCE_REJECTED"); }
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) return fail(); return v as Record<string,unknown>; };
export interface PrivateEvidenceArchive { put(bytes: Uint8Array): Promise<string>; get(hash: string): Promise<Uint8Array> }
/** Content-addressed bytes only, no provider-controlled filenames. Root must already be private. */
export async function openPrivateEvidenceArchive(directory: string): Promise<PrivateEvidenceArchive> {
  const info = await lstat(directory), root = await realpath(directory);
  const repo = resolve(fileURLToPath(new URL("../../../",import.meta.url)));
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || root === repo || root.startsWith(repo.endsWith(sep) ? repo : repo+sep)) fail();
  const get = async (hash: string) => {
    if (!HASH.test(hash)) return fail();
    const path = resolve(root,hash), meta = await lstat(path);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 8_388_608 || (meta.mode & 0o077)) return fail();
    const bytes = await readFile(path); if (evidenceHash(bytes) !== hash) return fail(); return bytes;
  };
  return { get, async put(bytes) {
    if (bytes.byteLength > 8_388_608) return fail();
    const hash = evidenceHash(bytes);
    try { await writeFile(resolve(root,hash),bytes,{ flag: "wx",mode: 0o600 }); }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") return fail(); await get(hash); }
    return hash;
  } };
}
function page(raw: unknown) {
  const p = obj(raw); if (p.object !== "list" || !Array.isArray(p.data) || typeof p.has_more !== "boolean" || p.data.length > 100) return fail();
  if (p.has_more && (!p.data.length || typeof p.last_id !== "string" || !ID.test(p.last_id))) return fail();
  if (p.has_more && obj(p.data.at(-1)).id !== p.last_id) return fail();
  return { data: p.data, hasMore: p.has_more, lastId: p.has_more ? p.last_id as string : null };
}
/** Diagnostic outputs only. This function NEVER returns an employer receipt. */
export async function captureHostedOutputs(run: CanaryRun, transport: Pick<HostedCanaryTransport,"turns" | "items" | "artifacts" | "artifactContent" | "traces">, archive: PrivateEvidenceArchive) {
  if (!run.sessionId || !ID.test(run.sessionId)) return { status: "UNAVAILABLE" as const, manifestSha256: null };
  const signal = AbortSignal.timeout(20_000), saved: { kind: string; sha256: string }[] = [];
  let complete = true, artifacts = 0;
  const save = async (kind: string, raw: unknown) => { const sha256 = await archive.put(Buffer.from(JSON.stringify(raw))); saved.push({ kind,sha256 }); };
  const attempt = async (capture: () => Promise<void>) => { try { await capture(); } catch { complete = false; } };
  let terminal = new Set<string>(), turnIds = new Set<string>();
  await attempt(async () => {
    const turnsRaw = await transport.turns(run.sessionId!,signal); await save("turns",turnsRaw);
    const turnsPage = page(turnsRaw); if (turnsPage.hasMore) complete = false;
    const turns = turnsPage.data.map(obj);
    if (turns.some(t => t.session_id !== run.sessionId || typeof t.id !== "string" || !ID.test(t.id))) fail();
    turnIds = new Set(turns.map(t => t.id as string));
    terminal = new Set(turns.filter(t => ["completed","failed","cancelled"].includes(String(t.status))).map(t => t.id as string));
    if (!turns.some(t => t.subagent_id === null && terminal.has(t.id as string) && t.usage != null)) complete = false;
  });
  await attempt(async () => {
    let after: string | undefined; const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const tracesRaw = await transport.traces(run.sessionId!,signal,after), tracesPage = page(tracesRaw);
      const traces = tracesPage.data.map(obj);
      if (traces.some(t => t.object !== "agent.session.trace" || t.session_id !== run.sessionId ||
        typeof t.id !== "string" || !terminal.has(t.id))) complete = false;
      for (const trace of traces) { if (seen.has(trace.id as string)) fail(); seen.add(trace.id as string); }
      await save("private_raw_traces",tracesRaw);
      if (!tracesPage.hasMore) { if (i === 0 && !traces.length) complete = false; return; }
      if (tracesPage.lastId === after) fail();
      after = tracesPage.lastId!;
    }
    complete = false;
  });
  await attempt(async () => {
    let after: string | undefined; const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const itemsRaw = await transport.items(run.sessionId!,signal,after), itemsPage = page(itemsRaw);
      await save("items",itemsRaw);
      for (const raw of itemsPage.data) {
        const item = obj(raw);
        if (typeof item.id !== "string" || !ID.test(item.id) || seen.has(item.id)) fail();
        seen.add(item.id);
        if (typeof item.turn_id !== "string" || !turnIds.has(item.turn_id)) { complete = false; continue; }
        // Screenshots remain private diagnostics, never employer receipt authority.
        if (item.type === "computer_use_call" && item.output !== null) {
          const output = obj(item.output);
          if (output.type !== "computer_screenshot" || typeof output.image_url !== "string" || !output.image_url.startsWith("data:image/jpeg;base64,")) { complete = false; continue; }
          const data = output.image_url.slice("data:image/jpeg;base64,".length), bytes = Buffer.from(data,"base64");
          if (bytes.toString("base64") !== data) { complete = false; continue; }
          saved.push({ kind: "unverified_screenshot",sha256: await archive.put(bytes) });
        }
      }
      if (!itemsPage.hasMore) return;
      if (itemsPage.lastId === after) fail();
      after = itemsPage.lastId!;
    }
    complete = false;
  });
  await attempt(async () => {
    const artifactsRaw = await transport.artifacts(run.sessionId!,signal); await save("artifact_metadata",artifactsRaw);
    const entriesPage = page(artifactsRaw); if (entriesPage.hasMore || entriesPage.data.length > 5) fail();
    for (const raw of entriesPage.data) {
      const a = obj(raw);
      if (a.object !== "agent.session.artifact" || a.session_id !== run.sessionId || !terminal.has(a.turn_id as string) ||
        typeof a.id !== "string" || !ID.test(a.id) || !Number.isSafeInteger(a.size_bytes) || Number(a.size_bytes) > 2_097_152 || Number(a.size_bytes) < 0) { complete = false; continue; }
      const bytes = await transport.artifactContent(run.sessionId!,a.id,signal);
      if (bytes.length !== a.size_bytes) { complete = false; continue; }
      saved.push({ kind: "unverified_artifact",sha256: await archive.put(bytes) }); artifacts++;
    }
  });
  const manifest = { type: "HOSTED_DIAGNOSTICS_NOT_RECEIPT", runSha256: evidenceHash(run.runId),sessionSha256: evidenceHash(run.sessionId),
    capturedAt: new Date().toISOString(),complete,artifacts,saved };
  const manifestSha256 = await archive.put(Buffer.from(JSON.stringify(manifest)));
  return { status: complete ? "CAPTURED" as const : "INCOMPLETE" as const, manifestSha256 };
}

export type EmployerVerification = Readonly<{
  sourceKind: "EMPLOYER_RESPONSE" | "SCREENSHOT";
  sourceUrl: string; rawSha256: string; candidateSha256: string; candidateContactSha256: string;
  employerSha256: string; jobSha256: string; sessionSha256: string;
  observedAt: string; runStartedAt: string; verifiedAt: string;
  explicitOutcome: "CONFIRMED" | "NOT_ACCEPTED"; reviewerReferenceSha256: string;
  employerOriginIndependentlyVerified: true; exactCandidateAndJobIndependentlyVerified: true;
}>;
export function expectedEmployerBinding(plan: CanaryPlan, run: CanaryRun) {
  if (!run.sessionId) return fail();
  const url = new URL(plan.destinationUrl), parts = url.pathname.split("/");
  const task = obj(plan.taskBody); const events = task.events as { input: { content: { text: string }[] }[] }[];
  // Candidate contact is already bound through the exact immutable task/packet. No inferred personal values.
  const text = events[0]?.input[0]?.content[0]?.text;
  const match = text?.match(/Approved facts: (\{.*\})\. Approved files:/u);
  const facts = match ? obj(JSON.parse(match[1])) : fail();
  if (typeof facts.email !== "string") return fail();
  return { candidateSha256: evidenceHash(plan.candidateId), candidateContactSha256: evidenceHash(facts.email.trim().toLowerCase()),
    employerSha256: evidenceHash(`${url.hostname}/${parts[1]}`), jobSha256: evidenceHash(`${url.hostname}/${parts[2].toLowerCase()}`),
    sessionSha256: evidenceHash(run.sessionId) };
}
/** Verification is trusted ONLY when read from the separately privileged private evidence ledger.
 * It records an independent human review of the raw employer response/screenshot, not model assertions.
 */
export async function verifyArchivedEmployerEvidence(plan: CanaryPlan, run: CanaryRun, raw: unknown, archive: PrivateEvidenceArchive, now = Date.now()): Promise<CanaryEvidence> {
  const evidence = obj(raw), v = obj(evidence.verification), expected = expectedEmployerBinding(plan,run);
  if (evidence.source !== "VERIFIED_EMPLOYER_EVIDENCE" || evidence.applicationId !== plan.applicationId || evidence.destinationUrl !== plan.destinationUrl ||
    evidence.packetSha256 !== plan.packetSha256 || typeof evidence.evidenceSha256 !== "string" || !HASH.test(evidence.evidenceSha256) ||
    !["CONFIRMED","NOT_ACCEPTED"].includes(String(evidence.outcome)) || evidence.outcome !== v.explicitOutcome ||
    !["EMPLOYER_RESPONSE","SCREENSHOT"].includes(String(v.sourceKind)) || v.employerOriginIndependentlyVerified !== true ||
    v.exactCandidateAndJobIndependentlyVerified !== true || typeof v.reviewerReferenceSha256 !== "string" || !HASH.test(v.reviewerReferenceSha256)) return fail();
  for (const [key,value] of Object.entries(expected)) if (v[key] !== value) return fail();
  if (typeof v.sourceUrl !== "string" || typeof v.rawSha256 !== "string" || !HASH.test(v.rawSha256)) return fail();
  const source = new URL(v.sourceUrl), destination = new URL(plan.destinationUrl);
  if (source.origin !== destination.origin || source.username || source.password || source.pathname.split("/").slice(1,3).join("/") !== destination.pathname.split("/").slice(1,3).join("/")) return fail();
  const observed = Date.parse(String(v.observedAt)), started = Date.parse(String(v.runStartedAt)), verified = Date.parse(String(v.verifiedAt));
  // The independently reviewed run start must lie inside this exact three-minute admission window.
  if (![observed,started,verified].every(Number.isFinite) || started < plan.deadlineMs-180_000 || started > plan.deadlineMs ||
    observed < started || observed > plan.deadlineMs+60_000 || verified < observed || verified > now+1000) return fail();
  const bytes = await archive.get(v.rawSha256);
  if (!bytes.length || evidenceHash(bytes) !== v.rawSha256 || verificationDigest(v) !== evidence.evidenceSha256) return fail();
  return evidence as CanaryEvidence;
}
