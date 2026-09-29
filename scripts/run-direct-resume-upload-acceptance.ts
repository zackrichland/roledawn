import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { DIRECT_RESUME_DOCX } from "../src/domain/resume-direct-upload.ts";
import { finalizeDirectResumeUpload, type DirectResumeReservation } from "../src/server/vault/resume-direct-upload.ts";

// Real provider proof, with owned synthetic identities and unconditional cleanup.
// No application, job submission, real candidate, or signed upload token is used.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const project = process.env.ACCEPTANCE_EXPECTED_PROJECT_REF;
if (process.env.ACCEPTANCE_ACK !== "I_UNDERSTAND_THIS_CREATES_TEST_DATA" || !project || new URL(url).hostname !== `${project}.supabase.co`) throw new Error("ACCEPTANCE_SCOPE_REQUIRED");
const runId = randomUUID();
const makeClient = (key: string) => createClient(url,key, {
  auth: { persistSession:false,autoRefreshToken:false,detectSessionInUrl:false },
  global: { fetch: (input,init) => fetch(input,{...init,signal:AbortSignal.timeout(30000)}) },
});
const admin = makeClient(process.env.SUPABASE_SECRET_KEY!);
type Identity = { userId:string; email:string; client:ReturnType<typeof makeClient>; workspaceId?:string };
const identities: Identity[]=[]; const paths:string[]=[]; const checks:string[]=[];
const artifactPath=`artifacts/acceptance/direct-resume-${runId}.json`;
let mainFailure:string|null=null; const cleanupFailures:string[]=[];
function ok(error: unknown, code:string) {
  if(error) {
    const value=error as {code?:unknown;status?:unknown};
    const safeCode=typeof value.code==="string"&&/^[a-zA-Z0-9_]{1,80}$/u.test(value.code)?value.code:"provider_error";
    const status=typeof value.status==="number"?String(value.status):"unknown";
    throw new Error(`${code}:${safeCode}:${status}`);
  }
}
async function saveEvidence() {
  await mkdir("artifacts/acceptance",{recursive:true});
  await writeFile(artifactPath,JSON.stringify({runId,project,checks,mainFailure,cleanupFailures,
    identities:identities.map(({userId,email,workspaceId})=>({userId,email,workspaceId})),paths},null,2),{mode:0o600});
}
async function identity(label:string) {
  const email=`roledawn-upload-${runId}-${label}@acceptance.invalid`;
  const password=`Aa1!${randomUUID()}`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{roledawn_acceptance_run_id:runId}});
  ok(created.error,"SYNTHETIC_AUTH_CREATE_FAILED"); assert.ok(created.data.user);
  const client=makeClient(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  const entry:Identity={userId:created.data.user.id,email,client}; identities.push(entry); await saveEvidence();
  ok((await client.auth.signInWithPassword({email,password})).error,"SYNTHETIC_SIGN_IN_FAILED");
  const bootstrap=await client.rpc("bootstrap_personal_workspace",{p_display_name:`Synthetic Direct Upload ${label}`});
  ok(bootstrap.error,"SYNTHETIC_BOOTSTRAP_FAILED"); entry.workspaceId=bootstrap.data[0].workspace_id; await saveEvidence(); return entry;
}
try {
  const actor=await identity("owner"); const other=await identity("other");
  const archive=await JSZip.loadAsync(await Packer.toBuffer(new Document({sections:[{children:[new Paragraph("Synthetic Candidate"),new Paragraph("Nurse with outpatient clinic experience. Synthetic acceptance document.")]}]})));
  archive.file("word/media/fixture-one.bin",new Uint8Array(3500000)); archive.file("word/media/fixture-two.bin",new Uint8Array(3500000));
  const bytes=new Uint8Array(await archive.generateAsync({type:"uint8array",compression:"STORE"}));
  assert.ok(bytes.byteLength>6*1024*1024 && bytes.byteLength<10*1024*1024);
  const sha=createHash("sha256").update(bytes).digest("hex"), commandId=randomUUID();
  const reserveArgs={p_command_id:commandId,p_display_name:"synthetic.docx",p_mime_type:DIRECT_RESUME_DOCX,p_byte_size:bytes.byteLength,p_sha256:sha};
  const reserved=await actor.client.rpc("reserve_direct_resume_upload",reserveArgs); ok(reserved.error,"RESERVATION_FAILED");
  const target=reserved.data as {document_version_id:string;storage_object_path:string}; const versionId=target.document_version_id;
  assert.ok(target.storage_object_path.startsWith(`${actor.workspaceId}/`)); paths.push(target.storage_object_path); await saveEvidence();
  const replay=await actor.client.rpc("reserve_direct_resume_upload",reserveArgs); ok(replay.error,"RESERVATION_REPLAY_FAILED");assert.equal(replay.data.document_version_id,versionId);
  assert.ok((await actor.client.rpc("reserve_direct_resume_upload",{...reserveArgs,p_sha256:"b".repeat(64)})).error);
  checks.push("durable_reservation_hash_replay");
  const foreign=await other.client.from("source_document_upload_reservations").select("id").eq("document_version_id",versionId);
  ok(foreign.error,"FOREIGN_RESERVATION_READ_FAILED");assert.ok(foreign.data);assert.equal(foreign.data.length,0);
  const denied=await other.client.storage.from("career-vault").upload(target.storage_object_path,new Uint8Array([1]),{contentType:DIRECT_RESUME_DOCX,upsert:false}); assert.ok(denied.error);
  checks.push("cross_tenant_reservation_and_upload_denied");
  const uploaded=await actor.client.storage.from("career-vault").upload(target.storage_object_path,bytes,{contentType:DIRECT_RESUME_DOCX,upsert:false});ok(uploaded.error,"LARGE_DIRECT_UPLOAD_FAILED");
  checks.push("authenticated_private_storage_upload_above_6mb");
  const overwritten=await actor.client.storage.from("career-vault").upload(target.storage_object_path,new Uint8Array([1]),{contentType:DIRECT_RESUME_DOCX,upsert:true});assert.ok(overwritten.error);
  checks.push("overwrite_denied");
  const port = {
    async readReservation() {
      const result=await actor.client.from("source_document_upload_reservations").select("*").eq("document_version_id",versionId).single();ok(result.error,"RESERVATION_READ_FAILED");const row=result.data;
      const extraction=await actor.client.from("source_document_extractions").select("id").eq("document_version_id",versionId).eq("status","SUCCEEDED");ok(extraction.error,"EXTRACTION_READ_FAILED");assert.ok(extraction.data);
      return {documentVersionId:versionId,documentId:row.document_id,workspaceId:row.workspace_id,candidateId:row.candidate_id,reservedBy:row.reserved_by,
        path:row.storage_object_path,mediaType:row.mime_type,filename:row.display_name,byteSize:row.expected_byte_size,sha256:row.expected_sha256,
        status:row.status,expiresAt:row.expires_at,reservedAt:row.reserved_at,hasExtraction:extraction.data.length>0} as DirectResumeReservation;
    },
    async download() { const result=await admin.storage.from("career-vault").download(target.storage_object_path);ok(result.error,"PRIVATE_DOWNLOAD_FAILED");return result.data; },
    async finalize(actorId:string,reservation:DirectResumeReservation,artifact:Parameters<Parameters<typeof finalizeDirectResumeUpload>[0]["finalize"]>[2]) {
      const result=await admin.rpc("finalize_resume_upload",{p_actor_id:actorId,p_command_id:versionId,p_document_version_id:reservation.documentVersionId,p_sha256:artifact.source.sha256,p_byte_size:artifact.source.byteSize});ok(result.error,"FINALIZE_FAILED");
    },
    async recordExtraction(reservation:DirectResumeReservation,artifact:Parameters<Parameters<typeof finalizeDirectResumeUpload>[0]["recordExtraction"]>[1]) {
      const result=await admin.rpc("record_resume_extraction",{p_document_version_id:versionId,p_attempt_number:1,p_status:"SUCCEEDED",p_extractor_kind:"LOCAL_DETERMINISTIC",p_extractor_release:artifact.extraction.parserRelease,
        p_output_schema_version:`resume-text/${artifact.schemaVersion}`,p_source_sha256:artifact.source.sha256,p_extracted_text:artifact.extraction.normalizedText,p_text_sha256:artifact.extraction.sha256,
        p_page_count:artifact.extraction.pageCount,p_language_code:null,p_warnings:[...artifact.extraction.warnings],p_failure_code:null,p_started_at:reservation.reservedAt});ok(result.error,"EXTRACTION_RECORD_FAILED");
    },
    async rejectAndCleanup() { throw new Error("VALID_FIXTURE_REJECTED"); },
  };
  await finalizeDirectResumeUpload(port,actor.userId,versionId); await finalizeDirectResumeUpload(port,actor.userId,versionId);
  const version=await actor.client.from("source_document_versions").select("sha256,byte_size").eq("id",versionId).single();ok(version.error,"FINAL_VERSION_READ_FAILED");assert.ok(version.data);assert.equal(version.data.sha256,sha);assert.equal(version.data.byte_size,bytes.byteLength);
  checks.push("server_rehash_extraction_and_idempotent_finalization");
  const rejected=await admin.rpc("reject_direct_resume_upload",{p_actor_id:actor.userId,p_document_version_id:versionId,p_expected_sha256:sha});ok(rejected.error,"FINALIZED_REJECTION_CHECK_FAILED");assert.equal(rejected.data,false);
  checks.push("finalized_file_protected_from_rejection_cleanup");
} catch(error) { mainFailure=error instanceof Error?error.message:"ACCEPTANCE_FAILED"; }
finally {
  for(const entry of identities) {
    try {
      const user=await admin.auth.admin.getUserById(entry.userId);ok(user.error,"CLEANUP_IDENTITY_READ_FAILED");
      assert.ok(user.data.user);assert.equal(user.data.user.email,entry.email);assert.equal(user.data.user.app_metadata.roledawn_acceptance_run_id,runId);
      const workspace=await admin.from("workspaces").select("id,personal_owner_auth_user_id").eq("personal_owner_auth_user_id",entry.userId).maybeSingle();ok(workspace.error,"CLEANUP_WORKSPACE_READ_FAILED");
      if(workspace.data) {
        const workspaceId=workspace.data.id;
        assert.equal(workspace.data.personal_owner_auth_user_id,entry.userId);
        const documents=await admin.from("source_documents").select("id,status,aggregate_version").eq("workspace_id",workspace.data.id);ok(documents.error,"CLEANUP_DOCUMENT_READ_FAILED");
        assert.ok(documents.data);
        for(const document of documents.data) {
          if(document.status!=="DELETION_PENDING") ok((await entry.client.rpc("request_source_document_deletion",{p_command_id:randomUUID(),p_document_id:document.id,p_expected_aggregate_version:document.aggregate_version})).error,"CLEANUP_DELETION_REQUEST_FAILED");
        }
        const ownedPaths=paths.filter(path=>path.startsWith(`${workspaceId}/`));
        if(ownedPaths.length)ok((await admin.storage.from("career-vault").remove(ownedPaths)).error,"CLEANUP_STORAGE_FAILED");
        for(const document of documents.data) { const result=await admin.rpc("complete_source_document_deletion",{p_document_id:document.id});ok(result.error,"CLEANUP_PURGE_FAILED");assert.equal(result.data,true); }
        ok((await admin.from("workspaces").delete().eq("id",workspace.data.id).eq("personal_owner_auth_user_id",entry.userId)).error,"CLEANUP_WORKSPACE_FAILED");
      }
      ok((await admin.auth.admin.deleteUser(entry.userId,false)).error,"CLEANUP_AUTH_FAILED");
    } catch(error) { cleanupFailures.push(error instanceof Error?error.message:"CLEANUP_FAILED"); }
  }
  await saveEvidence();
}
process.stdout.write(JSON.stringify({status:mainFailure||cleanupFailures.length?"FAIL":"PASS",checks,mainFailure,cleanupFailures,artifactPath})+"\n");
if(mainFailure||cleanupFailures.length) process.exitCode=1;
