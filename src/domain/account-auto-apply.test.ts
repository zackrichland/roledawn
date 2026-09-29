import test from "node:test";
import assert from "node:assert/strict";
import {parseAutoApplyState,validateSetAutoApplyCommand,AutoApplyError} from "./account-auto-apply.ts";
import {readAutoApplyState,setAutoApplyEnabled} from "../server/auto-apply/state.ts";
const state = {enabled:false,status:"OFF",version:0,interval_seconds:3600,daily_cap:24,attempted_today:0,confirmed_today:0,next_submission_at:null,last_checked_at:null,last_outcome:null};
test("auto-apply state is explicit off and distinguishes attempts from confirmed applications",()=>{
 assert.equal(parseAutoApplyState(state).enabled,false);
 assert.equal(parseAutoApplyState({...state,attempted_today:2,confirmed_today:1}).confirmedToday,1);
 for(const invalid of [{...state,enabled:true},{...state,interval_seconds:10},{...state,confirmed_today:1},{...state,last_outcome:"private untrusted error"}]) assert.throws(()=>parseAutoApplyState(invalid),AutoApplyError);
});
test("client commands cannot alter plan caps or choose another candidate",async()=>{
 const calls:unknown[]=[];
 const client={rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return {data:state,error:null};}};
 const command={commandId:"b4094eb0-3f50-4d7d-b52c-225f8019ec3f",expectedVersion:0,enabled:true,dailyCap:500,candidateId:"other"};
 await setAutoApplyEnabled(client,command);
 assert.deepEqual(calls,[["set_auto_apply_enabled",{p_command_id:command.commandId,p_expected_version:0,p_enabled:true}]]);
 assert.throws(()=>validateSetAutoApplyCommand({...command,expectedVersion:-1}),AutoApplyError);
});
test("read failures are explicit and provider contents remain redacted",async()=>{
 await assert.rejects(readAutoApplyState({rpc:async()=>({error:{message:"private candidate content"},data:null})}),error=>error instanceof AutoApplyError && error.code==="AUTO_APPLY_COMMAND_FAILED");
 await assert.rejects(readAutoApplyState({rpc:async()=>({error:{code:"PGRST202"},data:null})}),error=>error instanceof AutoApplyError && error.code==="AUTO_APPLY_UNAVAILABLE");
});
test("explicit deadlock rollback retries the same toggle at most three times; network uncertainty never retries",async()=>{
 const command={commandId:"b4094eb0-3f50-4d7d-b52c-225f8019ec3f",expectedVersion:0,enabled:true};
 const calls:unknown[]=[];
 await setAutoApplyEnabled({rpc:async(_name:string,args:unknown)=>{calls.push(args);return calls.length<3?{data:null,error:{code:"40P01"}}:{data:state,error:null};}},command);
 assert.equal(calls.length,3);assert.deepEqual(calls[0],calls[2]);
 let failures=0;
 await assert.rejects(setAutoApplyEnabled({rpc:async()=>{failures++;throw new Error("network timeout");}},command));
 assert.equal(failures,1);
});
