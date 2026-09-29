/** Two real database connections, one isolated candidate, no jobs or enabled consent. */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin.ts";
const env=process.env;
if(env.RUN_AUTO_APPLY_CONCURRENCY_ACCEPTANCE!=="CREATE_AND_DELETE_ISOLATED_SYNTHETIC_DATA" || env.NEXT_PUBLIC_SUPABASE_URL!=="https://dxrrotrugwhquqxyoisk.supabase.co") throw new Error("AUTO_APPLY_CONCURRENCY_EXPLICIT_PROJECT_REQUIRED");
const admin=createSupabaseAdminClient("auto-apply-concurrency-acceptance/1");
const runId=randomUUID(); const email=`roledawn-auto-apply-${runId}@acceptance.invalid`; const display=`RoleDawn Auto Apply ${runId}`; const password=randomUUID()+randomUUID();
let userId:string|undefined; let workspaceId:string|undefined;
try {
 const user=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{roledawn_auto_apply_acceptance:runId}});
 if(user.error || !user.data.user) throw new Error("AUTO_APPLY_FIXTURE_AUTH_FAILED"); userId=user.data.user.id;
 const makeClient=()=>createClient(env.NEXT_PUBLIC_SUPABASE_URL!,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const first=makeClient(),second=makeClient();
 const signins=await Promise.all([first.auth.signInWithPassword({email,password}),second.auth.signInWithPassword({email,password})]);
 if(signins.some(r=>r.error)) throw new Error("AUTO_APPLY_FIXTURE_LOGIN_FAILED");
 const boot=await first.rpc("bootstrap_personal_workspace",{p_display_name:display});
 if(boot.error || !boot.data?.[0]?.workspace_id) throw new Error("AUTO_APPLY_FIXTURE_BOOTSTRAP_FAILED");workspaceId=boot.data[0].workspace_id;
 const commands=[randomUUID(),randomUUID()];
 const results=await Promise.all([first,second].map((client,index)=>client.rpc("set_auto_apply_enabled",{p_command_id:commands[index],p_expected_version:0,p_enabled:false})));
 if(results.filter(r=>!r.error).length!==1 || results.filter(r=>r.error?.code==="PT409").length!==1) throw new Error("AUTO_APPLY_CONCURRENT_VERSION_GUARD_FAILED");
 const winner=results.findIndex(r=>!r.error);
 const replays=await Promise.all([first,second].map(client=>client.rpc("set_auto_apply_enabled",{p_command_id:commands[winner],p_expected_version:0,p_enabled:false})));
 if(replays.some(r=>r.error || r.data?.version!==1 || r.data?.enabled!==false)) throw new Error("AUTO_APPLY_CONCURRENT_REPLAY_FAILED");
 const applications=await admin.from("applications").select("id",{count:"exact",head:true}).eq("workspace_id",workspaceId!);
 if(applications.error || applications.count!==0) throw new Error("AUTO_APPLY_FIXTURE_UNEXPECTED_APPLICATION");
 console.log(JSON.stringify({concurrentVersionWinner:1,staleCommandRejected:1,identicalCommandReplays:2,enabled:false,applications:0}));
} finally {
 if(workspaceId && userId) {
  const owner=await admin.from("workspaces").select("id,name,personal_owner_auth_user_id").eq("id",workspaceId).single();
  if(owner.error || owner.data.personal_owner_auth_user_id!==userId || owner.data.name!==`${display} workspace`) throw new Error("AUTO_APPLY_CLEANUP_SCOPE_MISMATCH");
  const removed=await admin.from("workspaces").delete().eq("id",workspaceId).eq("personal_owner_auth_user_id",userId);
  if(removed.error) throw new Error("AUTO_APPLY_CLEANUP_WORKSPACE_FAILED");
 }
 if(userId) {
  const own=await admin.auth.admin.getUserById(userId);
  if(own.error || own.data.user.email!==email || own.data.user.app_metadata.roledawn_auto_apply_acceptance!==runId) throw new Error("AUTO_APPLY_CLEANUP_AUTH_SCOPE_MISMATCH");
  const removed=await admin.auth.admin.deleteUser(userId);
  if(removed.error) throw new Error("AUTO_APPLY_CLEANUP_AUTH_FAILED");
  const missing=await admin.auth.admin.getUserById(userId);
  if(!missing.error) throw new Error("AUTO_APPLY_CLEANUP_AUTH_STILL_PRESENT");
 }
 if(workspaceId) {
  const missing=await admin.from("workspaces").select("id").eq("id",workspaceId);
  if(missing.error || missing.data.length!==0) throw new Error("AUTO_APPLY_CLEANUP_WORKSPACE_STILL_PRESENT");
 }
 console.log(JSON.stringify({syntheticAuthAndWorkspaceRemoved:true}));
}
