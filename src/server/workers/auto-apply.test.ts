import test from "node:test";
import assert from "node:assert/strict";
import {runAutoApplyWorkerWithDependencies,parseAutoApplyClaim,type AutoApplyWorkerDependencies} from "./auto-apply.ts";
const claim={candidate_id:"043be946-5aef-4d08-a6f9-170688ad6a17",workspace_id:"08378dde-d878-4682-b1ef-c01a90a95379",lease_token:"e1e9e36e-7c15-486d-8ed9-4da3ff65b311",consent_version:2,candidate_input_version:30,search_profile_version:5};
function deps(results:Record<string,unknown>, recommendations?:unknown){
 const calls:Array<[string,Record<string,unknown>]> = [];
 return {calls,client:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push([name,args]);return {data:results[name]??null,error:null};}},
 recommendations:(async()=>{if(recommendations instanceof Error)throw recommendations;return recommendations;}) as AutoApplyWorkerDependencies["recommendations"]};
}
test("idle and active packet paths never scan or create another application",async()=>{
 const idle=deps({claim_auto_apply_candidate:null},new Error("must not run"));
 assert.deepEqual(await runAutoApplyWorkerWithDependencies(idle),{claimed:0,prepared:0,delegated:0,idle:0,failed:0});
 const active=deps({claim_auto_apply_candidate:claim,advance_auto_apply_candidate:{outcome:"WAITING_APPLICATION"},finish_auto_apply_check:true},new Error("must not run"));
 assert.equal((await runAutoApplyWorkerWithDependencies(active)).idle,1);
 assert.equal(active.calls.some(([name])=>name==="enqueue_auto_apply_match"),false);
});
test("incomplete catalog scan is idle and cannot create a job",async()=>{
 const d=deps({claim_auto_apply_candidate:claim,advance_auto_apply_candidate:{outcome:"SELECT_MATCH"},finish_auto_apply_check:true},
 {candidateInputEpoch:30,complete:false,items:[],profileHash:"a".repeat(64),policyVersion:"matching/1"});
 assert.equal((await runAutoApplyWorkerWithDependencies(d)).idle,1);
 assert.equal(d.calls.at(-1)?.[1].p_outcome,"RANKING_INCOMPLETE");
});
test("empty results are normal and failed candidate reads are isolated/redacted",async()=>{
 for(const [ranked,outcome] of [[{candidateInputEpoch:30,complete:true,items:[]},"NO_MATCHES"],[new Error("candidate private text"),"CHECK_FAILED"]] as const){
  const d=deps({claim_auto_apply_candidate:claim,advance_auto_apply_candidate:{outcome:"SELECT_MATCH"},finish_auto_apply_check:true},ranked);
  const result=await runAutoApplyWorkerWithDependencies(d);
  assert.equal(result.failed,Number(outcome==="CHECK_FAILED"));assert.equal(d.calls.at(-1)?.[1].p_outcome,outcome);
  assert.equal(JSON.stringify(d.calls).includes("candidate private text"),false);
 }
});
test("lost consent lease is not reported as completed and malformed claims fail closed",async()=>{
 const d=deps({claim_auto_apply_candidate:claim,advance_auto_apply_candidate:{outcome:"DELEGATED"},finish_auto_apply_check:false});
 assert.deepEqual(await runAutoApplyWorkerWithDependencies(d),{claimed:1,prepared:0,delegated:0,idle:0,failed:1});
 assert.throws(()=>parseAutoApplyClaim({...claim,consent_version:0}));
});
test("every advance outcome is handled: waiting, rate limits and delegation never scan; unknown outcomes fail closed",async()=>{
 for(const [advanced,finished,summary] of [
  ["WAITING_APPLICATION","WAITING_APPLICATION",{idle:1,delegated:0,failed:0}],
  ["RATE_LIMITED","RATE_LIMITED",{idle:1,delegated:0,failed:0}],
  ["DELEGATED","DELEGATED",{idle:0,delegated:1,failed:0}],
  ["CLOSED_SOMETHING_NEW","CHECK_FAILED",{idle:0,delegated:0,failed:1}],
 ] as const){
  const d=deps({claim_auto_apply_candidate:claim,advance_auto_apply_candidate:{outcome:advanced,application_id:"ignored"},finish_auto_apply_check:true},new Error("must not run"));
  const result=await runAutoApplyWorkerWithDependencies(d);
  assert.equal(d.calls.some(([name])=>name==="enqueue_auto_apply_match"),false,advanced);
  assert.equal(d.calls.at(-1)?.[1].p_outcome,finished,advanced);
  assert.deepEqual({idle:result.idle,delegated:result.delegated,failed:result.failed},summary,advanced);
 }
});
test("after stalled enrollments close, SELECT_MATCH scans and prepares the next eligible job",async()=>{
 const job={jobId:"8f1d7c7e-47a9-4f0c-9a47-5cf3f1c1c2d1",jobVersionId:"6b5c0d1e-3f2a-4b5c-8d7e-9f0a1b2c3d4e",matching:{autoApplyEligible:true}};
 const d=deps({claim_auto_apply_candidate:claim,advance_auto_apply_candidate:{outcome:"SELECT_MATCH"},enqueue_auto_apply_match:{outcome:"PREPARED"},finish_auto_apply_check:true},
  {candidateInputEpoch:30,complete:true,items:[job],profileHash:"a".repeat(64),policyVersion:"matching/1"});
 assert.equal((await runAutoApplyWorkerWithDependencies(d)).prepared,1);
 assert.equal(d.calls.at(-1)?.[1].p_outcome,"PREPARED");
});
