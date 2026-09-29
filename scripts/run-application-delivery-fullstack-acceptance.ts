/** Actual hosted authority/storage + Browserbase + Agents, reserved-origin ATS only. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Browserbase from "@browserbasehq/sdk";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
import { createApplicationAutopilotRepository, getApplicationAutopilot, saveApplicationAutopilotAnswers } from "../src/server/applications/autopilot.ts";
import { AUTOPILOT_LEASE_SECONDS, runApplicationAutopilotClaim } from "../src/server/workers/application-autopilot.ts";
import { createOpenAIAgentsClient } from "../src/server/workers/openai-agents-client.ts";
import { renderApplicationKit } from "../src/server/applications/application-kit-renderer.ts";
import { loadApplicationWritingPolicy } from "../src/server/applications/application-writing-policy-loader.ts";
import { createRoutedSyntheticAtsDelivery } from "../src/test-support/synthetic-ats-routed-delivery.ts";
import { buildFullstackCleanupSql, buildFullstackCleanupVerificationSql, buildFullstackResourcesSql, buildFullstackSeedSql, createFullstackScope, executeFullstackSql, FULLSTACK_RELEASE, requireFullstackEnvironment, syntheticHash } from "./application-delivery-fullstack-lib.ts";

requireFullstackEnvironment(process.env);
const environment: NodeJS.ProcessEnv = { ...process.env, ROLEDAWN_FORM_DRIVER: "agents", ROLEDAWN_AUTOPILOT_ENABLED: "true" };
const scope = createFullstackScope();
const directory = resolve("artifacts", "acceptance", `delivery-fullstack-${scope.runId}`);
await mkdir(directory, { recursive: true, mode: 0o700 });
const statePath = resolve(directory, "cleanup.json");
const sqlPath = resolve(directory, "operation.sql");
const admin = createSupabaseAdminClient(FULLSTACK_RELEASE, environment);
const candidate = createClient<Database>(environment.NEXT_PUBLIC_SUPABASE_URL!, environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const repository = createApplicationAutopilotRepository(admin);
const browser = new Browserbase({ apiKey: environment.BROWSERBASE_API_KEY, maxRetries: 0, timeout: 20_000 });
const agents = createOpenAIAgentsClient({ apiKey: environment.OPENAI_API_KEY! });
const fixture = await createRoutedSyntheticAtsDelivery(scope.runId);
const resources = new Map<string, { kind: "AGENT" | "BROWSER"; deleted: boolean }>();
const storage: { bucket: "career-vault" | "application-artifacts"; path: string }[] = [];
let createdUser = false; let createdWorkspace = false; let passed = false; let autopilotId: string | null = null; let toolCalls = 0;
const progress = (phase: string, fields: Record<string, unknown> = {}) => process.stdout.write(`${JSON.stringify({ phase, ...fields })}\n`);
const persist = () => writeFile(statePath, `${JSON.stringify({ release: FULLSTACK_RELEASE, scope, storage, resources: [...resources], autopilotId, createdUser, createdWorkspace }, null, 2)}\n`, { mode: 0o600 });
async function query(sql: string) { return executeFullstackSql(sql, sqlPath); }
async function upload(bucket: "career-vault" | "application-artifacts", path: string, bytes: Uint8Array, contentType: string) {
  storage.push({ bucket, path }); await persist();
  const result = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (result.error) throw new Error("FULLSTACK_ARTIFACT_UPLOAD_FAILED");
}
try {
  const preflight = await query("select to_regprocedure('public.claim_application_autopilot(text,integer,uuid)') is not null as scoped_claim_ready;");
  assert.equal(preflight[0]?.scoped_claim_ready, true, "Scoped claim migration must be reviewed and applied first");
  progress("creating_isolated_candidate");
  const password = randomBytes(32).toString("base64url");
  const created = await admin.auth.admin.createUser({ email: scope.email, password, email_confirm: true,
    app_metadata: { roledawn_delivery_acceptance_run_id: scope.runId }, user_metadata: { display_name: `RoleDawn Delivery ${scope.runId}` } });
  if (created.error || !created.data.user) throw new Error("FULLSTACK_AUTH_CREATE_FAILED");
  scope.userId = created.data.user.id; createdUser = true; await persist();
  const signedIn = await candidate.auth.signInWithPassword({ email: scope.email, password });
  if (signedIn.error || signedIn.data.user?.id !== scope.userId) throw new Error("FULLSTACK_AUTH_SESSION_FAILED");
  const boot = await candidate.rpc("bootstrap_personal_workspace", { p_display_name: `RoleDawn Delivery ${scope.runId}` });
  if (boot.error || !boot.data?.[0]) throw new Error("FULLSTACK_BOOTSTRAP_FAILED");
  scope.workspaceId = boot.data[0].workspace_id; scope.candidateId = boot.data[0].candidate_id; createdWorkspace = true; await persist();
  const fact = await candidate.rpc("save_candidate_fact", { p_command_id: randomUUID(), p_fact_key: "identity.legal_name", p_normalized_text: "Alex Synthetic", p_value_json: "Alex Synthetic" });
  if (fact.error || !fact.data?.[0]) throw new Error("FULLSTACK_FACT_SAVE_FAILED");
  const text = "Alex Synthetic\nEXPERIENCE\nSynthetic delivery fixture\nBuilt a local test form and verified that a single authorized submission produces a receipt.\nThis fictional profile exists only for software acceptance testing.";
  const artifacts = await renderApplicationKit({ sourceResumeText: text, exactFacts: { legalName: "Alex Synthetic", contactLines: [scope.email], factVersionIds: [fact.data[0].fact_version_id] },
    proposal: { schemaVersion: 1, inputSnapshotId: scope.snapshotId, snapshotHash: syntheticHash(text), target: { employerName: "RoleDawn Synthetic Fixture", title: "Synthetic delivery acceptance" }, claims: [],
      resume: { handling: "TAILOR_FROM_APPROVED_EVIDENCE", mode: "REORDER_AND_TIGHTEN", text, claimIds: [] },
      coverLetter: { title: "Synthetic acceptance only", paragraphs: [{ paragraphId: "fixture", claimIds: [], text: "This fictional application exercises the software delivery pipeline against a controlled test form. It is never intended for an employer, and it contains no real candidate information." }] } } });
  const source = artifacts.find((artifact) => artifact.variant === "RESUME_PDF")!;
  const sourcePath = `${scope.workspaceId}/${scope.candidateId}/${scope.documentId}/synthetic-resume.pdf`;
  await upload("career-vault", sourcePath, source.bytes, source.mimeType);
  const staged = artifacts.map((artifact) => ({ ...artifact, id: randomUUID(), path: `${scope.workspaceId}/${scope.candidateId}/${scope.applicationId}/${scope.runId}/${artifact.displayName}` }));
  for (const artifact of staged) await upload("application-artifacts", artifact.path, artifact.bytes, artifact.mimeType);
  const seed = buildFullstackSeedSql({ scope, text, sourcePath, sourceArtifact: source, artifacts: staged, factVersionIds: [fact.data[0].fact_version_id], writingPolicy: (await loadApplicationWritingPolicy()).provenance });
  await writeFile(resolve(directory, "seed.sql"), seed.sql, { mode: 0o600 });
  await writeFile(resolve(directory, "cleanup.sql"), buildFullstackCleanupSql(scope), { mode: 0o600 });
  assert.equal((await query(seed.sql))[0]?.synthetic_seed_created, true);
  // Candidate RPC is the production authority boundary. The UI-only Greenhouse
  // availability filter is intentionally bypassed for this reserved test origin.
  const delegation = await candidate.rpc("delegate_application_autopilot", { p_command_id: randomUUID(), p_application_id: scope.applicationId, p_expected_aggregate_version: 1, p_revision_id: scope.revisionId, p_packet_hash: seed.packetHash });
  if (delegation.error || !delegation.data || typeof delegation.data !== "object" || Array.isArray(delegation.data) || typeof delegation.data.id !== "string") throw new Error("FULLSTACK_DELEGATION_FAILED");
  autopilotId = delegation.data.id; await persist();
  const observedRepository = { ...repository,
    async bindRuntime(lease: Parameters<typeof repository.bindRuntime>[0], reference: string | null) { await repository.bindRuntime(lease, reference); if (reference) resources.set(reference, { kind: "BROWSER", deleted: false }); await persist(); },
    async setAgentSession(lease: Parameters<typeof repository.setAgentSession>[0], reference: string | null) { await repository.setAgentSession(lease, reference); if (reference) resources.set(reference, { kind: "AGENT", deleted: false }); await persist(); },
    ledger(lease: Parameters<typeof repository.ledger>[0]) { const ledger = repository.ledger(lease); return { ...ledger, async begin(key: Parameters<typeof ledger.begin>[0]) { toolCalls += 1; progress("model_tool", { tool: key.name }); return ledger.begin(key); } }; },
  };
  for (let pass = 1; pass <= 2; pass += 1) {
    progress("claiming_exact_application", { pass });
    const claim = await repository.claim(`synthetic:${scope.runId}`, AUTOPILOT_LEASE_SECONDS, autopilotId);
    assert.ok(claim); assert.equal(claim.applicationId, scope.applicationId); assert.equal(claim.destinationUrl, fixture.policy.startUrl);
    const outcome = await runApplicationAutopilotClaim(claim, { environment, repository: observedRepository, sitePolicy: fixture.policy, requestTransport: fixture.requestTransport });
    const diagnostic = await admin.from("application_autopilots").select("failure_code").eq("id", autopilotId).single();
    progress("worker_completed", { pass, outcome: outcome.outcome, reason: diagnostic.data?.failure_code ?? null });
    const view = await getApplicationAutopilot(candidate, scope.applicationId);
    assert.ok(view);
    if (pass === 1) {
      assert.equal(outcome.outcome, "QUESTIONS_REQUIRED"); assert.equal(view.status, "WAITING_ANSWERS"); assert.equal(fixture.requests.submits, 0);
      assert.equal(view.questions.length, 1); const question = view.questions[0]!; assert.equal(question.kind, "BOOLEAN");
      await saveApplicationAutopilotAnswers(candidate, { commandId: randomUUID(), id: view.id, expectedVersion: view.version, answers: [{ questionId: question.id, fingerprint: question.fingerprint, value: true }] });
    } else { assert.equal(outcome.outcome, "CONFIRMED"); assert.equal(view.status, "CONFIRMED"); }
  }
  const attempts = await admin.from("application_attempts").select("id").eq("application_id", scope.applicationId);
  const receipts = await admin.from("receipts").select("id,attempt_id,confirmation_reference").eq("application_id", scope.applicationId);
  assert.ifError(attempts.error); assert.ifError(receipts.error); assert.equal(attempts.data?.length, 1); assert.equal(receipts.data?.length, 1);
  assert.equal(receipts.data![0].attempt_id, attempts.data![0].id); assert.equal(receipts.data![0].confirmation_reference, fixture.policy.receipt.url);
  assert.equal(fixture.requests.submits, 1); assert.equal(fixture.requests.uploads.length, 2); assert.equal(fixture.requests.leaks, 0); assert.ok(toolCalls > 0);
  assert.equal(await repository.claim(`synthetic:${scope.runId}`, 300, autopilotId), null);
  await writeFile(resolve(directory, "delivery-proof.json"), `${JSON.stringify({ candidateDelegationRpc: true, candidateAnswerRpc: true, targetedClaim: true, restartedBrowser: true, hostedAttempts: attempts.data!.length, hostedReceipts: receipts.data!.length, confirmedNotReclaimable: true, syntheticSubmissions: fixture.requests.submits, acknowledgedUploads: fixture.requests.uploads.length, blockedLeakCount: fixture.requests.leaks, toolCalls }, null, 2)}\n`, { mode: 0o600 });
  passed = true;
} finally {
  progress("cleaning_isolated_resources");
  await fixture.close();
  if (createdUser && !createdWorkspace) {
    const found = await admin.from("workspaces").select("id,name").eq("personal_owner_auth_user_id", scope.userId).maybeSingle();
    if (found.error) throw new Error("FULLSTACK_BOOTSTRAP_RECONCILIATION_FAILED");
    if (found.data) {
      assert.equal(found.data.name, scope.workspaceName);
      const owner = await admin.from("candidates").select("id").eq("workspace_id", found.data.id).eq("auth_user_id", scope.userId).single();
      if (owner.error) throw new Error("FULLSTACK_CANDIDATE_RECONCILIATION_FAILED");
      scope.workspaceId = found.data.id; scope.candidateId = owner.data.id; createdWorkspace = true; await persist();
    }
  }
  const recordedResources = createdWorkspace ? await query(buildFullstackResourcesSql(scope)) : [];
  for (const item of recordedResources) {
    if (typeof item.id !== "string" || typeof item.reference !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(item.reference) || !["AGENT", "BROWSER"].includes(String(item.kind))) throw new Error("FULLSTACK_CLEANUP_RESOURCE_INVALID");
    resources.set(item.reference, { kind: item.kind as "AGENT" | "BROWSER", deleted: false });
  }
  for (const [reference, resource] of resources) {
    if (resource.kind === "AGENT") await agents.deleteSession(reference, AbortSignal.timeout(15_000));
    else {
      let state = await browser.sessions.retrieve(reference);
      if (["RUNNING", "PENDING"].includes(state.status)) { await browser.sessions.update(reference, { status: "REQUEST_RELEASE" }); state = await browser.sessions.retrieve(reference); }
      assert.ok(!["RUNNING", "PENDING"].includes(state.status), "Browserbase release must be acknowledged");
    }
    const record = recordedResources.find((item) => item.reference === reference && item.kind === resource.kind);
    if (record) await repository.acknowledgeDelete(String(record.id));
    resource.deleted = true; await persist();
  }
  for (const bucket of ["career-vault", "application-artifacts"] as const) {
    const paths = storage.filter((item) => item.bucket === bucket).map((item) => item.path);
    if (paths.length) { const result = await admin.storage.from(bucket).remove(paths); if (result.error) throw new Error("FULLSTACK_STORAGE_CLEANUP_FAILED"); }
  }
  await candidate.auth.signOut().catch(() => undefined);
  if (createdWorkspace) assert.equal((await query(buildFullstackCleanupSql(scope)))[0]?.synthetic_database_rows_deleted, true);
  if (createdUser) { const result = await admin.auth.admin.deleteUser(scope.userId); if (result.error) throw new Error("FULLSTACK_AUTH_CLEANUP_FAILED"); }
  const absence = await query(buildFullstackCleanupVerificationSql(scope));
  assert.ok(absence[0] && Object.values(absence[0]).every((count) => Number(count) === 0), "Every exact synthetic scope count must be zero");
  await writeFile(resolve(directory, "cleanup-proof.json"), `${JSON.stringify(absence, null, 2)}\n`, { mode: 0o600 });
  await writeFile(resolve(directory, "result.json"), `${JSON.stringify({ passed, syntheticOnly: true, hostedDatabase: true, actualBrowserbase: true, actualAgents: true, toolCalls, browserSessions: [...resources.values()].filter((item) => item.kind === "BROWSER").length, agentSessions: [...resources.values()].filter((item) => item.kind === "AGENT").length, providerDeletionAcknowledged: [...resources.values()].every((item) => item.deleted), syntheticSubmissions: fixture.requests.submits, employerSubmissions: 0, cleanupCompleted: true }, null, 2)}\n`, { mode: 0o600 });
  progress("acceptance_finished", { passed, cleaned: true, output: directory });
}
