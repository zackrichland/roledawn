import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types.ts";
import { loadCandidateJobHistory, parseMatchingCatalogPage, scanMatchingCatalog } from "./candidate-recommendations.ts";

test("matching inventory RPC enforces identity and only returns current, permitted, fresh jobs",()=>{
  const sql=readFileSync(new URL("../../../supabase/migrations/20260917010757_candidate_matching_catalog.sql",import.meta.url),"utf8");
  assert.match(sql,/auth\.uid\(\)/u);
  assert.match(sql,/w\.personal_owner_auth_user_id=auth\.uid\(\)/u);
  assert.match(sql,/v\.id=j\.current_version_id/u);
  assert.match(sql,/s\.policy_status='ALLOWLISTED'/u);
  assert.match(sql,/s\.polling_enabled/u);
  assert.match(sql,/j\.last_seen_at >= now\(\)-interval '7 days'/u);
  assert.match(sql,/revoke all on function.*from public,anon/u);
  assert.match(sql,/order by j\.id limit p_limit/u);
});
test("matching catalog parser rejects malformed provenance even when display data is valid",()=>{
  assert.throws(()=>parseMatchingCatalogPage({}));
  assert.throws(()=>parseMatchingCatalogPage([{job_id:"bad"}]),/CATALOG_ROW_INVALID/u);
});
test("a catalog read failure is not mistaken for an empty complete matching scan",async()=>{
  const client={rpc:async()=>({data:null,error:{message:"connection failed"}})} as unknown as SupabaseClient<Database>;
  await assert.rejects(scanMatchingCatalog(client),/MATCHING_CATALOG_UNAVAILABLE/u);
});
test("candidate history reads beyond one API page and scopes every request to the owner",async()=>{
  const candidateId="10000000-0000-4000-8000-000000000001",workspaceId="10000000-0000-4000-8000-000000000002";
  const id=(n:number)=>`20000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
  const applications=Array.from({length:501},(_,index)=>({id:id(index+1),job_id:id(index+1000)}));
  const decisions=[{id:id(1),job_id:id(9998),decision:"PASSED"},{id:id(2),job_id:id(9999),decision:"SAVED"}];
  let requests=0;
  const client={from(table:string){
    const filters:Record<string,unknown>={}; let after="";
    const query={select(){return query;},eq(key:string,value:unknown){filters[key]=value;return query;},is(){return query;},order(){return query;},limit(){return query;},gt(_key:string,value:string){after=value;return query;},then(resolve:(value:unknown)=>unknown){
      requests++; assert.equal(filters.candidate_id,candidateId);assert.equal(filters.workspace_id,workspaceId);
      const rows=table==="applications"?applications:decisions;
      return Promise.resolve({data:rows.filter(row=>row.id>after).slice(0,500),error:null}).then(resolve);
    }};return query;
  }} as unknown as SupabaseClient<Database>;
  const history=await loadCandidateJobHistory(client,{candidateId,workspaceId});
  assert.equal(requests,3);
  assert.equal(history.applied.size,501);
  assert.ok(history.applied.has(id(1500)));
  assert.ok(history.passed.has(id(9998)));
  assert.ok(history.saved.has(id(9999)));
});
