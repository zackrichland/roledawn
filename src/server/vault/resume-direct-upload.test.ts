import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { DIRECT_RESUME_DOCX, DIRECT_RESUME_MAX_BYTES, ResumeDirectUploadError, validateDirectResumeUploadRequest, type DirectResumeUploadRequest } from "../../domain/resume-direct-upload.ts";
import { finalizeDirectResumeUpload, type DirectResumeFinalizationPort, type DirectResumeReservation } from "./resume-direct-upload.ts";

const ids = Array.from({ length: 6 }, (_, i) => `${String(i + 1).padStart(8,"0")}-1111-4111-8111-111111111111`);
const bytes = new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Synthetic Candidate"),new Paragraph("Registered nurse with outpatient clinic experience.")] }] })));
const sourceHash = createHash("sha256").update(bytes).digest("hex");
const reservation: DirectResumeReservation = {
  documentVersionId: ids[0], documentId: ids[1], workspaceId: ids[2], candidateId: ids[3], reservedBy: ids[4],
  path: `${ids[2]}/${ids[3]}/resumes/${ids[1]}/${ids[0]}.docx`, mediaType: DIRECT_RESUME_DOCX, filename: "synthetic.docx", byteSize: bytes.byteLength, sha256: sourceHash,
  status: "RESERVED", reservedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+3600_000).toISOString(), hasExtraction: false,
};
function fixture(overrides: Partial<DirectResumeReservation> = {}, blob: Blob | null = new Blob([bytes], { type: DIRECT_RESUME_DOCX })) {
  const calls: string[] = [];
  const port: DirectResumeFinalizationPort = {
    async readReservation() { calls.push("read"); return { ...reservation, ...overrides }; },
    async download() { calls.push("download"); return blob; },
    async finalize(actor, value, artifact) { calls.push("finalize"); assert.equal(actor, value.reservedBy); assert.equal(artifact.source.sha256, sourceHash); },
    async recordExtraction(value, artifact) { calls.push("extract"); assert.equal(value.reservedAt, reservation.reservedAt); assert.match(artifact.extraction.normalizedText,/Registered nurse/u); },
    async rejectAndCleanup() { calls.push("reject-before-delete"); },
  };
  return { port, calls };
}
test("direct upload accepts verified stored bytes, derives text and finalizes exact source provenance", async () => {
  const f = fixture(); await finalizeDirectResumeUpload(f.port, ids[4], ids[0]);
  assert.deepEqual(f.calls, ["read","download","finalize","extract"]);
});
test("altered size, MIME or hash never reaches finalization and invokes guarded cleanup", async () => {
  for (const f of [fixture({ byteSize: bytes.byteLength+1 }), fixture({},new Blob([bytes],{type:"application/pdf"})), fixture({sha256:"b".repeat(64)})]) {
    await assert.rejects(finalizeDirectResumeUpload(f.port,ids[4],ids[0]), ResumeDirectUploadError);
    assert.deepEqual(f.calls,["read","download","reject-before-delete"]);
  }
});
test("wrong owner, foreign path, expiry and malformed reservation fail before private download", async () => {
  for (const override of [{reservedBy:ids[5]},{path:`${ids[5]}/foreign.docx`},{expiresAt:new Date(Date.now()-1).toISOString()},{expiresAt:"bad"}]) {
    const f = fixture(override); await assert.rejects(finalizeDirectResumeUpload(f.port,ids[4],ids[0]),ResumeDirectUploadError); assert.deepEqual(f.calls,["read"]);
  }
});
test("missing objects and uncertain finalization preserve retryable reservation and bytes", async () => {
  const missing=fixture({},null); await assert.rejects(finalizeDirectResumeUpload(missing.port,ids[4],ids[0]),/not finished uploading/u); assert.deepEqual(missing.calls,["read","download"]);
  const uncertain=fixture(); uncertain.port.finalize=async()=>{ uncertain.calls.push("finalize");throw new Error("response lost"); };
  await assert.rejects(finalizeDirectResumeUpload(uncertain.port,ids[4],ids[0]),/response lost/u); assert.deepEqual(uncertain.calls,["read","download","finalize"]);
});
test("replay skips an already extracted version and repairs a finalized version without rewriting it", async () => {
  const complete=fixture({status:"FINALIZED",hasExtraction:true}); await finalizeDirectResumeUpload(complete.port,ids[4],ids[0]); assert.deepEqual(complete.calls,["read"]);
  const repair=fixture({status:"FINALIZED"}); await finalizeDirectResumeUpload(repair.port,ids[4],ids[0]); assert.deepEqual(repair.calls,["read","download","extract"]);
});
test("ten megabyte selection limit and MIME-extension agreement are enforced before reservation", () => {
  const request: DirectResumeUploadRequest={commandId:ids[0],filename:"synthetic.docx",mediaType:DIRECT_RESUME_DOCX,byteSize:DIRECT_RESUME_MAX_BYTES,sha256:sourceHash};
  validateDirectResumeUploadRequest(request);
  for(const invalid of [{...request,byteSize:DIRECT_RESUME_MAX_BYTES+1},{...request,filename:"synthetic.pdf"},{...request,filename:"../synthetic.docx"}]) assert.throws(()=>validateDirectResumeUploadRequest(invalid),ResumeDirectUploadError);
});
test("a valid stored document above Netlify's six MB transport limit still extracts directly", async () => {
  const archive = await JSZip.loadAsync(bytes);
  archive.file("word/media/fixture-one.bin", new Uint8Array(3_500_000));
  archive.file("word/media/fixture-two.bin", new Uint8Array(3_500_000));
  const large = await archive.generateAsync({ type: "uint8array", compression: "STORE" });
  assert.ok(large.byteLength > 6 * 1024 * 1024 && large.byteLength < DIRECT_RESUME_MAX_BYTES);
  const largeHash = createHash("sha256").update(large).digest("hex");
  const f = fixture({ byteSize: large.byteLength, sha256: largeHash }, new Blob([new Uint8Array(large)], { type: DIRECT_RESUME_DOCX }));
  f.port.finalize = async (_actor, _reservation, artifact) => {
    f.calls.push("finalize"); assert.equal(artifact.source.byteSize, large.byteLength); assert.equal(artifact.source.sha256, largeHash);
  };
  await finalizeDirectResumeUpload(f.port, ids[4], ids[0]);
  assert.deepEqual(f.calls,["read","download","finalize","extract"]);
});
