/** Isolated hosted UI fixture. No jobs, applications, model calls or delivery. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph } from "docx";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { DOCX_MEDIA_TYPE, extractResumeText } from "../src/server/resume/extract-resume.ts";
import { loadCandidateRecommendations } from "../src/server/opportunities/candidate-recommendations.ts";
import { assertFullstackScope, buildFullstackCleanupSql, buildFullstackCleanupVerificationSql, createFullstackScope, executeFullstackSql, FULLSTACK_PROJECT, type FullstackScope } from "./application-delivery-fullstack-lib.ts";

const RELEASE = "hosted-auto-apply-ui-fixture/1";
const CONFIRM = "CREATE_AND_DELETE_ISOLATED_SYNTHETIC_DATA";
type State = { release: typeof RELEASE; scope: FullstackScope; createdUser: boolean; createdWorkspace: boolean; storage: { bucket: "career-vault"; path: string }[]; ready: boolean; cleaned: boolean };
if (process.env.ACCEPTANCE_ACK !== CONFIRM || process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${FULLSTACK_PROJECT}.supabase.co`) throw new Error("UI_FIXTURE_SCOPE_REQUIRED");
const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const candidate = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const [mode = "create", providedPath] = process.argv.slice(2);
if (!["create", "cleanup", "verify"].includes(mode) || mode !== "create" && !providedPath) throw new Error("UI_FIXTURE_COMMAND_INVALID");
const state: State = mode === "create" ? { release: RELEASE, scope: createFullstackScope(), createdUser: false, createdWorkspace: false, storage: [], ready: false, cleaned: false } : JSON.parse(await readFile(resolve(providedPath!), "utf8"));
assert.equal(state.release, RELEASE); assertFullstackScope(state.scope);
const directory = mode === "create" ? resolve("artifacts/acceptance", `auto-apply-ui-${state.scope.runId}`) : resolve(providedPath!, "..");
const statePath = resolve(directory, "cleanup.json");
await mkdir(directory, { recursive: true, mode: 0o700 });
const persist = () => writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
async function query(sql: string) { return executeFullstackSql(sql, resolve(directory, "operation.sql")); }
function checked(error: unknown, code: string): void { if (error) { const value = error as { code?: string }; throw new Error(`${code}:${value.code && /^[A-Za-z0-9_]+$/u.test(value.code) ? value.code : "REMOTE_ERROR"}`); } }
async function identity() {
  const found = await admin.auth.admin.getUserById(state.scope.userId); checked(found.error, "UI_FIXTURE_IDENTITY_READ_FAILED");
  assert.equal(found.data.user?.email, state.scope.email);
  assert.equal(found.data.user?.app_metadata.roledawn_delivery_acceptance_run_id, state.scope.runId);
  assert.equal(found.data.user?.app_metadata.roledawn_ui_fixture_release, RELEASE);
}
async function verify() {
  await identity();
  const checks = await query(`select
    (select status from public.candidates where id='${state.scope.candidateId}' and workspace_id='${state.scope.workspaceId}') as candidate_status,
    cardinality(private.candidate_onboarding_missing_items('${state.scope.workspaceId}','${state.scope.candidateId}')) as onboarding_missing,
    (select count(*) from public.candidate_evidence_items where candidate_id='${state.scope.candidateId}' and review_status='VERIFIED') as approved_evidence,
    (select count(*) from public.applications where workspace_id='${state.scope.workspaceId}') as applications,
    (select count(*) from public.application_autopilots where workspace_id='${state.scope.workspaceId}') as autopilots,
    (select count(*) from public.application_attempts where workspace_id='${state.scope.workspaceId}') as attempts,
    (select count(*) from public.receipts where workspace_id='${state.scope.workspaceId}') as receipts,
    (select count(*) from public.auto_apply_enrollments where workspace_id='${state.scope.workspaceId}') as automatic_enrollments,
    (select enabled from public.candidate_auto_apply_settings where candidate_id='${state.scope.candidateId}') as enabled,
    (select status from public.candidate_auto_apply_settings where candidate_id='${state.scope.candidateId}') as auto_apply_status,
    (select last_checked_at from public.candidate_auto_apply_settings where candidate_id='${state.scope.candidateId}') as last_checked_at,
    (select last_outcome from public.candidate_auto_apply_settings where candidate_id='${state.scope.candidateId}') as last_outcome,
    (select aggregate_version from public.candidate_search_profiles where candidate_id='${state.scope.candidateId}') as search_profile_version,
    (select preferred_locations from public.candidate_search_profiles where candidate_id='${state.scope.candidateId}') as preferred_locations,
    (select version from public.candidate_auto_apply_settings where candidate_id='${state.scope.candidateId}') as consent_version;`);
  assert.equal(checks[0]?.candidate_status, "ACTIVE"); assert.equal(checks[0]?.onboarding_missing, 0);
  for (const key of ["approved_evidence", "applications", "autopilots", "attempts", "receipts", "automatic_enrollments"]) assert.equal(Number(checks[0]?.[key]), 0, key);
  const recommendations = await loadCandidateRecommendations(admin, { candidateId: state.scope.candidateId, workspaceId: state.scope.workspaceId }, { limit: 100, useCatalogCache: false, automaticSelection: true });
  assert.equal(recommendations.complete, true); assert.equal(recommendations.items.length, 0);
  await writeFile(resolve(directory, "verification.json"), `${JSON.stringify({ ...checks[0], recommendations: 0, scannedJobs: recommendations.scannedJobs, complete: recommendations.complete, checkedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return checks[0];
}

if (mode === "cleanup") {
  if (!state.cleaned) {
    await identity();
    // Abort if UI testing unexpectedly created any application; inspect instead
    // of broadening cleanup or touching an uncertain submission.
    const rows = await query(`select
      (select count(*) from public.applications where workspace_id='${state.scope.workspaceId}') as count,
      exists(select 1 from public.candidate_auto_apply_settings where candidate_id='${state.scope.candidateId}' and enabled) as auto_apply_enabled,
      exists(select 1 from private.auto_apply_runtime where candidate_id='${state.scope.candidateId}' and lease_token is not null and lease_expires_at>statement_timestamp()) as active_lease;`);
    assert.equal(Number(rows[0]?.count), 0, "UI_FIXTURE_UNEXPECTED_APPLICATION");
    assert.equal(rows[0]?.auto_apply_enabled, false, "UI_FIXTURE_DISABLE_AUTO_APPLY_BEFORE_CLEANUP");
    assert.equal(rows[0]?.active_lease, false, "UI_FIXTURE_WAIT_FOR_ACTIVE_CHECK_BEFORE_CLEANUP");
    for (const entry of state.storage) {
      assert.equal(entry.bucket, "career-vault"); assert.ok(entry.path.startsWith(`${state.scope.workspaceId}/`));
      checked((await admin.storage.from(entry.bucket).remove([entry.path])).error, "UI_FIXTURE_STORAGE_CLEANUP_FAILED");
    }
    await query(buildFullstackCleanupSql(state.scope));
    checked((await admin.auth.admin.deleteUser(state.scope.userId)).error, "UI_FIXTURE_AUTH_CLEANUP_FAILED");
    state.cleaned = true; await persist();
  }
  const rows = await query(buildFullstackCleanupVerificationSql(state.scope));
  const automaticRows = await query(`select
    (select count(*) from public.candidate_auto_apply_settings where candidate_id='${state.scope.candidateId}') as auto_apply_settings,
    (select count(*) from public.auto_apply_enrollments where workspace_id='${state.scope.workspaceId}') as auto_apply_enrollments,
    (select count(*) from private.auto_apply_runtime where candidate_id='${state.scope.candidateId}') as auto_apply_runtime;`);
  const proof = { ...rows[0], ...automaticRows[0] };
  assert.ok(Object.values(proof).every(value => Number(value) === 0));
  await rm(resolve(directory, "login-url.txt"), { force: true });
  await writeFile(resolve(directory, "cleanup-proof.json"), `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: "CLEANED", proofPath: resolve(directory, "cleanup-proof.json") }));
} else if (mode === "verify") {
  await verify(); console.log(JSON.stringify({ status: "VERIFIED", proofPath: resolve(directory, "verification.json") }));
} else {
  await persist();
  try {
    const password = randomBytes(32).toString("base64url");
    const user = await admin.auth.admin.createUser({ email: state.scope.email, password, email_confirm: true,
      app_metadata: { roledawn_delivery_acceptance_run_id: state.scope.runId, roledawn_ui_fixture_release: RELEASE },
      user_metadata: { display_name: `RoleDawn Delivery ${state.scope.runId}` } });
    checked(user.error, "UI_FIXTURE_AUTH_CREATE_FAILED"); assert.ok(user.data.user);
    state.scope.userId = user.data.user.id; state.createdUser = true; await persist();
    checked((await candidate.auth.signInWithPassword({ email: state.scope.email, password })).error, "UI_FIXTURE_SIGN_IN_FAILED");
    const boot = await candidate.rpc("bootstrap_personal_workspace", { p_display_name: `RoleDawn Delivery ${state.scope.runId}` });
    checked(boot.error, "UI_FIXTURE_BOOTSTRAP_FAILED"); assert.ok(boot.data?.[0]);
    state.scope.workspaceId = boot.data[0].workspace_id; state.scope.candidateId = boot.data[0].candidate_id; state.createdWorkspace = true; await persist();
    const facts: Record<string, string> = { "identity.given_name": "Alex", "identity.family_name": "Fixture", "identity.legal_name": "Alex Fixture",
      "contact.application_email": state.scope.email, "contact.phone": "+12025550199", "location.city": "Example City", "location.region": "VA", "location.country_code": "US" };
    for (const [key, value] of Object.entries(facts)) {
      const rpc = key === "identity.given_name" || key === "identity.family_name" ? "save_candidate_identity_name_fact" : "save_candidate_fact";
      checked((await candidate.rpc(rpc, { p_command_id: randomUUID(), p_fact_key: key, p_normalized_text: value, p_value_json: value })).error, "UI_FIXTURE_FACT_SAVE_FAILED");
    }
    const text = "Alex Fixture\nThis fictional record exists only to test the RoleDawn interface.\nNoCatalogRoleNoMatch\nNo professional experience, credentials, employer history or application authority is asserted by this fixture.";
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: text.split("\n").map(line => new Paragraph(line)) }] }));
    const extraction = await extractResumeText({ bytes: new Uint8Array(bytes), filename: "synthetic-ui-resume.docx", declaredMediaType: DOCX_MEDIA_TYPE });
    assert.equal(extraction.ok, true); if (!extraction.ok) throw new Error("UI_FIXTURE_EXTRACTION_FAILED");
    const artifact = extraction.value;
    const reserved = await candidate.rpc("reserve_resume_upload", { p_command_id: randomUUID(), p_display_name: artifact.source.filename, p_mime_type: DOCX_MEDIA_TYPE, p_byte_size: bytes.length });
    checked(reserved.error, "UI_FIXTURE_RESERVATION_FAILED"); assert.ok(reserved.data?.[0]); const reservation = reserved.data[0];
    state.scope.documentId = reservation.document_id; state.scope.documentVersionId = reservation.document_version_id;
    state.storage.push({ bucket: "career-vault", path: reservation.storage_object_path }); await persist();
    checked((await candidate.storage.from("career-vault").upload(reservation.storage_object_path, bytes, { contentType: DOCX_MEDIA_TYPE, upsert: false })).error, "UI_FIXTURE_STORAGE_FAILED");
    checked((await admin.rpc("finalize_resume_upload", { p_actor_id: state.scope.userId, p_command_id: randomUUID(), p_document_version_id: reservation.document_version_id, p_sha256: artifact.source.sha256, p_byte_size: bytes.length })).error, "UI_FIXTURE_FINALIZE_FAILED");
    const recorded = await admin.rpc("record_resume_extraction", { p_document_version_id: reservation.document_version_id, p_attempt_number: 1, p_status: "SUCCEEDED", p_extractor_kind: "LOCAL_DETERMINISTIC", p_extractor_release: artifact.extraction.parserRelease,
      p_output_schema_version: `resume-text/${artifact.schemaVersion}`, p_source_sha256: artifact.source.sha256, p_extracted_text: artifact.extraction.normalizedText, p_text_sha256: artifact.extraction.sha256,
      p_page_count: artifact.extraction.pageCount ?? 1, p_language_code: null as unknown as string, p_warnings: [...artifact.extraction.warnings], p_failure_code: null as unknown as string, p_started_at: new Date().toISOString() });
    checked(recorded.error, "UI_FIXTURE_EXTRACTION_RECORD_FAILED"); assert.ok(recorded.data?.[0]);
    state.scope.extractionId = recorded.data[0].extraction_id;
    const review = await candidate.rpc("review_resume_text", { p_command_id: randomUUID(), p_document_id: reservation.document_id, p_extraction_id: recorded.data[0].extraction_id, p_expected_aggregate_version: recorded.data[0].aggregate_version, p_reviewed_text: artifact.extraction.normalizedText, p_text_sha256: artifact.extraction.sha256 });
    checked(review.error, "UI_FIXTURE_REVIEW_FAILED"); assert.ok(review.data?.[0]); state.scope.reviewId = review.data[0].review_id; await persist();
    checked((await candidate.rpc("save_candidate_search_profile", { p_command_id: randomUUID(), p_target_roles: ["NoCatalogRoleNoMatch"], p_preferred_locations: [], p_desired_country_codes: ["US"], p_work_modes: ["REMOTE"], p_employment_types: ["FULL_TIME"] })).error, "UI_FIXTURE_SEARCH_PROFILE_FAILED");
    checked((await candidate.rpc("complete_candidate_onboarding", { p_command_id: randomUUID() })).error, "UI_FIXTURE_ONBOARDING_FAILED");
    await verify();
    const login = await admin.auth.admin.generateLink({ type: "magiclink", email: state.scope.email, options: { redirectTo: "https://roledawn.netlify.app/auth/confirm" } });
    checked(login.error, "UI_FIXTURE_LOGIN_LINK_FAILED"); assert.ok(login.data.properties?.hashed_token);
    const loginUrl = new URL("https://roledawn.netlify.app/auth/confirm"); loginUrl.searchParams.set("token_hash", login.data.properties.hashed_token); loginUrl.searchParams.set("type", "email"); loginUrl.searchParams.set("next", "/dashboard");
    await writeFile(resolve(directory, "login-url.txt"), loginUrl.href, { mode: 0o600 });
    state.ready = true; await persist();
    console.log(JSON.stringify({ status: "READY", statePath, loginPath: resolve(directory, "login-url.txt"), proofPath: resolve(directory, "verification.json") }));
  } catch (error) {
    await persist();
    throw new Error(`${error instanceof Error ? error.message : "UI_FIXTURE_CREATE_FAILED"}; cleanup state: ${statePath}`);
  }
}
